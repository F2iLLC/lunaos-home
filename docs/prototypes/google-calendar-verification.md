# Google Calendar feasibility check (milestone 1)

This is a developer-only probe of the [milestone 1](../../ROADMAP.md#1-verify-a-useful-supported-combination) calendar criteria for Google Calendar, the proposed first provider. It uses synthetic Google test accounts and fictional events. It is not the production calendar service: nothing is stored, and it is not connected to the GUI or MCP tools. A live result below counts only after someone runs it and records the outcome; **no result has been recorded yet**.

## Setup

1. In a test Google Cloud project, create an OAuth client of type **Desktop app** and enable the Google Calendar API. Use only synthetic accounts (at least two, each with one writable test calendar).
2. Keep state outside this checkout. The script refuses a directory inside it:

   ```bash
   export LUNA_HOME_PROBE_DIR=/absolute/path/outside/the/checkout
   # client.json: the OAuth client file exactly as Google downloads it
   ```
3. Sign each account in once per scope. The sign-in uses a loopback redirect with PKCE and prints a URL to open:

   ```bash
   node scripts/probe-google-calendar.mjs auth alex-test write
   node scripts/probe-google-calendar.mjs auth sam-test read
   ```
4. Run the checks:

   ```bash
   node scripts/probe-google-calendar.mjs run --write alex-test --calendar <writable-calendar-id> --read-only sam-test
   node scripts/probe-google-calendar.mjs combined alex-test sam-test
   ```

`npm test` covers the request rules offline with a fake HTTP layer. It does not contact Google.

## Criteria and how each is checked

| Roadmap criterion | Check | Live result |
| --- | --- | --- |
| Read multiple authorized test accounts | `combined` lists every calendar of each account and counts unique identities | Untested |
| Preserve provider, account, calendar, event ID and recurrence-instance identity | `normalizeEvent` keeps all of them; unit-tested | Offline pass; live untested |
| Repeated refresh does not duplicate; invitations not merged across owners | Identity key includes account and calendar; unit-tested | Offline pass; live untested |
| Pagination | Listing follows `nextPageToken`; unit-tested | Offline pass; live untested |
| Scoped create, update, delete without attendee notifications | Requests send `sendUpdates=none`; attendees and conference data are refused before any request | Offline pass; live untested |
| Read access alone does not grant write authority | A token with only the `calendar.readonly` scope attempts a create; the provider must answer 403 | Untested |
| Read-only calendars and unapproved calendars reject writes | Home-side approval list plus the calendar's `accessRole` are checked before the write request | Offline pass; live untested |
| Retries without duplicates; ambiguous timeout | The caller-chosen event ID makes a repeated create fail with 409; after an unknown outcome the event is read back before any retry | Offline pass; live untested |
| Minimal local audit | Entries hold time, action, account, calendar, event ID, scope and outcome, never titles or descriptions | Offline pass |

## Not yet covered

- **Time zones, all-day and recurring events, expired authorization, disconnected sources, stale or offline freshness.** The normalizer carries time zone and all-day fields, but the live run does not create recurring series. Single-occurrence versus whole-series edits (pass an instance ID or the series ID) need a live recurring fixture.
- **Concurrent edits.** Not exercised.
- **Per-calendar OAuth scopes.** Google scopes apply to the whole account, so "scoped" writes rest on Home's own approval list plus the calendar's role. The OAuth scope separates read from write, but not one calendar from another. This is a finding for the owner to weigh when approving the provider.
- **Delegated create, update and delete through each supported assistant client.** This needs the MCP tools, which do not exist for calendars yet.
- **Provider verification and quotas.** Using a calendar scope in a distributed app may require Google's app verification. The check was not performed here.

Re-check the Google API behavior against current documentation before relying on any of this.
