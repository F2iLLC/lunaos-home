import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildCommand, parseArgs, prepare, validateBase, validateManifest } from '../scripts/android-container/prepare.mjs';

const base = `localhost/approved-runner@sha256:${'a'.repeat(64)}`;
const components = ['jdk', 'rust', 'rust-android-std', 'command-line-tools', 'platform', 'build-tools', 'ndk'];

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'android-container-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'input');
  const manifestPath = join(root, 'manifest.json');
  const output = join(root, 'output');
  const contents = {
    'jdk/release': 'JAVA_VERSION="21.0.1"\nOS_NAME="Linux"\nOS_ARCH="x86_64"\n',
    'sdk/cmdline-tools/pinned/source.properties': 'Pkg.Revision=1.0.0\n',
    'sdk/platforms/android-37.0/source.properties': 'AndroidVersion.ApiLevel=37\n',
    'sdk/build-tools/37.0.0/source.properties': 'Pkg.Revision=37.0.0\n',
    'sdk/ndk/29.0.14206865/source.properties': 'Pkg.Revision=29.0.14206865\n',
    'sdk/licenses/android-sdk-license': `${'b'.repeat(40)}\n`,
  };
  for (const path of [
    'jdk/bin/java', 'jdk/bin/javac', 'jdk/LICENSE', 'rust/bin/rustc', 'rust/bin/cargo',
    'rust/LICENSE-APACHE', 'rust/LICENSE-MIT', 'rust/lib/rustlib/x86_64-linux-android/lib/libstd-abc123.rlib',
    'sdk/cmdline-tools/pinned/bin/sdkmanager', 'sdk/cmdline-tools/pinned/NOTICE.txt',
    'sdk/platforms/android-37.0/android.jar', 'sdk/ndk/29.0.14206865/NOTICE',
    ...['aapt2', 'd8', 'apksigner', 'zipalign'].map(name => `sdk/build-tools/37.0.0/${name}`),
    ...['clang', 'x86_64-linux-android24-clang'].map(name => `sdk/ndk/29.0.14206865/toolchains/llvm/prebuilt/linux-x86_64/bin/${name}`),
  ]) contents[path] = 'synthetic fixture, not a compiler\n';
  const manifest = {
    schema: 1, jdk: '21.0.1', rust: '1.80.0', commandLineTools: '1.0.0',
    archives: components.map(component => ({ component, filename: `${component}.tar.xz`, sha256: 'c'.repeat(64), vendor: 'Fictional test vendor' })),
    files: {},
  };
  for (const [path, content] of Object.entries(contents)) {
    await mkdir(dirname(join(input, path)), { recursive: true });
    await writeFile(join(input, path), content);
    manifest.files[path] = createHash('sha256').update(content).digest('hex');
  }
  await chmod(join(input, 'jdk/bin/java'), 0o755);
  const save = () => writeFile(manifestPath, JSON.stringify(manifest));
  await save();
  return { root, input, output, manifestPath, base, manifest, save };
}

test('base and CLI accept only explicit bounded arguments', () => {
  assert.equal(validateBase(base), base);
  for (const value of ['runner', 'runner:latest', `runner:latest@sha256:${'a'.repeat(64)}`, `${base};id`, `https://${base}`, `runner@sha256:${'A'.repeat(64)}`]) {
    assert.throws(() => validateBase(value));
  }
  assert.deepEqual(parseArgs(['--base', base, '--input', '/input', '--manifest', '/manifest.json', '--output', '/output']),
    { base, input: '/input', manifestPath: '/manifest.json', output: '/output' });
  assert.throws(() => parseArgs(['--base', base, '--input', '/input', '--output', '/out', '--output', '/other']));
  assert.throws(() => parseArgs(['--shell', 'anything']));
});

test('staging preserves checksums/licenses and generates only an offline build argv', async context => {
  const options = await fixture(context);
  const command = await prepare(options);
  assert.deepEqual(command, buildCommand(options));
  assert.deepEqual(command.slice(0, 6), ['podman', 'build', '--pull=never', '--network=none', '--platform=linux/amd64', '--timestamp=0']);
  assert(command.includes(`RUNNER_BASE=${base}`));
  assert(!command.some(value => /--volume|--mount|--privileged/.test(value)));
  assert.equal(await readFile(join(options.output, 'context/toolchain/sdk/licenses/android-sdk-license'), 'utf8'), `${'b'.repeat(40)}\n`);
  assert.equal((await lstat(join(options.output, 'context/toolchain/jdk/bin/java'))).mode & 0o777, 0o555);
  assert.equal((await lstat(join(options.output, 'context/toolchain/jdk/bin/java'))).mtimeMs, 0);
  const containerfile = await readFile(join(options.output, 'context/Containerfile'), 'utf8');
  assert(!/^(?:USER|ENTRYPOINT|CMD|SHELL|ADD|VOLUME|EXPOSE)\b/m.test(containerfile));
  assert(!/curl|wget|--licenses|sdkmanager --install/.test(containerfile));
  assert.deepEqual(JSON.parse(await readFile(join(options.output, 'context/manifest.json'), 'utf8')), options.manifest);
  await assert.rejects(prepare(options), /already exists/);
});

