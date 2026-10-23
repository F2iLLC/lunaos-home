import { createDraftStore, DraftError } from './drafts.js';
import { createProfileReviewProposal } from './profile-review.js';

// Same domain rules as HTTP/MCP, with a device-local, memory-only lifetime.
// No network, storage, native privilege or assistant access is provided here.
export function createOfflineDraftClient() {
  const drafts = createDraftStore();
  return async (path, input) => {
    try {
      if (path === '/api/draft' && input === undefined) return { draft: drafts.read() };
      if (path === '/api/example' && input !== undefined) return { draft: drafts.stage(createProfileReviewProposal()) };
      if (path === '/api/review' && input !== undefined) {
        if (input.action === 'reply') throw new DraftError('An assistant is not connected to this app preview. You can change the detail yourself.');
        return { draft: drafts.review(input) };
      }
      if (path === '/api/discard' && input !== undefined) return { draft: drafts.discard(input) };
      throw new DraftError('That action is not available in this app preview.');
    } catch (error) {
      throw error instanceof DraftError ? error : new DraftError('That change could not be read. Check it and try again.');
    }
  };
}
