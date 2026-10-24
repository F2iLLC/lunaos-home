package io.github.f2illc.lunaos.home.vehicle;

import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

public final class VehicleVoiceCacheTest {
    private static final String VOICE = "abcdefghijklmnopqrst";
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    private static void tag(ByteBuffer data, String text) { data.put(text.getBytes(StandardCharsets.US_ASCII)); }
    private static byte[] wave() {
        ByteBuffer b = ByteBuffer.allocate(48).order(ByteOrder.LITTLE_ENDIAN);
        tag(b, "RIFF"); b.putInt(40); tag(b, "WAVE"); tag(b, "fmt "); b.putInt(16);
        b.putShort((short) 1); b.putShort((short) 1); b.putInt(24000); b.putInt(48000); b.putShort((short) 2); b.putShort((short) 16);
        tag(b, "data"); b.putInt(4); b.putShort((short) 2345); b.putShort((short) -2345); return b.array();
    }
    private static void put(Path root, String text, byte[] bytes) throws Exception {
        String key = VehicleVoiceCache.key(VOICE, text);
        Files.write(root.resolve(key + ".wav"), bytes);
        Files.write(root.resolve(key + ".sha256"), VehicleVoiceCache.digest(bytes).getBytes(StandardCharsets.US_ASCII));
    }
    private static void denied(Path root, String voice, String text) throws Exception {
        try { VehicleVoiceCache.prepared(root.toFile(), voice, text); throw new AssertionError("Invalid cache accepted"); }
        catch (IOException | IllegalArgumentException expected) { }
    }
    public static void main(String[] args) throws Exception {
        Path root = Paths.get(args[0]); String text = VehicleGreetings.all("Example").iterator().next();
        check(VehicleVoiceCache.key(VOICE, text).equals(args[1]));
        check(VehicleVoiceCache.validVoice("") && !VehicleVoiceCache.validVoice("../unsafe"));
        check(!VehicleVoiceCache.validPack("../unsafe") && !VehicleVoiceCache.validPack(""));
        try { VehicleVoiceCache.directory(root.toFile(), "../../unsafe"); throw new AssertionError(); }
        catch (IOException expected) { }
        byte[] source = wave(); put(root, text, source);
        byte[] output = VehicleVoiceCache.prepared(root.toFile(), VOICE, text);
        check(output.length == source.length + 192000);
        check(ByteBuffer.wrap(output).order(ByteOrder.LITTLE_ENDIAN).getShort(192044) == 2345);
        for (int n = 44; n < 192044; n++) check(output[n] == 0);
        denied(root, "zyxwvutsrqponmlkjihg", text); denied(root, VOICE, text.replace("Example", "Other"));
        denied(root, VOICE, text + " Changed."); denied(root, "../../unsafe", text);
        String key = VehicleVoiceCache.key(VOICE, text);
        Files.write(root.resolve(key + ".wav"), new byte[48]); denied(root, VOICE, text);
        put(root, text, new byte[48]); denied(root, VOICE, text); // Matching hash cannot legitimize malformed PCM.
        put(root, text, source); Files.delete(root.resolve(key + ".sha256")); denied(root, VOICE, text);
        put(root, text, new byte[2 * 1024 * 1024 + 1]); denied(root, VOICE, text);
        for (String line : VehicleGreetings.all("Example")) put(root, line, source);
        check(VehicleVoiceCache.verify(root.toFile(), VOICE, "Example") == 28);
        Files.delete(root.resolve(key + ".wav"));
        try { VehicleVoiceCache.verify(root.toFile(), VOICE, "Example"); throw new AssertionError("Partial cache accepted"); }
        catch (IOException expected) { }
        System.out.println("VehicleVoiceCache: identity, complete repertoire, integrity, bounded PCM, silent lead-in and missing cache checks passed");
    }
}
