# Fictional Windows KSP envelope prototype

This native-only experiment extends the disposable Software KSP candidate from
[Session 3](session-three-storage-pairing-handoff.md). It is compiled into
the Windows key-release example, **not the Home app or vault service**.
Home's existing adapter still uses CurrentUser DPAPI. No supported unlock
method or sensitive-use acceptance is established by this experiment.

## Contract

The example generates a random 256-bit data key with Windows CNG, wraps it with
a new 2048-bit Microsoft Software KSP RSA key using OAEP/SHA-256, and encrypts
one fixed fictional record using AES-256-GCM (96-bit random nonce, 128-bit tag).
The protector requests high-protection UI and permits decryption only; it never
requests private-key export. The separate disposable **key password** belongs
only in the Windows-owned dialog. It is not the Windows account password or
Windows Hello. Home never receives either password.

The version-1 envelope authenticates its format identifier, algorithm suite,
protector name, preparation boot marker, wrapped data key and nonce as GCM
additional data. Unknown versions, noncanonical encodings, oversized input,
wrong keys and altered authentication data/ciphertext/tag fail closed. There
is no DPAPI fallback. A complete older valid envelope can still be replayed:
rollback prevention, adversarial same-user file replacement and production
store identity are not solved here.

The format and crypto use the existing Windows crate and operating-system
facilities; no new third-party package or custom cryptographic primitive is
introduced. See Microsoft's [authenticated cipher parameters](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/ns-bcrypt-bcrypt_authenticated_cipher_mode_info)
and [NCrypt encryption API](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptencrypt).

## Lifetime, writes and cleanup

Each attended operation creates a native owner window and an isolated worker
process lifetime. The key is used for one native comparison and is never returned
to JavaScript, a transport, the terminal, a model or evidence. The process
registers the existing session/power monitor. Lock, suspend, session changes,
window closure and a 120-second overall deadline end the process. While the
worker holds its data key, the UI loop checks foreground ownership and a
five-second key-use deadline every 10 ms; the operation also checks foreground
before and after decryption. The runner launches the native owner visibly and
the native process refuses a hidden window before prompting. The original
hidden-startup launcher stranded the return-to-Home step on the declared PC.
The first OS-returned data-key buffer is immediately
wiped without reading a record. The process retains only the protected CNG
handle while waiting up to 30 seconds for the operator to click the Home window.
It then attempts a silent unwrap on that already-authorized handle during the
same bounded visit; failure denies access without another prompt or fallback.
The new buffer is used only in foreground and wiped. No plaintext data key is
retained during the wait, focus is never forced, and the session/power and
120-second overall deadlines remain active. This uses provider authorization
cached inside one short-lived process, never across visits or restarts.
No reusable unlocked session is persisted. A new
process always needs a new protected operation and checks silent denial before
and after it. These are implementation boundaries, **not attended lifecycle
results for this new path**.

Owned key and plaintext buffers use volatile zeroing on ordinary returns.
Abrupt termination relies on OS process teardown, and this prototype makes no
guarantee about paging, crash dumps, provider-internal copies, compromised
processes or OS memory remnants. It does not register as a background service.

A create-new sibling ciphertext file is flushed with sync_all, then moved on
the same volume using [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).
Creation refuses an existing envelope. The internal replacement primitive is
exercised only by tests; no runtime edit or method-change command is exposed.
Successful commits require byte-for-byte readback. Failure or a lost receipt
requires explicit readback, with no automatic write replay. Pre-rename failures
preserve the last committed envelope. Uncommitted pending files are never
promoted by reads. A process crash can leave ciphertext-only pending files;
physical power-loss durability and real disk exhaustion remain untested.

An exclusive Windows file lease serializes operations in the selected fixture
directory. Before key creation, an ownership receipt records only the random
disposable key name. Explicit cleanup can therefore remove a protector after
an aborted prompt even without a valid envelope. Only a missing-key CNG result
counts as already removed; provider/access errors preserve the receipt for
repair. Cleanup retains result files and the empty lock file. No recursive
directory deletion or automatic key enumeration is performed.

