import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareAndroid } from '../scripts/prepare-android.mjs';

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

// Stand-ins for the Android classes Home's capture and the music player touch. They record
// what would be sent. They do not simulate Android's delivery, audio focus policy or Spotify.
const fakes = {
  'android/Manifest.java': 'package android; public class Manifest { public static class permission { public static final String RECORD_AUDIO="record"; } }',
  'android/app/KeyguardManager.java': 'package android.app; public class KeyguardManager { public boolean isDeviceLocked() { return false; } }',
  'android/content/Context.java': `package android.content;
public class Context {
 public static final String KEYGUARD_SERVICE="keyguard", AUDIO_SERVICE="audio";
 public static final java.util.List<Intent> broadcasts=java.util.Collections.synchronizedList(new java.util.ArrayList<Intent>());
 public static volatile int launches;
 public static void reset() { broadcasts.clear(); launches=0; android.content.pm.PackageManager.lookups=0; android.media.AudioManager.focusRequests=0; android.media.AudioManager.focusAbandons=0; }
 private final android.app.KeyguardManager keyguard=new android.app.KeyguardManager();
 private final android.media.AudioManager audio=new android.media.AudioManager();
 private final android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
 public Context getApplicationContext() { return this; }
 public int checkSelfPermission(String name) { return android.content.pm.PackageManager.PERMISSION_GRANTED; }
 public Object getSystemService(String name) { return KEYGUARD_SERVICE.equals(name) ? keyguard : audio; }
 public android.content.pm.PackageManager getPackageManager() { return packages; }
 public void sendBroadcast(Intent intent) { broadcasts.add(intent); }
 public void sendOrderedBroadcast(Intent intent, String permission) { broadcasts.add(intent); }
 public void startActivity(Intent intent) { launches++; }
 public Object startService(Intent intent) { launches++; return null; }
 public Object startForegroundService(Intent intent) { launches++; return null; }
}`,
  'android/content/Intent.java': `package android.content;
public class Intent {
 public static final String ACTION_MEDIA_BUTTON="android.intent.action.MEDIA_BUTTON", EXTRA_KEY_EVENT="android.intent.extra.KEY_EVENT";
 public static final int FLAG_RECEIVER_FOREGROUND=0x10000000;
 public final String action; public String target; public int flags;
 public final java.util.Map<String,Object> extras=new java.util.HashMap<>();
 public Intent(String action) { this.action=action; }
 public Intent setPackage(String name) { target=name; return this; }
 public Intent addFlags(int value) { flags|=value; return this; }
 public Intent putExtra(String key, android.os.Parcelable value) { extras.put(key,value); return this; }
}`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public class PackageManager {
 public static final int PERMISSION_GRANTED=0;
 public static volatile boolean installed; public static volatile int lookups;
 public static class NameNotFoundException extends Exception {}
 public ApplicationInfo getApplicationInfo(String name,int flags) throws NameNotFoundException {
  lookups++;
  if(!installed || !"com.spotify.music".equals(name)) throw new NameNotFoundException();
  ApplicationInfo info=new ApplicationInfo(); info.enabled=true; return info;
 }
 public PackageInfo getPackageInfo(String name,int flags) throws NameNotFoundException { getApplicationInfo(name,flags); return new PackageInfo(); }
}`,
  'android/content/pm/ApplicationInfo.java': 'package android.content.pm; public class ApplicationInfo { public boolean enabled; }',
  'android/content/pm/PackageInfo.java': 'package android.content.pm; public class PackageInfo {}',
  'android/media/AudioAttributes.java': `package android.media;
public class AudioAttributes { public static final int USAGE_ASSISTANT=16, USAGE_MEDIA=1, CONTENT_TYPE_SPEECH=1;
 public static class Builder { public Builder setUsage(int v) {return this;} public Builder setContentType(int v) {return this;} public AudioAttributes build() {return new AudioAttributes();} } }`,
  'android/media/AudioFocusRequest.java': `package android.media;
public class AudioFocusRequest {
 public static class Builder { public Builder(int gain) {}
  public Builder setAudioAttributes(AudioAttributes a) {return this;}
  public Builder setOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener l) {return this;}
  public Builder setOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener l, android.os.Handler h) {return this;}
  public AudioFocusRequest build() {return new AudioFocusRequest();} } }`,
  'android/media/AudioManager.java': `package android.media;
