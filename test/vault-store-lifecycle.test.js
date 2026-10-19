import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withExclusiveVaultRecovery } from '../lib/vault-store-lifecycle.js';

test('a session in another process excludes recovery until shutdown releases its lock', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lunaos-vault-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const probeId = crypto.randomUUID();
  const code = `
    import { registerVaultStoreSession } from './lib/vault-store-lifecycle.js';
    const release = registerVaultStoreSession({ probeId: ${JSON.stringify(probeId)}, directory: ${JSON.stringify(directory)} });
    process.stdout.write('ready');
    process.stdin.resume();
    process.stdin.on('end', () => { release(); process.stdout.write('stopped'); });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('session process timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.stdout.once('data', chunk => {
        if (chunk.includes('ready')) { clearTimeout(timeout); resolve(); }
      });
    });
    const store = { probeId, directory };
    await assert.rejects(withExclusiveVaultRecovery(store, async () => {}), /active or its recovery lock/);
  } finally {
    child.stdin.end();
    const codeResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('session shutdown timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', result => { clearTimeout(timeout); resolve(result); });
    });
    assert.equal(codeResult, 0);
    assert.ok(output.includes('stopped'));
  }
  let recovered = false;
  await withExclusiveVaultRecovery({ probeId, directory }, async () => { recovered = true; });
  assert.equal(recovered, true);
});
