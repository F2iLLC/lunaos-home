import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireRestart, restartDirectory, saveRestartState, readRestartState,
  lockRestartDirectory, windowsBootMarker, removeRestartState, reviewedRunnerContinuation } from '../scripts/test-fixtures/joined-restart-state.mjs';

function fixture() {
  return { schema: 1, fictional: true, phase: 'prepared', sourceHead: 'a'.repeat(40),
    nativeSha256: 'b'.repeat(64), apkSha256: 'c'.repeat(64), boot: '638000000000000000',
    probeId: 'c9ae05ba-a136-4160-ae64-52700128bbe3', serial: 'fictional-usb', model: 'fictional-model', api: '37',
    hostKey: 'Fictional non-key test bytes', hostCert: 'fictional-host-cert', ca: 'fictional-ca',
    phoneCert: 'fictional-phone-cert', peer: 'd'.repeat(64), ciphertextSha256: 'e'.repeat(64),
    registrySha256: 'f'.repeat(64), installAttempted: true };
}
function temporary(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'home-joined-restart-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('restart requires changed OS boot marker, completed preparation and exact identities/builds', () => {
  const saved = fixture(), current = { ...saved, boot: '638000001000000000' };
  requireRestart(saved, current);
  assert.throws(() => requireRestart(saved, saved), /cold-restart-not-observed/);
  assert.throws(() => requireRestart(saved, { ...current, boot: 'NaN' }));
  for (const phase of ['starting', 'verified', 'cleaned']) {
    assert.throws(() => requireRestart({ ...saved, phase }, current), /completed preparation/);
  }
  for (const field of ['sourceHead', 'nativeSha256', 'apkSha256', 'serial', 'model', 'api']) {
    assert.throws(() => requireRestart(saved, { ...current, [field]: 'different' }), /mismatch/);
  }
  for (const field of ['phoneCert', 'peer', 'ciphertextSha256', 'registrySha256']) {
    const incomplete = { ...saved }; delete incomplete[field];
    assert.throws(() => requireRestart(incomplete, current), /receipts/);
  }
});
test('restart output refuses reuse, descendants and redirected paths', t => {
  const root = temporary(t), output = path.join(root, 'attempt');
  assert.equal(restartDirectory(output, true, root), output);
  assert.throws(() => restartDirectory(output, true, root));
  assert.equal(restartDirectory(output, false, root), output);
  assert.throws(() => restartDirectory(path.join(output, 'nested'), true, root));
  const linked = path.join(root, 'linked');
  symlinkSync(output, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => restartDirectory(linked, false, root), /linked/);
});
test('reviewed runner continuation preserves preparation and refuses native or unrelated changes', () => {
  const original = fixture(), head = '1'.repeat(40);
  const changed = ['scripts/test-attended-home-direct.mjs', 'scripts/test-fixtures/joined-restart-state.mjs'];
  const continued = reviewedRunnerContinuation(original, head, changed);
  assert.deepEqual(continued, { ...original, runnerHead: head });
  assert.equal(original.runnerHead, undefined);
  const current = { ...original, sourceHead: head, boot: '638000001000000000' };
  requireRestart(continued, current);
  assert.throws(() => requireRestart(original, current), /sourceHead/);
  assert.throws(() => requireRestart(continued, { ...current, boot: original.boot }), /cold-restart/);
  assert.throws(() => requireRestart(continued, { ...current, nativeSha256: '2'.repeat(64) }), /nativeSha256/);
  assert.throws(() => reviewedRunnerContinuation(continued, '2'.repeat(40), changed), /already pinned/);
  for (const file of ['src-tauri/src/lib.rs', 'scripts/android-direct-tls-probe/PairingActivity.java', 'package-lock.json', 'lib/direct-vault-tls.js']) {
    assert.throws(() => reviewedRunnerContinuation(original, head, [...changed, file]), /Only the reviewed/);
  }
  assert.throws(() => reviewedRunnerContinuation(original, head, []));
});
test('all joined restart modes refuse noninteractive execution before device access', () => {
  for (const mode of ['restart-prepare', 'restart-verify', 'restart-cleanup']) {
    const result = spawnSync(process.execPath, ['scripts/test-attended-home-direct.mjs', 'unused', 'unused',
      'fictional', 'fictional', '37', '192.168.1.2', mode], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Attended Windows terminal required/);
  }
});
test('real Windows state custody survives reopen, refuses tamper, and retains committed state on pending write',
  { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), state = fixture();
    saveRestartState(root, state);
    const file = path.join(root, 'restart-state.dpapi');
    const committed = readFileSync(file);
    assert.equal(committed.includes(Buffer.from(state.hostKey)), false);
    assert.deepEqual(readRestartState(root), state);
    // Separate process demonstrates this is persisted OS custody, not a module cache.
    const source = `import {readRestartState} from './scripts/test-fixtures/joined-restart-state.mjs'; process.stdout.write(readRestartState(process.argv[1]).phase);`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', source, root], { encoding: 'utf8' }), 'prepared');
    writeFileSync(path.join(root, 'restart-state.pending'), 'injected interrupted ciphertext write');
    assert.throws(() => saveRestartState(root, { ...state, phase: 'verified' }), /Unknown prior state write/);
    assert.deepEqual(readFileSync(file), committed);
    assert.deepEqual(readRestartState(root), state); // Never promote pending bytes.
    const tampered = Buffer.from(committed); tampered[Math.floor(tampered.length / 2)] ^= 1;
    writeFileSync(file, tampered);
    assert.throws(() => readRestartState(root), /unavailable/);
    writeFileSync(file, committed);
    assert.deepEqual(readRestartState(root), state);
    writeFileSync(path.join(root, 'result.json'), '{"result":"INCOMPLETE"}');
    removeRestartState(root);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(path.join(root, 'restart-state.pending')), false);
    assert.equal(existsSync(path.join(root, 'result.json')), true);
  });
test('real Windows fixture lock excludes a concurrent controller; boot marker is stable',
  { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), unlock = lockRestartDirectory(root);
    try { assert.throws(() => lockRestartDirectory(root)); }
    finally { unlock(); }
    lockRestartDirectory(root)();
    assert.equal(windowsBootMarker(), windowsBootMarker());
  });
