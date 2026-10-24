import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './server.js';
import { createDraftStore, proposalSchema, correctionSchema, DraftError } from './lib/drafts.js';
import { vehicleStyleSchema } from './lib/vehicle-sessions.js';

export function createAssistantServer(drafts, reviewUrl, { vehicleSessions, assistantStyleSelection = false } = {}) {
  const server = new McpServer({ name: 'lunaos-home-draft-preview', version: '0.1.0' });
  if (vehicleSessions && assistantStyleSelection) vehicleSessions.setGreetingSelector(async ({ period, style }) => {
    if (!server.server.getClientCapabilities()?.sampling) throw Error('Assistant sampling unavailable');
    const result = await server.server.createMessage({
      messages: [{ role: 'user', content: { type: 'text', text: `Choose a brief LunaOS vehicle greeting expression for ${period}. Preferred style: ${style}. Return only JSON with style (warm, witty, dramatic) and variant (integer 0 through 3). Do not request tools or personal context.` } }],
      maxTokens: 80, includeContext: 'none',
    }, { timeout: 1400 });
    if (result.content.type !== 'text') throw Error('Unsupported greeting selection');
    return JSON.parse(result.content.text);
  });
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const call = action => async input => {
    try { return result(action(input)); }
    catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof DraftError ? error.message : 'Invalid fictional draft request.' }] };
    }
  };
  if (vehicleSessions) server.registerTool('home_vehicle_style', {
    title: 'Choose LunaOS vehicle greeting style',
    description: 'Choose warm, witty or dramatic wording for the next vehicle greeting. No separate AI identity, arbitrary spoken text, calendar access, location, vehicle controls, or permission grants. Uses only the local time period supplied by the enrolled phone. Names are substituted locally on the phone.',
    inputSchema: vehicleStyleSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, call(input => vehicleSessions.setStyle(input)));
  server.registerTool('home_stage_draft', {
    title: 'Show a fictional profile for review',
    description: 'Preview only. Stage supplied fictional people and details in the local Home GUI. Never use real household data, memories, mail or secrets. This cannot save vault records. Existing drafts cannot be replaced.',
    inputSchema: proposalSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, call(input => {
    const draft = drafts.stage(input);
    return { draftId: draft.id, revision: draft.revision, reviewUrl, status: 'Awaiting local review; no vault records saved.' };
  }));
  server.registerTool('home_review_requests', {
    title: 'Check fictional draft corrections',
    description: 'Read Needs review questions and user replies for this synthetic preview. Ask the returned question when no reply is present. Returns only review requests, not the whole profile. No inbox or memory access.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, call(() => drafts.pending()));
  server.registerTool('home_correct_draft', {
    title: 'Propose a corrected fictional detail',
    description: 'Correct only a flagged fictional draft field with a user reply. Use the current revision from home_review_requests. The corrected value remains unconfirmed until the user reviews it in Home. No saved records are modified.',
    inputSchema: correctionSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, call(input => {
    const draft = drafts.correct(input);
    return { draftId: draft.id, revision: draft.revision, reviewUrl, status: 'Correction ready for local confirmation.' };
  }));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LUNA_HOME_PREVIEW_PORT ?? 4183);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port.');
  const drafts = createDraftStore();
  const http = createAppServer({ drafts });
  http.listen(port, '127.0.0.1');
  await once(http, 'listening');
  const reviewUrl = `http://127.0.0.1:${http.address().port}/#vault`;
  const mcp = createAssistantServer(drafts, reviewUrl);
  mcp.server.onclose = () => http.close();
  await mcp.connect(new StdioServerTransport());
  // stdout is reserved for MCP messages; no record values are logged.
  console.error(`Luna OS Home fictional draft preview: ${reviewUrl}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await mcp.close(); http.close(); });
}
