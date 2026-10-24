import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaults = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const android = JSON.parse(await readFile(join(root, 'src-tauri/tauri.android.conf.json'), 'utf8'));
const hooks = { ...defaults.build, ...android.build };
const pkg = 'java/io/github/f2illc/lunaos/home/preview';
const directPkg = 'java/io/github/f2illc/lunaos/directtlsprobe';
// Discover maintained sources independently of the preparation allowlist so a
// new helper cannot be omitted from both the implementation and its test.
const sources = (await readdir(join(root, 'scripts/android/vault')))
  .filter(name => /\.(java|kt)$/.test(name));
const directSources = ['PairingActivity.java', 'SyntheticTlsClient.java', 'VersionedEditState.java', 'NativeIdentity.java', 'FixtureConfig.java', 'HomeDirectEntry.java'];
const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET" /><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>';

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'home-android-hook-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['src', 'lib', 'scripts/android', 'scripts/android-direct-tls-probe', 'scripts/build-native.mjs', 'scripts/prepare-android.mjs', 'package.json', 'LICENSE']) {
    await mkdir(join(directory, path, '..'), { recursive: true });
    await cp(join(root, path), join(directory, path), { recursive: true });
  }
  // Reuse installed build dependencies only; generated Android inputs are real files.
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction');
  const src = join(directory, 'src-tauri/gen/android/app/src');
  await mkdir(join(src, 'main', pkg), { recursive: true });
  await writeFile(join(src, 'main/AndroidManifest.xml'), manifest);
  await cp(join(root, 'scripts/android/MainActivity.kt'), join(src, 'main', pkg, 'MainActivity.kt'));
  return { directory, src };
}

function runHook(hook, directory) {
  // Execute the checked-in command just as Tauri's synchronous hook does.
  return spawnSync(hooks[hook], {
    cwd: directory, shell: true, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, TAURI_ENV_PLATFORM: 'android', TAURI_ENV_DEBUG: 'true' },
  });
}

test('Android dev and build explicitly select the same preparation hook', () => {
  assert.equal(android.build.beforeDevCommand, android.build.beforeBuildCommand);
  assert.match(android.build.beforeDevCommand, /&& node scripts\/prepare-android\.mjs$/);
  assert.doesNotMatch(defaults.build.beforeDevCommand, /prepare-android/);
});

test('both configured hooks populate a clean generated tree before native compilation', async context => {
  for (const hook of ['beforeDevCommand', 'beforeBuildCommand']) {
    const f = await fixture(context);
    const result = runHook(hook, f.directory);
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    for (const source of sources) {
      assert.deepEqual(await readFile(join(f.src, 'debug', pkg, source)),
        await readFile(join(root, 'scripts/android/vault', source)));
    }
    for (const source of directSources) {
      assert.deepEqual(await readFile(join(f.src, 'debug', directPkg, source)),
        await readFile(join(root, 'scripts/android-direct-tls-probe', source)));
    }
    assert.match(await readFile(join(f.src, 'debug/AndroidManifest.xml'), 'utf8'), /VaultActivity/);
    assert.match(await readFile(join(f.src, 'debug/AndroidManifest.xml'), 'utf8'), /PairingActivity/);
    assert.doesNotMatch(await readFile(join(f.src, 'main/AndroidManifest.xml'), 'utf8'), /android.permission.INTERNET/);
    assert.match(await readFile(join(f.directory, 'native-dist/app.js'), 'utf8'), /open_fictional_vault/);
  }
});

test('both hooks propagate preparation refusal without installing native vault files', async context => {
  for (const hook of ['beforeDevCommand', 'beforeBuildCommand']) {
    const f = await fixture(context);
    await writeFile(join(f.src, 'main', pkg, 'Unexpected.java'), 'synthetic stale source');
    const result = runHook(hook, f.directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected generated Android source/);
    assert.equal(await readFile(join(f.src, 'main/AndroidManifest.xml'), 'utf8'), manifest);
    await assert.rejects(readFile(join(f.src, 'debug', pkg, 'HomeVaultPlugin.kt')), { code: 'ENOENT' });
  }
});
