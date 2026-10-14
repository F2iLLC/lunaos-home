import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { inventoryNativeLicenses } from '../scripts/audit-native-licenses.mjs';
import { bundleNativeNotices } from '../scripts/bundle-native-notices.mjs';

const source = 'registry+https://github.com/rust-lang/crates.io-index';
const windows = 'x86_64-pc-windows-msvc';
const android = 'aarch64-linux-android';
const arm32 = 'armv7-linux-androideabi';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'luna-native-licenses-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('luna-native-licenses-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'checkout'));
  const home = { id: 'home', name: 'lunaos-home-preview', version: '0.1.0', manifest_path: join(root, 'checkout', 'Cargo.toml') };
  await writeFile(home.manifest_path, '# synthetic package');
  async function pkg(name, files = { LICENSE: 'Synthetic test license text' }, extra = {}) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, 'Cargo.toml'), '# synthetic dependency');
    for (const [file, text] of Object.entries(files)) {
      const path = join(directory, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, text);
    }
    return { id: name, name, version: '1.0.0', source, license: 'MIT', manifest_path: join(directory, 'Cargo.toml'), ...extra };
  }
  const input = (packages, target = windows, unused = []) => ({ target, metadata: {
    packages: [home, ...packages, ...unused],
    resolve: { root: home.id, nodes: [home, ...packages].map(item => ({ id: item.id })) },
  } });
  return { root, home, pkg, input, run: inputs => inventoryNativeLicenses(inputs, home.manifest_path, Buffer.from('synthetic lockfile')) };
}

test('target resolution excludes unused packages, merges shared packages and removes local paths', async t => {
  const f = await fixture(t);
  const shared = await f.pkg('shared');
  const mobile = await f.pkg('mobile');
  const armOnly = await f.pkg('arm-only', {});
  const unused = { id: 'unused', manifest_path: 'must-not-read' };
  const report = await f.run([f.input([shared], windows, [unused]), f.input([mobile, shared], android), f.input([shared, armOnly], arm32)]);
  assert.equal(report.packages.length, 3);
  assert.deepEqual(report.targets.map(item => item.packageCount).sort(), [1, 2, 2]);
  assert.deepEqual(report.packages.find(item => item.name === 'shared').targets, [android, arm32, windows]);
  assert.deepEqual(report.packages.find(item => item.name === 'arm-only').targets, [arm32]);
  assert.deepEqual(report.packages.find(item => item.name === 'arm-only').gaps, ['license-text-not-found']);
  assert.equal(report.packagesWithGaps, 1);
  assert.equal(report.distributionApproved, false);
  assert.match(report.cargoLockSha256, /^[a-f0-9]{64}$/);
  assert.match(report.packages.find(item => item.name === 'shared').files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes(f.root), false);
  assert.equal(JSON.stringify(report).includes('manifest_path'), false);
  assert.deepEqual(report, await f.run([f.input([armOnly, shared], arm32), f.input([shared, mobile], android), f.input([shared], windows, [unused])]));
});

test('candidate bundle preserves exact bytes, identities, gaps and deterministic coverage', async t => {
  const f = await fixture(t);
  const original = Buffer.from('\uFEFFSynthetic license\r\nCopyright fictional test author\r\n');
  const dependency = await f.pkg('dependency', { LICENSE: original, NOTICE: 'Synthetic notice' });
  const missing = await f.pkg('missing', {});
  const blank = await f.pkg('blank', { LICENSE: '  \n' });
  const inputs = [f.input([dependency, missing, blank]), f.input([dependency], android)];
  const bundle = output => bundleNativeNotices(inputs, f.home.manifest_path, Buffer.from('synthetic lockfile'), join(f.root, output), dirname(f.home.manifest_path));
  const result = await bundle('bundle');
  assert.equal(result.complete, true);
  assert.equal(result.distributionApproved, false);
  assert.equal(result.packagesWithGaps, 2);
  assert.equal(result.filesCopied, 3);
  assert.equal(JSON.stringify(result).includes(f.root), false);
  const entry = result.packages.find(pkg => pkg.name === 'dependency');
  assert.deepEqual(entry.targets, [android, windows]);
  for (const file of entry.files) {
    const bytes = await readFile(join(f.root, 'bundle', file.bundlePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.length, file.bytes);
    if (file.path === 'LICENSE') assert.deepEqual(bytes, original);
  }
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'bundle/manifest.json'), 'utf8')), result);
  inputs.reverse();
  assert.deepEqual(await bundle('repeat'), result);
  assert.deepEqual(await readFile(join(f.root, 'bundle/manifest.json')), await readFile(join(f.root, 'repeat/manifest.json')));
  await assert.rejects(bundle('bundle'), /EEXIST/);
  assert.deepEqual(await readFile(join(f.root, 'bundle/manifest.json')), await readFile(join(f.root, 'repeat/manifest.json')));
});