## Attended runner

Build and commit the reviewed source first. From an interactive PowerShell
terminal in that worktree:

~~~powershell
npm ci
npm run build:native
$fixtureDir = Join-Path $env:LOCALAPPDATA ('LunaOSHome\AttendedEvidence\ksp-envelope-' + [guid]::NewGuid().ToString('N'))
node scripts/test-attended-ksp-envelope.mjs prepare $fixtureDir
node scripts/test-attended-ksp-envelope.mjs cancel $fixtureDir
node scripts/test-attended-ksp-envelope.mjs wrong-password $fixtureDir
node scripts/test-attended-ksp-envelope.mjs read $fixtureDir
~~~

The runner requires a TTY and a separate typed begin decision for each step.
After each successful Windows password dialog, click the Home test window
whose title says "click here to continue" within 30 seconds. That return is
required; do not enter a password into the Home window or terminal.
Preparation builds the executable from the clean source and records its commit
and SHA-256. Retain the same worktree, executable and fixture directory through
restart. The only operator input collected by the runner is fixed approval or
outcome words. Its new directory must be directly under the local
LunaOSHome/AttendedEvidence directory, outside the checkout. No real records,
private paths, raw OS diagnostics or passwords belong in published evidence.

Preparation creates and verifies the protector, checks fresh-process silent
denial, commits the encrypted fixture and confirms that a same-boot restart
check refuses before prompting. Its result is PREPARED_NOT_RESTART_VERIFIED.
For the cancel step, cancel the OS dialog. For wrong-password, enter a wrong
disposable key password in the OS dialog, observe rejection, then cancel.
CNG failure, unchanged ciphertext and subsequent silent denial are machine
checks; the wrong-password/cancel distinction is an **operator report**, not an
API-classified authentication result. Unexpected exits remain incomplete.

Only after those steps, the operator performs a real Windows **Restart** and
returns to the same account. The runner never restarts the machine:

~~~powershell
# Restore $fixtureDir to the same local directory; do not prepare a new fixture.
node scripts/test-attended-ksp-envelope.mjs verify-restart $fixtureDir
node scripts/test-attended-ksp-envelope.mjs cleanup $fixtureDir
~~~

Verification requires changed Win32_OperatingSystem.LastBootUpTime UTC ticks,
fresh-process silent denial, OS-owned attended release, authenticated native
fixture comparison, unchanged envelope and post-release silent denial.
It retains the fixture until explicit cleanup. On any incomplete attempt,
preserve its result and run cleanup; never label timeout, lost password,
wrong source/binary or same-boot refusal as a passing restart. If the runner
cannot start because its pinned binary is missing, restore that exact worktree
and binary before cleanup; do not create a replacement protector.

## Unsupported reset, recovery and method changes

A missing protector, lost separate key password or credential reset that makes
the key unusable must leave the ciphertext locked. Do not silently recreate a
key, cache an unlocked data key, fall back to DPAPI or ask for the Windows
account password. This slice exposes no reset/recovery/method-change command.

Future method changes require old-method verification, independently tested
new protection, an authenticated versioned envelope, atomic commit and
readback before retiring the old key. Failure preserves the old committed
envelope. Recovery remains the separately reviewed user-held VLT-07 design.
Real credential reset/loss, migration, physical disk-full/power-loss behavior,
Android custody and production integration remain acceptance work.

## VLT-05 gates stay separate

This runner does not install a phone package, pair a device or open a listener.
The joined cold-PC restart, phone version-2 stale edit and second physical
rogue-phone scenarios remain **not run**. The corrected still-valid stolen-offer
sequence from PR #107 also has no new physical result. Prior joined read,
reconnect/removal, Windows lock and sleep evidence remains historical evidence
for the DPAPI path.

Before requesting those physical actions, extend the dedicated Home direct
runner for the specific scenario, with separate identity, scope and read/write
approvals; WRITE_UNKNOWN readback without automatic mutation replay; fixed
fictional records; and owned cleanup. This envelope runner is ready only for
the native KSP steps above, not those remaining joined scenarios.
