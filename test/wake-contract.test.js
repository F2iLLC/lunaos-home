import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeSnapshot, MAX_PREWAKE_BUFFER_MS, reduceWakeState, wakeDataPathPolicy } from '../lib/wake-contract.js';

const step = (snapshot, event) => reduceWakeState(snapshot, event);
function optedIn() {
  let snapshot = createWakeSnapshot();
  snapshot = step(snapshot, { type: 'MICROPHONE_PERMISSION_GRANTED' }).snapshot;
  snapshot = step(snapshot, { type: 'LOCAL_LISTEN_CONSENT_GRANTED' }).snapshot;
  return snapshot;
}
function listening() {
  return step(optedIn(), { type: 'WAKE_DETECTED', eventId: 'wake-fixture-1' }).snapshot;
}
test('waiting requires local opt-in plus observed OS permission and has a bounded local-only path', () => {
  const initial = createWakeSnapshot();
  assert.deepEqual(wakeDataPathPolicy(initial), { microphone: 'off', network: 'none', destination: null,
    preWakeBufferMaxMs: 0, persistentAudio: false, telemetry: false });
  const noPermission = step(initial, { type: 'LOCAL_LISTEN_CONSENT_GRANTED' });
  assert.equal(noPermission.snapshot.state, 'unavailable');
  assert.equal(wakeDataPathPolicy(noPermission.snapshot).microphone, 'off');
  const waiting = optedIn();
  assert.equal(waiting.state, 'waiting-for-wake');
  assert.deepEqual(wakeDataPathPolicy(waiting), { microphone: 'local-wake-detection', network: 'none', destination: null,
    preWakeBufferMaxMs: MAX_PREWAKE_BUFFER_MS, persistentAudio: false, telemetry: false });
  assert.equal(MAX_PREWAKE_BUFFER_MS, 2000); // proposed ceiling only; no audio adapter is connected
});

test('a wake opens one synthetic command capture; duplicate wake and stale callbacks are ignored', () => {
  const waiting = optedIn();
  const opened = step(waiting, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-1' });
  assert.equal(opened.snapshot.state, 'listening-to-command');
  assert.deepEqual(opened.effects.map(effect => effect.type), ['STOP_LOCAL_DETECTOR', 'START_COMMAND_CAPTURE']);
  assert.deepEqual(wakeDataPathPolicy(opened.snapshot), { microphone: 'local-command-capture', network: 'none', destination: null,
    preWakeBufferMaxMs: 0, persistentAudio: false, telemetry: false });
  const duplicate = step(opened.snapshot, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-1' });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.snapshot.generation, opened.snapshot.generation);
  assert.equal(step(opened.snapshot, { type: 'COMMAND_CAPTURED', generation: opened.snapshot.generation - 1, fields: ['spoken-command'] }).accepted, false);
});

test('post-wake content remains local until one-shot destination and field consent is approved', () => {
  const active = listening();
  const pending = step(active, { type: 'COMMAND_CAPTURED', generation: active.generation, fields: ['spoken-command'] });
  assert.equal(pending.snapshot.state, 'processing');
  assert.deepEqual(pending.effects.at(-1), { type: 'PROMPT_FOR_POST_WAKE_DISCLOSURE', generation: active.generation, fields: ['spoken-command'] });
  assert.equal(wakeDataPathPolicy(pending.snapshot).network, 'none');
  const selected = step(pending.snapshot, { type: 'POST_WAKE_DESTINATION_SELECTED', generation: active.generation, destination: 'assistant-choice' });
  assert.equal(step(selected.snapshot, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: active.generation,
    destination: 'other-assistant', fields: ['spoken-command'] }).accepted, false);
  assert.equal(step(selected.snapshot, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: active.generation,
    destination: 'assistant-choice', fields: ['spoken-command', 'vault'] }).accepted, false);
  const approved = step(selected.snapshot, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: active.generation,
    destination: 'assistant-choice', fields: ['spoken-command'] });
  assert.deepEqual(approved.effects, [{ type: 'FORWARD_SELECTED_CONTENT', destination: 'assistant-choice',
    purpose: 'respond-to-this-command', fields: ['spoken-command'], generation: active.generation }]);
  assert.deepEqual(wakeDataPathPolicy(approved.snapshot), { microphone: 'off', network: 'approved-selected-fields-only',
    destination: 'assistant-choice', preWakeBufferMaxMs: 0, persistentAudio: false, telemetry: false });
  const response = step(approved.snapshot, { type: 'RESPONSE_READY', generation: active.generation });
  assert.equal(response.snapshot.state, 'speaking');
  assert.equal(wakeDataPathPolicy(response.snapshot).microphone, 'off');
  assert.equal(wakeDataPathPolicy(response.snapshot).network, 'approved-selected-fields-only');
  assert.equal(step(approved.snapshot, { type: 'RESPONSE_READY', generation: active.generation - 1 }).accepted, false);
});

