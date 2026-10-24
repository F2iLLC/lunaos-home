// Opt-in local development host, using Home's existing paired TLS + MCP services.
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAssistantServer } from '../assistant.js';
import { createDraftStore } from '../lib/drafts.js';
import { certificateFingerprint, startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createVehicleSessions } from '../lib/vehicle-sessions.js';
import { createVehicleConversations } from '../lib/vehicle-conversations.js';
import { createVehicleSpeech } from '../lib/vehicle-speech.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function external(path) {
  if (!isAbsolute(path)) throw Error('Use absolute paths outside the checkout.');
  const rel = relative(root, resolve(path));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw Error('Keep private configuration outside the checkout.');
  return path;
}
const config = JSON.parse(await readFile(external(process.argv[2]), 'utf8'));
if (config.vehicleGreetings !== true) throw Error('Explicit vehicle endpoint configuration required.');
const [cert, key, ca, peerCert] = await Promise.all(['hostCert', 'hostKey', 'ca', 'approvedPhoneCert'].map(name => readFile(external(config[name]))));
const peer = certificateFingerprint(peerCert);
const vehicles = createVehicleSessions(); vehicles.approve(peer);
let conversations;
if (config.vehicleConversations === true) {
  // Explicit conversation scope and provider disclosure are separate from greetings.
  if (config.assistantDisclosure !== true || config.speechDisclosure !== true) throw Error('Configure conversation and speech disclosure first.');
  const apiKey = process.env.LUNA_HOME_ELEVENLABS_API_KEY;
  conversations = createVehicleConversations({ speak: createVehicleSpeech({ apiKey, model: config.speechModel }) });
  conversations.approve(peer, config.voiceId);
}
const host = await startDirectVaultExperiment({ identity: { cert, key }, ca: [ca, peerCert],
  bindAddress: config.bindAddress, vehicleSessions: vehicles, vehicleConversations: conversations,
  // This explicit enrolled phone has vehicle access only; no record grants exist.
  pairingRegistry: { hostFingerprint: certificateFingerprint(cert), load: async () => [peer], add: async () => { throw Error('Use Home enrollment'); }, remove: async () => {} },
  store: { read: async () => { throw Error('No record scope'); }, create: async () => { throw Error('No record scope'); }, edit: async () => { throw Error('No record scope'); } },
});
const mcp = createAssistantServer(createDraftStore(), 'Local vehicle development host', {
  vehicleSessions: vehicles, vehicleConversations: conversations, assistantStyleSelection: config.assistantStyleSelection === true,
});
let closing;
const close = () => closing ??= Promise.all([mcp.close(), host.close()]);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
mcp.server.onclose = () => { void host.close(); };
await mcp.connect(new StdioServerTransport());
console.error(`Home vehicle host listening on configured private address, port ${host.port}. Vehicle scope only; no vault access.`);
