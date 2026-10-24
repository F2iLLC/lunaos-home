import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('KSP runner refuses unattended input before creating evidence or opening a native prompt', () => {
  for (const mode of ['prepare', 'cancel', 'wrong-password', 'read', 'verify-restart', 'cleanup']) {
    const output = path.join(tmpdir(), 'HomeFictionalRefusal-' + randomUUID());
    const result = spawnSync(process.execPath, ['scripts/test-attended-ksp-envelope.mjs', mode, output],
      { encoding: 'utf8', timeout: 10_000, input: 'begin\n' });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, process.platform === 'win32' ? /attended interactive terminal/ : /Windows is required/);
    assert.equal(existsSync(output), false);
  }
});

test('KSP runner rejects an unknown mode before attempting device work', () => {
  const result = spawnSync(process.execPath, ['scripts/test-attended-ksp-envelope.mjs', 'unlock-anything'],
    { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Mode: prepare/);
});
