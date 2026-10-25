// Synthetic transport experiment only. Not registered with Home, HTTP, or MCP.
import tls from 'node:tls';
import { isIPv4 } from 'node:net';
import { constants, randomBytes, X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { createVaultSessionService, VaultAccessError } from './vault-sessions.js';
import { lifecycleStoreFor } from './vault-store-lifecycle.js';
import { vehicleEventSchema } from './vehicle-sessions.js';
import { conversationRequestSchema } from './vehicle-conversations.js';

const LIMIT = 8192;
const tlsPolicy = { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', secureOptions: constants.SSL_OP_NO_TICKET };
const request = z.discriminatedUnion('op', [
  z.object({ seq: z.number().int().positive(), op: z.literal('conversation'), request: conversationRequestSchema }).strict(),
  z.object({ seq: z.number().int().positive(), op: z.literal('vehicle'), event: vehicleEventSchema }).strict(),
  z.object({ seq: z.number().int().positive(), op: z.literal('pair'), offer: z.string().regex(/^[\w-]{43}$/) }).strict(),
  z.object({ seq: z.number().int().positive(), op: z.literal('resume') }).strict(),
  z.object({ seq: z.number().int().positive(), op: z.literal('presence'), grant: z.string().uuid(), recordId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) }).strict(),
  z.object({ seq: z.number().int().positive(), op: z.literal('execute'), grant: z.string().uuid(), request: z.unknown() }).strict(),
]);
const codes = new Set(['DENIED', 'INVALID', 'BUSY', 'NOT_FOUND', 'READ_FAILED', 'WRITE_UNKNOWN', 'DISCLOSURE_REQUIRED', 'UNAVAILABLE', 'CONFLICT']);
const approvalReceipt = z.object({ event: z.literal('approval'), grantId: z.string().uuid(), mode: z.enum(['read-only', 'setup']), recordIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).min(1).max(64) }).strict();
export class DirectVaultError extends Error {
  constructor(code) {
    super(code === 'WRITE_UNKNOWN' ? 'Change not confirmed. Reconnect, obtain fresh approval and review; do not retry automatically.'
      : code === 'CONFLICT' ? 'This record changed. Review it again before making another change.'
        : 'The requested connection or access is unavailable.');
    this.code = code;
  }
}
const deny = () => { throw new DirectVaultError('DENIED'); };
function fingerprint(value) {
  const normalized = typeof value === 'string' ? value.replaceAll(':', '').toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(normalized)) deny();
  return normalized;
}
export const certificateFingerprint = pem => fingerprint(new X509Certificate(pem).fingerprint256);
function duration(value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError('Invalid bounded duration.');
  return value;
}
function send(socket, message) {
  const bytes = Buffer.from(JSON.stringify(message) + '\n');
  if (bytes.length > LIMIT || socket.destroyed || socket.writableLength > LIMIT * 8) { socket.destroy(); return; }
  socket.write(bytes);
}
function frames(socket, receive) {
  let pending = Buffer.alloc(0);
  socket.on('data', chunk => {
    // Bound each received buffer as well as individual messages. Reject bursts
    // instead of allowing an unbounded application queue.
    if (pending.length + chunk.length > LIMIT) { socket.destroy(); return; }
    pending = Buffer.concat([pending, chunk]);
    let newline;
    while ((newline = pending.indexOf(10)) >= 0 && !socket.destroyed) {
      const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
      try { receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))); }
      catch { socket.destroy(); }
    }
  });
}

