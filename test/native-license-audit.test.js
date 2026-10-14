import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { inventoryNativeLicenses } from '../scripts/audit-native-licenses.mjs';

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
  const home = { id: 'home', name: 'lunaos-home-preview', version: '0.1.0', manifest_path: join(root, 'Cargo.toml') };
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
