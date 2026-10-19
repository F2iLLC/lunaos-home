# Synthetic backup-copy confirmation

This developer-only VLT-07 increment checks an encrypted archive with a
separately supplied recovery key. `checkPortableBackupCopy` authenticates and
validates the archive, then returns only its record count and a SHA-256 digest
of the encrypted archive bytes. It returns no record values or key. A wrong
key, incomplete copy, or altered archive produces no confirmation. The digest
identifies an exact archive copy; it is not a recovery secret.

The check copies both inputs in memory so a caller cannot change the bytes
between authentication and digest calculation. Its temporary key copy is
overwritten before return. The caller retains responsibility for its own key
buffer and any copies made elsewhere. Plaintext may still exist briefly in
process memory; this is not a secure-erasure claim.

Run the fictional check with:

```powershell
node --test test/portable-backup-copy.test.js
```

The test independently copies the generated archive and key, overwrites the
original generated key buffer, checks the copy, and exercises wrong-key,
truncated, and altered inputs. It does not write a backup file, display a key,
verify a person's memory or custody, or restore on another device. A future
local interface must let the user choose a backup destination, retain the key
separately, re-enter it without sending it to an assistant, and understand
that losing it means the backup cannot be opened. Destination safety,
retention, recovery wording, and the complete key journey need independent
security and usability review before real household use.
