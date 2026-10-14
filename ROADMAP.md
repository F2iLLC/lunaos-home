# Proposed V1 roadmap

This is product scope for discussion and implementation, not an implementation report, release promise, or dated schedule. Today only the session-only checklist works. The [repository rules](REPOSITORY_RULES.md) govern all milestones, and [COLLABORATORS.md](COLLABORATORS.md) assigns decision ownership.

## V1 goal

An ordinary household user can use an existing AI subscription plus a local Home GUI to prepare for one appointment and follow through on its requirements. They can see relevant household calendars, use reviewed information from the correct person's local profile, understand what Home can access and do, and review useful results without having to understand MCP internals.

The GUI and MCP interfaces share local services, authorization, and state. The user's own Claude or ChatGPT hosts conversation/voice; Home supplies tools, onboarding scripts, and workflows. Home shows its own observed activity, not a supposed complete view of the assistant or unrelated connectors.

## Scope and proposed first combination

Propose Windows 11, one verified Claude desktop client/version, and Google Calendar as the first development combination. These are candidates to validate in milestone 1, not current compatibility claims or installed integrations. Validate one user-selected external AI document-analysis provider/adapter for the initial release; do not assume the assistant subscription includes an API key or covers separate analysis charges. Record the exact client, plan, platform, provider permissions, processing terms, and any separate charges before offering setup.

Evaluate ChatGPT and voice/tool operation explicitly, but expand the support matrix only when tested. If a proposed combination cannot reach local MCP or perform the required workflow safely, select a verified alternative with the owner before committing to it. Do not expose a local vault to the public internet as an implicit workaround. Unsupported voice combinations must be labeled; offer text plus on-screen review rather than claim voice support. The owner must accept the supported V1 experience at the compatibility gate.

| In V1 | Outside V1 / later |
| --- | --- |
| Scoped local discovery, GUI access/activity/results views, and Home MCP tools over shared local services | Arbitrary filesystem scans; a separate GUI engine; full visibility into external assistant activity |
| Local per-person profiles/folders for records and reusable information, with established protected storage and credential facilities | Operator-hosted vault, operator custody, cloud backup/sync, a new password manager or custom cryptography |
| Selected document-photo intake, explicit external-analysis choice/consent, review/correction, and person assignment before save | Bulk unreviewed imports; silent guessing; local-model analysis in the first release |
| Needs-led onboarding and purposeful MCP choices in a verified assistant environment | A new Home voice service, central third-party connector control, universal client/voice/MCP promises |
| Read/write unified calendar for multiple people/accounts from one verified provider: view, create, update, and delete events on authorized calendars, with person/source filters | Every calendar service, attendee invitations/notifications, or cross-provider conflict resolution |
| Appointment preparation, reviewed local form drafts, manual recording of confirmation, local follow-through/reminders | Autonomous booking, external form submission, sending messages, payments, or unattended external commitments |

V1 calendar writes must use scoped authorization, visible intent/results, and a local audit trail; already-authorized routine actions should not require repeated prompts. Show the target person/account/calendar and the proposed change, including whether a recurring-event change affects one occurrence or the series. Creating a calendar entry does not book an appointment with a provider. V1's external document-analysis upload is explicitly authorized per selected content/provider and is not permission to book or submit anything. Attendee invitations/notifications remain outside V1; do not perform a calendar write if the provider cannot avoid those external messaging effects.

## Architecture and reuse

Use one local application service layer for discovery, permissions, vault/profile operations, calendar normalization, and workflow state. The GUI and Home-owned MCP tools call those same services, so policy and state cannot diverge. Keep an explicit representation of configured access, verified access with a timestamp, attempted actions, and observed results/errors. Display origins and freshness, and mark external activity unknown when Home cannot observe it. Discovery starts from locations/configuration the user chooses; seeing a path is not permission to read it.

