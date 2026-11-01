package io.github.f2illc.lunaos.home.timerprobe;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.util.Log;
import android.widget.TextView;

/** Attended, one-shot platform feasibility probe, not a Home timer service. */
public final class TimerProbe extends Activity {
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView status = new TextView(this);
        status.setText("Testing a 15-second timer in Clock.");
        setContentView(status);
    }

    @Override public void onResume() {
        super.onResume();
        SharedPreferences state = getSharedPreferences("probe", MODE_PRIVATE);
        // Claim before dispatch; an uncertain launch or activity recreation must
        // never automatically create another timer. Reinstall for a fresh test.
        if (state.getBoolean("attempted", false)) {
            Log.i("HomeTimerProbe", "ALREADY_ATTEMPTED_NO_RETRY");
            finish();
            return;
        }
        if (!state.edit().putBoolean("attempted", true).commit()) {
            Log.i("HomeTimerProbe", "LOCAL_CLAIM_FAILED_NO_DISPATCH");
            finish();
            return;
        }
        Intent timer = new Intent(AlarmClock.ACTION_SET_TIMER)
            .setPackage("com.android.deskclock")
            .putExtra(AlarmClock.EXTRA_LENGTH, 15)
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Home timer test")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        try {
            if (timer.resolveActivity(getPackageManager()) == null) {
                Log.i("HomeTimerProbe", "CLOCK_UNAVAILABLE_NO_DISPATCH");
            } else {
                startActivity(timer);
                // Intent dispatch supplies no timer ID or persistence receipt.
                Log.i("HomeTimerProbe", "INTENT_DISPATCHED_ALERT_UNVERIFIED");
            }
        } catch (RuntimeException failure) {
            Log.i("HomeTimerProbe", "DISPATCH_FAILED_NO_RETRY");
        }
        finish();
    }
}
