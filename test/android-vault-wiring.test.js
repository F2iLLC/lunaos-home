import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { vaultDebugManifest } from '../scripts/prepare-android.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function assertLunaProbeGuard(rust) {
  // Rust command bodies end at a column-zero brace; nested blocks are indented.
  const command = rust.match(/^pub async fn open_luna_probe\b[^]*?^}/m)?.[0];
  assert.ok(command, 'open_luna_probe command must exist');
  assert.match(command, /if window.label\(\) != "main"\s*\{\s*return Err\(/);
  assert.match(command, /run_mobile_plugin_async::<\(\)>\("openLunaProbe", \(\)\)/);
  assert.ok(command.indexOf('if window.label()') < command.indexOf('run_mobile_plugin_async'),
    'main-window guard must precede the plugin call');
}

test('Luna guard assertion cannot borrow a guard or plugin call from a later command', () => {
  const guard = '    if window.label() != "main" {\n        return Err("Denied".into());\n    }';
  const call = '    state.0.run_mobile_plugin_async::<()>("openLunaProbe", ())';
  const command = body => `pub async fn open_luna_probe() {\n${body}\n}`;
  const later = `\npub async fn other_command() {\n${guard}\n${call}\n}`;
  assertLunaProbeGuard(command(`${guard}\n${call}`) + later);
  assert.throws(() => assertLunaProbeGuard(command(`${call}\n${guard}`) + later), assert.AssertionError);
  assert.throws(() => assertLunaProbeGuard(command(call) + later), assert.AssertionError);
  assert.throws(() => assertLunaProbeGuard(command(guard) + later), assert.AssertionError);
  assert.throws(() => assertLunaProbeGuard(later), assert.AssertionError);
});

test('Android grants only local main-window open, without remote or filesystem capabilities', async () => {
  const capability = await json('../src-tauri/capabilities/android-fictional-launch.json');
  assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(capability.platforms, ['android']);
  assert.deepEqual(capability.permissions, ['allow-open-fictional-vault', 'allow-open-luna-probe', 'allow-get-luna-snapshot']);
  const android = await json('../src-tauri/tauri.android.conf.json');
  assert.deepEqual(android.app.security.capabilities, ['android-fictional-launch']);
  assert.equal(android.app.withGlobalTauri, true);
  const defaults = await json('../src-tauri/tauri.conf.json');
  assert.deepEqual(defaults.app.security.capabilities, []);
  assert.equal(defaults.app.withGlobalTauri, false);
  assert.match(defaults.app.security.csp, /connect-src 'none'/);
  assert.match(vaultDebugManifest, /<activity android:name="\.VaultActivity" android:exported="false"\s*\/>/);
  assert.match(vaultDebugManifest, /<activity android:name="io\.github\.f2illc\.lunaos\.directtlsprobe\.PairingActivity" android:exported="false"\s*\/>/);
  assert.deepEqual([...vaultDebugManifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match => match[1]),
    ['android.permission.USE_BIOMETRIC', 'android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE', 'android.permission.ACCESS_LOCAL_NETWORK',
    'android.permission.BLUETOOTH_CONNECT', 'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS',
      'android.permission.REQUEST_OBSERVE_COMPANION_DEVICE_PRESENCE',
      'android.permission.REQUEST_COMPANION_START_FOREGROUND_SERVICES_FROM_BACKGROUND',
      'android.permission.REQUEST_COMPANION_RUN_IN_BACKGROUND', 'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']);
  assert.match(vaultDebugManifest, /<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" tools:node="remove"\s*\/>/);
  assert.match(vaultDebugManifest, /android:permission="android.permission.BIND_COMPANION_DEVICE_SERVICE"/);
  assert.match(vaultDebugManifest, /VehicleAudioService" android:exported="false"/);
  assert.match(vaultDebugManifest, /VehicleReceiver[\s\S]*android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED/);
  assert.doesNotMatch(vaultDebugManifest, /<activity-alias\b|ACCESS_FINE_LOCATION|FOREGROUND_SERVICE_MICROPHONE/);
  assert.match(vaultDebugManifest, /android.permission.RECORD_AUDIO/);
  assert.match(vaultDebugManifest, /VehicleConversationActivity" android:exported="false"/);
  assert.match(vaultDebugManifest, /<package android:name="io\.github\.f2illc\.lunaos\.home\.voiceprobe"\s*\/>/);
  const rust = await readFile(new URL('../src-tauri/src/android_vault.rs', import.meta.url), 'utf8');
  const plugin = await readFile(new URL('../scripts/android/vault/HomeVaultPlugin.kt', import.meta.url), 'utf8');
  assert.doesNotMatch(rust, /Some\("luna-probe"\)/);
  assertLunaProbeGuard(rust);
  const registration = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(registration, /#\[cfg\(all\(target_os = "android", debug_assertions\)\)\][\s\S]*android_vault::open_luna_probe/);
  assert.match(registration, /android_vault::get_luna_snapshot/);
  const manifest = await readFile(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  assert.match(manifest, /"get_luna_snapshot"/);
  const permission = await readFile(new URL('../src-tauri/permissions/autogenerated/open_luna_probe.toml', import.meta.url), 'utf8');
  assert.match(permission, /commands.allow = \["open_luna_probe"\]/);
  const snapshotPermission = await readFile(new URL('../src-tauri/permissions/autogenerated/get_luna_snapshot.toml', import.meta.url), 'utf8');
  assert.match(snapshotPermission, /commands.allow = \["get_luna_snapshot"\]/);
  assert.match(plugin, /fun openLunaProbe\(invoke: Invoke\)/);
  assert.match(plugin, /setClassName\([\s\S]*io\.github\.f2illc\.lunaos\.home\.voiceprobe\.VoiceProbe/);
  assert.doesNotMatch(plugin.match(/fun openLunaProbe\(invoke: Invoke\)[\s\S]*?\n    }/)?.[0] ?? '', /BackgroundWakeService|RECORD_AUDIO|startForegroundService/);
});

test('bundled launcher sends only open, disables while pending, and stays absent outside Android debug', async () => {
  for (const enabled of [false, true]) {
    const bundled = await build({
      entryPoints: ['src/native.js'], bundle: true, write: false, format: 'esm',
      define: { __ANDROID_VAULT_DEBUG__: String(enabled) },
      plugins: [{
        name: 'isolate-draft-ui',
        setup(builder) {
          builder.onResolve({ filter: /(?:offline-drafts|draft-client|app)\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const createOfflineDraftClient = () => ({}); export const useOfflineDraftClient = () => {};',
          }));
        },
      }],
    });
    const elements = new Map();
    const children = [];
    const document = {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { append: (...nodes) => children.push(...nodes) });
        return elements.get(selector);
      },
      createElement() {
        const local = new Map();
        return { setAttribute() {}, addEventListener(event, handler) { this[event] = handler; },
          querySelector(selector) {
            if (!local.has(selector)) local.set(selector, { addEventListener(event, handler) { this[event] = handler; } });
            return local.get(selector);
          } };
      },
    };
    const calls = [];
    let finish;
    const window = { __TAURI__: { core: { invoke: (...args) => {
      calls.push(args);
      return new Promise(resolve => { finish = resolve; });
    } } } };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('document', 'window', bundled.outputFiles[0].text)(document, window);
    if (!enabled) { assert.equal(children.length, 0); continue; }
    const [lunaLink, lunaScreen, button, status, prepare, open, directStatus] = children;
    assert.equal(lunaLink.href, '#luna');
    assert.equal(lunaScreen.id, 'luna');
    const lunaButton = lunaScreen.querySelector('#open-luna-demo');
    const lunaPending = lunaButton.click({ currentTarget: lunaButton });
    assert.deepEqual(calls, [['get_luna_snapshot'], ['open_luna_probe']]);
    assert.equal(lunaButton.disabled, true);
    finish(); await lunaPending;
    assert.equal(lunaButton.disabled, false);
    assert.match(lunaScreen.querySelector('#luna-demo-status').textContent, /local controls/);
    assert.ok(elements.has('#home-actions'));
    assert.equal(button.className, 'primary-button');
    const pending = button.click();
    assert.equal(button.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault']);
    finish();
    await pending;
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /Native screen requested/);
    const preparing = prepare.click();
    assert.equal(prepare.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault', { kind: 'prepare-direct' }]);
    finish(); await preparing;
    assert.equal(prepare.disabled, false);
    assert.match(directStatus.textContent, /identity prepared/);
    const opening = open.click();
    assert.equal(open.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault', { kind: 'open-direct' }]);
    finish(); await opening;
    assert.equal(open.disabled, false);
    assert.match(directStatus.textContent, /Native connection screen requested/);
    window.__TAURI__.core.invoke = () => Promise.reject(new Error('Private native diagnostic'));
    await lunaButton.click({ currentTarget: lunaButton });
    assert.equal(lunaButton.disabled, false);
    const lunaStatus = lunaScreen.querySelector('#luna-demo-status');
    assert.match(lunaStatus.textContent, /Could not open the voice demo/);
    assert.doesNotMatch(lunaStatus.textContent, /Install the separate demo.*first|Private native diagnostic|Voice demo opened/);
    window.__TAURI__.core.invoke = () => Promise.resolve();
    await lunaButton.click({ currentTarget: lunaButton });
    assert.equal(lunaButton.disabled, false);
    assert.match(lunaStatus.textContent, /Voice demo opened/);
    window.__TAURI__.core.invoke = () => Promise.reject(new Error('Private native diagnostic'));
    await button.click();
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /Unavailable/);
    assert.doesNotMatch(status.textContent, /Private native diagnostic/);
    await prepare.click(); await open.click();
    assert.match(directStatus.textContent, /unavailable/);
    assert.doesNotMatch(directStatus.textContent, /Private native diagnostic/);
  }
});
