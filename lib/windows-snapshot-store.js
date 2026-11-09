import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  vaultRecordId, vaultRevision, vaultRecordData, vaultRecordDetail, versionedVaultRecord, vaultMutationReceipt, VaultConflictError, VaultUnsupportedRecordError,
} from './vault-record-contract.js';
import { windowsProbeTestFaults } from './windows-probe-store.js';

// Node adapter for `WindowsSnapshotFileStore v1`, the native Rust store in
// src-tauri/crates/windows-snapshot-store. It implements the
// VersionedVaultRecordStore v2 contract over a local stdin/stdout worker: no
// network, no shell, data through pipes only.
//
// Two ways in, both developer adapters that no Home session, GUI or MCP route
// loads:
//
// - openWindowsSnapshotStore: one worker process per operation, with the
//   developer-harness fixture protector only.
// - openWindowsSnapshotSession: one worker process per unlock session. This
//   is the only way to use the Software KSP protector, because Windows asks
//   for the separate vault password once per session. The session ends, and
//   the vault is locked, when the worker exits: on lock(), Windows lock or
//   suspend, the owner closing the session window, inactivity or expiry.
//
// Home's enrollment/unlock/recovery product lifecycle is separate work.

export const DEFAULT_WORKER = fileURLToPath(
  new URL(
    '../src-tauri/crates/windows-snapshot-store/target/developer-harness/debug/windows-snapshot-store-worker.exe',
    import.meta.url,
  ),
);
const MAX_INPUT = 1_048_576;
const START_TIMEOUT_MS = 150_000; // The worker bounds the password gesture at 120 s.
const REQUEST_TIMEOUT_MS = 30_000;
const storeIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const failure = () => new Error('Windows snapshot storage operation failed.');

/** A request made after the session ended. Nothing was sent to the store. */
export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked.');
    this.name = 'VaultLockedError';
  }
}

export function windowsSnapshotWorkerAvailable(worker = DEFAULT_WORKER) {
  return typeof worker === 'string' && existsSync(worker);
}

function protectorInput(protector) {
  if (
    !protector ||
    protector.kind !== 'fixture' ||
    !(protector.key instanceof Uint8Array) ||
    protector.key.length !== 32
  ) {
    throw new TypeError(
      'A developer-harness fixture protector with a 32-byte key is required.',
    );
  }
  return { kind: 'fixture', key: Buffer.from(protector.key).toString('hex') };
}

function sessionProtectorInput(protector) {
  if (protector?.kind === 'software-ksp') {
    if (Object.keys(protector).length !== 1)
      throw new TypeError('The Software KSP protector takes no options.');
    return { kind: 'software-ksp' };
  }
  if (protector?.kind === 'fixture') return protectorInput(protector);
  throw new TypeError(
    'A session needs an explicit protector: software-ksp, or the developer-harness fixture.',
  );
}

function faultContractFor(testFault) {
  const contract = testFault === null ? null : windowsProbeTestFaults();
  if (contract && !contract.faults.includes(testFault))
    throw new TypeError('Unsupported synthetic fault injection.');
  return contract;
}

// Turn one worker response into the contract's outcome. Only a conflict and
// an unsupported record carry meaning; everything else is a generic failure.
function settle(result, { resolve, reject }) {
  if (
    result?.ok === false &&
    result.error === 'CONFLICT' &&
    Object.keys(result).length === 2
  )
    return reject(new VaultConflictError());
  if (
    result?.ok === false &&
    result.error === 'UNSUPPORTED' &&
    Object.keys(result).length === 2
  )
    return reject(new VaultUnsupportedRecordError());
  if (result?.ok !== true) return reject(failure());
  resolve(result);
}

// The worker executable is a trusted local build selected by the operator,
// never by a model request. Data travels via pipes, not arguments.
function snapshotWorker({ worker, storeId, protector, testFault }) {
  if (typeof worker !== 'string' || !worker)
    throw new TypeError('A worker executable path is required.');
  storeIdSchema.parse(storeId);
  const protectorRequest = protectorInput(protector);
  const faultContract = faultContractFor(testFault);
  if (process.platform !== 'win32')
    throw new Error('WindowsSnapshotFileStore requires Windows.');
  async function invoke(operation, extra = {}) {
    const input = JSON.stringify({
      operation,
      storeId,
      protector: protectorRequest,
      ...(faultContract?.operations.includes(operation) ? { testFault } : {}),
      ...extra,
    });
    if (Buffer.byteLength(input) > MAX_INPUT) throw failure();
    return new Promise((resolve, reject) => {
      const child = spawn(worker, [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let bytes = 0;
      let output = '';
      let failed = false;
      const stop = () => {
        failed = true;
        child.kill();
      };
      const timer = setTimeout(stop, REQUEST_TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_INPUT) stop();
        else output += chunk;
      });
      child.stderr.on('data', () => {}); // Drain, never log data-bearing diagnostics.
      child.stdin.on('error', () => {
        failed = true;
      });
      child.on('error', () => {
        clearTimeout(timer);
        reject(failure());
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failed) return reject(failure());
        try {
          const result = JSON.parse(output);
          if ((code === 0) !== (result.ok === true)) throw failure();
          settle(result, { resolve, reject });
        } catch {
          reject(failure());
        }
      });
      child.stdin.end(input);
    });
  }
  return invoke;
}

