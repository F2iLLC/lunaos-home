import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureStandIns, speechLibraryStandIns } from './support/music-capture-stand-ins.js';

// The offline voice test app's own capture class, not a re-enactment of its routing order.
test('the on-device recognizer path routes music only for wake listening and only after the wake phrase', async context => {
  const root = await mkdtemp(join(tmpdir(), 'home-offline-music-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'classes');
  const sources = [];
  for (const [name, text] of Object.entries({ ...captureStandIns, ...speechLibraryStandIns })) {
    const path = join(root, 'stand-ins', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    sources.push(path);
  }
  for (const name of ['ProbeCapture', 'CommandAudio', 'WakeSession', 'TimerPhrase', 'TimerCommand', 'QuestionPolicy', 'MusicCommand', 'MusicControl', 'MusicPlayer'])
    sources.push(`scripts/android-offline-voice-probe/${name}.java`);
  sources.push('test/fixtures/OfflineMusicProbe.java');
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 120_000, encoding: 'utf8', stdio: 'pipe' });
  run('javac', ['-d', output, ...sources]);
  assert.match(run('java', ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.OfflineMusicProbe']), /Offline music checks passed/);
});
