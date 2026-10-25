import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { voiceKey, sha256, greetingTexts, readVoicePack } from '../scripts/vehicle-voice-pack.mjs';

test('production cached voice reader validates exact voice/text, all periods, PCM integrity and preserves the lead-in', async t => {
  const root = await mkdtemp(join(tmpdir(), 'home-voice-cache-')); t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('javac', ['-d', root, ...['VehicleVoiceCache', 'VehicleLeadIn', 'VehicleGreetings'].map(name => `scripts/android/vehicle/${name}.java`), 'test/java/VehicleVoiceCacheTest.java'], { windowsHide: true });
  const result = execFileSync('java', ['-cp', root, 'io.github.f2illc.lunaos.home.vehicle.VehicleVoiceCacheTest', root, voiceKey('abcdefghijklmnopqrst', greetingTexts('Example')[0])], { windowsHide: true, encoding: 'utf8' });
  assert.match(result, /passed/);
});

test('voice pack importer rejects partial, duplicate, wrong, corrupt and escaping files before touching the phone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'home-voice-pack-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVE', 8);
  await writeFile(join(root, 'clip.wav'), bytes);
  const pack = { voiceId: 'abcdefghijklmnopqrst', nickname: 'Example', clips: greetingTexts('Example').map(text => ({ text, file: 'clip.wav', sha256: sha256(bytes) })) };
  const manifest = join(root, 'manifest.json');
  const read = async data => { await writeFile(manifest, JSON.stringify(data)); return () => readVoicePack(manifest); };
  const valid = (await read(pack))();
  assert.equal(valid.clips.length, 28);
  assert.match(valid.packId, /^[a-f0-9]{64}$/);
  const reordered = structuredClone(pack); reordered.clips.reverse();
  assert.equal((await read(reordered))().packId, valid.packId);
  const changedVoice = structuredClone(pack); changedVoice.voiceId = 'zyxwvutsrqponmlkjihg';
  assert.notEqual((await read(changedVoice))().packId, valid.packId);
  for (const nickname of ['', 'x'.repeat(41), 'bad\nname', '{name}']) assert.throws(() => greetingTexts(nickname));
  assert.throws(() => voiceKey('../path', 'Hello'));
  for (const mutate of [
    p => p.clips.pop(), p => p.clips[1] = p.clips[0], p => p.nickname = 'Other', p => p.voiceId = '../path',
    p => p.clips[0].sha256 = '0'.repeat(64), p => p.clips[0].file = manifest,
    p => p.clips[0].file = '../missing.wav', p => p.clips[0].text += ' fabricated',
  ]) { const bad = structuredClone(pack); mutate(bad); assert.throws(await read(bad)); }
  await writeFile(join(root, 'clip.wav'), Buffer.alloc(2 * 1024 * 1024 + 1)); assert.throws(await read(pack));
});
