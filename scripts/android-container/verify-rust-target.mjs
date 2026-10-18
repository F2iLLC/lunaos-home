import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = 'fn main() { let words = vec![String::from("synthetic target check")]; println!("{}", words[0]); }\n';

// ELF e_machine values for the two supported Android targets.
export const targets = {
  'x86_64-linux-android': { machine: 62, linkerSuffix: 'x86_64-linux-android24-clang' },
  'aarch64-linux-android': { machine: 183, linkerSuffix: 'aarch64-linux-android24-clang' },
};

// Supervisor/build-time check only. Compile and link, but never execute the
// Android binary. A computed target-libdir or a lone libstd is not readiness.
export async function verifyRustTarget({ compiler = 'rustc', linker, sysroot, temporaryRoot = tmpdir(), run = spawnSync, target }) {
  if (typeof linker !== 'string' || !linker) throw new Error('Android linker is required.');
  const config = targets[target];
  if (!config) throw new Error('Unsupported Android target.');
  const directory = await mkdtemp(join(temporaryRoot, 'home-android-target-'));
  try {
    const output = join(directory, 'probe');
    const args = ['--crate-name', 'home_android_target_check', '--edition=2021',
      '--target', target, '-C', `linker=${linker}`, '-o', output];
    if (sysroot !== undefined) args.push('--sysroot', sysroot);
    args.push('-');
    const result = run(compiler, args, {
      input: source, encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 120000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error('Android Rust compile/link check failed.');
    }
    const binary = await readFile(output);
    // ELF64 little-endian executable/PIE with the target's expected machine, not an empty or host artifact.
    if (binary.length < 64 || !binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      binary[4] !== 2 || binary[5] !== 1 || ![2, 3].includes(binary.readUInt16LE(16)) || binary.readUInt16LE(18) !== config.machine) {
      throw new Error('Android Rust check did not produce the expected target binary.');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Validates both supported targets against their matching NDK API-24 linker wrappers.
export async function verifyRustTargets({ ndkHome, compiler = 'rustc', temporaryRoot, run }) {
  if (typeof ndkHome !== 'string' || !ndkHome) throw new Error('Configured NDK required.');
  for (const [target, config] of Object.entries(targets)) {
    const linker = join(ndkHome, 'toolchains/llvm/prebuilt/linux-x86_64/bin', config.linkerSuffix);
    await verifyRustTarget({ compiler, linker, temporaryRoot, run, target });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 || !process.env.NDK_HOME) throw new Error('Configured NDK required.');
    await verifyRustTargets({ ndkHome: process.env.NDK_HOME });
    console.log('Android Rust compile/link checks passed for x86_64-linux-android and aarch64-linux-android; target binaries were not executed.');
  } catch {
    console.error('Android Rust compile/link validation failed. Check the configured compiler, complete target libraries and NDK linkers.');
    process.exitCode = 1;
  }
}
