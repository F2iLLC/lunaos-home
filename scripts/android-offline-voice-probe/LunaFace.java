package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;

/** Local, speech-free visual feedback. Never starts capture or changes display/lock settings. */
final class LunaFace extends View {
    enum State { OFF, PREPARING, WAITING, AWAKE, REVIEW, RESPONSE, RETRY }
    private State state = State.OFF;
    private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean active;
    private static final int NIGHT = Color.rgb(17, 20, 38);
    private static final int CREAM = Color.rgb(255, 241, 224);
    private static final int LAVENDER = Color.rgb(183, 169, 242);
    private static final int MINT = Color.rgb(140, 239, 217);

    LunaFace(Context context) {
        super(context);
        setBackgroundColor(NIGHT);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setState(State.OFF);
    }
    void setActive(boolean value) { active = value; updateKeepOn(); invalidate(); }
    void setState(State value) {
        if (state != value) { state = value; invalidate(); }
        setContentDescription("Luna. " + heading() + ". " + detail());
        updateKeepOn();
    }
    private void updateKeepOn() {
        setKeepScreenOn(active && (state == State.PREPARING || state == State.WAITING
            || state == State.AWAKE || (state == State.REVIEW || state == State.RESPONSE)));
    }
    private String heading() {
        switch (state) {
            case PREPARING: return "ONE MOMENT";
            case WAITING: return "SAY HEY LUNA";
            case AWAKE: return "I'M LISTENING";
            case RESPONSE: return "ONE MOMENT";
            case REVIEW: return "REVIEW TIMER";
            case RETRY: return "TRY AGAIN";
            default: return "MIC OFF";
        }
    }
    private String detail() {
        switch (state) {
            case PREPARING: return "MIC OFF WHILE LOADING";
            case WAITING: return "MIC ON · WAITING FOR YOU";
            case AWAKE: return "MIC ON · SAY YOUR TIMER";
            case RESPONSE: return "MIC PAUSED · RESPONDING";
            case REVIEW: return "MIC OFF · NO TIMER STARTED";
            case RETRY: return "MIC OFF · NO TIMER STARTED";
            default: return "NOT LISTENING";
        }
    }
    private void fill(Canvas c, int color, float l, float t, float r, float b, float radius) {
        ink.setColor(color); ink.setStyle(Paint.Style.FILL);
        c.drawRoundRect(l, t, r, b, radius, radius, ink);
    }
    private void line(Canvas c, float x1, float y1, float x2, float y2) {
        ink.setColor(NIGHT); ink.setStyle(Paint.Style.STROKE);
        ink.setStrokeWidth(8); ink.setStrokeCap(Paint.Cap.ROUND);
        c.drawLine(x1, y1, x2, y2, ink);
        ink.setStyle(Paint.Style.FILL);
    }
    private void eye(Canvas c, float x, boolean blink, boolean peek) {
        if (peek) {
            fill(c, NIGHT, x - 18, 171, x + 18, 184, 7);
            fill(c, Color.WHITE, x - 8, 173, x - 1, 178, 3);
        } else if (state == State.OFF || state == State.WAITING || state == State.PREPARING || blink) {
            ink.setColor(NIGHT); ink.setStyle(Paint.Style.STROKE);
            ink.setStrokeWidth(8); ink.setStrokeCap(Paint.Cap.ROUND);
            c.drawArc(x - 23, 159, x + 23, 185, 8, 164, false, ink);
            ink.setStyle(Paint.Style.FILL);
        } else if (state == State.RETRY) {
            line(c, x - 20, 173, x, 181); line(c, x, 181, x + 20, 173);
        } else if ((state == State.REVIEW || state == State.RESPONSE)) {
            ink.setColor(NIGHT); ink.setStyle(Paint.Style.STROKE); ink.setStrokeWidth(8);
            ink.setStrokeCap(Paint.Cap.ROUND);
            c.drawArc(x - 22, 169, x + 22, 203, 192, 156, false, ink);
            ink.setStyle(Paint.Style.FILL);
        } else {
            fill(c, NIGHT, x - 22, 146, x + 22, 206, 21);
            fill(c, Color.WHITE, x - 12, 153, x + 1, 170, 6);
            fill(c, MINT, x + 5, 185, x + 13, 195, 4);
        }
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float scale = Math.min(getWidth() / 400f, getHeight() / 410f);
        canvas.save();
        canvas.translate((getWidth() - 400 * scale) / 2, (getHeight() - 410 * scale) / 2);
        canvas.scale(scale, scale);
        double time = SystemClock.uptimeMillis() / 1000.0;
        boolean awake = state == State.AWAKE;
        boolean sleepy = state == State.OFF || state == State.WAITING;
        float doze = active && sleepy ? (float) Math.sin(time * 1.7) : 0;
        int accent = awake ? MINT : LAVENDER;
        // Slow halo breath, never a flashing full-screen color change.
        float breathe = active && awake ? (float) Math.sin(time * 2.4) * 5 : 0;
        ink.setColor(accent); ink.setAlpha(awake ? 65 : 23);
        canvas.drawCircle(200, 166, 139 + breathe, ink); ink.setAlpha(255);
        canvas.save();
        // A tiny sleeping bob; status text stays still and truthful about the mic.
        if (sleepy) {
            canvas.translate(0, doze * 2);
            canvas.rotate(doze * 0.7f, 200, 175);
        }
        // Round buns and a generous rounded chibi face.
        ink.setColor(LAVENDER);
        canvas.drawCircle(84, 111, 32, ink);
        canvas.drawCircle(316, 111, 32, ink);
        fill(canvas, CREAM, 69, 100, 331, 264, 78);
        // Soft side-swept fringe, with a curved silhouette rather than a flat bar.
        Path hair = new Path(); hair.moveTo(73, 169);
        hair.cubicTo(55, 82, 119, 55, 195, 72);
        hair.cubicTo(273, 49, 347, 96, 329, 171);
        hair.quadTo(315, 155, 310, 132);
        hair.cubicTo(267, 142, 230, 123, 216, 107);
        hair.cubicTo(202, 142, 146, 153, 111, 136);
        hair.quadTo(94, 149, 73, 169); hair.close();
        ink.setColor(LAVENDER); canvas.drawPath(hair, ink);
        boolean blink = active && (state == State.AWAKE || state == State.PREPARING)
            && SystemClock.uptimeMillis() % 5100 < 130;
        // Briefly peek, blink, then drift shut again every seven seconds.
        long idlePhase = SystemClock.uptimeMillis() % 7300;
        boolean peek = active && sleepy && ((idlePhase > 6300 && idlePhase < 6590)
            || (idlePhase > 6700 && idlePhase < 6940));
        eye(canvas, 145, blink, peek); eye(canvas, 255, blink, peek);
        fill(canvas, Color.rgb(242, 168, 174), 96, 206, 131, 220, 7);
        fill(canvas, Color.rgb(242, 168, 174), 269, 206, 304, 220, 7);
        if (awake) fill(canvas, NIGHT, 190, 211, 210, 235, 10);
        else if (sleepy) {
            float puff = 2 + (doze + 1) * 2;
            fill(canvas, NIGHT, 194 - puff, 218 - puff, 206 + puff, 230 + puff, 10);
        } else {
            ink.setColor(NIGHT); ink.setStyle(Paint.Style.STROKE);
            ink.setStrokeWidth(6); ink.setStrokeCap(Paint.Cap.ROUND);
            canvas.drawArc(184, 206, 216, 231, 15, 150, false, ink);
            ink.setStyle(Paint.Style.FILL);
        }
        // Crescent hair clip.
        ink.setColor(Color.rgb(255, 218, 134)); canvas.drawCircle(304, 113, 17, ink);
        ink.setColor(CREAM); canvas.drawCircle(311, 107, 15, ink);
        if (sleepy && active) {
            float drift = (float) ((time % 3.7) / 3.7);
            ink.setColor(LAVENDER);
            ink.setAlpha((int) (145 * Math.sin(drift * Math.PI)));
            ink.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            ink.setTextAlign(Paint.Align.CENTER);
            ink.setTextSize(17 + drift * 9);
            canvas.drawText("z", 343 + drift * 12, 154 - drift * 43, ink);
            ink.setAlpha(255);
        }
        canvas.restore();
        ink.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        ink.setTextAlign(Paint.Align.CENTER); ink.setTextSize(29); ink.setColor(awake ? MINT : CREAM);
        canvas.drawText(heading(), 200, 326, ink);
        ink.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        ink.setTextSize(13); ink.setColor(LAVENDER); canvas.drawText(detail(), 200, 355, ink);
        canvas.restore();
        if (active && getWindowVisibility() == VISIBLE && (awake || sleepy || state == State.PREPARING))
            postInvalidateDelayed(sleepy ? 100 : 65);
    }
}
