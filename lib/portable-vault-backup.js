import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const detail = z.object({
  memberId: id,
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(240),
}).strict();
const snapshotSchema = z.object({
  schema: z.literal(1),
  records: z.record(id, detail).refine(records => Object.keys(records).length <= 64),
}).strict();
const archiveSchema = z.object({
  format: z.literal('lunaos-home-fictional-backup'),
  version: z.number().int(),
  cipher: z.literal('aes-256-gcm'),
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
}).strict();

const aad = Buffer.from('lunaos-home-fictional-backup:v1:aes-256-gcm', 'ascii');
const invalid = () => new Error('Synthetic backup could not be opened.');
const maxArchiveBytes = 65536;

function decode(value, length) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length && bytes.length !== length)) throw invalid();
  return bytes;
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw invalid();
}

// Developer-only synthetic format. One fresh random key is generated per archive;
// the caller must keep it separate from the archive. No password KDF is implied.
export function createPortableBackup(snapshot) {
  let records;
  try { records = snapshotSchema.parse(snapshot); }
  catch { throw invalid(); }
  const recoveryKey = randomBytes(32);
  const nonce = randomBytes(12);
  const plain = Buffer.from(JSON.stringify(records), 'utf8');
  try {
    const cipher = createCipheriv('aes-256-gcm', recoveryKey, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const archive = Buffer.from(JSON.stringify({
      format: 'lunaos-home-fictional-backup', version: 1, cipher: 'aes-256-gcm',
      nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    }), 'utf8');
    if (archive.length > maxArchiveBytes) throw invalid();
    return { archive, recoveryKey };
  } finally {
    plain.fill(0);
  }
}

export function openPortableBackup(archive, recoveryKey) {
  requireKey(recoveryKey);
  if (!Buffer.isBuffer(archive) || archive.length === 0 || archive.length > maxArchiveBytes) throw invalid();
  try {
    const parsed = archiveSchema.parse(JSON.parse(archive.toString('utf8')));
    if (parsed.version !== 1) throw new Error('Unsupported synthetic backup version.');
    const nonce = decode(parsed.nonce, 12);
    const tag = decode(parsed.tag, 16);
    const ciphertext = decode(parsed.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', recoveryKey, nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try { return snapshotSchema.parse(JSON.parse(plain.toString('utf8'))); }
    finally { plain.fill(0); }
  } catch (error) {
    if (error.message === 'Unsupported synthetic backup version.') throw error;
    throw invalid();
  }
}
