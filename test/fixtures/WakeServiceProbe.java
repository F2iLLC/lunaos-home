package io.github.f2illc.lunaos.home.voiceprobe;
import android.content.Intent;
import android.os.Handler;
import android.os.SystemClock;
public final class WakeServiceProbe {
 static int checks;
 static void check(boolean b) {if(!b)throw new AssertionError("Wake case "+(checks+1));checks++;}
 static BackgroundWakeService enable() {
  ProbeCapture.blocked=false;ProbeCapture.busy=false;
  BackgroundWakeService s=new BackgroundWakeService();
  check(s.onStartCommand(new Intent(s,BackgroundWakeService.class).setAction(BackgroundWakeService.START),0,1)==s.START_NOT_STICKY);
  Handler.advance(0);check(BackgroundWakeService.running&&s.foreground&&ProbeCapture.busy());return s;
 }
 static void disable(BackgroundWakeService s) {s.onStartCommand(new Intent(s,BackgroundWakeService.class).setAction(BackgroundWakeService.STOP),0,2);s.onDestroy();ProbeCapture.busy=false;}
 public static void main(String[] args) {
  BackgroundWakeService s=enable();ProbeCapture first=ProbeCapture.last;int starts=ProbeCapture.starts;
  Handler.advance(360000);check(ProbeCapture.last==first&&s.power.last.isHeld());
  first.finish("COMMAND_WINDOW_EXPIRED",0,true);Handler.advance(750);check(ProbeCapture.starts==starts+1);
  first.listener.finished("COMMAND_MATCH","late",60,SystemClock.now+10000,false);check(NativeTimers.read(s).free()==1);
  ProbeCapture.last.finish("COMMAND_MATCH",60,false);
  check(NativeTimers.read(s).deadlines[1]==SystemClock.now+60000);check(!ProbeCapture.busy()&&BackgroundWakeService.running);
  Handler.advance(1000);check(!ProbeCapture.busy()); // Replies pause capture, not the timer.
  SpokenReply.last.finish();Handler.advance(250);check(ProbeCapture.busy());
  ProbeCapture.last.finish("COMMAND_MATCH",120,false);check(NativeTimers.read(s).select(0)==-1);
  SpokenReply.last.finish();Handler.advance(250);check(ProbeCapture.busy());
  ProbeCapture.last.finish("COMMAND_MATCH",TimerCommand.add(1,60),false);check(NativeTimers.read(s).deadlines[1]>SystemClock.now+60000);
  SpokenReply.last.finish();Handler.advance(250);
  ProbeCapture.last.finish("COMMAND_MATCH",TimerCommand.cancel(1),false);check(NativeTimers.read(s).deadlines[1]==0&&NativeTimers.read(s).deadlines[2]>0);
  SpokenReply reply=SpokenReply.last;starts=ProbeCapture.starts;disable(s);reply.finish();Handler.advance(2000);
  check(!BackgroundWakeService.running&&ProbeCapture.starts==starts);check(NativeTimers.read(s).deadlines[2]>0);
  s=enable();first=ProbeCapture.last;BackgroundWakeService.revoke(s);first.finish("COMMAND_MATCH",5,false);check(NativeTimers.read(s).free()==1);s.onDestroy();
  s=enable();first=ProbeCapture.last;ProbeCapture.blocked=true;Handler.advance(100);check(!BackgroundWakeService.running&&first.stopped);
  ProbeCapture.blocked=false;first.finish("COMMAND_MATCH",5,false);Handler.advance(1000);check(NativeTimers.read(s).free()==1&&!BackgroundWakeService.running);s.onDestroy();
  s=enable();starts=ProbeCapture.starts;ProbeCapture.last.finish("MODEL_LOAD_FAILED",0,false);Handler.advance(1000);check(!BackgroundWakeService.running&&ProbeCapture.starts==starts);s.onDestroy();
  s=new BackgroundWakeService();s.onStartCommand(null,0,1);check(!BackgroundWakeService.running);s.onDestroy();
  check(QuestionPolicy.accepts("why is the sky blue"));
  check(QuestionPolicy.accepts("tell me a story about a dragon"));
  for(String text:new String[]{"", "set a timer", "cancel timer nine", "add one minute", "[unk]", "hi\nthere"}) check(!QuestionPolicy.accepts(text));
  check(!QuestionPolicy.accepts(new String(new char[1001]).replace('\0','a')));
  s=enable();first=ProbeCapture.last;starts=ProbeCapture.starts;
  first.busy=false;first.listener.finished("QUESTION_FINAL","why is the sky blue",0,SystemClock.now+10000,false);
  check(QuestionReply.last!=null&&NativeTimers.read(s).free()==1);
  Handler.advance(1000);check(ProbeCapture.starts==starts&&s.power.last.isHeld());
  QuestionReply.last.finish();Handler.advance(250);check(ProbeCapture.starts==starts+1);
  first=ProbeCapture.last;first.busy=false;first.listener.finished("QUESTION_FINAL","tell me a story",0,SystemClock.now+10000,false);
  QuestionReply.last.fail();check(BackgroundWakeService.latest.startsWith("Reply unavailable"));Handler.advance(2500);check(ProbeCapture.busy());
  first=ProbeCapture.last;first.busy=false;first.listener.finished("QUESTION_FINAL","tell me a story",0,SystemClock.now+10000,false);
  QuestionReply question=QuestionReply.last;starts=ProbeCapture.starts;disable(s);check(question.closed);
  question.finish();Handler.advance(1000);check(!BackgroundWakeService.running&&ProbeCapture.starts==starts);
  s=enable();first=ProbeCapture.last;first.busy=false;first.listener.finished("QUESTION_FINAL","why is the sky blue",0,SystemClock.now+10000,false);
  question=QuestionReply.last;ProbeCapture.blocked=true;Handler.advance(100);check(question.closed&&!BackgroundWakeService.running);
  ProbeCapture.blocked=false;starts=ProbeCapture.starts;question.finish();Handler.advance(1000);check(ProbeCapture.starts==starts);s.onDestroy();
  s=enable();first=ProbeCapture.last;QuestionReply.enabled=false;first.busy=false;
  first.listener.finished("QUESTION_FINAL","why is the sky blue",0,SystemClock.now+10000,false);check(!BackgroundWakeService.running);s.onDestroy();QuestionReply.enabled=true;
  System.out.println("Wake service lifecycle checks passed ("+checks+" cases).");
 }
}
