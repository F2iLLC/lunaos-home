import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('finalized speech keeps timer commands local and questions behind a wake', async t => {
  const output = await mkdtemp(join(tmpdir(), 'home-command-routing-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 30_000, encoding: 'utf8', stdio: 'pipe' });
  const classes = ['TimerPhrase', 'TimerCommand', 'QuestionPolicy', 'WakeSession', 'CommandAudio', 'TimerPhraseTest', 'WakeSessionTest', 'CommandAudioTest'];
  run('javac', ['-d', output, ...classes.map(name => `scripts/android-offline-voice-probe/${name}.java`), 'test/fixtures/CommandRoutingProbe.java']);
  for (const name of ['TimerPhraseTest', 'WakeSessionTest', 'CommandAudioTest', 'CommandRoutingProbe']) {
    assert.match(run('java', ['-cp', output, `io.github.f2illc.lunaos.home.voiceprobe.${name}`]), /checks passed/);
  }
});
