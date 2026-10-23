# Session 3 build handoff: protected pairing custody and versioned reads

This increment follows the [Session 2 feasibility decision](session-two-feasibility-handoff.md) for [VLT-03](https://github.com/F2iLLC/lunaos-home/issues/6) and [VLT-05](https://github.com/F2iLLC/lunaos-home/issues/8). It uses fictional records and a Windows-only developer harness. It is not approval for personal information or completion of either issue.

## Decision and result

Keep one authoritative vault host. Pairing, vault unlock, and selected-record grants remain separate decisions. For the Windows synthetic path, a peer certificate fingerprint can now be stored in a purpose-bound CurrentUser DPAPI envelope beside the fixed-example encrypted store. The registry is bound to that store ID and host certificate fingerprint. The direct TLS host loads it before listening, persists new admission before returning pairing success, resumes an enrolled certificate after host restart, and persists device removal. A resumed device receives **no old record grant**. Corruption, a changed host identity, or failed registry writes close or refuse host access; no registry details or OS diagnostics go onto the wire.

The direct TLS experiment can now use the version 2 record contract. In the Windows fixture, a resumed phone reads an authoritative encrypted record with its opaque revision; a stale edit returns `CONFLICT` without overwriting the newer ciphertext. This connects the existing [record revision](../architecture/vault-record-revisions.md) and transport experiments for one synthetic path. The registry is opt-in on the privileged host controller; ordinary Home setup does not yet create or manage it.

## Reproduce

On Windows with Node 24+, PowerShell 7, and the repository dependencies installed:

```powershell
npm ci
node --test test/windows-pairing-registry.test.js
node --test test/direct-vault-tls.test.js test/windows-verified-direct-host.test.js
npm test
```

The first test creates a unique fictional adapter store in the existing LocalApplicationData probe area, then checks encrypted registry bytes, restart/resume, fresh grant, versioned read/edit conflict, persisted revocation, wrong-host refusal, tamper refusal, and failure before durable admission. It removes its own registry before removing its test store. The other suites guard earlier transport and verified-visit behavior. These are controlled-process tests; they do not exercise the actual phone, Windows Hello, sleep, disk exhaustion, or a human enrollment screen.

## Storage and unlock boundary for VLT-03

The selected Android path still uses Android Keystore/private no-backup storage; the selected Windows path uses CurrentUser DPAPI. The Windows native prompt is an **application access gate**, not an authentication-bound release of the vault encryption key. An ordinary process under the same Windows user may be able to decrypt a copied DPAPI envelope. Neither this registry nor the version 2 fixed `memberId/label/value` record contract supplies production schemas, documents, Sign-ins references, migration, backup, or a configurable unlock method. Do not relabel the gate as key protection.

Before enabling sensitive data: choose and review the production key hierarchy and OS authentication-bound release for the first supported Windows/Android routes; define the supported unlock and method-change rules; choose a versioned record/document format and atomic migration strategy. Prove wrong credential, canceled prompt, OS credential reset, interrupted write, disk-full, tamper, failed migration, restart locked, and no plaintext diagnostic or temporary file. Test clean-device recovery separately under VLT-07. Keep the fixed-example adapter isolated until those checks pass.

## Pairing boundary for VLT-05

The registry stores certificate fingerprints, not vault keys or record values. The existing one-use offer remains short lived and bound to the presented certificate. A real flow still needs installation guidance, host and phone identity confirmation, durable identity/key provisioning, explicit scope review on both devices, visible device management, and a revocation result that distinguishes a confirmed disk commit from an uncertain one. If a registry removal cannot be committed, the running host stops access and returns an error; a later restart must not be presented as safely revoked until the registry has been reconciled. The present harness has no such user-facing reconciliation flow. Re-enrollment after restore, certificate replacement, Android phone-hosted availability, physical reconnect/sleep, and version 2 mutations on an actual paired phone remain open.

## Next-session prompt

Continue `F2iLLC/lunaos-home` from the reviewed head of the Session 3 VLT-03/VLT-05 PR. Read `docs/prototypes/session-two-feasibility-handoff.md`, this handoff, issues #6 and #8, and `REPOSITORY_RULES.md`. Use an isolated worktree from current `origin/main` or the appropriate unmerged PR head. Keep all tests and evidence fictional.

1. Make the Windows pairing registry part of an actual privileged local setup/controller flow. Show host and phone identities and proposed scope on each device; require independent approval on each, and show enrolled devices and a confirmed/uncertain removal state. Do not expose `load/add/remove` through TLS, HTTP, or MCP.
2. Decide the first supported Windows unlock/key-release design with a concrete threat model. Implement its smallest native vertical slice only after establishing that verification controls protected key material. Keep Windows account secrets inside the OS prompt. Specify credential-reset and method-change behavior before claiming a supported method.
3. Exercise fault injection for interrupted pairing writes and removal, repeated/replayed offers, and concurrent enrollment/removal. On actual declared phone/PC, check cold restart, lock, disconnect/reconnect, host sleep, rogue peer, and version 2 stale edit. Report `WRITE_UNKNOWN` for ambiguous mutations and require readback, never automatic retry.
4. Update the issue evidence, PR, and this handoff with exact heads, commands, passed/failed checks, and remaining human gates. Do not merge, deploy, close either issue, or claim sensitive-use acceptance from synthetic tests.

## Session 4 implementation and boundary

Started from merged PR #94: `origin/main` at `291199d1f6d90fc1f7443eb842f18b32041569f1`. The review branch and its final pushed head are recorded in the Session 4 PR and issue evidence.

The privileged verified Windows host now has an explicit `protectedPairing` option. It opens the purpose-bound registry for its own encrypted store and certificate before listening. Its process-local controller lists enrolled certificate fingerprints and removal states. A confirmed removal means the registry write returned success; a failed receipt leaves `uncertain`, closes host access, and requires an explicit registry readback before reporting confirmation. A present peer after readback remains uncertain and must be handled as still enrolled. An ambiguous pairing write yields `WRITE_UNKNOWN`; reconnect and registry readback determine whether admission committed. The offer must never be replayed to resolve it. These controls remain inaccessible through TLS, HTTP, and MCP.

The attended fictional Home direct-read runner now opts into this custody path. The local terminal shows both full identities and the fixed proposed scope, asks for an independent host approval, asks again for each selected read, shows device states, and offers local removal. The Android test screen already shows both identities and the same scope and separately asks for host and read approval. The terminal denies by default. This is a developer setup/controller path with ephemeral test certificates and a fictional record, not a guided product setup or durable production identity provisioning.

Fault tests cover a held pairing write, duplicate/replayed offer, concurrent removal during enrollment, stale local review, lost pairing acknowledgement followed by restart readback, and removal writes that fail before or after their commit. Existing version 2 tests still cover stale edit conflict. No actual phone/PC run was made in this increment: `ANDROID_HOME` and `adb` were unavailable in the work environment. Cold physical restart, lock, disconnect/reconnect, sleep, rogue peer, and version 2 stale edit on declared hardware remain human gates.

Windows developer validation from this worktree: `npm ci` succeeded, `node --test test/pairing-controller-faults.test.js test/enrolled-protected-record.test.js test/windows-verified-direct-host.test.js` passed 22/22, `node --check scripts/test-attended-home-direct.mjs` passed, and `npm test` passed 208/208. The first focused run failed because the new worktree had no installed dependencies; after `npm ci`, an initial new fixture lacked the required `create/edit` adapter methods and was repaired. A later focused TLS run exposed an assertion that treated all untrusted-client disconnects as `UNAVAILABLE`; the assertion now accepts conservative `WRITE_UNKNOWN` when a pairing request may have been sent. The final full run passed. `git diff --check` passed. These are local checks, not physical-device or native key-release evidence.

### First supported Windows key-release decision

Candidate: a device-bound Windows Hello protected asymmetric wrapping key, used only to unwrap a random per-vault data key after a fresh OS-owned PIN/biometric gesture. The record file must use authenticated encryption with a separately versioned envelope; no vault key or Windows account secret goes through JavaScript, HTTP, TLS pairing, logs, or a model. The native owner should keep unwrapped key bytes only for a bounded foreground session, clear them on lock/suspend/sign-out/cancel, and restart locked. The same-Windows-user process is in the threat model: CurrentUser DPAPI alone does not resist that process. The existing Windows consent prompt plus DPAPI adapter fails that key-release criterion. Microsoft documents Windows Hello key signing and Passport KSP user gestures, but these sources do not prove this application's wrapping/decryption operation is authentication-bound on the declared device. **No native key-release slice is enabled or claimed yet.** Prove a native create/wrap/close/reopen/gesture/unwrap path and a same-user negative probe before allowing the supported method.

Credential reset or loss of the Hello key must leave ciphertext locked, with no fallback to CurrentUser DPAPI or an old session; recovery requires the separately reviewed user-held VLT-07 backup. Method change must first verify the old method, create and test the new protector, atomically commit a versioned key-envelope change, then retire the old protector only after readback. Cancellation, interruption, full disk, failed migration, or new-method verification failure must preserve the last committed envelope and leave access locked. The family must explicitly approve any added recovery method. Android key release, documents, production schemas, clean-device restore, and independently reviewed security/UX acceptance remain open.

The basis for this decision is Microsoft's [Windows Hello key operations](https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello), [Passport KSP gesture behavior](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/rdp-sign-in), and [CNG key creation API](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey). These describe platform capabilities, not successful Home key custody.
