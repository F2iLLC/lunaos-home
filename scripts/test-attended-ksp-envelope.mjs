// Fictional Software KSP envelope runner. No password/key/record input or logging.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, directory] = process.argv.slice(2);
assert.ok(['prepare', 'cancel', 'wrong-password', 'read', 'verify-restart', 'cleanup'].includes(mode),
  'Mode: prepare | cancel | wrong-password | read | verify-restart | cleanup');
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
  writeFileSync(metadataPath, JSON.stringify({ schema: 1, sourceHead: head, binarySha256, fictional: true }, null, 2) + '\n', { flag: 'wx' });
}
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
assert.equal(metadata.schema, 1);
assert.equal(metadata.fictional, true);
assert.equal(metadata.sourceHead, head, 'Use the same source head after restart');
assert.equal(metadata.binarySha256, binarySha256, 'Use the same executable after restart');

const evidence = { schema: 1, mode, sourceHead: head, binarySha256, started: new Date().toISOString(),
  result: 'INCOMPLETE', attended: true, stages: [], cleanup: 'NOT_REQUESTED' };
const resultPath = path.join(target, 'attempt-' + randomUUID() + '.json');
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const statements = {
  prepare: 'Create a disposable separate KEY password in the Windows-owned dialog, then use it for verification. Keep it locally until cleanup. Never enter your Windows account password into Home or this terminal.',
  cancel: 'Cancel the Windows-owned key password dialog. Do not enter a password.',
  'wrong-password': 'Enter an intentionally wrong DISPOSABLE KEY password only in Windows. Confirm Windows rejects it, then cancel. Never send it here.',
  read: 'Enter the disposable key password only in the Windows-owned dialog. One fictional native comparison will run; no record is displayed or returned.',
  'verify-restart': 'Use this only after a real Windows Restart and return to the same account. Enter the disposable key password only in Windows. This checks the native envelope, not joined phone behavior.',
  cleanup: 'Remove only this attempt’s disposable protector and envelope. Result files remain outside the checkout.',
};
async function invoke(nativeMode) {
  const child = spawn(executable, [nativeMode, envelope], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
    /^(envelope-(result|stage): [a-zA-Z0-9-]+|fictional-envelope-prepared-locked|fresh-process-silent-decrypt-denied|disposable-key-and-envelope-removed|HOME_WINDOWS_(MONITOR_READY|SESSION_ENDED)|HOME_WINDOWS_EVENT:[a-z-]+)$/.test(line));
  evidence.stages.push({ operation: nativeMode, exitCode: code, stages });
  return { code, stages };
}
function passed(result) { return result.code === 0 && result.stages.includes('envelope-result: PASS'); }
try {
  console.log(statements[mode]);
  if (['prepare', 'read', 'verify-restart'].includes(mode)) {
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
      ? 'Type canceled only if you canceled the Windows dialog: '
      : 'Type rejected-then-canceled only if Windows visibly rejected the wrong key password before you canceled: ');
    assert.equal(report, mode === 'cancel' ? 'canceled' : 'rejected-then-canceled');
    evidence.operatorReport = report; // A report, not an API-classified wrong-password status.
    evidence.result = 'PASS';
  } else if (mode === 'read' || mode === 'verify-restart') {
    assert.ok(passed(await invoke(mode === 'read' ? '--envelope-attended-read' : '--envelope-attended-verify-restart')), 'Native verification failed');
    assert.equal(hash(envelope), before, 'Read changed ciphertext');
    assert.ok(passed(await invoke('--envelope-check-locked')), 'Post-read lock check failed');
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
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence, null, 2));
  console.log('Do not reboot automatically. Keep this directory for explicit restart verification or cleanup.');
}
