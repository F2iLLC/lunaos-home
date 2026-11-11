import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Only Android APIs and the narrow JSON API are doubles. QuestionReply,
// QuestionPolicy, HTTPS, certificate trust and HTTP I/O execute unchanged.
const fakes = {
  'android/content/Context.java': `package android.content;
public class Context {
 public static final int MODE_PRIVATE=0; public final java.io.File dir;
 public Context(java.io.File d){dir=d;} public Context getApplicationContext(){return this;}
 public java.io.File getFilesDir(){return dir;}
 public SharedPreferences getSharedPreferences(String n,int m){return new SharedPreferences();}
 public static class SharedPreferences {public boolean getBoolean(String k,boolean d){return true;}}
}`,
  'android/os/Looper.java': 'package android.os; public class Looper {public static Looper getMainLooper(){return new Looper();}}',
  'android/os/Handler.java': `package android.os;
public class Handler {
 private static final java.util.List<Task> tasks=new java.util.ArrayList<>();
 private record Task(Handler owner,Runnable run,long due){}
 public Handler(Looper l){}
 public boolean post(Runnable r){return postDelayed(r,0);}
 public boolean postDelayed(Runnable r,long ms){synchronized(tasks){tasks.add(new Task(this,r,System.nanoTime()+ms*1000000));}return true;}
 public void removeCallbacksAndMessages(Object o){synchronized(tasks){tasks.removeIf(t->t.owner==this);}}
 public static void pump(){while(true){Task ready=null;synchronized(tasks){for(Task t:tasks)if(t.due<=System.nanoTime()){ready=t;break;}if(ready!=null)tasks.remove(ready);}if(ready==null)return;ready.run.run();}}
}`,
  'android/media/AudioAttributes.java': `package android.media; public class AudioAttributes {
 public static final int USAGE_ASSISTANCE_ACCESSIBILITY=1,CONTENT_TYPE_SPEECH=2;
 public static class Builder {public Builder setUsage(int n){return this;}public Builder setContentType(int n){return this;}public AudioAttributes build(){return new AudioAttributes();}}
}`,
  'android/media/MediaDataSource.java': `package android.media; public abstract class MediaDataSource {
 public abstract int readAt(long p,byte[] b,int o,int s);public abstract long getSize();public abstract void close();
}`,
  'android/media/MediaPlayer.java': `package android.media; public class MediaPlayer {
 public interface Listener{void call(MediaPlayer p);}public interface ErrorListener{boolean call(MediaPlayer p,int w,int e);}
 public static MediaPlayer last;public static int starts,releases;public MediaDataSource source;
 public Listener prepared,completed;public ErrorListener error;
 public MediaPlayer(){last=this;}public void setAudioAttributes(AudioAttributes a){}
 public void setDataSource(MediaDataSource s){source=s;}
 public void setOnPreparedListener(Listener l){prepared=l;}public void setOnCompletionListener(Listener l){completed=l;}
 public void setOnErrorListener(ErrorListener l){error=l;}public void prepareAsync(){}
 public void start(){starts++;}public void release(){releases++;}
}`,
  'android/util/Log.java': 'package android.util; public class Log {public static int i(String t,String c){return 0;}}',
  'io/github/f2illc/lunaos/home/voiceprobe/BackgroundWakeService.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class BackgroundWakeService {static boolean running=true;}',
  'io/github/f2illc/lunaos/home/voiceprobe/ProbeCapture.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class ProbeCapture {static boolean blocked(android.content.Context c){return false;} static void releaseEngine(){}}',
  'org/json/JSONObject.java': `package org.json;
public class JSONObject {
 private final java.util.Map<String,String> values=new java.util.HashMap<>();
 public JSONObject(){}public JSONObject(String text){
  var m=java.util.regex.Pattern.compile("\\\"(token|certificate)\\\"\\\\s*:\\\"((?:\\\\\\\\.|[^\\\"])*)\\\"").matcher(text);
  while(m.find())values.put(m.group(1),m.group(2).replace("\\\\n","\\n"));
 }
 public String getString(String k){if(!values.containsKey(k))throw new IllegalArgumentException();return values.get(k);}
 public JSONObject put(String k,String v){values.put(k,v);return this;}
 public String toString(){return "{\\\"question\\\":\\\""+values.get("question")+"\\\"}";}
}`,
};

test('real question reply handles HTTPS results, deadlines and cancellation', async t => {
  const output = await mkdtemp(join(tmpdir(), 'home-question-reply-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const run = (name, args) => execFileSync(tool(name), args, { windowsHide: true, timeout: 45_000, encoding: 'utf8', stdio: 'pipe' });
  run('keytool', ['-genkeypair', '-alias', 'relay', '-keyalg', 'RSA', '-keystore', join(output, 'relay.p12'), '-storetype', 'PKCS12', '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost', '-validity', '1', '-noprompt']);
  const sources = [];
  for (const [name, content] of Object.entries(fakes)) {
    const path = join(output, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    sources.push(path);
  }
  run('javac', ['-d', output, ...sources, 'scripts/android-offline-voice-probe/QuestionReply.java', 'scripts/android-offline-voice-probe/QuestionPolicy.java', 'test/fixtures/QuestionReplyProbe.java']);
  assert.match(run('java', ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.QuestionReplyProbe', output]), /Question reply contract checks passed/);
  // Home uses a provisioned endpoint and also serves the native notebook page.
  // Compile that shipped variant too, against the same Android API fixtures.
  run('javac', ['-d', output, ...sources, 'scripts/android/voice/HomeQuestionReply.java', 'scripts/android-offline-voice-probe/QuestionPolicy.java']);
});
