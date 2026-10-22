import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { certificateFingerprint } from '../../lib/direct-vault-tls.js';

// Disposable identities only. Never touches the OS/user trust store.
export function createDirectTlsIdentities({ hostOnly = false, windowsClient = false } = {}) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'home-direct-tls-'));
  const gitOpenSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
  const openssl = process.env.HOME_TEST_OPENSSL || (existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl');
  function run(args) { execFileSync(openssl, args, { cwd: scratch, stdio: 'pipe', windowsHide: true, timeout: 15_000 }); }
  function cleanup() {
    if (path.dirname(scratch) !== path.resolve(tmpdir()) || !path.basename(scratch).startsWith('home-direct-tls-')) throw Error('Unexpected fixture directory.');
    rmSync(scratch, { recursive: true, force: true });
  }
  try {
    const keyArgs = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-noenc'];
    run(['req', '-x509', ...keyArgs, '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Home Disposable Test CA', '-days', '1', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    const ca = readFileSync(path.join(scratch, 'ca.pem'));
    function identity(name, server = false) {
      run(['req', '-new', ...keyArgs, '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`]);
      writeFileSync(path.join(scratch, `${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${server ? 'serverAuth' : 'clientAuth'}\n${server ? 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' : ''}`);
      run(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '1', '-extfile', `${name}.ext`]);
      const result = { key: readFileSync(path.join(scratch, `${name}.key`)), cert: readFileSync(path.join(scratch, `${name}.pem`)) };
      result.fingerprint = certificateFingerprint(result.cert); return result;
    }
    const hostIdentity = identity('Fictional-Host', true);
    const windowsClientIdentity = windowsClient ? identity('Fictional-Windows-Client') : undefined;
    if (hostOnly) return { scratch, ca, hostIdentity, windowsClientIdentity, cleanup };
    const phoneIdentity = identity('Fictional-Phone');
    const outsiderIdentity = identity('Fictional-Unapproved-Peer');
    run(['req', '-x509', ...keyArgs, '-keyout', 'untrusted.key', '-out', 'untrusted.pem', '-subj', '/CN=Fictional-Untrusted-Issuer', '-days', '1', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'extendedKeyUsage=clientAuth']);
    const untrustedIdentity = { key: readFileSync(path.join(scratch, 'untrusted.key')), cert: readFileSync(path.join(scratch, 'untrusted.pem')) };
    run(['pkcs12', '-export', '-inkey', 'Fictional-Phone.key', '-in', 'Fictional-Phone.pem', '-out', 'phone.p12', '-passout', 'pass:fictional-only']);
    return { scratch, ca, hostIdentity, windowsClientIdentity, phoneIdentity, outsiderIdentity, untrustedIdentity, cleanup };
  } catch (error) { cleanup(); throw error; }
}
