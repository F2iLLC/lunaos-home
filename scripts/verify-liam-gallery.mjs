// Optional development verification; jsdom is a test tool, never an app dependency.
// LIAM_DOM_MODULE may point at an existing jsdom installation.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mountCharacter, CHARACTER_STATES } from './character-preview/avatar.js';
import { lunaAvatarMarkup } from '../src/luna/avatar.js';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.LIAM_DOM_MODULE || 'jsdom');
const dom = new JSDOM('<div id="luna"></div><div id="liam"></div>');
const document = dom.window.document;
const luna = mountCharacter(document.querySelector('#luna'));
const liam = mountCharacter(document.querySelector('#liam'), { character: 'liam' });
const baseline = document.createElement('div'); baseline.innerHTML = lunaAvatarMarkup();
for (const [key, value] of Object.entries(luna.element.dataset)) baseline.querySelector('svg').dataset[key] = value;
assert.equal(luna.element.outerHTML, baseline.innerHTML, 'Luna markup remains identical');
assert.equal(liam.element.getAttribute('viewBox'), '0 0 320 360');
assert.equal(liam.element.querySelectorAll('.l2-pigtail').length, 0);
const faceSelectors = ['.l2-face-base', '.l2-cheeks', '.l2-eye-gaze', '.l2-eyes-shut', '.l2-eyes-blink', '.l2-brows', '.l2-mouth-smile', '.l2-mouth-small', '.l2-mouth-wide', '.l2-mouth-concern', '.l2-mouth-snore'];
for (const selector of faceSelectors) assert.equal(liam.element.querySelector(selector).outerHTML, luna.element.querySelector(selector).outerHTML);
for (const selector of ['.l2-arm', '.l2-hand-think', '.l2-head-pose']) {
  const a = [...luna.element.querySelectorAll(selector + ' path')].filter(p => !p.closest('.l2-front-hair, .l2-accessories'));
  const b = [...liam.element.querySelectorAll(selector + ' path')].filter(p => !p.closest('.l2-front-hair, .l2-accessories'));
  assert.deepEqual(a.map(p => p.getAttribute('d')), b.map(p => p.getAttribute('d')), `${selector} geometry`);
}
for (const controller of [luna, liam]) {
  const nodes = [...controller.element.querySelectorAll('*')];
  for (let i = 0; i < 100; i++) for (const state of CHARACTER_STATES) {
    controller.update({ state });
    assert.equal(controller.element.dataset.state, state);
    assert.deepEqual([...controller.element.querySelectorAll('*')], nodes);
  }
  for (const [audioLevel, mouth] of [[0, 'closed'], [.2, 'small'], [.8, 'wide'], [undefined, 'unavailable']]) {
    controller.update({ state: 'talking', audioLevel }); assert.equal(controller.element.dataset.audio, mouth);
  }
  controller.update({ size: 48 }); assert.equal(controller.element.dataset.compact, 'true');
  controller.update({ size: 300 }); assert.equal(controller.element.dataset.compact, 'false');
}
assert.throws(() => liam.update({ outfit: 'enterprise' }), TypeError);
assert.throws(() => liam.update({ character: 'luna' }), TypeError);
assert.throws(() => liam.update({ state: 'invalid' }), TypeError);
assert.throws(() => mountCharacter(document.createElement('div'), { character: '__proto__' }), TypeError);

const css = await readFile(new URL('../src/luna/avatar.css', import.meta.url), 'utf8');
const output = new URL('../docs/liam/states/', import.meta.url);
await mkdir(output, { recursive: true });
for (const controller of [luna, liam]) for (const state of CHARACTER_STATES) {
  controller.update({ state, reducedMotion: true, size: '100%', audioLevel: undefined });
  const svg = controller.element.cloneNode(true);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = css; svg.append(style);
  svg.removeAttribute('style'); delete svg.dataset.paused;
  const serialized = new dom.window.XMLSerializer().serializeToString(svg).replace(/[ \t]+$/gm, '');
  await writeFile(new URL(`${svg.dataset.character}-${state}.svg`, output), serialized);
}
for (const controller of [luna, liam]) { controller.dispose(); controller.update({ state: 'happy' }); assert.equal(controller.element.dataset.paused, 'true'); }

// Exercise the bundled gallery and controls in a DOM. This does NOT simulate CSS
// layout, animation timing or clipping; those still require a real browser.
const errors = [];
const html = await readFile(new URL('../docs/liam/gallery.html', import.meta.url), 'utf8');
const gallery = new JSDOM(html, { runScripts: 'dangerously', beforeParse(win) {
  win.Element.prototype.getAnimations = () => [];
  win.SVGElement.prototype.getCTM = () => null;
  win.addEventListener('error', e => errors.push(e.message));
} });
const doc = gallery.window.document;
assert.deepEqual(errors, []);
assert.equal(doc.querySelectorAll('svg').length, 18);
for (const button of doc.querySelectorAll('[data-state-button]')) {
  button.click();
  for (const svg of doc.querySelectorAll('#comparison svg')) assert.equal(svg.dataset.state, button.dataset.stateButton);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
}
const view = doc.querySelector('#view'); view.value = 'liam'; view.dispatchEvent(new gallery.window.Event('change'));
assert.equal(doc.querySelector('#luna-card').hidden, true); assert.equal(doc.querySelector('#liam-card').hidden, false);
const motion = doc.querySelector('#motion'); motion.checked = false; motion.dispatchEvent(new gallery.window.Event('change'));
for (const svg of doc.querySelectorAll('#comparison svg')) assert.equal(svg.dataset.reducedMotion, 'true');
assert.equal(gallery.window.CharacterPreview.verifyGallery().passed, true);
gallery.window.dispatchEvent(new gallery.window.Event('pagehide'));
for (const svg of doc.querySelectorAll('svg')) assert.equal(svg.dataset.paused, 'true');
gallery.window.close(); dom.window.close();
console.log('PASS: unchanged Luna markup; matching faces/poses; 1,600 stable state updates; mouth presets; disposal; invalid inputs; gallery controls; 16 exported SVGs. Browser motion/layout not tested.');
