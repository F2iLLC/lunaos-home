# Luna OS Home

Luna OS Home is a personal and household assistant project intended to help ordinary households get more from an existing AI subscription: prepare appointments, work with forms, find the right information, and follow through on everyday administration.

Home is intended to be **MCP first, with a companion GUI**. MCP exposes household capabilities to the user's own Claude or ChatGPT; the GUI helps nontechnical users understand their local setup, what Home can access, what it is attempting, and the results. Both interfaces will use the same local application services and state, rather than separate engines. Discovery will be limited to user-authorized locations and configuration.

The user's assistant remains the conversational and voice host. Home supplies onboarding scripts and workflows, not a new voice service. Third-party MCP connections are chosen for the user's needs and managed in their assistant environment. Local MCP, tool, plan, client, and voice compatibility must be verified before claiming support on any particular surface.

This is a separate project from enterprise LunaOS, publicly hosted under F2iLLC. Newly authored Home material is licensed under Apache-2.0. Public source visibility is an early preview, not a usable V1 release; the bootstrap remains under review in PR #1.

## What works today

Only the local, session-only browser checklist is implemented. You can add a task, choose a category, mark it complete, and remove it. Task state lives in the current tab's memory and clears on reload or close. Tasks are not sent to the local server or external services.

The checklist is a limited scaffold. It does not implement MCP tools, environment discovery, profiles, a vault, credentials, document analysis, calendars, reminders, form filling, booking, or integrations. There are no implemented vault encryption or access controls. No personal records are processed by this starter.

## Intended V1

The [V1 roadmap](ROADMAP.md) defines the proposed scope, sequential milestones, dependencies, acceptance criteria, and release gates. Its core outcomes are:

- A GUI that separates configured access, verified access, attempted actions, and observed results. It does not claim to see assistant or connector activity outside Home's observation.
- A user-controlled local vault, with a folder/profile for each household member and established facilities for protecting records, reusable information, and credentials. No operator-hosted vault.
- Reviewed document-photo intake with correct-person assignment. External analysis uses a provider the user chooses, with understandable consent and provider disclosure before selected content leaves the local environment. A local-model option is future work.
- Assistant-led, purpose-based onboarding: discover household needs before suggesting MCP connections; pair conversation or supported voice with on-screen review.
- One unified household calendar with read and write capabilities: view, create, update, and delete events on calendars the user authorizes. Preserve person/source filters and event origin, initially bounded to one verified calendar provider.
- One useful appointment-preparation and follow-through workflow. Broad autonomous booking, sending, and external form submission are outside V1.

Suitable enterprise libraries, contracts, and skill/tool/workflow machinery may be reused through deliberately versioned interfaces after rights review. Home must isolate its configuration, credentials, data, logs, sessions, names, and background jobs. Enterprise LunaOS is proprietary; Home's license does not authorize copying it. No enterprise source has been copied or packages extracted for this starter. See the [reuse boundaries](ROADMAP.md#architecture-and-reuse) and [authoritative repository rules](REPOSITORY_RULES.md).

## Run the starter

Install Node.js 24 or newer. From this repository's directory:

```sh
npm start
```

Open <http://127.0.0.1:4173>. Stop the server with Ctrl+C. The server listens only on loopback and serves the four application assets. If port 4173 is occupied, stop the other process using it first.

There are no third-party runtime or development dependencies and no install step. Use fictional or generic task labels such as "Review the sample school checklist." There is no save or export function.

## Develop and contribute

```sh
npm test
```

Tests cover task validation and state changes, plus the static server's allowed files, methods, and headers. Application files are in `src/`; `server.js` provides the server. For a browser check, add a fictional task, complete it, remove it, and reload to confirm that tasks do not persist.

- [COLLABORATORS.md](COLLABORATORS.md): roles, contribution workflow, review, and publication evidence for human and AI workers.
- [REPOSITORY_RULES.md](REPOSITORY_RULES.md): authoritative team rules for repository contents, sensitive data, rights, and public contribution safety. These are project contribution rules, not extra downstream license conditions.
- [ROADMAP.md](ROADMAP.md): planned V1 and distinct public-source/V1 release gates; not a claim of implementation.

GitHub Actions is currently **disabled for this repository** so public contributions cannot run on shared enterprise infrastructure. The workflow still references the previously used self-hosted `ci-general` pool; do not re-enable it as-is. Establish and test the isolated self-hosted runner/trust policy in the repository rules before resuming CI. Run `npm test` locally in the meantime. Report vulnerabilities through the [private reporting route](REPOSITORY_RULES.md#vulnerability-reports).

## License

Newly authored Home code and accompanying documentation are licensed under [Apache License 2.0](LICENSE). Third-party material, if later included with authorization, retains its applicable notices and terms. The package's `private: true` prevents accidental npm publication; it does not change the license or GitHub visibility.

Apache-2.0 permits commercial use and proprietary downstream derivatives, includes a contributor patent grant with conditions, and requires applicable license, change, and attribution notices when redistributing. It grants no blanket trademark rights. The [official license text](https://www.apache.org/licenses/LICENSE-2.0.txt) is authoritative. Team workflow and privacy rules do not add restrictions to that license. No copyright ownership is inferred from the GitHub organization, and this license does not relicense enterprise LunaOS.
