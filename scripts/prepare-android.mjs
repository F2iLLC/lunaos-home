import { readFile, writeFile, mkdir, readdir, copyFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const activityTemplate = await readFile(new URL('./android/MainActivity.kt', import.meta.url), 'utf8');
const generatedActivity = `package io.github.f2illc.lunaos.home.preview

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}`;
const normalized = text => text.replace(/\r\n/g, '\n').trim();
const initializationGuidance = 'Initialize Android first: npm run native:android -- init --ci --skip-targets-install';
export const vaultDebugManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.USE_BIOMETRIC" />
  <uses-permission android:name="android.permission.INTERNET" />
  <application>
    <activity android:name=".VaultActivity" android:exported="false" />
    <activity android:name="io.github.f2illc.lunaos.directtlsprobe.PairingActivity" android:exported="false" />
    <receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" tools:node="remove" />
  </application>
</manifest>
`;

export function insetActivity(source) {
  if (![generatedActivity, activityTemplate].some(expected => normalized(expected) === normalized(source))) {
    throw new Error('Unexpected Android activity. Preserve and review its changes before preparing this preview.');
  }
  return activityTemplate;
}

// The pinned Tauri CLI generates machine-specific Android files. Keep this
// narrow transformation reproducible instead of committing local SDK paths.
export function offlineManifest(xml, { softwareRendering = false } = {}) {
  if (typeof softwareRendering !== 'boolean') throw new Error('Unexpected Android rendering option.');
  // Generated projects survive branch changes. A separate feature's service
  // must not silently ship in this offline probe just because it is ignored.
  if (/<(?:service|receiver|activity-alias)\b/.test(xml)) {
    throw new Error('Unexpected Android component. Preserve and regenerate the Android project before building this offline preview.');
  }
  const activities = [...xml.matchAll(/<activity(?=\s|>)[^>]*>/g)]
    .map(match => match[0]).filter(tag => /\bandroid:name="\.MainActivity"/.test(tag));
  if ((xml.match(/<application\b/g) || []).length !== 1 || activities.length !== 1) {
    throw new Error('Unexpected Android template. Review it before building.');
  }
  const activity = activities[0];
  if ((xml.match(/<activity(?=\s|>)/g) || []).length !== 1) {
    throw new Error('Unexpected Android component: extra activity.');
  }
  const rendering = `android:hardwareAccelerated="${!softwareRendering}"`;
  const existingRendering = activity.match(/\bandroid:hardwareAccelerated="[^"]*"/g) || [];
  if (existingRendering.length > 1 || (activity.includes('android:hardwareAccelerated') &&
      (existingRendering.length !== 1 || !/^android:hardwareAccelerated="(?:true|false)"$/.test(existingRendering[0])))) {
    throw new Error('Unexpected Android rendering policy. Review it before building.');
  }
  // Set this before activity/WebView creation. Every build explicitly chooses
  // its mode, so an opt-in software build cannot contaminate a later normal one.
  xml = xml.replace(activity, existingRendering.length
    ? activity.replace(existingRendering[0], rendering)
    : activity.replace('<activity', `<activity ${rendering}`));
  xml = xml.replace(/\s*<uses-permission android:name="android\.permission\.INTERNET"\s*\/>/, '');
  if (/<uses-permission\b/.test(xml)) throw new Error('The offline preview must not request Android permissions.');
  return xml.replace(/<application\b[^>]*>/, tag => {
    if (!/android:usesCleartextTraffic="(?:\$\{usesCleartextTraffic\}|false)"/.test(tag)) {
      throw new Error('Unexpected Android network policy. Review it before building.');
    }
    tag = tag.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"');
    if (/android:allowBackup=/.test(tag)) {
      if (!tag.includes('android:allowBackup="false"')) throw new Error('Unexpected Android backup policy.');
    } else {
      tag = tag.replace('<application', '<application android:allowBackup="false"');
    }
    return tag;
  });
}

async function sourceInventory(root) {
  // Check ancestors before traversing or reading generated input. This is a
  // stale-tree safeguard, not protection against concurrent filesystem swaps.
  for (let path = root; ; path = dirname(path)) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Linked or invalid Android source ancestor.');
    if (dirname(path) === path) break;
  }
  const files = [];
  const rustRoot = resolve(root, '../../../..');
  const androidTargets = { 'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7-linux-androideabi',
    x86: 'i686-linux-android', x86_64: 'x86_64-linux-android' };
  async function walk(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        const jni = /^main\/jniLibs\/(arm64-v8a|armeabi-v7a|x86|x86_64)\/liblunaos_home_preview_lib\.so$/.exec(relative);
        const target = jni && await realpath(path);
        const expected = jni && ['debug', 'release'].map(profile =>
          join(rustRoot, 'target', androidTargets[jni[1]], profile, 'liblunaos_home_preview_lib.so'));
        if (!expected?.includes(target) || !(await lstat(target)).isFile())
          throw new Error('Linked Android source entry.');
        files.push(relative);
        continue;
      }
      if (info.isDirectory()) await walk(path, relative);
      else {
        if (!info.isFile() || info.nlink !== 1) throw new Error('Linked or invalid Android source file.');
        files.push(relative);
      }
    }
  }
  await walk(root);
  return files;
}

export async function prepareAndroid({
  projectRoot = fileURLToPath(new URL('../src-tauri/gen/android/', import.meta.url)),
  softwareRendering = false,
} = {}) {
  const sourceTree = resolve(projectRoot, 'app/src');
  let files;
  try { files = await sourceInventory(sourceTree); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(initializationGuidance);
  }
  // Reject aliases on every platform: Windows would resolve these names to the
  // canonical Gradle manifest even if the same tree is harmless on Linux.
  for (const file of files) {
    if (file.toLowerCase().endsWith('/androidmanifest.xml') &&
      !['main/AndroidManifest.xml', 'debug/AndroidManifest.xml'].includes(file)) {
      throw new Error('Unexpected variant manifest; preserve and regenerate before building.');
    }
  }
  const path = join(sourceTree, 'main/AndroidManifest.xml');
  const activityPath = join(sourceTree, 'main/java/io/github/f2illc/lunaos/home/preview/MainActivity.kt');
  const debugRoot = join(sourceTree, 'debug');
  const javaRoot = join(debugRoot, 'java/io/github/f2illc/lunaos/home/preview');
  const directJavaRoot = join(debugRoot, 'java/io/github/f2illc/lunaos/directtlsprobe');
  const sourceRoot = new URL('./android/vault/', import.meta.url);
  const sources = ['VaultService.java', 'VaultStore.java', 'VaultRollback.java', 'VaultActivity.java', 'HomeVaultPlugin.kt'];
  const directRoot = new URL('./android-direct-tls-probe/', import.meta.url);
  const directSources = ['PairingActivity.java', 'SyntheticTlsClient.java', 'NativeIdentity.java', 'FixtureConfig.java', 'HomeDirectEntry.java'];
  // Inventory traverses directories; planned file destinations need an explicit
  // type check so a later copy cannot fail after earlier files were replaced.
  for (const destination of [path, activityPath, join(debugRoot, 'AndroidManifest.xml'),
    ...sources.map(source => join(javaRoot, source)),
    ...directSources.map(source => join(directJavaRoot, source))]) {
    let info;
    try { info = await lstat(destination); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isFile() || info.nlink !== 1) throw new Error('Invalid generated file destination.');
  }
  let manifest;
  try { manifest = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(initializationGuidance);
  }
  // Validate both inputs before writing either generated file. Never overwrite
  // another feature's custom activity just because its directory is ignored.
  const activity = insetActivity(await readFile(activityPath, 'utf8'));
  const preparedManifest = offlineManifest(manifest, { softwareRendering });
  const generatedSources = ['Ipc.kt', 'Logger.kt', 'PermissionHelper.kt', 'Rust.kt', 'RustWebChromeClient.kt',
    'RustWebView.kt', 'RustWebViewClient.kt', 'TauriActivity.kt', 'WryActivity.kt'];
  // Inspect every source-set directory, including ABI, combined flavor/build
  // variants and future names; no fixed main/debug/release list can cover them.
  for (const relative of files) {
    const [variant, ...parts] = relative.split('/');
    const file = parts.join('/');
    const mainSource = variant === 'main' && (file === 'java/io/github/f2illc/lunaos/home/preview/MainActivity.kt' ||
      generatedSources.some(source => file === `java/io/github/f2illc/lunaos/home/preview/generated/${source}`));
    const debugVaultSource = variant === 'debug' && sources.some(source => file === `java/io/github/f2illc/lunaos/home/preview/${source}`);
    const debugDirectSource = variant === 'debug' && directSources.some(source => file === `java/io/github/f2illc/lunaos/directtlsprobe/${source}`);
    if (/\.(?:java|kt)$/i.test(file) && !mainSource &&
        !debugVaultSource && !debugDirectSource) {
      throw new Error('Unexpected generated Android source; preserve and regenerate before building.');
    }
    if (relative.endsWith('/AndroidManifest.xml') && relative !== 'main/AndroidManifest.xml') {
      if (relative !== 'debug/AndroidManifest.xml' || await readFile(join(sourceTree, relative), 'utf8') !== vaultDebugManifest)
        throw new Error('Unexpected variant manifest; preserve and regenerate before building.');
    }
  }
  await mkdir(javaRoot, { recursive: true });
  await mkdir(directJavaRoot, { recursive: true });
  for (const source of sources) await copyFile(new URL(source, sourceRoot), join(javaRoot, source));
  for (const source of directSources) await copyFile(new URL(source, directRoot), join(directJavaRoot, source));
  await writeFile(join(debugRoot, 'AndroidManifest.xml'), vaultDebugManifest);
  await writeFile(path, preparedManifest);
  await writeFile(activityPath, activity);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--software-rendering')) {
    throw new Error('Usage: node scripts/prepare-android.mjs [--software-rendering]');
  }
  const softwareRendering = args[0] === '--software-rendering';
  await prepareAndroid({ softwareRendering });
  console.log(`Prepared Android main manifest without permissions; debug adds USE_BIOMETRIC and INTERNET for non-exported fictional vault/connection screens. Cleartext and backup disabled; MainActivity hardware acceleration ${softwareRendering ? 'disabled' : 'enabled'}.`);
}
