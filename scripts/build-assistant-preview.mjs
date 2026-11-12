// Development-only live browser fixture. Production sources are bundled unchanged.
// All service boundaries below return synthetic data; no microphone or vault is used.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || resolve(tmpdir(), 'luna-assistant-preview'));
await mkdir(output, { recursive: true });
const result = await build({ absWorkingDir: root, entryPoints: ['src/native.js'], bundle: true, write: false, format: 'esm', target: 'es2022', define: { __ANDROID_VAULT_DEBUG__: 'true' } });
const [template, css, avatarCss] = await Promise.all(['src/index.html', 'src/styles.css', 'src/luna/avatar.css'].map(p => readFile(resolve(root, p), 'utf8')));
const fixture = `
window.addEventListener('error', event => window.parent.postMessage({previewError:event.message}, '*'));
let sequence = 0;
let snapshot = { status:'ready', listeningStatus:'enabled', listeningEnabled:true, capturePhase:'waiting', wakeEvent:0, notebookEvent:0, activeTimers:[], voices:[], activeAssistant:'luna', transcriptFinal:false, lastHeard:'',replyCaption:'' };
const book = {lists:[{id:'demo-groceries',name:'Groceries',type:'grocery',items:[{id:'milk',text:'Milk',completed:false},{id:'eggs',text:'Eggs',completed:false},{id:'bread',text:'Bread',completed:false}]}]};
window.fetch = async () => { throw Error('Network unavailable in this synthetic UI fixture.'); };
window.__TAURI__ = {core:{invoke:async(command) => {
 if(command==='get_luna_snapshot') return {...snapshot};
 if(command==='notebook_request') return JSON.stringify({status:'read',notebook:book});
 if(command==='enable_luna_wake') { snapshot.listeningStatus='enabled'; snapshot.listeningEnabled=true; snapshot.capturePhase='waiting'; return; }
 if(command==='disable_luna_wake') { snapshot.listeningStatus='disabled'; snapshot.listeningEnabled=false; snapshot.capturePhase='off'; return; }
 throw Error('Native action unavailable in this synthetic UI fixture.');
}}};
window.setPreviewScenario = async name => {
 const liam=name.startsWith('liam');
 const choice=document.querySelector('#home-character');choice.value=liam?'liam':'luna';choice.dispatchEvent(new Event('change'));
 const outfit=document.querySelector('#liam-outfit');outfit.value=name.includes('science')?'science':'everyday';outfit.dispatchEvent(new Event('change'));
 document.querySelector('.notebook-popup-close')?.click();
 snapshot = {...snapshot,activeAssistant:liam?'liam':'luna',wakeEvent:++sequence,notebookEvent:sequence,notebookListId:'',replyCaption:'',commandError:'',lastHeard:'',transcriptFinal:true,commandSpeechActive:false,replyPlaying:true,capturePhase:'response',listeningStatus:'enabled',listeningEnabled:true};
 if(name==='luna-notebook') Object.assign(snapshot,{lastHeard:'Add milk, eggs, and bread to my grocery list.',replyCaption:'Added milk, eggs, and bread to Groceries.',notebookAnimation:'checkmark',notebookListId:'demo-groceries'});
 if(name==='luna-listening') Object.assign(snapshot,{capturePhase:'awake',lastHeard:'Add milk and',transcriptFinal:false,commandSpeechActive:true});
 if(liam) Object.assign(snapshot,{lastHeard:'Graph sin(x)',replyCaption:'The local calculator below evaluates this expression.',notebookAnimation:''});
 if(name.endsWith('home')) Object.assign(snapshot,{capturePhase:'waiting',wakeEvent:0,replyPlaying:false,lastHeard:'',replyCaption:''});
 if(name==='liam-sleeping') Object.assign(snapshot,{capturePhase:'off',listeningStatus:'disabled',listeningEnabled:false,replyPlaying:false,lastHeard:'',replyCaption:''});
 document.querySelector('#refresh-luna-state').click();
};
`;
let html = template.replace(/<link rel="stylesheet" href="\/styles.css">/, `<style>${css}</style>`).replace(/<link rel="stylesheet" href="\/luna\/avatar.css">/, `<style>${avatarCss}</style>`).replace(/  <script type="module" src="[^\"]+"><\/script>\n/g, '');
html = html.replace('</body>', () => `<script>${fixture}</script><script>(async () => {${result.outputFiles[0].text.replaceAll('</script','<\\/script')}\nwindow.parent.postMessage('preview-ready','*');})().catch(error => window.parent.postMessage({previewError:error.message}, '*'));</script></body>`);
const encoded = JSON.stringify(html).replaceAll('<', '\\u003c');
const outer = `<!doctype html><html><head><meta charset="utf-8"><title>LunaOS Home · Live UI preview</title><style>body{margin:0;padding:16px;background:#181a2b;color:#f8f0ff;font:14px system-ui}header{max-width:1024px;margin:0 auto 14px}h1{font-size:19px;margin:0 0 5px}p{margin:5px 0;color:#d8cde8}nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}button{font:inherit;border:1px solid #9386af;background:#3d3657;color:white;padding:8px 12px;border-radius:8px;cursor:pointer}button:focus{outline:3px solid #b3d8ef}iframe{display:block;width:1024px;height:700px;border:0;margin:auto;background:#303451}label{margin-left:12px}</style></head><body><header><h1>LunaOS Home · Live implementation preview</h1><p>Actual Home UI • Synthetic voice and list snapshots • No microphone or vault connection</p><nav><button data-scene="luna-notebook">Luna notebook</button><button data-scene="luna-listening">Tentative speech</button><button data-scene="liam-calculator">Liam calculator</button><button data-scene="liam-home">Everyday Liam</button><button data-scene="liam-science-home">Science Liam</button><button data-scene="liam-sleeping">Listening disabled</button></nav><p>Viewport: <span id="size">1024 × 700</span><label><input id="narrow" type="checkbox">390px portrait</label></p></header><iframe title="Running LunaOS Home"></iframe><script>const frame=document.querySelector('iframe');frame.srcdoc=${encoded};window.addEventListener('message',e=>{if(e.data?.previewError) document.querySelector('h1').textContent=e.data.previewError;if(e.source===frame.contentWindow&&e.data==='preview-ready') frame.contentWindow.setPreviewScenario('luna-notebook');});for(const button of document.querySelectorAll('[data-scene]'))button.onclick=()=>frame.contentWindow.setPreviewScenario(button.dataset.scene);document.querySelector('#narrow').onchange=e=>{frame.style.width=e.target.checked?'390px':'1024px';document.querySelector('#size').textContent=e.target.checked?'390 × 700':'1024 × 700';};</script></body></html>`;
await writeFile(resolve(output, 'index.html'), outer);
console.log(`Built ${resolve(output, 'index.html')}`);