test('bundle refuses checkout outputs, oversized files and combined content without creating an export', async t => {
  const f = await fixture(t);
  const dependency = await f.pkg('dependency');
  const run = output => bundleNativeNotices([f.input([dependency])], f.home.manifest_path, Buffer.from('lock'), output, dirname(f.home.manifest_path));
  await assert.rejects(run(join(f.root, 'checkout/bundle')), /outside the checkout/);
  await writeFile(join(f.root, 'dependency/LICENSE'), Buffer.alloc(2 * 1024 * 1024 + 1, 'x'));
  await assert.rejects(run(join(f.root, 'oversized')), /2 MiB/);
  await assert.rejects(stat(join(f.root, 'oversized')), { code: 'ENOENT' });
  await writeFile(join(f.root, 'dependency/LICENSE'), Buffer.alloc(2 * 1024 * 1024, 'x'));
  for (let i = 0; i < 16; i++) await writeFile(join(f.root, `dependency/LICENSE.${i}`), Buffer.alloc(2 * 1024 * 1024, 'x'));
  await assert.rejects(run(join(f.root, 'combined')), /32 MiB/);
  await assert.rejects(stat(join(f.root, 'combined')), { code: 'ENOENT' });
});

test('bundle refuses pre-existing destination links and parents pointing into checkout', async t => {
  const f = await fixture(t);
  const dependency = await f.pkg('dependency');
  const checkout = dirname(f.home.manifest_path);
  const run = output => bundleNativeNotices([f.input([dependency])], f.home.manifest_path, Buffer.from('lock'), output, checkout);
  const alias = join(f.root, 'checkout-link');
  await symlink(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(join(alias, 'bundle')), /outside the checkout/);
  await mkdir(join(f.root, 'previous'));
  const destination = join(f.root, 'destination-link');
  await symlink(join(f.root, 'previous'), destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(destination), /EEXIST/);
  await assert.rejects(stat(join(f.root, 'previous/manifest.json')), { code: 'ENOENT' });
});

test('license declarations and notices alone cannot hide missing license text', async t => {
  const f = await fixture(t);
  const noticeOnly = await f.pkg('notice-only', { NOTICE: 'Attribution only' });
  const missing = await f.pkg('missing-declared', {}, { license_file: 'legal/LICENSE' });
  const empty = await f.pkg('empty', { LICENSE: '  \n' });
  const report = await f.run([f.input([noticeOnly, missing, empty])]);
  assert.equal(report.packagesWithGaps, 3);
  assert.deepEqual(report.packages.find(pkg => pkg.name === 'notice-only').gaps, ['license-text-not-found']);
  assert.ok(report.packages.find(pkg => pkg.name === 'missing-declared').gaps.includes('declared-license-file-missing'));
  assert.ok(report.packages.find(pkg => pkg.name === 'empty').gaps.includes('empty-license-file'));
});

test('declared nested license files are inventoried while escaping paths are refused', async t => {
  const f = await fixture(t);
  const nested = await f.pkg('nested', { 'legal/terms.txt': 'Synthetic terms' }, { license: null, license_file: 'legal/terms.txt' });
  const report = await f.run([f.input([nested])]);
  assert.equal(report.packagesWithGaps, 0);
  assert.equal(report.packages[0].files[0].path, 'legal/terms.txt');
  await assert.rejects(f.run([f.input([{ ...nested, license_file: '../Cargo.toml' }])]), /leaves package/);
});

test('unapproved source types are flagged without reading their filesystem locations', async t => {
  const f = await fixture(t);
  const report = await f.run([f.input([{ id: 'external', name: 'external', version: '1', source: null, manifest_path: 'must-not-read' }])]);
  assert.deepEqual(report.packages[0].gaps, ['source-needs-review']);
  assert.equal(report.packages[0].sourceArchive, null);
});

test('a license symlink cannot read a file outside its resolved package', async t => {
  const f = await fixture(t);
  const dependency = await f.pkg('linked', {});
  try { await symlink(f.home.manifest_path, join(f.root, 'linked', 'LICENSE'), 'file'); }
  catch (error) {
    if (error.code === 'EPERM' && process.platform === 'win32') return t.skip('Windows symlink creation is unavailable.');
    throw error;
  }
  await assert.rejects(f.run([f.input([dependency])]), /link leaves package/);
});

test('incomplete, duplicate and mismatched metadata fail instead of returning partial coverage', async t => {
  const f = await fixture(t);
  const dependency = await f.pkg('dependency');
  const input = f.input([dependency]);
  await assert.rejects(f.run([{ ...input, target: 'unknown' }]), /Unsupported/);
  await assert.rejects(f.run([input, input]), /duplicate target/);
  await assert.rejects(f.run([{ target: windows, metadata: { ...input.metadata, resolve: null } }]), /resolution/);
  input.metadata.resolve.nodes.push({ id: 'missing' });
  await assert.rejects(f.run([input]), /missing metadata/);
  const changed = f.input([{ ...dependency, license: 'Apache-2.0' }], android);
  await assert.rejects(f.run([f.input([dependency]), changed]), /Inconsistent package/);
});
