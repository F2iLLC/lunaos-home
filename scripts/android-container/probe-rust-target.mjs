// Explicit real-toolchain regression check, separate from inert Node fixtures.
// Run in a disposable Linux toolchain container with networking disabled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets, verifyRustTarget, verifyRustTargets } from './verify-rust-target.mjs';

assert.equal(process.platform, 'linux');
assert(process.env.NDK_HOME, 'Configured NDK required.');
await verifyRustTargets({ ndkHome: process.env.NDK_HOME });
for (const [target, config] of Object.entries(targets)) {
  const linker = join(process.env.NDK_HOME, 'toolchains/llvm/prebuilt/linux-x86_64/bin', config.linkerSuffix);
  const printed = spawnSync('rustc', ['--print', 'target-libdir', '--target', target],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(printed.status, 0);
  const targetLib = printed.stdout.trim();
  const files = await readdir(targetLib);
  for (const scenario of ['std-only', 'missing-core', 'missing-compiler_builtins']) {
    const root = await mkdtemp(join(tmpdir(), 'home-target-regression-'));
    try {
      const lib = join(root, `lib/rustlib/${target}/lib`);
      await mkdir(lib, { recursive: true });
      for (const file of files) {
        const include = scenario === 'std-only' ? /^libstd-.*\.rlib$/.test(file)
          : !file.startsWith(`lib${scenario.slice('missing-'.length)}-`);
        if (include) await copyFile(join(targetLib, file), join(lib, file));
      }
      assert((await readdir(lib)).some(file => /^libstd-.*\.rlib$/.test(file)));
      const oldCheck = spawnSync('rustc', ['--sysroot', root, '--print', 'target-libdir', '--target', target],
        { timeout: 30000, maxBuffer: 1024 * 1024 });
      assert.equal(oldCheck.status, 0);
      await assert.rejects(verifyRustTarget({ linker, sysroot: root, target }), /compile\/link check failed/);
      console.log(`${target} ${scenario}: path-only check passed; compile/link correctly rejected.`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
console.log('Complete toolchains compiled/linked for both Android targets; incomplete targets rejected. No Android execution or device acceptance.');
