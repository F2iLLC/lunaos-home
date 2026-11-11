import { timingSafeEqual } from 'node:crypto';

// Fixed loopback recognizer. Audio is bounded, memory-only and never retried.
export function createMacSpeechHandler({ token, fetchImpl = fetch }) {
  let busy = false;
  return async (req, res) => {
    const end = status => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
    const expected = `Bearer ${token}`, supplied = req.headers.authorization;
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return end(401);
    if (req.method !== 'POST' || req.url !== '/recognize' || req.headers['content-type'] !== 'application/octet-stream') return end(400);
    if (busy) return end(429);
    busy = true;
    const chunks = []; let bytes, size = 0;
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 45000);
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', disconnected);
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 800000) { chunk.fill(0); return end(413); } chunks.push(chunk); }
      if (size < 3200 || size % 2) return end(400);
      bytes = Buffer.concat(chunks);
      const result = await fetchImpl('http://127.0.0.1:18744/recognize', { method: 'POST', redirect: 'error',
        headers: { Authorization: expected, 'Content-Type': 'application/octet-stream' }, body: bytes, signal: abort.signal });
      if (!result.ok) throw Error();
      const data = await result.json();
      if (typeof data.text !== 'string' || data.text.length > 1000 || /[\x00-\x1f]/.test(data.text)) throw Error();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ text: data.text }));
    } catch { if (!res.headersSent && !res.destroyed) end(503); }
    finally { for (const chunk of chunks) chunk.fill(0); bytes?.fill(0); busy = false; clearTimeout(timer); res.off('close', disconnected); }
  };
}
