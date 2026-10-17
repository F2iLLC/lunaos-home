import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const worker = fileURLToPath(new URL('../scripts/windows-vault-worker.ps1', import.meta.url));
const id = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const detail = z.object({ memberId: id, label: z.string().min(1).max(80), value: z.string().min(1).max(240) }).strict();
const failure = () => new Error('Windows synthetic storage operation failed.');

// Developer-only adapter. PowerShell is a trusted installed executable selected
// by the operator, never by a model request. Data travels via pipes, not arguments.
export async function openWindowsProbeStore({ powershell = 'pwsh', probeId = crypto.randomUUID(), create = false } = {}) {
  if (process.platform !== 'win32') throw new Error('This experiment requires Windows.');
  z.string().uuid().regex(/^[a-f0-9-]{36}$/).parse(probeId);
  async function invoke(operation, extra = {}) {
    const input = JSON.stringify({ operation, probeId, ...extra });
    if (Buffer.byteLength(input) > 65536) throw failure();
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
        if (bytes > 65536) stop(); else output += chunk;
      });
      child.stderr.on('data', () => {}); // Drain, never log data-bearing diagnostics.
      child.stdin.on('error', () => { failed = true; });
      child.on('error', () => { clearTimeout(timer); reject(failure()); });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed || code !== 0) return reject(failure());
        try {
          const result = JSON.parse(output.replace(/^\uFEFF/, ''));
          if (result.ok !== true) throw failure();
          resolve(result);
        } catch { reject(failure()); }
      });
      child.stdin.end(input);
    });
  }
  const opened = await invoke(create ? 'init' : 'open');
  if (typeof opened.directory !== 'string') throw failure();
  return Object.freeze({
    // Privileged local probe metadata; do not return this object through MCP.
    probeId, directory: opened.directory,
    async read(recordId) {
      const result = await invoke('read', { recordId: id.parse(recordId) });
      return result.data == null ? null : detail.parse(result.data);
    },
    async create(recordId, data) { await invoke('create', { recordId: id.parse(recordId), data: detail.parse(data) }); },
    async edit(recordId, data) { await invoke('edit', { recordId: id.parse(recordId), data: detail.parse(data) }); },
    async removeSyntheticStore() { await invoke('cleanup'); },
  });
}
