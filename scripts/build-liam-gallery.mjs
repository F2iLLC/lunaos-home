import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = name => new URL(`../${name}`, import.meta.url);
const [avatarCss, galleryCss] = await Promise.all([
  readFile(path('src/luna/avatar.css'), 'utf8'), readFile(path('scripts/character-preview/gallery.css'), 'utf8'),
]);
const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/character-preview/gallery.js'], bundle: true, write: false, format: 'iife', globalName: 'CharacterPreview', target: 'es2022' });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luna + Liam · Character studio</title><style>${galleryCss}</style><style id="avatar-css">${avatarCss}</style></head><body>
<header><div class="brand">☾ &nbsp; LunaOS / Character studio</div><div class="badge">Development preview · Not connected to Home</div></header><main>
<p class="eyebrow">A familiar face. A new little inventor.</p><h1>Meet <span>Liam.</span><br>Luna’s blue-haired counterpart.</h1><p class="intro">Periwinkle hair, round glasses, a moon clip and a little science coat. Built on Luna 2.0’s exact face and body proportions, with the same expressions and gentle movements.</p>
<div id="states" aria-label="Character animation state"></div><p id="note" aria-live="polite"></p>
<div class="toolbar"><label>View <select id="view"><option value="both">Side by side</option><option value="luna">Luna</option><option value="liam">Liam</option></select></label><label><input type="checkbox" id="motion" checked> Animate</label><label><input type="checkbox" id="guides"> Proportion guides</label><label>Size <select id="size"><option value="300">300 px</option><option value="128">128 px</option><option value="48">48 px</option></select></label><label>Speaking mouth <select id="mouth"><option value="auto">Automatic</option><option value="0">Closed</option><option value="0.2">Small</option><option value="0.8">Wide</option></select></label></div>
<section class="comparison" id="comparison" aria-label="Luna and Liam animation comparison"><article class="portrait" id="luna-card"><div class="art" id="luna"></div><h2>Luna</h2><p>The approved Luna 2.0 reference</p></article><article class="portrait liam" id="liam-card"><div class="art" id="liam"></div><h2>Liam</h2><p>Curious mind. Big blue energy.</p></article></section>
<p class="caption">Shared 320 × 360 canvas · Identical face, hands and pose pivots · System reduced-motion preference takes priority</p><div class="actions"><button id="replay">Replay together</button><label>Export <select id="export-character"><option value="liam">Liam</option><option value="luna">Luna</option></select></label><button id="export">Save current SVG</button></div>
<div class="section-head"><h2>Every expression, together.</h2><p>Static comparisons / choose a state above to see it move.</p></div><section class="state-grid" id="sheet" aria-label="All eight expression pairs"></section>
<div class="section-head"><h2>Same little foundations.</h2><p>Live DOM checks for both characters</p></div><button id="verify">Check rendering invariants</button><pre id="checks">Checks have not run in this browser.</pre>
</main><footer>Design preview only. No microphone, voice playback, assistant requests, accounts or saved preferences.<br>Both characters use Home’s production SVG, styles and controller. Liam shares Luna’s exact face, body, hands and pose pivots.</footer><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(path('docs/liam'), { recursive: true });
await writeFile(path('docs/liam/gallery.html'), html);
console.log('Built docs/liam/gallery.html — standalone, offline character preview.');
