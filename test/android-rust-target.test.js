import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { targets, verifyRustTarget, verifyRustTargets } from '../scripts/android-container/verify-rust-target.mjs';

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'home-target-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function elf(machine = 62) {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(machine, 18);
  return bytes;
}

test('compile failure, timeout, signal and missing compiler reject and clean temporary output', async context => {
  const root = await fixture(context);
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' },
    { status: null, error: new Error('ETIMEDOUT') }, { status: null, error: new Error('ENOENT') }]) {
    await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root, run: () => result, target: 'x86_64-linux-android' }), /compile\/link check failed/);
    assert.deepEqual(await readdir(root), []);
  }
});

test('missing or unsupported target rejects before compiling', async context => {
  const root = await fixture(context);
  for (const target of [undefined, '', 'riscv64-linux-android', 'x86_64-linux-gnu']) {
    await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root, run: () => assert.fail('must not compile'), target }), /Unsupported Android target/);
  }
  assert.deepEqual(await readdir(root), []);
});

test('missing linker rejects for both supported targets', async context => {
  const root = await fixture(context);
  for (const target of Object.keys(targets)) {
    await assert.rejects(verifyRustTarget({ linker: '', temporaryRoot: root, run: () => assert.fail('must not compile'), target }), /linker is required/);
    await assert.rejects(verifyRustTarget({ temporaryRoot: root, run: () => assert.fail('must not compile'), target }), /linker is required/);
  }
});

test('success exit without the expected target executable cannot pass, for either target', async context => {
  const root = await fixture(context);
  for (const target of Object.keys(targets)) {
    const wrongMachine = target === 'x86_64-linux-android' ? 183 : 62;
    for (const artifact of [null, Buffer.alloc(0), Buffer.from('host executable'), elf(wrongMachine)]) {
      await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root, target,
        run: (_compiler, args) => {
          if (artifact) writeFileSync(args[args.indexOf('-o') + 1], artifact);
          return { status: 0 };
        },
      }));
      assert.deepEqual(await readdir(root), []);
    }
  }
});

test('compiles a std-using program with the matching target linker and never executes the result', async context => {
  for (const [target, config] of Object.entries(targets)) {
    const root = await fixture(context);
    let calls = 0;
    await verifyRustTarget({ compiler: '/rust/bin/rustc', linker: `/ndk with space/${config.linkerSuffix}`, temporaryRoot: root, target,
      run: (compiler, args, options) => {
        calls++;
        assert.equal(compiler, '/rust/bin/rustc');
        assert.equal(args[args.indexOf('--target') + 1], target);
        assert(args.includes(`linker=/ndk with space/${config.linkerSuffix}`));
        assert(!args.includes('--print'));
        assert.match(options.input, /fn main\(\).*vec!.*String::from.*println!/);
        assert.equal(options.shell, false);
        assert.equal(options.timeout, 120000);
        writeFileSync(args[args.indexOf('-o') + 1], elf(config.machine));
        return { status: 0 };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(root), []);
  }
});

test('ELF class and endianness are still checked per target', async context => {
  const root = await fixture(context);
  for (const target of Object.keys(targets)) {
    const machine = targets[target].machine;
    const wrongClass = elf(machine); wrongClass[4] = 1;
    const wrongEndian = elf(machine); wrongEndian[5] = 2;
    for (const artifact of [wrongClass, wrongEndian]) {
      await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root, target,
        run: (_compiler, args) => { writeFileSync(args[args.indexOf('-o') + 1], artifact); return { status: 0 }; },
      }));
      assert.deepEqual(await readdir(root), []);
    }
  }
});

test('verifyRustTargets checks both targets with their matching NDK linker paths and rejects a missing NDK', async context => {
  const root = await fixture(context);
  const seen = [];
  await verifyRustTargets({
    ndkHome: '/opt/home-android/sdk/ndk/29.0.14206865', temporaryRoot: root,
    run: (_compiler, args) => {
      const target = args[args.indexOf('--target') + 1];
      seen.push(target);
      writeFileSync(args[args.indexOf('-o') + 1], elf(targets[target].machine));
      return { status: 0 };
    },
  });
  assert.deepEqual(seen.sort(), Object.keys(targets).sort());
  await assert.rejects(verifyRustTargets({ ndkHome: '', temporaryRoot: root, run: () => assert.fail('must not compile') }), /Configured NDK required/);
});
