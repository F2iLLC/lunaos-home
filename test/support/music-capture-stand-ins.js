// Stand-ins for the Android, speech-library and reply classes that Luna's two capture classes
// and the music player touch. They record what would be sent and keep a clock that only audio
// moves, so a test's outcome does not depend on how fast the machine is. They do not simulate
// Android's broadcast delivery or audio focus policy, a real recognizer, or Spotify.
export const captureStandIns = {
  'android/Manifest.java': 'package android; public class Manifest { public static class permission { public static final String RECORD_AUDIO="record"; } }',
  'android/app/KeyguardManager.java': 'package android.app; public class KeyguardManager { public boolean isDeviceLocked() { return false; } }',
  'android/content/res/AssetManager.java': `package android.content.res;
public class AssetManager { public String[] list(String path) { return new String[0]; }
 public java.io.InputStream open(String path) { return new java.io.ByteArrayInputStream(new byte[0]); } }`,
  'android/content/Context.java': `package android.content;
public class Context {
 public static final String KEYGUARD_SERVICE="keyguard", AUDIO_SERVICE="audio";
 public static final java.util.List<Intent> broadcasts=java.util.Collections.synchronizedList(new java.util.ArrayList<Intent>());
 public static volatile int launches;
 public static volatile java.io.File files;
 /** A fresh session: nothing sent, nothing looked up, no focus taken, and the clock back at its start. */
 public static void reset() {
  broadcasts.clear(); launches=0; android.content.pm.PackageManager.lookups=0;
  android.media.AudioManager.focusRequests=0; android.media.AudioManager.focusAbandons=0;
  android.media.AudioRecord.reset(); android.os.SystemClock.reset();
 }
 private final android.app.KeyguardManager keyguard=new android.app.KeyguardManager();
 private final android.media.AudioManager audio=new android.media.AudioManager();
 private final android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
 public Context getApplicationContext() { return this; }
 public int checkSelfPermission(String name) { return android.content.pm.PackageManager.PERMISSION_GRANTED; }
 public Object getSystemService(String name) { return KEYGUARD_SERVICE.equals(name) ? keyguard : audio; }
 public android.content.pm.PackageManager getPackageManager() { return packages; }
 public java.io.File getFilesDir() { return files; }
 public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(); }
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
 public synchronized int requestAudioFocus(AudioFocusRequest request) { focusRequests++; return AUDIOFOCUS_REQUEST_GRANTED; }
 public synchronized int abandonAudioFocusRequest(AudioFocusRequest request) { focusAbandons++; return AUDIOFOCUS_REQUEST_GRANTED; }
 public int requestAudioFocus(OnAudioFocusChangeListener l,int stream,int gain) { focusRequests++; return AUDIOFOCUS_REQUEST_GRANTED; }
 public int abandonAudioFocus(OnAudioFocusChangeListener l) { focusAbandons++; return AUDIOFOCUS_REQUEST_GRANTED; }
}`,
  'android/media/AudioFormat.java': 'package android.media; public class AudioFormat { public static final int CHANNEL_IN_MONO=16, ENCODING_PCM_16BIT=2; }',
  'android/media/MediaRecorder.java': 'package android.media; public class MediaRecorder { public static class AudioSource { public static final int MIC=1; } }',
  'android/media/ToneGenerator.java': `package android.media;
public class ToneGenerator { public static final int TONE_PROP_BEEP=24; public ToneGenerator(int stream,int volume) {}
 public boolean startTone(int tone,int ms) { return true; } public void stopTone() {} public void release() {} }`,
  // The microphone. Every read is 100 ms of audio and moves the clock by that much; nothing
  // else moves it. With "paced" set it never runs more than 200 ms ahead of what a recognizer
  // has taken, as a real microphone cannot run ahead of real time. A recorder opened while
  // "voiced" is true hears one utterance: half a second of tone, then quiet.
  'android/media/AudioRecord.java': `package android.media;
public class AudioRecord {
 public static final int STATE_INITIALIZED=1, READ_NON_BLOCKING=1, RECORDSTATE_STOPPED=1, RECORDSTATE_RECORDING=3;
 public static volatile java.util.function.BooleanSupplier voiced;
 public static volatile Runnable onRead;
 public static volatile boolean paced;
 public static volatile long produced, consumed;
 public static volatile int opened, reads;
 public static void reset() { voiced=null; onRead=null; paced=false; produced=0; consumed=0; opened=0; reads=0; }
 private final boolean utterance; private int own; private boolean recording;
 public AudioRecord(int source,int rate,int channel,int encoding,int size) {
  java.util.function.BooleanSupplier room=voiced; utterance=room!=null && room.getAsBoolean(); opened++;
 }
 public static int getMinBufferSize(int rate,int channel,int encoding) { return 3200; }
 public int getState() { return STATE_INITIALIZED; }
 public int getRecordingState() { return recording ? RECORDSTATE_RECORDING : RECORDSTATE_STOPPED; }
 public int getBufferSizeInFrames() { return 6400; }
 public void startRecording() { recording=true; } public void stop() { recording=false; } public void release() { recording=false; }
 public int read(short[] samples,int offset,int count,int mode) {
  Runnable hook=onRead; if(hook!=null) hook.run();
  if(!recording) return 0;
  if(paced && produced-consumed >= 3200) return 0;
  short value=(short)(utterance && own++ < 5 ? 1000 : 0);
  java.util.Arrays.fill(samples,offset,offset+count,value);
  produced+=count; reads++; android.os.SystemClock.advance(count/16);
  return count;
 }
}`,
  'android/os/Parcelable.java': 'package android.os; public interface Parcelable {}',
  'android/os/Looper.java': 'package android.os; public class Looper { private static final Looper MAIN=new Looper(); public static Looper getMainLooper() { return MAIN; } }',
  // Posted work runs at once on the calling thread. Delayed work (the capture watchdog, closing
  // the wake cue) is dropped; the capture loops check their own deadlines.
  'android/os/Handler.java': `package android.os;
public class Handler { public Handler(Looper looper) {} public Handler() {}
 public boolean post(Runnable r) { r.run(); return true; } public boolean postDelayed(Runnable r,long ms) { return true; }
 public void removeCallbacks(Runnable r) {} public void removeCallbacksAndMessages(Object token) {} }`,
  // A clock that only captured audio moves. Sleeping yields and does not pass time.
  'android/os/SystemClock.java': `package android.os;
public class SystemClock {
 private static final java.util.concurrent.atomic.AtomicLong now=new java.util.concurrent.atomic.AtomicLong(1000);
 public static void reset() { now.set(1000); }
 public static void advance(long ms) { now.addAndGet(ms); }
 public static long elapsedRealtime() { return now.get(); } public static long uptimeMillis() { return now.get(); }
 public static void sleep(long ms) { Thread.yield(); }
}`,
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
  // In Home this is the enrolled Mac's recognizer, scripted: one entry per utterance. An entry
  // of "!unavailable" fails like an unreachable host. Once the script runs dry the room is quiet.
  'io/github/f2illc/lunaos/home/voiceprobe/QuestionReply.java': `package io.github.f2illc.lunaos.home.voiceprobe;
class QuestionReply {
 private static final java.util.concurrent.ConcurrentLinkedQueue<String> script=new java.util.concurrent.ConcurrentLinkedQueue<>();
 static volatile boolean enabled;
 static void script(String... heard) { script.clear(); script.addAll(java.util.Arrays.asList(heard)); }
 static boolean pending() { return !script.isEmpty(); }
 static boolean enabled(android.content.Context c) { return enabled; }
 static String recognize(android.content.Context c, byte[] pcm) throws java.io.IOException {
  String next=script.poll();
  if("!unavailable".equals(next)) throw new java.io.IOException("synthetic host failure");
  return next==null ? "" : next;
 }
}`,
};

