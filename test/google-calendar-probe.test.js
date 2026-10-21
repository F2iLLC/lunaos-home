import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarProbe, normalizeEvent, dedupe, newEventId, CalendarProbeError, SCOPES, requireGrantedScopes, primaryCalendarId, verifyReadOnlyWriteDenied } from '../lib/google-calendar-probe.js';

const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status });
function harness(routes, options = {}) {
  const requests = [];
  const audit = [];
  const fetchImpl = async (url, init) => {
    requests.push({ method: init.method, path: url.pathname.replace('/calendar/v3', ''), query: Object.fromEntries(url.searchParams), body: init.body && JSON.parse(init.body) });
    const route = routes[`${init.method} ${url.pathname.replace('/calendar/v3', '')}`];
    if (!route) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
    return typeof route === 'function' ? route() : route.clone();
  };
  const probe = createCalendarProbe({
    account: 'alex-test', scopeKind: 'write', getToken: async () => 'synthetic-token',
    writableCalendars: ['work@example.test'], fetchImpl, audit: e => audit.push(e), ...options,
  });
  return { probe, requests, audit };
}
const listEntry = role => json(200, { accessRole: role });
const created = json(200, { id: 'abc12', summary: 'Fictional event', start: { dateTime: '2026-11-02T10:00:00-06:00' }, end: { dateTime: '2026-11-02T11:00:00-06:00' } });

test('event ids are valid base32hex and unique', () => {
  const a = newEventId();
  assert.match(a, /^[0-9a-v]{5,1024}$/);
  assert.notEqual(a, newEventId());
});

test('write authorization includes calendar-list access for the role preflight', () => {
  assert.match(SCOPES.write, /calendar\.events/);
  assert.match(SCOPES.write, /calendar\.calendarlist\.readonly/);
});

test('partial or missing OAuth grants cannot replace a usable token', () => {
  assert.doesNotThrow(() => requireGrantedScopes('write', SCOPES.write));
  assert.throws(() => requireGrantedScopes('write', SCOPES.read), { code: 'INCOMPLETE_OAUTH_GRANT' });
  assert.throws(() => requireGrantedScopes('write', undefined), { code: 'INCOMPLETE_OAUTH_GRANT' });
});

test('combined checks identify the Google principal from its primary calendar', () => {
  assert.equal(primaryCalendarId([{ id: 'synthetic@example.test', primary: true }]), 'synthetic@example.test');
  assert.throws(() => primaryCalendarId([]), { code: 'PRIMARY_CALENDAR_UNAVAILABLE' });
});

test('writes never request attendee notifications and carry the caller event id', async () => {
  const { probe, requests } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
    'POST /calendars/work%40example.test/events': created,
  });
  await probe.createEvent('work@example.test', { summary: 'Fictional event' }, 'abc12');
  const post = requests.find(r => r.method === 'POST');
  assert.equal(post.query.sendUpdates, 'none');
  assert.equal(post.body.id, 'abc12');
});

test('attendees and conference data are refused and audited before any request', async () => {
  const { probe, requests, audit } = harness({});
  await assert.rejects(probe.createEvent('work@example.test', { attendees: [{ email: 'sam@example.test' }] }), { code: 'ATTENDEES_NOT_ALLOWED' });
  await assert.rejects(probe.updateEvent('work@example.test', 'abc12', { conferenceData: {} }), { code: 'ATTENDEES_NOT_ALLOWED' });
  assert.equal(requests.length, 0);
  assert.deepEqual(audit.map(a => a.outcome), ['denied:ATTENDEES_NOT_ALLOWED', 'denied:ATTENDEES_NOT_ALLOWED']);
});

test('unapproved and read-only calendars reject writes without a write request', async () => {
  const { probe, requests, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('reader'),
  });
  await assert.rejects(probe.deleteEvent('other@example.test', 'abc12'), { code: 'CALENDAR_NOT_APPROVED' });
  await assert.rejects(probe.deleteEvent('work@example.test', 'abc12'), { code: 'CALENDAR_READ_ONLY' });
  assert.deepEqual(requests.map(r => r.method), ['GET']);
  assert.deepEqual(audit.map(a => a.outcome), ['denied:CALENDAR_NOT_APPROVED', 'denied:CALENDAR_READ_ONLY']);
});

test('a read-only token is rejected by the provider and audited as denied', async () => {
  const { probe, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
    'POST /calendars/work%40example.test/events': json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }),
  }, { scopeKind: 'read' });
  await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }), { code: 'HTTP_403' });
  assert.equal(audit[0].outcome, 'denied:HTTP_403');
  assert.equal(audit[0].scopeKind, 'read');
});

