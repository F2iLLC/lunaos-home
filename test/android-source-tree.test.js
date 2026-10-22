import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, symlink, link, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareAndroid } from '../scripts/prepare-android.mjs';

const pkg = 'java/io/github/f2illc/lunaos/home/preview';
const directPkg = 'java/io/github/f2illc/lunaos/directtlsprobe';
const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>';
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'home-source-tree-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project/gen/android');
  const src = join(projectRoot, 'app/src');
  await mkdir(join(src, 'main', pkg), { recursive: true });
  await writeFile(join(src, 'main/AndroidManifest.xml'), manifest);
  await writeFile(join(src, 'main', pkg, 'MainActivity.kt'),
    await readFile(new URL('../scripts/android/MainActivity.kt', import.meta.url)));
  return { root, projectRoot, src };
}

// Compare names and bytes without following links, including no new debug files.
async function snapshot(root, prefix = '') {
  const entries = [];
  for (const name of (await readdir(root)).sort()) {
    const file = join(root, name), relative = `${prefix}${name}`;
    const info = await lstat(file);
    if (info.isSymbolicLink()) entries.push([relative, 'link']);
    else if (info.isDirectory()) entries.push([relative, 'directory'], ...await snapshot(file, `${relative}/`));
    else entries.push([relative, (await readFile(file)).toString('base64')]);
  }
  return entries;
}

test('every flavor and combined source set rejects extra Java, Kotlin and manifests before writes', async context => {
  for (const variant of ['universal', 'universalDebug', 'x86_64', 'x86_64Debug', 'arm64', 'arm64Release', 'futureFlavor']) {
    for (const extra of [`${pkg}/Unexpected.java`, `${pkg}/Unexpected.kt`, `${pkg}/Unexpected.JAVA`, `${pkg}/Unexpected.KT`, `${directPkg}/Unexpected.java`, 'AndroidManifest.xml']) {
      const f = await fixture(context);
      const path = join(f.src, variant, extra);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'synthetic unreviewed input');
      const before = await snapshot(f.root);
      await assert.rejects(prepareAndroid(f), /Unexpected (?:generated Android source|variant manifest)/);
      assert.deepEqual(await snapshot(f.root), before);
    }
  }
});

test('linked allowed destinations, manifests, directory ancestors and hardlinks cannot overwrite outside files', async context => {
  for (const kind of ['file', 'manifest', 'directory', 'ancestor', 'hardlink']) {
    const f = await fixture(context);
    const outside = join(f.root, 'outside');
    await mkdir(outside);
    const sentinel = join(outside, 'sentinel');
    await writeFile(sentinel, 'synthetic sentinel');
    let destination;
    if (kind === 'ancestor') {
      // Redirect the source root itself, not just its final Java directory.
      await rm(f.src, { recursive: true });
      await symlink(outside, f.src, 'junction');
    } else if (kind === 'directory') {
      destination = join(f.src, 'debug/java');
      await mkdir(dirname(destination), { recursive: true });
      await symlink(outside, destination, 'junction');
    } else {
      destination = join(f.src, 'debug', kind === 'manifest' ? 'AndroidManifest.xml' : `${pkg}/VaultStore.java`);
      await mkdir(dirname(destination), { recursive: true });
      if (kind === 'hardlink') await link(sentinel, destination);
      else await symlink(sentinel, destination);
    }
    const before = await snapshot(f.root);
    await assert.rejects(prepareAndroid(f), /Linked/);
    assert.equal(await readFile(sentinel, 'utf8'), 'synthetic sentinel');
    assert.deepEqual(await snapshot(f.root), before);
  }
});

test('clean generated tree is byte-for-byte repeatable, including empty flavor directories', async context => {
  const f = await fixture(context);
  await mkdir(join(f.src, 'universalDebug'), { recursive: true });
  await mkdir(join(f.src, 'x86_64Debug'), { recursive: true });
  await prepareAndroid(f);
  const first = await snapshot(f.root);
  await prepareAndroid(f);
  assert.deepEqual(await snapshot(f.root), first);
  assert.match(await readFile(join(f.src, 'debug/AndroidManifest.xml'), 'utf8'), /VaultActivity/);
});

test('repeat build accepts only Tauri own exact Rust JNI link', async context => {
  for (const external of [false, true]) {
    const f = await fixture(context);
    const native = join(f.root, 'project/target/aarch64-linux-android/debug/liblunaos_home_preview_lib.so');
    const outside = join(f.root, 'outside.so');
    await mkdir(dirname(native), { recursive: true });
    await writeFile(native, 'synthetic Rust output');
    await writeFile(outside, 'synthetic outside output');
    const linkPath = join(f.src, 'main/jniLibs/arm64-v8a/liblunaos_home_preview_lib.so');
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(external ? outside : native, linkPath);
    if (external) {
      const before = await snapshot(f.root);
      await assert.rejects(prepareAndroid(f), /Linked Android source entry/);
      assert.deepEqual(await snapshot(f.root), before);
    } else {
      await prepareAndroid(f);
      const first = await snapshot(f.root);
      await prepareAndroid(f);
      assert.deepEqual(await snapshot(f.root), first);
    }
  }
});

test('missing generated project, source tree and main manifest retain initialization guidance', async context => {
  for (const missing of ['project', 'src', 'manifest']) {
    const f = await fixture(context);
    await rm(missing === 'project' ? f.projectRoot : missing === 'src' ? f.src : join(f.src, 'main/AndroidManifest.xml'), { recursive: true });
    const before = await snapshot(f.root);
    await assert.rejects(prepareAndroid(f), /Initialize Android first: npm run native:android -- init --ci --skip-targets-install/);
    assert.deepEqual(await snapshot(f.root), before);
  }
});

test('case variants of main, debug and flavor manifests are refused without writes', async context => {
  for (const relative of ['main/androidmanifest.xml', 'debug/ANDROIDMANIFEST.XML',
    'x86_64Debug/androidmanifest.xml', 'universalDebug/Androidmanifest.xml', 'DEBUG/AndroidManifest.xml']) {
    const f = await fixture(context);
    if (relative.startsWith('main/')) await rm(join(f.src, 'main/AndroidManifest.xml'));
    const path = join(f.src, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, manifest);
    const before = await snapshot(f.root);
    await assert.rejects(prepareAndroid(f), /Unexpected variant manifest/);
    assert.deepEqual(await snapshot(f.root), before);
  }
});

test('directories at any planned generated file destination are rejected before writes', async context => {
  for (const relative of ['main/AndroidManifest.xml', `main/${pkg}/MainActivity.kt`,
    'debug/AndroidManifest.xml', ...['VaultService.java', 'VaultStore.java', 'VaultRollback.java', 'VaultActivity.java', 'HomeVaultPlugin.kt'].map(name => `debug/${pkg}/${name}`),
    ...['PairingActivity.java', 'SyntheticTlsClient.java', 'NativeIdentity.java', 'FixtureConfig.java', 'HomeDirectEntry.java'].map(name => `debug/${directPkg}/${name}`)]) {
    const f = await fixture(context);
    const path = join(f.src, relative);
    if (relative.startsWith('main/')) await rm(path);
    await mkdir(path, { recursive: true });
    const before = await snapshot(f.root);
    await assert.rejects(prepareAndroid(f), /Invalid generated file destination/);
    assert.deepEqual(await snapshot(f.root), before);
  }
});
