# Session 2 feasibility handoff

This is a fictional-fixture engineering decision for [issue 14](https://github.com/F2iLLC/lunaos-home/issues/14),
not approval to store sensitive household information. It combines the
published prototype evidence with the joined Home result in [PR 85](https://github.com/F2iLLC/lunaos-home/pull/85).
The PR must be reviewed on its final head before its result is treated as
accepted; a local run or hosted test alone is insufficient.

## Decision

Proceed with **Android phone-only storage** and **Windows-held storage read by
Android over a directly authenticated private-network connection** as the
initial supported architecture candidates. The tested paths use Android
Keystore/private no-backup storage and Windows CurrentUser DPAPI respectively,
with short-lived selected-record grants. They demonstrate feasibility on the
selected Samsung and Windows PC, not production key custody, enrollment,
portable recovery, or supported-device coverage. Keep the Windows Claude Code
candidate for separately approved selected-field disclosure. Mobile assistant
automation and ChatGPT integration remain tracked in [issue 31](https://github.com/F2iLLC/lunaos-home/issues/31).

| Session 2 check | Evidence and limit |
| --- | --- |
| Encrypted round trip and phone-only operation | [Android Home vault](android-home-vault.md) records protected fictional Alex/Sam saves, cold restart/read-only recovery, foreground expiry, and tamper denial on the Samsung. [Windows adapter](windows-vault-adapter.md) records encrypted restart and corruption/unknown-write checks. These are selected-device, fixed-record results. |
| Phone reads a computer-held record | [Joined Home direct read](android-home-direct-read.md) records a current-source Samsung read from the reopened Windows encrypted store over mutually authenticated TLS. End/reconnect required fresh host and phone read approvals: two reads, zero writes, unchanged ciphertext. |
| Family scope and unauthorized client | [Android Home vault](android-home-vault.md) records both fictional member views under one admitted phone user. [Direct TLS](direct-vault-tls.md) and [native identity](android-native-identity.md) cover wrong identity, unapproved client, pairing/replay and selected-record denial. Member labels are not separate security identities. |
| Session boundary and disclosure | [Session permissions](session-permissions.md) and [Windows assistant](windows-assistant.md) cover scoped setup/read-only grants, expired and queued-write denial, unknown write outcomes, and separate selected-field disclosure to the tested Windows Claude Code client. That evidence does not establish other assistant clients or arbitrary records. |
| Connection and failure behavior | [Physical lifecycle](physical-vault-lifecycle.md) records lock, sleep, link interruption, and a manually changed Wi-Fi access point during an active grant; [joined Home](android-home-direct-read.md) records End/reconnect. A Settings-driven AP switch backgrounds the phone, so seamless foreground roaming is unverified. The joined Home package has not independently exercised every standalone probe failure case. |
| User-held backup and clean-device restore | [Recovery handoff](session-2-recovery-handoff.md) records the same-PC Windows portable-backup candidate and concrete [VLT-07](https://github.com/F2iLLC/lunaos-home/issues/10) tests. A clean-device, user-held-key restore is unverified. CurrentUser DPAPI files and AndroidKeyStore ciphertext cannot be assumed portable. |

The Android **phone-hosted** connection direction has no implemented listener
or physical acceptance run. Keep it unverified and assess a foreground-only
prototype with its actual lifecycle constraints before claiming support. No
public endpoint, hosted vault, cloud relay, or background availability is
inferred from the Windows-hosted result. The separate phone-only path works
locally without a computer.

## Implementation handoff

1. [VLT-03](https://github.com/F2iLLC/lunaos-home/issues/6): replace fixed
   examples with reviewed records and schemas; decide authentication-bound
   Windows key release and Android/Windows unlock methods; test migration,
   interrupted writes, credential reset, and storage failures.
2. [VLT-05](https://github.com/F2iLLC/lunaos-home/issues/8): replace debug
   certificate/config provisioning with guided, durable, revocable two-device
   enrollment; retain independent connection and selected-record approvals;
   test stale edits, interrupted writes, host sleep, reconnect, and phone-hosted
   feasibility on declared devices.
3. [VLT-04](https://github.com/F2iLLC/lunaos-home/issues/7) and
   [VLT-06](https://github.com/F2iLLC/lunaos-home/issues/9): connect the
   enforcing service to usable member records, setup/form workflows, and
   narrowly selected assistant disclosures. Keep future client combinations
   in [issue 31](https://github.com/F2iLLC/lunaos-home/issues/31).
4. [VLT-07](https://github.com/F2iLLC/lunaos-home/issues/10): prove an
   authenticated user-held backup on a clean supported device and require new
   enrollment after restore. [VLT-08](https://github.com/F2iLLC/lunaos-home/issues/12)
   retains independent privacy/key/authorization/recovery review, usability
   acceptance, and owner approval before sensitive use.

## Planning estimate

The original [15–20 focused-session estimate](../epics/user-controlled-vault.md#provisional-session-estimate)
for the whole initial product no longer fits the demonstrated prototype and
remaining implementation work. A planning range is **18–28 additional focused
build/test/review sessions** for one supported Samsung/Windows-style path:
3–5 for production storage/unlock, 3–5 for guided pairing and failure handling,
3–4 for member GUI and record workflows, 3–4 for Windows assistant/plugin
workflows, 3–5 for user-held recovery, and 3–5 for integrated device journeys
and review fixes. These are work-area estimates, not elapsed time or a delivery
commitment. They exclude other mobile/desktop targets and the deferred client
integrations in issue 31; those need separate sizing once a supported route is
established. Re-estimate after VLT-03 and VLT-05 choose their production
boundaries.

Issue 14 can hand off this feasible narrow architecture after the final PR
evidence is reviewed. Its open product and independent acceptance gates remain
with the stories above; neither a merged prototype nor this document closes
them.
