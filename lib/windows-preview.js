import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createVaultSessionService, VaultAccessError } from './vault-sessions.js';

const recordId = z.enum(['alex-work', 'sam-school']);
const grantId = z.string().uuid();
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), mode: z.enum(['read', 'setup']) }).strict(),
  z.object({ action: z.literal('end'), grantId }).strict(),
  z.object({ action: z.literal('record'), grantId, recordId, operation: z.enum(['read', 'create', 'edit']) }).strict(),
]);
const examples = Object.freeze({
  'alex-work': { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' },
  'sam-school': { memberId: 'sam-example', label: 'School', value: 'Meadow School' },
});
const changes = { 'alex-work': 'Willow Workshop', 'sam-school': 'Meadow Academy' };
export const previewLifetimeMs = 60000;

// Only fixed fictional records are reachable through this developer controller.
// The process capability is NOT device enrollment, OS unlock or user identity.
export function createWindowsPreview({ store, now, key = crypto.randomUUID() + crypto.randomUUID() }) {
  const service = createVaultSessionService({ store, now });
  service.admitDevice('fictional-windows');
  let connection;
  let activeGrant;
  let stopped = false;
  return Object.freeze({
    key,
    acceptsKey(candidate) {
      return typeof candidate === 'string' && Buffer.byteLength(candidate) === Buffer.byteLength(key) &&
        timingSafeEqual(Buffer.from(candidate), Buffer.from(key));
    },
    async request(input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new VaultAccessError('INVALID');
      if (stopped) throw new VaultAccessError('DENIED');
      const value = parsed.data;
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
      const request = { action: value.operation, recordId: value.recordId };
      if (value.operation !== 'read') {
        request.data = { ...examples[value.recordId] };
        if (value.operation === 'edit') request.data.value = changes[value.recordId];
      }
      return connection.execute(value.grantId, request);
    },
    shutdown() { stopped = true; activeGrant = undefined; service.shutdown(); },
  });
}
