import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { offlineManifest } from '../scripts/prepare-android.mjs';
import { restingManifest, copyRestingSources } from '../scripts/prepare-resting.mjs';

const template = `<manifest><application android:usesCleartextTraffic="false"><activity android:name=".MainActivity" /></application></manifest>`;

test('resting service registration stays protected, offline and idempotent across rendering profiles', () => {
  const prepared = restingManifest(offlineManifest(template, { softwareRendering: true }));
  assert.match(prepared, /android:permission="android.permission.BIND_DREAM_SERVICE"/);
  assert.match(prepared, /android:hardwareAccelerated="false"/);
  assert.match(prepared, /android:allowBackup="false"/);
  assert.doesNotMatch(prepared, /uses-permission|showWhenLocked|turnScreenOn/);
  assert.equal(restingManifest(offlineManifest(prepared, { softwareRendering: true })), prepared);
  const normal = restingManifest(offlineManifest(prepared));
  assert.match(normal, /android:hardwareAccelerated="true"/);
  assert.equal((normal.match(/<service /g) || []).length, 1);
});

test('resting preparation rejects modified permissions, duplicates and broken service blocks', () => {
  const prepared = restingManifest(template);
  assert.throws(() => restingManifest(prepared.replace('BIND_DREAM_SERVICE', 'INTERNET')), /Unexpected/);
  assert.throws(() => restingManifest(prepared.replace('</application>', '<service android:name=".RestingDreamService" /></application>')), /unmanaged/);
  assert.throws(() => restingManifest(prepared.replace('<!-- End Luna Home resting screen -->', '')), /Unexpected/);
  assert.throws(() => restingManifest(prepared + prepared), /Unexpected/);
  assert.throws(() => restingManifest('<manifest/>'), /application/);
});

test('clean generated Android project receives exact native service and resources on repeated setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-resting-'));
  try {
    await copyRestingSources(directory);
    await copyRestingSources(directory);
    for (const [source, destination] of [
      ['RestingDreamService.java', 'java/io/github/f2illc/lunaos/home/preview/RestingDreamService.java'],
      ...['layout/resting_screen.xml', 'drawable/resting_gradient.xml', 'drawable/resting_sky.xml', 'values/resting_strings.xml']
        .map(path => [`res/${path}`, `res/${path}`]),
    ]) {
      assert.equal(await readFile(join(directory, destination), 'utf8'),
        await readFile(new URL(`../src-tauri/android/${source}`, import.meta.url), 'utf8'));
    }
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('luna-resting-'));
    await rm(directory, { recursive: true, force: true });
  }
});
