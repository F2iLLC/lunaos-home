// Design preview from the actual Android vector paths/colors; not a device screenshot.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = process.argv[2];
if (!destination || !destination.endsWith('.svg')) throw new Error('Supply an output .svg path.');
const resource = path => readFile(new URL(`../src-tauri/android/res/${path}`, import.meta.url), 'utf8');
const gradient = await resource('drawable/resting_gradient.xml');
const sky = await resource('drawable/resting_sky.xml');
const strings = await resource('values/resting_strings.xml');
const color = name => gradient.match(new RegExp(`android:${name}="(#[A-F0-9]+)"`))[1];
const greeting = strings.match(/name="resting_greeting">([^<]+)</)[1];
const paths = [...sky.matchAll(/<path android:fillColor="(#[A-F0-9]+)" android:pathData="([^"]+)"/g)].map(([, fill, path]) => {
  const alpha = fill.length === 9 ? parseInt(fill.slice(1, 3), 16) / 255 : 1;
  return `<path fill="${fill.length === 9 ? '#' + fill.slice(3) : fill}" opacity="${alpha}" d="${path}"/>`;
}).join('\n');
await writeFile(resolve(destination), `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
<title>Luna OS resting screen — design preview, example time</title>
<defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color('startColor')}"/><stop offset=".5" stop-color="${color('centerColor')}"/><stop offset="1" stop-color="${color('endColor')}"/></linearGradient></defs>
<path fill="url(#dusk)" d="M0,0 H1280 V800 H0 Z"/>
${paths}
<text x="640" y="427" text-anchor="middle" fill="#FFF5EF" font-family="Segoe UI, sans-serif" font-weight="300" font-size="144">9:41 PM</text>
<text x="640" y="495" text-anchor="middle" fill="#EEE0EC" font-family="Segoe UI, sans-serif" font-weight="300" font-size="36">${greeting}</text>
</svg>\n`);
console.log('Wrote a static design preview with an example clock; device typography may differ.');
