import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const digest = /^[a-f0-9]{64}$/;
const version = /^\d+(?:\.\d+){0,3}$/;
const forbidden = /(?:^|\/)(?:\.[^/]*|(?:credentials?|auth|secrets?|signing|tokens?|passwords?|service-account)(?:[.-][^/]*)?|id_rsa|id_ed25519|node_modules|target)(?:\/|$)|\.(?:pem|key|p12|pfx|jks|keystore|pkcs8|p8|env)$/i;
const ndkPackageFiles = new Set([
  'python3/include/python3.11/token.h',
  'python3/lib/python3.11/lib2to3/pgen2/token.py',
  'python3/lib/python3.11/secrets.py',
  'python3/lib/python3.11/site-packages/pip/_internal/network/auth.py',
  'python3/lib/python3.11/site-packages/pip/_vendor/certifi/cacert.pem',
  'python3/lib/python3.11/site-packages/pip/_vendor/pygments/token.py',
  'python3/lib/python3.11/site-packages/pip/_vendor/requests/auth.py',
  'python3/lib/python3.11/site-packages/setuptools/command/launcher manifest.xml',
  'python3/lib/python3.11/site-packages/setuptools/script (dev).tmpl',
  'python3/lib/python3.11/token.py',
  'sysroot/usr/include/sound/intel/avs/tokens.h',
  'sysroot/usr/include/sound/sof/tokens.h',
].map(path => `sdk/ndk/29.0.14206865/toolchains/llvm/prebuilt/linux-x86_64/${path}`));
const required = [
  'jdk/bin/java', 'jdk/bin/javac', 'jdk/release', 'jdk/LICENSE',
  'rust/bin/rustc', 'rust/bin/cargo',
  'rust/LICENSE-APACHE', 'rust/LICENSE-MIT',
  'sdk/cmdline-tools/pinned/bin/sdkmanager', 'sdk/cmdline-tools/pinned/source.properties',
  'sdk/cmdline-tools/pinned/NOTICE.txt',
  'sdk/platforms/android-37.0/android.jar', 'sdk/platforms/android-37.0/source.properties',
  'sdk/build-tools/37.0.0/aapt2', 'sdk/build-tools/37.0.0/d8',
  'sdk/build-tools/37.0.0/apksigner', 'sdk/build-tools/37.0.0/zipalign',
  'sdk/build-tools/37.0.0/source.properties',
  'sdk/ndk/29.0.14206865/source.properties', 'sdk/ndk/29.0.14206865/NOTICE',
  'sdk/ndk/29.0.14206865/toolchains/llvm/prebuilt/linux-x86_64/bin/clang',
  'sdk/ndk/29.0.14206865/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android24-clang',
  'sdk/licenses/android-sdk-license',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function within(parent, child) {
  const suffix = relative(parent, child);
  return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix));
}

async function safePath(path, missingLeaf = false) {
  assert(typeof path === 'string' && isAbsolute(path) && !path.includes('\\') &&
    !path.split('/').some(part => part === '.' || part === '..') && resolve(path) === path,
  'Use canonical absolute paths without traversal.');
  const chain = [];
  for (let cursor = path; ; cursor = dirname(cursor)) {
    chain.unshift(cursor);
    if (dirname(cursor) === cursor) break;
  }
  for (const entry of chain) {
    let stat;
    try { stat = await lstat(entry); } catch (error) {
      if (error.code === 'ENOENT' && missingLeaf && entry === path) return;
      throw new Error('Input and output parents must already exist.');
    }
    assert(!stat.isSymbolicLink() && await realpath(entry) === entry, 'Linked paths are forbidden.');
    if (entry !== path) assert(stat.isDirectory(), 'Invalid path ancestor.');
  }
}

export function validateBase(base) {
  assert(typeof base === 'string' &&
    /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/.test(base),
  'Runner must be an explicit name@sha256 digest without a tag.');
  return base;
}

function keys(value, expected) {
  assert(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(','), 'Unexpected manifest fields.');
}

