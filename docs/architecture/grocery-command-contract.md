# Home grocery command contract v1

This is a Home-owned, versioned command and receipt contract for the #140 GROC-01 slice. GUI and MCP transports must pass the same `groceryCommand` input to one Home-local command service. Commands select a household and list; those fields do not grant access. The server resolves the target against trusted Home state and executes only inside an existing Home session.

`query` maps to the existing Home session `read` action for the list record. `add`, `edit`, `check`, `uncheck`, and `remove` map to the existing `edit` action and carry the list's expected revision. Item removal remains an edit to the list. This contract introduces no grant, audience, device, session, actor, or permission fields in client input. The session supplies the minimal actor attribution in receipts.

Receipts are typed as `applied`, `queried`, `denied`, `conflict`, or `unknown`. Query content is returned only after a separate selected-content disclosure check. A failed write acknowledgement produces `unknown` with `read-before-retry`; the operation is never automatically replayed. Reusing a retained mutation request ID with a different command returns a conflict. Identical mutation IDs share one in-process result after each invocation passes the active session boundary. Repeated spoken wording does not imply the same request ID.

Queries always read through the executor after the current session and disclosure checks, including when a query ID is repeated or a previous read failed. Query IDs and results are not retained in the mutation ledger; `requestCount` counts retained mutation IDs only. Reads remain available when that ledger is full so an uncertain write can still be reconciled. Use a separate query ID from the mutation being reconciled. Readback observes the executor's current state; it does not resolve or replay a cached unknown mutation receipt. Durable outcome reconciliation remains part of #141.

The command service remains a contract/adapter port, not a product route. Its `withSessionAuthority` adapter must keep the approved Home session active for the whole callback, recheck expiry/revocation at execution time, and resolve household/list ownership from trusted state. Assistant identity is derived from the validated server actor; if the adapter also supplies an `assistant` boolean, it must agree with `actor.kind`. Assistant queries require `selectedContentDisclosed: true`, and the adapter may set that signal only after approval for the actual grocery fields being returned.

`lib/grocery-persistence.js` stores a tagged grocery payload in the existing versioned encrypted-store record. The list and up to 512 successful mutation outcomes share one payload and one compare-and-swap commit. Each outcome retains the request fingerprint and applied receipt; same-ID retries after process restart return the stored receipt, while changed commands or actors receive `REQUEST_ID_REUSED`. If an acknowledgement is lost, the adapter reads the record once to reconcile; it never replays the mutation. The existing 262144-byte encrypted-store ceiling still applies, so the adapter returns a generic unknown/failure when the payload cannot be committed. Profile sessions reject grocery payloads, preserving the separate profile-record contract.

This is still a storage adapter contract and synthetic fixture implementation, not a production Home storage integration. The Windows DPAPI adapter is explicitly developer-only. #142 owns shared GUI/MCP delivery. The work does not establish production key management, device behavior, or #141/#142 acceptance.

## Shared list transitions

`lib/grocery-list.js` provides `applyGroceryMutation(current, command, actor, nextRevision)` for storage adapters. The adapter must supply `nextRevision`; the transition has no implicit revision generator. It prepares a validated, independent candidate for add/edit/check/uncheck/remove without changing the input list. Optional quantity/unit/notes fields can be cleared with `null`; item IDs cannot be edited. `MAX_GROCERY_ITEMS` in `lib/grocery-contract.js` defines the 500-item bound used by both the list schema and transition. Duplicate item IDs and stale revisions throw `GroceryConflictError` (`code: CONFLICT`), absent targets return `NOT_FOUND`, and additions to a list at or above the item bound return `BUSY`. Every accepted mutation, including checking an already checked item, gets a fresh revision. Labels and notes remain literal data.

The transition can throw the following errors. Consumers should branch on `code`, since failures share a generic message.

| Code | Condition |
| --- | --- |
| `INVALID` | The command is malformed or is a `query` (queries are not mutations); `nextRevision` is missing, invalid, or unchanged; an edit contains an invalid value; or the candidate fails list validation. |
| `READ_FAILED` | The stored list fails schema validation before mutation. |
| `NOT_FOUND` | The command's household/list does not match the stored list, or the requested item is absent. |
| `BUSY` | An add is attempted when the list already has `MAX_GROCERY_ITEMS` items. |
| `CONFLICT` (`GroceryConflictError`) | The expected revision is stale, or an add uses an item ID already present in the list. |

This function performs no authorization, I/O, persistence, event publication, or request deduplication. The actor must come from the live session, never command input. A storage adapter must read the authoritative list and atomically commit the candidate and durable request outcome under its revision lock. It must not treat the returned candidate as an applied receipt or run a read/prepare/write sequence outside that lock. Keep unknown outcomes unknown until authoritative readback; do not blindly replay the mutation. The existing command service supplies process-local request deduplication only.

`test/grocery-list.test.js` exercises the complete edit sequence, unchanged inputs on rejection, capacity, optional-field clearing, attribution, and integration with command receipts using a synthetic commit boundary. These tests establish transition behavior, not encrypted storage, crash recovery, GUI/MCP routes, physical device behavior, or acceptance of #141/#142.

No private household data, real device, production service, enterprise runtime, provider connection, grant issuance, deployment, purchase, or rights approval is involved. Labels are not security boundaries, and this contract does not introduce restricted member access.
