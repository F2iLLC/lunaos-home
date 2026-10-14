import test from 'node:test';
import assert from 'node:assert/strict';
import { readWallpaper, saveWallpaper } from '../src/wallpaper.js';

test('wallpaper choice survives a new read without changing other preferences', () => {
  const values = new Map([['unrelated-test-preference', 'keep']]);
  const storage = () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  assert.equal(readWallpaper(storage).value, 'twilight');
  assert.equal(saveWallpaper('aurora', storage), true);
  assert.equal(readWallpaper(storage).value, 'aurora');
  assert.equal(saveWallpaper('twilight', storage), true);
  assert.equal(readWallpaper(storage).value, 'twilight');
  assert.equal(values.get('unrelated-test-preference'), 'keep');
  assert.equal(values.size, 2);
});

test('unavailable storage and unknown values do not break Home or load arbitrary images', () => {
  const blocked = () => { throw new Error('Storage unavailable'); };
  assert.deepEqual(readWallpaper(blocked), { value: 'twilight', available: false });
  assert.equal(saveWallpaper('aurora', blocked), false);
  assert.throws(() => saveWallpaper('https://example.test/image.png', blocked), /available wallpapers/);
  assert.deepEqual(readWallpaper(() => ({ getItem: () => 'https://example.test/image.png' })), { value: 'twilight', available: true });
});
