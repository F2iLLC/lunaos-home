import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('offline voice pack requires every exact prompt and rejects tampering and malformed WAVs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'home-reply-pack-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const input = join(root,'input'); await mkdir(input);
  const prompts = JSON.parse(await readFile('scripts/android-offline-voice-probe/reply-prompts.json'));
  const wav = Buffer.alloc(4844);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(4800,40);
  const hash = b => createHash('sha256').update(b).digest('hex');
  const pack = {provider:'ElevenLabs',clips:prompts.map(c => ({...c,sha256:hash(wav)}))};
  for (const c of prompts) await writeFile(join(input,c.id+'.wav'),wav);
  const save = () => writeFile(join(input,'pack.json'),JSON.stringify(pack));
  await save();
  let sequence=0;
  const copy = () => execFileSync(process.platform==='win32'?'pwsh.exe':'pwsh',
    ['-NoProfile','-File','scripts/android-offline-voice-probe/copy-reply-prompts.ps1','-InputDirectory',input,'-OutputDirectory',join(root,'output-'+sequence++)],
    {windowsHide:true,stdio:'pipe',timeout:30000});
  assert.match(copy().toString(),new RegExp(prompts.length + ' offline ElevenLabs replies'));
  assert.ok(prompts.length >= 405 && prompts.some(c => c.id === 'setting-timer'));
  pack.clips[0].text='Unexpected wording'; await save();
  assert.throws(copy,/Reply manifest mismatch/);
  pack.clips[0].text=prompts[0].text; await save();
  const broken=Buffer.from(wav); broken.writeUInt16LE(2,22);
  await writeFile(join(input,prompts[0].id+'.wav'),broken);
  assert.throws(copy,/Reply checksum mismatch/);
  pack.clips[0].sha256=hash(broken); await save();
  assert.throws(copy,/Invalid or oversized reply WAV/);
  pack.clips.pop(); await save(); assert.throws(copy,/complete prepared ElevenLabs reply pack/);
});