test('a network failure is an unknown outcome and a retry with the same id hits 409, not a duplicate', async () => {
  let attempt = 0;
  const { probe, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('writer'),
    'POST /calendars/work%40example.test/events': () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('socket closed');
      return json(409, { error: { errors: [{ reason: 'duplicate' }] } });
    },
    'GET /calendars/work%40example.test/events/abc12': created,
  });
  await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }, 'abc12'), { code: 'UNKNOWN_OUTCOME' });
  assert.equal((await probe.findEvent('work@example.test', 'abc12')).eventId, 'abc12');
  await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }, 'abc12'), { code: 'HTTP_409' });
  assert.deepEqual(audit.map(a => a.outcome), ['unknown', 'already-exists']);
});

test('preflight network failure cannot suggest an ambiguous mutation', async () => {
  const { probe, requests, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': () => { throw new TypeError('socket closed'); },
  });
  await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }), { code: 'UNKNOWN_OUTCOME' });
  assert.deepEqual(requests.map(r => r.method), ['GET']);
  assert.equal(audit[0].outcome, 'failed:preflight');
});

test('serialization failure is a preflight failure before any mutation request', async () => {
  const { probe, requests, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
  });
  await assert.rejects(probe.createEvent('work@example.test', { summary: 1n }));
  const circular = {};
  circular.self = circular;
  await assert.rejects(probe.updateEvent('work@example.test', 'abc12', circular));
  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET']);
  assert.deepEqual(audit.map(entry => entry.outcome), ['failed:preflight', 'failed:preflight']);
});

test('started server failures and unreadable success bodies are unknown writes', async () => {
  for (const response of [
    json(500, { error: { errors: [{ reason: 'backendError' }] } }),
    new Response('not-json', { status: 200 }),
  ]) {
    const { probe, audit } = harness({
      'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
      'POST /calendars/work%40example.test/events': response,
    });
    await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }));
    assert.equal(audit[0].outcome, 'unknown');
  }
});

test('mutation token failure before fetch is not an unknown write', async () => {
  let tokens = 0;
  const { probe, requests, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
  }, { getToken: async () => {
    if (++tokens === 2) throw new Error('synthetic refresh failed');
    return 'synthetic-token';
  } });
  await assert.rejects(probe.createEvent('work@example.test', { summary: 'x' }), /synthetic refresh failed/);
  assert.deepEqual(requests.map(r => r.method), ['GET']);
  assert.equal(audit[0].outcome, 'failed:preflight');
});

test('restricted writer can write a non-private synthetic event', async () => {
  const { probe, requests } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('writerWithoutPrivateAccess'),
    'POST /calendars/work%40example.test/events': created,
  });
  await probe.createEvent('work@example.test', { summary: 'Fictional event' });
  assert.equal(requests.at(-1).method, 'POST');
});

test('missing event collection is empty, while failed reads propagate', async () => {
  const { probe } = harness({
    'GET /users/me/calendarList': json(200, {}),
    'GET /calendars/work%40example.test/events': json(200, {}),
  });
  assert.deepEqual(await probe.listCalendars(), []);
  assert.deepEqual(await probe.listEvents('work@example.test', { timeMin: 'a', timeMax: 'b' }), []);
  const denied = harness({
    'GET /calendars/work%40example.test/events': json(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }),
  });
  await assert.rejects(denied.probe.listEvents('work@example.test', { timeMin: 'a', timeMax: 'b' }), { code: 'HTTP_403', reason: 'rateLimitExceeded' });
});

test('calendar listing requests hidden calendars', async () => {
  const { probe, requests } = harness({ 'GET /users/me/calendarList': json(200, { items: [{ id: 'hidden@example.test' }] }) });
  assert.equal((await probe.listCalendars()).length, 1);
  assert.equal(requests[0].query.showHidden, 'true');
});

test('primary alias uses the canonical calendar ID for reads, writes and audit', async () => {
  const { probe, requests, audit } = harness({
    'GET /users/me/calendarList/primary': json(200, { id: 'owner@example.test', primary: true, accessRole: 'owner' }),
    'GET /calendars/owner%40example.test/events': json(200, { items: [{ id: 'abc12' }] }),
    'POST /calendars/owner%40example.test/events': created,
  }, { writableCalendars: ['primary'] });
  const listed = await probe.listEvents('primary', { timeMin: 'a', timeMax: 'b' });
  const written = await probe.createEvent('primary', { summary: 'Fictional event' }, 'abc12');
  assert.equal(listed[0].calendarId, 'owner@example.test');
  assert.equal(written.calendarId, 'owner@example.test');
  assert.equal(audit[0].calendarId, 'owner@example.test');
  assert.equal(requests.some(request => request.path === '/calendars/primary/events'), false);
});