public class AudioManager {
 public static final int AUDIOFOCUS_GAIN_TRANSIENT=2, AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK=3, AUDIOFOCUS_REQUEST_GRANTED=1, STREAM_MUSIC=3;
 public static volatile int focusRequests, focusAbandons;
 public interface OnAudioFocusChangeListener { void onAudioFocusChange(int change); }
 public boolean isMicrophoneMute() { return false; }
 public int requestAudioFocus(AudioFocusRequest request) { focusRequests++; return AUDIOFOCUS_REQUEST_GRANTED; }
 public int abandonAudioFocusRequest(AudioFocusRequest request) { focusAbandons++; return AUDIOFOCUS_REQUEST_GRANTED; }
}`,
  'android/media/AudioFormat.java': 'package android.media; public class AudioFormat { public static final int CHANNEL_IN_MONO=16, ENCODING_PCM_16BIT=2; }',
  'android/media/MediaRecorder.java': 'package android.media; public class MediaRecorder { public static class AudioSource { public static final int MIC=1; } }',
  // Each recorder yields one synthetic utterance: half a second of tone, then quiet.
  'android/media/AudioRecord.java': `package android.media;
public class AudioRecord {
 public static final int STATE_INITIALIZED=1, READ_NON_BLOCKING=1;
 private int reads;
 public AudioRecord(int source,int rate,int channel,int encoding,int size) {}
 public static int getMinBufferSize(int rate,int channel,int encoding) { return 3200; }
 public int getState() { return STATE_INITIALIZED; }
 public void startRecording() {} public void stop() {} public void release() {}
 public int read(short[] samples,int offset,int count,int mode) {
  short value=(short)(reads++ < 5 ? 1000 : 0);
  java.util.Arrays.fill(samples,offset,offset+count,value); return count;
 }
}`,
  'android/os/Parcelable.java': 'package android.os; public interface Parcelable {}',
  'android/os/Looper.java': 'package android.os; public class Looper { private static final Looper MAIN=new Looper(); public static Looper getMainLooper() { return MAIN; } }',
  'android/os/Handler.java': `package android.os;
public class Handler { public Handler(Looper looper) {} public Handler() {}
 public boolean post(Runnable r) { r.run(); return true; } public boolean postDelayed(Runnable r,long ms) { return true; } }`,
  'android/os/SystemClock.java': `package android.os;
public class SystemClock { public static long elapsedRealtime() { return System.nanoTime()/1000000L; } public static long uptimeMillis() { return elapsedRealtime(); } public static void sleep(long ms) { Thread.yield(); } }`,
  'android/util/Log.java': 'package android.util; public class Log { public static int i(String tag,String code) { return 0; } }',
  'android/view/KeyEvent.java': `package android.view;
public class KeyEvent implements android.os.Parcelable {
 public static final int ACTION_DOWN=0, ACTION_UP=1, KEYCODE_MEDIA_PLAY=126, KEYCODE_MEDIA_PAUSE=127, KEYCODE_MEDIA_NEXT=87, KEYCODE_MEDIA_PREVIOUS=88;
 private final int action, code;
 public KeyEvent(long down,long event,int action,int code,int repeat) { this.action=action; this.code=code; }
 public KeyEvent(int action,int code) { this.action=action; this.code=code; }
 public int getAction() { return action; } public int getKeyCode() { return code; }
}`,
  'io/github/f2illc/lunaos/home/voiceprobe/LunaFace.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class LunaFace { enum State { OFF, PREPARING, WAITING, AWAKE, REVIEW, RESPONSE, RETRY } }',
  'io/github/f2illc/lunaos/home/voiceprobe/TimerAlarmService.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class TimerAlarmService { static volatile boolean ringing; static boolean ringing() { return ringing; } static void duck(boolean value) {} }',
  // The enrolled Mac's recognizer, scripted. Once the script runs dry it hears nothing.
  'io/github/f2illc/lunaos/home/voiceprobe/QuestionReply.java': `package io.github.f2illc.lunaos.home.voiceprobe;
class QuestionReply {
 private static final java.util.concurrent.ConcurrentLinkedQueue<String> script=new java.util.concurrent.ConcurrentLinkedQueue<>();
 private static final java.util.concurrent.atomic.AtomicInteger unscripted=new java.util.concurrent.atomic.AtomicInteger();
 static void script(String... heard) { script.clear(); unscripted.set(0); script.addAll(java.util.Arrays.asList(heard)); }
 static int unscripted() { return unscripted.get(); }
 static boolean enabled(android.content.Context c) { return true; }
 static String recognize(android.content.Context c, byte[] pcm) { String next=script.poll(); if(next==null) { unscripted.incrementAndGet(); return ""; } return next; }
}`,
};

test('Home turns a Mac-recognized music phrase into a key for Spotify, only after the wake phrase', async context => {
  const { root, src } = await prepared(context);
  const output = join(root, 'classes');
  const sources = [];
  for (const [name, text] of Object.entries(fakes)) {
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
