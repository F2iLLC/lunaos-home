import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuestionHandler } from '../lib/spoken-questions.js';
import { createNotebookSessions } from '../lib/notebook-sessions.js';
import { createVaultNotebook } from '../lib/vault-notebook.js';
import { fixtureProtector, openVaultFileStore } from '../lib/vault-file-store.js';
import { pcmWave } from '../lib/vehicle-speech.js';

const token = 'a'.repeat(64), session = 'b'.repeat(32), other = 'c'.repeat(32);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notebook-relay-'));
  const options = { directory, storeId: 'synthetic', protector: fixtureProtector(crypto.getRandomValues(new Uint8Array(32))) };
  let store = await openVaultFileStore({ ...options, create: true });
  let failSpeech = false, failStorage = false;
  const wrapped = { contractVersion: 2, read: (...args) => store.read(...args),
    create: (...args) => { if (failStorage) throw Error('fixture'); return store.create(...args); },
    edit: (...args) => { if (failStorage) throw Error('fixture'); return store.edit(...args); } };
  const notebooks = createNotebookSessions({ create: () => createVaultNotebook({ store: wrapped, profiles: [] }) });
  const answers = [], speech = [];
  const server = createServer(createQuestionHandler({ token, voiceId: 'v'.repeat(20), notebooks, notebookSpeech: true, cooldownMs: 0,
    answer: async args => { answers.push(args); return 'A cloud answer.'; },
    speak: async args => { speech.push(args.text); if (failSpeech) throw Error('fixture'); return pcmWave(Buffer.alloc(480)); } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const post = (path, body, id = session, auth = token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', 'X-Home-Session': id }, body: JSON.stringify(body) });
  return { post, answers, speech, directory, notebooks,
    say: (question, id) => post('/question', { question }, id),
    snapshot: async () => (await post('/notebook', { action: 'snapshot' })).json(),
    restart: async () => { await store.close(); store = await openVaultFileStore(options); },
    failSpeech: value => { failSpeech = value; }, failStorage: value => { failStorage = value; } };
}

test('authenticated speech, UI and restarted encrypted vault share the same notebook', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/notebook', { action: 'snapshot' }, session, 'wrong')).status, 401);
  for (const name of ['Movies', 'Packing', 'Gift ideas']) {
    assert.equal((await f.say(`create a list called ${name}`)).headers.get('x-home-notebook-animation'), 'new-page');
    assert.equal((await f.say('add Arrival and Dune')).headers.get('x-home-notebook-animation'), 'scribble');
  }
  let book = (await f.snapshot()).notebook;
  assert.deepEqual(book.lists.map(x => x.items.length), [2, 2, 2]);
  assert.equal((await f.say('what is on my Movies list')).headers.get('x-home-notebook-list'), book.lists[0].id);
  await f.say('what is on my Gift ideas list');
  assert.equal((await f.say('mark Arrival as done')).headers.get('x-home-notebook-animation'), 'checkmark');
  assert.equal((await f.say('remove Dune')).headers.get('x-home-notebook-animation'), 'cross-out');
  await f.say('rename Gift ideas to Presents');
  await f.restart();
  book = (await f.snapshot()).notebook;
  assert.equal(book.lists[2].name, 'Presents');
  assert.equal(book.lists[2].items[0].completed, true);
  assert.equal((await readFile(join(f.directory, 'vault.bin'))).includes(Buffer.from('Presents')), false);
  assert.equal(f.answers.length, 0);
});

test('contexts and destructive confirmations cannot cross conversations; unrelated speech clears context', async t => {
  const f = await fixture(t);
  await f.say('create a list called Movies');
  assert.equal((await f.say('add Arrival', other)).headers.get('x-home-notebook-animation'), 'hover');
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 0);
  await f.say('delete my Movies list');
  await f.say('yes', other);
  assert.equal((await f.snapshot()).notebook.lists.length, 1);
  await f.say('yes');
  assert.equal((await f.snapshot()).notebook.lists.length, 0);
  await f.say('create a list called Books');
  await f.say('why is the sky blue');
  assert.equal((await f.say('add Dune')).headers.get('x-home-notebook-animation'), 'hover');
});

test('storage failure has no success feedback and recovery succeeds; speech failure never rolls back or retries a commit', async t => {
  const f = await fixture(t);
  await f.say('create a list called Books');
  f.failStorage(true);
  assert.equal((await f.say('add Dune')).headers.get('x-home-notebook-animation'), 'puzzled');
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 0);
  f.failStorage(false); f.failSpeech(true);
  const response = await f.say('add Dune');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('x-home-notebook-animation'), null);
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 1);
  f.failSpeech(false);
  await f.say('add Dune');
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 1);
});

test('session expiry drops pending confirmations and bounded registry refuses excess clients', () => {
  let now = 0, count = 0;
  const sessions = createNotebookSessions({ create: () => ({ id: ++count }), now: () => now, ttlMs: 10, limit: 1 });
  const first = sessions.get(session);
  assert.equal(sessions.get(session), first);
  assert.throws(() => sessions.get(other));
  now = 10;
  assert.notEqual(sessions.get(session), first);
  assert.throws(() => sessions.get('../invalid'));
  assert.notEqual(sessions.get(), sessions.get());
});

test('notebook speech disclosure is off by default', async t => {
  const speech = [];
  const server = createServer(createQuestionHandler({ token, voiceId: 'v'.repeat(20),
    notebooks: { get: () => ({ request: async () => ({ handled: true, reply: 'Synthetic private item', avatar: { animation: 'read' } }) }) },
    answer: async () => { throw Error('must not send lists to model'); },
    speak: async ({ text }) => { speech.push(text); return pcmWave(Buffer.alloc(480)); } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/question`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'read my list' }) });
  assert.equal(response.status, 200);
  assert.equal(speech.some(text => text.includes('Synthetic private item')), false);
  const snapshot = await fetch(`http://127.0.0.1:${server.address().port}/notebook`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot' }) });
  assert.equal(snapshot.status, 200, 'speech cooldown must not block the page from synchronizing');
});

test('list inventory variants and unrecognized names clarify locally without guessing a write', async t => {
  const f = await fixture(t);
  await f.say('create a list called Test movie');
  await f.say('add Arrival and Interstellar');
  for (const phrase of ['what lists do I have', 'what list do I have', 'what are my lists']) {
    assert.equal((await f.say(phrase)).headers.get('x-home-notebook-animation'), 'read');
    assert.match(f.speech.at(-1), /Test movie/);
  }
  assert.equal((await f.say('add Dune to my das movie list')).headers.get('x-home-notebook-animation'), 'hover');
  assert.match(f.speech.at(-1), /Test movie.*Which list/);
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 2);
  await f.say('Test movie');
  assert.equal((await f.snapshot()).notebook.lists[0].items.length, 3);
  assert.equal(f.answers.length, 0);
});
