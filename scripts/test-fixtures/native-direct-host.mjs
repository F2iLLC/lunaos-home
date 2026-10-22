import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { startWindowsVerifiedDirectHost } from '../../lib/windows-verified-direct-host.js';

// Explicit interactive opt-in only. Never called by the unattended test mode.
export async function launchNativeDirectHost(options) {
  if (process.platform !== 'win32' || !process.stdin.isTTY) throw Error('Run native verification from an attended Windows terminal.');
  const binary = fileURLToPath(new URL('../../src-tauri/target/debug/lunaos-home-preview.exe', import.meta.url));
  await access(binary); // Build this checkout's native target first.
  // The owner must see and complete the OS-owned verification dialog. Hiding
  // this GUI child can leave the prompt attached to an invisible owner window.
  const child = spawn(binary, ['--fictional-windows-vault'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  return superviseNativeDirectHost(child, options);
}

// Same supervision path, with a controlled child supplied by lifecycle tests.
export async function superviseNativeDirectHost(child, options, { announce = console.log } = {}) {
  const nativeEvents = [];
  let eventBuffer = '';
  child.stderr.on('data', chunk => {
    eventBuffer += chunk.toString();
    if (eventBuffer.length > 1024) { eventBuffer = ''; return; }
    while (eventBuffer.includes('\n')) {
      const end = eventBuffer.indexOf('\n'), line = eventBuffer.slice(0, end).trim();
      eventBuffer = eventBuffer.slice(end + 1);
      const event = /^HOME_WINDOWS_EVENT:(lock|suspend|resume|session-change|window-close)$/.exec(line);
      const reason = event?.[1] || (line === 'HOME_WINDOWS_CANCELED' ? 'canceled' : null);
      if (reason && nativeEvents.length < 16) nativeEvents.push({ reason, at: new Date().toISOString(), tick: performance.now() });
    }
  });
  child.stderr.resume(); // Retain only bounded lifecycle labels; discard other diagnostics.
  let verified, server;
  try {
    verified = await startWindowsVerifiedDirectHost({ ...options, child });
    server = createServer((request, response) => {
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET' || request.url !== '/windows-vault') { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Luna OS Home verification visit</title><h1>Fictional connection test</h1><p>Use the local terminal to approve the device and selected read. Closing this window ends access. No records are shown here.</p>');
    });
    let ended = false, httpClosed;
    const stop = () => {
      ended = true; verified.close().catch(() => {});
      httpClosed ??= new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
    };
    verified.ended.then(stop);
    child.on('exit', stop); child.on('error', stop); child.stdin.on('error', stop);
    server.on('error', stop);
    await Promise.race([new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    }), verified.ended.then(() => { throw Error('Native visit ended during launcher startup.'); })]);
    if (ended) throw Error('Native visit ended during launcher startup.');
    child.stdin.end(`http://127.0.0.1:${server.address().port}/windows-vault#${verified.previewKey}\n`);
    announce('Complete verification only in the Windows prompt. Pairing and each read still need separate approval.');
    return { ...verified, nativeEvents, async close() { stop(); await Promise.all([verified.close(), httpClosed]); } };
  } catch (error) {
    child.kill(); await verified?.close(); server?.close(); server?.closeAllConnections(); throw error;
  }
}

// A late OS event cannot prove it ended an active read grant. The grant clock
// starts before approval, so this is conservative even if approval takes time.
export function requireLifecycleDuringGrant(events, reason, grantTick, lifetimeMs) {
  const event = events.find(item => item.reason === reason);
  if (!event || !Number.isFinite(grantTick) || !Number.isFinite(event.tick) ||
      !Number.isFinite(lifetimeMs) || lifetimeMs <= 0 ||
      event.tick < grantTick || event.tick - grantTick >= lifetimeMs) {
    throw Error(`Native ${reason} event did not arrive during the active read grant`);
  }
  return event;
}

// stderr and stdout are separate pipes. A visit can end before its native
// cancellation diagnostic is delivered, so allow a short bounded drain.
export async function waitForNativeEvent(events, reason, timeoutMs = 1000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (events.some(item => item.reason === reason)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(events.some(item => item.reason === reason), `Require actual Windows ${reason} status`);
}

export function requireVisitDeadline(end, events, elapsedMs) {
  assert.equal(end?.reason, 'visit-deadline', 'A different event ended the visit; expiry is unproven');
  assert.ok(elapsedMs >= 295_000 && elapsedMs <= 315_000, 'Visit ended outside its five-minute expiry window');
  assert.deepEqual(events, [], 'A native lifecycle event ended the visit instead of its deadline');
}
