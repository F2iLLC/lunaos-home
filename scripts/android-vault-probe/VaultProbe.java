package io.github.f2illc.lunaos.vaultprobe;

import android.app.Instrumentation;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Isolated developer experiment: no GUI, network, arbitrary input records or Home integration. */
public final class VaultProbe extends Instrumentation {
    private Bundle arguments;
    private KeyStore keys;
    private File directory;
    private String alias;
    private String run;
    private String check = "operation";
    private static final String OWNER = "io.github.f2illc.lunaos.vaultprobe";
    private static final byte[] FIXTURE = ("{\"members\":[{\"id\":\"alex-example\","
        + "\"work\":\"Willow Studio\"},{\"id\":\"sam-example\",\"school\":\"Meadow School\"}]}")
        .getBytes(StandardCharsets.UTF_8);

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args;
        start(); // Instrumentation worker thread, not the application main thread.
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            run = arguments.getString("run", "");
            require(run.matches("[0-9a-f-]{36}") && UUID.fromString(run).toString().equals(run));
            alias = "luna-home-fictional-probe-" + run;
            directory = new File(getTargetContext().getNoBackupFilesDir(), run);
            require(directory.getCanonicalFile().getParentFile().equals(
                getTargetContext().getNoBackupFilesDir().getCanonicalFile()));
            keys = KeyStore.getInstance("AndroidKeyStore");
            keys.load(null);
            String operation = arguments.getString("operation", "");
            boolean outsider = getTargetContext().getPackageName().equals(OWNER + ".outsider");
            require(outsider ? operation.equals("isolation") : getTargetContext().getPackageName().equals(OWNER));
            switch (operation) {
                case "isolation": require(outsider); isolationCheck(); break;
                case "create": create(); break;
                case "read": readCheck(); break;
                case "tamper": tamperCheck(); break;
                case "delete-key":
                    require(keys.containsAlias(alias));
                    keys.deleteEntry(alias);
                    missingKeyCheck();
                    break;
                case "missing-key": missingKeyCheck(); break;
                case "cleanup": cleanup(); break;
                default: throw new IllegalArgumentException();
            }
            result.putString("result", "PASS");
            result.putInt("processId", android.os.Process.myPid());
            finish(-1, result);
        } catch (Exception failure) {
            // Never print records, key material, local paths or OS diagnostics.
            result.putString("result", "FAIL");
            result.putString("check", check); // Fixed diagnostic labels, never caller data.
            finish(1, result);
        }
    }

    private static void require(boolean condition) {
        if (!condition) throw new IllegalStateException();
    }

    private AtomicFile file() { return new AtomicFile(new File(directory, "records.bin")); }

    private SecretKey key() throws Exception {
        // Missing key is a failure, never a reason to generate a replacement on read.
        require(keys.containsAlias(alias));
        SecretKey key = (SecretKey) keys.getKey(alias, null);
        require(key != null && key.getEncoded() == null);
        return key;
    }

    private byte[] purpose() { return ("LunaHome.FictionalProbe.v1:" + run).getBytes(StandardCharsets.UTF_8); }

    private byte[] encrypt() throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key()); // Provider chooses the IV; never reuse one.
        cipher.updateAAD(purpose());
        byte[] encrypted = cipher.doFinal(FIXTURE);
        byte[] iv = cipher.getIV();
        require(iv.length == 12);
        return ByteBuffer.allocate(1 + iv.length + encrypted.length).put((byte) 1).put(iv).put(encrypted).array();
    }

    private byte[] decrypt(byte[] envelope, byte[] aad) throws Exception {
        require(envelope.length > 29 && envelope.length <= 4096 && envelope[0] == 1);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, envelope, 1, 12));
        cipher.updateAAD(aad);
        return cipher.doFinal(envelope, 13, envelope.length - 13);
    }

    private byte[] bytes() throws Exception {
        require(directory.isDirectory() && file().getBaseFile().length() <= 4096);
        return file().readFully();
    }

    private void write(byte[] encrypted) throws Exception {
        require(encrypted.length <= 4096);
        AtomicFile target = file();
        FileOutputStream output = target.startWrite();
        try { output.write(encrypted); target.finishWrite(output); }
        catch (Exception failure) { target.failWrite(output); throw failure; }
    }

    private void create() throws Exception {
        require(!directory.exists() && !keys.containsAlias(alias));
        require(directory.mkdir());
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
        generator.generateKey();
        byte[] first = encrypt();
        byte[] second = encrypt();
        require(!Arrays.equals(first, second));
        write(first);
        readCheck();
    }

    private void readCheck() throws Exception {
        byte[] encrypted = bytes();
        byte[] plaintext = decrypt(encrypted, purpose());
        try { require(Arrays.equals(plaintext, FIXTURE)); }
        finally { Arrays.fill(plaintext, (byte) 0); }
        for (String encoding : new String[] {"UTF-8", "UTF-16LE"}) {
            String inspected = new String(encrypted, encoding);
            for (String marker : new String[] {"alex-example", "sam-example", "Willow Studio", "Meadow School"}) {
                require(!inspected.contains(marker));
            }
        }
        String[] files = directory.list();
        require(files != null && files.length == 1 && files[0].equals("records.bin"));
    }

    private void expectRejected(byte[] encrypted, byte[] aad) throws Exception {
        boolean rejected = false;
        try { byte[] plain = decrypt(encrypted, aad); Arrays.fill(plain, (byte) 0); }
        catch (java.security.GeneralSecurityException expected) { rejected = true; }
        require(rejected);
    }

    private void tamperCheck() throws Exception {
        byte[] original = bytes();
        byte[] changed = original.clone();
        changed[changed.length - 1] ^= 1;
        write(changed);
        try {
            expectRejected(bytes(), purpose());
            require(Arrays.equals(bytes(), changed)); // No fallback reset after a failed read.
        } finally { write(original); }
        expectRejected(Arrays.copyOf(original, original.length - 1), purpose());
        expectRejected(original, "wrong-purpose".getBytes(StandardCharsets.UTF_8));
        readCheck();
    }

    private void missingKeyCheck() throws Exception {
        byte[] original = bytes();
        require(!keys.containsAlias(alias));
        boolean rejected = false;
        try { decrypt(original, purpose()); }
        catch (IllegalStateException expected) { rejected = true; }
        require(rejected && !keys.containsAlias(alias) && Arrays.equals(bytes(), original));
    }

    private void cleanup() throws Exception {
        // Fixed run only; never enumerate or delete other aliases or unknown files.
        if (keys.containsAlias(alias)) keys.deleteEntry(alias);
        file().delete();
        if (directory.exists()) require(directory.delete());
        require(!directory.exists() && !keys.containsAlias(alias));
    }

    private void isolationCheck() throws Exception {
        // Only the other package installed by this test, and this run's fixed file.
        // Package visibility permits metadata lookup, never changes the caller UID.
        check = "owner-metadata";
        android.content.pm.ApplicationInfo owner = getTargetContext().getPackageManager().getApplicationInfo(OWNER, 0);
        check = "distinct-uid";
        require(owner.uid != android.os.Process.myUid());
        check = "own-uid";
        require(getTargetContext().getApplicationInfo().uid == android.os.Process.myUid());
        check = "key-namespace";
        require(!keys.containsAlias(alias) && keys.getKey(alias, null) == null);
        File ownerFile = new File(owner.dataDir, "no_backup/" + run + "/records.bin");
        for (int access : new int[] {OsConstants.O_RDONLY, OsConstants.O_WRONLY}) {
            check = access == OsConstants.O_RDONLY ? "read-denial" : "write-denial";
            boolean denied = false;
            try { Os.close(Os.open(ownerFile.getPath(), access, 0)); }
            catch (ErrnoException failure) {
                denied = failure.errno == OsConstants.EACCES;
                if (!denied) check += failure.errno == OsConstants.ENOENT ? "-path-unavailable" : "-other-error";
            }
            require(denied); // ENOENT or an unrelated I/O error is not isolation evidence.
        }
        require(!directory.exists()); // The outsider never creates a record or key.
    }
}
