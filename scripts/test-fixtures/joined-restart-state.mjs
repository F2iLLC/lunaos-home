// Local fictional harness custody. DPAPI here is not authentication-bound vault release.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const pem = z.string().min(1).max(16384);
const schema = z.object({
  schema: z.literal(1), fictional: z.literal(true),
  phase: z.enum(['starting', 'prepared', 'verified', 'cleaned']),
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/), nativeSha256: sha, apkSha256: sha,
  boot: z.string().regex(/^[0-9]{18}$/), probeId: z.string().uuid(),
  serial: z.string().min(1).max(120), model: z.string().min(1).max(100), api: z.string().regex(/^\d+$/),
  hostKey: pem, hostCert: pem, ca: pem, phoneCert: pem.optional(), peer: sha.optional(),
  ciphertextSha256: sha.optional(), registrySha256: sha.optional(), installAttempted: z.boolean(),
}).strict();
export const fileHash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function windowsBootMarker() {
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks'],
  { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
  assert.match(result, /^[0-9]{18}$/, 'Missing or malformed Windows boot marker');
  return result;
}
export function requireRestart(state, current) {
  schema.parse(state);
  assert.equal(state.phase, 'prepared', 'Only a completed preparation can verify restart');
  assert.match(current.boot, /^[0-9]{18}$/);
  assert.notEqual(state.boot, current.boot, 'cold-restart-not-observed');
  for (const key of ['sourceHead', 'nativeSha256', 'apkSha256', 'serial', 'model', 'api']) {
    assert.equal(current[key], state[key], `Restart fixture mismatch: ${key}`);
  }
  assert.ok(state.phoneCert && state.peer && state.ciphertextSha256 && state.registrySha256,
    'Completed preparation receipts are required');
}
function transform(operation, bytes) {
  const worker = fileURLToPath(new URL('../windows-attended-state-worker.ps1', import.meta.url));
  try {
    return Buffer.from(execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', worker], {
      input: JSON.stringify({ operation, bytes: bytes.toString('base64') }),
      encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 131072,
      stdio: ['pipe', 'pipe', 'pipe'],
    }), 'base64');
  } catch { throw Error('Protected fictional restart state unavailable'); }
}
export function restartDirectory(output, prepare, root = path.join(process.env.LOCALAPPDATA, 'LunaOSHome', 'AttendedEvidence')) {
  assert.ok(path.isAbsolute(output));
  mkdirSync(root, { recursive: true });
  const target = path.resolve(output);
  for (let cursor = target; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'No linked fixture paths');
    if (path.dirname(cursor) === cursor) break;
  }
  assert.equal(realpathSync.native(path.dirname(target)), realpathSync.native(root), 'Use a direct local evidence child');
  if (prepare) mkdirSync(target); // Never reuse an attempt.
  assert.ok(!lstatSync(target).isSymbolicLink());
  assert.equal(path.dirname(realpathSync.native(target)), realpathSync.native(root));
  return target;
}
export function lockRestartDirectory(directory) {
  const lock = path.join(directory, 'runner.lock');
  const fd = openSync(lock, 'wx');
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, boot: windowsBootMarker() })); }
  catch (error) { closeSync(fd); unlinkSync(lock); throw error; }
  return () => { closeSync(fd); unlinkSync(lock); };
}
export function saveRestartState(directory, state) {
  schema.parse(state);
  const plain = Buffer.from(JSON.stringify(state));
  let protectedBytes;
  try { protectedBytes = transform('protect', plain); } finally { plain.fill(0); }
  const pending = path.join(directory, 'restart-state.pending');
  const committed = path.join(directory, 'restart-state.dpapi');
  if (existsSync(committed)) assert.ok(!lstatSync(committed).isSymbolicLink());
  assert.ok(!existsSync(pending), 'Unknown prior state write requires explicit reconciliation');
  const fd = openSync(pending, 'wx');
  try { writeFileSync(fd, protectedBytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(pending, committed);
  assert.deepEqual(readFileSync(committed), protectedBytes);
}
export function readRestartState(directory) {
  const file = path.join(directory, 'restart-state.dpapi');
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 98304);
  const sealed = readFileSync(file);
  const plain = transform('unprotect', sealed);
  try { return schema.parse(JSON.parse(plain)); } finally { plain.fill(0); }
}
export function removeRestartState(directory) {
  // Call only after successfully reading committed ownership and cleaning its resources.
  const files = ['restart-state.pending', 'restart-state.dpapi'].map(name => path.join(directory, name));
  for (const file of files) if (existsSync(file)) {
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Refuse redirected cleanup');
  }
  for (const file of files) if (existsSync(file)) unlinkSync(file);
}
export function newRestartProbeId() { return randomUUID(); }
