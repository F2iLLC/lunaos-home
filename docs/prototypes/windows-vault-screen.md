# Windows example screen with encrypted persistence

This developer-only slice of [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) lets the Home browser interface approve and exercise fixed fictional records through the existing session service and Windows DPAPI adapter. It is a browser screen on Windows, not a newly tested packaged Windows application. Ordinary `npm start`, the existing draft-review flow, MCP tools and the Android app remain unchanged.

## Run and review

On Windows with Node 24+ and trusted installed PowerShell 7:

```powershell
node scripts/windows-vault-preview.mjs
```

Open the printed local link. The process listens only on loopback with an assigned port. The random per-process capability travels in the URL fragment, is removed from the current history entry, remains only in page memory and accompanies same-origin API requests in a header. Do not publish the link. Reloading requires reopening the original link; the page does not retain the capability in browser storage. A new process issues a new capability. This is developer access to fixed examples, not OS authentication, device enrollment, family membership verification or protection against another process under the same Windows account.

1. Select **Allow adding and changing**. The screen states the two example records, one-minute duration and no assistant sharing.
2. Select Alex and **Add example**, then **Change example** and **View saved example**. The saved workplace changes from Willow Studio to Willow Workshop.
3. Select Sam and **Add example**, then **View saved example**. The school is Meadow School. Changing it uses the fixed alternative Meadow Academy.
4. Select **Allow viewing** and try **Change example**. The service rejects the mutation. New approval replaces the earlier grant; read-only mode cannot inherit setup access.
5. Select **End access**, or let one minute pass. Displayed details clear. New operations require approval again. The service independently checks expiry before execution and after reads, and rejects queued operations after access ends. An already committed write is not represented as rolled back.
6. Stop the process, then use its printed `--resume` command with the same example ID. The encrypted examples remain, but approvals do not. Approve viewing again to read them. No record values, grant IDs or keys appear in the resume command.

The launcher creates an empty encrypted store under the adapter's application-specific local directory. It accepts only an example UUID to resume; it accepts no arbitrary path, record content, executable location from HTTP, assistant destination or disclosure request. Stopping/closing does not delete the example. The developer may remove only that identified test store through the adapter's `removeSyntheticStore()` method after stopping its preview. Automated probes below perform their own bounded cleanup; there is no general filesystem deletion endpoint.

## Enforced boundary

`lib/windows-preview.js` owns a process-local connection and approval controller. HTTP callers can request only the fixed two-record setup or read-only grant, end their current grant, or read/create/edit a known example. Unknown fields, arbitrary data, record IDs, deletion and destination/disclosure parameters are rejected. Approvals return no file paths or storage objects. Nothing registers with or calls a hosted assistant.

`server.js` enables the screen and its API only when explicitly supplied the preview controller. Default servers return 404. Existing host, origin, fetch-site, no-store, CSP and no-CORS behavior applies. The API additionally requires the process capability, POST, JSON, a bounded body and a strict request schema. A future real vault must not reuse this development capability as user authentication or expose this controller to an assistant.

The GUI sends one record operation at a time. It clears its grant after an unconfirmed mutation, never automatically retries a write and asks for a newly approved read before retrying. End/expiry/replaced approval invalidates pending UI results so late reads cannot repaint cleared data. Lost responses cannot establish whether a write happened; underlying adapter failure remains `WRITE_UNKNOWN`. These are not durable operation IDs or a complete recovery workflow.

## Reproducible checks

```powershell
npm test
node scripts/probe-windows-vault-preview.mjs
node scripts/probe-windows-vault.mjs
```

The normal platform-neutral suite tests fixed scopes, read-only/setup replacement, expiry, end, queued-write denial and suppression of late reads; HTTP opt-in/capability/origin/host/schema boundaries; and GUI lost-save/late-read/expiry behavior. The hostname-negative fixture uses Node's raw HTTP client because fetch replaces Host with the URL host. The required 403 response remains unchanged.

The opt-in Windows screen probe runs actual HTTP/controller/service/DPAPI create/edit/read for both fictional members, rejects read-only edits and ended reads without changing ciphertext, terminates and starts a distinct server process, rejects the old capability and grant, then verifies both records after a fresh read approval. It inspects its own encrypted file for the specified fixture markers and removes its own unique store. This probe does not launch a browser or simulate OS restart/unlock.

Observed on Windows, Node 24.19.0 and PowerShell 7.6.5: the encrypted HTTP/restart probe and original adapter recovery probe passed. The 53-test platform-neutral suite passed. Separately, browser interaction verified no save before approval, Alex add/change/read, Sam add/read, read-only edit rejection, explicit end clearing/denial and real-time one-minute expiry clearing. The browser used only the fixed examples; no real household records or hosted model calls were involved.

## Still unverified

Native shell integration, live assistant access and disclosure, trusted unlock, hostile local processes, phone pairing, Android storage integration, background/host sleep, user-held recovery and production security review remain open. The existing DPAPI/key-custody/backup/race limitations in the [adapter guide](windows-vault-adapter.md) apply. The screen does not take passwords, identifiers or free-form household data. No binary distribution, merge, deployment or Actions enablement is part of this increment. The Android isolation assertion and its pending approval are unchanged.
