# Session 2 recovery and security handoff

This record concerns fictional fixtures only. Session 2 proves selected local
encryption, access, and failure behavior; it does **not** provide a user-held
backup or a clean-device restore. Do not use this prototype for sensitive
household records.

| Boundary | Observed check | Recovery limit |
| --- | --- | --- |
| Android phone-only store | The integrated emulator check preserved ciphertext and denied reads/writes after its fixed synthetic key was removed. The physical Samsung checked normal verified read, restart, lock, background, and tamper denial with fictional records. | The AndroidKeyStore key is not exportable through Home. Copying its `noBackupFilesDir` ciphertext is not a demonstrated restore method. A clean-device restore has not been attempted or passed. |
| Windows host store | The synthetic DPAPI probe passed fresh-process reopen, rejected altered ciphertext without overwriting it, and handled lost write acknowledgement as unknown without automatic replay. Copying one synthetic store's ciphertext over another under the same Windows user was refused; the source remained readable and restoring the target's original bytes recovered its record. A separate [developer-only portable-backup candidate](portable-backup.md) encrypts selected fictional records under a fresh independent recovery key and imports them into a new empty store from a fresh process. | The raw-copy denial exercises store-specific protection. The candidate demonstrates clean-store import under one Windows account, **not** clean-device recovery, key custody, a reviewed format, or a usable backup workflow. CurrentUser DPAPI and its profile state alone are not portable. |
| Direct phone/computer connection | Two selected Android devices rejected wrong TLS host identities, read a fictional Windows record under separate approval, and cleared local scope on background. Removing the Echo's paired identity denied its old read and reconnect. | The disposable pairing offer and in-memory admission do not constitute production enrollment. A backup must never silently restore old device grants. Already viewed content cannot be remotely erased. |

The Echo Show 8 used a custom Android 11 build. Its provider reported the
transport identity as nonexportable but not inside secure hardware. The Samsung
reported a different provider security level. These reports are not hardware
attestation, and the transport identity is separate from the record encryption
key. The second-device result does not qualify stock Echo hardware or prove
phone-hosted operation.

## Concrete recovery work for VLT-07

After the encrypted vault and guided pairing dependencies in [VLT-03](https://github.com/F2iLLC/lunaos-home/issues/6)
and [VLT-05](https://github.com/F2iLLC/lunaos-home/issues/8) are ready, select
an established, reviewed user-held encrypted export mechanism. Specify local
key custody, a versioned authenticated format, backup destination and retention,
wrong-secret and lost-secret outcomes, and atomic import behavior. Do not
invent a cryptographic primitive or treat a raw DPAPI/AndroidKeyStore file copy
as that mechanism. No operator escrow or cloud reset is allowed.

Use only synthetic records to create a backup on one supported device and
restore it on a clean second supported device. Verify record contents and
schema, require new device verification and pairing, and re-enter any
nonportable Sign-ins material. Reject wrong recovery material, tampered or
truncated backups, unsupported versions, and partial imports without replacing
the destination's recoverable data. Exercise device removal again after restore:
old connection grants and pairing offers must remain denied. Explain that
deleting an active record does not erase earlier user-held backups or copies
already viewed elsewhere.

Until that journey passes, recovery is **unverified**, even though local
encrypted persistence, same-device restart, corruption denial, and one physical
device-removal check passed. [VLT-07](https://github.com/F2iLLC/lunaos-home/issues/10)
owns the restore implementation and acceptance; [VLT-08](https://github.com/F2iLLC/lunaos-home/issues/12)
still requires a second person's privacy, key, authorization, and recovery
review plus owner acceptance. The Android phone-host direction, extended host
sleep, network interruption/roaming, and production enrollment also remain
unverified for [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14).
