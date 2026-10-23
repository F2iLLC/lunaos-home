import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { createNativeGate } from '../lib/windows-native-gate.js';
import { createAppServer } from '../server.js';

if (process.platform !== 'win32') throw Error('This example needs Windows.');
const args = process.argv.slice(2);
if (args.length && !((args.length === 1 && args[0] === '--contract-v2') ||
    (args.length === 2 && ['--resume', '--resume-v2'].includes(args[0])))) {
  throw Error('Use no arguments, --contract-v2, or --resume/--resume-v2 with the example ID.');
}
const versioned = args[0] === '--contract-v2' || args[0] === '--resume-v2';
const resume = args.length === 2;
const store = await openWindowsProbeStore({
  powershell: process.env.LUNA_HOME_PROBE_POWERSHELL || 'pwsh',
  ...(resume ? { probeId: args[1] } : {}), create: !resume,
  contractVersion: versioned ? 2 : 1,
});
const preview = createWindowsPreview({ store });
// Fixed local build, no shell, no URL/key in process arguments. The visible
// window and trusted OS prompt are intentional for this interactive launcher.
const child = spawn(fileURLToPath(new URL('../src-tauri/target/debug/lunaos-home-preview.exe', import.meta.url)),
  ['--fictional-windows-vault'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const gate = createNativeGate(preview, child);
const server = createAppServer({ windowsPreview: gate });
child.stderr.resume(); // Do not publish native diagnostics or page capabilities.
child.stdin.on('error', () => gate.shutdown());
const stop = () => { gate.shutdown(); server.close(); server.closeAllConnections(); };
child.on('error', () => { console.error('Build the Windows debug preview before opening this example.'); stop(); });
child.on('exit', () => { console.log('Native example closed. All access ended; encrypted examples remain.'); stop(); });
server.on('error', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
server.listen(0, '127.0.0.1', () => {
  child.stdin.end(`http://127.0.0.1:${server.address().port}/windows-vault#${preview.key}\n`);
  console.log('Complete verification only in the Windows prompt. Cancel to leave access closed.');
  console.log('Access ends when the window closes or after five minutes; individual approvals last at most one minute.');
  console.log(`Resume: node scripts/windows-vault-native.mjs ${versioned ? '--resume-v2' : '--resume'} ${store.probeId}`);
  console.log(`Assistant bridge environment: LUNA_HOME_WINDOWS_URL=http://127.0.0.1:${server.address().port} LUNA_HOME_WINDOWS_ASSISTANT_KEY=${preview.assistantKey}`);
  console.log('Give only this bridge environment to the test assistant. No browser approval link is issued.');
});
