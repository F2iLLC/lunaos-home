import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareAndroid } from '../scripts/prepare-android.mjs';
import { serviceStandIns } from './support/music-service-stand-ins.js';

const voice = 'java/io/github/f2illc/lunaos/home/voiceprobe';
const mainManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>';

test('the wake service keeps listening after a music result and leaves a not-sent reason up long enough to read', async context => {
  const root = await mkdtemp(join(tmpdir(), 'home-music-service-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project/gen/android');
  const src = join(projectRoot, 'app/src');
  const activity = join(src, 'main/java/io/github/f2illc/lunaos/home/preview');
  await mkdir(activity, { recursive: true });
  await writeFile(join(projectRoot, 'app/build.gradle'), 'dependencies {\n}\n');
  await writeFile(join(src, 'main/AndroidManifest.xml'), mainManifest);
  await writeFile(join(activity, 'MainActivity.kt'), await readFile(new URL('../scripts/android/MainActivity.kt', import.meta.url)));
  await prepareAndroid({ projectRoot });

  const output = join(root, 'classes');
  const sources = [];
  for (const [name, text] of Object.entries(serviceStandIns)) {
    const path = join(root, 'stand-ins', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    sources.push(path);
  }
  // The real service and timer classes, exactly as Home packages them. The capture, the replies
  // and the alarm receiver are stand-ins.
  for (const name of ['BackgroundWakeService', 'NativeTimers', 'PendingTimerRequest', 'TimerLedger', 'TimerCommand', 'TimerPhrase', 'WakeSession', 'TimerAlarmService', 'QuestionPolicy'])
    sources.push(join(src, 'debug', voice, `${name}.java`));
  sources.push('test/fixtures/MusicServiceProbe.java');
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 60_000, encoding: 'utf8', stdio: 'pipe' });
  run('javac', ['-d', output, ...sources]);
  assert.match(run('java', ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.MusicServiceProbe']), /Music service checks passed/);
});
