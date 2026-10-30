import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { vaultDebugManifest } from '../scripts/prepare-android.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('Android grants only local main-window open, without remote or filesystem capabilities', async () => {
  const capability = await json('../src-tauri/capabilities/android-fictional-launch.json');
  assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(capability.platforms, ['android']);
  assert.deepEqual(capability.permissions, ['allow-open-fictional-vault']);
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
        return { setAttribute() {}, addEventListener(event, handler) { this[event] = handler; } };
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
    const [button, status, prepare, open, directStatus] = children;
    assert.ok(elements.has('#home-actions'));
    assert.equal(button.className, 'primary-button');
    const pending = button.click();
    assert.equal(button.disabled, true);
    assert.deepEqual(calls, [['open_fictional_vault']]);
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
    await button.click();
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /Unavailable/);
    assert.doesNotMatch(status.textContent, /Private native diagnostic/);
    await prepare.click(); await open.click();
    assert.match(directStatus.textContent, /unavailable/);
    assert.doesNotMatch(directStatus.textContent, /Private native diagnostic/);
  }
});
