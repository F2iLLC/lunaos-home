import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteNotebook } from '../lib/remote-notebook.js';
import { createNotebookSessions } from '../lib/notebook-sessions.js';
import { createVaultNotebook } from '../lib/vault-notebook.js';
import { createQuestionHandler } from '../lib/spoken-questions.js';
import { createMemoryVersionedStore } from './support/memory-versioned-store.js';
import { createAppServer } from '../server.js';

test('desktop page uses authenticated pinned TLS to the voice vault; bad tokens never read it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'notebook-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
  const keytool = args => execFileSync(tool, args, { stdio: 'pipe', timeout: 30000 });
  const file = join(directory, 'fixture.p12');
  keytool(['-genkeypair', '-alias', 'relay', '-keyalg', 'RSA', '-keystore', file, '-storetype', 'PKCS12', '-storepass', 'fixture-only', '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost', '-validity', '1', '-noprompt']);
  const certificate = keytool(['-exportcert', '-rfc', '-alias', 'relay', '-keystore', file, '-storepass', 'fixture-only']).toString();
  const store = createMemoryVersionedStore();
  const notebooks = createNotebookSessions({ create: () => createVaultNotebook({ store, profiles: [] }) });
  const token = 'a'.repeat(64);
  const relay = createServer({ pfx: await readFile(file), passphrase: 'fixture-only' }, createQuestionHandler({
    token, voiceId: 'v'.repeat(20), notebooks, answer: async () => { throw Error('no provider expected'); }, speak: async () => { throw Error('no speech expected'); } }));
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  t.after(() => { relay.closeAllConnections(); relay.close(); });
  const config = { endpoint: `https://localhost:${relay.address().port}/question`, token, certificate };
  const remote = createRemoteNotebook(config);
  const local = createAppServer({ notebook: remote });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => { local.closeAllConnections(); local.close(); });
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/api/notebook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Session': 'b'.repeat(32) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  assert.equal((await post({ action: 'say', text: 'create a list called Movies' })).status, 'applied');
  assert.equal((await post({ action: 'say', text: 'add Arrival' })).status, 'applied');
  const snapshot = await notebooks.get('c'.repeat(32)).request({ action: 'snapshot' });
  assert.equal(snapshot.notebook.lists[0].items[0].text, 'Arrival');
  const denied = await createRemoteNotebook({ ...config, token: 'd'.repeat(64) }).request({ action: 'snapshot' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.notebook, undefined);
  const wrongHost = await createRemoteNotebook({ ...config, endpoint: config.endpoint.replace('localhost', '127.0.0.1') }).request({ action: 'snapshot' });
  assert.equal(wrongHost.status, 'failed');
});
