import { VaultAccessError } from './vault-sessions.js';

// Only the supervisor's private child pipe can open this gate. No HTTP action
// can verify a user. This is an application gate, not DPAPI key release.
export function createNativeGate(preview, child, { schedule = setTimeout, cancel = clearTimeout, now = () => performance.now() } = {}) {
  let state = 'waiting';
  let buffered = '';
  let timer;
  let lastTime = now();
  let deadline = lastTime + 180000;
  const close = () => {
    if (state === 'closed') return;
    state = 'closed'; cancel(timer); preview.shutdown();
    child.kill();
  };
  const current = () => {
    const time = now();
    if (!Number.isFinite(time) || time < lastTime || time >= deadline) close();
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
  timer = schedule(close, 180000);
  child.on('error', close);
  child.on('exit', close);
  child.stdout.on('end', close);
  child.stdout.on('data', chunk => {
    if (current() !== 'waiting') { close(); return; }
    buffered += chunk.toString('utf8');
    const expected = 'HOME_WINDOWS_VERIFIED\n';
    if (!expected.startsWith(buffered)) { close(); return; }
    if (buffered === expected) {
      state = 'verified'; cancel(timer);
      deadline = lastTime + 300000;
      timer = schedule(close, 300000);
    }
  });
  return Object.freeze({
    nativeVerification: true,
    acceptsKey: preview.acceptsKey,
    acceptsAssistantKey: preview.acceptsAssistantKey,
    request: input => execute('request', input),
    assistantRequest: input => execute('assistantRequest', input),
    shutdown: close,
  });
}
