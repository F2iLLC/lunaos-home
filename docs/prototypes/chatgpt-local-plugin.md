# Local ChatGPT draft-preview plugin

This developer experiment for [issue 31](https://github.com/F2iLLC/lunaos-home/issues/31) packages the existing fictional draft service for a local desktop MCP host. It has no vault adapter, saved records, memory/email/calendar connector, credential setup, public endpoint, or tunnel. Node 24 or later must already be available on the desktop client's PATH. The package does not bundle Node or install it automatically.

The service listens only on `127.0.0.1` at a fresh port selected by the OS. The MCP process and browser use the same in-memory draft. Closing the MCP connection stops the preview; a restart begins empty. Local HTTP origin checks are not authentication against other processes under the same OS account. Use fictional fixtures only. Tool inputs, review questions and replies are visible to the hosted assistant; running the tools locally does not make the model local. The existing draft UI and its local confirmation do not save vault records.

## Build a fresh local package

From a clean Home checkout with Node/npm installed:

```powershell
npm ci --ignore-scripts
npm run build:chatgpt-plugin -- C:/HomeDeveloperPackages/draft-preview-01
```

Use a new absolute output directory with an existing parent, outside the checkout and cloud-synchronized folders. The builder refuses existing output, copies a fixed source-file allowlist, and installs only the existing lockfile's production dependencies offline from npm's cache with lifecycle scripts disabled. The preceding `npm ci` populates that cache. It includes Home's license and dependency licenses/notices. It does not copy `.env`, `.npmrc`, personal records, repository history, native binaries, or development dependencies. Failed output is left for inspection; choose a new output directory for a retry.

The result contains `.agents/plugins/marketplace.json` and `plugins/lunaos-home-preview/`. The plugin contains portable `plugin.json`/`mcp.json`, a fictional review skill, and a self-contained `runtime/`. `${PLUGIN_ROOT}` resolves to the installed cache copy. The build performs no registration, installation, or model call.

## Register and test

OpenAI's [packaging guide](https://developers.openai.com/plugins/build/plugins) documents local marketplaces for authoring and private testing, separately from universal-directory publication. Its [desktop-only submission guide](https://developers.openai.com/plugins/deploy/desktop-only) requires partner allowlisting for local MCP **submission**; that is not evidence that local marketplace testing requires public submission. Desktop/account eligibility still needs observation in the intended client.

```powershell
codex plugin marketplace add C:/HomeDeveloperPackages/draft-preview-01
codex plugin add lunaos-home-preview@lunaos-home-local
```

These commands register and install the local package through the supported CLI. Preserve unrelated marketplaces and plugin settings. CLI installation proves installation in the shared local runtime, not ChatGPT desktop discovery or a live model tool call. Refresh/restart ChatGPT when convenient, select a local Work conversation, and find **LunaOS Home Preview**. Do not interrupt unrelated active work to restart the client.

Ask: `Use LunaOS Home Preview to try the fictional Alex and Sam draft review. Use only this plugin's tools and no personal sources.` Open the returned local Home link. Select Alex's Workplace, mark **Needs review**, and enter `Change it to Willow Workshop.` in Home. Ask the assistant to check the review request and apply that correction. Refresh Home, verify **Willow Workshop** is still **Please check**, verify Sam's school is unchanged, and separately choose **Looks right**. Record actual client version and observed results; a tool receipt alone is not GUI or human acceptance. If tools are absent, stop and record the client gap rather than switching to a tunnel.

For a deterministic protocol check of a generated or installed copy:

```powershell
node scripts/probe-chatgpt-plugin.mjs C:/HomeDeveloperPackages/draft-preview-01/plugins/lunaos-home-preview
```

This probe tests the declared launch command, three-tool inventory, static GUI assets, cross-origin denial, unavailable vault endpoints, shared draft, reply-required correction, unchanged Sam fields, separate HTTP-driven confirmation, duplicate/stale denial, listener shutdown and empty restart. It uses an MCP SDK client and synthetic HTTP review actions; it does not exercise the host's plugin parser, invoke ChatGPT or click the GUI. `npm test` also builds and relocates a package into a cache-like directory containing spaces, removes its generated source, and repeats this check. The probe rejects a missing portable MCP schema declaration before launching anything.

Also verify the installed plugin through the actual Codex app-server loader, using absolute paths to the native Codex executable and the registered marketplace file:

```powershell
node scripts/probe-chatgpt-plugin-discovery.mjs C:/Codex/bin/codex.exe C:/HomeDeveloperPackages/draft-preview-01/.agents/plugins/marketplace.json
```

The executable path above is illustrative; `codex app-server daemon version` reports the managed executable when a local daemon exists. This probe starts a separate stdio app-server process, reads only the named Home plugin, and queries only its MCP server's tool inventory. It requires the plugin to be installed and enabled. It makes no model request or draft-tool call, writes no client configuration, and shuts down its diagnostic process. It does not restart the running desktop daemon. Codex must be installed separately; hosted repository tests do not install it.

## Evidence and remaining acceptance

On October 24, 2026, the package was built on Windows with Node 24.19.0 and installed using Codex CLI 0.164.0. The CLI returned plugin ID `lunaos-home-preview@lunaos-home-local`, version `0.1.0`. The manifest-driven probe passed against that actual installed cache copy. The relocated-package regression passed, and the full Windows suite passed 236/236.

Chrome interaction against the installed MCP process showed Alex's Workplace as Willow Studio, marked it Needs review, and submitted the fictional reply. The SDK client retrieved that exact request and proposed Willow Workshop. Browser refresh showed Please check; a separate browser click changed it to Looks right. Sam's school remained Meadow School. This is automated browser plus SDK evidence, not a live ChatGPT conversation or human comprehension acceptance. The disposable process was closed after the check.

Windows package metadata reports ChatGPT Desktop 1.2026.190.0 installed. The first user-reported attempt with plugin 0.1.0 loaded the skill but exposed none of its three tools; no fictional draft was staged. A client-level diagnosis reproduced zero bundled MCP servers. The package's `mcp.json` omitted the required `$schema` declaration, so the host ignored its configuration even though the SDK could launch the server directly. Adding only `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` made Codex 0.164.0 discover the server. This supersedes the initial assumption that the absence was only a stale conversation inventory.

Plugin 0.1.1 includes that declaration and is installed locally. The actual client discovery probe passed: `plugin/read` found `lunaos_home_preview`, and `mcpServerStatus/list` started it and returned exactly `home_stage_draft`, `home_review_requests`, and `home_correct_draft`, with no tool-list error. The SDK protocol check also passed against the installed 0.1.1 cache. The regression now removes the schema declaration and verifies refusal before restoring it for the relocated-package round trip.

This establishes client discovery and startup, not a live ChatGPT model invocation. A fresh local Work conversation must still complete the fictional review workflow. No tunnel or public submission was used; public distribution eligibility remains unverified.

Keep package assembly, CLI installation, SDK protocol checks, browser interaction, live ChatGPT calls, and independent acceptance separate. This experiment does not complete VLT-06, VLT-09, mobile automation, native embedding, encrypted-record operations, or sensitive-use acceptance. No API key or new account is required by this package. Publishing source does not publish the plugin to the universal directory or authorize a release.
