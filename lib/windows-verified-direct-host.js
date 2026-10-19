import { createNativeGate } from './windows-native-gate.js';
import { createWindowsPreview } from './windows-preview.js';
import { startDirectVaultExperiment } from './direct-vault-tls.js';
import { createLocalEnrollment } from './local-enrollment.js';

// The supervisor supplies its owned native child's private pipe, never a remote
// verification flag. Tests explicitly substitute a controlled child/event source.
export async function startWindowsVerifiedDirectHost({ child, store, identity, ca, gateOptions, ...transport }) {
  const ended = Promise.withResolvers();
  const preview = createWindowsPreview({ store });
  let host, enrollment, closed = false, closing;
  const stopTransport = () => {
    closed = true; ended.resolve();
    enrollment?.close();
    // host.close invalidates grants/queued operations and sockets synchronously
    // before awaiting listener completion. Lost write receipts remain UNKNOWN.
    if (host && !closing) closing = host.close();
  };
  const gate = createNativeGate({ ...preview, shutdown() { preview.shutdown(); stopTransport(); } }, child, gateOptions);
  try {
    host = await startDirectVaultExperiment({ ...transport, identity, ca, store, requireAccess: () => gate.requireVerified() });
    enrollment = createLocalEnrollment(host);
    if (closed) { stopTransport(); await closing; throw new Error('Native visit ended before host startup.'); }
  } catch (error) { gate.shutdown(); await closing; throw error; }
  return Object.freeze({
    gate, host, enrollment, ended: ended.promise, previewKey: preview.key,
    async close() { gate.shutdown(); await closing; },
  });
}
