package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import io.github.f2illc.lunaos.home.preview.VaultService;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Enumeration;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

/** One foreground, fixed-fictional read. Never a background or production service. */
public final class PhoneHostServer implements AutoCloseable {
    public interface Listener { void ended(boolean readSucceeded); }
    public static final String HOST_CERT_FILE = "phone-host-windows.pem";
    public static final String PORT_FILE = "phone-host-port.txt";
    private final VaultService service;
    private final VaultService.Grant grant;
    private final Listener listener;
    private final File portFile;
    private final SSLServerSocket server;
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile SSLSocket client;

    private static X509Certificate certificate(File file) throws Exception {
        if (!file.isFile() || file.length() < 100 || file.length() > 16_384)
            throw new SecurityException("Expected a bounded public test certificate");
        try (InputStream input = new FileInputStream(file)) {
            X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
            certificate.checkValidity();
            return certificate;
        }
    }
    private static String fingerprint(X509Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }
    public static String hostFingerprint(Context context) throws Exception {
        return fingerprint(certificate(new File(context.getNoBackupFilesDir(), HOST_CERT_FILE)));
    }
    private static InetAddress wifiAddress() throws Exception {
        NetworkInterface wifi = NetworkInterface.getByName("wlan0");
        if (wifi == null || !wifi.isUp()) throw new SecurityException("Wi-Fi unavailable");
        Enumeration<InetAddress> addresses = wifi.getInetAddresses();
        while (addresses.hasMoreElements()) {
            InetAddress address = addresses.nextElement();
            if (address instanceof Inet4Address && address.isSiteLocalAddress()) return address;
        }
        throw new SecurityException("Private Wi-Fi address unavailable");
    }
    public PhoneHostServer(Context context, VaultService service, VaultService.Grant grant,
            String reviewedHost, Listener listener) throws Exception {
        this.service = service;
        this.grant = grant;
        this.listener = listener;
        service.check(grant, VaultService.Member.ALEX, VaultService.Action.READ);
        X509Certificate host = certificate(new File(context.getNoBackupFilesDir(), HOST_CERT_FILE));
        if (!fingerprint(host).equals(reviewedHost)) throw new SecurityException("Host identity changed after review");
        KeyStore keys = NativeIdentity.requireIdentity();
        X509Certificate phone = (X509Certificate) keys.getCertificate(NativeIdentity.ALIAS);
        phone.checkValidity();
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        km.init(keys, null);
        KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
        trust.load(null);
        trust.setCertificateEntry("reviewed-windows-client", host);
        TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tm.init(trust);
        SSLContext tls = SSLContext.getInstance("TLSv1.3");
        tls.init(km.getKeyManagers(), tm.getTrustManagers(), new SecureRandom());
        SSLServerSocketFactory factory = tls.getServerSocketFactory();
        server = (SSLServerSocket) factory.createServerSocket(0, 1, wifiAddress());
        server.setEnabledProtocols(new String[] { "TLSv1.3" });
        server.setNeedClientAuth(true);
        server.setSoTimeout(30_000);
        portFile = new File(context.getNoBackupFilesDir(), PORT_FILE);
        try (FileOutputStream output = new FileOutputStream(portFile)) {
            output.write(Integer.toString(server.getLocalPort()).getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        } catch (Exception failure) { server.close(); throw failure; }
        Thread worker = new Thread(() -> serve(reviewedHost, fingerprintUnchecked(phone)), "fictional-phone-host");
        worker.setDaemon(true);
        worker.start();
    }
    private static String fingerprintUnchecked(X509Certificate certificate) {
        try { return fingerprint(certificate); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }
    public int port() { return server.getLocalPort(); }
    private void serve(String reviewedHost, String phoneFingerprint) {
        boolean succeeded = false;
        try (SSLSocket socket = (SSLSocket) server.accept()) {
            client = socket;
            socket.setEnabledProtocols(new String[] { "TLSv1.3" });
            socket.setSoTimeout(10_000);
            socket.startHandshake();
            if (!"TLSv1.3".equals(socket.getSession().getProtocol()) ||
                    !reviewedHost.equals(fingerprint((X509Certificate) socket.getSession().getPeerCertificates()[0])) ||
                    !phoneFingerprint.equals(fingerprint((X509Certificate) socket.getSession().getLocalCertificates()[0])))
                throw new SecurityException("Unapproved TLS identity");
            ByteArrayOutputStream request = new ByteArrayOutputStream();
            int value;
            while ((value = socket.getInputStream().read()) != '\n') {
                if (value < 0 || request.size() >= 32) throw new SecurityException("Invalid request");
                request.write(value);
            }
            if (!"READ ALEX".equals(request.toString("UTF-8"))) throw new SecurityException("Read-only fixed request required");
            int variant = service.read(grant, VaultService.Member.ALEX);
            service.check(grant, VaultService.Member.ALEX, VaultService.Action.READ);
            if (closed.get()) throw new SecurityException("Access ended");
            String response = VaultService.fixture(VaultService.Member.ALEX, variant) + "\n";
            socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
            succeeded = true;
        } catch (Exception ignored) {
            // Deny silently. Never expose record, key, certificate or request diagnostics.
        } finally {
            close();
            listener.ended(succeeded);
        }
    }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        try { if (client != null) client.close(); } catch (Exception ignored) { }
        try { server.close(); } catch (Exception ignored) { }
        portFile.delete();
    }
}
