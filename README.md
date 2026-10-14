# Luna OS Home

Luna OS Home is a personal and household assistant project intended to make everyday administration easier, starting with appointment preparation, form-filling workflows, and finding the right reference information when it is needed.

Luna OS Home is intended to be **MCP first**: expose household capabilities primarily through MCP tools, with scripts and workflows that guide their use and onboarding. The user's own Claude or ChatGPT is the conversational and voice host in the user's chosen computing environment. Voice onboarding runs through that assistant, not through a Luna OS Home voice interface or hosted voice service. Third-party MCP connections belong to the user's assistant environment; Home does not centrally control them.

These are intended workflows, not implemented features. This is a separate project from LunaOS. It is an early private project owned by F2i LLC. A public release may be considered later; no open-source commitment has been made and no license has been selected.

## Proposed features — future work

These proposals describe the direction for discussion, not implemented capabilities or release commitments:

- **Household profiles:** Reuse information for household members so users do not repeatedly answer the same questions.
- **Household vault:** Keep household documents, reusable personal information, passwords, and other credentials in user-controlled local storage on the user's own computer or computing environment, outside the source repository, for authorized use by the program. Each household member would have their own folder for their records, reusable personal information, and applicable credentials. There would be no operator-hosted vault or operator custody of users' records or credentials, and no cloud backup or sync service is proposed. Folder organization alone is not access control or encryption.
- **Document-photo onboarding:** Accept photos of documents such as IDs and birth certificates and analyze selected document contents using an AI provider the user chooses. Users would select the correct household member, then review and correct extracted fields before saving them in that person's local folder/profile; missing or uncertain fields would be flagged rather than silently guessed.
- **Disclosure before AI analysis:** Before sending, clearly identify the chosen AI provider and explain that selected images or contents leave the user's local environment for analysis. They are handled under that provider's security, privacy, and retention practices, which Luna OS Home does not control or guarantee. Local vault storage does not make external AI processing local or private, and no provider-side zero-retention promise is made. This disclosure concerns the provider's handling; it does not remove responsibility for Luna OS Home's own application and transfer behavior.
- **Local-model option — future work:** Offer document analysis through a local model as an alternative to a user-selected external AI provider. This option is not implemented; model choice, requirements, and compatibility remain to be verified.
- **Purpose-based MCP guidance:** Assistant-led onboarding would first discover the household tasks and priorities the user needs help with, identify the required capabilities, and map those needs to relevant workflows and suggested MCP connections. Explain what purpose and access each option serves, then let the user choose which connections to enable in their own Claude or ChatGPT environment. Appointment/calendar and form/document workflows are illustrative needs, not commitments to particular vendors or connections. This is not a blanket connector-enablement checklist: users choose and manage connections in their own assistant environment, and Luna OS Home does not centrally control them. Supported platforms, permissions, and setup steps must be verified during implementation. No integrations are implemented or connections enabled by this starter.
- **Voice onboarding through the user's assistant:** Supply scripts and workflows for the user's own Claude or ChatGPT to guide a conversation through household setup, per-person vault organization, document-photo intake and review, AI provider choice and disclosure, and MCP connection choices. Pair voice guidance with on-screen review of documents and extracted fields before saving. This is a proposed experience, not a Luna OS Home-owned voice interface or a new hosted voice service. No voice vendor is selected, and voice, tool, and MCP compatibility on either platform must be verified during implementation.
- **Document references:** Identify records needed for a task and where to find them, with personal records and real references stored outside the source repository.
- **Appointment coordination:** Find workable times, prepare requests, and eventually book with providers within user-set permissions.
- **Unified household calendar:** Show multiple people's connected calendars together, with filters and separate views by person or source. Preserve each event's provider, account, calendar, and event origin so the combined display does not conflate owners or duplicate events. This is future work; no calendar connections or calendar view are implemented.
- **Form assistance:** Prefill known information and flag missing or uncertain details for review.
- **Follow-through:** Track confirmations, missing paperwork, deadlines, and reminders.

A suggested first workflow for discussion is one appointment from request to confirmed booking, including the information and preparation it requires. This workflow is not implemented or a committed release promise.

