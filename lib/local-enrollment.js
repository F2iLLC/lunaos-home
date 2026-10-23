// Privileged, process-local developer controller. Never expose through TLS/HTTP/MCP.
import { randomUUID } from 'node:crypto';
import { DirectVaultError } from './direct-vault-tls.js';

const denied = () => { throw new DirectVaultError('DENIED'); };
const pin = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function createLocalEnrollment(host, { now = () => performance.now(), requireAccess = () => {}, pairingRegistry } = {}) {
  const pending = new Map();
  const removals = new Map();
  let readbackPeers = [];
  let last = -Infinity, closed = false;
  function time() {
    const tick = now();
    if (closed || !Number.isFinite(tick) || tick < last) { closed = true; pending.clear(); denied(); }
    last = tick;
    for (const [id, item] of pending) if (tick >= item.expires) pending.delete(id);
    return tick;
  }
  return Object.freeze({
    review(peerFingerprint) {
      const tick = time();
      if (!pin(peerFingerprint) || pending.size >= 16) denied();
      const requestId = randomUUID();
      const review = { requestId, peerFingerprint, hostFingerprint: host.hostFingerprint };
      pending.set(requestId, { ...review, expires: tick + 60_000, epoch: host.pairingReviewEpoch() });
      return Object.freeze(review); // Both endpoints must compare these identities.
    },
    decide({ requestId, allow, peerFingerprint, hostFingerprint } = {}) {
      const tick = time(), item = pending.get(requestId);
      pending.delete(requestId); // Denial or a mismatch consumes the review too.
      if (!item || tick >= item.expires || allow !== true ||
          item.epoch !== host.pairingReviewEpoch() ||
          peerFingerprint !== item.peerFingerprint || hostFingerprint !== item.hostFingerprint) denied();
      return host.approvePairing(item.peerFingerprint, Math.ceil(item.expires - tick));
    },
    cancel(requestId) { time(); pending.delete(requestId); },
    approveRead({ connectionId, peerFingerprint } = {}) {
      requireAccess();
      time();
      const connection = host.listConnections().find(item => item.connectionId === connectionId);
      if (!connection || connection.peerFingerprint !== peerFingerprint) denied();
      // This prototype deliberately has no blanket, write, or automatic grant path.
      return host.approveAccess(connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
    },
    enrolledDevices() {
      requireAccess();
      time();
      const paired = new Set(host.listPairedPeers());
      const present = new Set([...paired, ...readbackPeers]);
      return Object.freeze([...new Set([...present, ...removals.keys()])].sort()
        .map(peerFingerprint => Object.freeze({ peerFingerprint,
          removal: paired.has(peerFingerprint) || (present.has(peerFingerprint) && removals.get(peerFingerprint) !== 'uncertain')
            ? 'enrolled' : removals.get(peerFingerprint) ?? 'enrolled' })));
    },
    async removeDevice(peerFingerprint) {
      requireAccess();
      time();
      if (!pairingRegistry || !pin(peerFingerprint) || !host.listPairedPeers().includes(peerFingerprint)) denied();
      removals.set(peerFingerprint, 'uncertain');
      try {
        await host.revokePeer(peerFingerprint);
        removals.set(peerFingerprint, 'confirmed');
      } catch { /* A failed receipt can follow a committed write. Read back before claiming removal. */ }
      return Object.freeze({ peerFingerprint, removal: removals.get(peerFingerprint) });
    },
    async reconcileRemoval(peerFingerprint) {
      requireAccess();
      time();
      if (!pairingRegistry || removals.get(peerFingerprint) !== 'uncertain') denied();
      let peers;
      try {
        peers = await pairingRegistry.load();
      } catch { /* An unavailable registry cannot prove revocation. */ }
      time();
      if (peers) {
        readbackPeers = peers;
        removals.set(peerFingerprint, peers.includes(peerFingerprint) ? 'uncertain' : 'confirmed');
      }
      return Object.freeze({ peerFingerprint, removal: removals.get(peerFingerprint) });
    },
    close() { closed = true; pending.clear(); readbackPeers = []; },
  });
}
