import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lunaAvatarMarkup, LUNA_STATES, LUNA_OUTFITS } from '../src/luna/avatar.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const path = name => new URL(`../${name}`,import.meta.url);
const [avatarCss,galleryCss,reference]=await Promise.all([
  readFile(path('src/luna/avatar.css'),'utf8'),readFile(path('src/luna/gallery.css'),'utf8'),readFile(path('docs/luna-2/reference.png')),
]);
const bundled=await build({absWorkingDir:root,entryPoints:['src/luna/gallery.js'],bundle:true,write:false,format:'iife',target:'es2022'});
// The historical SVG is frozen here by commit, never read from live modified source.
const native=execFileSync('git',['show','823f8c0:src/native.js'],{cwd:root,encoding:'utf8'});
const before=native.match(/face.innerHTML = `([\s\S]*?)`;/)[1]
  .replace('data-capture-phase="off"','data-capture-phase="awake"');
const beforeCss='.before-art .luna-avatar-mask,.before-art .luna-avatar-snore,.before-art .luna-avatar-zs,.before-art .luna-avatar-eyes-closed,.before-art .luna-notebook-feedback{display:none}';
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luna 2.0 · Character studio</title><style>${galleryCss}${beforeCss}</style><style id="avatar-css">${avatarCss}</style></head><body>
<header><div class="brand"><span>☾</span> LunaOS · Character studio</div><div class="badge">Design review · Live assistant unchanged</div></header>
<main><section class="hero"><div><p class="eyebrow">One Luna. Two wardrobes.</p><h1>A little more<br><span>Luna.</span></h1><p class="intro">Lavender curls. A mint bow. A familiar little moon. Meet the Luna 2.0 character study, built from the approved Decora Chibi direction.</p>
<div class="controls"><div class="controls-row"><label>Wardrobe <select id="outfit"><option value="home">Home</option><option value="enterprise">Enterprise</option></select></label><label><input id="motion" type="checkbox" checked> Animate</label></div><div id="states" aria-label="Preview a character state"></div><h3 id="state-name"></h3><p id="state-note" aria-live="polite"></p></div><p class="footnote">Preview controls only. This gallery does not listen, speak, run tasks, or connect to your assistant. Your system’s reduced-motion preference always takes priority.</p></div>
<div class="stage" id="stage"><div class="stage-label">Character preview / Luna 2.0</div><div id="featured"></div><div class="stage-tools"><button id="replay">Replay reaction</button><button id="download">Save SVG</button><button id="fullscreen">Full screen</button></div></div></section>
<section><div class="section-heading"><h2>Many responsibilities.<br>One familiar face.</h2><p>Eight states, shared proportions, and small deliberate movements. Wardrobes change her clothing; her identity stays the same.</p></div><div class="wardrobe-label">01 / Home · Hoodie, hearts & pastel boots</div><div id="home-grid" class="state-grid"></div><div class="wardrobe-label">02 / Enterprise · Lavender blazer & employee badge</div><div id="enterprise-grid" class="state-grid"></div></section>
<section><div class="section-heading"><h2>Small, medium, unmistakable.</h2><p>Secondary stars, pocket decoration, and badge details disappear at icon size. The face, bow, hair, and crescent stay.</p></div><div id="sizes" class="sizes"></div></section>
<section><div class="section-heading"><h2>The direction, translated.</h2><p>A before-and-after study alongside the creative director’s reference. SVG uses simplified shapes for stable animation.</p></div><div class="comparison"><figure><div class="before-art">${before}</div><figcaption>Before · Home avatar</figcaption><p>Original wide face, cropped body, and stretched eye wake animation. Shown here as a static baseline.</p></figure><figure><div id="after"></div><figcaption>After · Luna 2.0 study</figcaption><p>Round face, full chibi outfit, curled pigtails, large bow, and a consistent set of expressions.</p></figure><figure><img src="data:image/png;base64,${reference.toString('base64')}" alt="Approved Luna 2.0 creative direction: lavender pigtails, mint bow, home and enterprise outfits, and expressive character states"><figcaption>Creative director’s reference</figcaption><p>The approved sheet is the visual source for the character, palette, and two wardrobes.</p></figure></div></section>
<section class="benchmark"><h2>Review & verification</h2><p>Use the transition check to exercise 320 state/wardrobe changes without rebuilding the character. The optional 10-second benchmark measures this gallery in your browser, with your current viewport and motion setting. It does not certify Echo Show, Skylight, or lower-powered tablets.</p><div class="actions"><button id="verify">Check rendering invariants</button><button id="measure">Measure 10 seconds</button><button id="save-metrics" hidden>Save measurement</button></div><pre id="checks">Runtime checks have not been run in this browser.</pre><pre id="metrics">No browser performance measurement yet.</pre></section>
</main><footer>Character gallery · Its controls are demonstrations, not Home events.<br>Desktop browser measurement is available; target-device performance is not certified.</footer><script>${bundled.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
await mkdir(path('docs/luna-2/states'),{recursive:true});
await writeFile(path('docs/luna-2/gallery.html'),html);
for(const outfit of LUNA_OUTFITS) for(const state of LUNA_STATES){
  const svg=lunaAvatarMarkup({state,outfit,reducedMotion:true}).replace('</svg>',()=>`<style>${avatarCss}</style></svg>`);
  await writeFile(path(`docs/luna-2/states/${outfit}-${state}.svg`),svg);
}
console.log('Built standalone gallery and 16 static SVG state previews. Live app unchanged.');
