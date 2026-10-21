// Developer-only Google Calendar feasibility client for milestone 1. Synthetic
// test accounts only. It is not the production calendar service: no storage,
// no GUI/MCP wiring, no refresh scheduling.
import { randomBytes } from 'node:crypto';

const API = 'https://www.googleapis.com/calendar/v3';
const WRITER_ROLES = new Set(['owner', 'writer', 'writerWithoutPrivateAccess']);
export const SCOPES = Object.freeze({
  read: 'https://www.googleapis.com/auth/calendar.readonly',
  // CalendarList.get/list require a separate scope for the role preflight.
  write: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
});

export function requireGrantedScopes(kind, granted) {
  const required = SCOPES[kind]?.split(' ') ?? [];
  const received = new Set(typeof granted === 'string' ? granted.split(/\s+/) : []);
  if (!required.length || required.some(scope => !received.has(scope))) {
    throw new CalendarProbeError('INCOMPLETE_OAUTH_GRANT');
  }
}

export function primaryCalendarId(calendars) {
  const primary = calendars.filter(calendar => calendar.primary);
  if (primary.length !== 1 || !primary[0].id) throw new CalendarProbeError('PRIMARY_CALENDAR_UNAVAILABLE');
  return primary[0].id;
}

export class CalendarProbeError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    Object.assign(this, detail);
  }
}

// Google accepts a caller-chosen event ID (base32hex, 5-1024 chars). Reusing it
// makes a retried create fail with 409 instead of duplicating the event.
export function newEventId() {
  return randomBytes(16).toString('hex'); // hex is a subset of base32hex
}

// Provider, account, calendar, event and recurrence-instance identity.
export function normalizeEvent(account, calendarId, event) {
  return {
    provider: 'google',
    account,
    calendarId,
    eventId: event.id,
    recurringEventId: event.recurringEventId ?? null,
    originalStart: event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? null,
    iCalUID: event.iCalUID ?? null,
    allDay: Boolean(event.start?.date),
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    timeZone: event.start?.timeZone ?? null,
    status: event.status ?? null,
    hasAttendees: Array.isArray(event.attendees) && event.attendees.length > 0,
    summary: event.summary ?? '',
  };
}

// An invitation copy and the organizer's copy share iCalUID but differ in
// calendar, so identity is never collapsed across owners.
export const identityKey = e =>
  [e.provider, e.account, e.calendarId, e.eventId].map(encodeURIComponent).join('/');

export function dedupe(events) {
  const seen = new Map();
  for (const e of events) seen.set(identityKey(e), e);
  return [...seen.values()];
}

export async function verifyReadOnlyWriteDenied({ reader, writer, calendarId, event, eventId }) {
  let uncertain = false;
  try {
    await reader.createEvent(calendarId, event, eventId);
  } catch (error) {
    if (error.code === 'HTTP_403' && error.reason === 'insufficientPermissions') {
      return 'HTTP_403:insufficientPermissions';
    }
    if (error.code !== 'UNKNOWN_OUTCOME') throw error;
    uncertain = true;
  }
  try {
    // A successful create must be deleted even if a follow-up read lags behind.
    // For a failed request with an unknown outcome, read before deciding to delete.
    if (uncertain) {
      const found = await writer.findEvent(calendarId, eventId);
      if (!found || found.status === 'cancelled') throw new Error('Unknown create outcome could not be reconciled');
    }
    await writer.deleteEvent(calendarId, eventId);
    const remaining = await writer.findEvent(calendarId, eventId);
    if (remaining && remaining.status !== 'cancelled') throw new Error('Event remained after cleanup');
  } catch (cause) {
    throw new CalendarProbeError('READ_ONLY_CLEANUP_UNCONFIRMED', { cause });
  }
  throw new CalendarProbeError('READ_ONLY_WRITE_NOT_DENIED');
}

// Local audit entry: target and outcome only, never titles or descriptions.
export function auditEntry({ action, account, calendarId, eventId, scopeKind, outcome, now = new Date() }) {
  return { at: now.toISOString(), action, account, calendarId, eventId: eventId ?? null, scopeKind, outcome };
}

/**
 * @param {object} options
 * @param {string} options.account  label of the synthetic account
 * @param {string} options.scopeKind  'read' or 'write', the OAuth scope the token holds
 * @param {() => Promise<string>} options.getToken
 * @param {Set<string>|string[]} [options.writableCalendars]  Home-side approval list
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(entry: object) => void} [options.audit]
 */
