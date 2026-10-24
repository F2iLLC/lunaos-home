import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('simulated passenger inputs use production Java greeting, trip and playback policies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-passengers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('javac', ['-d', directory,
    ...['VehiclePassengers', 'VehicleGreetings', 'VehicleTrip', 'VehiclePlaybackGate'].map(n => `scripts/android/vehicle/${n}.java`),
    'test/java/VehiclePassengersTest.java'], { windowsHide: true });
  for (const scenario of ['driver', 'one', 'multiple', 'unknown', 'partial-negative', 'conflict', 'stale',
    'future', 'disconnect', 'late', 'too-late', 'reconnect', 'new-trip', 'named', 'unconfigured',
    'incorrect-identity', 'stale-identity', 'wrong-trip-identity', 'weight-identity', 'generic-preference',
    'silent-preference', 'silent-no-names', 'mixed-silent-no-names', 'unconfirmed-silent', 'stale-silent-no-names',
    'disabled', 'changed-before-audio', 'no-route', 'invalid-input', 'provider-failure']) {
    await t.test(scenario, () => {
      const result = execFileSync('java', ['-cp', directory,
        'io.github.f2illc.lunaos.home.vehicle.VehiclePassengersTest', scenario], { encoding: 'utf8', windowsHide: true });
      assert.match(result, /passed/);
    });
  }
});

test('Android preparation carries every maintained vehicle source', async t => {
  // The existing preparation tests exercise real copy/build inputs; this checks
  // its inventory against the independently discovered source directory.
  const { readFile } = await import('node:fs/promises');
  const prepare = await readFile(new URL('../scripts/prepare-android.mjs', import.meta.url), 'utf8');
  for (const file of await readdir(new URL('../scripts/android/vehicle/', import.meta.url))) {
    if (file.endsWith('.java')) assert.ok(prepare.includes(`'${file}'`), `missing ${file}`);
  }
});
