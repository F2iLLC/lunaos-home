import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, symlink, link, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareAndroid } from '../scripts/prepare-android.mjs';

const pkg = 'java/io/github/f2illc/lunaos/home/preview';
const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>';
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'home-source-tree-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project');
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
    for (const extra of [`${pkg}/Unexpected.java`, `${pkg}/Unexpected.kt`, 'AndroidManifest.xml']) {
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