test('silence and cancel clear transient input and invalidate late results', () => {
  const active = listening();
  const ended = step(active, { type: 'SILENCE_TIMEOUT', generation: active.generation });
  assert.equal(ended.snapshot.state, 'waiting-for-wake');
  assert.ok(ended.effects.some(effect => effect.type === 'CLEAR_TRANSIENT_AUDIO'));
  assert.equal(step(ended.snapshot, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-1' }).accepted, false);
  const later = step(ended.snapshot, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-2' }).snapshot;
  const laterEnded = step(later, { type: 'SILENCE_TIMEOUT', generation: later.generation }).snapshot;
  assert.equal(step(laterEnded, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-1' }).accepted, false);
  const pending = step(active, { type: 'COMMAND_CAPTURED', generation: active.generation, fields: ['spoken-command'] }).snapshot;
  const cancelled = step(pending, { type: 'CANCEL' });
  assert.equal(cancelled.snapshot.state, 'waiting-for-wake');
  assert.equal(step(cancelled.snapshot, { type: 'RESPONSE_READY', generation: pending.generation }).accepted, false);

  const prompt1 = step(active, { type: 'COMMAND_CAPTURED', generation: active.generation, fields: ['spoken-command'] }).snapshot;
  const cancelled1 = step(prompt1, { type: 'CANCEL' }).snapshot;
  const generation3 = step(cancelled1, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-2' }).snapshot;
  const prompt3 = step(generation3, { type: 'COMMAND_CAPTURED', generation: generation3.generation, fields: ['spoken-command'] }).snapshot;
  assert.equal(generation3.generation, 3);
  assert.equal(step(prompt3, { type: 'POST_WAKE_DESTINATION_SELECTED', generation: prompt1.generation,
    destination: 'assistant-choice' }).accepted, false);
  const selected3 = step(prompt3, { type: 'POST_WAKE_DESTINATION_SELECTED', generation: generation3.generation,
    destination: 'assistant-choice' }).snapshot;
  const delayedApproval = step(selected3, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: prompt1.generation,
    destination: 'assistant-choice', fields: ['spoken-command'] });
  assert.equal(delayedApproval.accepted, false);
  assert.equal(delayedApproval.effects.some(effect => effect.type === 'FORWARD_SELECTED_CONTENT'), false);
});

test('security lock forces mute; unlocking never restarts the microphone without a new action', () => {
  const active = listening();
  const locked = step(active, { type: 'SECURITY_LOCK' });
  assert.equal(locked.snapshot.state, 'muted');
  assert.equal(wakeDataPathPolicy(locked.snapshot).microphone, 'off');
  assert.equal(wakeDataPathPolicy(locked.snapshot).network, 'none');
  const unlocked = step(locked.snapshot, { type: 'SECURITY_UNLOCK' });
  assert.equal(unlocked.snapshot.state, 'muted');
  assert.equal(unlocked.effects.length, 0);
  const resumed = step(unlocked.snapshot, { type: 'UNMUTE' });
  assert.equal(resumed.snapshot.state, 'waiting-for-wake');
});

test('local-consent revocation, OS permission loss and host failure fail closed', () => {
  const revoked = step(optedIn(), { type: 'LOCAL_LISTEN_CONSENT_REVOKED' });
  assert.equal(revoked.snapshot.state, 'disabled');
  assert.equal(wakeDataPathPolicy(revoked.snapshot).microphone, 'off');
  const permissionLost = step(optedIn(), { type: 'MICROPHONE_PERMISSION_REVOKED' });
  assert.equal(permissionLost.snapshot.state, 'unavailable');
  assert.equal(wakeDataPathPolicy(permissionLost.snapshot).network, 'none');
  assert.equal(step(permissionLost.snapshot, { type: 'MICROPHONE_PERMISSION_GRANTED' }).snapshot.state, 'muted');
  const hostDown = step(optedIn(), { type: 'HOST_UNAVAILABLE' }).snapshot;
  assert.equal(hostDown.state, 'unavailable');
  const permissionRevoked = step(hostDown, { type: 'MICROPHONE_PERMISSION_REVOKED' }).snapshot;
  assert.equal(permissionRevoked.hostAvailable, false);
  const permissionRestored = step(permissionRevoked, { type: 'MICROPHONE_PERMISSION_GRANTED' }).snapshot;
  assert.equal(permissionRestored.state, 'unavailable');
  assert.equal(step(permissionRestored, { type: 'START_LOCAL_WAITING' }).accepted, false);
  const consentRevoked = step(permissionRestored, { type: 'LOCAL_LISTEN_CONSENT_REVOKED' }).snapshot;
  const consentRestored = step(consentRevoked, { type: 'LOCAL_LISTEN_CONSENT_GRANTED' }).snapshot;
  assert.equal(consentRestored.state, 'unavailable');
  assert.equal(step(consentRestored, { type: 'START_LOCAL_WAITING' }).accepted, false);
  const hostBack = step(consentRestored, { type: 'HOST_AVAILABLE' }).snapshot;
  assert.equal(hostBack.state, 'muted');
  assert.equal(step(hostBack, { type: 'START_LOCAL_WAITING' }).snapshot.state, 'waiting-for-wake');
});

test('revoking disclosure stops future work and reports that already-forwarded content may not be retractable', () => {
  const active = listening();
  const pending = step(active, { type: 'COMMAND_CAPTURED', generation: active.generation, fields: ['spoken-command'] }).snapshot;
  assert.equal(step(pending, { type: 'POST_WAKE_DISCLOSURE_REVOKED', generation: active.generation }).snapshot.state, 'waiting-for-wake');
  const selected = step(pending, { type: 'POST_WAKE_DESTINATION_SELECTED', generation: active.generation, destination: 'assistant-choice' }).snapshot;
  const forwarded = step(selected, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: active.generation,
    destination: 'assistant-choice', fields: ['spoken-command'] }).snapshot;
  const revoked = step(forwarded, { type: 'POST_WAKE_DISCLOSURE_REVOKED', generation: active.generation });
  assert.ok(revoked.effects.some(effect => effect.type === 'CANCEL_REMOTE_WORK'));
  assert.ok(revoked.effects.some(effect => effect.type === 'EXPLAIN_CONTENT_MAY_ALREADY_BE_SENT'));
  assert.equal(revoked.snapshot.state, 'waiting-for-wake');
});

test('a stale disclosure revocation cannot cancel a later command generation', () => {
  const prompt1 = step(listening(), { type: 'COMMAND_CAPTURED', generation: 1, fields: ['spoken-command'] }).snapshot;
  const cancelled1 = step(prompt1, { type: 'CANCEL' }).snapshot;
  const generation3 = step(cancelled1, { type: 'WAKE_DETECTED', eventId: 'wake-fixture-2' }).snapshot;
  const prompt3 = step(generation3, { type: 'COMMAND_CAPTURED', generation: generation3.generation, fields: ['spoken-command'] }).snapshot;
  const selected3 = step(prompt3, { type: 'POST_WAKE_DESTINATION_SELECTED', generation: generation3.generation,
    destination: 'assistant-choice' }).snapshot;
  const forwarded3 = step(selected3, { type: 'POST_WAKE_DISCLOSURE_APPROVED', generation: generation3.generation,
    destination: 'assistant-choice', fields: ['spoken-command'] }).snapshot;

  const delayedRevocation = step(forwarded3, { type: 'POST_WAKE_DISCLOSURE_REVOKED', generation: prompt1.generation });
  assert.equal(delayedRevocation.accepted, false);
  assert.deepEqual(delayedRevocation.effects, []);
  assert.equal(delayedRevocation.snapshot, forwarded3);
  assert.equal(delayedRevocation.snapshot.state, 'processing');
  assert.equal(delayedRevocation.snapshot.contentForwarded, true);
  assert.equal(delayedRevocation.snapshot.generation, generation3.generation);
});
