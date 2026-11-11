import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { unlinkSync } from "node:fs";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { uptime } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  vaultRecordId,
  vaultRevision,
  vaultRecordData,
  vaultRecordDetail,
  versionedVaultRecord,
  VaultConflictError,
  VaultUnsupportedRecordError,
} from "./vault-record-contract.js";

// VersionedVaultRecordStore v2 on one encrypted snapshot file. This is the
// household vault's store on the Mac host: member details, the grocery list
// and Luna's notebook are records in the same file. It uses only Node, so the
// same code is exercised on every platform with a fixture key; on the Mac the
// key comes from the login Keychain (lib/mac-keychain-protector.js).
//
// File: MAGIC | 12-byte nonce | AES-256-GCM ciphertext | 16-byte tag. The magic
// and store id are authenticated, so a snapshot cannot be moved between stores.
//
// One process owns a store at a time. The owner holds `.lock` from open until
// its last adapter closes, and orders its own operations in memory. A second
// process is refused (BUSY) instead of sharing the file, so no operation ever
// depends on taking a lock over from a live writer.
export const VAULT_FILE_CEILING_BYTES = 262144; // same ceiling as the other adapters
export const VAULT_FILE_MAX_RECORDS = 64;
const MAGIC = Buffer.from("LHVS\u0001", "latin1");
const SNAPSHOT = "vault.bin";
const LOCK = ".lock";
const BOOT_TOLERANCE_MS = 120000;

const storeIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const lockSchema = z
  .object({
    pid: z.number().int().positive(),
    token: z.string().uuid(),
    bootedAt: z.number().finite(),
  })
  .strict();

export class VaultStoreError extends Error {
  constructor(code) {
    super("The vault store could not complete that request.");
    this.code = code;
  }
}
const check = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid vault store input.");
  return result.data;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const bootedAt = () => Date.now() - uptime() * 1000;

// Stores this process owns, by directory: adapters opened here share one lock
// and one queue, so "reopen" inside a process behaves like one ordered writer.
const owned = new Map();
// If the process ends without close(), leave no lock for the next start to
// reason about. A hard kill still leaves one; it names a dead pid.
let exitHook = false;
function releaseOnExit() {
  if (exitHook) return;
  exitHook = true;
  process.on("exit", () => {
    for (const directory of owned.keys()) {
      try {
        unlinkSync(join(directory, LOCK));
      } catch {
        /* already gone */
      }
    }
  });
}

/** True when the lock names a holder that can no longer be running. */
function abandoned(text) {
  let holder;
  try {
    holder = lockSchema.parse(JSON.parse(text));
  } catch {
    return true; // never written by this code as a live lock (see acquire)
  }
  // A lock from before this boot cannot have a live holder, even if an
  // unrelated process now has the same pid.
  if (Math.abs(holder.bootedAt - bootedAt()) > BOOT_TOLERANCE_MS) return true;
  return !alive(holder.pid);
}

async function acquire(directory) {
  const lockFile = join(directory, LOCK);
  const token = randomUUID();
  const body = JSON.stringify({
    pid: process.pid,
    token,
    bootedAt: bootedAt(),
  });
  const draft = join(directory, `.lock-${token}.tmp`);
  // The lock appears complete or not at all: write it aside, then hard-link.
  await writeFile(draft, body, { flag: "wx", mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await link(draft, lockFile);
        return token;
      } catch (error) {
        if (error.code !== "EEXIST") throw new VaultStoreError("BUSY");
      }
      let seen;
      try {
        seen = await readFile(lockFile, "utf8");
      } catch {
        continue; // released between the two calls
      }
      if (!abandoned(seen)) throw new VaultStoreError("BUSY");
      // Take the abandoned lock out of the way with one atomic rename, then
      // confirm it is the one that was judged. If another starter already
      // replaced it, put theirs back and yield.
      const aside = join(directory, `.lock-${token}.stale`);
      try {
        await rename(lockFile, aside);
      } catch {
        continue;
      }
      const taken = await readFile(aside, "utf8").catch(() => null);
      if (taken !== seen) {
        await link(aside, lockFile).catch(() => {});
        await rm(aside, { force: true });
        throw new VaultStoreError("BUSY");
      }
      await rm(aside, { force: true });
    }
    throw new VaultStoreError("BUSY");
  } finally {
    await rm(draft, { force: true }).catch(() => {});
  }
}