export function privateTestAddress(value) {
  if (!isIPv4(value)) throw new TypeError('Use a literal private IPv4 test address.');
  const [a, b] = value.split('.').map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw new TypeError('Use a literal private IPv4 test address.');
  return value;
}
export async function startDirectVaultExperiment({ identity, ca, store, pairingRegistry, vehicleSessions, vehicleConversations, contractVersion = 1, now = () => performance.now(), idleMs = 15_000, requireAccess, bindAddress = '127.0.0.1', port = 0 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port.');
  if (bindAddress !== '127.0.0.1') privateTestAddress(bindAddress);
  duration(idleMs, 60_000);
  const hostFingerprint = certificateFingerprint(identity.cert);
  const storeProbeId = lifecycleStoreFor(store)?.probeId;
  if (pairingRegistry && (pairingRegistry.hostFingerprint !== hostFingerprint ||
      pairingRegistry.probeId !== storeProbeId)) throw new TypeError('Pairing custody must match this host and store.');
  const offers = new Map();
  // A registry is optional for the older disposable probes. It is a privileged
  // adapter, never supplied by a network request or returned to a client.
  const custody = pairingRegistry?.inspect ? await pairingRegistry.inspect() : null;
  const pendingPeers = new Set(custody?.pending ?? []);
  const paired = new Set(custody ? custody.peers.filter(peer => !pendingPeers.has(peer))
    : pairingRegistry ? await pairingRegistry.load() : []);
  const connections = new Map();
  const sockets = new Set();
  let stopped = false;
  let pairingReviewEpoch = randomBytes(16).toString('hex');
  let pendingRequests = 0;
  let rejectedHandshakes = 0;
  let incomingTcp = 0;
  let lastTime = -Infinity;
  let registryTail = Promise.resolve();
  let removalEpoch = 0;
  function persist(operation, peer) {
    if (!pairingRegistry) return Promise.resolve();
    const pending = registryTail.then(() => pairingRegistry[operation](peer));
    registryTail = pending.catch(() => {});
    return pending.catch(() => {
      stopped = true; offers.clear(); paired.clear(); service.shutdown();
      for (const socket of sockets) socket.destroy();
      throw new DirectVaultError('WRITE_UNKNOWN');
    });
  }
  function time() {
    const tick = now();
    if (!Number.isFinite(tick) || tick < lastTime) {
      stopped = true; offers.clear(); paired.clear(); service.shutdown();
      for (const socket of sockets) socket.destroy();
      deny();
    }
    lastTime = tick; return tick;
  }
  const server = tls.createServer({ key: identity.key, cert: identity.cert, ca, ...tlsPolicy, requestCert: true, rejectUnauthorized: true, handshakeTimeout: 5000 }, socket => {
    if (!socket.authorized || socket.isSessionReused() || stopped) { socket.destroy(); return; }
    let peer;
    try { peer = fingerprint(socket.getPeerCertificate().fingerprint256); } catch { socket.destroy(); return; }
    let connection;
    let connectionId;
    let sequence = 0;
    let queued = 0;
    let tail = Promise.resolve();
    socket.setTimeout(idleMs, () => socket.destroy());
    const invalidate = () => { connection?.close(); if (connectionId) connections.delete(connectionId); };
    socket.on('close', invalidate);
    socket.on('end', invalidate);
    socket.on('error', invalidate);
    frames(socket, raw => {
      const parsed = request.safeParse(raw);
      if (!parsed.success || parsed.data.seq !== sequence + 1 || sequence >= 1024 || queued >= 8) { invalidate(); socket.destroy(); return; }
      const message = parsed.data;
      sequence++; queued++; pendingRequests++;
      tail = tail.then(async () => {
        if (socket.destroyed || stopped) deny();
        if (message.op === 'pair' || message.op === 'resume') {
          if (connection) deny();
          if (message.op === 'pair') {
            const offer = offers.get(message.offer);
            if (!offer || offer.peer !== peer || time() >= offer.expires) deny();
            offers.delete(message.offer); // One successful consumption, no replay.
            const epoch = removalEpoch;
            await persist('add', peer); // Admission follows the durable commit.
            if (stopped || epoch !== removalEpoch) {
              await persist('remove', peer);
              deny();
            }
            paired.add(peer); service.admitDevice(`device_${peer}`);
          } else if (!paired.has(peer)) deny();
          connection = service.openConnection({ deviceId: `device_${peer}` });
          connectionId = crypto.randomUUID();
          connections.set(connectionId, { peer, connection, socket });
          return { connectionId, protocol: socket.getProtocol(), hostFingerprint };
        }
        if (!connection) deny();
        if (message.op === 'conversation') {
          if (!vehicleConversations || !paired.has(peer)) deny();
          if (requireAccess) requireAccess();
          return vehicleConversations.receive(peer, message.request);
        }
        if (message.op === 'vehicle') {
          if (!vehicleSessions || !paired.has(peer)) deny();
          if (requireAccess) requireAccess();
          return vehicleSessions.receive(peer, message.event);
        }
        if (message.op === 'presence') { connection.assertReadActive(message.grant, message.recordId); return true; }
        return await connection.execute(message.grant, message.request);
      }).then(value => send(socket, { seq: message.seq, ok: true, value }), error => {
        const code = (error instanceof VaultAccessError || error instanceof DirectVaultError) && codes.has(error.code) ? error.code : 'INVALID';
        send(socket, { seq: message.seq, ok: false, code });
        if (message.op !== 'execute' || code === 'WRITE_UNKNOWN') { invalidate(); socket.end(); }
      }).finally(() => { queued--; pendingRequests--; });
    });
  });
  const service = createVaultSessionService({ store, contractVersion, now, requireAccess });
  for (const peer of paired) service.admitDevice(`device_${peer}`);
  server.maxConnections = 32;
  server.on('connection', socket => { incomingTcp++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.on('tlsClientError', () => { rejectedHandshakes++; }); // Count only; no certificate/token/diagnostic logging.
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bindAddress, () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    stopped = true;
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await service.shutdown();
    throw error;
  }
  server.on('error', () => { stopped = true; service.shutdown(); for (const socket of sockets) socket.destroy(); });
  return Object.freeze({
    port: server.address().port, hostFingerprint,
    // Privileged local approval API. No remotely callable admission or grant method.
    pendingRequestCount() { return pendingRequests; },
    rejectedHandshakeCount() { return rejectedHandshakes; },
    incomingTcpCount() { return incomingTcp; },
    pairingReviewEpoch() { return pairingReviewEpoch; },
    listPairedPeers() { return Object.freeze([...paired].sort()); },
    listPendingRemovals() { return Object.freeze([...pendingPeers].sort()); },
    listConnections() {
      return [...connections].filter(([, value]) => !value.socket.destroyed)
        .map(([connectionId, value]) => Object.freeze({ connectionId, peerFingerprint: value.peer }));
    },
    approvePairing(peerFingerprint, lifetimeMs = 60_000) {
      if (stopped) deny();
      const tick = time();
      for (const [key, item] of offers) if (tick >= item.expires) offers.delete(key);
      if (offers.size >= 32 || paired.size >= 32) deny();
      const peer = fingerprint(peerFingerprint);
      if (pendingPeers.has(peer)) deny();
      const offer = randomBytes(32).toString('base64url');
      offers.set(offer, { peer, expires: tick + duration(lifetimeMs, 120_000) });
      return Object.freeze({ offer, hostFingerprint });
    },
    cancelPairing(offer) { offers.delete(offer); },
    approveAccess(connectionId, mode, scope) {
      const selected = connections.get(connectionId);
      if (stopped || !selected || selected.socket.destroyed || !['read-only', 'setup'].includes(mode)) deny();
      const grantId = mode === 'setup' ? service.approveSetup(selected.connection, scope) : service.approveReadOnly(selected.connection, scope);
      send(selected.socket, { event: 'approval', grantId, mode, recordIds: scope.recordIds });
      return grantId;
    },
    revokeGrant(grant) { service.revokeGrant(grant); },
    async revokePeer(peerFingerprint) {
      const peer = fingerprint(peerFingerprint);
      vehicleSessions?.revoke(peer);
      vehicleConversations?.revoke(peer);
      // Removing any device invalidates all reviews waiting in the local UI.
      removalEpoch++;
      pairingReviewEpoch = randomBytes(16).toString('hex');
      paired.delete(peer); service.removeDevice(`device_${peer}`);
      for (const [key, item] of offers) if (item.peer === peer) offers.delete(key);
      for (const current of connections.values()) if (current.peer === peer) current.socket.destroy();
      if (pairingRegistry?.beginRemoval) {
        await persist('beginRemoval', peer); // Commit quarantine before attempting deletion.
        pendingPeers.add(peer);
      }
      await persist('remove', peer);
      pendingPeers.delete(peer);
    },
    async close() {
      vehicleSessions?.close();
      vehicleConversations?.close();
      stopped = true; offers.clear(); paired.clear();
      const drained = service.shutdown();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      await registryTail;
      await drained;
    },
  });
}

export async function connectDirectVaultExperiment({ port, identity, ca, approvedHostFingerprint, offer, requestTimeoutMs = 3000, servername = 'localhost', address = '127.0.0.1' }) {
  const pin = fingerprint(approvedHostFingerprint); // Required local host identity approval.
  duration(requestTimeoutMs, 60_000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('Invalid port.');
  if (typeof servername !== 'string' || !servername.length) throw new TypeError('Expected host name required.');
  if (address !== '127.0.0.1') privateTestAddress(address);
  const socket = tls.connect({ host: address, port, key: identity.key, cert: identity.cert, ca, servername, ...tlsPolicy, rejectUnauthorized: true });
  const pending = new Map();
  const approvals = [];
  const approvalWaiters = [];
  let sequence = 0;
  let ended = false;
  function close() {
    ended = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new DirectVaultError(item.writing ? 'WRITE_UNKNOWN' : 'UNAVAILABLE')); }
    for (const item of approvalWaiters.splice(0)) { clearTimeout(item.timer); item.reject(new DirectVaultError('UNAVAILABLE')); }
    approvals.length = 0;
    pending.clear(); socket.destroy();
  }
  socket.on('error', close); socket.on('close', close);
  frames(socket, message => {
    if (message?.event === 'approval') {
      const parsed = approvalReceipt.safeParse(message);
      if (!parsed.success || approvals.length >= 8) { close(); return; }
      const waiting = approvalWaiters.shift();
      if (waiting) { clearTimeout(waiting.timer); waiting.resolve(parsed.data); }
      else approvals.push(parsed.data);
      return;
    }
    const item = pending.get(message?.seq);
    if (!item || typeof message.ok !== 'boolean') { close(); return; }
    pending.delete(message.seq); clearTimeout(item.timer);
    if (message.ok) item.resolve(message.value);
    else item.reject(new DirectVaultError(codes.has(message.code) ? message.code : 'INVALID'));
  });
  function call(body, writing = false) {
    if (ended || socket.destroyed) return Promise.reject(new DirectVaultError('UNAVAILABLE'));
    if (pending.size >= 8 || sequence >= 1024) return Promise.reject(new DirectVaultError('BUSY'));
    return new Promise((resolve, reject) => {
      const seq = ++sequence;
      const timer = setTimeout(close, requestTimeoutMs);
      pending.set(seq, { resolve, reject, timer, writing });
      send(socket, { seq, ...body });
    });
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { close(); reject(new DirectVaultError('UNAVAILABLE')); }, requestTimeoutMs);
      socket.once('error', () => { clearTimeout(timer); reject(new DirectVaultError('UNAVAILABLE')); });
      socket.once('close', () => { clearTimeout(timer); reject(new DirectVaultError('UNAVAILABLE')); });
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        try {
          if (!socket.authorized || socket.isSessionReused() || fingerprint(socket.getPeerCertificate().fingerprint256) !== pin) deny();
          resolve();
        } catch { close(); reject(new DirectVaultError('DENIED')); }
      });
    });
    const connected = await call(offer ? { op: 'pair', offer } : { op: 'resume' }, Boolean(offer));
    return Object.freeze({
      ...connected,
      nextApproval() {
        if (ended || socket.destroyed) return Promise.reject(new DirectVaultError('UNAVAILABLE'));
        if (approvals.length) return Promise.resolve(approvals.shift());
        if (approvalWaiters.length >= 8) return Promise.reject(new DirectVaultError('BUSY'));
        return new Promise((resolve, reject) => { const timer = setTimeout(close, requestTimeoutMs); approvalWaiters.push({ resolve, reject, timer }); });
      },
      execute: (grant, request) => call({ op: 'execute', grant, request }, ['create', 'edit', 'delete'].includes(request?.action)),
      presence: (grant, recordId) => call({ op: 'presence', grant, recordId }),
      vehicle: event => call({ op: 'vehicle', event }),
      conversation: request => call({ op: 'conversation', request }),
      close,
    });
  } catch (error) { close(); throw error; }
}
