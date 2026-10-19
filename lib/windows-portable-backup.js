import { createPortableBackup, openPortableBackup } from './portable-vault-backup.js';

// These privileged helpers are for the fictional adapter only. They are not
// registered with the GUI, assistant, or direct-device transport.
export async function exportWindowsSyntheticBackup(store) {
  return createPortableBackup(await store.exportSnapshot());
}

export async function restoreWindowsSyntheticBackup(store, archive, recoveryKey) {
  const snapshot = openPortableBackup(archive, recoveryKey);
  await store.importSnapshot(snapshot);
}
