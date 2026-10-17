import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createWindowsPreview } from '../lib/windows-preview.js';
import { createNativeGate } from '../lib/windows-native-gate.js';
import { createAppServer } from '../server.js';
// Interactive, synthetic-only. A human must complete the OS prompt, or choose
// Cancel with --cancel. --lock/--sleep wait for a human action; neither mode
// changes the workstation state. Never enter verification input in this harness.
if (process.platform !== 'win32' || process.argv.slice(2).some(arg => !['--cancel', '--lock', '--sleep'].includes(arg)) || process.argv.length > 3) {
 throw Error('Use on Windows with no arguments, --cancel, --lock or --sleep.');
}
const physicalEvent = process.argv.includes('--lock') ? 'lock' : process.argv.includes('--sleep') ? 'suspend' : undefined;
const store = await openWindowsProbeStore({create:true});
const preview = createWindowsPreview({store});
const child = spawn(fileURLToPath(new URL('../src-tauri/target/debug/lunaos-home-preview.exe', import.meta.url)), ['--fictional-windows-vault'], {stdio:['pipe','pipe','pipe'], windowsHide:true});
// Error is handled by the gate; keep cleanup waiting for the actual close event.
const closed = new Promise(resolve => child.once('close', (...args) => resolve(args)));
child.stdin.on('error',()=>{}); let canceled=false; let diagnostic=''; let observedEvent=false;
child.stderr.on('data',chunk=>{
 diagnostic=(diagnostic+chunk.toString()).slice(-2048);
 if(diagnostic.includes('HOME_WINDOWS_CANCELED')) canceled=true;
 if(physicalEvent && diagnostic.includes(`HOME_WINDOWS_EVENT:${physicalEvent}\n`)) observedEvent=true;
});
const gate = createNativeGate(preview,child);
const server = createAppServer({windowsPreview:gate});
let receipt=''; const verified = Promise.withResolvers();
child.stdout.on('data',chunk=>{receipt+=chunk; if(receipt==='HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_VERIFIED\n') verified.resolve();});
child.once('close',()=>verified.reject(Error('Native process ended without verification')));
verified.promise.catch(()=>{});
const loaded = new Set();
server.on('request',request=>{if(['/windows-vault','/windows-vault.js','/styles.css'].includes(request.url))loaded.add(request.url);});
try {
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(input,assistant=false)=>{const response=await fetch(base+(assistant?'/api/windows-assistant':'/api/windows-preview'), {method:'POST',headers:{'Content-Type':'application/json','X-Home-Preview':'1',[assistant?'X-Home-Assistant-Key':'X-Home-Windows-Key']:assistant?preview.assistantKey:preview.key},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
 assert.equal((await call({action:'approve',mode:'setup'})).status,409);
 assert.equal((await call({action:'connect'},true)).status,409);
 child.stdin.end(`${base}/windows-vault#${preview.key}\n`);
 console.log('Windows native verification launched; waiting for human action. Before verification, GUI approval and assistant connection were denied.');
 if(process.argv.includes('--cancel')) {
  await closed;
  // The supervisor can terminate the child as soon as destruction emits Ended,
  // so its process exit code is no longer the authentication result.
  assert.equal(canceled,true); assert.ok(receipt.startsWith('HOME_WINDOWS_MONITOR_READY\n'));
  assert.ok(!receipt.includes('HOME_WINDOWS_VERIFIED')); assert.equal(loaded.size,0);
  assert.equal((await call({action:'approve',mode:'setup'})).data.code,'DENIED');
  assert.equal((await call({action:'connect'},true)).data.code,'DENIED');
  console.log('PASS: real Windows Canceled result, no verification receipt or vault-page load; GUI and assistant stay denied.');
 } else {
 await verified.promise;
 console.log('Observed real native OS verification receipt. Checking screen requests and encrypted examples.');
 for(let i=0;i<30 && loaded.size<3;i++)await new Promise(r=>setTimeout(r,500));
 assert.equal(loaded.size,3,'native document, stylesheet and script requests');
 const grant=(await call({action:'approve',mode:'setup'})).data.grantId;
 for(const recordId of ['alex-work','sam-school']) {
  assert.equal((await call({action:'record',grantId:grant,operation:'create',recordId})).status,200);
  assert.equal((await call({action:'record',grantId:grant,operation:'read',recordId})).status,200);
 }
 const connectionId=(await call({action:'connect'},true)).data.connectionId;
 const read={action:'record',connectionId,operation:'read',recordId:'alex-work'};
 await call({action:'assistant-approve',mode:'read'});
 assert.equal((await call(read,true)).data.code,'DISCLOSURE_REQUIRED');
 await call({action:'assistant-share',recordId:'alex-work',field:'label'});
 assert.deepEqual((await call(read,true)).data,{label:'Workplace'});
 if (physicalEvent) {
  console.log(`Ready for the human to ${physicalEvent === 'lock' ? 'lock and unlock Windows' : 'sleep and resume Windows'}. Do not merely close the app. The probe never changes workstation state.`);
  await closed;
  assert.equal(observedEvent,true,'the requested Windows event must be observed; timeout or window close is not a pass');
  assert.ok(receipt.includes('HOME_WINDOWS_SESSION_ENDED\n'));
 } else { child.kill(); await closed; }
 assert.equal((await call({action:'record',grantId:grant,operation:'read',recordId:'alex-work'})).data.code,'DENIED');
 assert.equal((await call(read,true)).data.code,'DENIED');
 console.log('PASS: real Windows verification receipt; native document/script/style requests; both encrypted member records; separate selected-field sharing; native process close denies GUI and assistant. Endpoint-driven records, not native button-click proof.');
 if (physicalEvent) console.log(`PASS: observed requested Windows ${physicalEvent} notification and denied old GUI/assistant access. Requires separate fresh-verification restart check.`);
 }
} finally {
 gate.shutdown(); await closed; server.closeAllConnections(); await new Promise(r=>server.close(r));
 await store.removeSyntheticStore(); await assert.rejects(stat(store.directory),e=>e.code==='ENOENT');
 console.log('Owned native process, synthetic fixture and loopback server cleaned.');
}
