# Synthetic portable backup candidate

This [VLT-07](https://github.com/F2iLLC/lunaos-home/issues/10) increment tests
whether the **fictional Windows adapter's records** can leave their original
DPAPI store in an encrypted archive and be imported into a new empty store. It
is developer-only. Home's GUI, assistant tools, Android app, and device bridge
do not expose backup or restore. No household record or real recovery secret
was used.

The candidate uses Node's maintained crypto implementation of AES-256-GCM with
a fresh random 256-bit recovery key and 96-bit nonce for **each archive**. A
128-bit authentication tag protects a strict, versioned snapshot containing at
most 64 bounded profile records. This schema has no typed Sign-ins, session
grants, or paired-device identities; a caller could still put private content
in a general `value` field, which is why this path is restricted to fictional
fixtures. The archive does not contain the recovery key. The key must be
held separately by the user; losing it means this archive cannot be opened.
This prototype does not offer a password-derived key, operator escrow, cloud
reset, key display, backup destination, retention controls, or a safe user
interface. Those require design and independent security review before use.
The [Node crypto API](https://nodejs.org/api/crypto.html) and
[NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) describe the
underlying authenticated-encryption facility; this repository's archive
envelope and key-custody journey have **not** received independent review.

The privileged local adapter exposes recovery methods only with an explicit
developer opt-in and exports a snapshot through a process pipe. Ordinary GUI,
assistant, and direct-device callers do not receive those methods. This opt-in
is API separation, **not** a security boundary against another process running
as the same Windows user. Import
validates authentication, version, and the full record schema before asking the
Windows worker to replace an **empty** destination store. The worker refuses
nonempty stores, uses a same-directory encrypted temporary file and replace,
and binds the new ciphertext to the destination's own DPAPI store ID. It does
not import prior grants or enrollment. A per-store lock file blocks import
while a session service is active, including in another process, and blocks new
sessions during import. If a process exits without releasing its lock, the
stale lock fails closed and requires operator review before recovery can
continue. This does not establish clean-device enrollment. Session shutdown
must finish before import. A failed decrypt or validation never starts an
import. Windows process memory and pipes may briefly hold plaintext;
this is not a secure-erasure claim.

## Reproducible synthetic checks

On Windows with Node 24+ and PowerShell 7, after installing locked dependencies:

```powershell
node --test test/portable-vault-backup.test.js test/windows-portable-backup.test.js
```

The tests create two unique fictional stores outside the checkout. They encrypt
Alex/Sam records into an archive, check that a fixture value is absent from its
bytes, remove the source store, and import the archive from a fresh Node
process into the empty second store. Freshly reopened reads match both records.
Wrong key, damaged archive,
and unsupported version are refused before changing the destination bytes;
re-import into the now-nonempty store is refused without changing them. A grant
issued by the original session cannot read the new store; a fresh local grant
can. The test removes its two owned stores and overwrites its in-memory key
buffer without claiming secure erasure of process memory.

This is a **clean-store and fresh-process** check under the same Windows user,
not a clean-device restore. It does not validate another user or OS, Android
import, Sign-ins re-entry, backup-file custody, real user understanding, power
loss during replacement, or post-restore paired-device removal. The archive
captures records at one adapter operation but does not coordinate later writes
or tell the user whether it is the latest copy. The recovery key is a raw random
value rather than a memorable password; safe presentation and confirmation of
user custody are still design work. The archive
format, destination policy, unlock/enrollment flow, and recovery instructions
must be reviewed before a genuine clean-device test. VLT-07 and the
[independent VLT-08 review](https://github.com/F2iLLC/lunaos-home/issues/12)
remain open; this prototype is unsuitable for sensitive use.

An older backup can restore records subsequently deleted from a live store.
Neither deletion nor device removal erases previously held backup files or
content already viewed elsewhere; the eventual recovery UI must explain this.
