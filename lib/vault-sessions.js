import { z } from 'zod';
import { registerVaultStoreSession } from './vault-store-lifecycle.js';
import {
  vaultRecordId as id, vaultDeviceId, vaultRecordDetail as detail, versionedVaultRequest,
  versionedVaultRecord, vaultMutationReceipt, vaultOutcomeCode, VaultConflictError,
} from './vault-record-contract.js';

const recordIds = z.array(id).min(1).max(64).refine(ids => new Set(ids).size === ids.length);
const lifetime = z.number().int().min(1).max(15 * 60 * 1000);
const scopeSchema = z.object({ recordIds, lifetimeMs: lifetime }).strict();
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), recordId: id }).strict(),
  z.object({ action: z.literal('create'), recordId: id, data: detail }).strict(),
  z.object({ action: z.literal('edit'), recordId: id, data: detail }).strict(),
  z.object({ action: z.literal('delete'), recordId: id }).strict(),
]);
const disclosureSchema = z.object({
  grantId: z.string().uuid(), recordIds,
  destination: id,
  fields: z.array(z.enum(['memberId', 'label', 'value'])).min(1).max(3),
  lifetimeMs: lifetime,
}).strict();

const messages = {
  DENIED: 'This access is no longer available. Ask for a new approval.',
  DISCLOSURE_REQUIRED: 'Sharing these details with this assistant has not been approved.',
  INVALID: 'This request is not supported.',
  UNSUPPORTED: 'This storage location does not support that change.',
  CONFLICT: 'This record changed. Review it again before making another change.',
  NOT_FOUND: 'This record is not available.',
  BUSY: 'There are too many pending requests. Try again later.',
  READ_FAILED: 'The record could not be read.',
  WRITE_UNKNOWN: 'The change could not be confirmed. Reconnect and review the record before trying again.',
};
export class VaultAccessError extends Error {
  constructor(code) { super(messages[vaultOutcomeCode.parse(code)]); this.code = code; }
}
const fail = code => { throw new VaultAccessError(code); };
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail('INVALID');
  return result.data;
}

