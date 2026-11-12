import { mountCharacter, CHARACTER_STATES, CHARACTERS } from './avatar.js';
const $ = selector => document.querySelector(selector);
const pair = ['luna', 'liam'].map(character => mountCharacter($(`#${character}`), { character }));
const all = [...pair];
let state = 'idle';
const notes = {
  idle: 'A quiet breath and irregular blinks. Same face, same tiny proportions.',
  listening: 'Wake-word activation preview. The shared listening marks appear; no microphone is used.',
  thinking: 'The same head tilt, upward glance and little thinking hand.',
  talking: 'Shared mouth poses and timing. Use the mouth control to inspect each pose.',
  working: 'Matching typing gestures on their tiny laptops.',
  happy: 'Crescent eyes, a cheerful bounce and golden stars.',
  error: 'Surprise settles into concern. Replay to see the transition.',
  sleeping: 'Matching sleep masks, gentle breathing, aligned snoring mouths and floating Zs.',
};
function syncClocks(controllers) {
  // Only align existing CSS clocks for comparison; no new animation or frame loop.
  for (const controller of controllers) for (const animation of controller.element.getAnimations({ subtree: true })) animation.currentTime = 0;
}
function choose(next) {
  state = next;
  for (const c of pair) c.update({ state });
  syncClocks(pair);
  for (const b of document.querySelectorAll('[data-state-button]')) b.setAttribute('aria-pressed', String(b.dataset.stateButton === state));
  $('#note').textContent = notes[state];
}
for (const s of CHARACTER_STATES) {
  const b = document.createElement('button'); b.textContent = s === 'talking' ? 'Speaking' : s[0].toUpperCase() + s.slice(1); b.dataset.stateButton = s;
  b.onclick = () => choose(s); $('#states').append(b);
  const card = document.createElement('article'); card.className = 'state-card';
  card.innerHTML = `<h3>${b.textContent}</h3><div class="mini-pair"><div></div><div></div></div><p>Luna <span>+ Liam</span></p>`;
  [...card.querySelectorAll('.mini-pair > div')].forEach((host, i) => all.push(mountCharacter(host, { character: i ? 'liam' : 'luna', state: s, reducedMotion: true })));
  $('#sheet').append(card);
}
$('#motion').onchange = e => { for (const c of pair) c.update({ reducedMotion: !e.target.checked }); syncClocks(pair); };
$('#view').onchange = e => { for (const id of Object.keys(CHARACTERS)) $(`#${id}-card`).hidden = e.target.value !== 'both' && e.target.value !== id; };
$('#guides').onchange = e => $('#comparison').classList.toggle('guides', e.target.checked);
$('#mouth').onchange = e => { for (const c of pair) c.update({ audioLevel: e.target.value === 'auto' ? undefined : Number(e.target.value) }); };
$('#size').onchange = e => { $('#comparison').style.setProperty('--character-width', `${e.target.value}px`); };
$('#replay').onclick = () => syncClocks(pair);
$('#export').onclick = () => {
  const svg = pair[$('#export-character').value === 'liam' ? 1 : 0].element.cloneNode(true);
  svg.dataset.reducedMotion = 'true'; delete svg.dataset.paused;
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = $('#avatar-css').textContent; svg.append(style);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const a = document.createElement('a'); a.href = url; a.download = `${svg.dataset.character}-${state}.svg`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Runs on the real mounted DOM. Used by both the review button and browser tests.
export function verifyGallery() {
  const failures = [];
  const selectors = ['.l2-face-base', '.l2-cheeks', '.l2-eye-gaze', '.l2-eyes-shut', '.l2-eyes-blink', '.l2-brows', '.l2-mouth-smile', '.l2-mouth-small', '.l2-mouth-wide', '.l2-mouth-concern', '.l2-mouth-snore'];
  const snapshots = pair.map(c => [...c.element.querySelectorAll('*')]);
  for (let cycle = 0; cycle < 40; cycle++) for (const s of CHARACTER_STATES) {
    pair.forEach((c, i) => {
      c.update({ state: s });
      const nodes = [...c.element.querySelectorAll('*')];
      if (nodes.length !== snapshots[i].length || nodes.some((n, j) => n !== snapshots[i][j])) failures.push('Node identity changed');
      const matrix = c.element.querySelector('.l2-face-base').getCTM();
      if (matrix && Math.abs(Math.hypot(matrix.a, matrix.b) - Math.hypot(matrix.c, matrix.d)) > .001) failures.push('Face stretched');
    });
    for (const selector of selectors) if (pair[0].element.querySelector(selector).outerHTML !== pair[1].element.querySelector(selector).outerHTML) failures.push(`Face mismatch: ${selector}`);
  }
  choose(state);
  const result = { passed: failures.length === 0, transitions: 640, identicalFaceGroups: selectors.length, failures: [...new Set(failures)] };
  $('#checks').textContent = result.passed ? 'PASS · 640 transitions · stable SVG nodes · 11 identical face groups · no unequal face scaling' : JSON.stringify(result);
  return result;
}
$('#verify').onclick = verifyGallery;
window.addEventListener('pagehide', () => all.forEach(c => c.dispose()));
choose('idle');
