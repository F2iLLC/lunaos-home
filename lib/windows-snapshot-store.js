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
// VersionedVaultRecordStore v2 contract over a local stdin/stdout worker: one
// bounded JSON request per process, no network, no shell.
//
// Developer adapter. The only protector the worker can compile today is the
// developer-harness fixture protector, so this module requires an explicit
// `protector: { kind: 'fixture', key }` and a worker built with
// `npm run build:snapshot-store`. The selected production protector (Software
// KSP with high-protection UI) and Home's enrollment/unlock/recovery lifecycle
// are separate work; no Home session, GUI or MCP route loads this adapter.

export const DEFAULT_WORKER = fileURLToPath(
  new URL(
    '../src-tauri/crates/windows-snapshot-store/target/developer-harness/debug/windows-snapshot-store-worker.exe',
    import.meta.url,
  ),
);
const MAX_INPUT = 1_048_576;
const storeIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const failure = () => new Error('Windows snapshot storage operation failed.');

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

// The worker executable is a trusted local build selected by the operator,
// never by a model request. Data travels via pipes, not arguments.
function snapshotWorker({ worker, storeId, protector, testFault }) {
  if (typeof worker !== 'string' || !worker)
    throw new TypeError('A worker executable path is required.');
  storeIdSchema.parse(storeId);
  const protectorRequest = protectorInput(protector);
  const faultContract = testFault === null ? null : windowsProbeTestFaults();
  if (faultContract && !faultContract.faults.includes(testFault))
    throw new TypeError('Unsupported synthetic fault injection.');
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
      const timer = setTimeout(stop, 30000);
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
          if (
            code === 1 &&
            result.ok === false &&
            result.error === 'CONFLICT' &&
            Object.keys(result).length === 2
          )
            return reject(new VaultConflictError());
          if (
            code === 1 &&
            result.ok === false &&
            result.error === 'UNSUPPORTED' &&
            Object.keys(result).length === 2
          )
            return reject(new VaultUnsupportedRecordError());
          if (code !== 0 || result.ok !== true) throw failure();
          resolve(result);
        } catch {
          reject(failure());
        }
      });
      child.stdin.end(input);
    });
  }
  return invoke;
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
    contractVersion: 2,
    // Privileged local metadata for the developer harness; never return it through MCP.
    storeId,
    directory: opened.directory,
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
    // Privileged fictional cleanup: removes only this store's own files and directory.
    async removeSyntheticStore() {
      await invoke('cleanup');
    },
  };
  return Object.freeze(adapter);
}
