# Local enrollment and protected-record slice

Developer-only Session 2 experiment. The separate disposable Android package
connects to a loopback Windows TLS host; the offline Home package is unchanged.
This is not production enrollment, physical-LAN evidence, or vault user-presence
verification. Only fictional records are permitted.

## Controls and data path

The local host terminal presents the full computer and Android certificate
fingerprints. The Android screen presents the computer fingerprint from its
bootstrap configuration and computes its own fingerprint from Android Keystore.
The test checks both actual Android text nodes against the host review before
answering the host prompt. A positive local decision issues a peer-bound,
single-use offer. A denied, mismatched, cancelled, consumed or expired review
cannot issue an offer. The review expires after 60 seconds; the resulting offer
cannot extend that deadline. Existing TLS certificate and hostname validation
remain mandatory. Importing a certificate as a trust anchor alone grants nothing.

On Android, approving the displayed computer is separate from connecting and
allowing the selected read. A changed host configuration or changed native peer
identity after display is refused at connection time. Each connection is shown
in the host terminal with its authenticated Android fingerprint. Its local
read-only approval covers only Alex / Library visit for 60 seconds. No automatic
grant polling runs in the protected-record path. These local controls are
privileged developer controls, not an authenticated OS approval interface.

The Windows `openWindowsProbeStore` adapter creates a unique synthetic store
outside the repository. The worker uses Windows CurrentUser DPAPI, purpose-bound
to the store ID, with its existing path checks and restricted directory ACL.
The runner commits Monday, changes the committed value to
`Thursday from protected storage`, and reopens the adapter before connecting.
Every successful remote read invokes that adapter through the existing TLS
session service. The Android screen renders the returned label/value; it no
longer renders a fixed Monday string. Four readbacks include reconnect,
background return and a cold Android process restart with fresh approvals.

The final Android read deliberately encounters damaged encrypted bytes and must
clear the visible record/access. The runner restores the exact original bytes,
confirms the changed record locally, and removes only its owned synthetic store
and temporary package. Independent cleanup steps still run if another fails.

## Reproduce

Use Windows, Node 24, PowerShell 7, the installed JDK21/Android SDK37 build tools,
and only the dedicated account-free `HomeVaultAcceptance_API36` emulator at
`emulator-5556` (API36/ranchu). The runner refuses a different target, a locked
Android user, an existing probe install or a reused output directory. Do not
substitute a personal phone. Use an existing disposable debug signing keystore;
set `ANDROID_HOME` and `JAVA_HOME` to the installed toolchains.

```powershell
node --test test/enrolled-protected-record.test.js
node scripts/test-android-direct-tls.mjs <new-output-directory-outside-repo> <debug-keystore> --protected-gui
```

The automated run drives the actual local terminal input and Android controls
with synthetic decisions; it is not evidence that a human compared identities.
Evidence files outside Git include the two identity text nodes, local terminal
prompts, final GUI state, provider inspection, APK hash and explicit test limits.

For an operator-controlled host, run in a local interactive terminal with the
dedicated emulator visible:

```powershell
node scripts/test-android-direct-tls.mjs <new-output-directory-outside-repo> <debug-keystore> --protected-gui --interactive-host
```

Compare the full identities on both surfaces. Type `allow` only to approve the
displayed device, then respond to each selected-connection read prompt. Other
input, EOF or timeout denies. The enrollment decision has a 60-second deadline;
read prompts allow 10 seconds, within the Android transport's 15-second wait.
Android controls are still driven by the test in this mode. Denial ends the run
with cleanup; a new run needs a new output directory. Neither mode prompts for
the Windows password or claims to unlock the vault through Windows Hello.

## Acceptance limits

- The host terminal decision and Android confirmation are explicit controls,
  exercised by automation in the recorded run. Human comparison and usability
  acceptance remain open.
- Public certificates, endpoint and offer still use the controlled debug
  provisioning channel. Discovery, a reviewed out-of-band trust exchange,
  durable enrollment and installation UX remain implementation work.
- DPAPI current-user decryption is not user-presence verification. Integrating
  the existing trusted Windows OS gate with this transport is separate work.
  Android's transport key is likewise distinct from OS vault unlock.
- No private key is bundled or exported. Emulator provider properties do not
  establish physical hardware backing, attestation or physical-LAN behavior.
- This slice is selected-record read-only. A separate Node fault-injection check
  commits a real encrypted edit, loses its acknowledgement, reports UNKNOWN,
  and proves one write plus fresh-grant readback without replay. It is not power
  loss, production recovery, or a phone write-flow acceptance result.
- Session 2, backup/transfer/recovery, phone-hosted direction and independent
  security acceptance remain open. Actions stays disabled.

## Recorded validation

- 100 Windows-compatible Node tests passed. The four new focused tests also
  passed after adding terminal EOF cancellation. They exercise real TLS sockets,
  denied/mismatched/cancelled/expired enrollment, wrong-peer scope approval,
  actual terminal decisions, reopened DPAPI storage, stale grants, denied
  read-only mutations, tamper/unavailable storage, and one real encrypted commit
  with a lost acknowledgement and no replay. Existing Linux-container tests
  remain platform-limited, not claimed as passed.
- Dedicated Android16/API36 emulator protected-GUI run passed with APK SHA-256
  `5baaeb292f1d84228ae8f3cc6311ab0eaeb2a4f8e1219e086085b63c2d647185`.
  Both exact full identity text nodes matched the local review before its
  decision. Four successful changed-value reads, four explicit host read
  approvals, zero remote writes, then one refused tamper read. The original
  run's `authoritativeReads: 5` counter counted attempts; it does **not** mean
  five successful reads. The maintained runner now separates attempts and
  successful reads. Unchanged Keystore identity was inspected after cold restart.
- An initial attempt launched the already-open screen again and correctly
  reached its closed-on-pause state rather than the expected initial state.
  That attempt was not counted. The successful run preserves the enrollment
  screen instead of launching it twice. An earlier preflight also refused to
  proceed until the dedicated emulator user had finished unlocking.
- Synthetic decisions drove both surfaces. The interactive-host entry point is
  available and shares the tested terminal controls, but no human comparison
  or Windows Hello completion is claimed by this automated run.

The final native transport regression also passed with APK SHA-256
`2e5f6f1110d525383d54cc9ceb0bd0fd28a0555c1ebf040dcace96ea9082d0a9`:
wrong hostname/pin refusal, paired read, stale-grant/read-only denial, reconnect
with fresh approval, and peer revocation/denied resume. Two reads, two approvals,
zero writes. This regression retains the legacy fixture controller and is
separate from the protected-GUI approval evidence. Temporary probe installs and
listeners were removed and the dedicated emulator stopped; Home and the personal
phone were untouched.
