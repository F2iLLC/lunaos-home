# Attended joined Home restart runner

The [attended result](session-three-storage-pairing-handoff.md#attended-joined-restart-recovery-result-2026-10-24)
passed on the declared Samsung/Windows pair on 2026-10-24, including explicit
cleanup. It records original preparation versus repaired runner provenance,
unchanged build hashes, and the two incomplete attempts before success.

This fictional-only VLT-05 check retains the same Android test app, Android
Keystore transport identity, Windows DPAPI record store, protected pairing
registry and disposable host TLS identity across an operator-initiated Windows
Restart. It extends the [joined Home runner](android-home-direct-read.md).
It does not integrate the separate Software KSP envelope into Home.

## Preparation and operator steps

Build the reviewed Windows preview and separate ARM64 attended Android debug
APK from the selected checkout. Inspect the final APK: application ID
`io.github.f2illc.lunaos.home.preview.issue14direct.debug`, target API 37,
local-network permission, no backups/cleartext, non-exported connection screen,
expected ABI and signer. Commit source before attending. The runner pins the
clean Git commit, Windows executable hash and APK hash; retain them until
cleanup. Its Windows binary is `src-tauri/target/debug/lunaos-home-preview.exe`.
It refuses to overwrite an installed test package.

Use an interactive local PowerShell terminal. Select the physical phone's USB
serial, model and API, and a private IPv4 address assigned to the PC. The runner
proves USB control and a phone Wi-Fi route to the exact listener port. It may
request an unplug/replug cycle if Windows does not expose a matching USB serial.
Run **one command at a time**, inspecting its result before proceeding:

```powershell
$attempt = Join-Path $env:LOCALAPPDATA ('LunaOSHome/AttendedEvidence/joined-restart-' + [guid]::NewGuid().ToString('N'))
# Set $apk, $serial, $model, $api and $address to the reviewed local setup.
node scripts/test-attended-home-direct.mjs $attempt $apk $serial $model $api $address restart-prepare
```

Type `begin` only when ready. Complete verification in Windows' trusted prompt.
In the terminal and on the phone, compare the full identities and proposed
read-only scope. Approve the connection on each device, then separately approve
the selected Alex read on the PC and phone. The runner navigates only the
fictional test app; it never answers authentication or permission dialogs.
Preparation requires one authoritative read and zero transport writes, ends
the connection, checks that the record is hidden and Read disabled, closes the
host and retains the setup. Its result is `PREPARED_NOT_RESTART_VERIFIED`.

Only after that result, save work and perform Windows **Restart** yourself.
Return to the same Windows account. Do not uninstall/renew the phone identity,
replace the APK, rebuild the executable or change the source commit. The test
certificates are short lived; complete this check the same day.

```powershell
node scripts/test-attended-home-direct.mjs $attempt $apk $serial $model $api $address restart-verify
```

Verification refuses the same OS boot marker before USB, native UI, listener
or store access. A changed marker alone is insufficient: the same builds,
installed APK, phone public certificate, ciphertext and protected enrollment
must match. The private PC address may change after restart. The phone app is
explicitly relaunched with no foreground authority. No new pairing offer is
issued; the retained peer must resume its protected enrollment. Independent
identity review and Windows/phone read approvals are still required. Before
either read approval, the record is hidden, Read disabled and store read count
zero. One authorized read must display the committed fictional value without
changing ciphertext; End clears access again. Success retains the fixture for
the separate cleanup step:

```powershell
node scripts/test-attended-home-direct.mjs $attempt $apk $serial $model $api $address restart-cleanup
```

Cleanup removes only this attempt's synthetic store and registry, the matched
test package (and its Android key), and the protected restart state. Result
files remain outside the checkout. Keep the phone connected for cleanup.
Never automatically reboot, replay pairing offers or repeat a failed mutation.

## Retained custody and failures

State lives in a new direct child of LocalApplicationData/LunaOSHome/
AttendedEvidence. Linked paths and concurrent controllers are refused. A
CurrentUser DPAPI envelope holds the disposable host TLS key and bounded local
resume metadata. OpenSSL's temporary plaintext test identity files are removed
as soon as that initial protected ownership receipt commits, before installing
the app or creating its store. No real records, passwords, vault keys, raw logs
or local device paths are published. This is fixture transport custody, not
authentication-bound key release or protection from another same-user process.

Each state update uses a create-new encrypted pending file, flush, rename and
byte readback. An existing pending file refuses further writes; it is never
promoted by a read. This is not a physical power-loss durability claim.
Failures remain incomplete and retain owned state for explicit cleanup.
No verification is possible from an incomplete preparation. Installed APK
replacement, changed phone identity, altered protected state, changed
source/executable, missing custody or stale boot markers refuse access.

If the entire console/process is killed, a `runner.lock` may remain. Do not
delete it merely because a timeout occurred. Inspect its PID and boot marker
locally and establish that its owning controller is no longer running before
explicitly removing that one lock file. Never recursively delete the attempt
or scan unrelated stores. A damaged custody envelope needs local reconciliation;
do not recreate identities or infer cleanup success. `restart-state.pending`
also remains encrypted and may be removed only as part of explicit owned
cleanup after the committed state has been read successfully.

Once ownership is validated, record-store cleanup invokes the worker directly,
without opening or decrypting `records.bin`. This allows cleanup after a partial
preparation or damaged record ciphertext. UUID path checks, exclusive locking,
and nonrecursive deletion still apply; unknown files or stale locks require
reconciliation. The protected ownership receipt must still be readable.

### Explicit runner-only repair

The first post-restart attempt hit `ENOBUFS` while reading the installed APK:
the inspected debug package was 135,324,589 bytes, larger than the original
100 MiB capture limit. The check now bounds its output by the exact inspected
APK size and still requires matching byte count and SHA-256. Preflight failures
save a minimized failure result instead of dumping child output buffers.

For this reviewed harness repair, append `--repair-runner` to the verification
command. The terminal shows the original prepared source and the new runner
source before `begin`. The original preparation source, boot marker, identities,
record/enrollment hashes and both build hashes are preserved; a separate
`runnerHead` pins the continuation. A clean descendant commit may differ only
in the named runner/state helper, their test, and the two restart handoff/guide
documents. Native, Android, transport and dependency changes are refused.
Existing state cannot silently adopt a new head, and a second repair transition
is refused. Normal verification/cleanup then uses that pinned continuation.
This is explicit test-harness provenance, not a production migration mechanism.

## Evidence boundary

This sequence deliberately ends the grant and host before Restart and
relaunches the phone app afterward. It tests retained enrollment/store recovery
across a real PC boot and fresh approvals; it does **not** prove interruption
of an active grant by shutdown, uninterrupted phone UI behavior during reboot,
power-loss recovery, or authentication-bound DPAPI key release.

The phone version-2 stale edit and second physical rogue phone remain separate
gates. The corrected still-valid stolen-offer check passed with a PC-origin
outsider in [Session 15](session-three-storage-pairing-handoff.md#session-15-attended-still-valid-offer-binding);
it does not substitute for that second phone. This read-only
runner issues no record mutation; any later write runner must reconcile
`WRITE_UNKNOWN` by explicit readback without automatic replay. Guided
installation, production identity provisioning, configurable unlock methods
and sensitive-use acceptance remain open. Exact local, hosted, and attended
results belong to the PR and Session 3 handoff, not to an inferred support claim.