// The VersionedVaultRecordStore v2 record operations over any `invoke`.
function recordOperations(invoke) {
  return {
    contractVersion: 2,
    async read(recordId) {
      const result = await invoke('read', {
        recordId: vaultRecordId.parse(recordId),
      });
      return result.data == null
        ? null
        : versionedVaultRecord.parse(result.data);
    },
    async create(recordId, data) {
      const result = await invoke('create', {
        recordId: vaultRecordId.parse(recordId),
        data: vaultRecordData.parse(data),
      });
      return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async edit(recordId, data, expectedRevision) {
      const result = await invoke('edit', {
        recordId: vaultRecordId.parse(recordId),
        data: vaultRecordData.parse(data),
        expectedRevision: vaultRevision.parse(expectedRevision),
      });
      return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async editProfile(recordId, data, expectedRevision) {
      const result = await invoke('edit-profile', {
        recordId: vaultRecordId.parse(recordId),
        data: vaultRecordDetail.parse(data),
        expectedRevision: vaultRevision.parse(expectedRevision),
      });
      return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async delete(recordId, expectedRevision) {
      const result = await invoke('delete', {
        recordId: vaultRecordId.parse(recordId),
        expectedRevision: vaultRevision.parse(expectedRevision),
      });
      return vaultMutationReceipt.parse({ revision: result.revision });
    },
  };
}

export async function openWindowsSnapshotStore(options = {}) {
  if (Object.hasOwn(options, 'testFault'))
    throw new TypeError(
      'Fault injection is available only through openWindowsSnapshotStoreForFaultTest.',
    );
  return openStore(options, null);
}

// Test-harness entry point for the fault matrix. Kept apart from
// openWindowsSnapshotStore so the ordinary signature has no fault parameter.
export async function openWindowsSnapshotStoreForFaultTest(options, testFault) {
  if (typeof testFault !== 'string')
    throw new TypeError('Unsupported synthetic fault injection.');
  return openStore(options, testFault);
}

async function openStore(
  {
    worker = DEFAULT_WORKER,
    storeId = crypto.randomUUID(),
    create = false,
    protector,
  } = {},
  testFault,
) {
  const invoke = snapshotWorker({ worker, storeId, protector, testFault });
  const opened = await invoke(create ? 'init' : 'open');
  if (typeof opened.directory !== 'string') throw failure();
  const adapter = {
    ...recordOperations(invoke),
    // Privileged local metadata for the developer harness; never return it through MCP.
    storeId,
    directory: opened.directory,
    // Privileged fictional cleanup: removes only this store's own files and directory.
    async removeSyntheticStore() {
      await invoke('cleanup');
    },
  };
  return Object.freeze(adapter);
}

// ---- Unlock sessions ------------------------------------------------------

/**
 * Open one unlock session. With `protector: { kind: 'software-ksp' }` Windows
 * shows its own dialog: on `create`, to set the separate vault password and
 * then to enter it once; otherwise to enter it once. The password never
 * reaches this process or the worker's pipes.
 *
 * The returned adapter serves the record contract until the session ends.
 * `ended` resolves with a fixed reason: `locked`, `idle`, `expired`,
 * `unlock-timeout`, `session-event` (Windows lock, logoff, suspend or resume),
 * `window-closed` or `ended`. A request in flight when the session ends fails
 * with the generic storage failure, because its commit outcome is unknown and
 * must be read back; a request made afterwards fails with VaultLockedError.
 */
export async function openWindowsSnapshotSession(options = {}) {
  for (const key of ['testFault', 'testIdleMs', 'testLifetimeMs'])
    if (Object.hasOwn(options, key))
      throw new TypeError(
        'Test controls are available only through openWindowsSnapshotSessionForTest.',
      );
  return openSession(options, {});
}

// Test-harness entry point: shortened limits and injected commit faults. The
// worker accepts these only in a developer-harness build.
export async function openWindowsSnapshotSessionForTest(options, test = {}) {
  const allowed = ['testFault', 'testIdleMs', 'testLifetimeMs'];
  if (
    !test ||
    typeof test !== 'object' ||
    Object.keys(test).some((key) => !allowed.includes(key))
  )
    throw new TypeError('Unsupported session test control.');
  return openSession(options, test, true);
}

async function openSession(
  {
    worker = DEFAULT_WORKER,
    storeId = crypto.randomUUID(),
    create = false,
    protector,
  } = {},
  { testFault = null, testIdleMs, testLifetimeMs },
  testEntry = false,
) {
  if (typeof worker !== 'string' || !worker)
    throw new TypeError('A worker executable path is required.');
  storeIdSchema.parse(storeId);
  const protectorRequest = sessionProtectorInput(protector);
  faultContractFor(testFault);
  const faultOperations = windowsProbeTestFaults().operations;
  for (const limit of [testIdleMs, testLifetimeMs])
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 50))
      throw new TypeError('Unsupported session test control.');
  if (process.platform !== 'win32')
    throw new Error('WindowsSnapshotFileStore requires Windows.');

  const child = spawn(worker, ['--session'], {
    // The Software KSP session window must be visible: it owns the dialog.
    windowsHide: protectorRequest.kind !== 'software-ksp',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let endReason = null;
  let closed = false;
  let start;
  const started = new Promise((resolve, reject) => {
    start = { resolve, reject };
  });
  let resolveEnded;
  const ended = new Promise((resolve) => {
    resolveEnded = resolve;
  });
  const startTimer = setTimeout(() => child.kill(), START_TIMEOUT_MS);

  function receive(line) {
    // Lifecycle receipts from the native session monitor are not responses.
    if (line.startsWith('HOME_WINDOWS_')) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return child.kill();
    }
    if (message?.event === 'ended') {
      if (typeof message.reason === 'string') endReason = message.reason;
      return;
    }
    if (start) {
      const waiting = start;
      start = null;
      clearTimeout(startTimer);
      if (message?.ok === true && message.session === 'unlocked')
        return waiting.resolve(message);
      return waiting.reject(
        Object.assign(failure(), {
          // Static identifiers from the worker, never data or OS text.
          code: typeof message?.error === 'string' ? message.error : undefined,
          reason:
            typeof message?.reason === 'string' ? message.reason : undefined,
        }),
      );
    }
    const waiting = pending.get(message?.id);
    if (!waiting) return child.kill();
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    const { id: _id, ...result } = message;
    settle(result, waiting);
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_INPUT * 2) return child.kill();
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) receive(line);
    }
  });
  child.stderr.on('data', () => {}); // Drain, never log data-bearing diagnostics.
  child.stdin.on('error', () => {});
  const close = (code) => {
    if (closed) return;
    closed = true;
    clearTimeout(startTimer);
    if (start) {
      start.reject(failure());
      start = null;
    }
    // An unanswered request may or may not have committed: read back later.
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(failure());
    }
    pending.clear();
    resolveEnded(endReason ?? (code === 0 ? 'locked' : 'ended'));
  };
  child.on('error', () => close(null));
  child.on('close', close);

  const startRequest = {
    operation: create ? 'session-create' : 'session-open',
    storeId,
    protector: protectorRequest,
    ...(testIdleMs === undefined ? {} : { testIdleMs }),
    ...(testLifetimeMs === undefined ? {} : { testLifetimeMs }),
  };
  child.stdin.write(JSON.stringify(startRequest) + '\n');
  let opened;
  try {
    opened = await started;
  } catch (error) {
    child.kill();
    throw error;
  }

  function invoke(operation, extra = {}, fault = testFault) {
    if (closed) return Promise.reject(new VaultLockedError());
    const id = nextId++;
    const input = JSON.stringify({
      id,
      operation,
      ...(fault !== null && faultOperations.includes(operation)
        ? { testFault: fault }
        : {}),
      ...extra,
    });
    if (Buffer.byteLength(input) > MAX_INPUT) return Promise.reject(failure());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(input + '\n');
    });
  }

  const adapter = {
    ...recordOperations(invoke),
    storeId,
    protectorKind: protectorRequest.kind,
    // Present only from a developer-harness worker; never return it through MCP.
    ...(typeof opened.directory === 'string'
      ? { directory: opened.directory }
      : {}),
    /** Resolves with the reason once the session has ended. */
    ended,
    get locked() {
      return closed;
    },
    /** Lock now. Resolves when the worker has exited. */
    async lock() {
      if (!closed) {
        invoke('lock').catch(() => {});
        child.stdin.end();
      }
      return ended;
    },
    // Test entry point only: the record operations with one injected commit
    // fault, inside this same session.
    ...(testEntry
      ? {
          withTestFault(fault) {
            if (typeof fault !== 'string' || !faultContractFor(fault))
              throw new TypeError('Unsupported synthetic fault injection.');
            return recordOperations((operation, extra) =>
              invoke(operation, extra, fault),
            );
          },
        }
      : {}),
    // Developer harness only: remove the fictional store and, for the
    // Software KSP protector, its disposable key. Ends the session.
    async destroySyntheticStore() {
      await invoke('destroy');
      child.stdin.end();
      await ended;
    },
  };
  return Object.freeze(adapter);
}

// Developer harness only: clear a fictional Software KSP store and its
// disposable key without any key release, for a lost or never-set password.
export async function discardSyntheticKspStore({
  worker = DEFAULT_WORKER,
  storeId,
} = {}) {
  storeIdSchema.parse(storeId);
  if (process.platform !== 'win32')
    throw new Error('WindowsSnapshotFileStore requires Windows.');
  const input = JSON.stringify({
    operation: 'discard',
    storeId,
    protector: { kind: 'software-ksp' },
  });
  await new Promise((resolve, reject) => {
    const child = spawn(worker, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill(), REQUEST_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (output.length < 4096) output += chunk;
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(failure());
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || JSON.parse(output).ok !== true) throw failure();
        resolve();
      } catch {
        reject(failure());
      }
    });
    child.stdin.end(input);
  });
}