// Experimental process-local enforcement boundary. The controller is privileged:
// only a future authenticated local approval/transport adapter may hold it.
// It is deliberately NOT exported through the preview HTTP server or MCP tools.
export function createVaultSessionService({ store, contractVersion = 1, now = () => performance.now(), requireAccess = () => {} }) {
  if (!store || !['read', 'create', 'edit'].every(key => typeof store[key] === 'function')) {
    throw new TypeError('A storage adapter with read/create/edit is required.');
  }
  if (![1, 2].includes(contractVersion) || (store.contractVersion ?? 1) !== contractVersion) {
    throw new TypeError('The service and storage contract versions must match.');
  }
  const versioned = contractVersion === 2;
  const releaseStoreSession = registerVaultStoreSession(store);
  const devices = new Set();
  const connections = new Map();
  const grants = new Map();
  let stopped = false;
  let lastTime = -Infinity;
  let tail = Promise.resolve();
  let pending = 0;
  const activity = [];
  let activitySequence = 0;
  function recordOutcome(deviceId, request, outcome) {
    activity.push(Object.freeze({ sequence: ++activitySequence, deviceId,
      action: request.action, outcome }));
    if (activity.length > 128) activity.shift();
  }
  function time() {
    const value = now();
    if (!Number.isFinite(value) || value < lastTime) {
      stopped = true;
      grants.clear();
      fail('DENIED');
    }
    lastTime = value;
    return value;
  }
  function state(connection) {
    const current = connections.get(connection);
    if (stopped || !current || !devices.has(current.deviceId)) fail('DENIED');
    return current;
  }
  function close(connection) {
    connections.delete(connection);
    for (const [key, grant] of grants) if (grant.connection === connection) grants.delete(key);
  }
  function authorize(connection, grantId, request) {
    requireAccess();
    const current = state(connection);
    const grant = grants.get(grantId);
    if (!grant || grant.connection !== connection || time() >= grant.expiresAt ||
      !grant.records.has(request.recordId) || !grant.actions.has(request.action)) fail('DENIED');
    if (request.action === 'read' && current.destination) {
      const disclosure = grant.disclosure;
      if (!disclosure || time() >= disclosure.expiresAt ||
        disclosure.destination !== current.destination || !disclosure.records.has(request.recordId)) {
        fail('DISCLOSURE_REQUIRED');
      }
    }
    return { current, grant };
  }
  async function execute(connection, grantId, input) {
    const request = parse(versioned ? versionedVaultRequest : requestSchema, input); // Copy before queuing.
    const { current: admitted } = authorize(connection, grantId, request);
    if (pending >= 128) fail('BUSY');
    pending++;
    const run = tail.then(async () => {
      authorize(connection, grantId, request); // Expiry/revocation is rechecked at execution, not just enqueue.
      if (request.action === 'read') {
        let value;
        try { value = await store.read(request.recordId); }
        catch { fail('READ_FAILED'); }
        const { current, grant } = authorize(connection, grantId, request); // No late disclosure after revocation.
        if (value == null) fail('NOT_FOUND');
        let record, parsed;
        try {
          record = versioned ? versionedVaultRecord.parse(value) : null;
          parsed = record ? record.data : detail.parse(value);
        } catch { fail('READ_FAILED'); }
        const data = current.destination
          ? Object.fromEntries(grant.disclosure.fields.map(field => [field, parsed[field]]))
          : parsed;
        return record ? { version: 2, recordId: request.recordId, revision: record.revision, data } : data;
      }
      if (typeof store[request.action] !== 'function') fail('UNSUPPORTED');
      let receipt;
      try {
        const result = versioned && request.action === 'delete'
          ? await store.delete(request.recordId, request.expectedRevision)
          : await store[request.action](request.recordId, request.data, ...(versioned ? [request.expectedRevision] : []));
        if (versioned) {
          receipt = vaultMutationReceipt.parse(result);
          if ((request.action === 'edit' && receipt.revision === request.expectedRevision) ||
            (request.action === 'delete' && receipt.revision !== request.expectedRevision)) {
            throw new Error('Invalid revision acknowledgement.');
          }
        }
      } catch (error) {
        if (versioned && error instanceof VaultConflictError) {
          authorize(connection, grantId, request);
          fail('CONFLICT'); // A definite no-write result; never refresh or retry automatically.
        }
        // The adapter may have committed before losing its acknowledgement.
        // Invalidate this connection and every queued grant; never replay a write.
        close(connection);
        fail('WRITE_UNKNOWN');
      }
      let accessEnded = false;
      try { authorize(connection, grantId, request); } catch { accessEnded = true; }
      // A confirmed in-flight write cannot be undone by revocation. No record
      // fields or arbitrary adapter return value are sent back to an assistant.
      return { ...(versioned ? { version: 2, revision: receipt.revision } : {}),
        status: 'applied', recordId: request.recordId, accessEnded };
    });
    tail = run.catch(() => {});
    try {
      const result = await run;
      recordOutcome(admitted.deviceId, request, request.action === 'read' ? 'read' : 'applied');
      return result;
    } catch (error) {
      if (error instanceof VaultAccessError) recordOutcome(admitted.deviceId, request, error.code);
      throw error;
    } finally { pending--; }
  }
  function approve(connection, input, actions) {
    requireAccess();
    state(connection);
    const approved = parse(scopeSchema, input);
    if (actions.some(action => typeof store[action] !== 'function')) fail('UNSUPPORTED');
    const currentTime = time();
    for (const [key, grant] of grants) if (grant.expiresAt <= currentTime) grants.delete(key);
    if (grants.size >= 128) fail('BUSY');
    const grantId = crypto.randomUUID();
    grants.set(grantId, {
      connection, records: new Set(approved.recordIds), actions: new Set(actions),
      expiresAt: currentTime + approved.lifetimeMs, disclosure: null,
    });
    return grantId;
  }
  return Object.freeze({
    // Privileged, process-local outcome view. Never exposed through a record
    // connection or returned to the assistant; no values or grant IDs are kept.
    recentActivity: () => activity.map(entry => ({ ...entry })),
    admitDevice(deviceId) {
      if (stopped) fail('DENIED');
      devices.add(parse(vaultDeviceId, deviceId));
    },
    removeDevice(deviceId) {
      devices.delete(deviceId);
      for (const [connection, current] of connections) if (current.deviceId === deviceId) close(connection);
    },
    // The transport must authenticate deviceId first. This method is not an
    // authentication mechanism and must never be exposed to a remote caller.
    openConnection(input) {
      const options = parse(z.object({ deviceId: vaultDeviceId, destination: id.optional() }).strict(), input);
      if (stopped || !devices.has(options.deviceId)) fail('DENIED');
      if (connections.size >= 64) fail('BUSY');
      const connection = Object.freeze({
        execute: (grantId, request) => execute(connection, grantId, request),
        assertReadActive: (grantId, recordId) => {
          const selected = parse(id, recordId);
          authorize(connection, grantId, { action: 'read', recordId: selected });
        },
        close: () => close(connection),
      });
      connections.set(connection, options);
      return connection;
    },
    approveSetup: (connection, input) => approve(connection, input, ['read', 'create', 'edit']),
    approveReadOnly: (connection, input) => approve(connection, input, ['read']),
    approveCreate: (connection, input) => approve(connection, input, ['create']),
    approveEdit: (connection, input) => approve(connection, input, ['edit']),
    approveDelete: (connection, input) => approve(connection, input, ['delete']),
    approveDisclosure(connection, input) {
      const current = state(connection);
      const approved = parse(disclosureSchema, input);
      const grant = grants.get(approved.grantId);
      const currentTime = time();
      if (!current.destination || current.destination !== approved.destination ||
        !grant || grant.connection !== connection || currentTime >= grant.expiresAt ||
        !approved.recordIds.every(recordId => grant.records.has(recordId))) fail('DENIED');
      grant.disclosure = {
        destination: approved.destination, records: new Set(approved.recordIds),
        fields: [...new Set(approved.fields)],
        expiresAt: Math.min(grant.expiresAt, currentTime + approved.lifetimeMs),
      };
    },
    revokeGrant(grantId) { grants.delete(grantId); },
    revokeDisclosure(grantId) { const grant = grants.get(grantId); if (grant) grant.disclosure = null; },
    shutdown() {
      stopped = true; grants.clear(); connections.clear(); devices.clear();
      // Keep recovery excluded until all already-started store work settles.
      return tail.then(releaseStoreSession);
    },
  });
}