test('an unexpectedly successful read-token write is deleted and checked', async () => {
  const actions = [];
  const eventId = 'abc12';
  const writer = {
    async findEvent(_calendar, id) { actions.push(`find:${id}`); return null; },
    async deleteEvent(_calendar, id) { actions.push(`delete:${id}`); },
  };
  const reader = { async createEvent(_calendar, _event, id) { actions.push(`create:${id}`); return { eventId: id }; } };
  await assert.rejects(verifyReadOnlyWriteDenied({ reader, writer, calendarId: 'work@example.test', event: {}, eventId }), { code: 'READ_ONLY_WRITE_NOT_DENIED' });
  assert.deepEqual(actions, ['create:abc12', 'delete:abc12', 'find:abc12']);
});

test('failed cleanup leaves an explicit unresolved result', async () => {
  const reader = { async createEvent() { return { eventId: 'abc12' }; } };
  const writer = { async findEvent() { return { status: 'confirmed' }; }, async deleteEvent() { throw new Error('offline'); } };
  await assert.rejects(verifyReadOnlyWriteDenied({ reader, writer, calendarId: 'work@example.test', event: {}, eventId: 'abc12' }), { code: 'READ_ONLY_CLEANUP_UNCONFIRMED' });
});

test('event 404 is absent only while its calendar remains accessible', async () => {
  const accessible = harness({
    'GET /calendars/work%40example.test/events/abc12': json(404, { error: { errors: [{ reason: 'notFound' }] } }),
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
  });
  assert.equal(await accessible.probe.findEvent('work@example.test', 'abc12'), null);
  const inaccessible = harness({
    'GET /calendars/work%40example.test/events/abc12': json(404, { error: { errors: [{ reason: 'notFound' }] } }),
  });
  await assert.rejects(inaccessible.probe.findEvent('work@example.test', 'abc12'), { code: 'HTTP_404' });
  const downgraded = harness({
    'GET /calendars/work%40example.test/events/abc12': json(404, { error: { errors: [{ reason: 'notFound' }] } }),
    'GET /users/me/calendarList/work%40example.test': listEntry('reader'),
  });
  await assert.rejects(downgraded.probe.findEvent('work@example.test', 'abc12'), { code: 'CALENDAR_READ_ONLY' });
});

test('audit entries hold targets and outcomes, never event content', async () => {
  const { probe, audit } = harness({
    'GET /users/me/calendarList/work%40example.test': listEntry('owner'),
    'POST /calendars/work%40example.test/events': created,
  });
  await probe.createEvent('work@example.test', { summary: 'Secret fictional title', description: 'Secret body' }, 'abc12');
  assert.doesNotMatch(JSON.stringify(audit), /Secret/);
});

test('listing follows pagination and does not duplicate repeated refreshes', async () => {
  const pages = [
    json(200, { items: [{ id: 'e1', start: { dateTime: '2026-11-02T10:00:00Z' } }], nextPageToken: 'p2' }),
    json(200, { items: [{ id: 'e1', start: { dateTime: '2026-11-02T10:00:00Z' } }, { id: 'e2', start: { date: '2026-11-03' } }] }),
  ];
  const { probe } = harness({ 'GET /calendars/work%40example.test/events': () => pages.shift() });
  const events = await probe.listEvents('work@example.test', { timeMin: 'a', timeMax: 'b' });
  assert.deepEqual(events.map(e => e.eventId), ['e1', 'e2']);
  assert.equal(events[1].allDay, true);
});

test('normalized events keep recurrence-instance identity and separate owners stay separate', () => {
  const instance = { id: 'series_20261102', recurringEventId: 'series', originalStartTime: { dateTime: '2026-11-02T10:00:00Z' }, iCalUID: 'u@x', start: { dateTime: '2026-11-02T10:00:00Z', timeZone: 'America/Chicago' } };
  const a = normalizeEvent('alex-test', 'work@example.test', instance);
  const b = normalizeEvent('sam-test', 'school@example.test', instance);
  assert.equal(a.recurringEventId, 'series');
  assert.equal(a.timeZone, 'America/Chicago');
  assert.equal(dedupe([a, b, a]).length, 2);
});

test('CalendarProbeError carries its code', () => {
  assert.equal(new CalendarProbeError('X', { status: 1 }).status, 1);
});
