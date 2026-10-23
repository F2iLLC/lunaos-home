// Coordination for the fictional Windows adapter. The lock file extends the
// process-local lifecycle check across processes; it is not a production
// recovery boundary.
import { closeSync, openSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const states = new Map();

export function lifecycleStoreFor(store) {
  // Store wrappers must carry `lifecycleStore` to keep the recovery guard tied
  // to the underlying adapter rather than silently becoming untracked.
  const seen = new Set();
  let current = store;
  while (current && typeof current === 'object' && current.lifecycleStore &&
    typeof current.lifecycleStore === 'object' && !seen.has(current)) {
    seen.add(current);
    current = current.lifecycleStore;
  }
  return current;
}

function lockPathFor(store) {
  if (typeof store.directory !== 'string') return null;
  return path.join(store.directory, '.vault-session-or-recovery.lock');
}

function acquireLock(store) {
  const lockPath = lockPathFor(store);
  if (!lockPath) return null;
  try {
    const descriptor = openSync(lockPath, 'wx', 0o600);
    return { descriptor, path: lockPath };
  } catch {
    throw new Error('The synthetic vault is active or its recovery lock needs operator review.');
  }
}

function releaseLock(lock) {
  if (!lock) return;
  closeSync(lock.descriptor);
  try { unlinkSync(lock.path); } catch {
    // A leftover lock fails closed on the next session or recovery attempt.
  }
}

function stateFor(probeId) {
  let state = states.get(probeId);
  if (!state) {
    state = { sessions: 0, recovering: false, lock: null };
    states.set(probeId, state);
  }
  return state;
}

function releaseIfIdle(probeId, state) {
  if (state.sessions === 0 && !state.recovering) states.delete(probeId);
}

export function registerVaultStoreSession(store) {
  const lifecycleStore = lifecycleStoreFor(store);
  if (typeof lifecycleStore?.probeId !== 'string') return () => {};
  const { probeId } = lifecycleStore;
  const state = stateFor(probeId);
  if (state.recovering) throw new Error('Synthetic recovery is in progress.');
  if (state.sessions === 0) {
    try { state.lock = acquireLock(lifecycleStore); }
    catch (error) {
      releaseIfIdle(probeId, state);
      throw error;
    }
  }
  state.sessions++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.sessions--;
    if (state.sessions === 0) {
      releaseLock(state.lock);
      state.lock = null;
    }
    releaseIfIdle(probeId, state);
  };
}

export async function withExclusiveVaultRecovery(store, action) {
  const lifecycleStore = lifecycleStoreFor(store);
  if (typeof lifecycleStore?.probeId !== 'string') throw new TypeError('A Windows synthetic store is required.');
  const { probeId } = lifecycleStore;
  const state = stateFor(probeId);
  if (state.sessions > 0 || state.recovering) throw new Error('Close active synthetic vault sessions before recovery.');
  const lock = acquireLock(lifecycleStore);
  state.recovering = true;
  try { return await action(); }
  finally {
    state.recovering = false;
    releaseLock(lock);
    releaseIfIdle(probeId, state);
  }
}
