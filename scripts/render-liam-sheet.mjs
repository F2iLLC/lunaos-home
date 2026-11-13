// Optional static review using an existing sharp installation, never bundled.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LUNA_STATES, lunaAvatarMarkup } from '../src/luna/avatar.js';
const require = createRequire(import.meta.url);
const sharp = require(process.env.LIAM_SHARP_MODULE || 'sharp');
const path = name => new URL(`../docs/liam/${name}`, import.meta.url);
const css = await readFile(new URL('../src/luna/avatar.css', import.meta.url), 'utf8');
const tiles = [];
for (const [i, state] of LUNA_STATES.entries()) {
  for (const [j, character] of ['luna', 'liam'].entries()) {
    const svg = await readFile(path(`states/${character}-${state}.svg`));
    const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) assert.equal(data[(y * info.width + x) * 4 + 3], 0, `${character}/${state} touches canvas edge`);
    }
    if (character === 'luna') {
      const original = lunaAvatarMarkup({ state, reducedMotion: true }).replace('</svg>', () => `<style>${css}</style></svg>`);
      const expected = await sharp(Buffer.from(original)).ensureAlpha().raw().toBuffer();
      assert.ok(data.equals(expected), `Luna ${state} pixels must match the production renderer`);
    }
    tiles.push({ input: await sharp(svg).resize(240, 270).png().toBuffer(), left: (i % 4) * 500 + j * 240 + 10, top: Math.floor(i / 4) * 330 + 40 });
  }
  tiles.push({ input: Buffer.from(`<svg width="500" height="40"><text x="250" y="28" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#e5eaff">${state}</text></svg>`), left: (i % 4) * 500, top: Math.floor(i / 4) * 330 });
}
await sharp({ create: { width: 2000, height: 660, channels: 4, background: '#22283e' } }).composite(tiles).png().toFile(path('state-sheet.png').pathname);
console.log('PASS: all 16 SVGs rasterized; transparent canvas edges; all 8 Luna renders pixel-identical to production. Saved docs/liam/state-sheet.png. Static checks do not certify motion.');
