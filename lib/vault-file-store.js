import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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
export const VAULT_FILE_CEILING_BYTES = 262144; // same ceiling as the other adapters
export const VAULT_FILE_MAX_RECORDS = 64;
const MAGIC = Buffer.from("LHVS\u0001", "latin1");
const SNAPSHOT = "vault.bin";
const LOCK = ".lock";
const LOCK_WAIT_MS = 10000;

const storeIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const snapshotSchema = z
  .object({
    schema: z.literal(1),
    records: z.record(vaultRecordId, versionedVaultRecord),
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
  const file = join(directory, SNAPSHOT);
  const lockFile = join(directory, LOCK);
  const aad = Buffer.concat([MAGIC, Buffer.from(storeId, "utf8")]);

  let exists = true;
  try {
    await stat(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw new VaultStoreError("READ_FAILED");
    exists = false;
  }
  if (!exists && !create) throw new VaultStoreError("MISSING");
  if (!exists) await mkdir(directory, { recursive: true, mode: 0o700 });
  // A new key is made only together with a new store. An existing store whose
  // key is gone stays unreadable; it is never silently re-keyed or emptied.
  let key = Buffer.from(await protector.key({ create: !exists }));
  if (key.length !== 32) throw new VaultStoreError("KEY_UNAVAILABLE");
  let closed = false;

  function seal(snapshot) {
    const plain = Buffer.from(JSON.stringify(snapshot), "utf8");
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
        return snapshotSchema.parse(JSON.parse(plain.toString("utf8")));
      } finally {
        plain.fill(0);
      }
    } catch {
      // Wrong key, tampering, truncation or an invalid record: all unreadable.
      throw new VaultStoreError("READ_FAILED");
    }
  }

  async function lock() {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await open(lockFile, "wx", 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw new VaultStoreError("BUSY");
      }
      // A holder that no longer exists cannot finish; its lock is released.
      // A commit is one atomic rename, so the snapshot is old or new, never mixed.
      try {
        const pid = Number(await readFile(lockFile, "utf8"));
        if (Number.isInteger(pid) && pid > 0 && !alive(pid))
          await rm(lockFile, { force: true });
      } catch {
        /* the holder just released it */
      }
      if (Date.now() >= deadline) throw new VaultStoreError("BUSY");
      await new Promise((resolve) => setTimeout(resolve, 15));
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
  async function commit(snapshot) {
    const sealed = seal(snapshot);
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
    fault("after-replacement"); // committed; only the acknowledgement is lost
  }
  // Every operation re-reads the file under the lock, so several processes on
  // this host (and several adapters in one process) see one ordering.
  async function locked(action) {
    if (closed) throw new VaultStoreError("CLOSED");
    await lock();
    try {
      return await action();
    } finally {
      await rm(lockFile, { force: true }).catch(() => {});
    }
  }
  async function mutate(recordId, apply) {
    return locked(async () => {
      const snapshot = await load();
      const next = apply(snapshot.records[recordId], snapshot.records);
      if (next === null) delete snapshot.records[recordId];
      else snapshot.records[recordId] = next;
      await commit(snapshot);
      return next;
    });
  }
  const expect = (current, expectedRevision) => {
    if (!current || current.revision !== expectedRevision)
      throw new VaultConflictError();
    return current;
  };
  const fresh = (data) => ({ revision: randomUUID(), data });

  if (!exists)
    await locked(async () => {
      // Another process may have created it while this one waited.
      try {
        await stat(file);
      } catch {
        await commit({ schema: 1, records: {} });
      }
    });
  else await locked(load); // fail now, not on first use, if it cannot be read

  return Object.freeze({
    contractVersion: 2,
    storeId,
    directory,
    async read(recordId) {
      check(vaultRecordId, recordId);
      return locked(async () => (await load()).records[recordId] ?? null);
    },
    async create(recordId, data) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordData, data);
      const row = await mutate(recordId, (current, records) => {
        if (current) throw new VaultConflictError();
        if (Object.keys(records).length >= VAULT_FILE_MAX_RECORDS)
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
    /** Forget the key held by this adapter. The files are untouched. */
    close() {
      closed = true;
      key.fill(0);
      key = Buffer.alloc(0);
    },
    /** Test stores only: remove this store's own files, nothing else. */
    async removeSyntheticStore() {
      this.close();
      for (const name of await readdir(directory).catch(() => []))
        if (
          name === SNAPSHOT ||
          name === LOCK ||
          /^vault-.*\.pending$/.test(name)
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
