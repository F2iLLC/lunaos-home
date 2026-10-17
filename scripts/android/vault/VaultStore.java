package io.github.f2illc.lunaos.home.preview;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class VaultStore implements VaultService.Store {
    private final Context context;
    VaultStore(Context context) { this.context = context.getApplicationContext(); }
    private AtomicFile file(VaultService.Member member) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "fictional-v1-" + member.name()));
    }
    private byte[] purpose(VaultService.Member member) {
        return ("Home fictional phone vault/v1/" + member.name()).getBytes(StandardCharsets.UTF_8);
    }
    private SecretKey key(VaultService.Member member, boolean create) throws Exception {
        String alias = "home.fictional.v1." + member.name();
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (keys.containsAlias(alias)) return (SecretKey) keys.getKey(alias, null);
        if (!create) throw new IllegalStateException("Existing key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(120, KeyProperties.AUTH_DEVICE_CREDENTIAL)
            .setUnlockedDeviceRequired(true).build());
        return generator.generateKey();
    }
    private boolean exists(VaultService.Member member) {
        File base = file(member).getBaseFile();
        return base.exists() || new File(base + ".bak").exists() || new File(base + ".new").exists();
    }
    private byte[] envelope(VaultService.Member member) throws Exception {
        try (FileInputStream input = file(member).openRead()) {
            byte[] envelope = new byte[32];
            int offset = 0;
            while (offset < envelope.length) {
                int count = input.read(envelope, offset, envelope.length - offset);
                if (count < 0) break;
                offset += count;
            }
            if (offset != 30 || envelope[0] != 1) throw new IllegalStateException("Unsupported envelope");
            return Arrays.copyOf(envelope, 30);
        }
    }
    public int read(VaultService.Member member) throws Exception {
        byte[] envelope = envelope(member);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(member, false), new GCMParameterSpec(128, Arrays.copyOfRange(envelope, 1, 13)));
        cipher.updateAAD(purpose(member));
        byte[] plain = cipher.doFinal(Arrays.copyOfRange(envelope, 13, 30));
        if (plain.length != 1 || plain[0] < 0 || plain[0] > 1) throw new IllegalStateException("Invalid fixture");
        return plain[0];
    }
    public void write(VaultService.Member member, int variant, Runnable beforeCommit) throws Exception {
        boolean existing = exists(member);
        if (existing) read(member);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(member, !existing));
        cipher.updateAAD(purpose(member));
        byte[] encrypted = cipher.doFinal(new byte[] { (byte) variant });
        if (cipher.getIV().length != 12) throw new IllegalStateException("Unsupported IV");
        byte[] expected = new byte[30];
        expected[0] = 1;
        System.arraycopy(cipher.getIV(), 0, expected, 1, 12);
        System.arraycopy(encrypted, 0, expected, 13, encrypted.length);
        AtomicFile atomic = file(member);
        FileOutputStream output = null;
        boolean committing = false;
        try {
            output = atomic.startWrite();
            output.write(expected);
            output.getFD().sync();
            beforeCommit.run();
            committing = true;
            atomic.finishWrite(output);
            output = null;
            if (!Arrays.equals(expected, envelope(member)) || read(member) != variant)
                throw new IllegalStateException("Unconfirmed write");
        } catch (Exception failure) {
            if (output != null && !committing) atomic.failWrite(output);
            if (committing) throw new java.io.IOException("Write outcome unknown", failure);
            throw failure;
        }
    }
}
