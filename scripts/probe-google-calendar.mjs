#!/usr/bin/env node
// Developer-only live check of the Google Calendar milestone 1 criteria.
// Synthetic test accounts only. State lives outside the checkout.
//
//   node scripts/probe-google-calendar.mjs auth <account> <read|write>
//   node scripts/probe-google-calendar.mjs run --write <account> --calendar <id> [--read-only <account>]
//   node scripts/probe-google-calendar.mjs combined <account> [<account> ...]
//
// $LUNA_HOME_PROBE_DIR must hold client.json ({"client_id","client_secret"}) for
// an OAuth "Desktop app" client in a test Google Cloud project. Tokens are
// written there as <account>.<read|write>.json (mode 0600).
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCalendarProbe, SCOPES, newEventId } from '../lib/google-calendar-probe.js';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = process.env.LUNA_HOME_PROBE_DIR;
if (!dir || !isAbsolute(dir)) fail('Set LUNA_HOME_PROBE_DIR to an absolute directory outside the checkout.');
const rel = relative(repo, resolve(dir));
if (!rel.startsWith('..') && !isAbsolute(rel)) fail('LUNA_HOME_PROBE_DIR must be outside the checkout.');

function fail(message) { console.error(message); process.exit(2); }
const b64url = buf => buf.toString('base64url');
const tokenFile = (account, kind) => join(dir, `${account}.${kind}.json`);
const accountName = value => (/^[a-z0-9-]{1,40}$/.test(value ?? '') ? value : fail('Account labels are lowercase letters, digits and hyphens.'));
// Accepts the file as Google downloads it ({"installed": {...}}) or flattened.
const clientConfig = async () => {
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
  await mkdir(dir, { recursive: true });
  await writeFile(tokenFile(account, kind), JSON.stringify({ refresh_token: tokens.refresh_token, scope: tokens.scope }), { mode: 0o600 });
  console.log(`Saved ${kind} token for ${account} (granted: ${tokens.scope}).`);
}

function probeFor(account, kind, writableCalendars, audit) {
  let cached;
  const getToken = async () => {
    if (cached && cached.expires > Date.now() + 30_000) return cached.value;
    const { refresh_token } = JSON.parse(await readFile(tokenFile(account, kind), 'utf8'));
    const fresh = await tokenRequest({ refresh_token, grant_type: 'refresh_token' });
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
  }
}
const expectCode = async (code, run) => {
  try { await run(); } catch (error) { if (error.code === code) return code; throw error; }
  throw new Error(`Expected ${code} but the call succeeded`);
};

async function liveRun({ writer, calendar, readOnly }) {
  const audit = [];
  const log = entry => audit.push(entry);
  const write = probeFor(writer, 'write', [calendar], log);
  const stamp = new Date(Date.now() + 7 * 864e5);
  stamp.setUTCHours(15, 0, 0, 0);
  const slot = hours => new Date(stamp.getTime() + hours * 36e5).toISOString();
  const event = { summary: 'Fictional Home probe event', start: { dateTime: slot(0) }, end: { dateTime: slot(1) } };
  const id = newEventId();

  await check('lists calendars with access roles', async () => (await write.listCalendars()).map(c => c.accessRole).join(','));
  await check('create (no attendees, sendUpdates=none)', () => write.createEvent(calendar, event, id).then(e => e.eventId));
  await check('read back created event', async () => (await write.findEvent(calendar, id))?.summary);
  await check('retry with same id creates no duplicate', () => expectCode('HTTP_409', () => write.createEvent(calendar, event, id)));
  await check('update', () => write.updateEvent(calendar, id, { summary: 'Fictional Home probe event (edited)' }).then(e => e.summary));
  await check('unapproved calendar rejects write', () => expectCode('CALENDAR_NOT_APPROVED', () => write.createEvent('primary-not-approved', event)));
  await check('attendees refused', () => expectCode('ATTENDEES_NOT_ALLOWED', () => write.createEvent(calendar, { ...event, attendees: [{ email: 'x@example.test' }] })));
  await check('delete', () => write.deleteEvent(calendar, id));
  await check('deleted event is gone or cancelled', async () => {
    const e = await write.findEvent(calendar, id);
    if (e && e.status !== 'cancelled') throw new Error(`still ${e.status}`);
    return e ? 'cancelled' : 'absent';
  });

  if (readOnly) {
    // Read-only token on the same calendar: provider must refuse, and Home's own
    // approval list does not substitute for the OAuth scope.
    const reader = probeFor(readOnly, 'read', [calendar], log);
    await check('read-only token can list events', async () => (await reader.listEvents(calendar, { timeMin: slot(-24), timeMax: slot(24) })).length + ' events');
    await check('read-only token cannot create', () => expectCode('HTTP_403', () => reader.createEvent(calendar, event)));
  }
  report(audit);
}

async function combined(accounts) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 864e5).toISOString();
  const all = [];
  for (const account of accounts) {
    const probe = probeFor(account, 'read', [], () => {});
    for (const cal of await probe.listCalendars()) {
      all.push(...(await probe.listEvents(cal.id, { timeMin: from, timeMax: to }).catch(() => [])));
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
else if (command === 'run') await liveRun({ writer: accountName(flag('--write')), calendar: flag('--calendar') ?? fail('--calendar is required'), readOnly: flag('--read-only') && accountName(flag('--read-only')) });
else if (command === 'combined') await combined(rest.map(accountName));
else fail('Usage: auth <account> <read|write> | run --write <account> --calendar <id> [--read-only <account>] | combined <account>...');
