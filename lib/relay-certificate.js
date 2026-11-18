// Inspect and renew the spoken-question relay's self-signed certificate.
// The device trusts exactly the PEM in its private question-relay.json, so a
// renewal is only complete once that file is replaced on the device too.
import { execFile } from "node:child_process";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const DAY = 86_400_000;
const NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
export const MAX_RELAY_CERTIFICATE_DAYS = 397;

function external(path) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error("External configuration required");
  const rel = relative(root, resolve(path));
  if (!rel.startsWith("..") && !isAbsolute(rel))
    throw Error("Keep private files outside Git");
  return path;
}

// Names are re-used verbatim in an OpenSSL configuration file, so anything
// outside plain DNS names and IP literals is refused rather than escaped.
function names(certificate) {
  const entries = (certificate.subjectAltName ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0)
    throw Error("Relay certificate has no subject alternative names");
  return entries.map((entry) => {
    const separator = entry.indexOf(":");
    const kind = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (kind === "DNS" && NAME.test(value)) return { type: "DNS", value };
    if (kind === "IP Address" && isIP(value) !== 0)
      return { type: "IP", value };
    throw Error(
      "Relay certificate carries an unsupported subject alternative name",
    );
  });
}

export function describeRelayCertificate(pem, now = Date.now()) {
  const certificate = new X509Certificate(pem);
  const commonName = /^CN=(.+)$/.exec(certificate.subject)?.[1];
  if (!commonName || !NAME.test(commonName))
    throw Error("Relay certificate subject must be a single plain common name");
  const notAfter = new Date(certificate.validTo);
  const notBefore = new Date(certificate.validFrom);
  return {
    commonName,
    names: names(certificate),
    notBefore,
    notAfter,
    authority: certificate.ca,
    daysRemaining: Math.floor((notAfter.getTime() - now) / DAY),
    fingerprint256: certificate.fingerprint256,
  };
}

async function hostConfiguration(configPath) {
  const config = JSON.parse(await readFile(external(configPath), "utf8"));
  if (typeof config.token !== "string" || !/^[0-9a-f]{64}$/.test(config.token))
    throw Error("Relay configuration has no usable token");
  return {
    token: config.token,
    cert: external(config.cert),
    key: external(config.key),
  };
}

export async function checkRelayCertificate({ configPath, now = Date.now() }) {
  const { cert } = await hostConfiguration(configPath);
  return describeRelayCertificate(await readFile(cert), now);
}

// Issues a fresh self-signed certificate for the relay's existing key, with
// the same subject and names. The key and token do not change. Writes the
// matching device file first; the host certificate is swapped last, and the
// certificate it replaces is kept beside it.
export async function renewRelayCertificate({
  configPath,
  deviceConfigPath,
  days = 30,
  endpointHost,
  openssl = process.env.LUNA_HOME_OPENSSL || "openssl",
  now = Date.now(),
}) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_RELAY_CERTIFICATE_DAYS)
    throw Error(`Validity must be 1 to ${MAX_RELAY_CERTIFICATE_DAYS} days`);
  const host = await hostConfiguration(configPath);
  external(deviceConfigPath);
  const previousPem = await readFile(host.cert);
  const key = createPrivateKey(await readFile(host.key));
  if (!new X509Certificate(previousPem).checkPrivateKey(key))
    throw Error("Relay key does not match the relay certificate");
  const previous = describeRelayCertificate(previousPem, now);
  const dnsNames = previous.names
    .filter((name) => name.type === "DNS")
    .map((name) => name.value);
  const endpointName = endpointHost ?? dnsNames[0] ?? previous.names[0].value;
  if (!previous.names.some((name) => name.value === endpointName))
    throw Error("Endpoint host is not a name on the relay certificate");

  const scratch = await mkdtemp(join(dirname(host.cert), ".relay-renew-"));
  try {
    const settings = join(scratch, "request.cnf");
    const issued = join(scratch, "cert.pem");
    await writeFile(
      settings,
      [
        "[req]",
        "distinguished_name=dn",
        "x509_extensions=ext",
        "prompt=no",
        "[dn]",
        `CN=${previous.commonName}`,
        "[ext]",
        // Kept as issued: the device uses this certificate as its only trust
        // anchor, and older Android releases are particular about that flag.
        `basicConstraints=critical,CA:${previous.authority ? "TRUE" : "FALSE"}`,
        `subjectAltName=${previous.names.map((name) => `${name.type}:${name.value}`).join(",")}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await run(
      openssl,
      [
        "req",
        "-x509",
        "-new",
        "-key",
        host.key,
        "-sha256",
        "-days",
        String(days),
        "-config",
        settings,
        "-out",
        issued,
      ],
      { windowsHide: true, timeout: 30_000 },
    );
    const pem = await readFile(issued, "utf8");
    const current = describeRelayCertificate(pem, now);
    const same =
      JSON.stringify(current.names) === JSON.stringify(previous.names) &&
      current.commonName === previous.commonName &&
      current.authority === previous.authority;
    if (
      !same ||
      !new X509Certificate(pem).checkPrivateKey(key) ||
      current.notAfter.getTime() <= now
    )
      throw Error("Issued certificate failed verification");

    const endpoint = `https://${isIP(endpointName) === 6 ? `[${endpointName}]` : endpointName}:18743/question`;
    await writeFile(
      deviceConfigPath,
      JSON.stringify(
        { endpoint, certificate: pem, token: host.token },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    const backup = `${host.cert}.replaced-${new Date(now).toISOString().replace(/[-:]|\..*/g, "")}`;
    try {
      await copyFile(host.cert, backup, constants.COPYFILE_EXCL);
      await rename(issued, host.cert);
    } catch (error) {
      await rm(deviceConfigPath, { force: true });
      throw error;
    }
    await chmod(host.key, 0o600);
    return { previous, current, backup, endpoint };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
