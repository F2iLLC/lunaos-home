# Epic: User-controlled shared vault

**Status:** proposed implementation plan; no vault, pairing, authentication, or data protection is implemented by the current starter. This epic implements the vault foundation of [roadmap milestones 1–4](../../ROADMAP.md). Publication is not security acceptance or permission to use real records.

**Tracking:** [User-controlled shared vault epic](https://github.com/F2iLLC/lunaos-home/issues/2). Merging the planning document does not close the implementation epic.

## Product outcome and owner decisions

A household can keep its information on its own devices, choose how to unlock it, and use the same vault from a phone and a computer. A phone-only user can complete setup and use the vault without owning a computer. Onboarding establishes where information lives before asking for records or credentials.

The owner has specified:

- One shared vault, not unrelated device-local vaults that the user must reconcile.
- Assistant-guided onboarding asks where to keep information, sets up the vault on a phone for phone-only use, or guides the connection between the phone and computer.
- Private information stays on the user's private devices by default. Home provides no hosted vault, custody, recovery service, cloud synchronization, or image-analysis service.
- Unlocking is configurable: a supported phone passkey/device authentication method, operating-system authentication on the computer, or a separate vault password. These are choices to verify on supported platforms, not universal compatibility claims.
- Optional image-analysis onboarding sends only images the user chooses to their own ChatGPT, Claude, or another selected provider. This is an explicit external disclosure, not local processing. The provider never receives general vault access. The user reviews returned information before saving it locally.
- Users can create, view, edit, and delete their authorized records. Modification includes correcting fields, replacing an attachment, changing categories, and explicitly reassigning the person; none may bypass review or permissions.
- All user-facing language must be understandable without technical knowledge. The account-access category is **Sign-ins**, not “Credentials.” Technical vocabulary remains acceptable in development documentation.

“Local” means the user's explicitly enrolled private devices. Access from a paired phone to a computer-held record necessarily transfers that selected information between those devices over a protected connection; onboarding must say so. It does not mean that a record can appear on another device without a transfer. Sharing devices and granting household members access are separate decisions.

## Starting record types

These are the proposed first catalog and plain-language labels. Templates organize information; they do not imply validation by an issuer, medical advice, or a complete specialist records system.

| User-facing type | Contents and examples | Boundary |
| --- | --- | --- |
| People | Household profiles: name, contact details, relationships, and links to that person's records. | A person profile is not a login account or permission grant. |
| Personal details | Reusable structured records, with initial templates for identification/licensing, insurance, medications/allergies, school details, and provider contacts; allow a user-defined category and fields. | Save reviewed values with their source. A driver's license or professional license belongs here, with its image under Documents and photos, not under Sign-ins. No clinical interpretation or inferred facts. |
| Documents and photos | Selected images, supporting PDFs, forms, cards, and letters, linked to a person and optionally a structured record. | Define supported file types/size limits in implementation; no executable attachments or automatic external analysis. An image and the reviewed details extracted from it are separate linked records. |
| Notes | Private free-text instructions, preferences, and context linked to a person or record. | Treat text as data, not executable instructions. Do not encourage pasting passwords here. |
| Sign-ins | A recognizable service/account entry linked to protected passwords, tokens, or recovery codes where the chosen secure storage supports them; references to device-managed passkeys where supported. | Use established credential storage. Do not imply that passkey private keys can be read, copied, or exported. Showing a secret locally, if implemented, requires explicit local authorization and must never return it to a model. |

Each type must support authorized **create, view, edit, and delete** in the local GUI. Include category changes, attachment replacement, and deliberate person reassignment, with clear confirmation for consequential changes. Validate required fields, preserve source/review information, and detect stale edits rather than silently overwriting another device's changes. No compulsory secret reveal or copy-to-clipboard feature is implied by viewing a Sign-ins entry.

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

## First supported experience

1. From the welcome screen, the assistant helps the user choose **Keep it on this phone** or **Use my phone and computer**. Sensitive entries and security confirmations stay in the trusted local app/OS interface, never voice chat or a model prompt.
2. For two-device use, choose which device holds the authoritative vault. Explain availability: that device must be reachable and the vault available for authorized access. Detect capabilities only after permission; show unsupported combinations honestly.
3. Show the local storage destination and device identity in plain language. Choose an app-private location outside the repository and cloud-synchronized folders, and verify supported OS backup exclusions before importing records.
4. Choose a supported unlock method and a recovery arrangement. Demonstrate unlocking and recovery limitations before continuing; canceling leaves setup incomplete.
5. For paired use, guide installation/launch on the second device, establish a short-lived pairing exchange, and require identity confirmation on both devices. Explain what the new device may access before granting it. The assistant cannot approve pairing on the user's behalf.
6. Create household profiles, initially with fictional examples. Person assignment is required; a profile is not an authenticated account or an access grant.
7. Offer manual entry, selected local document import, or optional analysis in the user's chosen external assistant. Show the privacy difference. Declining analysis still completes useful setup.
8. Review and save local information, then show where it lives, how to unlock it, which devices have access, and how to lock or disconnect them. Test the actual connection before reporting success.

The desktop layout and phone layout use the same service contracts and permission rules. A responsive webpage alone does not establish native storage, key protection, background availability, or installable application support.

## Proposed architecture and bounded scope

For the first implementation, propose **one authoritative host per vault** with authenticated direct access from a paired device. The host can be the phone or computer; phone-only mode runs the same service locally. This avoids a second writable replica and conflict-resolution engine in the first slice. Confirm the hosting/transport choices in the platform spike, especially mobile suspension and background limits. Do not silently substitute a desktop requirement for phone-only support.

Start with a verified same-network or direct local connection. Internet relay services, public vault endpoints, automatic port forwarding, remote access from anywhere, unattended multi-device synchronization, offline replicas, and automatic failover are outside this epic. If the host is asleep, offline, locked, or disconnected, show the correct unavailable/locked state; do not imply a successful save or retain an undisclosed plaintext cache. If remote or offline access later becomes necessary, plan it explicitly with its custody and consistency consequences.

One shared VaultService enforces actor, enrolled device, person, record, action, and authorization scope on every operation. GUI and MCP are adapters to that service, not separate policy engines. Local authentication proves who may attempt access; it does not by itself authorize every record. Network presence, knowledge of a path, a household profile, and a pairing code alone do not grant permanent access.

| Component | Required boundary |
| --- | --- |
| Local vault storage | Encrypt records, documents, and sensitive metadata; use a reviewed maintained storage/encryption facility. Stable opaque IDs must not reveal person names in filenames. Atomic writes, versioned schema, integrity checks, and migrations preserve recoverability. |
| Key and credential adapter | Use established platform facilities and reviewed libraries. Keep vault keys separate from encrypted data. Reusable integration secrets use protected credential storage and scoped references; no raw secret appears in model output. |
| Local GUI | Own storage selection, unlock, pairing approval, access management, private records, import review, recovery, and meaningful error presentation. OS authentication remains in the OS prompt. |
| Paired-device connection | Mutual authentication, encrypted transport using a maintained protocol, bounded permissions, replay protection, expiry, disconnect, and revocation. A local network is not trusted merely because it is local. |
| Assistant/MCP adapter | Guide setup and invoke authorized local operations. Return minimal non-sensitive status by default; keep names, paths, document contents, private profile values, keys, and authentication input out of hosted model context. Private on-screen results are not automatically tool responses. |
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

This optional path is the explicit exception to keeping record content on private devices. Use the user's own chosen assistant/provider; do not introduce a Home analysis backend or assume a subscription supplies an API key.

1. The user chooses a specific image and destination. Explain that it will leave their devices and be handled under that provider's policies. Never promise zero retention or that deleting Home's local copy deletes provider history.
2. For the first slice, the user attaches the selected image in their own provider app. Home can give generic instructions and a structured field template, without embedding private data in that template. Do not claim an upload occurred or analysis succeeded unless actually observed; manual handoff remains labeled user-reported.
3. The user brings results back into Home for local review. If a supported return integration is later selected, it must be separately verified and restricted; provider responses are untrusted input, not instructions or authorization.
4. Show proposed values, source, uncertainty/missing fields, and intended household member. Let the user edit/reassign them, then save only after explicit local review. No automatic overwriting, guessing, or cross-person assignment.
5. Decline, cancel, provider failure, and partial results all leave manual entry available. No general filesystem access, vault-wide grant, background extraction, or analysis API billed by Home is required.

Consent for one image is not permission for further images, vault browsing, sending credentials, calendar writes, or external commitments. A future private-data tool response or other export needs its own purpose/destination/scope decision; it is not implicitly approved by pairing or general assistant setup.

## Delivery stories and acceptance

Story IDs below are planning references, not claims of created child issues or completed work. Split into implementation issues after plan review. All examples and evidence must be synthetic.

| Story | Depends on | Reviewable outcome and acceptance |
| --- | --- | --- |
| VLT-01: Prove platforms and the privacy model | None | Record first mobile OS/device and desktop OS/client versions, app packaging, local storage/backup exclusions, available unlock/key facilities, assistant connectivity, and direct pairing transport. Prove phone-only launch/unlock while offline and phone/computer connection with fictional data. Document mobile suspension behavior and reject unsupported combinations. Record dependency rights, threat model, host choice, and recovery decisions before implementation expands. |
| VLT-02: Shared authorization and storage contracts | VLT-01 | Define stable vault/person/record/device IDs, schema/versioning, permission checks, typed errors, lock states, and minimal activity outcomes in one service. GUI and MCP cannot bypass scope checks. Tests deny unrelated persons, stale grants, path traversal/reparse escapes, and untrusted document instructions. |
| VLT-03: Encrypted vault and unlock lifecycle | VLT-02 | Create outside checkout/cloud-sync locations, lock/unlock with each supported configured method, restart locked, safely change methods, and protect key/secret material. Test wrong credentials, OS credential reset, tamper, disk full, interrupted writes, and failed migrations without exposing plaintext or corrupting the last committed state. |
| VLT-04: Phone-only onboarding and household records | VLT-03 | A nontechnical user chooses storage/unlock/recovery, creates two fictional members, and creates/views/edits/deletes examples of all five record types. Test templates/custom fields, attachment replacement, explicit reassignment, deletion of linked records, scoped Sign-ins references, and restart. Canceling setup or review does not claim success. Touch, keyboard, accessible labels, plain-language prompts/errors, and desktop layout work. |
| VLT-05: Guided phone/computer pairing | VLT-03; final end-to-end acceptance uses VLT-04 | Guide install/connect, approve identities and scopes on both devices, and access the same authoritative record. Test expired/replayed/wrong pairing codes, rogue peers, lock/disconnect/revocation, host sleep, interrupted writes, concurrent stale edits, and reconnect without duplicate mutations. No vault key or record in the pairing QR payload, hosted chat, or public URL. |
| VLT-06: Assistant onboarding and selected analysis handoff | VLT-04; paired path uses VLT-05 | Guide setup without collecting secrets or exposing private tool results. Support manual selected-image handoff to the user's provider with clear disclosure, then local correction/assignment/review of untrusted results. Decline sends nothing through Home and still completes onboarding. No general vault grant or Home analysis service. |
| VLT-07: Recovery, device removal, and data lifecycle | VLT-03 and VLT-05 | Restore a user-held encrypted backup on a clean supported device, verify records and schema, require fresh device enrollment, and re-enter nonportable credentials. Test wrong keys, tampered/incomplete backups, and unsupported versions. Remove a device and reject its old grants on reconnect. Explain retained originals/backups and inability to erase data already viewed/copied on another device. |
| VLT-08: Independent security and household acceptance | VLT-01 through VLT-07 | Run both journeys below, plain-language comprehension checks, and the negative-case matrix on declared mobile/desktop targets. A second person reviews privacy/key/authorization/recovery decisions and evidence. Owner accepts supported behavior and remaining limits before sensitive use. CI evidence is separate from local verification; no implementation or release gate is passed by this plan. |

First implementation PR: VLT-01, with a bounded synthetic feasibility prototype and decision record. Do not begin by moving real records or building a full password manager. No estimate or delivery date is asserted before the platform and pairing spike resolves the major risks.

## Acceptance journeys and failure matrix

**Phone only:** after installation, with no computer and no internet, launch the supported local app, choose phone storage and unlocking, create two fictional profiles, save a reviewed synthetic record, lock, restart, unlock, and recover it. Optional hosted image analysis requires internet and remains a distinct opt-in; its absence must not block manual onboarding.

**Phone and computer:** choose the authoritative device, enroll the other with confirmation on both, save a synthetic record on one interface and verify its committed version through the other. Test both supported host directions. A sleeping or suspended phone host must be shown unavailable where the platform cannot maintain service. Revoke the paired device and verify that subsequent operations, queued requests, and reconnections are denied. Repeat setup with a declined pairing request; no device is enrolled.

| Risk / failure | Required evidence |
| --- | --- |
| Undisclosed external disclosure | With synthetic canary content, inspect Home traffic, model/tool payloads, logs, caches, backups, and diagnostics. With analysis declined there is no record egress beyond explicitly enrolled devices. With selected analysis, only the intentionally selected content goes to the chosen provider; any manual provider action is distinguished from Home-observed traffic. |
| Wrong person or excessive permission | Two profiles, multiple scopes, and an unenrolled client demonstrate denied reads/writes; review/reassignment never silently changes ownership. Pairing is not unrestricted household access. |
| Secret leakage or weak unlock gate | No raw credential, key, recovery material, or private field appears in model results, logs, plaintext persistence, or pairing payloads. Canceled/failed OS authentication denies access. An app-screen bypass cannot decrypt data. |
| Network attack or duplicate operation | Mutual identity checks, encrypted connection, replay rejection, timeouts, idempotent mutation IDs, and version conflicts are exercised with a synthetic hostile peer. A timeout is an unknown outcome until reconciled, not permission to blindly repeat a write. |
| Lock, revoke, or device loss | Check authorization again when work executes; stop queued/new access and close sessions. Document any completed/in-flight disclosure that cannot be recalled. Pairing grants and sensitive caches do not resurrect after reinstall or restore. |
| Crash, corruption, or lost credentials | Interrupted write/migration, full disk, bad recovery key, malformed backup, and unsupported version fail without silently replacing recoverable data. Successful restore is verified, not inferred from archive creation. |
| Local document attack | Enforce types/size limits and reviewed preview/parsing boundaries. Embedded scripts, external resources, and prompt instructions cannot execute or expand permissions. Preserve originals; explain copies rather than claiming secure deletion from all storage. |

Deletion removes the selected active record and its indexes/references under the documented retention policy; existing user-held backups and original source images are separate copies. Do not promise remote wiping, forensic erasure on SSDs, or protection from an already compromised authorized endpoint.

## Gates, open decisions, and exclusions

The owner has decided shared-vault support, phone-only operation, onboarding-led location choice, configurable unlocking, local custody, and optional user-provider image analysis. Remaining engineering decisions are the first mobile target, packaging/runtime, established storage/key library, supported unlock methods and recovery mechanism, direct transport, and safe mobile host availability. Present measured tradeoffs at VLT-01; never silently relax the local custody boundary to make a client work.

Deferred: cloud/relay hosting, remote access from anywhere, offline multiwriter sync, public unauthenticated endpoints, operator recovery, unattended third-party uploads, a Home analysis/model/voice service, general password-manager features, remote wipe, automatic migration between authoritative hosts, and full multi-user household identity administration. A safe reviewed export/restore can support an explicit move later; do not create two competing authoritative hosts accidentally.

Read/write calendar integration and appointment workflows remain separate roadmap work. This vault epic does not authorize sending private profile fields to them or to hosted models. Each external action retains its own destination, content, and scope boundary.

Apply [repository rules](../../REPOSITORY_RULES.md) and [collaborator responsibilities](../../COLLABORATORS.md). Use original or expressly authorized dependencies/material only. Keep public repository Actions disabled until isolated self-hosted execution is established. Real household data, credentials, screenshots, private device paths, and logs never belong in source, issues, PRs, or CI evidence. A second-person sensitive-design review and owner acceptance remain human gates; publishing this plan does not complete them.
