import { createInterface } from 'node:readline/promises';

// Developer-only local terminal; the connected client never answers this prompt.
// Automated tests inject a decision instead and explicitly label that evidence.
export function openHostApprovalConsole({ input = process.stdin, output = process.stdout, synthetic = false } = {}) {
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
    async enrollment(review) {
      show(`Compare both full identities on the test Android screen.\nComputer: ${review.hostFingerprint}\nAndroid: ${review.peerFingerprint}`);
      const answer = await ask('Allow this Android connection? Type allow, or anything else to deny: ', 60_000);
      return { ...review, allow: answer === 'allow' };
    },
    async read(connection) {
      show(`Android: ${connection.peerFingerprint}\nConnection: ${connection.connectionId}`);
      return (await ask('Allow Alex / Library visit read-only for 60 seconds? Type allow: ', 10_000)) === 'allow';
    },
    close() { terminal.close(); },
  };
}
