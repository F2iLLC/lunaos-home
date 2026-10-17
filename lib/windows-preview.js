import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createVaultSessionService, VaultAccessError } from './vault-sessions.js';

const recordId = z.enum(['alex-work', 'sam-school']);
const grantId = z.string().uuid();
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), mode: z.enum(['read', 'setup']) }).strict(),
  z.object({ action: z.literal('end'), grantId }).strict(),
  z.object({ action: z.literal('record'), grantId, recordId, operation: z.enum(['read', 'create', 'edit']) }).strict(),
  z.object({ action: z.literal('assistant-approve'), mode: z.enum(['read', 'setup']) }).strict(),
  z.object({ action: z.literal('assistant-share'), recordId, field: z.enum(['memberId', 'label', 'value']) }).strict(),
  z.object({ action: z.enum(['assistant-end', 'assistant-unshare', 'assistant-disconnect']) }).strict(),
]);
const assistantSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect') }).strict(),
  z.object({ action: z.literal('disconnect'), connectionId: grantId }).strict(),
  z.object({ action: z.literal('record'), connectionId: grantId, recordId, operation: z.enum(['read', 'create', 'edit']) }).strict(),
]);
const examples = Object.freeze({
  'alex-work': { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' },
  'sam-school': { memberId: 'sam-example', label: 'School', value: 'Meadow School' },
});
const changes = { 'alex-work': 'Willow Workshop', 'sam-school': 'Meadow Academy' };
export const previewLifetimeMs = 60000;
const sameKey = (candidate, key) => typeof candidate === 'string' && Buffer.byteLength(candidate) === Buffer.byteLength(key) &&
  timingSafeEqual(Buffer.from(candidate), Buffer.from(key));
function recordRequest(value) {
  const request = { action: value.operation, recordId: value.recordId };
  if (value.operation !== 'read') {
    request.data = { ...examples[value.recordId] };
    if (value.operation === 'edit') request.data.value = changes[value.recordId];
  }
  return request;
}

// Only fixed fictional records are reachable through this developer controller.
// The process capability is NOT device enrollment, OS unlock or user identity.
export function createWindowsPreview({ store, now, key = crypto.randomUUID() + crypto.randomUUID() }) {
  const service = createVaultSessionService({ store, now });
  service.admitDevice('fictional-windows');
  let connection;
  let activeGrant;
  let stopped = false;
  const assistantKey = crypto.randomUUID() + crypto.randomUUID();
  let assistant;
  let assistantGrant;
  let assistantId;
  function disconnectAssistant() {
    assistant?.close(); assistant = undefined; assistantGrant = undefined; assistantId = undefined;
  }
  return Object.freeze({
    key, assistantKey,
    acceptsKey: candidate => sameKey(candidate, key),
    acceptsAssistantKey: candidate => sameKey(candidate, assistantKey),
    async assistantRequest(input) {
      const parsed = assistantSchema.safeParse(input);
      if (!parsed.success) throw new VaultAccessError('INVALID');
      if (stopped) throw new VaultAccessError('DENIED');
      const value = parsed.data;
      if (value.action === 'connect') {
        if (assistant) throw new VaultAccessError('BUSY');
        assistant = service.openConnection({ deviceId: 'fictional-windows', destination: 'claude-code-example' });
        assistantId = crypto.randomUUID();
        return { connectionId: assistantId };
      }
      if (!assistant || value.connectionId !== assistantId) throw new VaultAccessError('DENIED');
      if (value.action === 'disconnect') { disconnectAssistant(); return { status: 'disconnected' }; }
      if (!assistantGrant) throw new VaultAccessError('DENIED');
      return assistant.execute(assistantGrant, recordRequest(value));
    },
    async request(input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new VaultAccessError('INVALID');
      if (stopped) throw new VaultAccessError('DENIED');
      const value = parsed.data;
      if (value.action.startsWith('assistant-')) {
        if (value.action === 'assistant-disconnect') { disconnectAssistant(); return { status: 'disconnected' }; }
        if (!assistant) throw new VaultAccessError('DENIED');
        if (value.action === 'assistant-approve') {
          if (assistantGrant) service.revokeGrant(assistantGrant);
          const scope = { recordIds: Object.keys(examples), lifetimeMs: previewLifetimeMs };
          assistantGrant = value.mode === 'setup' ? service.approveSetup(assistant, scope) : service.approveReadOnly(assistant, scope);
          return { status: 'approved', mode: value.mode, lifetimeMs: previewLifetimeMs, sharing: false };
        }
        if (value.action === 'assistant-end') {
          if (assistantGrant) service.revokeGrant(assistantGrant);
          assistantGrant = undefined;
          return { status: 'ended' };
        }
        if (!assistantGrant) throw new VaultAccessError('DENIED');
        if (value.action === 'assistant-unshare') { service.revokeDisclosure(assistantGrant); return { status: 'sharing-ended' }; }
        service.approveDisclosure(assistant, {
          grantId: assistantGrant, recordIds: [value.recordId], fields: [value.field],
          destination: 'claude-code-example', lifetimeMs: previewLifetimeMs,
        });
        return { status: 'sharing-approved', recordId: value.recordId, field: value.field };
      }
      if (value.action === 'approve') {
        connection?.close();
        connection = service.openConnection({ deviceId: 'fictional-windows' });
        const scope = { recordIds: Object.keys(examples), lifetimeMs: previewLifetimeMs };
        activeGrant = value.mode === 'setup'
          ? service.approveSetup(connection, scope) : service.approveReadOnly(connection, scope);
        return { grantId: activeGrant, mode: value.mode, lifetimeMs: previewLifetimeMs };
      }
      if (!connection || value.grantId !== activeGrant) throw new VaultAccessError('DENIED');
      if (value.action === 'end') {
        connection.close();
        activeGrant = undefined;
        return { status: 'ended' };
      }
      return connection.execute(value.grantId, recordRequest(value));
    },
    shutdown() { stopped = true; activeGrant = undefined; disconnectAssistant(); service.shutdown(); },
  });
}
