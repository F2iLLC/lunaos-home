// Process-local coordination for the fictional Windows adapter. This does not
// establish cross-process exclusion or a production recovery boundary.
const states = new Map();

function stateFor(probeId) {
  let state = states.get(probeId);
  if (!state) {
    state = { sessions: 0, recovering: false };
    states.set(probeId, state);
  }
  return state;
}

function releaseIfIdle(probeId, state) {
  if (state.sessions === 0 && !state.recovering) states.delete(probeId);
}

export function registerVaultStoreSession(store) {
  if (typeof store.probeId !== 'string') return () => {};
  const { probeId } = store;
  const state = stateFor(probeId);
  if (state.recovering) throw new Error('Synthetic recovery is in progress.');
  state.sessions++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.sessions--;
    releaseIfIdle(probeId, state);
  };
}

export async function withExclusiveVaultRecovery(store, action) {
  if (typeof store.probeId !== 'string') throw new TypeError('A Windows synthetic store is required.');
  const { probeId } = store;
  const state = stateFor(probeId);
  if (state.sessions > 0 || state.recovering) throw new Error('Close active synthetic vault sessions before recovery.');
  state.recovering = true;
  try { return await action(); }
  finally {
    state.recovering = false;
    releaseIfIdle(probeId, state);
  }
}
