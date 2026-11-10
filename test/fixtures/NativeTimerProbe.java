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
  System.out.println("Native timer checks passed ("+checks+" cases).");
 }
}
