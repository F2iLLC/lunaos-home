# Fixed-example Windows assistant bridge

This [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) increment connects a stdio MCP client to the same session service and Windows encrypted store as the [Home example screen](windows-vault-screen.md). It remains developer-only: only fixed Alex/Sam example records are reachable. It does not turn the existing draft MCP tools into production vault tools.

## Access and sharing are separate

The operator starts `node scripts/windows-vault-preview.mjs`. It prints a GUI link and a **different** assistant bridge environment. Give the MCP client only the bridge URL/key, never the GUI link/key. Keep all generated configuration outside the repository and do not publish it. Example MCP configuration structure:

```json
{
  "mcpServers": {
    "lunaos_windows": {
      "command": "node",
      "args": ["<absolute-repository-path>/scripts/windows-vault-assistant.mjs"],
      "env": {
        "LUNA_HOME_WINDOWS_URL": "http://127.0.0.1:<printed-port>",
        "LUNA_HOME_WINDOWS_ASSISTANT_KEY": "<printed-assistant-bridge-key>"
      }
    }
  }
}
```

The shim rejects non-loopback, non-HTTP, missing-port and decorated URLs. It refuses redirects. The bridge key cannot authorize GUI calls, and the GUI key cannot authorize assistant calls. The destination label describes the intended Claude Code test client; it is not a cryptographic claim about the caller's identity. Another process under the same Windows account remains outside this development boundary.

1. Connect the configured MCP client. Connection alone grants no record access. Only one bridge connection is admitted at a time; a second is rejected rather than replacing it.
2. In Home, choose **Allow assistant viewing** or **Allow assistant adding and changing**. This grants a one-minute workflow over the two fixed records. It grants no disclosure. New approval revokes the previous grant and its sharing scope.
3. The assistant can call `home_example_create`, `home_example_edit` or `home_example_read`, with only `recordId: alex-work` or `sam-school`. Writes use fixed fixture values and return only `status`, `recordId` and `accessEnded`. No arbitrary content, password, deletion, approval, destination, path or configuration tool exists.
4. A read requires a separate GUI action: choose one record and one field, then **Share this part with the assistant**. The purpose is viewing that selected part in the connected test assistant. Only that field is returned; other fields and the other record remain withheld. Sharing a different field replaces the prior scope. It cannot extend the underlying grant's lifetime.
5. **Stop sharing** blocks future and pending reads at the service boundary. It cannot erase information already received by a provider. **End assistant access** revokes the entire assistant grant, including queued mutations, while leaving the bridge connected for possible fresh approval. The screen explains that a save already in progress can finish.
6. **Disconnect test bridge** closes its connection and discards its grants. Reconnect the MCP client before another approval. Normal stdio closure requests disconnect. Abrupt client death can leave a connected but unapproved/expired slot; the operator can disconnect it locally. Restarting the server always changes both capabilities and discards all grants.

The GUI's own local approval is independent of assistant approval. The service, storage queue and store are shared; there is no duplicate assistant record store. Disclosure is enforced after a storage read as well as before it. An expired/revoked scope cannot release a late result. An unconfirmed write makes the shim deny subsequent record calls and attempt disconnect; there is no automatic replay. A new connection and local approval are needed after reviewing the record locally.

The bridge uses only the already pinned MCP SDK and Zod dependencies. No third-party source, new dependency or binary is added. Local development keys are capabilities, not user identity, vault unlock, authenticated device pairing or protection against same-account processes.

## Distinct evidence layers

### Automated service and protocol checks

`npm test` includes the real stdio MCP shim against an in-memory store and the same HTTP approval route used by Home. It verifies the exact three-tool inventory, no access before approval, receipt-only mutations, separate disclosure, one-field responses, other-record denial, disclosure replacement/revocation, read-only mutation denial, expired/end denial, separate capability roles and default-server 404s. Controlled clocks exercise expiry; deferred storage calls exercise read revocation and queued-write denial. An injected lost edit receipt verifies `WRITE_UNKNOWN`, bridge disconnect, no automatic replay on a new MCP connection, and denial of another edit until fresh local approval. UI tests also suppress a late sharing response after expiry. These are not live-model tests.

`node scripts/probe-windows-vault-preview.mjs` exercises actual Windows DPAPI storage through HTTP and stdio, including selected-field sharing, stopped sharing and ended-session denials. It also retains the two-member restart, old-key/grant rejection and cleanup checks. This uses the MCP SDK client, not Claude.

### Browser controls

Browser interaction with the fixed-example encrypted store and a connected SDK test client verified: assistant access initially denied; GUI setup approval allowed create/edit receipts but not reads; GUI sharing of Alex's saved detail returned only that value; stopping sharing refused the next read; ending access refused the next edit. Temporary fixture, bridge and server were cleaned up. This proves the screen-to-controller path separately from the live-model invocation.

### Live Claude Code candidate

On 2026-10-17, installed Claude Code **2.1.291**, Node **24.19.0** and PowerShell **7.6.5** completed a real client round trip using only the fixed fictional fixture. The client used strict MCP configuration, no built-in tools, no Chrome, disabled slash commands, no session persistence and only the three example tools allowed. No memories, mail, household data, general file tools or other connectors were used. The GUI approval endpoint was driven by the synthetic test harness; this was not human acceptance or a live-model/browser-click combined test.

Observed actual tool calls/results: an initial read was denied; approved create/edit returned receipts and the GUI endpoint read back the encrypted Willow Workshop value; a read before disclosure was refused; sharing Alex's value returned only `value`, while Sam's read was refused; stopping sharing refused the next read; replacing disclosure with Alex's label returned only `label`; read-only edit and ended-session read were denied. The live test did not measure expiry; expiry evidence is in the controlled-clock protocol tests and earlier browser timer check. Parallel responses were correlated by actual tool invocation ID, not arrival order. Only summary evidence is published; transient client configuration and synthetic store were removed.

For reproduction, configure only this MCP server in a local, nonpersistent Claude Code test session, disable unrelated tools/sources, and perform the fixed calls above while using Home for the corresponding approvals. Retain only synthetic summary evidence. Do not give the assistant the GUI capability or let it perform its own approvals.

## Native Windows follow-up

The separate [native verification experiment](windows-native-vault.md) now places both example routes behind a real Windows verification result in an opt-in debug shell. Human success and cancellation were observed separately from this guide's live Claude test. That does not establish a combined native/live-client acceptance result or authentication-bound encryption-key release.

## Remaining gates

This does not establish ChatGPT support, mobile hosted-assistant automation, arbitrary user-record handling, complete native acceptance, authentication-bound key release, secure device enrollment, direct phone pairing, hostile same-account process isolation, backup/recovery or production security acceptance. The current-user DPAPI and subprocess limitations remain. Session 2 is not complete. The Android assertion approval is unchanged; public PR tests now run on hosted GitHub Actions under the [CI handoff](../ci-actions-setup.md). These tests imply no merge or deployment.
