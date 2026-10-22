import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { withExclusiveVaultRecovery } from './vault-store-lifecycle.js';
import { vaultRevision, versionedVaultRecord, vaultMutationReceipt, VaultConflictError } from './vault-record-contract.js';

const worker = fileURLToPath(new URL('../scripts/windows-vault-worker.ps1', import.meta.url));
const id = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const detail = z.object({
  memberId: id,
  label: z.string().min(1).max(80).refine(value => value.isWellFormed()),
  value: z.string().min(1).max(240).refine(value => value.isWellFormed()),
}).strict();
const failure = () => new Error('Windows synthetic storage operation failed.');

// Developer-only adapter. PowerShell is a trusted installed executable selected
// by the operator, never by a model request. Data travels via pipes, not arguments.
export async function openWindowsProbeStore({ powershell = 'pwsh', probeId = crypto.randomUUID(), create = false, recovery = false, contractVersion = 1 } = {}) {
  if (process.platform !== 'win32') throw new Error('This experiment requires Windows.');
  if (![1, 2].includes(contractVersion) || (contractVersion === 2 && recovery)) {
    throw new TypeError('Unsupported synthetic storage or recovery contract.');
  }
  const versioned = contractVersion === 2;
  z.string().uuid().regex(/^[a-f0-9-]{36}$/).parse(probeId);
  async function invoke(operation, extra = {}) {
    const input = JSON.stringify({ operation, probeId, contractVersion, ...extra });
    const limit = operation === 'restore' ? 262144 : 65536;
    if (Buffer.byteLength(input) > limit) throw failure();
    return new Promise((resolve, reject) => {
      const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', worker], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let bytes = 0;
      let output = '';
      let failed = false;
      const stop = () => { failed = true; child.kill(); };
      const timer = setTimeout(stop, 30000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > (operation === 'snapshot' ? 262144 : 65536)) stop(); else output += chunk;
      });
      child.stderr.on('data', () => {}); // Drain, never log data-bearing diagnostics.
      child.stdin.on('error', () => { failed = true; });
      child.on('error', () => { clearTimeout(timer); reject(failure()); });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed) return reject(failure());
        try {
          const result = JSON.parse(output.replace(/^\uFEFF/, ''));
          if (versioned && code === 1 && result.ok === false && result.error === 'CONFLICT' &&
            Object.keys(result).length === 2) return reject(new VaultConflictError());
          if (code !== 0 || result.ok !== true) throw failure();
          resolve(result);
        } catch { reject(failure()); }
      });
      child.stdin.end(input);
    });
  }
  const opened = await invoke(create ? 'init' : 'open');
  if (typeof opened.directory !== 'string') throw failure();
  const adapter = {
    // Privileged local probe metadata; do not return this object through MCP.
    probeId, directory: opened.directory, contractVersion,
    async read(recordId) {
      const result = await invoke('read', { recordId: id.parse(recordId) });
      return result.data == null ? null : (versioned ? versionedVaultRecord : detail).parse(result.data);
    },
    async create(recordId, data) {
      const result = await invoke('create', { recordId: id.parse(recordId), data: detail.parse(data) });
      if (versioned) return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async edit(recordId, data, expectedRevision) {
      const result = await invoke('edit', { recordId: id.parse(recordId), data: detail.parse(data),
        ...(versioned ? { expectedRevision: vaultRevision.parse(expectedRevision) } : {}) });
      if (versioned) return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async delete(recordId, expectedRevision) {
      const result = await invoke('delete', { recordId: id.parse(recordId),
        ...(versioned ? { expectedRevision: vaultRevision.parse(expectedRevision) } : {}) });
      if (versioned) return vaultMutationReceipt.parse({ revision: result.revision });
    },
    async removeSyntheticStore() { await invoke('cleanup'); },
  };
  if (recovery === true) {
    // Explicit opt-in for privileged synthetic recovery. Ordinary callers and
    // the shared session/assistant adapter never receive these methods.
    adapter.exportSnapshot = async () => (await invoke('snapshot')).snapshot;
    adapter.importSnapshot = async snapshot => withExclusiveVaultRecovery(adapter,
      async () => { await invoke('restore', { snapshot }); });
  }
  return Object.freeze(adapter);
}
