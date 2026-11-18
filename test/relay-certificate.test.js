import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRelayCertificate,
  describeRelayCertificate,
  renewRelayCertificate,
} from "../lib/relay-certificate.js";

const gitOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
const openssl =
  process.env.HOME_TEST_OPENSSL ||
  (existsSync(gitOpenSSL) ? gitOpenSSL : "openssl");
const TOKEN = "ab".repeat(32);

// A disposable relay host directory: P-256 key, one-day certificate, host.json.
function relayHost(
  t,
  { san = "DNS:localhost,IP:127.0.0.1,IP:100.64.0.7", authority = true } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "home-relay-cert-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name) => path.join(dir, name);
  const issue = (key, cert) =>
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-noenc",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
        "-addext",
        `subjectAltName=${san}`,
        "-addext",
        `basicConstraints=critical,CA:${authority ? "TRUE" : "FALSE"}`,
      ],
      { stdio: "pipe", windowsHide: true },
    );
  issue(file("relay-key.pem"), file("relay-cert.pem"));
  writeFileSync(
    file("host.json"),
    JSON.stringify({
      enabled: true,
      token: TOKEN,
      cert: file("relay-cert.pem"),
      key: file("relay-key.pem"),
    }),
  );
  return {
    dir,
    file,
    issue,
    configPath: file("host.json"),
    deviceConfigPath: file("question-relay.json"),
  };
}

function ask(port, ca) {
  return new Promise((resolve, reject) =>
    request(
      { host: "127.0.0.1", port, servername: "localhost", ca, method: "GET" },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    )
      .on("error", reject)
      .end(),
  );
}

test("check reports the remaining life of the configured certificate", async (t) => {
  const host = relayHost(t);
  const now = Date.now();
  const certificate = await checkRelayCertificate({
    configPath: host.configPath,
    now,
  });
  assert.equal(certificate.daysRemaining, 0);
  assert.deepEqual(certificate.names, [
    { type: "DNS", value: "localhost" },
    { type: "IP", value: "127.0.0.1" },
    { type: "IP", value: "100.64.0.7" },
  ]);
  assert.equal(
    (
      await checkRelayCertificate({
        configPath: host.configPath,
        now: now + 3 * 86_400_000,
      })
    ).daysRemaining,
    -3,
  );
});

test("renewal keeps key, names and token, and the device file trusts the new certificate", async (t) => {
  const host = relayHost(t);
  const before = readFileSync(host.file("relay-cert.pem"), "utf8");
  const keyBefore = readFileSync(host.file("relay-key.pem"), "utf8");
  const result = await renewRelayCertificate({
    configPath: host.configPath,
    deviceConfigPath: host.deviceConfigPath,
    days: 90,
    openssl,
  });

  const after = readFileSync(host.file("relay-cert.pem"), "utf8");
  assert.notEqual(after, before);
  assert.equal(readFileSync(host.file("relay-key.pem"), "utf8"), keyBefore);
  assert.equal(readFileSync(result.backup, "utf8"), before);
  assert.deepEqual(result.current.names, result.previous.names);
  assert.ok(
    result.current.daysRemaining >= 89 && result.current.daysRemaining <= 90,
  );
  assert.deepEqual(JSON.parse(readFileSync(host.deviceConfigPath, "utf8")), {
    endpoint: "https://localhost:18743/question",
    certificate: after,
    token: TOKEN,
  });
  assert.deepEqual(
    readdirSync(host.dir).filter((name) => name.startsWith(".relay-renew-")),
    [],
  );

  const server = createServer({ cert: after, key: keyBefore }, (_, response) =>
    response.writeHead(204).end(),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  assert.equal(await ask(server.address().port, after), 204);
  await assert.rejects(ask(server.address().port, before));
});

test("renewal refuses unsafe inputs and leaves the host certificate alone", async (t) => {
  const host = relayHost(t);
  const before = readFileSync(host.file("relay-cert.pem"), "utf8");
  const renew = (extra) =>
    renewRelayCertificate({
      configPath: host.configPath,
      deviceConfigPath: host.deviceConfigPath,
      openssl,
      ...extra,
    });

  await assert.rejects(renew({ days: 398 }), /Validity/);
  await assert.rejects(
    renew({ endpointHost: "relay.example" }),
    /not a name on the relay certificate/,
  );
  await assert.rejects(
    renew({ deviceConfigPath: path.resolve("question-relay.json") }),
    /outside Git/,
  );

  writeFileSync(host.deviceConfigPath, "existing");
  await assert.rejects(renew(), { code: "EEXIST" });
  assert.equal(readFileSync(host.deviceConfigPath, "utf8"), "existing");
  rmSync(host.deviceConfigPath);

  host.issue(host.file("other-key.pem"), host.file("other-cert.pem"));
  writeFileSync(
    host.configPath,
    JSON.stringify({
      token: TOKEN,
      cert: host.file("relay-cert.pem"),
      key: host.file("other-key.pem"),
    }),
  );
  await assert.rejects(renew(), /does not match/);

  assert.equal(readFileSync(host.file("relay-cert.pem"), "utf8"), before);
  assert.equal(existsSync(host.deviceConfigPath), false);
  assert.deepEqual(
    readdirSync(host.dir).filter(
      (name) => name.includes("replaced") || name.startsWith(".relay-renew-"),
    ),
    [],
  );
});

test("a certificate with names that are not plain DNS or IP is refused", (t) => {
  const host = relayHost(t, {
    san: "DNS:localhost,email:owner@example.invalid",
  });
  assert.throws(
    () => describeRelayCertificate(readFileSync(host.file("relay-cert.pem"))),
    /unsupported subject alternative name/,
  );
});

for (const authority of [true, false]) {
  test(`renewal keeps the certificate authority flag (${authority})`, async (t) => {
    const host = relayHost(t, { authority });
    const result = await renewRelayCertificate({
      configPath: host.configPath,
      deviceConfigPath: host.deviceConfigPath,
      openssl,
    });
    assert.equal(result.previous.authority, authority);
    assert.equal(result.current.authority, authority);
  });
}
