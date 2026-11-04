// Fictional Software KSP envelope runner. No password/key/record input or logging.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, directory] = process.argv.slice(2);
assert.ok(['prepare', 'cancel', 'wrong-password', 'read', 'verify-restart', 'stale', 'commit', 'write-unknown', 'reconcile', 'receipt-retry', 'cleanup'].includes(mode),
  'Mode: prepare | cancel | wrong-password | read | verify-restart | stale | commit | write-unknown | reconcile | receipt-retry | cleanup');
assert.equal(process.platform, 'win32', 'Windows is required');
assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Use an attended interactive terminal');
assert.ok(directory && path.isAbsolute(directory), 'Supply an absolute evidence directory');
const evidenceRoot = path.join(process.env.LOCALAPPDATA, 'LunaOSHome', 'AttendedEvidence');
mkdirSync(evidenceRoot, { recursive: true });
const outside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative);
};
const target = path.resolve(directory);
if (mode === 'prepare') {
  assert.ok(!existsSync(target), 'Preparation requires a new directory');
  // Require a direct child to avoid junction/cloud redirection through descendants.
  assert.equal(realpathSync.native(path.dirname(target)), realpathSync.native(evidenceRoot));
  mkdirSync(target);
}
assert.ok(!lstatSync(target).isSymbolicLink(), 'Evidence directory must not be a link');
assert.equal(path.dirname(realpathSync.native(target)), realpathSync.native(evidenceRoot));
assert.ok(outside(realpathSync.native(root), realpathSync.native(target)), 'Evidence must stay outside checkout');
const envelope = path.join(target, 'fictional-envelope.v1');
const executable = path.join(root, 'src-tauri', 'target', 'debug', 'examples', 'windows_key_release_probe.exe');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'Commit the reviewed source before attended evidence');
if (mode === 'prepare') {
  assert.ok(!process.env.CARGO_TARGET_DIR, 'Use the default target directory for this runner');
  execFileSync('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'windows_key_release_probe', '--quiet'],
    { cwd: root, stdio: 'inherit', timeout: 600_000, windowsHide: true });
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '', 'Build changed source; review before attending');
}
const binarySha256 = hash(executable);
const metadataPath = path.join(target, 'runner.json');
if (mode === 'prepare') {
  writeFileSync(metadataPath, JSON.stringify({ schema: 2, sourceHead: head, binarySha256, fictional: true,
    requestId: randomBytes(16).toString('hex'), staleRequestId: randomBytes(16).toString('hex') }, null, 2) + '\n', { flag: 'wx' });
}
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
assert.equal(metadata.schema, 2);
assert.equal(metadata.fictional, true);
assert.match(metadata.requestId, /^[0-9a-f]{32}$/);
assert.match(metadata.staleRequestId, /^[0-9a-f]{32}$/);
assert.equal(metadata.sourceHead, head, 'Use the same source head after restart');
assert.equal(metadata.binarySha256, binarySha256, 'Use the same executable after restart');

const evidence = { schema: 1, mode, sourceHead: head, binarySha256, started: new Date().toISOString(),
  result: 'INCOMPLETE', attended: true, stages: [], cleanup: 'NOT_REQUESTED' };
