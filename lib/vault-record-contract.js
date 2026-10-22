import { z } from 'zod';

export const vaultRecordId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const vaultRecordDetail = z.object({
  memberId: vaultRecordId,
  label: z.string().trim().min(1).max(80).refine(value => value.isWellFormed()),
  value: z.string().trim().min(1).max(240).refine(value => value.isWellFormed()),
}).strict();
// Opaque change tokens, not authorization or secrets. A fresh token on every
// create/edit prevents a deleted and recreated ID from accepting an old edit.
export const vaultRevision = z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const versionedVaultRecord = z.object({ revision: vaultRevision, data: vaultRecordDetail }).strict();
export const vaultMutationReceipt = z.object({ revision: vaultRevision }).strict();
const target = { version: z.literal(2), recordId: vaultRecordId };
export const versionedVaultRequest = z.discriminatedUnion('action', [
  z.object({ ...target, action: z.literal('read') }).strict(),
  z.object({ ...target, action: z.literal('create'), data: vaultRecordDetail }).strict(),
  z.object({ ...target, action: z.literal('edit'), expectedRevision: vaultRevision, data: vaultRecordDetail }).strict(),
  z.object({ ...target, action: z.literal('delete'), expectedRevision: vaultRevision }).strict(),
]);

// Only trusted adapters may emit this, after rejecting a conditional mutation
// under their commit lock and before changing any persisted bytes.
export class VaultConflictError extends Error {
  constructor() { super('This record changed. Review it again before making another change.'); }
}
