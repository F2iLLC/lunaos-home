import { createNativeGate } from './windows-native-gate.js';
import { createWindowsPreview } from './windows-preview.js';
import { certificateFingerprint, startDirectVaultExperiment } from './direct-vault-tls.js';
import { createLocalEnrollment } from './local-enrollment.js';
import { openWindowsPairingRegistry } from './windows-pairing-registry.js';

// The supervisor supplies its owned native child's private pipe, never a remote
// verification flag. Tests explicitly substitute a controlled child/event source.
export async function startWindowsVerifiedDirectHost({ child, store, identity, ca, gateOptions, protectedPairing = false, ...transport }) {
  const ended = Promise.withResolvers();
  const preview = createWindowsPreview({ store });
  let host, enrollment, closed = false, closing;
  const stopTransport = reason => {
    closed = true; ended.resolve({ reason });
    enrollment?.close();
    // host.close invalidates grants/queued operations and sockets synchronously
    // before awaiting listener completion. Lost write receipts remain UNKNOWN.
    if (host && !closing) closing = host.close();
  };
  let gate;
  try {
    gate = createNativeGate({ ...preview, shutdown(reason) { const drained = preview.shutdown(); stopTransport(reason); return drained; } }, child, gateOptions);
    const pairingRegistry = protectedPairing ? openWindowsPairingRegistry({
      probeId: store.probeId ?? store.lifecycleStore?.probeId, hostFingerprint: certificateFingerprint(identity.cert),
    }) : transport.pairingRegistry;
    host = await startDirectVaultExperiment({ ...transport, pairingRegistry, identity, ca, store, requireAccess: () => gate.requireVerified() });
    enrollment = createLocalEnrollment(host, { requireAccess: () => gate.requireVerified(), pairingRegistry });
    if (closed) { stopTransport(); await closing; throw new Error('Native visit ended before host startup.'); }
  } catch (error) {
    const gateDrained = gate?.shutdown();
    await closing;
    await gateDrained;
    await preview.shutdown();
    throw error;
  }
  return Object.freeze({
    gate, host, enrollment, ended: ended.promise, previewKey: preview.key,
    async close() { const gateDrained = gate.shutdown(); await closing; await gateDrained; },
  });
}
