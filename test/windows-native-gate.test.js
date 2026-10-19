import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeGate } from '../lib/windows-native-gate.js';
import { createWindowsPreview } from '../lib/windows-preview.js';

function fixture(store = {}, now) {
  const records = new Map();
  const preview = createWindowsPreview({ store: {
    read: async id => records.get(id), create: async (id, data) => records.set(id, data),
    edit: async (id, data) => records.set(id, data), ...store,
  } });
  const child = new EventEmitter(); child.stdout = new EventEmitter();
  child.kill = () => { child.killed = true; };
  const timers = [];
  const gate = createNativeGate(preview, child, {
    ...(now ? { now } : {}),
    schedule: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    cancel: timer => { if (timer) timer.cancelled = true; },
  });
  return { gate, child, timers, records };
}
const denied = error => error.code === 'DENIED';
const verify = child => child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_VERIFIED\n'));
const monitorEnd = child => child.stdout.emit('data', Buffer.from('HOME_WINDOWS_SESSION_ENDED\n'));

test('native shutdown returns the store drain promise to its caller', async () => {
  const drained = Promise.withResolvers();
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {};
  const gate = createNativeGate({ shutdown: () => drained.promise }, child);
  const shutdown = gate.shutdown();
  assert.equal(shutdown, drained.promise);
  drained.resolve();
  await shutdown;
});

test('unavailable monitor, reordered readiness and lock during authentication cannot open access', async () => {
  for (const lines of [
    ['HOME_WINDOWS_VERIFIED\n'],
    ['HOME_WINDOWS_MONITOR_UNAVAILABLE\n'],
    ['HOME_WINDOWS_MONITOR_READY\n', 'HOME_WINDOWS_SESSION_ENDED\n', 'HOME_WINDOWS_VERIFIED\n'],
    ['HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_VERIFIED\nHOME_WINDOWS_SESSION_ENDED\n'],
  ]) {
    const f = fixture();
    for (const line of lines) f.child.stdout.emit('data', Buffer.from(line));
    await assert.rejects(f.gate.request({ action: 'approve', mode: 'setup' }), denied);
    await assert.rejects(f.gate.assistantRequest({ action: 'connect' }), denied);
    assert.equal(f.child.killed, true);
  }
  const f = fixture();
  f.child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_READY\n'));
  await assert.rejects(f.gate.request({ action: 'approve', mode: 'setup' }), denied);
  f.gate.shutdown();
});

test('monitor event during disclosed read withholds contents and cancels queued mutation', async () => {
  const entered = Promise.withResolvers(); const release = Promise.withResolvers(); let writes = 0;
  const f = fixture({ read: async () => { entered.resolve(); await release.promise; return { label: 'Workplace', value: 'Willow Studio' }; }, edit: async () => { writes++; } });
  verify(f.child);
  const { connectionId } = await f.gate.assistantRequest({ action: 'connect' });
  await f.gate.request({ action: 'assistant-approve', mode: 'setup' });
  await f.gate.request({ action: 'assistant-share', recordId: 'alex-work', field: 'label' });
  const request = { action: 'record', connectionId, recordId: 'alex-work' };
  const read = f.gate.assistantRequest({ ...request, operation: 'read' });
  await entered.promise;
  const edit = f.gate.assistantRequest({ ...request, operation: 'edit' });
  const checks = [assert.rejects(read, denied), assert.rejects(edit, denied)];
  monitorEnd(f.child); release.resolve(); await Promise.all(checks);
  assert.equal(writes, 0);
  await assert.rejects(f.gate.request({ action: 'assistant-share', recordId: 'alex-work', field: 'value' }), denied);
  verify(f.child);
  await assert.rejects(f.gate.assistantRequest({ action: 'connect' }), denied);
});

test('monitor event during a committed write returns an ended receipt and never repeats it', async () => {
  const entered = Promise.withResolvers(); const release = Promise.withResolvers(); let writes = 0;
  const f = fixture({ create: async () => { writes++; entered.resolve(); await release.promise; } });
  verify(f.child);
  const { grantId } = await f.gate.request({ action: 'approve', mode: 'setup' });
  const input = { action: 'record', grantId, operation: 'create', recordId: 'alex-work' };
  const write = f.gate.request(input); await entered.promise; monitorEnd(f.child); release.resolve();
  assert.deepEqual(await write, { status: 'applied', recordId: 'alex-work', accessEnded: true });
  await assert.rejects(f.gate.request(input), denied); assert.equal(writes, 1);
});

