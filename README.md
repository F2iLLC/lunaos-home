# Luna OS Home

Luna OS Home is a personal and household assistant project intended to help ordinary households get more from an existing AI subscription: prepare appointments, work with forms, find the right information, and follow through on everyday administration.

Home is intended to be **MCP first, with a companion GUI for mobile and desktop**. MCP exposes household capabilities to the user's own Claude or ChatGPT; the GUI helps nontechnical users understand their local setup, what Home can access, what it is attempting, and the results. Both interfaces will use the same local application services and state, rather than separate engines. Discovery will be limited to user-authorized locations and configuration. Mobile and desktop app delivery is a product requirement; installation, device-local storage, and assistant connectivity need verification on each supported platform.

The product has three parts: a workflow plugin in the user's existing assistant, the Home GUI, and the device-local data/service layer. MCP connects supported assistant workflows to local operations; it is not a promise of identical plugin installation or embedded UI across providers. The user's assistant remains the conversational and voice host. Home supplies onboarding scripts and workflows, not a new voice service. Third-party MCP connections are chosen for the user's needs and managed in their assistant environment. Local MCP, tool, plan, client, and voice compatibility must be verified before claiming support on any particular surface.

This is a separate project from enterprise LunaOS, publicly hosted under F2iLLC. Newly authored Home material is licensed under Apache-2.0. The bootstrap has merged; public source visibility is an early preview, not a usable V1 release.

## What works today

A responsive dusk welcome screen expands **What would you like to do today?** into a checklist or a fictional family draft. The checklist supports adding, completing and removing tasks. Task state lives in the current tab's memory and clears on reload or close; tasks are not sent to the local server or external services.

The new [draft-review prototype](docs/prototypes/draft-review.md) lets a local MCP client stage fictional profiles in the same Home GUI, receive **Needs review** questions and replies, and propose corrections for local confirmation. People organize one shared draft; suggestions can be accepted for later or declined. Drafts live only in the local process and clear when it stops or the user discards them. A real Claude Code round trip has been exercised on Windows; other assistant clients remain unverified.

This is not a secure vault. It has no encrypted persistence, family admission, production workflow grants, sign-ins, source discovery, image analysis, calendars, reminders, form filling or booking. Use made-up details only. Android is the first mobile target; a narrow browser layout does not establish an installable Android or desktop app. See the [provisional architecture](docs/architecture/vault-prototype.md) and compatibility matrix for remaining work.

## Intended V1

An opt-in [vehicle greeting slice](docs/prototypes/vehicle-greetings.md) adds Android companion setup, Bluetooth identity confirmation, paired Home session events, configurable local names, brief greetings, and reconnect suppression. It is a development preview with an isolated phone test harness; vehicle audio and locked-phone wake require attended verification. It adds no vehicle controls, telemetry, location, calendar access, or Android Auto dashboard UI.

The separate [parked conversation slice](docs/prototypes/vehicle-conversations.md) adds explicit tap-to-speak, paired Home requests, MCP assistant sampling, selected-voice replies and a short shared conversation. It needs configured model/speech access and reachable Home hosting; automated tests do not establish live provider or vehicle acceptance.

The [V1 roadmap](ROADMAP.md) defines the proposed scope, sequential milestones, dependencies, acceptance criteria, and release gates. Its core outcomes are:

- A GUI that separates configured access, verified access, attempted actions, and observed results. It does not claim to see assistant or connector activity outside Home's observation.
- A [user-controlled shared vault](docs/epics/user-controlled-vault.md), organized by family member, with family-system access covering all members' records and established protection for records and sign-ins. Onboarding chooses phone-only storage or a vault shared with an explicitly connected computer, where information is kept, and how to unlock it. No operator-hosted vault or implicit cloud sync.
- Reviewed document-photo intake with correct-person assignment. Optional image analysis happens in the user's chosen ChatGPT, Claude, or other provider, with understandable disclosure before the user sends selected content. Home does not offer the analysis service; manual entry remains available. Private vault data stays on enrolled devices by default and is not automatically returned to hosted assistants.
- Direct record management or delegated creation, editing, and deletion through the user's chosen assistant, within revocable workflow permissions. The expanding home menu currently leads to the draft preview; protected records remain future work.
- Assistant-led, purpose-based onboarding: discover household needs before suggesting MCP connections; pair conversation or supported voice with on-screen review.
- A proposed **Learn about me** plugin skill uses the assistant's available memories and already authorized sources such as Gmail and calendars to suggest a personal/family profile in the Luna OS GUI. Review and correct it together before saving approved details locally; it never silently writes inferred family relationships.
- One unified household calendar with read and write capabilities: view, create, update, and delete events on calendars the user authorizes. Preserve person/source filters and event origin, initially bounded to one verified calendar provider.
- One useful appointment-preparation and follow-through workflow. Broad autonomous booking, sending, and external form submission are outside V1.

