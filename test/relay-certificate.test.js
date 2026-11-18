import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
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
  {
    san = "DNS:localhost,IP:127.0.0.1,IP:100.64.0.7",
    authority = true,
    subject = "/CN=localhost",
  } = {},
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
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        subject,
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
  if (process.platform !== "win32") chmodSync(host.file("relay-key.pem"), 0o640);
  const keyModeBefore = statSync(host.file("relay-key.pem")).mode;
  const result = await renewRelayCertificate({
    configPath: host.configPath,
    deviceConfigPath: host.deviceConfigPath,
    days: 90,
    openssl,
  });

  const after = readFileSync(host.file("relay-cert.pem"), "utf8");
  assert.notEqual(after, before);
  assert.equal(readFileSync(host.file("relay-key.pem"), "utf8"), keyBefore);
  assert.equal(statSync(host.file("relay-key.pem")).mode, keyModeBefore);
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

test("private configuration paths cannot enter Git through a directory symlink", async (t) => {
  const host = relayHost(t);
  const root = path.resolve(import.meta.dirname, "..");
  const alias = host.file("checkout");
  symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    checkRelayCertificate({ configPath: path.join(alias, "package.json") }),
    /outside Git/,
  );
  const deviceConfigPath = path.join(alias, `relay-regression-${path.basename(host.dir)}.json`);
  const before = readFileSync(host.file("relay-cert.pem"));
  await assert.rejects(
    renewRelayCertificate({ configPath: host.configPath, deviceConfigPath, openssl }),
    /outside Git/,
  );
  assert.equal(existsSync(deviceConfigPath), false);
  assert.deepEqual(readFileSync(host.file("relay-cert.pem")), before);
  assert.equal(readdirSync(host.dir).some(name => name.startsWith(".relay-renew-")), false);

  // Configured certificate/key inputs must obey the same canonical-path rule.
  for (const field of ["cert", "key"]) {
    writeFileSync(host.configPath, JSON.stringify({
      token: TOKEN,
      cert: host.file("relay-cert.pem"),
      key: host.file("relay-key.pem"),
      [field]: path.join(alias, "package.json"),
    }));
    await assert.rejects(checkRelayCertificate({ configPath: host.configPath }), /outside Git/);
  }
});

test("unsupported subjects are refused before renewal writes any files", async (t) => {
  const host = relayHost(t, { subject: "/O=Example household/CN=localhost" });
  const before = readFileSync(host.file("relay-cert.pem"));
  await assert.rejects(
    renewRelayCertificate({ ...host, openssl }),
    /single plain common name/,
  );
  assert.deepEqual(readFileSync(host.file("relay-cert.pem")), before);
  assert.equal(existsSync(host.deviceConfigPath), false);
  assert.equal(readdirSync(host.dir).some(name => name.startsWith(".relay-renew-")), false);
});

test("a backup collision rolls back the newly written device file", async (t) => {
  const host = relayHost(t);
  const now = Date.now();
  const before = readFileSync(host.file("relay-cert.pem"));
  const backup = `${host.file("relay-cert.pem")}.replaced-${new Date(now).toISOString().replace(/[-:]|\..*/g, "")}`;
  writeFileSync(backup, "existing backup");
  await assert.rejects(renewRelayCertificate({ ...host, now, openssl }), { code: "EEXIST" });
  assert.equal(readFileSync(backup, "utf8"), "existing backup");
  assert.deepEqual(readFileSync(host.file("relay-cert.pem")), before);
  assert.equal(existsSync(host.deviceConfigPath), false);
  assert.equal(readdirSync(host.dir).some(name => name.startsWith(".relay-renew-")), false);
});

test("check CLI warns only below its configured threshold", async (t) => {
  const host = relayHost(t);
  // A one-day certificate has zero whole days remaining during this test.
  // Negative thresholds are intentionally invalid, so use renewed certificates
  // for the above/equal/below boundary cases.
  await renewRelayCertificate({ ...host, days: 30, openssl });
  const { daysRemaining } = await checkRelayCertificate(host);
  for (const offset of [-1, 0, 1]) {
    const result = spawnSync(process.execPath, [
      "scripts/renew-spoken-question-relay-cert.mjs", "check", host.configPath,
      "--warn-days", String(daysRemaining + offset),
    ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, offset > 0 ? 2 : 0, result.stderr);
    assert.match(result.stdout, /Relay certificate: expires .*SHA-256/);
    assert.equal(result.stderr.includes("due for renewal"), offset > 0);
    assert.equal((result.stdout + result.stderr).includes(TOKEN), false);
    assert.equal((result.stdout + result.stderr).includes("BEGIN CERTIFICATE"), false);
  }
});
