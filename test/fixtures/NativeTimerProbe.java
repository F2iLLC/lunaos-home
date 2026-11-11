package io.github.f2illc.lunaos.home.voiceprobe;
import android.content.*;
import android.os.SystemClock;
public final class NativeTimerProbe {
 static int checks;
 static void check(boolean b) {if(!b)throw new AssertionError("Timer case "+(checks+1));checks++;}
 public static void main(String[] args) {
  Context c=new Context();SystemClock.now=1000;
  for(int n=1;n<=60;n++) {
   check(TimerCommand.parse("set another timer for "+TimerPhrase.number(n)+(n==1?" second":" seconds"))==n);
   for(int id=0;id<=8;id++) {
    String timer=id==0?"the timer":"timer "+TimerPhrase.number(id);
    check(TimerCommand.parse("cancel "+timer)==(id==0?TimerCommand.STOP:TimerCommand.cancel(id)));
    int command=TimerCommand.parse("add "+TimerPhrase.number(n)+(n==1?" minute to ":" minutes to ")+timer);
    check(TimerCommand.valid(command)&&TimerCommand.duration(command)==n*60&&TimerCommand.target(command)==id);
   }
  }
  check(TimerCommand.parse("cancel the timer please")==TimerCommand.STOP);
  for(String text:new String[]{"cancel all timers","add a minute","add one minutes to the timer","cancel timer nine","cancel the timer please tomorrow","set another timer for [unk] seconds"}) check(TimerCommand.parse(text)==0);
  WakeSession wake=new WakeSession(0,true);check(wake.acceptFinal("cancel the timer",1)==0);check(wake.acceptFinal("hey luna",2)==WakeSession.WAKE);check(wake.acceptFinal("cancel the timer",3)==TimerCommand.STOP);check(wake.acceptFinal("cancel the timer",4)==0);
  check(NativeTimers.execute(c,60).contains("started"));Intent old=c.alarms.last.intent;
  check(NativeTimers.execute(c,120).contains("started"));check(NativeTimers.execute(c,TimerCommand.cancel(0)).contains("More than one"));
  check(NativeTimers.read(c).deadlines[1]==61000&&NativeTimers.read(c).deadlines[2]==121000);
  check(NativeTimers.execute(c,TimerCommand.add(1,60)).contains("extended"));check(NativeTimers.read(c).deadlines[1]==121000);
  SystemClock.now=61000;NativeTimers.deliver(c,old);check(c.alarmStarts==0);
  Intent current=c.alarms.last.intent;SystemClock.now=121000;NativeTimers.deliver(c,current);check(c.alarmStarts==1);
  NativeTimers.execute(c,TimerCommand.cancel(1));NativeTimers.deliver(c,current);check(c.alarmStarts==1&&NativeTimers.read(c).deadlines[2]>0);
  NativeTimers.execute(c,5);NativeTimers.deliver(c,current);check(c.alarmStarts==1); // Reused slot rejects stale alarm.
  long deadline=NativeTimers.read(c).deadlines[1];c.alarms.fail=true;
  try {NativeTimers.execute(c,TimerCommand.add(1,60));throw new AssertionError("Expected failure");}catch(SecurityException expected) {}
  check(NativeTimers.read(c).deadlines[1]==deadline); // Failed extension keeps old alarm.
  c.prefs.fail=true;try {NativeTimers.execute(c,TimerCommand.cancel(1));throw new AssertionError("Expected storage failure");}catch(IllegalStateException expected) {}c.prefs.fail=false;
  check(NativeTimers.read(c).deadlines[1]==deadline);
  check(TimerLedger.decode(c.prefs.value,1).deadlines[1]==deadline);
  android.provider.Settings.Global.boot=2;check(NativeTimers.read(c).free()==1);
  check(TimerLedger.decode("malformed",2).free()==1);
  android.provider.Settings.Global.boot=1;
  TimerAlarmService alarm=new TimerAlarmService();SystemClock.now=1000;
  NativeTimers.execute(alarm,5);NativeTimers.execute(alarm,5);SystemClock.now=6000;
  alarm.onStartCommand(new Intent(alarm,TimerAlarmService.class),0,1);
  check(alarm.foreground&&android.media.MediaPlayer.starts==1);
  alarm.onStartCommand(new Intent(alarm,TimerAlarmService.class),0,2);check(android.media.MediaPlayer.starts==1);
  TimerAlarmService.duck(true);check(android.media.MediaPlayer.volume<1);TimerAlarmService.duck(false);check(android.media.MediaPlayer.volume==1);
  NativeTimers.execute(alarm,TimerCommand.cancel(1));check(alarm.foreground&&android.media.MediaPlayer.releases==0);
  NativeTimers.execute(alarm,TimerCommand.cancel(2));check(!alarm.foreground&&android.media.MediaPlayer.releases==1);alarm.onDestroy();
  NativeTimers.execute(alarm,5);SystemClock.now+=5000;android.media.MediaPlayer.fail=true;
  alarm.onStartCommand(new Intent(alarm,TimerAlarmService.class),0,3);check(alarm.foreground);
  int released=android.media.MediaPlayer.releases;android.os.Handler.advance(500);check(android.media.MediaPlayer.releases==released); // No failed-playback retry loop.
  NativeTimers.execute(alarm,TimerCommand.cancel(1));alarm.onDestroy();
  // Stop: silences every ringing timer, leaves counting ones, and is silent itself.
  android.media.MediaPlayer.fail=false;TimerAlarmService ringing=new TimerAlarmService();SystemClock.now=1000;
  check(!TimerAlarmService.ringing());
  check(NativeTimers.execute(ringing,TimerCommand.STOP).equals("That timer is not active."));
  NativeTimers.execute(ringing,5);NativeTimers.execute(ringing,5);NativeTimers.execute(ringing,600);
  check(NativeTimers.execute(ringing,TimerCommand.STOP).contains("More than one")); // Nothing rings yet: ambiguous, nothing changed.
  check(NativeTimers.read(ringing).deadlines[1]>0&&NativeTimers.read(ringing).deadlines[3]>0);
  SystemClock.now=6000;ringing.onStartCommand(new Intent(ringing,TimerAlarmService.class),0,4);check(ringing.foreground&&TimerAlarmService.ringing());
  int before=android.media.MediaPlayer.releases;
  check(NativeTimers.execute(ringing,TimerCommand.STOP).equals("Alarm stopped."));
  TimerLedger left=NativeTimers.read(ringing);check(left.deadlines[1]==0&&left.deadlines[2]==0&&left.deadlines[3]==601000);
  check(!ringing.foreground&&!TimerAlarmService.ringing()&&android.media.MediaPlayer.releases==before+1);
  check(NativeTimers.execute(ringing,TimerCommand.STOP).equals("Timer three canceled.")); // One counting timer left: stop means it.
  ringing.onDestroy();
  // Pause and resume: by voice wording, by number, and never an alarm.
  check(TimerCommand.parse("pause")==TimerCommand.pause(0)&&TimerCommand.parse("pause the timer")==TimerCommand.pause(0)&&TimerCommand.parse("hold it")==TimerCommand.pause(0));
  check(TimerCommand.parse("resume")==TimerCommand.resume(0)&&TimerCommand.parse("continue the timer")==TimerCommand.resume(0)&&TimerCommand.parse("resume my timer")==TimerCommand.resume(0));
  for(int id=1;id<=8;id++) {
   check(TimerCommand.parse("pause timer "+TimerPhrase.number(id))==TimerCommand.pause(id)&&TimerCommand.target(TimerCommand.pause(id))==id&&TimerCommand.valid(TimerCommand.pause(id)));
   check(TimerCommand.parse("resume timer "+id)==TimerCommand.resume(id)&&TimerCommand.target(TimerCommand.resume(id))==id&&TimerCommand.valid(TimerCommand.resume(id)));
  }
  for(String text:new String[]{"pause the alarm","hold","continue","pause timer nine","pause the music","resume the alarm"}) check(TimerCommand.parse(text)==0);
  check(!TimerCommand.valid(-29)&&!TimerCommand.valid(-39)&&!TimerCommand.valid(-49));
  Context p=new Context();SystemClock.now=1000;
  check(NativeTimers.execute(p,TimerCommand.pause(0)).equals("That timer is not active."));
  NativeTimers.execute(p,60);int alarmsBefore=p.alarms.cancels;
  check(NativeTimers.execute(p,TimerCommand.resume(0)).equals("That timer is not active.")); // Nothing is paused yet.
  SystemClock.now=11000;check(NativeTimers.execute(p,TimerCommand.pause(0)).equals("Timer one paused."));
  TimerLedger held=NativeTimers.read(p);check(held.held(1)&&held.paused[1]==50000&&held.deadlines[1]==TimerLedger.HELD&&p.alarms.cancels==alarmsBefore+1);
  check(NativeTimers.execute(p,TimerCommand.pause(0)).equals("That timer is not active.")); // Already paused.
  Intent stale=p.alarms.last.intent;SystemClock.now=500000;NativeTimers.deliver(p,stale);check(p.alarmStarts==0); // A paused timer never fires.
  check(NativeTimers.execute(p,TimerCommand.add(1,60)).contains("extended")&&NativeTimers.read(p).paused[1]==110000);
  check(NativeTimers.execute(p,TimerCommand.resume(1)).equals("Timer one resumed."));
  TimerLedger again=NativeTimers.read(p);check(!again.held(1)&&again.deadlines[1]==610000);
  NativeTimers.execute(p,30);NativeTimers.execute(p,TimerCommand.pause(2));
  check(NativeTimers.execute(p,TimerCommand.pause(0)).equals("Timer one paused.")); // The only one still counting.
  check(NativeTimers.execute(p,TimerCommand.resume(0)).contains("More than one"));
  check(NativeTimers.execute(p,TimerCommand.cancel(2)).equals("Timer two canceled.")&&!NativeTimers.read(p).held(2)&&NativeTimers.read(p).free()==2);
  check(TimerLedger.decode(NativeTimers.read(p).encode(1),1).paused[1]==NativeTimers.read(p).paused[1]);
  check(TimerLedger.decode("1:3:5000,1,700:0,0:0,0:0,0:0,0:0,0:0,0:0,0",1).free()==1); // Paused time without a held deadline is rejected whole.
  NativeTimers.execute(p,TimerCommand.cancel(1));
  // A timer nobody answers stops itself after ringing for a minute.
  android.media.MediaPlayer.fail=false;TimerAlarmService alone=new TimerAlarmService();SystemClock.now=1000;
  NativeTimers.execute(alone,5);NativeTimers.execute(alone,600);SystemClock.now=6000;
  alone.onStartCommand(new Intent(alone,TimerAlarmService.class),0,5);check(alone.foreground&&TimerAlarmService.ringing());
  android.os.Handler.advance(TimerAlarmService.RING_MS-1000);check(TimerAlarmService.ringing()&&NativeTimers.read(alone).deadlines[1]>0);
  android.os.Handler.advance(1500);check(!TimerAlarmService.ringing()&&!alone.foreground);
  TimerLedger after=NativeTimers.read(alone);check(after.deadlines[1]==0&&after.deadlines[2]==601000); // Only the one that rang.
  NativeTimers.execute(alone,TimerCommand.cancel(2));alone.onDestroy();
  System.out.println("Native timer checks passed ("+checks+" cases).");
 }
}