const resultPath = path.join(target, 'attempt-' + randomUUID() + '.json');
// Leave an incomplete receipt even if the operator closes the entire console.
writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const statements = {
  prepare: 'Create a disposable separate KEY password in the Windows-owned dialog, then use it for verification. Keep it locally until cleanup. Never enter your Windows account password into Home or this terminal.',
  cancel: 'Close the Windows-owned key password dialog with its top-right X. Do not enter a password. The observed dialog has Allow and Don\'t allow buttons, not a Cancel button.',
  'wrong-password': 'Enter an intentionally wrong DISPOSABLE KEY password only in Windows and choose Allow. Confirm Windows rejects it, then close that dialog with its top-right X. Never send the password here.',
  read: 'Enter the disposable key password only in the Windows-owned dialog. One fictional native comparison will run; no record is displayed or returned.',
  'verify-restart': 'Use this only after a real Windows Restart and return to the same account. Enter the disposable key password only in Windows. This checks the native envelope, not joined phone behavior.',
  stale: 'Enter the disposable key password only in Windows. This sends a fictional compare-and-swap with an intentionally stale expected revision; it must conflict without changing ciphertext.',
  commit: 'Enter the disposable key password only in Windows. This commits one fictional whole-snapshot transition and its receipt together at revision 2.',
  'write-unknown': 'Enter the disposable key password only in Windows. This performs one fictional commit while intentionally losing its acknowledgement. The step stops at WRITE_UNKNOWN; it does not retry or reconcile.',
  reconcile: 'Read the retained fixture in a separate attended operation after WRITE_UNKNOWN. This resolves the outcome from current stored state without replaying the mutation.',
  'receipt-retry': 'Enter the disposable key password only in Windows. This repeats the same request identity after a known commit and must return its stored receipt without changing ciphertext.',
  cleanup: 'Remove only this attempt’s disposable protector and envelope. Result files remain outside the checkout.',
};
async function invoke(nativeMode, ...nativeArgs) {
  const receipt = { operation: nativeMode, exitCode: null, stages: [] };
  evidence.stages.push(receipt);
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  // This is an attended GUI owner. Hidden STARTUPINFO can hide its first window
  // and strand foreground validation after the OS dialog returns.
  const child = spawn(executable, [nativeMode, envelope, ...nativeArgs], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  let output = '';
  const consume = chunk => {
    output += chunk.toString('utf8');
    if (output.length > 8192) child.kill();
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const timer = setTimeout(() => child.kill(), 135_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
  } finally { clearTimeout(timer); }
  // Do not preserve arbitrary diagnostics. Only native stage vocabulary.
  const stages = output.split(/\r?\n/).filter(line =>
    /^(envelope-(result|stage): [a-zA-Z0-9-]+|fictional-envelope-prepared-locked|fictional-snapshot-(revision|committed|receipt):[0-9]+|fresh-process-silent-decrypt-denied|disposable-key-and-envelope-removed|HOME_WINDOWS_(MONITOR_READY|SESSION_ENDED)|HOME_WINDOWS_EVENT:[a-z-]+)$/.test(line));
  receipt.exitCode = code; receipt.stages = stages;
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  return { code, stages };
}
function passed(result) { return result.code === 0 && result.stages.includes('envelope-result: PASS'); }
try {
  console.log(statements[mode]);
  if (['prepare', 'read', 'verify-restart', 'stale', 'commit', 'write-unknown', 'reconcile', 'receipt-retry'].includes(mode)) {
    console.log('After each successful OS password dialog, click the Home test window within 30 seconds. Never enter a password in Home or this terminal.');
  }
  assert.equal(await terminal.question('Type begin to run this bounded attended step: '), 'begin', 'Not started');
  const before = existsSync(envelope) ? hash(envelope) : null;
  if (mode === 'prepare') {
    assert.ok(passed(await invoke('--envelope-attended-prepare')), 'Preparation incomplete; run explicit cleanup');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Fresh-process lock check failed');
    const sameBoot = await invoke('--envelope-attended-verify-restart');
    assert.equal(sameBoot.code, 1);
    assert.ok(sameBoot.stages.includes('envelope-result: cold-restart-not-observed'), 'Same-boot verification must refuse before prompting');
    evidence.result = 'PREPARED_NOT_RESTART_VERIFIED';
  } else if (mode === 'cancel' || mode === 'wrong-password') {
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Lock check failed');
    const denied = await invoke('--envelope-attended-read');
    assert.equal(denied.code, 1);
    assert.ok(denied.stages.includes('envelope-result: os-key-release-denied'), 'Expected OS denial was not observed');
    assert.equal(hash(envelope), before, 'Committed envelope changed on denial');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-denial lock check failed');
    const report = await terminal.question(mode === 'cancel'
      ? 'Type canceled only if you closed the Windows dialog with X: '
      : 'Type rejected-then-canceled only if Windows visibly rejected the wrong key password before you closed its dialog with X: ');
    assert.equal(report, mode === 'cancel' ? 'canceled' : 'rejected-then-canceled');
    evidence.operatorReport = report; // A report, not an API-classified wrong-password status.
    evidence.result = 'PASS';
  } else if (mode === 'read' || mode === 'verify-restart') {
    assert.ok(passed(await invoke(mode === 'read' ? '--envelope-attended-read' : '--envelope-attended-verify-restart')), 'Native verification failed');
    assert.equal(hash(envelope), before, 'Read changed ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-read lock check failed');
    evidence.result = 'PASS';
  } else if (mode === 'stale') {
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Pre-write lock check failed');
    const stale = await invoke('--envelope-attended-cas', '0', metadata.staleRequestId);
    assert.equal(stale.code, 1);
    assert.ok(stale.stages.includes('envelope-result: snapshot-conflict'), 'Expected stale revision conflict');
    assert.equal(hash(envelope), before, 'Stale write changed ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-conflict lock check failed');
    evidence.result = 'PASS';
  } else if (mode === 'commit') {
    const committed = await invoke('--envelope-attended-cas', '1', metadata.requestId);
    assert.ok(passed(committed), 'Snapshot commit failed');
    assert.ok(committed.stages.includes('fictional-snapshot-committed:2'));
    assert.ok(committed.stages.includes('fictional-snapshot-receipt:2'));
    assert.notEqual(hash(envelope), before, 'Commit did not replace ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-commit lock check failed');
    evidence.result = 'PASS';
  } else if (mode === 'write-unknown') {
    const unknown = await invoke('--envelope-attended-cas-unknown', '1', metadata.requestId);
    assert.equal(unknown.code, 1);
    assert.ok(unknown.stages.includes('envelope-result: commit-unknown-readback-required'), 'Expected explicit unknown outcome');
    assert.notEqual(hash(envelope), before, 'Injected lost acknowledgement did not occur after replacement');
    evidence.result = 'WRITE_UNKNOWN_READBACK_REQUIRED';
  } else if (mode === 'reconcile') {
    const readback = await invoke('--envelope-attended-read');
    assert.ok(passed(readback), 'Fresh attended readback failed');
    assert.ok(readback.stages.includes('fictional-snapshot-revision:2'), 'Expected committed revision 2');
    assert.equal(hash(envelope), before, 'Readback changed ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-readback lock check failed');
    evidence.result = 'PASS_COMMITTED';
  } else if (mode === 'receipt-retry') {
    const retry = await invoke('--envelope-attended-cas', '1', metadata.requestId);
    assert.ok(passed(retry), 'Idempotent receipt lookup failed');
    assert.ok(retry.stages.includes('fictional-snapshot-receipt:2'), 'Stored receipt was not returned');
    assert.equal(hash(envelope), before, 'Receipt lookup changed ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-retry lock check failed');
    evidence.result = 'PASS';
  } else {
    assert.ok(passed(await invoke('--envelope-cleanup')), 'Cleanup failed; preserve evidence for repair');
    assert.ok(!existsSync(envelope) && !existsSync(path.join(target, 'fictional-protector.id')));
    evidence.cleanup = 'PASS'; evidence.result = 'PASS';
  }
} catch {
  // No raw error paths, OS messages, typed input or stack traces in evidence.
  evidence.result = 'INCOMPLETE';
  if (mode === 'cleanup') evidence.cleanup = 'FAILED';
  process.exitCode = 1;
} finally {
  terminal.close();
  evidence.finished = new Date().toISOString();
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
  console.log('Do not reboot automatically. Keep this directory for explicit restart verification or cleanup.');
}