test('rejects relative, traversal, checkout and overlapping staging paths before writing', async context => {
  const options = await fixture(context);
  for (const output of ['relative', `${options.root}/../escape`, resolve('android-staging-forbidden'), options.input, join(options.input, 'nested')]) {
    await assert.rejects(prepare({ ...options, output }));
  }
  await assert.rejects(prepare({ ...options, input: 'relative' }));
  await assert.rejects(lstat(options.output), { code: 'ENOENT' });
});

test('rejects linked ancestors, source symlinks and hardlinks', async context => {
  const options = await fixture(context);
  await symlink(options.root, join(options.root, 'alias'));
  await assert.rejects(prepare({ ...options, output: join(options.root, 'alias/output') }), /Linked/);
  await symlink(join(options.input, 'jdk/LICENSE'), join(options.input, 'jdk/linked'));
  await assert.rejects(prepare(options), /regular files/);
  await rm(join(options.input, 'jdk/linked'));
  await link(join(options.input, 'jdk/LICENSE'), join(options.input, 'jdk/hardlinked'));
  await assert.rejects(prepare(options), /Hardlinked/);
  await assert.rejects(lstat(options.output), { code: 'ENOENT' });
});

test('rejects unsafe inventory/provenance, credentials, additional packages and version injection', async context => {
  const options = await fixture(context);
  for (const path of ['jdk/../escape', 'jdk/.env', 'jdk/key.pem', 'jdk/release.jks', 'jdk/credentials/token', 'jdk/credentials.json', 'jdk/auth.json', 'sdk/platform-tools/adb', 'sdk/cmdline-tools/latest/bin/sdkmanager']) {
    assert.throws(() => validateManifest({ ...options.manifest, files: { ...options.manifest.files, [path]: 'a'.repeat(64) } }));
  }
  for (const value of ['latest', '1.2.3;id', '$(id)', ['1.2.3']]) assert.throws(() => validateManifest({ ...options.manifest, rust: value }));
  assert.throws(() => validateManifest({ ...options.manifest, archives: [] }));
  assert.doesNotThrow(() => validateManifest({ ...options.manifest, commandLineTools: '1.0' }));
  assert.throws(() => validateManifest({ ...options.manifest, command: 'id' }));
  assert.throws(() => validateManifest({ ...options.manifest, files: { ...options.manifest.files,
    'rust/lib/rustlib/riscv64-linux-android/lib/libstd-abc.rlib': 'a'.repeat(64) } }));
  await writeFile(join(options.input, 'jdk/secret.key'), 'fictional');
  await assert.rejects(prepare(options), /Credential/);
  await assert.rejects(lstat(options.output), { code: 'ENOENT' });
});

test('rejects missing licenses, extra files, hash mismatch and mismatched Linux metadata', async context => {
  for (const failure of ['license', 'extra', 'checksum', 'metadata']) {
    const options = await fixture(context);
    if (failure === 'license') {
      delete options.manifest.files['sdk/licenses/android-sdk-license'];
      await rm(join(options.input, 'sdk/licenses/android-sdk-license'));
      await options.save();
    }
    if (failure === 'extra') await writeFile(join(options.input, 'jdk/extra'), 'extra');
    if (failure === 'checksum') await writeFile(join(options.input, 'jdk/release'), 'changed');
    if (failure === 'metadata') {
      const text = 'JAVA_VERSION="21.0.1"\nOS_NAME="Windows"\nOS_ARCH="x86_64"\n';
      await writeFile(join(options.input, 'jdk/release'), text);
      options.manifest.files['jdk/release'] = createHash('sha256').update(text).digest('hex');
      await options.save();
    }
    await assert.rejects(prepare(options));
    await assert.rejects(lstat(options.output), { code: 'ENOENT' });
  }
});
