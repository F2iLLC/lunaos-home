// Each conversation gets its own dialog and attribution, over the same vault.
// Transport authentication happens before this registry is consulted.
export function createNotebookSessions({ create, now = Date.now, ttlMs = 120_000, limit = 64 }) {
  const sessions = new Map();
  return {
    get(id) {
      if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9-]{32,64}$/.test(id)))
        throw new TypeError('Invalid notebook session');
      const time = now();
      for (const [key, value] of sessions) if (time - value.at >= ttlMs) sessions.delete(key);
      // Old clients without a session may use explicit list names, never another
      // device's active list or pending destructive confirmation.
      if (id === undefined) return create();
      let entry = sessions.get(id);
      if (!entry) {
        if (sessions.size >= limit) throw new Error('Notebook sessions busy');
        entry = { api: create(), at: time };
        sessions.set(id, entry);
      }
      entry.at = time;
      return entry.api;
    },
  };
}
