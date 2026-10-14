# Epic: User-controlled shared vault

**Status:** proposed implementation plan; no vault, pairing, authentication, or data protection is implemented by the current starter. This epic implements the vault foundation of [roadmap milestones 1–4](../../ROADMAP.md). Publication is not security acceptance or permission to use real records.

**Tracking:** [User-controlled shared vault epic](https://github.com/F2iLLC/lunaos-home/issues/2). Merging the planning document does not close the implementation epic.

## Product outcome and owner decisions

A household can keep its information on its own devices, with **one vault per household member**, choose how to unlock it, and access each authorized vault from a phone and a computer. “Shared” means access to the same person's vault across explicitly connected devices and granted access; it does not mean pooling everyone's records into one household vault. A phone-only user can complete setup and use the vault without owning a computer. Onboarding establishes where information lives before asking for records or credentials.

The owner has specified:

- One vault for each household member, shared across that member's authorized devices rather than unrelated copies the user must reconcile. Access to one member's vault does not grant access to another's.
- Assistant-guided onboarding asks where to keep information, sets up the vault on a phone for phone-only use, or guides the connection between the phone and computer.
- Private information stays on the user's private devices by default. Home provides no hosted vault, custody, recovery service, cloud synchronization, or image-analysis service.
- Unlocking is configurable: a supported phone passkey/device authentication method, operating-system authentication on the computer, or a separate vault password. These are choices to verify on supported platforms, not universal compatibility claims.
- Optional image-analysis onboarding sends only images the user chooses to their own ChatGPT, Claude, or another selected provider. This is an explicit external disclosure, not local processing. The provider never receives general vault access. The user reviews returned information before saving it locally.
- Users can create, view, edit, and delete their authorized records directly, or delegate record creation, modification, and deletion to their chosen AI assistant. Minimize user effort: the assistant executes authorized operations, rather than merely giving instructions for the user to repeat. Modification includes correcting fields, replacing an attachment, changing categories, and an explicitly authorized move to another person's vault.
- The home screen offers **What would you like to do today?** as an expandable action button. It reveals feature choices, including a proposed **Open my vault** entry. Final feature wording can be refined through nontechnical testing.
- All user-facing language must be understandable without technical knowledge. The account-access category is **Sign-ins**, not “Credentials.” Technical vocabulary remains acceptable in development documentation.

“Local” means the user's explicitly enrolled private devices. Access from a paired phone to a computer-held record necessarily transfers that selected information between those devices over a protected connection; onboarding must say so. It does not mean that a record can appear on another device without a transfer. Sharing devices and granting household members access are separate decisions.

## Starting record types

These are the proposed first catalog and plain-language labels. Templates organize information; they do not imply validation by an issuer, medical advice, or a complete specialist records system.

| User-facing type | Contents and examples | Boundary |
| --- | --- | --- |
| People | The vault owner's profile: name, contact details, relationships, and links to their records. A household selector opens each authorized person's separate vault. | A person profile is not a login account or permission grant. The selector must not expose another person's private profile without permission. |
| Personal details | Reusable structured records, with initial templates for identification/licensing, insurance, medications/allergies, school details, and provider contacts; allow a user-defined category and fields. | Save reviewed values with their source. A driver's license or professional license belongs here, with its image under Documents and photos, not under Sign-ins. No clinical interpretation or inferred facts. |
| Documents and photos | Selected images, supporting PDFs, forms, cards, and letters, linked to a person and optionally a structured record. | Define supported file types/size limits in implementation; no executable attachments or automatic external analysis. An image and the reviewed details extracted from it are separate linked records. |
| Notes | Private free-text instructions, preferences, and context linked to a person or record. | Treat text as data, not executable instructions. Do not encourage pasting passwords here. |
| Sign-ins | A recognizable service/account entry linked to protected passwords, tokens, or recovery codes where the chosen secure storage supports them; references to device-managed passkeys where supported. | Use established credential storage. Do not imply that passkey private keys can be read, copied, or exported. Showing a secret locally, if implemented, requires explicit local authorization and must never return it to a model. |

Each type must support authorized **create, view, edit, and delete** in the local GUI, with create/update/delete operations also available through the assistant/MCP interface. Both routes call the same service and enforce the same per-vault permissions. Include category changes, attachment replacement, and deliberate moves between persons' vaults. Honor an explicit request or existing scoped delegation without asking the user to repeat approval for every routine operation. Request clarification for an ambiguous target and new authorization for actions outside the grant. Validate required fields, preserve source/review information, and detect stale edits rather than silently overwriting another device's changes. No compulsory secret reveal or copy-to-clipboard feature is implied by viewing a Sign-ins entry.

Moving a record between persons requires access to both vaults, explicit source/destination, and a recoverable operation that cannot silently lose or misassign it. Separate vault identity, authorization, lock state, and protected encryption keys must enforce the boundary; folders or display filters alone are insufficient. An authorized household manager can manage multiple vaults through distinct grants, without being treated as the owner of every person's data by default.

Deleting a person with linked records must show the impact and require a choice to reassign or delete those records; never silently cascade. Deleting a document must explain any retained reviewed details or references. Deleting a Sign-ins entry must explain whether Home is removing its reference or also removing an item it owns in protected storage; it must not delete an unrelated OS-managed passkey or change the external account. The local activity view records minimal outcomes without preserving deleted record contents.

Calendars, tasks, reminders, and appointment workflows are separate application features; they may link to vault records under their own authorization. Device grants, key material, and recovery configuration are system-managed security state, not editable generic records.

## Plain-language experience

Use familiar labels across navigation, onboarding, empty states, permissions, errors, and help. Explain what happens to the user's information and what they can do next. Technical explanations may be available in development docs or optional details, but must not be necessary to complete a routine task.

| Development concept | User-facing wording or explanation |
| --- | --- |
| Credential / secret reference | Sign-in; “Your password stays protected on your device.” |
| Authoritative vault host | “Where your information is kept” and “This device needs to be available.” |
| Device enrollment / pairing | “Connect your phone and computer.” |
| Authentication | “Unlock” or “Confirm it's you.” |
| Authorization / revocation | “What this device can access” / “Remove access.” |
| Provenance / extraction review | “Where this came from” / “Check these details.” |
| Concurrency conflict | “This record changed on another device. Review both versions before saving.” |

Do not replace precision with reassurance: for example, clearly say that sending a selected image to the user's AI provider takes it outside their devices. Do not label something “safe,” “connected,” or “saved” without the evidence that supports that state. The nontechnical acceptance test must show that users can distinguish Sign-ins from licenses, choose where information lives, understand the selected-image disclosure, and recover from an error without knowing MCP, cryptography, or networking terms.

## Delegation with minimal user effort

Manual controls and assistant delegation are equal supported paths. A user can ask their own ChatGPT or Claude to add, change, or delete records. For example, after selecting a fictional note locally, “Delete this note” should execute that specific authorized deletion and report the observed outcome; it should not become a tutorial requiring the user to repeat the operation in the GUI.

Set up a revocable grant for the selected assistant/client, person/vault, allowed record types or records, operations, and duration. Create, edit, delete, and disclosure/read authority are separate permissions. A grant may cover routine future requests within its scope; no mandatory confirmation per record is imposed. The user can inspect/change/remove it locally. Deleting an entire vault, changing security/recovery settings, granting access to someone else, and cross-vault moves are not implied by ordinary record-management authority.

Keep data local by separating **permission to act** from **permission to disclose content to a hosted model**. The local app can supply short-lived scoped record handles or staged changes so an assistant can request an operation without receiving a record's private contents. Handles must be checked against the caller's grant and vault; possession alone is not authorization. Return a minimal accurate completion/conflict/denial result, with private details visible locally. Never return passwords, recovery material, or vault keys.

If the user types private values into their chosen hosted assistant, those values have already been disclosed to that provider; do not describe that conversation as device-only processing. If a delegated task needs Home to send existing private fields to the model, explain the selected fields, destination, and purpose and obtain scoped disclosure permission first. This may be an explicit grant for the task rather than repeated prompts for each field; absent permission, execute through local references/staged values or ask for the missing choice. Blanket vault access is never implied by delegation.

Assistant-proposed changes must pass the same validation, per-vault checks, record-version checks, and safe retry rules as manual changes. Prompt text in documents or returned analysis cannot grant permissions. Recheck authorization at execution; lock/revocation stops queued and subsequent work. Show what changed and whether it actually saved, with minimal local activity evidence. Define undo/recovery availability honestly, rather than promising every deletion can be reversed.

For selected-image analysis, a verified assistant/MCP route may return proposed structured results directly into local review, avoiding manual retyping or copying. The selected-image disclosure and review requirement still apply; a proposal is not a committed record until the review decision is supplied. Manual handoff remains a fallback, not the only target experience. Purely routine, already-authorized record changes do not inherit this extraction-specific review gate.

## First supported experience

1. From the home screen, **What would you like to do today?** expands feature choices, including **Open my vault**. Choose the authorized person's vault when needed; first use offers setup. The assistant can also start the same workflow conversationally. During setup, choose **Keep it on this phone** or **Use my phone and computer**. Unlock secrets and security confirmations stay in the trusted local app/OS interface, never voice chat or a model prompt.
2. For two-device use, choose which device holds the authoritative vault. Explain availability: that device must be reachable and the vault available for authorized access. Detect capabilities only after permission; show unsupported combinations honestly.
3. Show the local storage destination and device identity in plain language. Choose an app-private location outside the repository and cloud-synchronized folders, and verify supported OS backup exclusions before importing records.
4. Choose a supported unlock method and a recovery arrangement. Demonstrate unlocking and recovery limitations before continuing; canceling leaves setup incomplete.
5. For paired use, guide installation/launch on the second device, establish a short-lived pairing exchange, and require identity confirmation on both devices. Explain what the new device may access before granting it. The assistant cannot approve pairing on the user's behalf.
6. Create one vault for each household member being set up, with a profile inside each; use fictional examples during development/acceptance. Select the intended vault explicitly. Person assignment is required; a profile is not an authenticated account or an access grant.
7. Offer manual entry, selected local document import, or optional analysis in the user's chosen external assistant. Show the privacy difference. Declining analysis still completes useful setup.
8. Review and save imported information, then show where it lives, how to unlock it, which devices/assistants have access, and how to lock or disconnect them. Offer direct management or delegated creation/editing/deletion with understandable permissions. Test actual connectivity and authorized operations before reporting success.

The desktop layout and phone layout use the same service contracts and permission rules. A responsive webpage alone does not establish native storage, key protection, background availability, or installable application support.

## Proposed architecture and bounded scope

For the first implementation, propose **one authoritative host per vault** with authenticated direct access from a paired device. The host can be the phone or computer; phone-only mode runs the same service locally. This avoids a second writable replica and conflict-resolution engine in the first slice. Confirm the hosting/transport choices in the platform spike, especially mobile suspension and background limits. Do not silently substitute a desktop requirement for phone-only support.

Start with a verified same-network or direct local connection. Internet relay services, public vault endpoints, automatic port forwarding, remote access from anywhere, unattended multi-device synchronization, offline replicas, and automatic failover are outside this epic. If the host is asleep, offline, locked, or disconnected, show the correct unavailable/locked state; do not imply a successful save or retain an undisclosed plaintext cache. If remote or offline access later becomes necessary, plan it explicitly with its custody and consistency consequences.

One shared VaultService enforces actor, enrolled device, vault, person, record, action, and authorization scope on every operation. GUI and MCP are adapters to that service, not separate policy engines. Local authentication proves who may attempt access; it does not by itself authorize every record. Network presence, knowledge of a path, a household profile, and a pairing code alone do not grant permanent access.

| Component | Required boundary |
| --- | --- |
| Local vault storage | Encrypt records, documents, and sensitive metadata; use a reviewed maintained storage/encryption facility. Stable opaque IDs must not reveal person names in filenames. Atomic writes, versioned schema, integrity checks, and migrations preserve recoverability. |
| Key and credential adapter | Use established platform facilities and reviewed libraries. Keep vault keys separate from encrypted data. Reusable integration secrets use protected credential storage and scoped references; no raw secret appears in model output. |
| Local GUI | Own storage selection, unlock, pairing approval, access management, private records, import review, recovery, and meaningful error presentation. OS authentication remains in the OS prompt. |
| Paired-device connection | Mutual authentication, encrypted transport using a maintained protocol, bounded permissions, replay protection, expiry, disconnect, and revocation. A local network is not trusted merely because it is local. |
| Assistant/MCP adapter | Guide setup and invoke authorized local operations. Return minimal non-sensitive status by default; keep private names, paths, document contents, and profile values out of hosted model context unless covered by explicit selected-content disclosure permission. Keys and authentication secrets never enter model context. Private on-screen results are not automatically tool responses. |
| Local activity view | Distinguish configured, verified, attempted, and observed outcomes with freshness. Keep minimal audit evidence locally without record contents or credentials. Home cannot observe unrelated assistant actions. |

Storage selection must consider OS/cloud backups, synchronized folders, temporary files, previews, clipboard, notification contents, crash reports, and logs. No Home telemetry or hidden upload. Explain any platform limitation and prevent unsupported storage configurations from being presented as verified local-only storage. Do not claim protection against a compromised OS or an attacker already controlling an unlocked authorized device.

## Configurable unlocking and recovery

Unlock choices must actually control access to protected key material, not merely dismiss an app screen. Startup is locked. Manual lock is always available; configure inactivity and lock-on-suspend policies without silently disabling protection. Changing or removing an unlock method requires local reauthentication, a verified replacement/recovery path, and a transactional update that cannot strand the vault.

| User choice | Implementation investigation and acceptance |
| --- | --- |
| Use phone security / a passkey | Verify a device-bound method and its key-release mechanism on the chosen mobile target. Ordinary passkey authentication is not automatically an encryption key. Check whether the selected credential/provider synchronizes secrets off-device; do not offer an unverified synced credential as device-only protection. Show only tested options. |
| Use computer security | Use supported OS authentication and protected key storage. Never ask Home or the assistant to collect, store, or reuse the Windows account password. Verify the actual supported OS prompt and fallback; do not relabel a Windows Hello PIN as the Windows password. |
| Set a vault password | Use a maintained password-based key-protection facility with a unique salt and reviewed resource parameters; never use the password directly as an encryption key or invent a cryptosystem. Verify wrong-password behavior, password changes, and resistance to offline guessing. Local retry controls alone do not protect a copied encrypted vault. |

Authentication and vault-key recovery are separate. Losing the device, resetting OS authentication, losing a passkey, or forgetting a vault password must have a documented outcome. Offer a reviewed user-held encrypted backup/recovery method on user-controlled local media; no operator escrow or cloud reset. Explain that without a working recovery path some loss is irrecoverable. Backup creation alone is not recovery evidence: demonstrate restoration on a clean supported device with synthetic records. Device-bound integration credentials may require re-entry; never promise they are portable.

These are design requirements. [Microsoft's Windows Hello documentation](https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello) describes device-specific authentication and protected key operations; it does not by itself select a vault-encryption design. [The W3C WebAuthn PRF explainer](https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md) describes an additional capability relevant to deriving key material; availability must be tested on the actual client/authenticator. [OWASP's cryptographic storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) informs threat modeling and key separation. No library or platform is approved by citation alone.

## Selected image analysis without Home custody

This optional path is an explicit selected-content exception to keeping record content on private devices. Use the user's own chosen assistant/provider; do not introduce a Home analysis backend or assume a subscription supplies an API key.

1. The user chooses a specific image and destination. Explain that it will leave their devices and be handled under that provider's policies. Never promise zero retention or that deleting Home's local copy deletes provider history.
2. The user attaches the selected image in their own provider app, or uses a verified selected-image handoff they explicitly authorize. Home can give generic instructions and a structured field template, without embedding private data in that template. Do not claim an upload occurred or analysis succeeded unless actually observed; manual handoff remains labeled user-reported.
3. The assistant can submit proposed structured results through a verified scoped MCP operation for local review; manual return remains available when unsupported. Verify and restrict the return integration; provider responses are untrusted input, not instructions or authorization.
4. Show proposed values, source, uncertainty/missing fields, and intended household member. Let the user edit/reassign them, then save only after explicit local review. No automatic overwriting, guessing, or cross-person assignment.
5. Decline, cancel, provider failure, and partial results all leave manual entry available. No general filesystem access, vault-wide grant, background extraction, or analysis API billed by Home is required.

Consent for one image is not permission for further images, vault browsing, sending credentials, calendar writes, or external commitments. A private-data tool response or other export needs its own purpose/destination/scope decision as described in the delegation contract; it is not implicitly approved by pairing or general assistant setup.

## Delivery stories and acceptance

Story IDs below are planning references, not claims of created child issues or completed work. Split into implementation issues after plan review. All examples and evidence must be synthetic.

| Story | Depends on | Reviewable outcome and acceptance |
| --- | --- | --- |
| VLT-01: Prove platforms and the privacy model | None | Record first mobile OS/device and desktop OS/client versions, app packaging, local storage/backup exclusions, available unlock/key facilities, assistant connectivity, and direct pairing transport. Prove phone-only launch/unlock while offline and phone/computer connection with fictional data. Document mobile suspension behavior and reject unsupported combinations. Record dependency rights, threat model, host choice, and recovery decisions before implementation expands. |
| VLT-02: Shared authorization and storage contracts | VLT-01 | Define stable vault/person/record/device IDs, separate per-person vault keys and lock/access state, schema/versioning, permission checks, typed errors, and minimal activity outcomes in one service. Include per-assistant create/edit/delete grants and distinct disclosure permission. GUI and MCP cannot bypass scope checks. Tests deny unrelated persons, stale grants, path traversal/reparse escapes, and untrusted document instructions. |
| VLT-03: Encrypted vault and unlock lifecycle | VLT-02 | Create outside checkout/cloud-sync locations, lock/unlock with each supported configured method, restart locked, safely change methods, and protect key/secret material. Test wrong credentials, OS credential reset, tamper, disk full, interrupted writes, and failed migrations without exposing plaintext or corrupting the last committed state. |
| VLT-04: Phone-only onboarding and household records | VLT-03 | A nontechnical user chooses storage/unlock/recovery, creates two fictional members with separate vaults, and creates/views/edits/deletes examples of all five record types. Exercise the expanding home action button, authorized vault selection, and denial of cross-vault access. Test templates/custom fields, attachment replacement, explicit reassignment, deletion of linked records, scoped Sign-ins references, and restart. Canceling setup or review does not claim success. Touch, keyboard, accessible labels, plain-language prompts/errors, and desktop layout work. |
| VLT-05: Guided phone/computer pairing | VLT-03; final end-to-end acceptance uses VLT-04 | Guide install/connect, approve identities and scopes on both devices, and access the same authoritative record. Test expired/replayed/wrong pairing codes, rogue peers, lock/disconnect/revocation, host sleep, interrupted writes, concurrent stale edits, and reconnect without duplicate mutations. No vault key or record in the pairing QR payload, hosted chat, or public URL. |
| VLT-06: Delegated record management and analysis handoff | VLT-04; paired path uses VLT-05 | In each declared supported ChatGPT/Claude client, demonstrate delegated create/edit/delete for all five record types with the same per-vault rules as the GUI. Honor routine grants without repeated confirmation; clarify ambiguous targets, reject cross-vault/expired grants, and report actual results. Test operation through opaque local handles without disclosure, and separately permitted selected-field disclosure. Verify structured analysis-result submission to local review; manual return remains a fallback. No raw sign-in secrets or broad vault grant. Record unsupported clients honestly. |
| VLT-07: Recovery, device removal, and data lifecycle | VLT-03 and VLT-05 | Restore a user-held encrypted backup on a clean supported device, verify records and schema, require fresh device enrollment, and re-enter nonportable credentials. Test wrong keys, tampered/incomplete backups, and unsupported versions. Remove a device and reject its old grants on reconnect. Explain retained originals/backups and inability to erase data already viewed/copied on another device. |
| VLT-08: Independent security and household acceptance | VLT-01 through VLT-07 | Run both journeys below, plain-language comprehension checks, and the negative-case matrix on declared mobile/desktop targets. A second person reviews privacy/key/authorization/recovery decisions and evidence. Owner accepts supported behavior and remaining limits before sensitive use. CI evidence is separate from local verification; no implementation or release gate is passed by this plan. |

First implementation PR: VLT-01, with a bounded synthetic feasibility prototype and decision record. Do not begin by moving real records or building a full password manager. No estimate or delivery date is asserted before the platform and pairing spike resolves the major risks.

## Acceptance journeys and failure matrix

**Delegate or do it yourself:** from the expanding home menu open an authorized person's vault, manage a synthetic record directly, then grant a supported assistant permission to create, edit, and delete selected records in that vault. Complete those operations conversationally without repeating them in the GUI or reconfirming an in-scope request. Verify saved state locally, reject a request against another person's vault, clarify an ambiguous deletion, exercise a stale edit/retry, and revoke access while work is queued. Demonstrate both opaque local references without private disclosure and an explicit selected-field disclosure grant. Record the number of user steps and remove unnecessary re-entry/confirmation while retaining required choices and accurate results.

**Phone only:** after installation, with no computer and no internet, launch the supported local app, choose phone storage and unlocking, create two fictional profiles in separate vaults, save a reviewed synthetic record, lock, restart, unlock, and recover it. Optional hosted image analysis requires internet and remains a distinct opt-in; its absence must not block manual onboarding.

**Phone and computer:** for each person's vault, choose the authoritative device, enroll the other with confirmation on both, save a synthetic record on one interface and verify its committed version through the other. Test both supported host directions. A sleeping or suspended phone host must be shown unavailable where the platform cannot maintain service. Revoke the paired device and verify that subsequent operations, queued requests, and reconnections are denied. Repeat setup with a declined pairing request; no device is enrolled.

| Risk / failure | Required evidence |
| --- | --- |
| Undisclosed external disclosure | With synthetic canary content, inspect Home traffic, model/tool payloads, logs, caches, backups, and diagnostics. With analysis and selected-field disclosure declined there is no record egress beyond explicitly enrolled devices. Delegated local operations still work without returning private content. With selected analysis or field disclosure, only the explicitly selected content goes to the authorized provider; any manual provider action is distinguished from Home-observed traffic. |
| Wrong person or excessive permission | Two separate person vaults, multiple scopes, and an unenrolled client demonstrate denied reads/writes through GUI and assistant. Locking or granting one vault does not unlock/grant another. Cross-vault moves require both grants and explicit destination. Pairing is not unrestricted household access. |
| Secret leakage or weak unlock gate | No raw credential, key, or recovery material appears in model results, logs, plaintext persistence, or pairing payloads. Private fields appear in model results only under an explicit scoped disclosure grant, never incidentally in status/errors. Canceled/failed OS authentication denies access. An app-screen bypass cannot decrypt data. |
| Network attack or duplicate operation | Mutual identity checks, encrypted connection, replay rejection, timeouts, idempotent mutation IDs, and version conflicts are exercised with a synthetic hostile peer. A timeout is an unknown outcome until reconciled, not permission to blindly repeat a write. |
| Lock, revoke, or device loss | Check authorization again when work executes; stop queued/new access and close sessions. Document any completed/in-flight disclosure that cannot be recalled. Pairing grants and sensitive caches do not resurrect after reinstall or restore. |
| Crash, corruption, or lost credentials | Interrupted write/migration, full disk, bad recovery key, malformed backup, and unsupported version fail without silently replacing recoverable data. Successful restore is verified, not inferred from archive creation. |
| Local document attack | Enforce types/size limits and reviewed preview/parsing boundaries. Embedded scripts, external resources, and prompt instructions cannot execute or expand permissions. Preserve originals; explain copies rather than claiming secure deletion from all storage. |

Deletion removes the selected active record and its indexes/references under the documented retention policy; existing user-held backups and original source images are separate copies. Do not promise remote wiping, forensic erasure on SSDs, or protection from an already compromised authorized endpoint.

## Gates, open decisions, and exclusions

The owner has decided one vault per household member shared across authorized devices, phone-only operation, onboarding-led location choice, configurable unlocking, local custody, direct or delegated record management with minimal user effort, an expanding home action menu, and optional user-provider image analysis. Remaining engineering decisions are the first mobile target, packaging/runtime, established storage/key library, supported unlock methods and recovery mechanism, direct transport, and safe mobile host availability. Present measured tradeoffs at VLT-01; never silently relax the local custody boundary to make a client work.

Deferred: cloud/relay hosting, remote access from anywhere, offline multiwriter sync, public unauthenticated endpoints, operator recovery, unattended third-party uploads, a Home analysis/model/voice service, general password-manager features, remote wipe, automatic migration between authoritative hosts, and full multi-user household identity administration. A safe reviewed export/restore can support an explicit move later; do not create two competing authoritative hosts accidentally.

Read/write calendar integration and appointment workflows remain separate roadmap work. This vault epic does not grant blanket authority to send private profile fields to them or to hosted models. Each external action retains its own destination, content, and scope boundary.

Apply [repository rules](../../REPOSITORY_RULES.md) and [collaborator responsibilities](../../COLLABORATORS.md). Use original or expressly authorized dependencies/material only. Keep public repository Actions disabled until isolated self-hosted execution is established. Real household data, credentials, screenshots, private device paths, and logs never belong in source, issues, PRs, or CI evidence. A second-person sensitive-design review and owner acceptance remain human gates; publishing this plan does not complete them.
