# Family vault: first two build sessions

These sessions implement the feasibility portion of the [user-controlled vault epic](user-controlled-vault.md), primarily VLT-01 with thin experimental slices of VLT-02/03/05/06/09. They do not finish those later stories or authorize real-record use. Use original or authorized components, synthetic fixtures, and reviewable PRs. [Repository rules](../../REPOSITORY_RULES.md) apply; public Actions remains disabled.

## Session 1: prove the app and assistant path

**Question to resolve:** can the chosen assistant produce a structured draft and show it in the same local Home interface on the intended desktop/mobile setup without contradicting the custody model?

**Inputs:** current starter; the epic's accepted product boundaries; access to test devices and supported assistant clients/accounts. Windows 11 is the proposed first desktop target. The first mobile OS/device is not selected yet; confirm it with the owner at the start. Record exact OS/app/client versions and plan requirements. An unavailable device/account is a concrete test gap, not evidence of compatibility.

**Bounded work:**

1. Select a candidate installable app/runtime approach and a maintained local tool/service integration. Document rights/dependencies before importing anything; do not copy proprietary enterprise code. Distinguish required platform facilities from a merely responsive web layout.
2. Build the smallest launchable prototype on the selected desktop and mobile targets. Exercise touch/keyboard navigation and a synthetic family-member selector in one Home GUI. This is a capability probe, not a finished visual redesign.
3. In each candidate ChatGPT/Claude environment, test a harmless workflow/tool request and return a structured fictional profile draft to Home. Verify what memory/context, connected-source tools, and GUI presentation are actually available. Use supplied fictional remembered facts and test-source fixtures; do not mine the user's real memories, Gmail, or calendar during this session.
4. Show the draft in the Home GUI. Test embedding only if its data path is supported and understood; otherwise prove opening a local window. Preserve task/draft identity without putting secrets or record values in a URL. No supported integration may be replaced by a fake success screen.
5. Demonstrate a selectable field marked **Needs review**, an assistant clarification prompt, and a corrected draft value. Use a synthetic library-membership or employment suggestion and show accept/decline. Stage drafts only; no production vault is required yet.
6. Identify candidate platform storage, unlock/key, backup-exclusion, and direct connection facilities for session 2. Document whether a phone can host the service while active and what must be tested about suspension. No custom cryptography or universal passkey assumption.

**Deliverables:** a reviewable prototype PR; reproducible install/launch instructions for tested targets; a compatibility matrix showing verified, failed, unavailable, and untested capabilities; a short architecture decision record; and a synthetic end-to-end draft/correction demonstration with its actual observed data path. Record whether both assistant providers worked, only one worked, or neither worked; do not imply success across untested clients.

**Exit checks:** the chosen mobile/desktop builds launch; at least one real candidate assistant path reaches the local draft GUI; marking a field routes to the correct draft and correction; no saved vault record is mutated; inaccessible memory/connectors and unsupported embedding are labeled accurately. An interface mock without an actual assistant round trip does not pass the integration check.

**Handoff:** recommend the first supported target/client combination and storage/connection candidates using evidence. If a required platform/client path is unsupported, report the exact gap and request the owner's scope decision before dropping support. Keep the next session bounded to the evidenced path; record missing-device tests explicitly.

## Session 2: prove local custody and the device connection

**Question to resolve:** can the selected local stack protect a fictional record, serve it over an explicitly approved phone/computer connection, and enforce the workflow's session boundary?

**Inputs:** session 1's tested targets, client route, architecture decision, and maintained storage/key/transport candidates; test devices on a private local connection. Do not substitute public tunneling, cloud storage, or an operator service to make the demo work.

**Bounded work:**

1. Build a thin encrypted-storage experiment using a maintained facility and the selected OS key-storage adapter. Save one synthetic record with a family member designation, lock/restart/unlock, and read it again. Inspect relevant files/temp/log output for accidental plaintext and test tampering. This does not complete the production storage/recovery design.
2. Show two fictional family-member views of the same protected store. Confirm an admitted family user can access both; confirm an unadmitted client cannot. Member labels do not create separate security compartments.
3. Exercise phone-only operation. For computer-held storage, guide and automate the supported bridge setup, require device identity approval, and authenticate/encrypt the direct connection using maintained facilities. Read the same committed fictional record through the phone GUI. Verify the phone-hosted direction to the extent supported; report background restrictions rather than concealing them.
4. Introduce the minimal real permission/session contract in the same local service used by GUI and assistant. An explicitly approved setup session permits creating/editing its selected synthetic records and no delete by default. End the session and prove subsequent and queued writes fail, including after restart/reconnect. Demonstrate a distinct read-only form-preparation grant rejects edits/deletion; the full forms workflow is out of scope here.
5. Test incorrect/expired pairing, host sleep or phone suspension, disconnect/reconnect, revoked access, and ambiguous write timeout. Return truthful unavailable/unknown/denied states. An unavailable host must not appear to save a record successfully.
6. Identify and, where feasible within the spike, exercise the chosen user-held backup/restore path with the synthetic record. If restoration is not proven, mark it unverified and carry a concrete recovery task into VLT-07. Do not call the vault ready for sensitive use.

**Deliverables:** a reviewable thin-implementation/prototype PR; a device-connection and local-custody decision record; reproducible synthetic checks for encrypted persistence, family access, pairing, and session expiry; a list of observed failure cases/open tests; and revised implementation stories and session estimate.

**Exit checks:** successful synthetic encrypted round trip on tested targets; phone-only path and computer-to-phone access demonstrated; approved family access and unauthorized-client denial shown; write grant expires and read-only grants reject mutations; private content is not returned to a hosted model without its disclosure scope. Record host-direction/background and recovery gaps as failures/unverified items, not implied passes.

**Handoff:** decide whether the chosen architecture is viable, what needs repair, and whether the provisional 15–20-session budget still fits. Keep production encryption/key/recovery review, complete CRUD, robust migrations, complete plugin packaging, and independent acceptance open until their later stories pass.

## Session evidence and boundaries

Each session ends with source/prototype changes published to a PR, actual remote-head verification, concise synthetic results, and explicit unsupported/unverified items. Do not mark the epic complete or use real family records. Tests must run locally or on approved isolated infrastructure; the existing disabled public workflow is not a source of CI evidence. A session can establish that a proposed approach does not work; that evidence still informs the decision, but it is not a successful capability demonstration.

The first two sessions establish feasibility. They do not promise production-ready security, all mobile platforms, every assistant version, app-store distribution, cloud synchronization, or a complete appointment/form system.