/**
 * @param {object} options
 * @param {string} options.directory  absolute directory owned by this store
 * @param {string} options.storeId    bound into every snapshot
 * @param {{key:(o:{create:boolean})=>Promise<Buffer>}} options.protector
 * @param {boolean} [options.create]  create the store if the directory has none
 * @param {(stage:string)=>void} [options.fault]  test seam only
 */
export async function openVaultFileStore({
  directory,
  storeId,
  protector,
  create = false,
  fault = () => {},
} = {}) {
  if (typeof directory !== "string" || !isAbsolute(directory))
    throw new TypeError("An absolute store directory is required.");
  check(storeIdSchema, storeId);
  if (typeof protector?.key !== "function")
    throw new TypeError("A key protector is required.");
  directory = resolve(directory);
  const file = join(directory, SNAPSHOT);
  const lockFile = join(directory, LOCK);
  const aad = Buffer.concat([MAGIC, Buffer.from(storeId, "utf8")]);

  const present = async () => {
    try {
      await stat(file);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw new VaultStoreError("READ_FAILED");
      return false;
    }
  };
  if (!(await present()) && !create) throw new VaultStoreError("MISSING");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  // Become (or join) this process's owner of the directory.
  let shared = owned.get(directory);
  if (!shared) {
    const pending = acquire(directory).then((token) => {
      const state = { token, adapters: 0, tail: Promise.resolve() };
      releaseOnExit();
      return state;
    });
    owned.set(directory, pending);
    try {
      shared = await pending;
      owned.set(directory, shared);
    } catch (error) {
      owned.delete(directory);
      throw error;
    }
  } else shared = await shared;
  shared.adapters += 1;
  let closed = false;
  let key = Buffer.alloc(0);
  async function release() {
    if (closed) return;
    closed = true;
    key.fill(0);
    key = Buffer.alloc(0);
    shared.adapters -= 1;
    if (shared.adapters > 0) return;
    owned.delete(directory);
    await shared.tail.catch(() => {});
    // Only ever remove the lock this owner wrote.
    const text = await readFile(lockFile, "utf8").catch(() => "");
    if (text.includes(shared.token)) await rm(lockFile, { force: true });
  }
  // Everything this owner does to the file runs one at a time, in order.
  const exclusive = (action) => {
    const run = shared.tail.then(() => {
      if (closed) throw new VaultStoreError("CLOSED");
      return action();
    });
    shared.tail = run.catch(() => {});
    return run;
  };

  function seal(records) {
    // Own properties only, so an id such as "__proto__" is just a key.
    const plain = Buffer.from(
      JSON.stringify({ schema: 1, records: Object.fromEntries(records) }),
      "utf8",
    );
    try {
      if (plain.length > VAULT_FILE_CEILING_BYTES)
        throw new VaultStoreError("TOO_LARGE");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      return Buffer.concat([
        MAGIC,
        nonce,
        cipher.update(plain),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    } finally {
      plain.fill(0);
    }
  }
  /** @returns {Map<string, {revision:string,data:object}>} */
  function unseal(bytes) {
    if (
      bytes.length < MAGIC.length + 28 ||
      bytes.length > VAULT_FILE_CEILING_BYTES + 64 ||
      !bytes.subarray(0, MAGIC.length).equals(MAGIC)
    )
      throw new VaultStoreError("READ_FAILED");
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(MAGIC.length, MAGIC.length + 12),
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(bytes.length - 16));
      const plain = Buffer.concat([
        decipher.update(bytes.subarray(MAGIC.length + 12, bytes.length - 16)),
        decipher.final(),
      ]);
      try {
        const parsed = JSON.parse(plain.toString("utf8"));
        const names = Object.keys(parsed ?? {}).sort();
        if (
          names.join() !== "records,schema" ||
          parsed.schema !== 1 ||
          parsed.records === null ||
          typeof parsed.records !== "object" ||
          Array.isArray(parsed.records)
        )
          throw new Error("shape");
        const records = new Map();
        for (const [recordId, row] of Object.entries(parsed.records))
          records.set(
            vaultRecordId.parse(recordId),
            versionedVaultRecord.parse(row),
          );
        if (records.size > VAULT_FILE_MAX_RECORDS) throw new Error("size");
        return records;
      } finally {
        plain.fill(0);
      }
    } catch {
      // Wrong key, tampering, truncation or an invalid record: all unreadable.
      throw new VaultStoreError("READ_FAILED");
    }
  }
  async function load() {
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      throw new VaultStoreError("READ_FAILED");
    }
    return unseal(bytes);
  }
  async function commit(records) {
    const sealed = seal(records);
    const pending = join(directory, `vault-${randomUUID()}.pending`);
    try {
      fault("before-write");
      const handle = await open(pending, "wx", 0o600);
      try {
        await handle.writeFile(sealed);
        fault("after-write");
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Never replace the committed snapshot with bytes that do not read back.
      unseal(await readFile(pending));
      fault("before-replacement");
      await rename(pending, file);
    } catch (error) {
      await rm(pending, { force: true }).catch(() => {});
      throw error;
    }
    // Make the rename itself durable where the platform allows it.
    try {
      const folder = await open(directory, "r");
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    } catch {
      /* not supported here (Windows) */
    }
    fault("after-replacement"); // committed; only the acknowledgement is lost
  }
  const mutate = (recordId, apply) =>
    exclusive(async () => {
      const records = await load();
      const next = apply(records.get(recordId), records);
      if (next === null) records.delete(recordId);
      else records.set(recordId, next);
      await commit(records);
      return next;
    });
  const expect = (current, expectedRevision) => {
    if (!current || current.revision !== expectedRevision)
      throw new VaultConflictError();
    return current;
  };
  const fresh = (data) => ({ revision: randomUUID(), data });

  try {
    await exclusive(async () => {
      // This owner is the only writer, so anything left pending is from a
      // commit that never finished.
      for (const name of await readdir(directory))
        if (/^vault-.*\.pending$|^\.lock-.*\.(tmp|stale)$/.test(name))
          if (!name.includes(shared.token))
            await rm(join(directory, name), { force: true });
      const exists = await present();
      if (!exists && !create) throw new VaultStoreError("MISSING");
      // A key is made only for a store that does not exist yet. If an earlier
      // setup stopped after making the key, that key is used, not replaced. An
      // existing store whose key is gone stays unreadable; it is never re-keyed.
      key = Buffer.from(await protector.key({ create: !exists }));
      if (key.length !== 32) throw new VaultStoreError("KEY_UNAVAILABLE");
      if (exists)
        await load(); // fail now, not on first use
      else await commit(new Map());
    });
  } catch (error) {
    await release();
    throw error;
  }

  return Object.freeze({
    contractVersion: 2,
    storeId,
    directory,
    async read(recordId) {
      check(vaultRecordId, recordId);
      return exclusive(async () => (await load()).get(recordId) ?? null);
    },
    async create(recordId, data) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordData, data);
      const row = await mutate(recordId, (current, records) => {
        if (current) throw new VaultConflictError();
        if (records.size >= VAULT_FILE_MAX_RECORDS)
          throw new VaultStoreError("FULL");
        return fresh(value);
      });
      return { revision: row.revision };
    },
    async edit(recordId, data, expectedRevision) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordData, data);
      check(vaultRevision, expectedRevision);
      const row = await mutate(recordId, (current) => {
        expect(current, expectedRevision);
        return fresh(value);
      });
      return { revision: row.revision };
    },
    // Member details only. A list record (grocery, notebook) can never be
    // overwritten through the profile path.
    async editProfile(recordId, data, expectedRevision) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordDetail, data);
      check(vaultRevision, expectedRevision);
      const row = await mutate(recordId, (current) => {
        expect(current, expectedRevision);
        if (!vaultRecordDetail.safeParse(current.data).success)
          throw new VaultUnsupportedRecordError();
        return fresh(value);
      });
      return { revision: row.revision };
    },
    async delete(recordId, expectedRevision) {
      check(vaultRecordId, recordId);
      check(vaultRevision, expectedRevision);
      await mutate(recordId, (current) => {
        expect(current, expectedRevision);
        return null;
      });
      return { revision: expectedRevision };
    },
    /**
     * Forget the key held by this adapter and, when it is the last adapter in
     * this process, give up ownership of the store. The files are untouched.
     */
    close: release,
    /** Test stores only: remove this store's own files, nothing else. */
    async removeSyntheticStore() {
      await release();
      for (const name of await readdir(directory).catch(() => []))
        if (
          name === SNAPSHOT ||
          name === LOCK ||
          /^vault-.*\.pending$|^\.lock-/.test(name)
        )
          await rm(join(directory, name), { force: true });
      await rm(directory, { recursive: false }).catch(() => {});
    },
  });
}

/** A caller-held key, for tests and conformance runs on any platform. */
export const fixtureProtector = (key) => ({
  kind: "fixture",
  async key() {
    return Buffer.from(key);
  },
});
