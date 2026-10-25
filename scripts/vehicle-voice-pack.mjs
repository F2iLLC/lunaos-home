import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { vehicleGreetings } from '../lib/vehicle-greetings.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function voiceKey(voice, text) {
  if (!/^[A-Za-z0-9]{20,64}$/.test(voice) || typeof text !== 'string' || !text.length || text.length > 512) throw Error('Invalid voice clip identity');
  return sha256(`elevenlabs\n${voice}\n${text}`);
}
export function greetingTexts(nickname) {
  if (typeof nickname !== 'string' || !nickname.trim() || nickname.length > 40 || /[\p{Cc}{}]/u.test(nickname)) throw Error('Invalid nickname');
  return [...new Set(['morning', 'afternoon', 'evening'].flatMap(period => Object.values(vehicleGreetings).flat()
    .map(line => line.replace('{period}', period).replace('{name}', nickname.trim()))))];
}
export function readVoicePack(manifestPath) {
  if (statSync(manifestPath).size > 65536) throw Error('Voice manifest too large');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = new Set(greetingTexts(manifest.nickname));
  if (!Array.isArray(manifest.clips) || manifest.clips.length !== expected.size) throw Error('Incomplete voice pack');
  const root = realpathSync(dirname(manifestPath));
  const clips = manifest.clips.map(clip => {
    if (!expected.delete(clip.text)) throw Error('Unexpected or duplicate greeting');
    const key = voiceKey(manifest.voiceId, clip.text);
    if (typeof clip.file !== 'string' || isAbsolute(clip.file)) throw Error('Invalid clip path');
    const file = realpathSync(resolve(root, clip.file));
    const path = relative(root, file);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw Error('Clip outside pack');
    const size = statSync(file).size;
    if (size < 44 || size > 2 * 1024 * 1024) throw Error('Clip size invalid');
    const bytes = readFileSync(file);
    if (!/^[a-f0-9]{64}$/.test(clip.sha256) || sha256(bytes) !== clip.sha256) throw Error('Clip integrity failed');
    // Full PCM/chunk validation is performed by the production Java reader on
    // the phone before the new voice selection can be committed.
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== size - 8) throw Error('Invalid WAV');
    return { key, bytes, digest: clip.sha256 };
  });
  return { voiceId: manifest.voiceId, packId: sha256(clips.map(c => `${c.key}:${c.digest}`).sort().join('\n')), clips };
}
