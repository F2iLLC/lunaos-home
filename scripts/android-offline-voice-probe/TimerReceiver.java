package io.github.f2illc.lunaos.home.voiceprobe;
import android.content.*;
import android.util.Log;
public final class TimerReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try { NativeTimers.deliver(context, intent); }
        catch (RuntimeException failure) { Log.i("HomeVoiceProbe", "NATIVE_TIMER_DELIVERY_FAILED"); }
    }
}
