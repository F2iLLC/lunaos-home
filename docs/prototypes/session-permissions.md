# Session permission service experiment

This bounded [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) increment implements a process-local enforcement contract in `lib/vault-sessions.js`. It is exercised with a synthetic in-memory storage adapter. It is not connected to the current GUI, MCP server, DPAPI probe or Android app, and it is not a usable vault.

## Controller and connection boundary

`createVaultSessionService({ store })` returns a privileged controller. A future trusted local approval/transport adapter must retain that controller and authenticate a device before calling `openConnection`. It must bind `destination` to the actual assistant transport, not a caller-supplied claim. No controller method may become a remote tool or public endpoint. A connection exposes only `execute(grantId, request)` and `close()`.

The controller records admitted device identifiers, issues connection-bound grants and removes them on disconnect, device removal or shutdown. Fresh service instances have no prior devices, connections or grants. This is tested process-local admission bookkeeping; it does **not** prove device identity, secure pairing, family authentication or OS unlock. Anyone able to call the controller or underlying storage directly is outside this boundary. The production native service must enforce those privileges rather than trusting a model or WebView to declare them.

Local and assistant connections share the same queue, authorization checks and storage adapter. Member identifiers organize records; they do not establish separate family security compartments. The experiment handles only bounded profile-detail objects (`memberId`, `label`, `value`), not typed Sign-ins, documents, attachments or arbitrary object graphs. Do not feed real records to this experiment or infer secret classification from its schema.

## Grants and disclosure

| Controller action | Enforced scope |
| --- | --- |
| `approveSetup` | Read/create/edit for an explicit set of at most 64 record IDs, on one connection, for up to 15 minutes. No delete. |
| `approveReadOnly` | Read only for the same bounded record/time scope; create/edit/delete denied. |
| `approveDisclosure` | Separate permission to return selected fields of selected records to the connection's named assistant destination. Must fit within the operation grant and expires no later than it. |
| `revokeGrant` / `revokeDisclosure` | Stops further use of that grant/disclosure, including queued operations and pending read responses. |
| `removeDevice` / connection `close` / `shutdown` | Invalidates the relevant connections and grants; readmission/reconnect requires new grants. |

Approvals use copied scopes, generated IDs and a monotonic in-process clock. Backward/nonfinite clock readings fail closed. Session/grant data is never persisted, so no write authority survives restarting the service. Host-sleep clock behavior still needs measurement on the actual native targets. These controller calls are the enforcement side of future consent screens; they do not demonstrate user consent UI.

Every request is checked when submitted and again when it reaches storage. Inputs are copied before queuing. A read is checked once more before returning its value, so expiry or revocation during the adapter read withholds the result. Assistant reads require disclosure before storage is accessed and return only approved fields. Writes return a bounded receipt, never record contents or arbitrary adapter results. Grant IDs and record IDs must remain opaque identifiers, not encoded personal values.

## In-flight work and unknown outcomes

Revocation prevents subsequent and queued work. It cannot roll back a write already handed to an asynchronous storage adapter. If that adapter confirms the write, the receipt reports `applied` and whether access ended while it was running. A future transactional native adapter must define its exact commit/authorization boundary. Do not claim this experiment prevents an already-started write from committing after revocation.

If a write throws, its outcome may be unknown. The service hides adapter diagnostics, invalidates the connection and its grants, and returns `WRITE_UNKNOWN`. It never retries. Reconnect needs a fresh approval; the future local workflow must inspect the record and resolve the unknown outcome before offering a retry. Cross-client revision conflicts, durable operation IDs and recovery UI are not implemented by this experiment.

## Reproduce and observed checks

```sh
node --test test/vault-sessions.test.js
npm test
```

The synthetic tests exercise denied unadmitted connections, grant theft across connections, read-only mutation denial, setup create/edit without delete, family-member access through selected record scopes, and local/assistant connections using one service and adapter. They hold a storage operation pending while expiring/revoking grants, closing connections, removing a device or shutting down; the queued writes never reach storage and the late read values are withheld. Reconnect/readmission and a fresh service cannot revive old grants.

Disclosure tests distinguish write permission from read/export permission, destination and record scope, selected fields, caller mutation of approval objects and expiry during a read. Mutation tests preserve an enqueued request despite later caller changes, report a confirmed in-flight write truthfully, and simulate an applied write whose acknowledgement is lost: one write occurs, the queued retry is denied and no private adapter message is exposed.

This adds no dependencies, listeners, tool registrations, OS permissions or data files. Actual GUI/MCP integration, encrypted storage, OS unlock, authenticated device transport, Android lifecycle, production audit/recovery and independent security acceptance remain open. The [Windows DPAPI experiment](windows-storage.md) is separate evidence, not an adapter integrated by these tests. Actions remains disabled.