Evaluate suitable enterprise LunaOS contracts, libraries, and skill/tool/workflow machinery before rebuilding the same capability. Reuse only through deliberately versioned interfaces after written rights authorization and license review. Enterprise LunaOS is proprietary, and its workspace packages have substantial product dependencies; they are not independently consumable Home packages today. No enterprise code is copied or extracted by this plan. Do not bring over the full enterprise runtime or build a Home voice service just to reuse code.

Home needs separate configuration, credentials, data/vault, logs, sessions, event/tool names, and background-job identity. Before reuse, examine configuration/environment discovery, inherited child-process environments, relative transcript/knowledge/memory paths, scheduler queues, and worker namespaces. Existing collision checks and tool prefixes do not prove data or security isolation. Test operation beside an enterprise configuration without loading it or altering it. Shared code must not force public contributors to access private enterprise repositories.

## Sequential milestones

### 1. Verify a useful supported combination

**Outcome:** a user sees an honest setup path and knows which features their existing assistant environment supports.

**Depends on:** owner acceptance of the proposed V1 boundaries; rights review before selecting shared components; access to test accounts/client versions without collecting household records.

**Acceptance:** demonstrate one harmless synthetic local MCP request and response in the proposed assistant/client; verify GUI connectivity; document exact versions/plans and any analysis charges. Test voice/tool interaction separately from text/tool interaction and record unsupported combinations. Confirm the initial calendar provider supports reading multiple authorized test accounts and scoped event creation, updates, and deletion on writable calendars without attendee invitations/notifications. Verify that read access alone does not grant write authority. Select one external-analysis adapter after reviewing consent/handling requirements. Use synthetic data only. Decide an authorized versioned reuse approach or a small original implementation when rights/dependencies block reuse. No compatibility assumption counts as a pass.

### 2. One observable local service through GUI and MCP

**Outcome:** users understand what Home is configured to access, what it has actually verified, what it tried, and what happened.

**Depends on:** milestone 1's supported combination and access model.

**Acceptance:** the GUI and MCP perform the same harmless operation against one shared state/service. A user chooses a synthetic fixture location; unrelated locations remain untouched. The GUI shows configured and verified permissions distinctly, timestamps attempts/results, explains errors in plain language, and shows unknown external activity honestly. Revoke permission and demonstrate that both interfaces deny subsequent access and pending work stops where possible. Test unauthorized paths, misleading document/tool instructions, failed requests, keyboard navigation, and understandable nontechnical labels. Do not count a queued action as success.

### 3. Protected local profiles and reviewed document intake

**Outcome:** users can organize information for the correct person and reuse it without retyping or accidentally exposing another person's records.

**Depends on:** shared authorization/state from milestone 2; a reviewed storage/key-management design using established libraries and operating-system credential facilities.

**Acceptance:** create two fictional household members with separate folders/profiles outside the checkout. Verify record encryption at rest, key handling, lock/unlock, and a documented user-controlled recovery process; test restart and denied access before allowing real sensitive use. Keep passwords/tokens in established credential facilities with scoped references/operations, never raw model responses or whole-vault returns. Demonstrate that folder organization alone grants no access.

Select a synthetic document photo and intended person, choose the analysis provider, and show exactly what will leave the local environment, why, and the provider's handling/retention limits before consent. Rejecting consent sends nothing; accepting sends only the selected content. Home must not guarantee provider practices or zero retention. Show extracted fields and source, flag missing/uncertain values, allow corrections and person reassignment, and save only after review. Test wrong-person prevention, interrupted analysis, revocation, and absence of secrets/raw documents in diagnostic output. Manual entry remains available if analysis is declined or unavailable. Local-model analysis stays a later option.

### 4. Assistant-led household onboarding

**Outcome:** users discover useful functions for their household and choose relevant connections with clear access explanations.

**Depends on:** verified assistant/client behavior and milestones 2–3.

**Acceptance:** a synthetic household completes needs-discovery questions, maps its priorities to capabilities and relevant MCP choices, and can decline individual connections without blanket enablement. Explain each option's purpose/access; configure third-party connections in the user's own assistant environment. Home confirms only access it can verify. Scripts guide per-person setup and document review through conversation, with voice only in a combination proven in milestone 1 and on-screen review for fields/consent. No new Home voice service. Test a disconnected provider and an unsupported client so setup does not falsely report completion.

