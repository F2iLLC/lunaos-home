import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/notebook-popup.js'], bundle: true, write: false, format: 'iife', globalName: 'Popup' });
function harness(request = async () => ({status:'read',notebook:{lists:[]}})) {
  const node = () => ({ children:[], nodes:new Map(), attrs:{}, handlers:{}, dataset:{}, open:false, value:'', textContent:'',
    setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},setPointerCapture(){}, focus(){},
    dispatch(k,e={}){this.handlers[k]?.(e);},click(e={}){this.dispatch('click',e);},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},
    querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,node());return this.nodes.get(k);},
    showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {left:20,right:800,top:200,bottom:600};},
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},
  });
  const document={body:node(),createElement:node,createElementNS:node,querySelector:()=>node()},location={hash:''};
  const {createNotebookPopup}=new Function('document','location',bundle.outputFiles[0].text+';return Popup;')(document,location);
  const characters=[];const popup=createNotebookPopup({request,onCharacter:c=>characters.push(c)}),page=document.body.children[0];
  return {popup,page,$:s=>page.querySelector(s),location,characters};
}
const snapshot=(fields={})=>({status:'ready',listeningStatus:'enabled',capturePhase:'waiting',wakeEvent:0,notebookEvent:0,lastHeard:'',replyCaption:'',...fields});
test('idle microphone never opens a drawer; wake chooses character and partial/final speech stays literal',async()=>{
  const h=harness(); await h.popup.update(snapshot({microphoneInUse:true}));assert.equal(h.page.open,false);
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'awake',activeAssistant:'liam'}));assert.equal(h.page.open,true);assert.equal(h.page.dataset.character,'liam');
  assert.equal(h.$('.drawer-result').textContent,'No result yet.');
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'awake',commandSpeechActive:true,lastHeard:'<b>two</b>',transcriptFinal:false}));
  assert.equal(h.$('.drawer-transcript').textContent,'<b>two</b>');assert.equal(h.$('.drawer-transcript-kind').textContent,'Tentative');assert.equal(h.page.dataset.phase,'capturing');
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'review',lastHeard:'two plus two',transcriptFinal:true}));assert.equal(h.$('.drawer-transcript-kind').textContent,'Final');assert.equal(h.page.dataset.phase,'processing');
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'response',replyPlaying:true,replyCaption:'Four.'}));assert.equal(h.$('.drawer-result').textContent,'Four.');assert.equal(h.page.dataset.phase,'responding');
});
test('dismissal survives results and polling; next wake opens; swipe and outside click dismiss',async()=>{
  const h=harness(),s=snapshot({wakeEvent:1,capturePhase:'awake'});await h.popup.update(s);
  h.$('.notebook-popup-close').click();await h.popup.update({...s,capturePhase:'response',replyCaption:'Done.'});assert.equal(h.page.open,false);
  await h.popup.update({...s,wakeEvent:2});assert.equal(h.page.open,true);
  const handle=h.$('.notebook-popup-handle');handle.dispatch('pointerdown',{clientY:20,pointerId:1});handle.dispatch('pointermove',{clientY:90});assert.equal(h.page.open,false);
  await h.popup.update({...s,wakeEvent:3});h.page.click({target:h.page,clientX:3,clientY:20});assert.equal(h.page.open,false);
  await h.popup.update({...s,wakeEvent:4});h.page.dispatch('cancel',{preventDefault(){}});assert.equal(h.page.open,false);
});
test('false wake, failures and disabling never manufacture success; timers retain priority',async()=>{
  const h=harness();await h.popup.update(snapshot({wakeEvent:1,capturePhase:'awake'}));
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'retry'}));assert.match(h.$('.drawer-result').textContent,/No command was confirmed/);assert.equal(h.page.dataset.success,'false');
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'response',replyCaption:'Could not save your list.'}));assert.equal(h.$('.drawer-result').textContent,'Could not save your list.');
  await h.popup.update(snapshot({wakeEvent:1,listeningStatus:'disabled'}));assert.equal(h.page.open,false);
  await h.popup.update(snapshot({wakeEvent:2,capturePhase:'awake',activeTimers:[{remainingSeconds:0}]}));assert.equal(h.page.open,false);
});
test('saved list reads are authoritative and stale responses are discarded',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'awake'}));
  const next=h.popup.update(snapshot({wakeEvent:1,capturePhase:'response',notebookEvent:1,notebookListId:'groceries'}));
  resolve({status:'read',notebook:{lists:[{id:'groceries',name:'Groceries',items:[{text:'Milk',completed:false}]}]}});await next;
  assert.equal(h.$('.notebook-popup-items').children[0].children[1].textContent,'Milk');assert.match(h.$('.notebook-popup-status').textContent,/read from your vault/);
  const stale=h.popup.update(snapshot({wakeEvent:1,notebookEvent:2,notebookListId:'groceries'}));h.popup.close();resolve({status:'read',notebook:{lists:[]}});await stale;assert.equal(h.page.open,false);
});
test('tabs reach existing routes and Calendar reports unavailability; calculator buttons work',()=>{
  const h=harness();for(const [name,hash] of [['lists','#notebook'],['vault','#vault'],['settings','#luna']]){h.$(`[data-destination="${name}"]`).click();assert.equal(h.location.hash,hash);}
  h.$('[data-destination="calendar"]').click();assert.match(h.$('.drawer-unavailable').textContent,/not available/);
  h.popup.setCharacter('liam');assert.equal(h.$('.drawer-calculator').hidden,false);
  const input=h.$('#calculator-expression');input.value='3';h.$('.calculator-keys').children.find(b=>b.textContent==='x²').click();assert.equal(input.value,'3^2');
  h.$('.calculator-keys').children.find(b=>b.textContent==='Enter').click();assert.equal(h.$('.calculator-result').textContent,'9');
  h.$('.calculator-keys').children.find(b=>b.textContent==='AC').click();assert.equal(input.value,'');assert.equal(h.$('.calculator-result').textContent,'');
});
test('manual calculator remains usable with listening disabled; disconnected requests report failure',async()=>{
  const h=harness();h.popup.setCharacter('liam');h.popup.open();
  await h.popup.update(snapshot({capturePhase:'off',listeningStatus:'disabled'}));assert.equal(h.page.open,true);assert.equal(h.$('.drawer-phase').textContent,'Listening disabled');
  h.popup.close();await h.popup.update(snapshot({wakeEvent:1,capturePhase:'awake'}));
  await h.popup.update(snapshot({wakeEvent:1,listeningStatus:'disconnected',commandError:'Recognition failed.'}));assert.equal(h.page.open,true);assert.equal(h.$('.drawer-result').textContent,'Recognition failed.');
});

test('Liam only calculates finalized mathematical speech and clears it on the next wake',async()=>{
  const h=harness();
  await h.popup.update(snapshot({wakeEvent:1,activeAssistant:'liam',capturePhase:'awake',lastHeard:'What is 2 plus 3?',transcriptFinal:false}));
  assert.equal(h.$('.calculator-result').textContent,'');
  await h.popup.update(snapshot({wakeEvent:1,capturePhase:'review',lastHeard:'What is 2 plus 3?',transcriptFinal:true}));assert.equal(h.$('.calculator-result').textContent,'5');
  await h.popup.update(snapshot({wakeEvent:2,activeAssistant:'liam',capturePhase:'awake'}));assert.equal(h.$('.calculator-result').textContent,'');
});
