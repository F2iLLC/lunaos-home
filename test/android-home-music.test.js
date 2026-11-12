import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareAndroid } from '../scripts/prepare-android.mjs';
import { captureStandIns } from './support/music-capture-stand-ins.js';

// Home does not package the probe's capture class. It swaps in one that has speech
// recognized on the enrolled Mac, so music has to be proven in that build separately.
const voice = 'java/io/github/f2illc/lunaos/home/voiceprobe';
const musicSources = ['MusicCommand.java', 'MusicControl.java', 'MusicPlayer.java'];
const mainManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>';

async function prepared(context) {
  const root = await mkdtemp(join(tmpdir(), 'home-music-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project/gen/android');
  const src = join(projectRoot, 'app/src');
  const activity = join(src, 'main/java/io/github/f2illc/lunaos/home/preview');
  await mkdir(activity, { recursive: true });
  await writeFile(join(projectRoot, 'app/build.gradle'), 'dependencies {\n}\n');
  await writeFile(join(src, 'main/AndroidManifest.xml'), mainManifest);
  await writeFile(join(activity, 'MainActivity.kt'), await readFile(new URL('../scripts/android/MainActivity.kt', import.meta.url)));
  await prepareAndroid({ projectRoot });
  return { root, src };
}
async function files(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await files(join(root, entry.name), `${prefix}${entry.name}/`));
    else found.push(`${prefix}${entry.name}`);
  }
  return found;
}
const permissions = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match => match[1]);

test('the Home debug build packages the music classes and can see the Spotify app, with no new permission', async context => {
  const { src } = await prepared(context);
  for (const source of musicSources) {
    assert.deepEqual(await readFile(join(src, 'debug', voice, source)),
      await readFile(new URL(`../scripts/android-offline-voice-probe/${source}`, import.meta.url)), `${source} is packaged unchanged`);
  }
  const debug = await readFile(join(src, 'debug/AndroidManifest.xml'), 'utf8');
  assert.match(debug, /<queries>(?:(?!<\/queries>)[\s\S])*<package android:name="com\.spotify\.music"\s*\/>(?:(?!<\/queries>)[\s\S])*<\/queries>/);
  assert.equal(debug.match(/spotify/gi).length, 1, 'Spotify appears once, as a package Home may look for');
  assert.equal(debug.match(/<queries>/g).length, 1);
  // Seeing one named app needs no permission. Nothing that reaches other apps or other players is requested.
  for (const permission of permissions(debug)) {
    assert.doesNotMatch(permission, /QUERY_ALL_PACKAGES|MEDIA_CONTENT_CONTROL|MODIFY_AUDIO_SETTINGS|BIND_NOTIFICATION_LISTENER|spotify/i);
  }
  // Home still packages only the Mac-recognition capture class, now with the music route in it.
  const capture = await readFile(join(src, 'debug', voice, 'ProbeCapture.java'), 'utf8');
  assert.match(capture, /QuestionReply\.recognize/);
  assert.doesNotMatch(capture, /org\.vosk|new Model/);
  assert.match(capture, /MusicCommand\.accept/);
  assert.match(capture, /MusicPlayer\.send/);
});

test('builds that are not the Home debug build get neither the music classes nor the Spotify entry', async context => {
  const { src } = await prepared(context);
  const main = await readFile(join(src, 'main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(main, /spotify|<queries/i);
  assert.deepEqual(permissions(main), []);
  // Every prepared source outside debug, and every other debug package, is free of music.
  for (const file of await files(src)) {
    const debugVoice = file.startsWith(`debug/${voice}/`);
    const debugManifest = file === 'debug/AndroidManifest.xml';
    if (!debugVoice) assert.doesNotMatch(file, /Music(?:Command|Control|Player)/, `${file} is not a music class`);
    if (debugVoice || debugManifest || !/\.(?:java|kt|xml|json)$/.test(file)) continue;
    assert.doesNotMatch(await readFile(join(src, file), 'utf8'), /spotify|Music(?:Command|Control|Player)/i, `${file} does not mention music`);
  }
  // The desktop app is built from these; it never gains a Spotify or music entry.
  const desktop = new URL('../src-tauri/', import.meta.url);
  for (const name of await readdir(desktop)) {
    if (/^tauri\..*\.json$|^Cargo\.toml$|^build\.rs$/.test(name))
      assert.doesNotMatch(await readFile(new URL(name, desktop), 'utf8'), /spotify|MusicCommand|MusicPlayer/i, `${name} does not mention music`);
  }
  for (const directory of ['src', 'capabilities', 'permissions']) {
    const root = new URL(`${directory}/`, desktop);
    for (const file of await files(fileURLToPath(root))) {
      if (!/\.(?:rs|json|toml)$/.test(file)) continue;
      assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /spotify|MusicCommand|MusicPlayer/i, `${directory}/${file} does not mention music`);
    }
  }
});

test('Home turns a Mac-recognized music phrase into a key for Spotify, only after the wake phrase', async context => {
  const { root, src } = await prepared(context);
  const output = join(root, 'classes');
  const sources = [];
  for (const [name, text] of Object.entries(captureStandIns)) {
    const path = join(root, 'fakes', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    sources.push(path);
  }
  // The capture class and the music classes exactly as Home packages them.
  for (const name of ['ProbeCapture', 'MusicCommand', 'MusicControl', 'MusicPlayer', 'WakeSession', 'TimerCommand', 'TimerPhrase', 'QuestionPolicy'])
    sources.push(join(src, 'debug', voice, `${name}.java`));
  sources.push('test/fixtures/HomeMusicProbe.java');
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 120_000, encoding: 'utf8', stdio: 'pipe' });
  run('javac', ['-d', output, ...sources]);
  assert.match(run('java', ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.HomeMusicProbe']), /Home music checks passed/);
});
