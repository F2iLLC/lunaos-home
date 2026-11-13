import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LUNA_STATES, LUNA_OUTFITS, lunaAvatarMarkup, mountLunaAvatar } from '../src/luna/avatar.js';

function harness() {
  const listeners = new Map(), mediaListeners = new Map(), observers = [];
  const svg = { dataset:{}, style:{}, attrs:{}, setAttribute(k,v){this.attrs[k]=v;}, getAttribute(k){return this.attrs[k];} };
  const media={matches:false,addEventListener:(name,fn)=>mediaListeners.set(name,fn),removeEventListener:name=>mediaListeners.delete(name)};
  class Observer {
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(node){this.node=node;} disconnect(){this.disconnected=true;}
  }
  const document={hidden:false,defaultView:{matchMedia:()=>media,ResizeObserver:Observer,IntersectionObserver:Observer},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  let writes=0;
  const host={ownerDocument:document,set innerHTML(value){this.markup=value;writes++;},querySelector:()=>svg};
  return {svg,host,document,media,listeners,mediaListeners,observers,writes:()=>writes};
}

test('all sixteen presentations preserve identical geometry, fixed aspect and no document-global resources',()=>{
  let geometry;
  for(const outfit of LUNA_OUTFITS)for(const state of LUNA_STATES){
    const svg=lunaAvatarMarkup({state,outfit});
    assert.match(svg,/viewBox="0 0 320 360" preserveAspectRatio="xMidYMid meet"/);
    assert.match(svg,/class="l2-face-base" cx="160" cy="149" rx="87" ry="77"/);
    assert.doesNotMatch(svg,/\bid=|url\(#|<filter|<animate/);
    const inner=svg.slice(svg.indexOf('>')+1);
    geometry ??= inner;
    assert.equal(inner,geometry,`${outfit}/${state} must not rebuild the face or wardrobe geometry`);
  }
});

test('state changes preserve the mounted SVG and never regenerate its subtree',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host);
  for(let i=0;i<100;i++)for(const state of LUNA_STATES)avatar.update({state,outfit:i%2?'home':'enterprise'});
  assert.equal(h.writes(),1);
  assert.equal(avatar.element,h.svg);
  assert.equal(h.svg.dataset.state,'sleeping');
  assert.equal(h.svg.attrs['aria-label'],'Luna — sleeping');
  avatar.dispose();
});

test('separate instances have independent state and collision-free SVG resources',()=>{
  const one=harness(), two=harness();
  const a=mountLunaAvatar(one.host,{state:'listening'}), b=mountLunaAvatar(two.host,{state:'working',outfit:'enterprise'});
  a.update({state:'happy'});
  assert.equal(one.svg.dataset.state,'happy');
  assert.equal(two.svg.dataset.state,'working');
  assert.equal(two.svg.dataset.outfit,'enterprise');
  assert.doesNotMatch(one.host.markup,/<defs|\bid=|url\(#/);
  assert.doesNotMatch(two.host.markup,/<defs|\bid=|url\(#/);
  a.dispose(); b.dispose();
});

test('outfit changes update the mounted instance without changing fixed face geometry',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host,{outfit:'home'});
  const element=avatar.element;
  avatar.update({outfit:'enterprise'});
  assert.equal(h.svg.dataset.outfit,'enterprise');
  assert.equal(avatar.element,element);
  assert.equal(h.writes(),1);
  assert.match(h.host.markup,/class="l2-face-base" cx="160" cy="149" rx="87" ry="77"/);
  avatar.update({outfit:'home'});
  assert.equal(h.svg.dataset.outfit,'home');
  avatar.dispose();
});

test('sleeping is explicitly selected, never inferred from mute, connection, or audio amplitude',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host,{state:'thinking'});
  avatar.update({audioLevel:0}); assert.equal(h.svg.dataset.state,'thinking');
  avatar.update({state:'sleeping'}); assert.equal(h.svg.dataset.state,'sleeping');
  avatar.update({state:'listening'}); assert.equal(h.svg.dataset.state,'listening');
  avatar.dispose();
});

test('sleeping swaps aligned mouth shapes without scaling; head bob stays gentle and typing stroke grows',async()=>{
  const [js,css]=await Promise.all([readFile(new URL('../src/luna/avatar.js',import.meta.url),'utf8'),readFile(new URL('../src/luna/avatar.css',import.meta.url),'utf8')]);
  assert.match(js,/class="l2-mouth-snore"[\s\S]*class="l2-snore-closed"[\s\S]*class="l2-snore-open"/);
  assert.match(css,/\[data-state="sleeping"\] \.l2-mouth-smile \{ opacity:0; \}/);
  assert.match(css,/\[data-state="sleeping"\] \.l2-mouth-snore \{ opacity:1; \}/);
  assert.match(css,/\[data-state="sleeping"\] \.l2-snore-open,[\s\S]*animation:l2-snore-open/);
  assert.doesNotMatch(css,/@keyframes l2-snore\s*\{[^}]*transform:scale/);
  assert.match(css,/\[data-state="sleeping"\] \.l2-head-pose \{ animation:l2-sleep-bob/);
  assert.match(css,/50% \{ transform:translateY\(1\.5px\) rotate\(\.6deg\); \}/);
  assert.match(css,/50% \{ transform:rotate\(-25deg\) translateY\(5px\); \}/);
});

test('presentation validates state/outfit and escapes accessible labels',()=>{
  assert.throws(()=>lunaAvatarMarkup({state:'complete'}),TypeError);
  assert.throws(()=>lunaAvatarMarkup({outfit:'admin'}),TypeError);
  assert.match(lunaAvatarMarkup({label:'<img "x"> &'}),/aria-label="&lt;img &quot;x&quot;&gt; &amp;/);
  const h=harness(), avatar=mountLunaAvatar(h.host);
  assert.throws(()=>avatar.update({state:'unknown'}),TypeError);
  assert.equal(h.svg.dataset.state,'idle');
  avatar.update({outfit:'enterprise'}); assert.equal(h.svg.dataset.state,'idle');
  avatar.dispose();
});

test('amplitude uses bounded preset mouths without starting speech or a frame loop',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host,{state:'talking'});
  for(const [level,shape] of [[-1,'closed'],[0,'closed'],[.2,'small'],[.7,'wide'],[10,'wide'],[NaN,'unavailable'],[undefined,'unavailable']]){
    avatar.update({audioLevel:level}); assert.equal(h.svg.dataset.audio,shape);
  }
  avatar.update({state:'idle',audioLevel:1}); assert.equal(h.svg.dataset.state,'idle');
  avatar.dispose();
});

test('hidden page and offscreen instances pause; disposal removes all subscriptions',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host);
  assert.equal(h.svg.dataset.paused,'false');
  h.document.hidden=true; h.listeners.get('visibilitychange')(); assert.equal(h.svg.dataset.paused,'true');
  h.document.hidden=false; h.listeners.get('visibilitychange')(); assert.equal(h.svg.dataset.paused,'false');
  h.observers[1].callback([{isIntersecting:false}]); assert.equal(h.svg.dataset.paused,'true');
  h.observers[1].callback([{isIntersecting:true}]); assert.equal(h.svg.dataset.paused,'false');
  avatar.dispose(); avatar.dispose();
  assert.equal(h.listeners.size,0); assert.equal(h.mediaListeners.size,0);
  assert.ok(h.observers.every(observer=>observer.disconnected));
  assert.equal(h.svg.dataset.paused,'true');
  avatar.update({state:'happy'}); assert.equal(h.svg.dataset.state,'idle');
});

