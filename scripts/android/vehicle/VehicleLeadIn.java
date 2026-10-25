package io.github.f2illc.lunaos.home.vehicle;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** Prime the vehicle media path with actual silent frames before the first word. */
public final class VehicleLeadIn {
    public static final int MILLISECONDS = 4000;
    public static final int REPLY_MILLISECONDS = 1000;
    private static final int LIMIT = 8 * 1024 * 1024;
    private static boolean tag(byte[] bytes, int at, String value) {
        return new String(bytes, at, 4, StandardCharsets.US_ASCII).equals(value);
    }
    public static byte[] prepend(byte[] input, int milliseconds) throws IOException {
        if (input.length < 44 || input.length > LIMIT || milliseconds < 0 || milliseconds > 5000 ||
            !tag(input, 0, "RIFF") || !tag(input, 8, "WAVE")) throw new IOException("Unsupported speech audio");
        ByteBuffer source = ByteBuffer.wrap(input).order(ByteOrder.LITTLE_ENDIAN);
        if (source.getInt(4) != input.length - 8) throw new IOException("Invalid speech audio");
        int bytesPerSecond = 0, alignment = 0, dataOffset = -1, dataSize = 0;
        for (int offset = 12; offset < input.length;) {
            if (offset + 8 > input.length) throw new IOException("Truncated speech chunk");
            int size = source.getInt(offset + 4);
            if (size < 0 || (long) offset + 8 + size + (size & 1) > input.length) throw new IOException("Invalid speech chunk");
            if (tag(input, offset, "fmt ")) {
                if (bytesPerSecond != 0 || size < 16 || source.getShort(offset + 8) != 1) throw new IOException("PCM speech required");
                int channels = source.getShort(offset + 10), rate = source.getInt(offset + 12);
                bytesPerSecond = source.getInt(offset + 16); alignment = source.getShort(offset + 20);
                if ((channels != 1 && channels != 2) || rate < 8000 || rate > 48000 || source.getShort(offset + 22) != 16 ||
                    alignment != channels * 2 || bytesPerSecond != rate * alignment) throw new IOException("Unsupported PCM speech");
            }
            if (tag(input, offset, "data")) {
                if (dataOffset != -1) throw new IOException("Duplicate speech payload");
                dataOffset = offset + 8; dataSize = size;
            }
            offset += 8 + size + (size & 1);
        }
        if (bytesPerSecond == 0 || dataOffset < 0 || dataSize == 0 || dataSize % alignment != 0) throw new IOException("Missing PCM speech");
        int silence = (int) ((long) bytesPerSecond * milliseconds / 1000 / alignment * alignment);
        if (input.length + silence > LIMIT) throw new IOException("Speech too large");
        byte[] output = new byte[input.length + silence];
        System.arraycopy(input, 0, output, 0, dataOffset);
        System.arraycopy(input, dataOffset, output, dataOffset + silence, input.length - dataOffset);
        ByteBuffer target = ByteBuffer.wrap(output).order(ByteOrder.LITTLE_ENDIAN);
        target.putInt(4, output.length - 8); target.putInt(dataOffset - 4, dataSize + silence);
        return output;
    }
    static void write(File source, File destination) throws IOException {
        try (InputStream in = new FileInputStream(source); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) >= 0) {
                if (bytes.size() + count > LIMIT) throw new IOException("Speech too large");
                bytes.write(buffer, 0, count);
            }
            try (OutputStream out = new FileOutputStream(destination)) { out.write(prepend(bytes.toByteArray(), MILLISECONDS)); }
        }
    }
}
