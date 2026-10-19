import { VaultAccessError } from './vault-sessions.js';

// Only the supervisor's private child pipe can open this gate. No HTTP action
// can verify a user. This is an application gate, not DPAPI key release.
export function createNativeGate(preview, child, { schedule = setTimeout, cancel = clearTimeout, now = () => performance.now() } = {}) {
  let state = 'waiting';
  let buffered = '';
  let monitorReady = false;
  let timer;
  let lastTime = now();
  let deadline = lastTime + 180000;
  const close = (reason = 'operator-close') => {
    if (state === 'closed') return;
    state = 'closed'; cancel(timer); preview.shutdown(reason);
    child.kill();
  };
  const current = () => {
    const time = now();
    if (!Number.isFinite(time) || time < lastTime) close('invalid-clock');
    else if (time >= deadline) close(state === 'verified' ? 'visit-deadline' : 'verification-deadline');
    lastTime = time;
    return state;
  };
  const execute = async (method, input) => {
    if (current() !== 'verified') throw new VaultAccessError('DENIED');
    const value = await preview[method](input);
    if (current() !== 'verified') {
      if (value?.status === 'applied') return { ...value, accessEnded: true };
      throw new VaultAccessError('DENIED');
    }
    return value;
  };
  timer = schedule(() => close('verification-deadline'), 180000);
  child.on('error', () => close('child-error'));
  child.on('exit', () => close('child-exit'));
  child.stdout.on('end', () => close('pipe-end'));
  child.stdout.on('error', () => close('pipe-error'));
  child.stdout.on('data', chunk => {
    if (current() === 'closed') return;
    buffered += chunk.toString('utf8');
    if (buffered.length > 256) { close('invalid-receipt'); return; }
    while (buffered.includes('\n')) {
      const end = buffered.indexOf('\n'); const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (line === 'HOME_WINDOWS_MONITOR_READY' && !monitorReady && state === 'waiting') monitorReady = true;
      else if (line === 'HOME_WINDOWS_VERIFIED' && monitorReady && state === 'waiting') {
        state = 'verified'; cancel(timer);
        deadline = lastTime + 300000;
        timer = schedule(() => close('visit-deadline'), 300000);
      } else { close(line === 'HOME_WINDOWS_SESSION_ENDED' ? 'session-ended' : 'invalid-receipt'); return; } // Session-ended, malformed, reordered or duplicate receipt.
    }
    const expected = state === 'verified' ? ['HOME_WINDOWS_SESSION_ENDED\n']
      : [monitorReady ? 'HOME_WINDOWS_VERIFIED\n' : 'HOME_WINDOWS_MONITOR_READY\n', 'HOME_WINDOWS_SESSION_ENDED\n'];
    if (!expected.some(value => value.startsWith(buffered))) close('invalid-receipt');
  });
  return Object.freeze({
    nativeVerification: true,
    // Synchronous enforcement for the shared record service's admission,
    // queue execution and post-read checks. This cannot open/reopen the gate.
    requireVerified() { if (current() !== 'verified') throw new VaultAccessError('DENIED'); },
    acceptsKey: preview.acceptsKey,
    acceptsAssistantKey: preview.acceptsAssistantKey,
    request: input => execute('request', input),
    assistantRequest: input => execute('assistantRequest', input),
    shutdown: () => close('operator-close'),
  });
}