test('native gate has no HTTP unlock and still requires separate record and disclosure approvals', async () => {
  const { gate, child, timers, records } = fixture();
  await assert.rejects(gate.request({ action: 'approve', mode: 'setup' }), denied);
  await assert.rejects(gate.assistantRequest({ action: 'connect' }), denied);
  await assert.rejects(gate.request({ action: 'unlock', verified: true }), denied);
  child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_'));
  await assert.rejects(gate.request({ action: 'approve', mode: 'setup' }), denied);
  child.stdout.emit('data', Buffer.from('VERIFIED\n'));
  assert.equal(timers[0].cancelled, true); assert.equal(timers[1].ms, 300000);
  const { connectionId } = await gate.assistantRequest({ action: 'connect' });
  const read = { action: 'record', connectionId, operation: 'read', recordId: 'alex-work' };
  await assert.rejects(gate.assistantRequest(read), denied);
  const { grantId } = await gate.request({ action: 'approve', mode: 'setup' });
  await gate.request({ action: 'record', grantId, operation: 'create', recordId: 'alex-work' });
  assert.equal(records.size, 1);
  await gate.request({ action: 'assistant-approve', mode: 'read' });
  await assert.rejects(gate.assistantRequest(read), e => e.code === 'DISCLOSURE_REQUIRED');
  await gate.request({ action: 'assistant-share', recordId: 'alex-work', field: 'label' });
  assert.deepEqual(await gate.assistantRequest(read), { label: 'Workplace' });
  child.emit('exit', 0);
  await assert.rejects(gate.assistantRequest(read), denied);
  await assert.rejects(gate.request({ action: 'approve', mode: 'setup' }), denied);
  verify(child); // Late/spurious receipt cannot reopen a closed gate.
  await assert.rejects(gate.assistantRequest({ action: 'connect' }), denied);
});

test('native lease checks elapsed time even before its timer callback, and rejects a backward clock', async () => {
  for (const endTime of [300000, -1, Number.NaN]) {
    let tick = 0;
    const f = fixture({}, () => tick); verify(f.child);
    await f.gate.request({ action: 'approve', mode: 'read' });
    tick = endTime;
    await assert.rejects(f.gate.request({ action: 'approve', mode: 'read' }), denied);
    assert.equal(f.child.killed, true);
  }
  let tick = 0; const f = fixture({}, () => tick);
  tick = 180000; verify(f.child);
  await assert.rejects(f.gate.request({ action: 'approve', mode: 'read' }), denied);
});

test('native cancellation, pipe failure, unexpected output and either timeout stay closed', async () => {
  for (const fail of [f => f.child.emit('exit', 2), f => f.child.emit('error', Error('failed')),
    f => f.child.stdout.emit('end'), f => f.child.stdout.emit('data', Buffer.from('verified\n')),
    f => f.timers[0].fn(), f => { verify(f.child); f.timers[1].fn(); },
    f => { verify(f.child); verify(f.child); }]) {
    const f = fixture(); fail(f); verify(f.child);
    assert.equal(f.child.killed, true);
    await assert.rejects(f.gate.request({ action: 'approve', mode: 'setup' }), denied);
    await assert.rejects(f.gate.assistantRequest({ action: 'connect' }), denied);
  }
});

test('native close suppresses an in-flight read and denies a queued mutation', async () => {
  const entered = Promise.withResolvers(); const release = Promise.withResolvers(); let writes = 0;
  const { gate, child } = fixture({ read: async () => { entered.resolve(); await release.promise; return { label: 'Workplace' }; }, edit: async () => { writes++; } });
  verify(child);
  const { grantId } = await gate.request({ action: 'approve', mode: 'setup' });
  const request = { action: 'record', recordId: 'alex-work', grantId };
  const read = gate.request({ ...request, operation: 'read' });
  await entered.promise;
  const edit = gate.request({ ...request, operation: 'edit' });
  const checks = [assert.rejects(read, denied), assert.rejects(edit, denied)];
  child.emit('exit', 0); release.resolve();
  await Promise.all(checks); assert.equal(writes, 0);
});

test('native lease expiration during a committed write returns an ended receipt without replay', async () => {
  let tick = 0; let writes = 0;
  const f = fixture({ create: async () => { writes++; tick = 300000; } }, () => tick);
  verify(f.child);
  const { grantId } = await f.gate.request({ action: 'approve', mode: 'setup' });
  const input = { action: 'record', grantId, operation: 'create', recordId: 'alex-work' };
  assert.deepEqual(await f.gate.request(input), { status: 'applied', recordId: 'alex-work', accessEnded: true });
  await assert.rejects(f.gate.request(input), denied); assert.equal(writes, 1);
});
