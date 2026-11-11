import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createQuestionHandler, questionInstructions } from '../lib/spoken-questions.js';
import { pcmWave } from '../lib/vehicle-speech.js';

const token = 'a'.repeat(64), voiceId = 'b'.repeat(20);
async function relay(t, overrides = {}) {
  const calls = [];
  const handler = createQuestionHandler({ token, voiceId,
    answer: async args => { calls.push(args); return 'A fictional dragon waves hello.'; },
    speak: async args => { calls.push(args); return pcmWave(Buffer.alloc(480)); }, ...overrides });
  const server = createServer(handler); server.requestTimeout = 1000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/question`;
  const ask = (question, headers = {}) => fetch(url, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({question}) });
  return { ask, calls, url };
}
test('question relay requires device authorization before provider calls', async t => {
  const {ask,calls}=await relay(t);
  assert.equal((await ask('fictional question', {Authorization:'Bearer invalid'})).status,401);
  assert.equal((await ask('fictional question', {'Content-Type':'text/plain'})).status,400);
  assert.equal(calls.length,0);
});
test('one text-only turn yields bounded speech in the selected voice, with no history',async t=>{
  const {ask,calls}=await relay(t);const response=await ask('tell a fictional story');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(Buffer.from(response.headers.get('x-home-reply-text'), 'base64').toString('utf8'), calls[1].text);
  assert.equal((await response.arrayBuffer()).byteLength,524);
  assert.deepEqual(calls[0].messages,[{role:'user',text:'tell a fictional story'}]);
  assert.equal(calls[0].instructions,questionInstructions);assert.equal(calls[1].voiceId,voiceId);
  assert.equal((await ask('another question')).status,429);assert.equal(calls.length,2);
});
test('invalid or oversized questions never reach the providers',async t=>{
  const {ask,calls}=await relay(t);
  for(const input of ['', 'a'.repeat(1001), 'line\nbreak'])assert.equal((await ask(input)).status,400);
  assert.equal((await ask('a'.repeat(5000))).status,413);assert.equal(calls.length,0);
});
test('provider failure is fixed-code only and never becomes invented audio',async t=>{
  const {ask}=await relay(t,{answer:async()=>{throw Error('private provider details');}});
  const response=await ask('fictional question');assert.equal(response.status,502);assert.equal(await response.text(),'');
});
test('disconnect aborts provider work and concurrent requests cannot duplicate it',async t=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});let signal;
  const {ask,url}=await relay(t,{answer:async args=>{signal=args.signal;started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error();}});
  const controller=new AbortController();const pending=fetch(url,{method:'POST',signal:controller.signal,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({question:'fictional question'})}).catch(()=>{});
  await ready;assert.equal((await ask('second question')).status,429);controller.abort();await pending;
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(signal.aborted,true);
});
