import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createMacSpeechHandler} from '../lib/mac-speech.js';
test('Mac speech rejects unauthenticated and oversized audio; valid PCM uses fixed loopback only', async t => {
  let calls=0;
  const token='a'.repeat(64);
  const server=createServer(createMacSpeechHandler({token,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'http://127.0.0.1:18744/recognize');assert.equal(options.body.length,3200);
    return {ok:true,json:async()=>({text:'What lists do I have?'})};
  }}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const request=(bytes,auth=token)=>fetch(`http://127.0.0.1:${server.address().port}/recognize`,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/octet-stream'},body:Buffer.alloc(bytes)});
  assert.equal((await request(3200,'wrong')).status,401);
  assert.equal((await request(800002)).status,413);
  assert.equal((await request(3201)).status,400);
  assert.equal(calls,0);
  const response=await request(3200);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{text:'What lists do I have?'});assert.equal(calls,1);
});
