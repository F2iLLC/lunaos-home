import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('production Android conversation client recovers read-only work without resending paid asks', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-conversation-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = 'test/java/conversation';
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.java')).map(file => join(root, file));
  execFileSync('javac', ['-d', directory, 'scripts/android-direct-tls-probe/VehicleConversationClient.java', ...files], { windowsHide: true });
  const result = execFileSync('java', ['-cp', directory, 'io.github.f2illc.lunaos.directtlsprobe.ConversationRecoveryTest'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  assert.match(result, /Conversation recovery passed/);
});
