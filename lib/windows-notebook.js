import { createNotebookApi } from "./notebook-api.js";
import { createNotebookAssistant } from "./notebook-assistant.js";
import { createNotebookService } from "./notebook-service.js";
import { createWindowsReviewedDraftStore } from "./reviewed-draft-vault.js";

// Dedicated preview store for Luna's notebook: encrypted under the signed-in
// Windows account (DPAPI), stable across restarts, and separate from the
// fictional profile store. It is created only when the first list is saved.
export const previewNotebookStoreId = "f8e1f12e-9e35-407a-b320-d11678a770f2";
export const previewHouseholdId = "home-preview";

/**
 * Luna's notebook for the local Windows preview. Off unless the person starting
 * Home asks for it, because the preview otherwise saves nothing.
 *   LUNA_HOME_NOTEBOOK=1            keep lists on this computer
 *   LUNA_HOME_NOTEBOOK_STORE_ID     a privileged launcher may pick a disposable store
 * No request can choose the store, the household or a filesystem path.
 * @returns {{request: (raw: unknown) => Promise<object>} | undefined}
 */
export function notebookFromEnvironment(
  env = process.env,
  platform = process.platform,
) {
  if (env.LUNA_HOME_NOTEBOOK !== "1" || platform !== "win32") return undefined;
  const store = createWindowsReviewedDraftStore({
    probeId: env.LUNA_HOME_NOTEBOOK_STORE_ID || previewNotebookStoreId,
  });
  // One local Windows account owns this preview; it has exactly one household.
  const service = createNotebookService({
    store,
    householdId: previewHouseholdId,
    authorize: async (householdId) => householdId === previewHouseholdId,
  });
  return createNotebookApi({
    service,
    assistant: createNotebookAssistant({ service }),
  });
}
