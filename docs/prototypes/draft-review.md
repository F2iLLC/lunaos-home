# Fictional family draft review

This is the first working slice of [Session 1](../epics/vault-first-two-sessions.md#session-1-prove-the-app-and-assistant-path). Android is the first mobile target. **The session remains open:** native Android build/install/process launch has passed on an emulator, but native UI acceptance, assistant connection and full client compatibility investigation are not complete. Do not enter real household information.

## What is implemented

The dusk home screen expands into a checklist or a family draft. The draft shows people as organizational labels in one shared space. Each field supports Needs review, a clarification reply, manual correction, confirmation and skipping. Suggestions can be accepted for later or declined without creating records. Assistant corrections always return to an unconfirmed state. The assistant cannot confirm fields, replace an open draft or delete it. Only the local GUI can discard the current draft.

The GUI and the three MCP tools use the same in-memory draft service. IDs and a revision protect against cross-person edits, stale requests and late corrections after discard. Input is bounded and validated. The server rejects foreign origins, unexpected Host headers, cross-site fetches and missing custom request headers. It has no CORS permissions, public binding, persistence, telemetry or saved-record API. Text is rendered as text, never interpreted as HTML.

These are preview controls, **not family authentication, encryption, session grants or production security**. A local process can access the preview. Data stays in process memory until discard or process termination, not just until a browser tab closes. Input validation cannot tell whether a person typed real information. The fictional-only boundary is an operator/test restriction. Do not expose this service over a LAN or a tunnel.

## Launch without an assistant

Install Node.js 24 or newer, then from a clean checkout:

```sh
npm ci --ignore-scripts
npm test
npm start
```

Open <http://127.0.0.1:4173>, expand the home button, choose **Explore my vault**, then **Try the example family**. The example is explicitly a fixture; it does not pretend an assistant read anything. Stop with Ctrl+C. The checklist still lives only in the browser tab; the draft lives in the local process and survives a tab reload.

## Connect a local MCP client

The experimental adapter uses the official MCP TypeScript SDK and stdio. Configure a test client to launch `node` with the absolute path to `assistant.js` as its sole argument. Use an absolute Node executable path if it is not on the client's PATH. No shell, account credentials or API keys are needed by Home.

```json
{
  "mcpServers": {
    "lunaos_preview": {
      "command": "node",
      "args": ["/absolute/path/to/lunaos-home/assistant.js"]
    }
  }
}
```

The client starts its own Home instance at <http://127.0.0.1:4183/#vault>. This is separate from the standalone instance on port 4173; use the URL returned by the tool. Keep the client session alive during review. Closing the stdio connection stops its HTTP server and clears its draft. If the port is occupied, the new process fails rather than silently connecting to another draft. `LUNA_HOME_PREVIEW_PORT` can choose a different local port; `0` selects an ephemeral port for tests. The URL contains no record contents or access secrets.

Allow only these tools for the fictional probe:

| Tool | Effect |
| --- | --- |
| `home_stage_draft` | Stage bounded fictional people, fields, source labels and suggestions; return draft identity and review URL. |
| `home_review_requests` | Return flagged field IDs, clarification questions and user replies; omit other profile fields. |
| `home_correct_draft` | Propose a correction for a flagged field with a user reply and current revision. Local confirmation remains required. |

The client sees those tool results, including the selected reply. This is not a production disclosure-grant implementation. Only fictional material may be used. Home has no access to the client's hidden memories, mail or calendar. Source labels are unverified, caller-supplied text; they are not proof of source access.

### Repeat the real-client check

1. Use a clean synthetic client session with other tools, skills, integrations and source access disabled. Do not resume a personal conversation. In Claude Code the tested controls were strict MCP configuration, empty built-in tools, disabled skills, no Chrome, empty user/project setting sources, no session persistence, and an allowlist of the three draft tools.
2. Ask it to stage Alex Example with workplace Willow Studio and library Moonrise Library, and Sam Example with school Meadow School. Identify every source as a fictional fixture. Suggest a library card for Alex.
3. Open the returned local review URL. In Home mark Alex's workplace **Needs review**.
4. Ask the client to check review requests and ask the returned question. In Home leave the reply “The fictional workplace should be Willow Workshop.”
5. Ask the client to check again and propose that correction. In Home select **Check for updates**. Verify Willow Workshop appears as **Please check**, then choose **Looks right**.
6. Accept or decline the library suggestion. Switch to Sam and confirm the workplace change did not alter Sam's school. Try a manual school correction. Neither review nor suggestion acceptance saves a vault record.

Refresh is explicit; the adapter does not yet push unsolicited events into a conversation. Returning to the tab refreshes when no text field is being edited. This avoids overwriting in-progress typing. A future plugin workflow must handle conversational resumption and review events without implying an always-listening assistant.

## Observed compatibility

Initial probe: October 14, 2026. Results apply only to the combinations actually exercised.

| Surface or capability | Result and limit |
| --- | --- |
| Windows 11 Home, build 26300; Node 24.19.0 | Local HTTP service and original web GUI run. Not a packaged desktop build. |
| Claude Code 2.1.291, existing authenticated subscription | **Verified real round trip:** model called stage; GUI displayed two fictional people; GUI flag reached model; model asked clarification; GUI reply reached model; model corrected; GUI displayed correction and confirmed it. Tool results and actual GUI state were both checked. This does not establish a minimum subscription tier. |
| SDK protocol client | Automated child-process stdio test verifies the same tool → HTTP GUI → tool correction sequence. This test alone would not prove a real assistant integration. |
| Narrow desktop browser viewport | Family selection and manual edits checked at a narrow rendered viewport with no horizontal overflow. This is not Android, touch-device or mobile installation proof. |
| Android native app/device | [Android probe](android.md): full x86_64 debug APK build, signature check, installation and two cold process launches passed on Android 16 / API 36 emulator, WebView 133.0.6943.137. APK and installed package have no Internet permission. Native rendering/interactions, restart clearing, physical phone and native assistant connection remain unverified. |
| Android ARM64 package | Full `aarch64` debug build and v2 signature check passed; APK contains the `arm64-v8a` native library and retains the offline manifest restrictions. No installation or runtime check on an ARM64 device has been performed. |
| Native Windows package | [Offline shell](native-shell.md): debug executable builds; process and WebView debugger started. Native rendering/interactions and installer lifecycle remain unverified. |
| Claude Desktop, Claude Android and ChatGPT clients | Untested. Claude Code success does not establish support in these other clients. |
| Assistant memory and Gmail/calendar discovery | Not exercised. Test used supplied fictional facts only; no real source access. |
| Embedded GUI, phone-only local host, paired devices, background suspension | Untested. Current GUI is a separate local browser window. |
| Protected persistence, unlocking, recovery and workflow grants | Not implemented in this draft probe. |

## Tests and remaining acceptance

`npm test` covers checklist regression, static allowlisting, HTTP origin/Host/body checks, draft identity/revision, correction preconditions, re-review after edits, suggestion decisions, discard invalidation and the stdio/HTTP round trip. No model subscription is needed for automated tests. `npm ci --ignore-scripts` uses the committed lockfile. See [dependency provenance](../../THIRD_PARTY.md).

Do not close Session 1 from this PR. Next: complete native Android and Windows on-screen checks, prove an assistant-to-native-GUI path, test phone-only behavior, and investigate a permissible ChatGPT path. Session 2 still depends on those feasibility checks. Source review and independent sensitive-access review remain distinct from local tests. Actions stays disabled.
