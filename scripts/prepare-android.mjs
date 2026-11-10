import { readFile, writeFile, mkdir, readdir, copyFile, lstat, readlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

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
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK" />
  <uses-feature android:name="android.software.companion_device_setup" android:required="false" />
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.REQUEST_OBSERVE_COMPANION_DEVICE_PRESENCE" />
  <uses-permission android:name="android.permission.REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND" />
  <uses-permission android:name="android.permission.REQUEST_COMPANION_RUN_IN_BACKGROUND" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
  <queries><intent><action android:name="android.intent.action.TTS_SERVICE" /></intent><intent><action android:name="android.speech.RecognitionService" /></intent></queries>
  <application>
    <activity android:name="io.github.f2illc.lunaos.home.vehicle.VehicleSetupActivity" android:exported="false" />
    <activity android:name="io.github.f2illc.lunaos.home.vehicle.VehicleConversationActivity" android:exported="false" />
    <service android:name="io.github.f2illc.lunaos.home.vehicle.VehicleAudioService" android:exported="false" android:foregroundServiceType="connectedDevice|mediaPlayback" />
    <service android:name="io.github.f2illc.lunaos.home.voiceprobe.BackgroundWakeService" android:exported="false" android:foregroundServiceType="microphone" />
    <service android:name="io.github.f2illc.lunaos.home.voiceprobe.TimerAlarmService" android:exported="false" android:foregroundServiceType="mediaPlayback" />
    <receiver android:name="io.github.f2illc.lunaos.home.voiceprobe.TimerReceiver" android:exported="false"><intent-filter><action android:name="android.intent.action.TIME_SET" /></intent-filter></receiver>
    <service android:name="io.github.f2illc.lunaos.home.vehicle.VehiclePresence" android:exported="true" android:permission="android.permission.BIND_COMPANION_DEVICE_SERVICE">
      <intent-filter><action android:name="android.companion.CompanionDeviceService" /></intent-filter>
    </service>
    <receiver android:name="io.github.f2illc.lunaos.home.vehicle.VehicleReceiver" android:exported="true">
      <intent-filter><action android:name="android.bluetooth.device.action.ACL_CONNECTED" /><action android:name="android.bluetooth.device.action.ACL_DISCONNECTED" /><action android:name="android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED" /></intent-filter>
    </receiver>
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
        const target = jni && resolve(dirname(path), await readlink(path));
        const expected = jni && ['debug', 'release'].map(profile =>
          join(rustRoot, 'target', androidTargets[jni[1]], profile, 'liblunaos_home_preview_lib.so'));
        if (!expected?.includes(target)) throw new Error('Linked Android source entry.');
        // Cargo clean leaves this exact generated link dangling until the
        // before-build hook completes. Existing targets and ancestors must
        // still be ordinary, singly linked files/directories.
        for (let ancestor = dirname(target); ancestor !== rustRoot; ancestor = dirname(ancestor)) {
          let parent;
          try { parent = await lstat(ancestor); }
          catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Linked Android source entry.');
        }
        let built;
        try { built = await lstat(target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (built) {
          if (!built.isFile()) throw new Error('Linked Android source entry.');
          if (built.nlink !== 1) {
            // Cargo can hard-link its final output to its own deps artifact.
            // Accept exactly that pair, never an additional outside link.
            const companion = join(dirname(target), 'deps', basename(target));
            let cargo, deps;
            try { deps = await lstat(dirname(companion)); cargo = await lstat(companion); } catch { /* reject below */ }
            if (built.nlink !== 2 || !deps?.isDirectory() || deps.isSymbolicLink() ||
                !cargo?.isFile() || cargo.isSymbolicLink() ||
                cargo.nlink !== 2 || cargo.dev !== built.dev || cargo.ino !== built.ino)
              throw new Error('Linked Android source entry.');
          }
        }
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
  const vehicleJavaRoot = join(debugRoot, 'java/io/github/f2illc/lunaos/home/vehicle');
  const voiceJavaRoot = join(debugRoot, 'java/io/github/f2illc/lunaos/home/voiceprobe');
  const voiceAssetRoot = join(debugRoot, 'assets/model');
  const vehicleRoot = new URL('./android/vehicle/', import.meta.url);
  const vehicleSources = ['VehicleTrip.java', 'VehicleState.java', 'VehicleRuntime.java', 'VehicleReceiver.java', 'VehiclePresence.java', 'VehicleAudioService.java', 'VehicleSetupActivity.java', 'VehicleLeadIn.java', 'VehicleGreetings.java', 'VehiclePlaybackGate.java', 'VehicleVoiceCache.java', 'VehicleConversationActivity.java', 'VehicleReplyPlayer.java', 'VehicleLatency.java', 'VehiclePassengers.java', 'VehiclePassengerState.java', 'VehiclePassengerSetup.java'];
  const voiceSources = ['BackgroundWakeService.java', 'CommandAudio.java', 'HomeLunaBridge.java', 'LunaFace.java', 'NativeTimers.java', 'PendingTimerRequest.java', 'ProbeCapture.java', 'PromptPlayer.java', 'QuestionPolicy.java', 'QuestionReply.java', 'ReplyPlan.java', 'SpokenReply.java', 'TimerAlarmService.java', 'TimerCommand.java', 'TimerHandoffGate.java', 'TimerLedger.java', 'TimerPhrase.java', 'TimerReceiver.java', 'WakeSession.java'];
  const sourceRoot = new URL('./android/vault/', import.meta.url);
  const sources = ['VaultService.java', 'VaultStore.java', 'VaultRollback.java', 'VaultActivity.java', 'HomeVaultPlugin.kt'];
  const directRoot = new URL('./android-direct-tls-probe/', import.meta.url);
  const directSources = ['PairingActivity.java', 'SyntheticTlsClient.java', 'VersionedEditState.java', 'NativeIdentity.java', 'FixtureConfig.java', 'HomeDirectEntry.java', 'PhoneHostServer.java', 'VehicleTransport.java', 'VehicleConversationClient.java'];
  // Inventory traverses directories; planned file destinations need an explicit
  // type check so a later copy cannot fail after earlier files were replaced.
  for (const destination of [path, activityPath, join(debugRoot, 'AndroidManifest.xml'),
    ...sources.map(source => join(javaRoot, source)),
    ...vehicleSources.map(source => join(vehicleJavaRoot, source)),
    ...voiceSources.map(source => join(voiceJavaRoot, source)),
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
  const appRoot = dirname(sourceTree);
  let gradlePath;
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const candidate = join(appRoot, name);
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Invalid generated Android Gradle file.');
      gradlePath = candidate; break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!gradlePath) throw new Error(initializationGuidance);
  let gradle = await readFile(gradlePath, 'utf8');
  const dependencyMarker = '// HOME_LUNA_DEBUG_VOICE_DEPENDENCIES';
  const voiceDependencies = `${dependencyMarker}\n    debugImplementation("com.alphacephei:vosk-android:0.3.75")\n    debugImplementation("net.java.dev.jna:jna:5.18.1@aar")`;
  if (gradle.includes(dependencyMarker)) {
    if (!gradle.includes(voiceDependencies)) throw new Error('Unexpected Luna voice dependency block. Regenerate and review the Android project.');
  } else {
    const dependenciesBlock = /\bdependencies\s*\{/;
    if (!dependenciesBlock.test(gradle)) throw new Error('Android Gradle dependencies block unavailable.');
    gradle = gradle.replace(dependenciesBlock, match => `${match}\n${voiceDependencies}`);
  }
  const configuredModel = process.env.LUNA_HOME_VOICE_MODEL_DIRECTORY;
  const staleModelAssets = files.some(file => file.startsWith('debug/assets/model/'));
  const modelFiles = [];
  if (configuredModel) {
    const modelRoot = resolve(configuredModel);
    for (let ancestor = modelRoot; ; ancestor = dirname(ancestor)) {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Luna model path must use ordinary directories, not links.');
      if (dirname(ancestor) === ancestor) break;
    }
    const modelPath = async (relative = '') => {
      const directory = join(modelRoot, relative);
      for (const entry of await readdir(directory)) {
        const child = relative ? `${relative}/${entry}` : entry;
        const full = join(modelRoot, child);
        const info = await lstat(full);
        if (info.isSymbolicLink()) throw new Error('Luna model contains a linked entry.');
        if (info.isDirectory()) await modelPath(child);
        else if (!info.isFile() || info.nlink !== 1) throw new Error('Luna model contains an invalid file.');
        else modelFiles.push([full, child]);
      }
    };
    await modelPath();
    if (!modelFiles.some(([, file]) => file === 'am/final.mdl') || !modelFiles.some(([, file]) => file === 'conf/model.conf'))
      throw new Error('LUNA_HOME_VOICE_MODEL_DIRECTORY must contain the Vosk model root with am/final.mdl and conf/model.conf.');
    if (staleModelAssets) {
      const existing = files.filter(file => file.startsWith('debug/assets/model/')).map(file => file.slice('debug/assets/model/'.length)).sort();
      const expected = modelFiles.map(([, file]) => file).sort();
      if (existing.length !== expected.length || existing.some((file, index) => file !== expected[index]))
        throw new Error('Existing generated Luna model assets differ from the configured model. Regenerate Android before changing model input.');
      for (const [source, relative] of modelFiles) {
        const current = await readFile(join(voiceAssetRoot, relative));
        const input = await readFile(source);
        if (createHash('sha256').update(current).digest('hex') !== createHash('sha256').update(input).digest('hex'))
          throw new Error('Existing generated Luna model assets differ from the configured model. Regenerate Android before changing model input.');
      }
    }
  } else if (staleModelAssets) {
    throw new Error('Luna model assets remain in the generated project but LUNA_HOME_VOICE_MODEL_DIRECTORY is unset.');
  }
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
    const debugVehicleSource = variant === 'debug' && vehicleSources.some(source => file === `java/io/github/f2illc/lunaos/home/vehicle/${source}`);
    const debugVoiceSource = variant === 'debug' && voiceSources.some(source => file === `java/io/github/f2illc/lunaos/home/voiceprobe/${source}`);
    if (/\.(?:java|kt)$/i.test(file) && !mainSource &&
        !debugVaultSource && !debugDirectSource && !debugVehicleSource && !debugVoiceSource) {
      throw new Error('Unexpected generated Android source; preserve and regenerate before building.');
    }
    if (relative.endsWith('/AndroidManifest.xml') && relative !== 'main/AndroidManifest.xml') {
      if (relative !== 'debug/AndroidManifest.xml' || await readFile(join(sourceTree, relative), 'utf8') !== vaultDebugManifest)
        throw new Error('Unexpected variant manifest; preserve and regenerate before building.');
    }
  }
  await mkdir(javaRoot, { recursive: true });
  await mkdir(directJavaRoot, { recursive: true });
  await mkdir(vehicleJavaRoot, { recursive: true });
  await mkdir(voiceJavaRoot, { recursive: true });
  for (const source of vehicleSources) await copyFile(new URL(source, vehicleRoot), join(vehicleJavaRoot, source));
  for (const source of sources) await copyFile(new URL(source, sourceRoot), join(javaRoot, source));
  for (const source of directSources) await copyFile(new URL(source, directRoot), join(directJavaRoot, source));
  const voiceRoot = new URL('./android-offline-voice-probe/', import.meta.url);
  for (const source of voiceSources) {
    const destination = join(voiceJavaRoot, source);
    await copyFile(source === 'QuestionReply.java'
      ? new URL('./android/voice/HomeQuestionReply.java', import.meta.url)
      : new URL(source, voiceRoot), destination);
    if (source === 'NativeTimers.java' || source === 'BackgroundWakeService.java') {
      const original = await readFile(destination, 'utf8');
      const homeVersion = original.replaceAll('new Intent(c, VoiceProbe.class)',
        'new Intent().setClassName(c, "io.github.f2illc.lunaos.home.preview.MainActivity")')
        .replaceAll('new Intent(this, VoiceProbe.class)',
          'new Intent().setClassName(this, "io.github.f2illc.lunaos.home.preview.MainActivity")');
      if (homeVersion === original) throw new Error(`Home navigation target missing from ${source}.`);
      await writeFile(destination, homeVersion);
    }
  }
  if (modelFiles.length && !staleModelAssets) {
    await mkdir(voiceAssetRoot, { recursive: true });
    for (const [source, relative] of modelFiles) {
      const destination = join(voiceAssetRoot, relative);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
  }
  await writeFile(join(debugRoot, 'AndroidManifest.xml'), vaultDebugManifest);
  await writeFile(path, preparedManifest);
  await writeFile(activityPath, activity);
  await writeFile(gradlePath, gradle);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--software-rendering')) {
    throw new Error('Usage: node scripts/prepare-android.mjs [--software-rendering]');
  }
  const softwareRendering = args[0] === '--software-rendering';
  await prepareAndroid({ softwareRendering });
  console.log(`Prepared Android Home; debug includes local Luna wake/timer ownership and requires LUNA_HOME_VOICE_MODEL_DIRECTORY for listening. Cleartext and backup disabled; MainActivity hardware acceleration ${softwareRendering ? 'disabled' : 'enabled'}.`);
}