Suitable enterprise libraries, contracts, and skill/tool/workflow machinery may be reused through deliberately versioned interfaces after rights review. Home must isolate its configuration, credentials, data, logs, sessions, names, and background jobs. Enterprise LunaOS is proprietary; Home's license does not authorize copying it. No enterprise source has been copied or packages extracted for this starter. See the [reuse boundaries](ROADMAP.md#architecture-and-reuse) and [authoritative repository rules](REPOSITORY_RULES.md).

An [offline native shell probe](docs/prototypes/native-shell.md) bundles the interface and shared review rules without a server. The Windows debug executable builds locally. Native GUI acceptance, Android builds and the native assistant connection remain unverified. This separate preview has no assistant connection or persistent storage; installer distribution is still gated.

## Run the starter

Install Node.js 24 or newer. From this repository's directory:

```sh
npm ci --ignore-scripts
npm start
```

Open <http://127.0.0.1:4173>. Stop the server with Ctrl+C. The server listens only on loopback, serves allowlisted assets and provides the in-memory draft review API. If port 4173 is occupied, stop the other process using it first. Do not expose this preview on a network.

For the assistant-backed preview, configure a local client to launch `node` with the absolute path to `assistant.js`; open the URL it returns, normally <http://127.0.0.1:4183/#vault>. This instance is separate from the standalone preview. Keep the client running while reviewing. See [connection instructions and checks](docs/prototypes/draft-review.md). Use fictional or generic content only. There is no vault save or export function. Dependencies and license review are recorded in [THIRD_PARTY.md](THIRD_PARTY.md).

## Develop and contribute

Track the vault feature in the [GitHub project](https://github.com/orgs/F2iLLC/projects/4) and [epic issue](https://github.com/F2iLLC/lunaos-home/issues/2). The first two build sessions and remaining workstreams are linked sub-issues with dependencies.

```sh
npm test
```

Tests cover checklist regression, local HTTP controls, draft validation/revision/review behavior and a real stdio protocol round trip sharing GUI state. The protocol test needs no model subscription; a real model/client check is documented separately. Application files are in `src/`; `server.js` provides HTTP and `assistant.js` provides MCP. For a browser check, review a fictional draft, try a correction and switch family members. Checklist tasks clear on reload; drafts clear on process exit or discard.

Dependabot is configured for weekly npm, Cargo and GitHub Actions version-update PRs. Security alerts and automatic security fixes are enabled on the repository. Updating dependency versions does not authorize merging them or re-enabling Actions.

- [COLLABORATORS.md](COLLABORATORS.md): roles, contribution workflow, review, and publication evidence for human and AI workers.
- [REPOSITORY_RULES.md](REPOSITORY_RULES.md): authoritative team rules for repository contents, sensitive data, rights, and public contribution safety. These are project contribution rules, not extra downstream license conditions.
- [ROADMAP.md](ROADMAP.md): planned V1 and distinct public-source/V1 release gates; not a claim of implementation.
- [User-controlled shared vault epic](docs/epics/user-controlled-vault.md): onboarding, device pairing, configurable unlocking, recovery, delivery stories, and acceptance criteria.

GitHub Actions is enabled for this repository. Public PR tests use fresh standard GitHub-hosted `ubuntu-24.04` virtual machines. Home is excluded from organization and enterprise self-hosted runner groups and repository-level runner creation; the [CI setup and acceptance handoff](docs/ci-actions-setup.md) records the two successful synthetic fork runs and remaining acceptance evidence. This does not change other F2iLLC repositories' runner choices. Follow the [repository rules](REPOSITORY_RULES.md#ci-and-untrusted-contributions) and report vulnerabilities through the [private reporting route](REPOSITORY_RULES.md#vulnerability-reports).

## License

Newly authored Home code and accompanying documentation are licensed under [Apache License 2.0](LICENSE). Third-party material, if later included with authorization, retains its applicable notices and terms. The package's `private: true` prevents accidental npm publication; it does not change the license or GitHub visibility.

Apache-2.0 permits commercial use and proprietary downstream derivatives, includes a contributor patent grant with conditions, and requires applicable license, change, and attribution notices when redistributing. It grants no blanket trademark rights. The [official license text](https://www.apache.org/licenses/LICENSE-2.0.txt) is authoritative. Team workflow and privacy rules do not add restrictions to that license. No copyright ownership is inferred from the GitHub organization, and this license does not relicense enterprise LunaOS.
