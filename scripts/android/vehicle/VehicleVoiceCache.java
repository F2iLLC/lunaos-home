package io.github.f2illc.lunaos.home.vehicle;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Owner-provisioned speech only. No credentials or network calls on the phone. */
public final class VehicleVoiceCache {
    public static boolean validVoice(String voice) {
        return voice != null && (voice.isEmpty() || voice.matches("[A-Za-z0-9]{20,64}"));
    }
    public static boolean validPack(String pack) { return pack != null && pack.matches("[0-9a-f]{64}"); }
    public static File directory(File noBackup, String pack) throws IOException {
        if (!validPack(pack)) throw new IOException("No voice pack installed");
        return new File(new File(noBackup, "vehicle-voices"), pack);
    }
    public static String digest(byte[] bytes) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static String key(String voice, String text) {
        if (!validVoice(voice) || voice.isEmpty() || text == null || text.isEmpty() || text.length() > 512) throw new IllegalArgumentException();
        return digest(("elevenlabs\n" + voice + "\n" + text).getBytes(StandardCharsets.UTF_8));
    }
    private static byte[] read(File file, int limit) throws IOException {
        try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) >= 0) {
                if (out.size() + n > limit) throw new IOException("Voice clip exceeds limit");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }
    public static byte[] prepared(File root, String voice, String text) throws IOException {
        String key = key(voice, text);
        byte[] wave = read(new File(root, key + ".wav"), 2 * 1024 * 1024);
        String expected = new String(read(new File(root, key + ".sha256"), 64), StandardCharsets.US_ASCII);
        if (!expected.matches("[0-9a-f]{64}") || !digest(wave).equals(expected)) throw new IOException("Voice clip integrity failed");
        return VehicleLeadIn.prepend(wave, VehicleLeadIn.MILLISECONDS);
    }
    public static int verify(File root, String voice, String nickname) throws IOException {
        int count = 0;
        for (String text : VehicleGreetings.all(nickname)) { prepared(root, voice, text); count++; }
        return count;
    }
}
