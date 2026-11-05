import {
  vaultRecordId, vaultRevision, vaultRecordData, vaultRecordDetail, versionedVaultRecord,
  VaultConflictError, VaultUnsupportedRecordError,
} from '../../lib/vault-record-contract.js';

// Same ceiling the Windows probe applies to one committed payload.
export const MEMORY_STORE_CEILING_BYTES = 262144;

// Reference VersionedVaultRecordStore v2 adapter for conformance tests. It is
// synthetic and process-local: "reopen" means a new adapter instance over the
// same backing map, which models restart for contract purposes only.
export function createMemoryVersionedStore(backing = new Map()) {
  const check = (schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) throw new TypeError('Invalid synthetic store input.');
    return result.data;
  };
  /**
   * Read and validate a stored row, or return null when the record is missing.
   * @param {string} recordId
   * @returns {Record<string, unknown> | null}
   * @throws {TypeError} When stored JSON or the versioned record is invalid.
   */
  const readRow = recordId => {
    const encoded = backing.get(recordId);
    if (encoded === undefined) return null;
    try {
      return check(versionedVaultRecord, JSON.parse(encoded));
    } catch {
      throw new TypeError(`Invalid synthetic store row for record ID ${JSON.stringify(recordId)}.`);
    }
  };
  function commit(recordId, data) {
    const revision = crypto.randomUUID();
    const row = { revision, data: structuredClone(data) };
    // Compare-and-commit happens synchronously below, so concurrent callers
    // observe either the old row or this complete row, never a mixture.
    // JSON is this reference adapter's backing representation, so the ceiling
    // check counts the exact bytes that the adapter stores.
    const encoded = JSON.stringify(row);
    if (Buffer.byteLength(encoded) > MEMORY_STORE_CEILING_BYTES) {
      throw new Error('Synthetic store payload exceeds its commit ceiling.');
    }
    backing.set(recordId, encoded);
    return { revision };
  }
  function expect(recordId, expectedRevision) {
    const current = readRow(recordId);
    if (!current || current.revision !== expectedRevision) throw new VaultConflictError();
    return current;
  }
  const adapter = {
    contractVersion: 2,
    async read(recordId) {
      check(vaultRecordId, recordId);
      return readRow(recordId);
    },
    async create(recordId, data) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordData, data);
      if (backing.has(recordId)) throw new VaultConflictError();
      return commit(recordId, value);
    },
    async edit(recordId, data, expectedRevision) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordData, data);
      check(vaultRevision, expectedRevision);
      expect(recordId, expectedRevision);
      return commit(recordId, value);
    },
    async editProfile(recordId, data, expectedRevision) {
      check(vaultRecordId, recordId);
      const value = check(vaultRecordDetail, data);
      check(vaultRevision, expectedRevision);
      const current = expect(recordId, expectedRevision);
      if (current.data?.kind === 'grocery-list') throw new VaultUnsupportedRecordError();
      return commit(recordId, value);
    },
    async delete(recordId, expectedRevision) {
      check(vaultRecordId, recordId);
      check(vaultRevision, expectedRevision);
      expect(recordId, expectedRevision);
      backing.delete(recordId);
      return { revision: expectedRevision };
    },
  };
  return Object.freeze(adapter);
}
