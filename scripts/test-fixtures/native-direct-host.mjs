import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { startWindowsVerifiedDirectHost } from '../../lib/windows-verified-direct-host.js';

// Explicit interactive opt-in only. Never called by the unattended test mode.
export async function launchNativeDirectHost(options) {
  if (process.platform !== 'win32' || !process.stdin.isTTY) throw Error('Run native verification from an attended Windows terminal.');
  const binary = fileURLToPath(new URL('../../src-tauri/target/debug/lunaos-home-preview.exe', import.meta.url));
  await access(binary); // Build this checkout's native target first.
  const child = spawn(binary, ['--fictional-windows-vault'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
      const match = /^HOME_WINDOWS_EVENT:(lock|suspend|resume|session-change|window-close)$/.exec(line);
      if (match && nativeEvents.length < 16) nativeEvents.push({ reason: match[1], at: new Date().toISOString() });
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
