# The Mac is the vault host

Owner ruling, 2026-11-10 (recorded on [#320](https://github.com/F2iLLC/lunaos-home/issues/320)): the Mac Studio, LunaOS headquarters, hosts the household vault for everything. Member details and Luna's notebook are records in one store there. By a second ruling the same day there is no separate grocery list: it is a list in the notebook ([notebook](notebook.md)). Windows, the phone and the Echo Show are clients of that vault. This supersedes the VLT-01 choice between phone-only and Windows storage.

## What exists

| Piece  | File                            | State                                                                                                                                                                                                                    |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Store  | `lib/vault-file-store.js`       | `VersionedVaultRecordStore` v2 on one AES-256-GCM snapshot file. Passes all 16 conformance clauses. Pure Node, so CI runs it on Linux and Windows with a fixture key.                                                    |
| Key    | `lib/mac-keychain-protector.js` | 32-byte key as a generic password in the login Keychain (`io.lunaos.home.vault`). Made only for a store that does not exist yet and never replaced. If setup stopped after making the key, the next setup uses that key. |
| Wiring | `lib/vault-notebook.js`         | `LUNA_HOME_VAULT=1` on macOS opens `~/Library/Application Support/LunaOSHome/vault`.                                                                                                                                     |

Commit is write-to-pending, sync, read back, atomic rename, done by the one process that owns the store. The owner holds `.lock` from open until its last adapter closes and orders its own operations in memory; a second process is refused instead of sharing the file. A lock is taken over only at open, and only when its holder cannot be running (dead process, or written before this boot). A wrong key, a snapshot moved from another store, tampering and truncation are unreadable and never overwritten. A missing store is not an empty store. Ceiling: 262144 bytes and 64 records, the same as the other adapters.

## Verified

- `test/vault-file-store.test.js`: conformance, one-store coexistence of member details and the notebook (grocery list included) across a restart, nothing readable at rest, profile sessions refused on list records, the four interrupted-commit stages, single-owner locking (a second process refused, abandoned locks taken over, a live one left alone), interrupted setup, and record ids such as `__proto__`.
- An independent review after Vigil approved found four defects in the first version of the store: a lock takeover race that lost writes under an injected pause, two ways a leftover lock could wedge the store, key and store creation not being atomic, and record ids colliding with `Object.prototype`. All four are fixed and covered by tests. A stress run of six competing processes, 15% of which were killed while holding the store, acknowledged 158 writes and stored 158.
- On the Mac Studio (macOS 27.2, arm64, Node 24.19.0), inside the signed-in session where the relay runs: 22 of 22 pass, including the Keychain key. The test key was removed afterwards.
- Over SSH the Keychain refuses (`-25308`, user interaction not allowed). The vault therefore opens only from the signed-in session, such as a launch agent. That is expected, and it means the vault is unavailable until someone has signed in after a restart.

## Not done

- No household vault has been created on the Mac. Nothing is deployed and the relay is unchanged.
- No route from the Echo Show or the Windows page to this vault.
- The Keychain item can be read by any process running as the same macOS user. This protects against disk or backup theft and other accounts, not against software already running as that user.
- The VLT-03 lifecycle gates still apply before real household data: explained setup, changing or resetting the unlock, schema migration, and user-held recovery (VLT-07). There is no backup of this store yet; losing the Keychain item loses the vault.
- The 64-record and 262144-byte ceilings were sized for prototypes and will need revisiting for a whole household.