test('system reduced-motion preference cannot be overridden by the gallery animation toggle',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host);
  h.media.matches=true; h.mediaListeners.get('change')();
  avatar.update({reducedMotion:false}); assert.equal(h.svg.dataset.reducedMotion,'true');
  h.media.matches=false; h.mediaListeners.get('change')(); assert.equal(h.svg.dataset.reducedMotion,'false');
  avatar.update({reducedMotion:true}); assert.equal(h.svg.dataset.reducedMotion,'true');
  avatar.dispose();
});

test('small and responsive avatar sizes retain detail simplification across state changes',()=>{
  const h=harness(), avatar=mountLunaAvatar(h.host,{size:48});
  assert.equal(h.svg.style.width,'48px'); assert.equal(h.svg.style.height,'48px');
  assert.equal(h.svg.dataset.compact,'true');
  avatar.update({size:256}); assert.equal(h.svg.dataset.compact,'false');
  avatar.update({size:'100%'}); h.observers[0].callback([{contentRect:{width:60}}]);
  avatar.update({state:'working'}); assert.equal(h.svg.dataset.compact,'true');
  h.observers[0].callback([{contentRect:{width:400}}]); assert.equal(h.svg.dataset.compact,'false');
  avatar.dispose();
});

test('no JS animation loop, changing geometry, blur or nonuniform face scaling enters the presentation module',async()=>{
  const [js,css]=await Promise.all([readFile(new URL('../src/luna/avatar.js',import.meta.url),'utf8'),readFile(new URL('../src/luna/avatar.css',import.meta.url),'utf8')]);
  assert.doesNotMatch(js,/requestAnimationFrame|setInterval|setTimeout|__TAURI__|fetch\(/);
  assert.doesNotMatch(css,/scale[XY]\(|filter:/);
  for (const keyframe of css.matchAll(/@keyframes[^\n]+/g)) assert.doesNotMatch(keyframe[0],/\b(width|height|top|left):/);
  assert.match(css,/\[data-paused="true"\] \* \{ animation-play-state:paused/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
});

test('Liam wardrobe and disabled listening use attributes without rebuilding his face or resetting pose',()=>{
  const h=harness(),avatar=mountLunaAvatar(h.host,{character:'liam',state:'thinking'});
  avatar.update({scienceOutfit:true});assert.equal(h.svg.dataset.scienceOutfit,'true');assert.equal(h.svg.dataset.state,'thinking');
  avatar.update({scienceOutfit:false,listeningDisabled:true});assert.equal(h.svg.dataset.listeningDisabled,'true');assert.equal(h.svg.dataset.character,'liam');
  avatar.update({listeningDisabled:false});assert.equal(h.svg.dataset.listeningDisabled,'false');assert.equal(h.writes(),1);
  assert.match(h.host.markup,/class="liam-hair"/);assert.match(h.host.markup,/class="liam-labcoat"/);assert.match(h.host.markup,/class="liam-goggles"/);
  avatar.dispose();
});

test('Liam retains Luna’s exact shared face, skeleton and pose geometry in every state',()=>{
  for (const state of LUNA_STATES) {
    const luna = lunaAvatarMarkup({state});
    for (const scienceOutfit of [false,true]) {
      const liam = lunaAvatarMarkup({state,character:'liam',scienceOutfit});
      assert.equal(liam.slice(liam.indexOf('>')+1), luna.slice(luna.indexOf('>')+1), `${state}: character selection only changes presentation attributes`);
    }
  }
});
