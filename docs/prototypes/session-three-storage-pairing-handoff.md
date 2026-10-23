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
