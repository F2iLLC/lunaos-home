#!/usr/bin/env node
// Developer-only live check of the Google Calendar milestone 1 criteria.
// Synthetic test accounts only. State lives outside the checkout.
//
//   node scripts/probe-google-calendar.mjs auth <account> <read|write>
//   node scripts/probe-google-calendar.mjs run --write <account> --calendar <id> --read-only <same-account>
//   node scripts/probe-google-calendar.mjs combined <account> <different-account> [...]
//
// $LUNA_HOME_PROBE_DIR must hold client.json ({"client_id","client_secret"}) for
// an OAuth "Desktop app" client in a test Google Cloud project. Tokens are
// written there as <account>.<read|write>.json with private file access.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, realpath, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createCalendarProbe, SCOPES, newEventId, requireGrantedScopes, primaryCalendarId, verifyReadOnlyWriteDenied } from '../lib/google-calendar-probe.js';
import { verifyEventLifecycle } from '../lib/google-calendar-probe-run.js';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const configuredDir = process.env.LUNA_HOME_PROBE_DIR;
if (!configuredDir || !isAbsolute(configuredDir)) fail('Set LUNA_HOME_PROBE_DIR to an existing absolute directory outside the checkout.');
const dir = await realpath(configuredDir).catch(() => fail('LUNA_HOME_PROBE_DIR must already exist.'));
const canonicalRepo = await realpath(repo);
const rel = relative(canonicalRepo, dir);
if (!rel.startsWith('..') && !isAbsolute(rel)) fail('LUNA_HOME_PROBE_DIR must be outside the checkout.');

// The local application-data root is not a cloud-sync folder by default.
// Require this dedicated location instead of accepting any external path.
const privateRoot = process.platform === 'win32' ? process.env.LOCALAPPDATA
  : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : join(homedir(), '.local', 'state');
if (!privateRoot) fail('A local application-data directory is required.');
const canonicalRoot = await realpath(privateRoot).catch(() => fail('The local application-data directory must exist.'));
const privateRel = relative(canonicalRoot, dir);
if (!privateRel || privateRel.startsWith('..') || isAbsolute(privateRel)) {
  fail('LUNA_HOME_PROBE_DIR must be a dedicated directory under local application data.');
}

function secureWindowsAcl(path, directory) {
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:LUNA_PROBE_SECURE_PATH
$directory = $env:LUNA_PROBE_IS_DIR -eq '1'
$acl = if ($directory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid)
$inherit = if ($directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
$acl.AddAccessRule($rule)
if ($directory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...process.env, LUNA_PROBE_SECURE_PATH: path, LUNA_PROBE_IS_DIR: directory ? '1' : '0' },
      stdio: 'pipe',
    });
  } catch {
    fail('Could not establish private Windows access to the credential path.');
  }
}

async function secureCredentialPath(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    fail('Credential paths must be ordinary files in a dedicated directory.');
  }
  if (process.platform === 'win32') secureWindowsAcl(path, directory);
  else {
    if (info.mode & 0o077) fail('Credential paths must deny group and other access (mode 0700/0600).');
    if (process.platform === 'darwin') {
      try {
        // macOS ACL entries can override BSD mode bits and are inherited by new files.
        execFileSync('chmod', ['-N', path], { stdio: 'pipe' });
      } catch {
        fail('Could not remove the macOS credential path ACL.');
      }
    }
  }
}
await secureCredentialPath(dir, true);

function fail(message) { console.error(message); process.exit(2); }
const b64url = buf => buf.toString('base64url');
const tokenFile = (account, kind) => join(dir, `${account}.${kind}.json`);
const accountName = value => (/^[a-z0-9-]{1,40}$/.test(value ?? '') ? value : fail('Account labels are lowercase letters, digits and hyphens.'));
// Accepts the file as Google downloads it ({"installed": {...}}) or flattened.
const clientConfig = async () => {
  await secureCredentialPath(join(dir, 'client.json'));
  const file = JSON.parse(await readFile(join(dir, 'client.json'), 'utf8'));
  const { client_id, client_secret } = file.installed ?? file;
  if (!client_id || !client_secret) fail('client.json needs client_id and client_secret.');
  return { client_id, client_secret };
};

