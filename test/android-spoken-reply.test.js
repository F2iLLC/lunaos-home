import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

test('bundled offline replies sequence exact clips, release playback, and recover from errors or timeout', async t => {
  const output = await mkdtemp(join(tmpdir(), 'home-offline-reply-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile('scripts/android-offline-voice-probe/reply-prompts.json','utf8'));
  const fakes = {
    'android/content/Context.java': 'package android.content; public class Context {public android.content.res.AssetManager getAssets(){return new android.content.res.AssetManager();}}',
    'android/os/Handler.java': `package android.os; public class Handler {
      static final java.util.List<Runnable> tasks=new java.util.ArrayList<>(),timers=new java.util.ArrayList<>();
      public void post(Runnable r){tasks.add(r);}public void postDelayed(Runnable r,long ms){timers.add(r);}
      public void removeCallbacksAndMessages(Object o){tasks.clear();timers.clear();}
      public static void drain(){while(!tasks.isEmpty())tasks.remove(0).run();}
      public static void timeout(){if(!timers.isEmpty())timers.remove(0).run();}
    }`,
    'android/content/res/AssetFileDescriptor.java': 'package android.content.res; public class AssetFileDescriptor implements AutoCloseable {public java.io.FileDescriptor getFileDescriptor(){return new java.io.FileDescriptor();}public long getStartOffset(){return 0;}public long getLength(){return 100;}public void close(){}}',
    'android/content/res/AssetManager.java': 'package android.content.res; public class AssetManager {public static final java.util.List<String> opened=new java.util.ArrayList<>(); public AssetFileDescriptor openFd(String p){opened.add(p);return new AssetFileDescriptor();}}',
    'android/media/AudioAttributes.java': 'package android.media; public class AudioAttributes {public static final int USAGE_ASSISTANCE_ACCESSIBILITY=11,CONTENT_TYPE_SPEECH=1;public static class Builder {public Builder setUsage(int i){return this;}public Builder setContentType(int i){return this;}public AudioAttributes build(){return new AudioAttributes();}}}',
    'android/media/MediaPlayer.java': `package android.media; public class MediaPlayer {
      public interface OnCompletionListener{void onCompletion(MediaPlayer p);}public interface OnErrorListener{boolean onError(MediaPlayer p,int w,int e);}
      public static MediaPlayer last;public static boolean fail;public boolean released;public OnCompletionListener listener;public OnErrorListener error;
      public MediaPlayer(){last=this;}public void setAudioAttributes(AudioAttributes a){}public void setDataSource(java.io.FileDescriptor f,long s,long l){}
      public void setOnCompletionListener(OnCompletionListener l){listener=l;}public void setOnErrorListener(OnErrorListener l){error=l;}
      public void prepare(){if(fail)throw new IllegalStateException();}public void start(){}public void release(){released=true;}
    }`,
    'io/github/f2illc/lunaos/home/voiceprobe/BackgroundWakeService.java': 'package io.github.f2illc.lunaos.home.voiceprobe; class BackgroundWakeService {static boolean replyPlaying;}',
    'io/github/f2illc/lunaos/home/voiceprobe/ReplyProbe.java': `package io.github.f2illc.lunaos.home.voiceprobe;
      import android.media.MediaPlayer;import android.os.Handler;import android.content.res.AssetManager;
      public class ReplyProbe {
        static java.util.List<String> manifest=java.util.Arrays.asList(${manifest.map(c => JSON.stringify(c.id)).join(",")});
        static int completed;static void check(boolean b){if(!b)throw new AssertionError();}
        static SpokenReply create(){return new SpokenReply(new android.content.Context(),"Timer one started for 60 seconds.",()->completed++);}
        public static void main(String[] args){
          SpokenReply reply=create();Handler.drain();
          for(int i=0;i<2;i++){MediaPlayer p=MediaPlayer.last;p.listener.onCompletion(p);check(p.released);}
          Handler.drain();check(completed==1);check(AssetManager.opened.equals(java.util.Arrays.asList("replies/setting-timer.wav","replies/minute-1.wav")));
          reply=create();reply.close();Handler.drain();check(completed==1);
          reply=create();Handler.drain();MediaPlayer p=MediaPlayer.last;Handler.timeout();check(p.released&&completed==2);
          p.listener.onCompletion(p);Handler.drain();check(completed==2);
          reply=create();Handler.drain();p=MediaPlayer.last;p.error.onError(p,1,1);Handler.drain();check(p.released&&completed==3);
          MediaPlayer.fail=true;reply=create();Handler.drain();check(MediaPlayer.last.released&&completed==4);MediaPlayer.fail=false;
          for(int id=1;id<=8;id++)for(int n=1;n<=60;n++)for(int scale:new int[]{1,60}){
            String[] clips=ReplyPlan.clips("Timer "+TimerPhrase.number(id)+" extended by "+n*scale+" seconds.");check(clips.length==2&&clips[0].equals("timer-"+id)&&manifest.contains(clips[1]));
          }
          // A new timer is announced as "Setting a timer for" plus its parts,
          // and names its number only when it is not timer one.
          for(int id=1;id<=8;id++)for(int seconds:new int[]{1,59,60,61,90,3599,3600,3660,5400,7325,86399,86400}){
            String[] clips=ReplyPlan.clips("Timer "+TimerPhrase.number(id)+" started for "+seconds+" seconds.");
            check(clips[0].equals("setting-timer"));
            int total=0;
            for(int i=1;i<clips.length;i++){
              check(manifest.contains(clips[i]));
              String[] part=clips[i].split("-");
              if(part[0].equals("hour"))total+=Integer.parseInt(part[1])*3600;
              else if(part[0].equals("minute"))total+=Integer.parseInt(part[1])*60;
              else if(part[0].equals("second"))total+=Integer.parseInt(part[1]);
              else check(part[0].equals("timer")&&i==clips.length-1&&id>1&&Integer.parseInt(part[1])==id);
            }
            check(total==seconds&&(id==1)==(!clips[clips.length-1].startsWith("timer-")));
          }
          check(java.util.Arrays.equals(ReplyPlan.clips("Timer one started for 5400 seconds."),new String[]{"setting-timer","hour-1","minute-30"}));
          check(java.util.Arrays.equals(ReplyPlan.clips("Timer two started for 150 seconds."),new String[]{"setting-timer","minute-2","second-30","timer-2"}));
          check(java.util.Arrays.equals(ReplyPlan.clips("Timer two paused."),new String[]{"timer-2","paused"})&&java.util.Arrays.equals(ReplyPlan.clips("Timer one resumed."),new String[]{"timer-1","resumed"})&&manifest.contains("paused")&&manifest.contains("resumed"));
          for(String bad:new String[]{"Timer one started for 0 seconds.","Timer one started for 86401 seconds.","Timer one started for -5 seconds.","Timer one started for 5 seconds. Extra","Timer nine started for 5 seconds."})
            check(ReplyPlan.clips(bad)[0].equals("unsupported"));
          check(ReplyPlan.clips("Timer eight canceled.")[0].equals("cancel-8"));
          check(ReplyPlan.clips("Alarm stopped.").length==0);
          check(ReplyPlan.clips("untrusted speech")[0].equals("unsupported"));
          System.out.println("Offline reply checks passed");
        }
      }`,
  };
  const sources = ['QuestionPolicy', 'SpokenReply', 'PromptPlayer', 'ReplyPlan', 'TimerPhrase', 'TimerCommand'].map(name => 'scripts/android-offline-voice-probe/' + name + '.java');
  for (const [name, text] of Object.entries(fakes)) {
    const path = join(output, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    sources.push(path);
  }
  const tool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  execFileSync(tool('javac'), ['-d', output, ...sources], { windowsHide: true, timeout: 30_000, stdio: 'pipe' });
  const result = execFileSync(tool('java'), ['-cp', output, 'io.github.f2illc.lunaos.home.voiceprobe.ReplyProbe'], { windowsHide: true, timeout: 30_000, encoding: 'utf8' });
  assert.match(result, /Offline reply checks passed/);
});
