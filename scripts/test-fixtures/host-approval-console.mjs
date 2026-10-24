import { createInterface } from 'node:readline/promises';

// Developer-only local terminal; the connected client never answers this prompt.
// Automated tests inject a decision instead and explicitly label that evidence.
export function openHostApprovalConsole({ input = process.stdin, output = process.stdout, synthetic = false, readTimeoutMs = 10_000 } = {}) {
  if (!synthetic && (!input.isTTY || !output.isTTY)) throw Error('A local interactive terminal is required.');
  const terminal = createInterface({ input, output, terminal: false });
  const show = text => output.write(text + '\n');
  const stopped = new AbortController();
  terminal.on('close', () => stopped.abort());
  async function ask(prompt, timeout) {
    try { return await terminal.question(prompt, { signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(timeout)]) }); }
    catch { return ''; } // Timeout, EOF and cancellation deny; no implicit approval.
  }
  show(synthetic ? 'Synthetic driver of local approval controls; no human or OS verification claim.' : 'Local developer approval controls. This does not verify Windows user presence.');
  return {
    async readyForEnrollment() {
      try {
        await terminal.question('Bring the phone and this terminal into view. Press Enter to start the 60-second identity review (this does not approve pairing): ',
          { signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(120_000)]) });
        return true;
      } catch { return false; }
    },
    async enrollment(review) {
      show(`Compare both full identities and the proposed scope on the test Android screen.\nComputer: ${review.hostFingerprint}\nAndroid: ${review.peerFingerprint}\nProposed access: Alex / Library visit, read-only for up to 60 seconds after a separate approval.`);
      const answer = await ask('Within 60 seconds, type allow to approve this Android connection; anything else denies: ', 60_000);
      return { ...review, allow: answer === 'allow' };
    },
    async read(connection) {
      show(`Android: ${connection.peerFingerprint}\nConnection: ${connection.connectionId}`);
      return (await ask('Allow Alex / Library visit read-only for 60 seconds? Type allow: ', readTimeoutMs)) === 'allow';
    },
    async edit(connection) {
      show(`Android: ${connection.peerFingerprint}\nConnection: ${connection.connectionId}\nFictional proposal: change Alex / Library visit to Friday from phone. Edit only; no create, delete or read grant.`);
      return (await ask('Allow this selected edit for 60 seconds? Type edit: ', 10_000)) === 'edit';
    },
    devices(devices) {
      show('Enrolled fictional devices and removal state:');
      for (const device of devices) show(`${device.peerFingerprint}: ${device.removal}${device.custody ? ` (${device.custody})` : ''}`);
      if (!devices.length) show('None');
    },
    async removal(peerFingerprint) {
      show(`Remove Android identity: ${peerFingerprint}`);
      return (await ask('Remove this device? Type remove, or anything else to keep it: ', 60_000)) === 'remove';
    },
    async retryRemoval(peerFingerprint) {
      show(`Registry readback still contains Android identity: ${peerFingerprint}. Host access is stopped.`);
      return (await ask('Try removal again? Type retry, or anything else to stop: ', 60_000)) === 'retry';
    },
    async afterWindowsUnlock(timeoutMs = 180_000) {
      return (await ask('After Windows is unlocked and awake, type back and press Enter: ', timeoutMs)) === 'back';
    },
    close() { terminal.close(); },
  };
}
