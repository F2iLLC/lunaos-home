import test from 'node:test';
import assert from 'node:assert/strict';
import { createLunaVoiceSettings } from '../src/luna-voice-settings.js';
function fixture(invoke) {
  const group = { replaceChildren(...buttons) { this.buttons = buttons; } }, status = {};
  const settings = createLunaVoiceSettings(group, status, { invoke, document: { createElement: () => ({
    addEventListener(_, fn) { this.click = fn; }, setAttribute(k, v) { this[k] = v; },
  }) } });
  return { group, status, settings };
}
const snapshot = { selectedVoice: 'lori', voices: [{ id: 'lori', label: 'Lori' }, { id: 'original', label: 'Original' }] };
test('voice buttons save then preview, can replay, and remain stable during a save', async () => {
  let finish; const calls = [];
  const { group, status, settings } = fixture((...args) => {
    calls.push(args); return args[0] === 'set_luna_voice' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
  });
  settings.update(snapshot);
  const [lori, original] = group.buttons;
  assert.equal(lori['aria-pressed'], 'true'); assert.equal(original['aria-pressed'], 'false');
  assert.deepEqual(group.buttons.map(b => b.textContent), ['Lori', 'Original']);
  const saving = original.click(); assert.equal(lori.disabled, true);
  await lori.click(); settings.update(snapshot);
  finish(); await saving;
  assert.equal(original['aria-pressed'], 'true'); assert.equal(original.disabled, false);
  assert.deepEqual(calls, [['set_luna_voice', { voice: 'original' }], ['preview_luna_voice', { voice: 'original' }]]);
  assert.match(status.textContent, /Original selected/);
  const replay = original.click(); finish(); await replay;
  assert.equal(calls.filter(c => c[0] === 'preview_luna_voice').length, 2);
});
test('save failure rolls back without preview; preview failure retains the saved voice', async () => {
  let failSave = true; const calls = [];
  const { group, status, settings } = fixture(async command => { calls.push(command); if (failSave || command === 'preview_luna_voice') throw Error(); });
  settings.update(snapshot); await group.buttons[1].click();
  assert.equal(group.buttons[0]['aria-pressed'], 'true'); assert.deepEqual(calls, ['set_luna_voice']);
  assert.match(status.textContent, /Could not save/);
  failSave = false; await group.buttons[1].click();
  assert.equal(group.buttons[1]['aria-pressed'], 'true'); assert.match(status.textContent, /is saved, but the preview/);
  settings.unavailable(); assert.ok(group.buttons.every(b => b.disabled));
  settings.update({ ...snapshot, voices: [snapshot.voices[0]] }); assert.equal(group.buttons[0].disabled, false);
  settings.update({ voices: [] }); assert.equal(group.buttons.length, 0); assert.match(status.textContent, /No voice packs/);
});
test('a superseded preview cannot overwrite the newer selection or its status', async () => {
  const previews = [];
  const { group, status, settings } = fixture(command => command === 'preview_luna_voice' ? new Promise((resolve, reject) => previews.push({ resolve, reject })) : Promise.resolve());
  settings.update(snapshot);
  const first = group.buttons[1].click(); await Promise.resolve();
  const second = group.buttons[0].click(); await Promise.resolve();
  previews[1].resolve(); await second;
  previews[0].reject(Error()); await first;
  assert.equal(group.buttons[0]['aria-pressed'], 'true'); assert.match(status.textContent, /Lori selected/);
});
