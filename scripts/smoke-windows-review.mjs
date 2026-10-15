import { createAppServer } from '../server.js';
import { createDraftStore, exampleProposal } from '../lib/drafts.js';
import { createAssistantServer } from '../assistant.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
// Explicit developer smoke check. Never part of npm test: it launches a native
// Windows process, stages fixtures only, and makes no visual acceptance claim.
if (process.platform !== 'win32') throw new Error('This probe requires Windows.');
const drafts = createDraftStore();
const http = createAppServer({ drafts });
const requests = [];
http.on('request', (req, res) => res.on('finish', () => requests.push({
  path: req.url,
  status: res.statusCode,
  webview: req.headers['user-agent']?.includes('Edg/'),
})));
http.listen(0, '127.0.0.1');
await once(http, 'listening');
const url = `http://127.0.0.1:${http.address().port}/#vault`;
const server = createAssistantServer(drafts, url);
const client = new Client({ name: 'fictional-windows-launch-probe', version: '1.0.0' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
let child;
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: 'home_stage_draft', arguments: exampleProposal });
  if (result.isError) throw new Error('Fictional draft staging failed');
  const executable = fileURLToPath(new URL('../src-tauri/target/debug/lunaos-home-preview.exe', import.meta.url));
  child = spawn(executable, ['--fictional-review-url', url], { windowsHide: true, stdio: 'ignore' });
  child.on('error', error => console.error(error.message));
  await new Promise(resolve => setTimeout(resolve, 12000));
  console.log(JSON.stringify({
    stage: JSON.parse(result.content[0].text).status,
    processAlive: child.exitCode === null && child.pid !== undefined,
    requests,
    limit: 'Request trace only; no native visual or interaction acceptance.',
  }, null, 2));
  if (child.exitCode !== null || !requests.some(r => r.path === '/api/draft' && r.status === 200 && r.webview)) {
    process.exitCode = 1;
  }
} finally {
  if (child && child.exitCode === null) child.kill();
  await client.close();
  await server.close();
  http.closeAllConnections();
  await new Promise(resolve => http.close(resolve));
}
