# Fictional family draft review

This is the first working slice of [Session 1](../epics/vault-first-two-sessions.md#session-1-prove-the-app-and-assistant-path). Android is the first mobile target. **The bounded Session 2 handoff is cleared:** the listed technical exit checks have evidence, PR #30 was reviewed and merged, and the owner accepted Windows assistant/direct Android scope with deferred integrations tracked in issue 31. See the [exit-check mapping and accepted next step](session-one-handoff.md). Do not enter real household information.

## What is implemented

The dusk home screen expands into a checklist or a family draft. The draft shows people as organizational labels in one shared space. Each field supports Needs review, a clarification reply, manual correction, confirmation and skipping. Suggestions can be accepted for later or declined without creating records. Assistant corrections always return to an unconfirmed state. The assistant cannot confirm fields, replace an open draft or delete it. Only the local GUI can discard the current draft.

The GUI and the three MCP tools use the same in-memory draft service. IDs and a revision protect against cross-person edits, stale requests and late corrections after discard. Input is bounded and validated. The server rejects foreign origins, unexpected Host headers, cross-site fetches and missing custom request headers. It has no CORS permissions, public binding, persistence, telemetry or saved-record API. Text is rendered as text, never interpreted as HTML.

These are preview controls, **not family authentication, encryption, session grants or production security**. A local process can access the preview. Data stays in process memory until discard or process termination, not just until a browser tab closes. Input validation cannot tell whether a person typed real information. The fictional-only boundary is an operator/test restriction. Do not expose this service over a LAN or a tunnel.

### Recovering from a lost connection

A successful HTTP response is not enough to resume editing. Home checks the returned draft's identity, revision, people, fields, suggestions and review states before accepting it. Missing or unusable details and duplicate IDs keep recovery blocked, so a malformed reply cannot replace the displayed draft or enable another change. A valid `draft: null` is accepted when the service has no draft. This validates the response format; it does not authenticate the service.

If a request times out, loses its response or receives an unreadable response, Home cannot know whether the change arrived. It shows **Update not confirmed**, retains the displayed draft and does not retry the write. Further changes, including discard and example creation, are blocked until a refresh successfully reads the current draft. Use **Check for updates**, or return to the preview when no field is being edited. Stale-edit conflicts and server errors also require this refresh. A failed refresh keeps the block in place; the app never silently replays the previous action after reconnecting. A restarted service may return no draft, in which case the old display is cleared.

Automated coverage includes a server that applies a fictional edit and closes the socket before replying. It verifies that neither an immediate retry nor discard reaches the server, a failed refresh does not unblock writes, and a successful refresh recovers the applied value for separate confirmation. Timeout, malformed response, conflict and server-error cases are also covered. In a local desktop browser, the same dropped-response scenario showed the unavailable message, blocked retry, recovered **Willow Workshop** as **Please check**, and allowed **Looks right** after refreshing. The typed value remained present during the failure. This is browser evidence; native on-screen recovery and assistant-client recovery remain separate checks.

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
| Android x86_64 emulator | [Android probe](android.md#october-16-emulator-interaction-and-system-bar-correction): Android 16/API 36, WebView 133.0.6943.137, visibly launched and supported pointer navigation, family selection, Needs review, suggestion acceptance, background/resume and restart clearing on the baseline build. A subsequent inset fix visibly separates content from system bars. Emulator keyboard/correction acceptance and native assistant connection remain open; the separate physical-phone result below does not resolve the emulator keyboard gap. See the guide for exact hashes and limited post-fix checks. |
| Physical Android ARM64 phone | [October 16 phone check](android.md#october-16-physical-arm64-phone-interaction): Samsung SM-S938U, Android 17/API 37, WebView 155.0.8059.43. The inset-corrected package from `81f331e` passed same-signer installation, rendered launch, portrait keyboard editing, Needs review, manual correction/separate confirmation, member isolation, both suggestion choices, discard cancellation/confirmation, background/resume and visible restart clearing. Landscape review was exercised; the owner's return-to-portrait/brief lock-unlock sequence retained the draft and Sam selection. Tests used ADB-injected app input on the physical phone. Landscape keyboard editing/dismissal and general Back navigation also passed. Exact artifact hash and remaining human usability coverage are recorded in the guide. Android assistant integration remains unimplemented. |
| Android 11 physical ARMv7 test, WebView 146.0.7680.153 | Standard debug APK installation succeeded, but the device operator reported a native HWUI RenderThread crash immediately after activity start. Physical launch is **failed**, not passed. The [opt-in software-rendering build](android.md#opt-in-activity-software-rendering) is an unverified mitigation awaiting device retest. |
| Native Windows debug review mode | [October 16 native check](native-shell.md#october-16-windows-native-correction-check): Windows 11 build 26300 / WebView2 155.0.4283.45 visibly completed the real Claude Code flag/question/typed reply/correction/separate-confirmation flow. Member isolation, suggestion accept/decline, stopped-service warning, blocked retry and explicit fresh-session refresh passed. The default offline app also passed manual editing, separate confirmation, member isolation, cancel/confirm discard and visible clearing after close/relaunch. Runtime navigation/download guards remain unverified; installer acceptance is later distribution work. |
| Claude Desktop, Claude Android and ChatGPT clients | No live client test. The [dated provider investigation](session-one-handoff.md#tested-path-and-provider-limits) distinguishes a candidate local Desktop route from mobile/web routes requiring remote access. Code success does not establish these clients. |
| Assistant memory and Gmail/calendar discovery | Not exercised. Test used supplied fictional facts only; no real source access. |
| Embedded GUI, phone-only local host, paired devices, background suspension | Untested. The verified desktop paths use a separate local browser or Windows debug window, not an embedded assistant panel. |
| Protected persistence, unlocking, recovery and workflow grants | Not implemented in this draft probe. |

## Tests and remaining acceptance

`npm test` covers checklist regression, static allowlisting, HTTP origin/Host/body checks, draft identity/revision, correction preconditions, re-review after edits, suggestion decisions, discard invalidation and the stdio/HTTP round trip. No model subscription is needed for automated tests. `npm ci --ignore-scripts` uses the committed lockfile. See [dependency provenance](../../THIRD_PARTY.md).

The [Session 1 handoff](session-one-handoff.md) maps the listed exit checks to actual Windows/Android and real Claude Code evidence. It records the mobile client limitation and the accepted next-session scope. The [Windows storage experiment](windows-storage.md) starts Session 2 with a narrow OS-facility check. Issue metadata remains unchanged; product and security acceptance do not follow from handoff readiness. Installer/distribution work, human usability and production security are separate gates. Source review and independent sensitive-access review remain distinct from local tests. Actions stays disabled.
