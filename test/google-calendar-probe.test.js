import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarProbe, normalizeEvent, dedupe, newEventId, CalendarProbeError } from '../lib/google-calendar-probe.js';

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

test('attendees and conference data are refused before any request', async () => {
  const { probe, requests } = harness({});
  await assert.rejects(probe.createEvent('work@example.test', { attendees: [{ email: 'sam@example.test' }] }), { code: 'ATTENDEES_NOT_ALLOWED' });
  await assert.rejects(probe.updateEvent('work@example.test', 'abc12', { conferenceData: {} }), { code: 'ATTENDEES_NOT_ALLOWED' });
  assert.equal(requests.length, 0);
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
