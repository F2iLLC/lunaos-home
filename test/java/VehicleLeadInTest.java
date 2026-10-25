package io.github.f2illc.lunaos.home.vehicle;

import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class VehicleLeadInTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    private static void tag(ByteBuffer bytes, String value) { bytes.put(value.getBytes(StandardCharsets.US_ASCII)); }
    public static void main(String[] args) throws Exception {
        ByteBuffer input = ByteBuffer.allocate(60).order(ByteOrder.LITTLE_ENDIAN);
        tag(input, "RIFF"); input.putInt(52); tag(input, "WAVE");
        tag(input, "JUNK"); input.putInt(4); input.putInt(123);
        tag(input, "fmt "); input.putInt(16); input.putShort((short) 1); input.putShort((short) 1);
        input.putInt(24000); input.putInt(48000); input.putShort((short) 2); input.putShort((short) 16);
        tag(input, "data"); input.putInt(4); input.putShort((short) 1234); input.putShort((short) -1234);
        byte[] original = input.array(), output = VehicleLeadIn.prepend(original, 4000);
        check(output.length == original.length + 192000);
        ByteBuffer result = ByteBuffer.wrap(output).order(ByteOrder.LITTLE_ENDIAN);
        check(result.getInt(4) == output.length - 8); check(result.getInt(52) == 192004);
        for (int n = 56; n < 192056; n++) check(output[n] == 0);
        check(result.getShort(192056) == 1234); check(result.getShort(192058) == -1234);
        check(result.getInt(20) == 123);
        check(Arrays.equals(original, VehicleLeadIn.prepend(original, 0)));
        for (int mode = 0; mode < 4; mode++) {
            byte[] bad = original.clone(); ByteBuffer data = ByteBuffer.wrap(bad).order(ByteOrder.LITTLE_ENDIAN);
            if (mode == 0) data.putInt(52, Integer.MAX_VALUE);
            if (mode == 1) data.putShort(46, (short) 8);
            if (mode == 2) data.putInt(40, 0);
            if (mode == 3) bad[0] = 0;
            boolean denied = false; try { VehicleLeadIn.prepend(bad, 4000); } catch (java.io.IOException expected) { denied = true; }
            check(denied);
        }
        System.out.println("VehicleLeadIn: exact four-second silence, complete first samples, extra chunks and malformed audio passed");
    }
}
