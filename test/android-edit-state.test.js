import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tool = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
let jdk = true;
try { execFileSync(tool('javac'), ['-version'], { stdio: 'pipe', windowsHide: true }); } catch { jdk = false; }
test('actual Java draft state requires readback after conflict, unknown, End and restart', { skip: !jdk && 'JDK unavailable; no Java state execution claimed' }, async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'home-edit-state-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(tool('javac'), ['-d', output, 'scripts/android-direct-tls-probe/VersionedEditState.java', 'test/fixtures/VersionedEditStateProbe.java'], { stdio: 'pipe', windowsHide: true, timeout: 30_000 });
  const result = execFileSync(tool('java'), ['-cp', output, 'io.github.f2illc.lunaos.directtlsprobe.VersionedEditStateProbe'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.match(result, /^PASS:/);
});
