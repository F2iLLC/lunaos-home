package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import android.security.keystore.*;
import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.Date;
import javax.security.auth.x500.X500Principal;
import org.json.JSONObject;

/** Transport identity only. Possessing this key does not unlock records or grant access. */
final class NativeIdentity {
    static final String ALIAS = "fictional-direct-tls-identity-v1";
    static KeyStore store() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return store; }
    static void create() throws Exception {
        if (store().containsAlias(ALIAS)) throw new KeyStoreException("Identity already exists");
        long now = System.currentTimeMillis();
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            // Android TLS hashes the handshake before asking Keystore to sign it.
            // DIGEST_NONE is required for that platform operation, not unhashed TLS.
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_NONE)
            .setCertificateSubject(new X500Principal("CN=Fictional Android transport identity"))
            .setCertificateSerialNumber(new BigInteger(128, new SecureRandom()).add(BigInteger.ONE))
            .setCertificateNotBefore(new Date(now - 60_000)).setCertificateNotAfter(new Date(now + 86_400_000))
            // TLS identity remains usable independently of the separate OS vault-unlock gate.
            .setUserAuthenticationRequired(false).build());
        generator.generateKeyPair();
    }
    static KeyStore requireIdentity() throws Exception {
        KeyStore keys = store();
        if (!keys.containsAlias(ALIAS) || keys.size() != 1) throw new KeyStoreException("Expected only the explicitly enrolled test identity");
        Key key = keys.getKey(ALIAS, null);
        if (!(key instanceof PrivateKey) || key.getEncoded() != null || key.getFormat() != null) throw new KeyStoreException("Unexpected exportable identity");
        return keys;
    }
    static JSONObject inspect(Context context) throws Exception {
        KeyStore keys = requireIdentity();
        PrivateKey key = (PrivateKey) keys.getKey(ALIAS, null);
        X509Certificate certificate = (X509Certificate) keys.getCertificate(ALIAS);
        certificate.checkValidity(); certificate.verify(certificate.getPublicKey());
        KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
        String encoded = android.util.Base64.encodeToString(certificate.getEncoded(), android.util.Base64.NO_WRAP);
        StringBuilder pem = new StringBuilder("-----BEGIN CERTIFICATE-----\n");
        for (int i = 0; i < encoded.length(); i += 64) pem.append(encoded.substring(i, Math.min(encoded.length(), i + 64))).append('\n');
        pem.append("-----END CERTIFICATE-----\n");
        // Public certificate only. There is no private-key serialization/export path.
        try (FileOutputStream out = new FileOutputStream(new File(context.getNoBackupFilesDir(), "client-public.pem"))) {
            out.write(pem.toString().getBytes(StandardCharsets.US_ASCII));
        }
        return new JSONObject().put("nonExportable", true).put("securityLevelReported", info.getSecurityLevel())
            .put("originGenerated", info.getOrigin() == KeyProperties.ORIGIN_GENERATED)
            .put("userAuthenticationRequired", info.isUserAuthenticationRequired()).put("algorithm", key.getAlgorithm())
            .put("authorizedDigests", new org.json.JSONArray(info.getDigests()));
    }
    static String fingerprint() throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(requireIdentity().getCertificate(ALIAS).getEncoded());
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }
    static void remove() throws Exception { store().deleteEntry(ALIAS); }
}
