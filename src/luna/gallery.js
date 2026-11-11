import { LUNA_STATES, LUNA_OUTFITS, mountLunaAvatar, lunaAvatarMarkup } from './avatar.js';
const $ = selector => document.querySelector(selector);
const names = { idle:'Idle', listening:'Listening', thinking:'Thinking', talking:'Talking', working:'Working', happy:'Happy / success', error:'Oops / error', sleeping:'Sleeping' };
const notes = {
  idle:'A quiet breath, soft hair movement, and occasional blinks.',
  listening:'Mint listening halo, attentive eyes, and lightly lifted pigtails.',
  thinking:'A small tilt, upward glance, and three quiet thinking dots.',
  talking:'Three simple mouth poses. This gallery demonstrates motion without audio.',
  working:'A tiny laptop and alternating typing hands. No completion cue.',
  happy:'Happy crescent eyes, one brief bounce, and small golden stars.',
  error:'A brief surprised mouth settles into concern. Error details belong in text.',
  sleeping:'Lavender moon mask, slow breathing, and floating Zs. No sound.',
};
const controllers = [];
const sizeControllers = [];
const mount = (host, props) => { const controller = mountLunaAvatar(host, props); controllers.push(controller); return controller; };
const featured = mount($('#featured'), {state:'idle', size:340});
let activeState = 'idle', outfit = 'home', reduced = false;
function chooseState(state) {
  activeState = state;
  featured.update({state});
  $('#state-name').textContent = names[state];
  $('#state-note').textContent = notes[state];
  for (const b of document.querySelectorAll('[data-choose-state]')) b.setAttribute('aria-pressed', String(b.dataset.chooseState === state));
}
for (const state of LUNA_STATES) {
  const b = document.createElement('button'); b.textContent = names[state]; b.dataset.chooseState = state;
  b.addEventListener('click', () => chooseState(state)); $('#states').append(b);
}
for (const wardrobe of LUNA_OUTFITS) {
  for (const state of LUNA_STATES) {
    const card = document.createElement('article'); card.className = 'state-card';
    card.innerHTML = `<div class="card-art"></div><h3>${names[state]}</h3><p>${notes[state]}</p>`;
    mount(card.querySelector('.card-art'), { state, outfit:wardrobe });
    $(`#${wardrobe}-grid`).append(card);
  }
}
for (const size of [48, 128, 256]) {
  const card = document.createElement('figure'); card.innerHTML = `<div class="size-art"></div><figcaption>${size} × ${size}<small>${size === 48 ? 'Icon · simplified details' : size === 128 ? 'Panel · clear silhouette' : 'Character · full detail'}</small></figcaption>`;
  sizeControllers.push(mount(card.querySelector('.size-art'), { size, reducedMotion:true })); $('#sizes').append(card);
}
const comparison = mount($('#after'), {size:256,reducedMotion:true});
$('#outfit').addEventListener('change', event => {
  outfit = event.target.value; featured.update({outfit});
  comparison.update({outfit});
  for (const controller of sizeControllers) controller.update({outfit});
});
$('#motion').addEventListener('change', event => {
  reduced = !event.target.checked;
  for (const controller of controllers) controller.update({reducedMotion:reduced});
});
$('#replay').addEventListener('click', () => {
  // Restart just the finite celebration/error CSS animations, never the SVG nodes.
  for (const animation of featured.element.getAnimations({subtree:true})) {
    if (['l2-celebrate','l2-sparkle','l2-surprise','l2-concern'].includes(animation.animationName)) animation.currentTime = 0;
  }
});
$('#fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if ($('#stage').requestFullscreen) await $('#stage').requestFullscreen();
  else $('#stage').classList.toggle('expanded');
});
$('#download').addEventListener('click', () => {
  const css = $('#avatar-css').textContent;
  const svg = lunaAvatarMarkup({state:activeState,outfit,reducedMotion:true}).replace('</svg>', () => `<style>${css}</style></svg>`);
  download(svg, `luna-${outfit}-${activeState}.svg`, 'image/svg+xml');
});
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let running = false, frame, observer;
$('#measure').addEventListener('click', () => {
  if (running) return;
  running = true; const frames=[], tasks=[]; let start, previous;
  const result = $('#metrics'); result.textContent='Measuring 10 seconds. Keep this tab visible…';
  $('#measure').disabled=true;
  const supportsLongTasks = globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask');
  if (supportsLongTasks) { observer=new PerformanceObserver(list => tasks.push(...list.getEntries().map(e=>e.duration))); observer.observe({type:'longtask'}); }
  function stop(message) {
    running=false; cancelAnimationFrame(frame); observer?.disconnect(); $('#measure').disabled=false;
    document.removeEventListener('visibilitychange', hidden); if(message)result.textContent=message;
  }
  function hidden() { if(document.hidden)stop('Measurement canceled because the page became hidden.'); }
  document.addEventListener('visibilitychange',hidden);
  function tick(time) {
    start ??= time; if(previous !== undefined)frames.push(time-previous); previous=time;
    if(time-start<10000) {frame=requestAnimationFrame(tick);return;}
    stop(); frames.sort((a,b)=>a-b);
    const report={date:new Date().toISOString(),userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],state:activeState,outfit,reducedMotion:featured.element.dataset.reducedMotion==='true',
      seconds:+((time-start)/1000).toFixed(2),frames:frames.length,fps:+(1000*frames.length/(time-start)).toFixed(1),p95FrameMs:+frames[Math.floor(frames.length*.95)].toFixed(2),framesOver25ms:frames.filter(x=>x>25).length,
      longTasks:supportsLongTasks ? tasks.length : 'unsupported',longestTaskMs:supportsLongTasks ? Math.max(0,...tasks) : 'unsupported',svgNodes:featured.element.querySelectorAll('*').length,
      avatars:controllers.length,activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length};
    result.textContent=JSON.stringify(report,null,2);
    $('#save-metrics').hidden=false; $('#save-metrics').onclick=()=>download(JSON.stringify(report,null,2),'luna-gallery-performance.json','application/json');
  }
  frame=requestAnimationFrame(tick);
});
$('#verify').addEventListener('click', () => {
  const svg=featured.element, nodes=[...svg.querySelectorAll('*')];
  const face=svg.querySelector('.l2-face-base');
  const failures=[];
  const previous={state:activeState,outfit};
  for(let cycle=0;cycle<20;cycle++)for(const wardrobe of LUNA_OUTFITS)for(const state of LUNA_STATES){
    featured.update({state,outfit:wardrobe});
    if(svg.querySelector('.l2-face-base')!==face || face.getAttribute('cx')!=='160' || face.getAttribute('cy')!=='149' || face.getAttribute('rx')!=='87' || face.getAttribute('ry')!=='77')failures.push('Face geometry changed');
    if([...svg.querySelectorAll('*')].some((n,i)=>n!==nodes[i]))failures.push('SVG nodes replaced');
    const matrix=face.getCTM();
    if(matrix && Math.abs(Math.hypot(matrix.a,matrix.b)-Math.hypot(matrix.c,matrix.d))>.001)failures.push('Nonuniform face scale');
  }
  featured.update(previous);
  const ids=[...document.querySelectorAll('svg [id]')].map(n=>n.id);
  if(new Set(ids).size!==ids.length)failures.push('Duplicate SVG IDs');
  $('#checks').textContent=failures.length ? failures.join('\n') : `PASS · 320 state/outfit transitions · ${nodes.length} stable SVG nodes · fixed oval face · no SVG ID collisions`;
});
window.addEventListener('pagehide',()=>{for(const c of controllers)c.dispose();cancelAnimationFrame(frame);observer?.disconnect();});
chooseState('idle');
