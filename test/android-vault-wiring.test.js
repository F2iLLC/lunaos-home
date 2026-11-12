import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { vaultDebugManifest } from '../scripts/prepare-android.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function assertHomeLunaGuard(rust, name, operation) {
  // Rust command bodies end at a column-zero brace; nested blocks are indented.
  const command = rust.match(new RegExp(`^pub async fn ${name}\\b[^]*?^}`, 'm'))?.[0];
  assert.ok(command, `${name} command must exist`);
  assert.match(command, /if window.label\(\) != "main"\s*\{\s*return Err\(/);
  assert.ok(command.includes(`"${operation}"`), `${name} must call the ${operation} Home command`);
  assert.ok(command.indexOf('if window.label()') < command.indexOf('run_mobile_plugin_async'),
    'main-window guard must precede the plugin call');
}

test('Home Luna guard assertion cannot borrow a guard or plugin call from a later command', () => {
  const guard = '    if window.label() != "main" {\n        return Err("Denied".into());\n    }';
  const call = '    state.0.run_mobile_plugin_async::<()>("enableLunaWake", ())';
  const command = body => `pub async fn enable_luna_wake() {\n${body}\n}`;
  const later = `\npub async fn other_command() {\n${guard}\n${call}\n}`;
  assertHomeLunaGuard(command(`${guard}\n${call}`) + later, 'enable_luna_wake', 'enableLunaWake');
  assert.throws(() => assertHomeLunaGuard(command(`${call}\n${guard}`) + later, 'enable_luna_wake', 'enableLunaWake'), assert.AssertionError);
  assert.throws(() => assertHomeLunaGuard(command(call) + later, 'enable_luna_wake', 'enableLunaWake'), assert.AssertionError);
  assert.throws(() => assertHomeLunaGuard(command(guard) + later, 'enable_luna_wake', 'enableLunaWake'), assert.AssertionError);
  assert.throws(() => assertHomeLunaGuard(later, 'enable_luna_wake', 'enableLunaWake'), assert.AssertionError);
});

test('Android grants only local main-window Home commands, without remote or filesystem capabilities', async () => {
  const capability = await json('../src-tauri/capabilities/android-fictional-launch.json');
  assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(capability.platforms, ['android']);
  assert.deepEqual(capability.permissions, ['allow-open-fictional-vault', 'allow-get-luna-snapshot', 'allow-notebook-request', 'allow-enable-luna-wake',
    'allow-request-luna-microphone', 'allow-disable-luna-wake', 'allow-set-luna-online-answers', 'allow-set-luna-voice', 'allow-preview-luna-voice', 'allow-cancel-luna-timer']);
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
      'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.WAKE_LOCK',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']);
  assert.match(vaultDebugManifest, /<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" tools:node="remove"\s*\/>/);
  assert.match(vaultDebugManifest, /android:permission="android.permission.BIND_COMPANION_DEVICE_SERVICE"/);
  assert.match(vaultDebugManifest, /VehicleAudioService" android:exported="false"/);
  assert.match(vaultDebugManifest, /VehicleReceiver[\s\S]*android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED/);
  assert.doesNotMatch(vaultDebugManifest, /<activity-alias\b|ACCESS_FINE_LOCATION/);
  assert.match(vaultDebugManifest, /android.permission.RECORD_AUDIO/);
  assert.match(vaultDebugManifest, /VehicleConversationActivity" android:exported="false"/);
  assert.match(vaultDebugManifest, /service android:name="io\.github\.f2illc\.lunaos\.home\.voiceprobe\.BackgroundWakeService"[^>]*foregroundServiceType="microphone"/);
  assert.match(vaultDebugManifest, /service android:name="io\.github\.f2illc\.lunaos\.home\.voiceprobe\.TimerAlarmService"/);
  assert.doesNotMatch(vaultDebugManifest, /<package android:name="io\.github\.f2illc\.lunaos\.home\.voiceprobe"/);
  const rust = await readFile(new URL('../src-tauri/src/android_vault.rs', import.meta.url), 'utf8');
  // Tauri deserializes and reserializes this struct: absent fields are silently
  // dropped even when Java sends them and the frontend tests provide them.
  const snapshot = rust.match(/pub struct LunaSnapshot \{([\s\S]*?)\n\}/)[1];
  assert.match(snapshot, /pub notebook_list_id: Option<String>/);
  assert.match(snapshot, /pub notebook_event: Option<u64>/);
  assert.match(snapshot, /pub last_heard: Option<String>/);
  assert.match(snapshot, /pub reply_caption: Option<String>/);
  const plugin = await readFile(new URL('../scripts/android/vault/HomeVaultPlugin.kt', import.meta.url), 'utf8');
  assert.match(rust, /pub async fn enable_luna_wake/);
  assert.match(rust, /pub async fn request_luna_microphone/);
  assertHomeLunaGuard(rust, 'enable_luna_wake', 'enableLunaWake');
  const registration = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(registration, /#\[cfg\(all\(target_os = "android", debug_assertions\)\)\][\s\S]*android_vault::enable_luna_wake/);
  assert.match(registration, /android_vault::get_luna_snapshot/);
  const manifest = await readFile(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  for (const command of ['get_luna_snapshot', 'enable_luna_wake', 'request_luna_microphone', 'disable_luna_wake', 'cancel_luna_timer'])
    assert.match(manifest, new RegExp(`"${command}"`));
  const permission = await readFile(new URL('../src-tauri/permissions/autogenerated/enable_luna_wake.toml', import.meta.url), 'utf8');
  assert.match(permission, /commands.allow = \["enable_luna_wake"\]/);
  const snapshotPermission = await readFile(new URL('../src-tauri/permissions/autogenerated/get_luna_snapshot.toml', import.meta.url), 'utf8');
  assert.match(snapshotPermission, /commands.allow = \["get_luna_snapshot"\]/);
  assert.match(plugin, /fun enableLunaWake\(invoke: Invoke\)/);
  assert.match(plugin, /invoke\.parseArgs\(LunaTimerArgs::class\.java\)/);
  assert.doesNotMatch(plugin, /openLunaProbe|VoiceProbe/);
});

test('finalized native voice transcripts reach Home after local timer commands and online questions', async () => {
  const service = await readFile(new URL('../scripts/android-offline-voice-probe/BackgroundWakeService.java', import.meta.url), 'utf8');
  const finishedAt = service.indexOf('@Override public void finished(String code, String text, int seconds, long deadline, boolean canceled)');
  assert.notEqual(finishedAt, -1);
  const finishedEnd = service.indexOf('            });', finishedAt);
  const finished = service.slice(finishedAt, finishedEnd);
  assert.ok(finished.includes('if (!blocked && !canceled && SystemClock.elapsedRealtime() < deadline && hasFinalTranscript)'));
  assert.ok(finished.includes('QuestionPolicy.lastHeard = text.trim();'));
  assert.ok(finished.indexOf('QuestionPolicy.lastHeard = text.trim();') < finished.indexOf('TimerCommand.valid(seconds)'),
    'the finalized transcript is retained before either command path handles it');
  const bridge = await readFile(new URL('../scripts/android-offline-voice-probe/HomeLunaBridge.java', import.meta.url), 'utf8');
  assert.ok(bridge.includes('out.put("lastHeard", "off".equals(phase) ? "" : QuestionPolicy.lastHeard);'));
});

test('bundled Home Luna controls are Android-debug-only and call only Home state commands', async () => {
  for (const enabled of [false, true]) {
    const bundled = await build({
      entryPoints: ['src/native.js'], bundle: true, write: false, format: 'esm',
      define: { __ANDROID_VAULT_DEBUG__: String(enabled) },
      plugins: [{
        name: 'isolate-draft-ui',
        setup(builder) {
          builder.onResolve({ filter: /(?:offline-drafts|draft-client|app|notebook)\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const createOfflineDraftClient = () => ({}); export const useOfflineDraftClient = () => {};',
          }));
        },
      }],
    });
    const elements = new Map();
    const children = [];
    let document;
    const svg = () => ({ dataset: {}, style: {}, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, getAttribute(name) { return this.attrs[name] ?? null; } });
    const host = () => ({ ownerDocument: document, hidden: true, dataset: {}, addEventListener() {}, append() {}, replaceWith(node) { this.replacement = node; },
      set innerHTML(value) { this.markup = value; }, querySelector() { this.svg ??= svg(); return this.svg; } });
    document = {
      body: { append() {} },
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { ...host(), append: (...nodes) => children.push(...nodes), setAttribute() {}, replaceChildren() {} });
        return elements.get(selector);
      },
      addEventListener() {}, removeEventListener() {},
      createElement() {
        const local = new Map();
        const element = { ownerDocument: document, dataset: {}, style: {}, after() {}, close() {}, showModal() {}, setAttribute() {}, addEventListener(event, handler) { this[event] = handler; }, append() {}, replaceChildren() {},
          querySelector(selector) {
            if (!local.has(selector)) local.set(selector, { dataset: {}, addEventListener(event, handler) { this[event] = handler; }, setAttribute() {}, append() {}, replaceChildren() {} });
            return local.get(selector);
          } };
        return element;
      },
    };
    const calls = [];
    const window = { __TAURI__: { core: { invoke: (...args) => {
      calls.push(args);
      return Promise.resolve(args[0] === 'get_luna_snapshot' ? {
        status: 'unavailable', reason: 'mac_speech_unavailable', capturePhase: 'off',
        microphoneInUse: false, onlineAnswersEnabled: false, activeTimers: [],
      } : undefined);
    } } } };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('document', 'window', bundled.outputFiles[0].text)(document, window);
    if (!enabled) { assert.equal(children.length, 0); continue; }
    const [settingsGear, lunaScreen, button, status, prepare, open, directStatus] = children;
    assert.equal(settingsGear.href, '#luna');
    assert.equal(settingsGear.className, 'settings-gear');
    assert.equal(lunaScreen.id, 'luna');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(lunaScreen.querySelector('#luna-state').textContent, /Mac speech recognition unavailable/);
    const allowMic = lunaScreen.querySelector('#allow-luna-mic');
    await allowMic.click({ currentTarget: allowMic });
    assert.ok(calls.some(([command]) => command === 'request_luna_microphone'));
    const enable = lunaScreen.querySelector('#enable-luna-wake');
    await enable.click({ currentTarget: enable });
    assert.ok(calls.some(([command]) => command === 'enable_luna_wake'));
    const disable = lunaScreen.querySelector('#disable-luna-wake');
    await disable.click({ currentTarget: disable });
    assert.ok(calls.some(([command]) => command === 'disable_luna_wake'));
    assert.deepEqual(calls.filter(([command]) => command === 'request_luna_microphone' ||
      command === 'enable_luna_wake' || command === 'disable_luna_wake').map(([command]) => command),
      ['request_luna_microphone', 'enable_luna_wake', 'disable_luna_wake']);
    assert.ok(elements.has('#home-actions'));
    assert.equal(button.className, 'primary-button');
    const pending = button.click();
    assert.equal(button.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault']);
    await pending;
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /Native screen requested/);
    const preparing = prepare.click();
    assert.equal(prepare.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault', { kind: 'prepare-direct' }]);
    await preparing;
    assert.equal(prepare.disabled, false);
    assert.match(directStatus.textContent, /identity prepared/);
    const opening = open.click();
    assert.equal(open.disabled, true);
    assert.deepEqual(calls.at(-1), ['open_fictional_vault', { kind: 'open-direct' }]);
    await opening;
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
