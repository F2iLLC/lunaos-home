import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyRustTarget } from '../scripts/android-container/verify-rust-target.mjs';

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'home-target-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function elf() {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(62, 18);
  return bytes;
}

test('compile failure, timeout, signal and missing compiler reject and clean temporary output', async context => {
  const root = await fixture(context);
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' },
    { status: null, error: new Error('ETIMEDOUT') }, { status: null, error: new Error('ENOENT') }]) {
    await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root, run: () => result }), /compile\/link check failed/);
    assert.deepEqual(await readdir(root), []);
  }
});

test('success exit without a target executable cannot pass', async context => {
  const root = await fixture(context);
  for (const artifact of [null, Buffer.alloc(0), Buffer.from('host executable'),
    (() => { const bytes = elf(); bytes.writeUInt16LE(183, 18); return bytes; })()]) {
    await assert.rejects(verifyRustTarget({ linker: '/ndk/linker', temporaryRoot: root,
      run: (_compiler, args) => {
        if (artifact) writeFileSync(args[args.indexOf('-o') + 1], artifact);
        return { status: 0 };
      },
    }));
    assert.deepEqual(await readdir(root), []);
  }
});

test('compiles a std-using program with the target linker and never executes the result', async context => {
  const root = await fixture(context);
  let calls = 0;
  await verifyRustTarget({ compiler: '/rust/bin/rustc', linker: '/ndk with space/linker', temporaryRoot: root,
    run: (compiler, args, options) => {
      calls++;
      assert.equal(compiler, '/rust/bin/rustc');
      assert.equal(args[args.indexOf('--target') + 1], 'x86_64-linux-android');
      assert(args.includes('linker=/ndk with space/linker'));
      assert(!args.includes('--print'));
      assert.match(options.input, /fn main\(\).*vec!.*String::from.*println!/);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 120000);
      writeFileSync(args[args.indexOf('-o') + 1], elf());
      return { status: 0 };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(root), []);
});
