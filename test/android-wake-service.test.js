import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Execute the actual service against a deterministic clock, scheduler and capture
// boundary. These fakes do not simulate Android permission enforcement or audio.
const fakes = {
  'android/content/Context.java': `package android.content;
public class Context {
 public static final String NOTIFICATION_SERVICE="notification", POWER_SERVICE="power";
 public final android.app.NotificationManager notifications=new android.app.NotificationManager();
 public final android.os.PowerManager power=new android.os.PowerManager();
 public Object getSystemService(String name) { return name.equals(POWER_SERVICE)?power:notifications; }
 public boolean stopService(Intent intent) { return true; }
}`,
  'android/content/Intent.java': `package android.content;
public class Intent {
 public static final int FLAG_ACTIVITY_SINGLE_TOP=1, FLAG_ACTIVITY_CLEAR_TOP=2;
 private String action;
 public Intent(Context context, Class<?> cls) {}
 public Intent setAction(String value) { action=value; return this; }
 public String getAction() { return action; }
 public Intent addFlags(int flags) { return this; }
}`,
  'android/app/Service.java': `package android.app;
public class Service extends android.content.Context {
 public static final int START_NOT_STICKY=2;
 public boolean foreground, stopped;
 public void startForeground(int id, Notification n) { foreground=true; }
 public void stopForeground(boolean remove) { foreground=false; }
 public void stopSelf() { stopped=true; }
 public int onStartCommand(android.content.Intent i,int f,int id) { return 0; }
 public void onDestroy() {}
 public android.os.IBinder onBind(android.content.Intent i) { return null; }
}`,
  'android/app/Notification.java': `package android.app;
public class Notification {
 public static final int VISIBILITY_PRIVATE=0;
 public static class Builder {
  public Builder(android.content.Context c,String s) {}
  public Builder setSmallIcon(int i) { return this; }
  public Builder setContentTitle(String s) { return this; }
  public Builder setContentText(String s) { return this; }
  public Builder setStyle(BigTextStyle s) { return this; }
  public Builder setContentIntent(PendingIntent p) { return this; }
  public Builder setOnlyAlertOnce(boolean b) { return this; }
  public Builder setOngoing(boolean b) { return this; }
  public Builder setVisibility(int i) { return this; }
  public Builder addAction(Action a) { return this; }
  public Notification build() { return new Notification(); }
 }
 public static class BigTextStyle { public BigTextStyle bigText(String s) { return this; } }
 public static class Action { public static class Builder {
  public Builder(Object icon,String s,PendingIntent p) {}
  public Action build() { return new Action(); }
 } }
}`,
  'android/app/NotificationChannel.java': `package android.app;
public class NotificationChannel {
 public NotificationChannel(String id,String name,int importance) {}
 public void setSound(Object a,Object b) {}
 public void enableVibration(boolean b) {}
}`,
  'android/app/NotificationManager.java': `package android.app;
public class NotificationManager {
 public static final int IMPORTANCE_LOW=2;
 public void createNotificationChannel(NotificationChannel c) {}
 public void notify(int id,Notification n) {}
 public void cancel(int id) {}
}`,
  'android/app/PendingIntent.java': `package android.app;
public class PendingIntent {
 public static final int FLAG_IMMUTABLE=1, FLAG_UPDATE_CURRENT=2;
 public static PendingIntent getActivity(android.content.Context c,int id,android.content.Intent i,int f) { return new PendingIntent(); }
 public static PendingIntent getService(android.content.Context c,int id,android.content.Intent i,int f) { return new PendingIntent(); }
}`,
  'android/os/IBinder.java': 'package android.os; public interface IBinder {}',
  'android/os/SystemClock.java': `package android.os;
public class SystemClock { public static long now; public static long elapsedRealtime() { return now; } }`,
  'android/os/Handler.java': `package android.os;
public class Handler {
 private static class Task { Handler owner; Runnable run; long due;
  Task(Handler h,Runnable r,long d) {owner=h;run=r;due=d;} }
 private static final java.util.List<Task> tasks=new java.util.ArrayList<>();
 public boolean post(Runnable r) { return postDelayed(r,0); }
 public boolean postDelayed(Runnable r,long ms) {tasks.add(new Task(this,r,SystemClock.now+ms));return true;}
 public void removeCallbacksAndMessages(Object token) {tasks.removeIf(t -> t.owner==this);}
 public static void advance(long ms) {
  SystemClock.now+=ms;
  for(int limit=0;limit<1000;limit++) {
   Task ready=null;
   for(Task t:tasks) if(t.due<=SystemClock.now) {ready=t;break;}
   if(ready==null) return;
   tasks.remove(ready); ready.run.run();
  }
  throw new AssertionError("Unbounded scheduled retry");
 }
}`,
  'android/os/PowerManager.java': `package android.os;
public class PowerManager {
 public static final int PARTIAL_WAKE_LOCK=1;
 public WakeLock last;
 public WakeLock newWakeLock(int kind,String tag) {last=new WakeLock();return last;}
 public static class WakeLock {
  private long until; public int acquisitions;
  public void setReferenceCounted(boolean b) {}
  public boolean isHeld() {return until>SystemClock.now;}
  public void acquire(long ms) {until=SystemClock.now+ms;acquisitions++;}
  public void release() {until=0;}
 }
}`,
  'android/util/Log.java': 'package android.util; public class Log { public static int i(String tag,String code) { return 0; } }',
  'android/R.java': 'package android; public class R { public static class drawable { public static int ic_btn_speak_now=1; } }',
  'io/github/f2illc/lunaos/home/voiceprobe/VoiceProbe.java': 'package io.github.f2illc.lunaos.home.voiceprobe; public class VoiceProbe {}',
  'io/github/f2illc/lunaos/home/voiceprobe/LunaFace.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class LunaFace { enum State { OFF, PREPARING, WAITING, AWAKE, REVIEW, RETRY } }',
  'io/github/f2illc/lunaos/home/voiceprobe/ProbeCapture.java': `package io.github.f2illc.lunaos.home.voiceprobe;
class ProbeCapture {
 interface Listener {void visual(LunaFace.State s);void status(String s);void finished(String c,String t,int s,long d,boolean canceled);}
 static boolean blocked, busy; static int starts; static ProbeCapture last;
 final Listener listener; boolean stopped;
 ProbeCapture(android.content.Context c,boolean audio,boolean wait,boolean persistent,Listener l) {
  if(!audio||!wait||!persistent) throw new AssertionError("Persistent capture required");
  listener=l;last=this;
 }
 static boolean blocked(android.content.Context c) {return blocked;}
 static boolean busy() {return busy;}
 boolean start() {if(busy) return false;busy=true;starts++;return true;}
 void stop() {stopped=true;}
 void finish(String code,int seconds,boolean canceled) {
  busy=false;listener.finished(code,code,seconds,android.os.SystemClock.now+10000,canceled);
 }
}`,
};

test('wake service persists, resumes review and deadlines, and rejects late or revoked workers', async t => {
  const output = await mkdtemp(join(tmpdir(), 'home-wake-service-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const sources = [];
  for (const [name, text] of Object.entries(fakes)) {
    const path = join(output, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    sources.push(path);
  }
  sources.push('scripts/android-offline-voice-probe/BackgroundWakeService.java',
    'scripts/android-offline-voice-probe/PendingTimerRequest.java',
    'test/fixtures/WakeServiceProbe.java');
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  execFileSync(tool('javac'), ['-d', output, ...sources], { windowsHide: true, timeout: 30_000, stdio: 'pipe' });
  const result = execFileSync(tool('java'), ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.WakeServiceProbe'], { windowsHide: true, timeout: 30_000, encoding: 'utf8' });
  assert.match(result, /Wake service lifecycle checks passed/);
});