function safeInventoryPath(path, directory = false) {
  if (!directory && ndkPackageFiles.has(path)) return true;
  if (directory && ['jdk', 'rust', 'sdk'].includes(path)) return true;
  return /^(?:jdk|rust|sdk)\/[A-Za-z0-9_+@.,=()-]+(?:\/[A-Za-z0-9_+@.,=()-]+)*$/.test(path) &&
    !path.split('/').some(part => part.startsWith('.') || forbidden.test(part));
}

export function validateManifest(manifest) {
  keys(manifest, ['schema', 'jdk', 'rust', 'commandLineTools', 'archives', 'files']);
  assert(manifest.schema === 1 && [manifest.jdk, manifest.rust, manifest.commandLineTools].every(value => typeof value === 'string') && /^21\.\d+\.\d+(?:\.\d+)?$/.test(manifest.jdk) &&
    /^1\.\d+\.\d+$/.test(manifest.rust) && version.test(manifest.commandLineTools), 'Explicit tool versions required.');
  const components = ['jdk', 'rust', 'rust-android-std', 'command-line-tools', 'platform', 'build-tools', 'ndk'];
  assert(Array.isArray(manifest.archives) && manifest.archives.length === components.length, 'Archive provenance required.');
  for (const archive of manifest.archives) {
    keys(archive, ['component', 'filename', 'sha256', 'vendor']);
    assert(Object.values(archive).every(value => typeof value === 'string') && components.includes(archive.component) &&
      /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:tar\.gz|tar\.xz|zip)$/.test(archive.filename) &&
      digest.test(archive.sha256) && /^[A-Za-z0-9][A-Za-z0-9 .+-]{0,79}$/.test(archive.vendor), 'Invalid archive provenance.');
  }
  assert(new Set(manifest.archives.map(archive => archive.component)).size === components.length, 'Duplicate archive component.');
  assert(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files) &&
    Object.keys(manifest.files).length > 0, 'File SHA256 inventory required.');
  for (const [path, hash] of Object.entries(manifest.files)) {
    assert(safeInventoryPath(path) && typeof hash === 'string' && digest.test(hash),
    'Unsafe inventory filename or checksum.');
    if (path.startsWith('sdk/')) assert(/^sdk\/(?:cmdline-tools\/pinned|platforms\/android-37\.0|build-tools\/37\.0\.0|ndk\/29\.0\.14206865|licenses)\//.test(path), 'Unexpected SDK package.');
    const rustDirectory = path.match(/^rust\/lib\/rustlib\/([^/]+)\//)?.[1];
    if (rustDirectory) assert(['x86_64-unknown-linux-gnu', 'x86_64-linux-android', 'etc'].includes(rustDirectory), 'Only the Linux x86_64 host and Android target are supported.');
  }
  return manifest;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root, prefix = '') {
  const result = [];
  for (const entry of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${entry}` : entry;
    const stat = await lstat(join(root, path));
    assert(safeInventoryPath(path, stat.isDirectory()), 'Credential, hidden, checkout or unsafe filename input is forbidden.');
    assert(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), 'Only regular files and directories are allowed.');
    if (stat.isDirectory()) result.push(...await inventory(root, path));
    else {
      assert(stat.nlink === 1, 'Hardlinked input is forbidden.');
      result.push(path);
    }
  }
  return result.sort();
}

async function property(root, path, name, expected) {
  const text = await readFile(join(root, path), 'utf8');
  const values = text.split(/\r?\n/).filter(line => line.split('=')[0].trim() === name)
    .map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, ''));
  assert(values.length === 1 && values[0] === expected, 'Tool metadata does not match the manifest.');
}

async function normalizeContext(path) {
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    for (const name of await readdir(path)) await normalizeContext(join(path, name));
    await chmod(path, 0o755);
  } else await chmod(path, stat.mode & 0o111 ? 0o555 : 0o444);
  await utimes(path, 0, 0);
}

export function buildCommand({ base, output, manifest }) {
  validateBase(base);
  validateManifest(manifest);
  return ['podman', 'build', '--pull=never', '--network=none', '--platform=linux/amd64',
    '--timestamp=0', '--iidfile', join(output, 'image.id'), '--build-arg', `RUNNER_BASE=${base}`,
    '--build-arg', `RUST_VERSION=${manifest.rust}`, '--build-arg', `JDK_VERSION=${manifest.jdk}`,
    '--file', join(output, 'context', 'Containerfile'), join(output, 'context')];
}

export async function prepare({ base, input, manifestPath, output }) {
  assert(process.platform === 'linux', 'Preparation requires Linux; Windows/reparse inputs are not supported.');
  validateBase(base);
  for (const path of [input, manifestPath, output]) {
    await safePath(path, path === output);
    assert(!within(checkout, path), 'Inputs and staging must be outside the checkout.');
  }
  assert(!within(input, output) && !within(output, input) && !within(output, manifestPath), 'Input and output must not overlap.');
  try { await lstat(output); throw new Error('Output already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert((await lstat(input)).isDirectory(), 'Toolchain input must be a directory.');
  const manifestStat = await lstat(manifestPath);
  assert(manifestStat.isFile() && manifestStat.nlink === 1 && manifestStat.size < 32 * 1024 * 1024, 'Invalid manifest input.');
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const files = await inventory(input);
  assert(JSON.stringify(files) === JSON.stringify(Object.keys(manifest.files).sort()), 'Input must exactly match SHA256 inventory.');
  for (const path of required) assert(files.includes(path), 'Required tool or license input missing.');
  assert(files.some(path => /^rust\/lib\/rustlib\/x86_64-linux-android\/lib\/libstd-[a-f0-9]+\.rlib$/.test(path)), 'Android Rust standard library missing.');
  for (const path of files) assert(await hashFile(join(input, path)) === manifest.files[path], 'Input SHA256 mismatch.');
  assert((await readFile(join(input, 'sdk/licenses/android-sdk-license'), 'utf8')).trim().split(/\s+/).every(line => /^[a-f0-9]{40}$/.test(line)), 'Supply existing operator-accepted SDK licenses.');
  await property(input, 'jdk/release', 'JAVA_VERSION', manifest.jdk);
  await property(input, 'jdk/release', 'OS_NAME', 'Linux');
  await property(input, 'jdk/release', 'OS_ARCH', 'x86_64');
  await property(input, 'sdk/cmdline-tools/pinned/source.properties', 'Pkg.Revision', manifest.commandLineTools);
  await property(input, 'sdk/platforms/android-37.0/source.properties', 'AndroidVersion.ApiLevel', '37.0');
  await property(input, 'sdk/build-tools/37.0.0/source.properties', 'Pkg.Revision', '37.0.0');
  await property(input, 'sdk/ndk/29.0.14206865/source.properties', 'Pkg.Revision', '29.0.14206865');
  await mkdir(output, { mode: 0o700 });
  try {
    const context = join(output, 'context');
    await mkdir(join(context, 'toolchain'), { recursive: true });
    for (const path of files) {
      const destination = join(context, 'toolchain', path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(input, path), destination);
      assert(await hashFile(destination) === manifest.files[path], 'Input changed during staging.');
      await chmod(destination, (await lstat(join(input, path))).mode & 0o111 ? 0o555 : 0o444);
    }
    await copyFile(new URL('./Containerfile', import.meta.url), join(context, 'Containerfile'));
    await writeFile(join(context, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(context, '.containerignore'), '**\n!Containerfile\n!manifest.json\n!toolchain/\n!toolchain/**\n');
    await normalizeContext(context);
    const command = buildCommand({ base, output, manifest });
    await writeFile(join(output, 'build-command.json'), `${JSON.stringify(command, null, 2)}\n`);
    return command;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export function parseArgs(args) {
  assert(args.length === 8, 'Required: --base --input --manifest --output (each with one value).');
  const options = {};
  const names = { '--base': 'base', '--input': 'input', '--manifest': 'manifestPath', '--output': 'output' };
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    assert(name && !Object.hasOwn(options, name), 'Unknown or duplicate argument.');
    options[name] = args[index + 1];
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepare(parseArgs(process.argv.slice(2))))); }
  catch { console.error('Android staging rejected. Check the documented input contract; no build was executed.'); process.exitCode = 1; }
}