export function createCalendarProbe({
  account, scopeKind, getToken, writableCalendars = [], fetchImpl = fetch, audit = () => {},
}) {
  const approved = new Set(writableCalendars);
  const encoded = id => encodeURIComponent(id);

  async function call(method, path, { query = {}, body, signal, onRequestStart } = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
    const serializedBody = body ? JSON.stringify(body) : undefined;
    let response;
    const token = await getToken();
    const request = {
      method,
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: serializedBody,
    };
    try {
      onRequestStart?.();
      response = await fetchImpl(url, request);
    } catch {
      throw new CalendarProbeError('UNKNOWN_OUTCOME');
    }
    if (response.status === 204) return null;
    let json;
    try {
      json = await response.json();
    } catch {
      if (response.ok) throw new CalendarProbeError('UNKNOWN_OUTCOME');
      json = {};
    }
    if (!response.ok) {
      throw new CalendarProbeError(`HTTP_${response.status}`, {
        status: response.status, reason: json?.error?.errors?.[0]?.reason ?? null,
      });
    }
    return json;
  }

  async function canonicalCalendarId(calendarId) {
    if (calendarId !== 'primary') return calendarId;
    const entry = await call('GET', '/users/me/calendarList/primary');
    if (!entry?.id) throw new CalendarProbeError('CALENDAR_ID_UNAVAILABLE');
    return entry.id;
  }

  async function writableTarget(calendarId) {
    if (!approved.has(calendarId)) throw new CalendarProbeError('CALENDAR_NOT_APPROVED');
    const entry = await call('GET', `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
    if (!WRITER_ROLES.has(entry.accessRole)) throw new CalendarProbeError('CALENDAR_READ_ONLY');
    if (calendarId === 'primary' && !entry.id) throw new CalendarProbeError('CALENDAR_ID_UNAVAILABLE');
    return calendarId === 'primary' ? entry.id : calendarId;
  }

  async function write(action, calendarId, eventId, run, validate = () => {}) {
    const base = { action, account, calendarId, eventId, scopeKind };
    let requestStarted = false;
    try {
      validate();
      // Checked before the request so a rejected write never reaches the provider.
      const targetId = await writableTarget(calendarId);
      base.calendarId = targetId;
      const result = await run(targetId, () => { requestStarted = true; });
      audit(auditEntry({ ...base, outcome: 'confirmed' }));
      return result;
    } catch (error) {
      const outcome = !requestStarted && (error.code === 'UNKNOWN_OUTCOME' || !error.code || error.status >= 500)
        ? 'failed:preflight'
        : requestStarted && (error.code === 'UNKNOWN_OUTCOME' || error.status >= 500 || !error.code) ? 'unknown'
        : error.code === 'HTTP_409' && error.reason === 'duplicate' ? 'already-exists'
          : `denied:${error.code ?? 'ERROR'}`;
      error.mutationOutcome = outcome;
      audit(auditEntry({ ...base, outcome }));
      throw error;
    }
  }

  const forbidAttendees = body => {
    if (body && ('attendees' in body || 'conferenceData' in body)) {
      throw new CalendarProbeError('ATTENDEES_NOT_ALLOWED');
    }
  };

  return {
    async listCalendars() {
      const out = [];
      let pageToken;
      do {
        const page = await call('GET', '/users/me/calendarList', { query: { pageToken, showHidden: 'true' } });
        out.push(...(page.items ?? []).map(c => ({ id: c.id, accessRole: c.accessRole, primary: Boolean(c.primary) })));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },

    // Expands recurrence into instances so single-occurrence identity is visible.
    async listEvents(calendarId, { timeMin, timeMax }) {
      calendarId = await canonicalCalendarId(calendarId);
      const out = [];
      let pageToken;
      do {
        const page = await call('GET', `/calendars/${encoded(calendarId)}/events`, {
          query: { timeMin, timeMax, singleEvents: 'true', maxResults: '250', pageToken },
        });
        out.push(...(page.items ?? []).map(e => normalizeEvent(account, calendarId, e)));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return dedupe(out);
    },

    async createEvent(calendarId, event, eventId = newEventId()) {
      return write('create', calendarId, eventId, (targetId, onRequestStart) =>
        call('POST', `/calendars/${encoded(targetId)}/events`, {
          query: { sendUpdates: 'none' }, body: { ...event, id: eventId }, onRequestStart,
        }).then(e => normalizeEvent(account, targetId, e)), () => forbidAttendees(event));
    },

    // Passing a recurring instance's own eventId edits one occurrence; passing the
    // series ID edits the whole series. The caller must say which it means.
    async updateEvent(calendarId, eventId, patch) {
      return write('update', calendarId, eventId, (targetId, onRequestStart) =>
        call('PATCH', `/calendars/${encoded(targetId)}/events/${encoded(eventId)}`, {
          query: { sendUpdates: 'none' }, body: patch, onRequestStart,
        }).then(e => normalizeEvent(account, targetId, e)), () => forbidAttendees(patch));
    },

    async deleteEvent(calendarId, eventId) {
      return write('delete', calendarId, eventId, (targetId, onRequestStart) =>
        call('DELETE', `/calendars/${encoded(targetId)}/events/${encoded(eventId)}`, {
          query: { sendUpdates: 'none' }, onRequestStart,
        }));
    },

    // Reconcile after an unknown outcome: read provider state before any retry.
    async findEvent(calendarId, eventId) {
      const requestedId = calendarId;
      calendarId = await canonicalCalendarId(calendarId);
      try {
        return normalizeEvent(account, calendarId,
          await call('GET', `/calendars/${encoded(calendarId)}/events/${encoded(eventId)}`));
      } catch (error) {
        if (error.code === 'HTTP_404' || (error.code === 'HTTP_410' && error.reason === 'deleted')) {
          // An inaccessible calendar can also return 404. Confirm that this
          // approved calendar is still writable before claiming observed absence.
          await writableTarget(requestedId);
          return null;
        }
        throw error;
      }
    },
  };
}
