import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const base = new URL(process.env.LUNA_HOME_WINDOWS_URL);
const key = process.env.LUNA_HOME_WINDOWS_ASSISTANT_KEY;
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
    !/^[a-f0-9-]{72}$/.test(key || '')) throw Error('Use the local fictional Windows bridge configuration.');
async function request(input) {
  const response = await fetch(new URL('/api/windows-assistant', base), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000), headers: {
      'Content-Type': 'application/json', 'X-Home-Preview': '1', 'X-Home-Assistant-Key': key, Origin: base.origin,
    }, body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error('Fictional operation refused.'), { code: value.code });
  return value;
}
const { connectionId } = await request({ action: 'connect' });
const mcp = new McpServer({ name: 'lunaos-home-windows-example', version: '0.1.0' });
let writeUncertain = false;
for (const operation of ['read', 'create', 'edit']) mcp.registerTool(`home_example_${operation}`, {
  title: `${operation} a fixed fictional Windows example`,
  description: 'Developer-only fixed Alex/Sam examples. Home must approve access locally. Reading requires a separate local approval for one record and field; other fields are withheld. Cannot approve access, choose a destination, access real records or collect private data. Do not retry an unconfirmed write; ask for a local review.',
  inputSchema: z.object({ recordId: z.enum(['alex-work', 'sam-school']) }).strict(),
  annotations: { readOnlyHint: operation === 'read', destructiveHint: false, openWorldHint: false },
}, async input => {
  try {
    if (writeUncertain) throw Object.assign(Error('Reconnect required.'), { code: 'DENIED' });
    const value = await request({ action: 'record', connectionId, operation, recordId: input.recordId });
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (error) {
    const codes = ['DENIED', 'DISCLOSURE_REQUIRED', 'NOT_FOUND', 'READ_FAILED', 'WRITE_UNKNOWN', 'INVALID', 'BUSY'];
    const code = codes.includes(error.code) ? error.code : operation === 'read' ? 'READ_FAILED' : 'WRITE_UNKNOWN';
    if (code === 'WRITE_UNKNOWN') { writeUncertain = true; await disconnect(); }
    const messages = {
      WRITE_UNKNOWN: 'Save not confirmed. Do not retry. Review locally with fresh approval.',
      READ_FAILED: 'The saved example could not be read. Check the local preview.',
      NOT_FOUND: 'This example has not been saved.',
      BUSY: 'The preview is busy. Check it locally before continuing.',
      INVALID: 'This request is not supported by the fictional example.',
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code,
      message: messages[code] || 'This operation needs the current local access and sharing approval.',
    }) }] };
  }
});
let closing;
function disconnect() {
  return closing ??= request({ action: 'disconnect', connectionId }).catch(() => {});
}
mcp.server.onclose = () => { void disconnect(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await mcp.close(); await disconnect(); });
await mcp.connect(new StdioServerTransport());
// No GUI capability, grant, configuration, record values or diagnostics on stderr.
