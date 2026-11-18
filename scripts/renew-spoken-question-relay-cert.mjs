// Check or renew the spoken-question relay certificate on the relay host.
//   node scripts/renew-spoken-question-relay-cert.mjs check <host.json> [--warn-days 14]
//   node scripts/renew-spoken-question-relay-cert.mjs renew <host.json> --device-config <new file> [--days 30] [--endpoint-host name]
// Prints dates and fingerprints only; never the token, key or certificate body.
import { parseArgs } from "node:util";
import {
  checkRelayCertificate,
  renewRelayCertificate,
} from "../lib/relay-certificate.js";

function line(label, certificate) {
  return `${label}: expires ${certificate.notAfter.toISOString()} (${certificate.daysRemaining} days), SHA-256 ${certificate.fingerprint256}`;
}
function whole(value, name) {
  if (!/^\d{1,4}$/.test(value)) throw Error(`${name} must be a whole number`);
  return Number(value);
}

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "warn-days": { type: "string", default: "14" },
      days: { type: "string", default: "30" },
      "device-config": { type: "string" },
      "endpoint-host": { type: "string" },
    },
  });
  const [command, configPath] = positionals;
  if (positionals.length !== 2)
    throw Error(
      "Usage: check <host.json> | renew <host.json> --device-config <new file>",
    );
  if (command === "check") {
    const certificate = await checkRelayCertificate({ configPath });
    console.log(line("Relay certificate", certificate));
    if (certificate.daysRemaining < whole(values["warn-days"], "--warn-days")) {
      console.error(
        "Relay certificate is due for renewal. Luna stops answering questions when it expires.",
      );
      process.exitCode = 2;
    }
  } else if (command === "renew") {
    if (!values["device-config"])
      throw Error("--device-config <new file outside Git> is required");
    const result = await renewRelayCertificate({
      configPath,
      deviceConfigPath: values["device-config"],
      days: whole(values.days, "--days"),
      endpointHost: values["endpoint-host"],
    });
    console.log(line("Replaced", result.previous));
    console.log(line("Issued", result.current));
    console.log(`Previous certificate kept at ${result.backup}`);
    console.log(
      `Device file written to ${values["device-config"]} for ${result.endpoint}`,
    );
    console.log(
      "Next: restart the relay so it serves the new certificate, then install the device file as the app's private question-relay.json. The device cannot reach the relay between those two steps.",
    );
  } else throw Error("Unknown command");
} catch (error) {
  console.error(
    `Relay certificate ${process.argv[2] === "renew" ? "renewal" : "check"} failed: ${error.message}`,
  );
  process.exitCode = 1;
}
