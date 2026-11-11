import { existsSync } from "node:fs";
import { remoteNotebookFromEnvironment } from "./remote-notebook.js";
import { createNotebookSessions } from "./notebook-sessions.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { macKeychainProtector } from "./mac-keychain-protector.js";
import { createNotebookApi } from "./notebook-api.js";
import { createNotebookAssistant } from "./notebook-assistant.js";
import { createNotebookService } from "./notebook-service.js";
import {
  createWindowsReviewedDraftStore,
  fictionalDetails,
} from "./reviewed-draft-vault.js";
import { openVaultFileStore } from "./vault-file-store.js";
import {
  vaultRecordDetail,
  versionedVaultRecord,
} from "./vault-record-contract.js";

// The household whose records this vault holds; the same identifier the
// grocery list record in this vault carries.
export const vaultHouseholdId = "home-example";

/**
 * Luna's notebook as one more record in the household vault. It shares the
 * vault's encrypted store with the saved member details and the grocery list
 * record, and takes its people from the vault: a member is someone who has a
 * saved detail there. Choosing who is writing records attribution only; it is
 * a label, not a permission.
 */
export function createVaultNotebook({
  store,
  householdId = vaultHouseholdId,
  profiles = fictionalDetails,
} = {}) {
  let acting = null;
  let known = null;
  let knownAt = 0;
  async function members() {
    const found = new Map();
    for (const spec of profiles) {
      try {
        const row = await store.read(spec.recordId);
        if (row == null) continue;
        const detail = vaultRecordDetail.parse(
          versionedVaultRecord.parse(row).data,
        );
        if (detail.memberId === spec.memberId)
          found.set(spec.memberId, { id: spec.memberId, name: spec.name });
      } catch {
        // Unreadable, or not a member detail: it names nobody.
      }
    }
    known = [...found.values()];
    knownAt = Date.now();
    if (acting && !found.has(acting)) acting = null;
    return known;
  }
  const service = createNotebookService({
    store,
    householdId,
    authorize: async (claimed) => claimed === householdId,
    actor: () => (acting ? { kind: "human", id: acting } : undefined),
  });
  return createNotebookApi({
    service,
    assistant: createNotebookAssistant({ service }),
    people: {
      // Briefly cached; someone added to the vault shows up within a minute.
      list: async () =>
        known && Date.now() - knownAt < 60000 ? known : members(),
      current: () => acting,
      // Re-read the vault so someone removed from it cannot be chosen.
      async choose(memberId) {
        const all = await members();
        if (memberId !== null && !all.some((member) => member.id === memberId))
          return false;
        acting = memberId;
        return true;
      },
    },
  });
}

// The household vault on the Mac host: one encrypted file, key in the login
// Keychain. Fixed names; no request or assistant argument can choose them.
export const HOST_VAULT_STORE_ID = "household";
export const hostVaultDirectory = (home = homedir()) =>
  join(home, "Library", "Application Support", "LunaOSHome", "vault");

/**
 * Open the vault this process may use, or undefined when it has none.
 *
 * macOS, LUNA_HOME_VAULT=1: the household vault. This is the host of record
 * for member details, the grocery list and Luna's notebook. A privileged
 * launcher may point LUNA_HOME_VAULT_DIRECTORY and LUNA_HOME_VAULT_STORE_ID at a
 * disposable store for tests.
 *
 * Windows, LUNA_HOME_FICTIONAL_SAVE=1: the developer preview store. It is not
 * the household vault and is not for real household data.
 */
export async function openVaultFromEnvironment(
  env = process.env,
  platform = process.platform,
) {
  if (platform === "darwin" && env.LUNA_HOME_VAULT === "1") {
    const directory = env.LUNA_HOME_VAULT_DIRECTORY || hostVaultDirectory();
    const storeId = env.LUNA_HOME_VAULT_STORE_ID || HOST_VAULT_STORE_ID;
    return openVaultFileStore({
      directory,
      storeId,
      protector: macKeychainProtector({ storeId }),
      create: !existsSync(join(directory, "vault.bin")),
    });
  }
  if (platform === "win32" && env.LUNA_HOME_FICTIONAL_SAVE === "1")
    return createWindowsReviewedDraftStore({
      ...(env.LUNA_HOME_FICTIONAL_STORE_ID
        ? { probeId: env.LUNA_HOME_FICTIONAL_STORE_ID }
        : {}),
    });
  return undefined;
}

/** Luna's notebook over whichever vault this process has, or undefined. */
export async function notebookFromEnvironment(
  env = process.env,
  platform = process.platform,
) {
  const remote = await remoteNotebookFromEnvironment(env);
  if (remote) return remote;
  const store = await openVaultFromEnvironment(env, platform);
  if (!store) return undefined;
  const sessions = createNotebookSessions({ create: () => createVaultNotebook({ store }) });
  return { request: (raw, session) => sessions.get(session).request(raw), close: () => store.close?.() };
}
