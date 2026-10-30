import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { DraftError } from './drafts.js';
import { createVaultSessionService } from './vault-sessions.js';
import { openWindowsProbeStore } from './windows-probe-store.js';
import { registerVaultStoreSession } from './vault-store-lifecycle.js';

// Dedicated fictional store, stable across plugin versions and process restarts.
// It is never selected by an assistant argument and is not a production vault.
export const fictionalDraftStoreId = 'b203ff13-756b-4c0d-a7f7-a54ed592d864';
export const fictionalDetails = [
  { recordId: 'alex-work', memberId: 'alex-example', name: 'Alex Example', label: 'Workplace' },
  { recordId: 'alex-library', memberId: 'alex-example', name: 'Alex Example', label: 'Library' },
  { recordId: 'sam-school', memberId: 'sam-example', name: 'Sam Example', label: 'School' },
];

// Missing and damaged stores are deliberately different: only an absent owned
// directory permits initialization, and only an explicit save calls create.
export function createWindowsReviewedDraftStore({ probeId = fictionalDraftStoreId } = {}) {
  z.string().uuid().parse(probeId);
  if (process.platform !== 'win32' || !isAbsolute(process.env.LOCALAPPDATA ?? '')) throw Error('Windows storage unavailable.');
  const directory = join(process.env.LOCALAPPDATA, 'LunaOSHome', 'FictionalVaultAdapters', probeId);
  async function open(create) {
    let absent = false;
    try { await lstat(directory); } catch (error) { if (error.code === 'ENOENT') absent = true; else throw error; }
    if (absent && !create) return null;
    return openWindowsProbeStore({ probeId, contractVersion: 2, create: absent && create });
  }
  async function use(create, action) {
    const adapter = await open(create);
    if (!adapter) return null;
    const release = registerVaultStoreSession(adapter);
    try { return await action(adapter); } finally { release(); }
  }
  return {
    directory, contractVersion: 2,
    async read(id) { return use(false, store => store.read(id)); },
    async create(id, data) { return use(true, store => store.create(id, data)); },
    async edit(id, data, revision) {
      const result = await use(false, store => store.edit(id, data, revision));
      if (!result) throw Error('Missing fictional store.');
      return result;
    },
  };
}

const refSchema = z.object({ draftId: z.string().uuid(), personId: z.string().uuid(), itemId: z.string().uuid(), revision: z.number().int().nonnegative() }).strict();
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('view') }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('prepare'), ...refSchema.shape }).strict(),
  z.object({ action: z.literal('save'), approval: z.string().uuid() }).strict(),
]);

export function createReviewedDraftVault({ drafts, store, now = () => performance.now() }) {
  const key = randomBytes(32).toString('hex');
  const service = createVaultSessionService({ store, contractVersion: 2, now });
  service.admitDevice('local-fictional-review');
  let approval = null;
  let busy = false;
  let needsReadback = false;
  let ended = false;
  function selected(ref) {
    const draft = drafts.read();
    if (!draft || draft.id !== ref.draftId || draft.revision !== ref.revision) throw new DraftError('This draft changed. Check for updates and review the save again.', 409);
    const person = draft.people.find(p => p.id === ref.personId);
    const field = person?.fields.find(f => f.id === ref.itemId);
    const spec = fictionalDetails.find(s => s.name === person?.name && s.label === field?.label);
    if (!spec || !field || field.status !== 'confirmed' || !field.value) throw new DraftError('Choose Looks right on an Alex or Sam example detail before saving.', 409);
    if (draft.people.filter(p => p.name === person.name).length !== 1 || person.fields.filter(f => f.label === field.label).length !== 1) throw new DraftError('Duplicate example names or labels cannot be saved.', 409);
    return { spec, data: { memberId: spec.memberId, label: spec.label, value: field.value } };
  }
  async function read(connection, spec) {
    const grant = service.approveReadOnly(connection, { recordIds: [spec.recordId], lifetimeMs: 60000 });
    try { return await connection.execute(grant, { version: 2, action: 'read', recordId: spec.recordId }); }
    catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
    finally { service.revokeGrant(grant); }
  }
  return {
    key,
    acceptsKey(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(key)); },
    async request(input) {
      input = requestSchema.parse(input);
      if (ended || busy) throw new DraftError('A storage action is still finishing. View saved examples before continuing.', 409);
      busy = true;
      const connection = service.openConnection({ deviceId: 'local-fictional-review' });
      try {
        if (input.action === 'cancel') { approval = null; return { status: 'cancelled' }; }
        if (input.action === 'view') {
          approval = null;
          const records = [];
          for (const spec of fictionalDetails) {
            const record = await read(connection, spec);
            if (record) records.push({ name: spec.name, label: spec.label, value: record.data.value });
          }
          needsReadback = false;
          return { records };
        }
        if (needsReadback) throw new DraftError('View saved examples to check the last result before preparing another save.', 409);
        if (input.action === 'prepare') {
          approval = null;
          const { action, ...ref } = input;
          const { spec, data } = selected(ref);
          const previous = await read(connection, spec);
          selected(ref); // Draft may have changed while storage was reading.
          const token = crypto.randomUUID();
          approval = { token, ref, spec, data, previous, expiresAt: now() + 60000 };
          return { approval: token, name: spec.name, label: spec.label, value: data.value, previousValue: previous?.data.value ?? null, lifetimeMs: 60000 };
        }
        const approved = approval;
        approval = null; // Consume before any await; retries never repeat a write.
        if (!approved || input.approval !== approved.token || now() >= approved.expiresAt) throw new DraftError('This save approval expired. Review the detail again.', 409);
        selected(approved.ref);
        const operation = approved.previous ? 'edit' : 'create';
        const grant = (approved.previous ? service.approveEdit : service.approveCreate)(connection,
          { recordIds: [approved.spec.recordId], lifetimeMs: 60000 });
        try {
          const receipt = await connection.execute(grant, { version: 2, action: operation,
            recordId: approved.spec.recordId, data: approved.data,
            ...(approved.previous ? { expectedRevision: approved.previous.revision } : {}) });
          return { status: 'saved', accessEnded: receipt.accessEnded };
        } catch (error) { needsReadback = true; throw error; }
      } finally { connection.close(); busy = false; }
    },
    async close() { ended = true; approval = null; await service.shutdown(); },
  };
}