### 5. One trustworthy household calendar with read and write access

**Outcome:** users see multiple people's schedules together, isolate one person/account/source, and create, update, or delete events on authorized calendars without confusing ownership.

**Depends on:** milestones 2 and 4; verified read and scoped write permissions for the single initial provider, with shared authorization and local audit evidence through GUI and MCP.

**Acceptance:** connect at least two synthetic people's test accounts and show a combined page plus person/source filters. Preserve provider, account, calendar, event ID, and recurrence-instance identity where applicable. Repeated refresh does not duplicate the same source event; shared invitations are not silently merged across owners. Demonstrate time zones, all-day/recurring events, pagination, expired authorization, disconnected sources, and stale/offline results with explicit freshness. GUI and MCP return consistent authorized data.

Create a fictional event, update it, and delete it through both interfaces on selected writable test calendars; verify the provider's resulting state and retain minimal local audit evidence of authorization, target, attempt, and result. Demonstrate that read-only accounts and unapproved calendars reject writes. Show single-occurrence versus whole-series edits explicitly. Test concurrent edits, ambiguous timeouts, and retries without duplicate creation or repeated destructive changes: reconcile provider state before retrying and surface unresolved outcomes instead of claiming success. Revocation stops new reads/writes and prevents queued work from executing; explain any in-flight operation that cannot be undone. Never interpret access to the combined view as authority to modify every contributing calendar.

### 6. Complete appointment preparation and follow-through

**Outcome:** a household user assembles the correct information, reviews preparation material, and tracks what remains without handing over external commitments.

**Depends on:** milestones 3–5 and the shared workflow state.

**Acceptance:** run one complete fictional scenario: choose the household member and appointment need; inspect the calendar for workable times; select reviewed profile fields and document references; produce an on-screen preparation checklist and request/form draft; flag missing details; record a confirmation received outside Home with its source; create the corresponding event on an authorized calendar and verify it was saved; track outstanding paperwork and deadlines; trigger a local reminder. Unknown or unverified confirmations remain labeled that way, and a saved calendar event is not evidence of a provider booking. Verify event changes/deletion, workflow cancellation, restart/retry without duplicate events or reminders, revocation, and errors. Reminders and jobs must use Home-specific identity and stay local. No message, provider booking, or external form submission is performed by this V1 workflow.

A nontechnical evaluator must complete this scenario from setup without developer help and correctly explain what Home accessed, what it sent for analysis, and what remains manual. Keep only sanitized acceptance outcomes in project review. Any later real-household pilot requires separate user authorization and local handling under the repository rules; real records never become fixtures or release evidence.

## Release gates and unresolved decisions

**Public source release:** separate from usable V1. An owner-authorized release can publish the honest starter/roadmap after the [public source checklist](REPOSITORY_RULES.md#public-source-release-checklist) passes: history/secret/rights review, contributor-independent build, tested isolated self-hosted trust policy, and a tested private vulnerability reporting route. Shared enterprise self-hosted CI passing today does not satisfy that gate. Do not change visibility as part of roadmap implementation or PR publication.

**Sensitive-use readiness:** before any real records or credentials, review and test the storage/key/recovery design, scoped authorization/revocation, external-analysis disclosure/consent, data minimization, and negative cases from milestones 2–3. No milestone title or encryption library alone establishes readiness.

**Usable V1 release:** all six milestones pass on the declared supported combination; a reviewer verifies access/privacy boundaries, failure/recovery behavior, and local/CI test evidence on the exact release commit; the nontechnical evaluation passes; documentation states verified support and remaining manual steps; the owner explicitly accepts and authorizes release. No release or deployment is performed by this roadmap.

Decisions still needed during implementation: verified first client/platform/provider versions and voice scope; one analysis adapter and its handling/charges; established storage/key/recovery facilities; authorized enterprise reuse boundaries; and the separate isolated self-hosted pool/trust policy plus private reporting route before public release. No dates, estimates, or support for every service are promised.