// The speech library the offline voice test app links, scripted. The fixed-phrase recognizer
// "hears" the next scripted phrase after every half second of audio; the free-form one returns
// its next scripted text as its final result. Neither looks at the audio.
export const speechLibraryStandIns = {
  'org/json/JSONObject.java': `package org.json;
public class JSONObject {
 private final String source;
 public JSONObject(String source) { this.source=source; }
 public String optString(String key,String fallback) {
  java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\"" + key + "\\"\\\\s*:\\\\s*\\"([^\\"]*)\\"").matcher(source);
  return m.find() ? m.group(1) : fallback;
 }
}`,
  'com/sun/jna/Function.java': 'package com.sun.jna; public class Function { public int invokeInt(Object[] args) { return 0; } }',
  'com/sun/jna/NativeLibrary.java': 'package com.sun.jna; public class NativeLibrary { public static NativeLibrary getInstance(String name) { return new NativeLibrary(); } public Function getFunction(String name) { return new Function(); } }',
  'org/vosk/LibVosk.java': 'package org.vosk; public class LibVosk { public static void vosk_set_log_level(int level) {} }',
  'org/vosk/Model.java': 'package org.vosk; public class Model { public Model(String path) throws java.io.IOException {} public Object getPointer() { return this; } public void close() {} }',
  'org/vosk/Recognizer.java': `package org.vosk;
public class Recognizer {
 public static final java.util.List<String> grammars=java.util.Collections.synchronizedList(new java.util.ArrayList<String>());
 public static final java.util.concurrent.ConcurrentLinkedQueue<String> phrases=new java.util.concurrent.ConcurrentLinkedQueue<>();
 public static final java.util.concurrent.ConcurrentLinkedQueue<String> freeForm=new java.util.concurrent.ConcurrentLinkedQueue<>();
 /** What held when the free-form decode began: focus given back so far, and whether the microphone was still on. */
 public static volatile int abandonsAtDecode=-1; public static volatile boolean recordingAtDecode;
 public static volatile java.util.function.BooleanSupplier recording;
 public static void script(String[] fixed,String[] free) {
  phrases.clear(); freeForm.clear(); abandonsAtDecode=-1; recordingAtDecode=false;
  phrases.addAll(java.util.Arrays.asList(fixed)); freeForm.addAll(java.util.Arrays.asList(free));
 }
 private final boolean fixed; private int chunks;
 public Recognizer(Model model,float rate,String grammar) { fixed=true; grammars.add(grammar); }
 public Recognizer(Model model,float rate) { fixed=false; }
 private static void decodeBegins() {
  if(abandonsAtDecode>=0) return;
  abandonsAtDecode=android.media.AudioManager.focusAbandons;
  java.util.function.BooleanSupplier on=recording; recordingAtDecode=on!=null && on.getAsBoolean();
 }
 public boolean acceptWaveForm(short[] data,int count) {
  if(!fixed) { decodeBegins(); return false; }
  android.media.AudioRecord.consumed+=count;
  String next=phrases.peek();
  if(next==null) return false;
  if("!fail".equals(next)) { phrases.poll(); throw new IllegalStateException("synthetic engine failure"); }
  return ++chunks % 5 == 0;
 }
 public String getResult() { String next=fixed ? phrases.poll() : null; return "{\\"text\\" : \\"" + (next==null ? "" : next) + "\\"}"; }
 public String getFinalResult() { if(!fixed) decodeBegins(); String next=fixed ? null : freeForm.poll(); return "{\\"text\\" : \\"" + (next==null ? "" : next) + "\\"}"; }
 public String getPartialResult() { return "{\\"partial\\" : \\"\\"}"; }
 public void reset() { chunks=0; }
 public void close() {}
}`,
};