async function tokenRequest(params) {
  const { client_id, client_secret } = await clientConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, ...params }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Token request failed: ${body.error ?? response.status}`);
  return body;
}

async function auth(account, kind) {
  if (!SCOPES[kind]) fail('Kind must be read or write.');
  const { client_id } = await clientConfig();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPES[kind], state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent',
  });
  console.log(`Sign in as the synthetic account "${account}" at:\n${url}`);
  const code = await new Promise((resolveCode, reject) => {
    server.on('request', (req, res) => {
      const query = new URL(req.url, redirect).searchParams;
      res.end('You can close this tab.');
      if (query.get('state') !== state) return reject(new Error('State mismatch'));
      query.get('code') ? resolveCode(query.get('code')) : reject(new Error(query.get('error') ?? 'No code'));
    });
  }).finally(() => server.close());
  const tokens = await tokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
  requireGrantedScopes(kind, tokens.scope);
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token; existing authorization was retained.');
  // A new file followed by rename replaces a symlink rather than following it.
  const temp = join(dir, `.token-${b64url(randomBytes(16))}.tmp`);
  try {
    await writeFile(temp, JSON.stringify({ refresh_token: tokens.refresh_token, scope: tokens.scope }), { mode: 0o600, flag: 'wx' });
    await secureCredentialPath(temp);
    await rename(temp, tokenFile(account, kind));
  } finally {
    await unlink(temp).catch(() => {});
  }
  console.log(`Saved ${kind} token for ${account} (granted: ${tokens.scope}).`);
}

function probeFor(account, kind, writableCalendars, audit) {
  let cached;
  const getToken = async () => {
    if (cached && cached.expires > Date.now() + 30_000) return cached.value;
    await secureCredentialPath(tokenFile(account, kind));
    const { refresh_token, scope } = JSON.parse(await readFile(tokenFile(account, kind), 'utf8'));
    requireGrantedScopes(kind, scope);
    if (!refresh_token) throw new Error('The saved authorization has no refresh token.');
    const fresh = await tokenRequest({ refresh_token, grant_type: 'refresh_token' });
    if (fresh.scope) requireGrantedScopes(kind, fresh.scope);
    cached = { value: fresh.access_token, expires: Date.now() + fresh.expires_in * 1000 };
    return cached.value;
  };
  return createCalendarProbe({ account, scopeKind: kind, getToken, writableCalendars, audit });
}

const results = [];
async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, result: 'PASS', detail });
  } catch (error) {
    results.push({ name, result: 'FAIL', detail: error.code ?? error.message });
    throw error;
  }
}
const expectCode = async (code, reason, run) => {
  try { await run(); } catch (error) {
    if (error.code === code && (reason === null || error.reason === reason)) return `${code}:${reason ?? 'local'}`;
    throw new Error(`Expected ${code}:${reason ?? 'local'}, got ${error.code ?? 'ERROR'}:${error.reason ?? 'none'}`);
  }
  throw new Error(`Expected ${code}:${reason ?? 'local'} but the call succeeded`);
};

async function liveRun({ writer, calendar, readOnly }) {
  const audit = [];
  const log = entry => audit.push(entry);
  const write = probeFor(writer, 'write', [calendar], log);
  const reader = probeFor(readOnly, 'read', [calendar], log);
  const writeCalendars = await write.listCalendars();
  if (primaryCalendarId(writeCalendars) !== primaryCalendarId(await reader.listCalendars())) {
    throw new Error('Read and write tokens resolved to different Google principals.');
  }
  const stamp = new Date(Date.now() + 7 * 864e5);
  stamp.setUTCHours(15, 0, 0, 0);
  const slot = hours => new Date(stamp.getTime() + hours * 36e5).toISOString();
  const event = { summary: 'Fictional Home probe event', start: { dateTime: slot(0) }, end: { dateTime: slot(1) } };
  const id = newEventId();

  try {
    await check('lists calendars with access roles', async () => writeCalendars.map(c => c.accessRole).join(','));
    await verifyEventLifecycle({ write, calendar, event, id, check, expectCode });

    // The read token belongs to the writable principal, so CalendarList reports
    // the same role and the provider must refuse the actual event insertion.
    await check('read-only token can list events', async () => (await reader.listEvents(calendar, { timeMin: slot(-24), timeMax: slot(24) })).length + ' events');
    await check('read-only token cannot create', () => verifyReadOnlyWriteDenied({
      reader, writer: write, calendarId: calendar, event, eventId: newEventId(),
    }));
  } finally {
    // Any failed check halts this run before subsequent mutations.
    report(audit);
  }
}

async function combined(accounts) {
  if (new Set(accounts).size < 2 || new Set(accounts).size !== accounts.length) fail('combined needs at least two distinct account labels.');
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 864e5).toISOString();
  const all = [];
  const principals = new Set();
  for (const account of accounts) {
    const probe = probeFor(account, 'read', [], () => {});
    const calendars = await probe.listCalendars();
    const principal = primaryCalendarId(calendars);
    if (principals.has(principal)) throw new Error('Two account labels resolved to the same Google principal.');
    principals.add(principal);
    for (const cal of calendars) {
      all.push(...await probe.listEvents(cal.id, { timeMin: from, timeMax: to }));
    }
  }
  const keys = new Set(all.map(e => `${e.account}/${e.calendarId}/${e.eventId}`));
  console.log(JSON.stringify({ accounts: accounts.length, events: all.length, uniqueIdentities: keys.size, byAccount: Object.fromEntries(accounts.map(a => [a, all.filter(e => e.account === a).length])) }, null, 2));
}

function report(audit) {
  console.table(results);
  console.log('Local audit (targets and outcomes only):');
  console.table(audit);
  process.exitCode = results.every(r => r.result === 'PASS') ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
const flag = name => { const i = rest.indexOf(name); return i === -1 ? undefined : rest[i + 1]; };
if (command === 'auth') await auth(accountName(rest[0]), rest[1]);
else if (command === 'run') {
  const writer = accountName(flag('--write'));
  const readOnly = accountName(flag('--read-only'));
  if (writer !== readOnly) fail('--read-only must name the same synthetic principal as --write.');
  await liveRun({ writer, calendar: flag('--calendar') ?? fail('--calendar is required'), readOnly });
}
else if (command === 'combined') await combined(rest.map(accountName));
else fail('Usage: auth <account> <read|write> | run --write <account> --calendar <id> --read-only <same-account> | combined <account> <different-account>...');
