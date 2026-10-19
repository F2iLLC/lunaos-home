import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Operates only through the runner's exact-AVD-checked adb function.
export async function checkDirectTlsGui({ adb, outputDirectory, revoke, pauseApprovals }) {
  const activity = 'io.github.f2illc.lunaos.directtlsprobe/.PairingActivity';
  const checks = [];
  const decode = value => value.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  async function snapshot() {
    await adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/direct-tls-gui.xml']);
    const xml = await adb(['shell', 'cat', '/data/local/tmp/direct-tls-gui.xml']);
    writeFileSync(path.join(outputDirectory, 'last-ui.xml'), xml);
    return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
      return attrs;
    });
  }
  async function waitText(text) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const nodes = await snapshot(); if (nodes.some(node => node.text === text)) return nodes;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(`Expected fictional UI state: ${text}`);
  }
  async function button(text, enabled) {
    const node = (await snapshot()).find(node => node.text === text && node.class === 'android.widget.Button');
    assert.ok(node, `Button missing: ${text}`); assert.equal(node.enabled, String(enabled)); return node;
  }
  async function tap(text) {
    const node = await button(text, true);
    const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
    assert.ok(right > left && bottom > top && bottom < 1794, 'Control must be visible above system navigation.');
    await adb(['shell', 'input', 'tap', String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2))]);
  }
  async function connectAndRead() {
    await tap('Connect to test computer');
    await waitText('Connected. Review and allow the selected read.');
    await button("Read Alex's record", false);
    await tap('Allow selected read');
    await waitText('Selected read allowed. Nothing read yet.');
    await tap("Read Alex's record"); await waitText('Library visit: Monday');
  }
  await adb(['shell', 'am', 'start', '-W', '-n', activity]);
  await waitText('Review the test computer identity.');
  await button('Connect to test computer', false); await button('Allow selected read', false); await button("Read Alex's record", false);
  checks.push('Initial identity and scope gates closed');
  await tap('Approve fictional computer');
  pauseApprovals(true); await tap('Connect to test computer');
  await waitText('Computer connected. Waiting for host approval...');
  await tap('End connection'); await waitText('No record shown.'); pauseApprovals(false);
  await connectAndRead();
  checks.push('End after pairing but before grant receipt reconnects without replaying the one-use offer');
  checks.push('Explicit computer approval, separate selected-read approval, authoritative Monday read');
  await tap('End connection'); await waitText('No record shown.');
  await button("Read Alex's record", false); await button('Allow selected read', false);
  await connectAndRead(); checks.push('End clears content; reconnect requires fresh selected-read approval');
  await adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  const awayDeadline = Date.now() + 20_000;
  let away = false;
  while (Date.now() < awayDeadline) {
    if (!(await snapshot()).some(node => node.package === 'io.github.f2illc.lunaos.directtlsprobe')) { away = true; break; }
  }
  assert.ok(away, 'The probe must actually leave the foreground before testing return.');
  await adb(['shell', 'am', 'start', '-W', '-n', activity]);
  await waitText('Access closed while away. Review the computer again.');
  await button('Connect to test computer', false); await button("Read Alex's record", false);
  await tap('Approve fictional computer'); await connectAndRead();
  checks.push('Background closes content and permissions; return requires identity and read approval again');
  await adb(['shell', 'am', 'force-stop', 'io.github.f2illc.lunaos.directtlsprobe']);
  await adb(['shell', 'am', 'start', '-W', '-n', activity]);
  await waitText('Review the test computer identity.');
  await button('Connect to test computer', false); await button("Read Alex's record", false);
  await tap('Approve fictional computer'); await connectAndRead();
  checks.push('Cold process restart resumes certificate admission with fresh identity and read approval; consumed offer is not replayed');
  revoke(); await tap("Read Alex's record");
  await waitText('Read unavailable. No access remains.');
  await button("Read Alex's record", false); await button('Allow selected read', false);
  assert.ok((await snapshot()).some(node => node.text === 'No record shown.'));
  checks.push('Read after host revocation fails closed and clears displayed content');
  writeFileSync(path.join(outputDirectory, 'gui-checks.json'), JSON.stringify({ result: 'PASS', checks }, null, 2) + '\n');
  return checks;
}
