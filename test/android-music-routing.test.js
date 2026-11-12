import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('music phrases after the wake phrase reach Spotify only, and never a timer or a question', async t => {
  const output = await mkdtemp(join(tmpdir(), 'home-music-routing-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 30_000, encoding: 'utf8', stdio: 'pipe' });
  // Only classes that need no Android framework: the parser, the delivery plan and the existing routing they must not disturb.
  const classes = ['TimerPhrase', 'TimerCommand', 'QuestionPolicy', 'WakeSession', 'MusicCommand', 'MusicControl', 'MusicCommandTest'];
  run('javac', ['-d', output, ...classes.map(name => `scripts/android-offline-voice-probe/${name}.java`), 'test/fixtures/MusicRoutingProbe.java']);
  for (const name of ['MusicCommandTest', 'MusicRoutingProbe']) {
    assert.match(run('java', ['-cp', output, `io.github.f2illc.lunaos.home.voiceprobe.${name}`]), /checks passed/);
  }
});
