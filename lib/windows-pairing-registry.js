// Privileged, local-only pairing custody for the fictional Windows adapter.
// The worker chooses the path; callers never supply one or receive its contents.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('../scripts/windows-pairing-worker.ps1', import.meta.url));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function openWindowsPairingRegistry({ probeId, hostFingerprint, powershell = 'pwsh' }) {
  if (process.platform !== 'win32') throw new Error('Windows pairing custody requires Windows.');
  if (typeof probeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(probeId) || !hex(hostFingerprint)) {
    throw new TypeError('Invalid pairing registry identity.');
  }
  function invoke(operation, peerFingerprint) {
    if (peerFingerprint !== undefined && !hex(peerFingerprint)) throw new TypeError('Invalid peer fingerprint.');
    return new Promise((resolve, reject) => {
      const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', worker],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', size = 0, failed = false;
      const timer = setTimeout(() => { failed = true; child.kill(); }, 15_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 8192) { failed = true; child.kill(); } else output += chunk;
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { failed = true; });
      child.on('error', () => { failed = true; });
      child.on('close', code => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(output.replace(/^\uFEFF/, ''));
          if (failed || code !== 0 || result.ok !== true || !Array.isArray(result.peers) ||
              result.peers.length > 32 || result.peers.some(peer => !hex(peer)) ||
              new Set(result.peers).size !== result.peers.length || Object.keys(result).length !== 2) throw Error();
          resolve(result.peers);
        } catch { reject(new Error('Protected pairing registry unavailable.')); }
      });
      child.stdin.end(JSON.stringify({ operation, probeId, hostFingerprint, ...(peerFingerprint && { peerFingerprint }) }));
    });
  }
  return Object.freeze({
    probeId, hostFingerprint,
    load: () => invoke('load'),
    add: peer => invoke('add', peer),
    remove: peer => invoke('remove', peer),
    removeSyntheticRegistry: () => invoke('cleanup'),
  });
}
