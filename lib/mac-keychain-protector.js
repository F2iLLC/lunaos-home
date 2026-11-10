import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// The vault key on the Mac host lives in the signed-in user's login Keychain as
// a generic password. Keychain items are encrypted at rest and unavailable
// while the keychain is locked; any process running as this user can read the
// item through /usr/bin/security without a prompt. This protects the vault file
// against disk or backup theft and other accounts, not against software
// already running as the same user. A stronger unlock is a vault lifecycle gate.
const SECURITY = "/usr/bin/security";
export const KEYCHAIN_SERVICE = "io.lunaos.home.vault";

function security(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, { stdio: ["pipe", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, output: Buffer.concat(chunks).toString("utf8") }),
    );
    child.stdin.end(input ?? "");
  });
}

/**
 * @param {{storeId:string, service?:string, platform?:string}} options
 * @returns {{kind:'mac-keychain', key:(o:{create:boolean})=>Promise<Buffer>, remove:()=>Promise<void>}}
 */
export function macKeychainProtector({
  storeId,
  service = KEYCHAIN_SERVICE,
  platform = process.platform,
} = {}) {
  if (platform !== "darwin")
    throw new Error("The Keychain protector requires macOS.");
  if (
    !/^[a-z0-9-]{1,64}$/.test(storeId ?? "") ||
    !/^[a-z0-9.-]{1,80}$/.test(service)
  )
    throw new TypeError("Invalid Keychain item name.");
  const find = async () => {
    const { code, output } = await security([
      "find-generic-password",
      "-s",
      service,
      "-a",
      storeId,
      "-w",
    ]);
    const hex = output.trim();
    return code === 0 && /^[a-f0-9]{64}$/.test(hex)
      ? Buffer.from(hex, "hex")
      : null;
  };
  return Object.freeze({
    kind: "mac-keychain",
    async key({ create = false } = {}) {
      const existing = await find();
      // A key already present is never replaced: it may protect a store this
      // caller cannot see, and replacing it would make that store unreadable.
      if (existing) {
        if (create)
          throw new Error("A vault key already exists for this store.");
        return existing;
      }
      if (!create) throw new Error("The vault key is not available.");
      const key = randomBytes(32);
      // Sent on stdin to an interactive `security` session, so the key never
      // appears in a process argument list.
      const { code } = await security(
        ["-i"],
        `add-generic-password -s ${service} -a ${storeId} -l "LunaOS Home vault key" -w ${key.toString("hex")}\n`,
      );
      const stored = code === 0 ? await find() : null;
      if (!stored || !stored.equals(key))
        throw new Error("The vault key could not be stored.");
      return key;
    },
    /** Test stores only. */
    async remove() {
      await security(["delete-generic-password", "-s", service, "-a", storeId]);
    },
  });
}