The vault and document-photo onboarding are planned capabilities, not current features. Vault storage must be local and user-controlled; selected document contents may be sent to a user-chosen external AI provider for analysis. No specific provider, integration, retention configuration, implementation architecture, or license has been selected. No encryption or vault security controls are implemented. The repository boundary does not prevent the eventual program from processing sensitive records with the user's authorization; it keeps those records out of the source repository. No documents are being sent as part of this starter.

## Planned architecture and reuse

Home-owned MCP tools could expose the local vault, per-person profiles, and unified calendar capability. The assistant would use Home's scripts and workflows to guide onboarding and task completion, alongside purpose-selected third-party MCPs connected in the user's assistant environment. No Home MCP tools are implemented yet. Verify local MCP connectivity and voice/tool compatibility for each assistant and client before promising support; a local server does not automatically work in every Claude or ChatGPT surface.

Avoid duplicate work by evaluating suitable LunaOS libraries, contracts, and skill/tool/workflow machinery for reuse behind deliberately versioned interfaces. This is a plan, not an implemented shared core. Enterprise packages have substantial product and workspace dependencies and are not yet independently consumable Home packages. Evaluate those reuse points before copying or reimplementing capabilities; do not bring over the full enterprise agent runtime or create a new Home voice service simply to reuse code. No enterprise source has been copied or packages extracted for this starter.

Keep Home's local configuration, data/vault, credentials, logs, sessions, event/tool names, and background-job identity isolated from enterprise LunaOS. Before adopting shared machinery, check configuration and environment-variable discovery, child-process environment inheritance, relative transcript/knowledge/memory paths, and scheduler/worker queue and namespace defaults. Use explicit Home-specific boundaries rather than inherited enterprise defaults. Existing event/config collision checks and tool-name prefixes are useful reuse points, but namespacing alone does not prove data or security isolation. These boundaries remain implementation work to evaluate and verify.

## What works today

The initial starter is a local browser checklist, a limited scaffold rather than the intended assistant-driven scripts and workflows. You can add a task, choose a category, mark it complete, and remove it. Categories help organize tasks; they do not perform the named workflows.

Tasks live only in the current browser tab's memory. Reloading or closing the page clears the checklist. The app does not save tasks, send task content to the local server, or contact external services. It has no accounts, reminders, appointment booking, form filling, integrations, or file retrieval. It does not read personal documents or store references to them.

## Run locally

Install Node.js 24 or newer. From this repository's directory, run:

```sh
npm start
```

Open <http://127.0.0.1:4173> in your browser. Stop the server with Ctrl+C. The server listens only on the local loopback address and serves the application's four public files. If port 4173 is occupied, stop the other process using it before starting this app.

There are no third-party runtime or development dependencies and no install step is needed. Use generic task labels, such as "Review the sample school checklist," rather than personal details. There is no save or export function.

## Develop and test

```sh
npm test
```

Tests cover task validation and state changes, along with the local server's allowed files, methods, and response headers. Application files are in `src/`; `server.js` provides the local static server. GitHub Actions is configured to test pull requests and pushes to `main` using F2iLLC's existing self-hosted Linux x64 `ci-general` runner pool. The repository must have access to that pool for CI to run.

For a quick browser check, add a fictional task, complete it, remove it, and reload the page to verify that tasks do not persist.

## What belongs in this repository

Keep reusable application code, supporting tests and configuration, and documentation that helps people use or develop the program here. Any examples or test data must be fictional.

Keep personal and family records, live household data, real private-file paths or links, credentials, secrets, agent transcripts, scratch notes, progress reports, status reports, and task plans outside the checkout. Future reference-information workflows should work with separately stored personal files; this starter does not implement those workflows.

The ignore rules exclude common personal-data, secret, and working-material locations. They are a precaution, not a content scanner or a security boundary: Git can still track sensitive material under other names or when force-added. Before committing, review the staged file list and diff with `git diff --cached --name-only` and `git diff --cached`. Do not force-add excluded material. Private repository visibility does not make this repository an appropriate place for household records.
