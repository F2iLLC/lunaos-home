import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { createAppServer } from '../server.js';

// Explicit developer entry point. No household paths or arbitrary records.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--resume')) {
  throw Error('Use no arguments for a new example, or --resume with its example ID.');
}
const store = await openWindowsProbeStore({
  powershell: process.env.LUNA_HOME_PROBE_POWERSHELL || 'pwsh',
  ...(args.length ? { probeId: args[1] } : {}), create: !args.length,
});
const windowsPreview = createWindowsPreview({ store });
const server = createAppServer({ windowsPreview });
server.on('error', () => { windowsPreview.shutdown(); console.error('The Windows example could not start.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  windowsPreview.shutdown();
  server.close();
  server.closeIdleConnections();
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Fictional Windows example: http://127.0.0.1:${server.address().port}/windows-vault#${windowsPreview.key}`);
  console.log(`Resume this example after stopping: node scripts/windows-vault-preview.mjs --resume ${store.probeId}`);
  console.log('Only fixed examples are available. Records remain encrypted locally when this process stops; approvals do not survive restart.');
});
