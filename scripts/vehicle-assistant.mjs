// Opt-in local development host, using Home's existing paired TLS + MCP services.
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAssistantServer } from '../assistant.js';
import { createDraftStore } from '../lib/drafts.js';
import { certificateFingerprint, startDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createVehicleSessions } from '../lib/vehicle-sessions.js';
import { createVehicleConversations } from '../lib/vehicle-conversations.js';
import { createVehicleSpeech } from '../lib/vehicle-speech.js';
import { createVehicleModel } from '../lib/vehicle-model.js';

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
for (const pem of [cert, ca, peerCert]) {
  const certificate = new X509Certificate(pem);
  const remaining = Date.parse(certificate.validTo) - Date.now();
  if (Date.parse(certificate.validFrom) > Date.now() || remaining <= 0) throw Error('TLS identity is not currently valid. Renew through trusted enrollment; never disable verification.');
  if (remaining < 7 * 86400_000) console.error('A configured TLS certificate expires within seven days. Schedule trusted renewal before remote use.');
}
const peer = certificateFingerprint(peerCert);
const vehicles = createVehicleSessions(); vehicles.approve(peer);
const provider = config.assistantProvider ?? 'mcp';
if (!['mcp', 'openai'].includes(provider) || (config.mcpStdio === false && (provider !== 'openai' || config.assistantStyleSelection === true))) throw Error('Invalid assistant host mode.');
let conversations, vehicleAnswer;
if (config.vehicleConversations === true) {
  // Explicit conversation scope and provider disclosure are separate from greetings.
  if (config.assistantDisclosure !== true || config.speechDisclosure !== true) throw Error('Configure conversation and speech disclosure first.');
  const apiKey = process.env.LUNA_HOME_ELEVENLABS_API_KEY;
  conversations = createVehicleConversations({ nickname: config.vehicleNickname, speak: createVehicleSpeech({ apiKey, model: config.speechModel }) });
  conversations.approve(peer, config.voiceId);
  if (provider === 'openai') vehicleAnswer = createVehicleModel({ apiKey: process.env.LUNA_HOME_OPENAI_API_KEY, model: config.assistantModel });
}
const host = await startDirectVaultExperiment({ identity: { cert, key }, ca: [ca, peerCert],
  bindAddress: config.bindAddress, port: config.port, vehicleSessions: vehicles, vehicleConversations: conversations,
  // This explicit enrolled phone has vehicle access only; no record grants exist.
  pairingRegistry: { hostFingerprint: certificateFingerprint(cert), load: async () => [peer], add: async () => { throw Error('Use Home enrollment'); }, remove: async () => {} },
  store: { read: async () => { throw Error('No record scope'); }, create: async () => { throw Error('No record scope'); }, edit: async () => { throw Error('No record scope'); } },
});
const mcp = createAssistantServer(createDraftStore(), 'Local vehicle development host', {
  vehicleSessions: vehicles, vehicleConversations: conversations, vehicleAnswer, assistantStyleSelection: config.assistantStyleSelection === true,
});
let closing;
const close = () => closing ??= Promise.all([mcp.close(), host.close()]);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
mcp.server.onclose = () => { void host.close(); };
if (config.mcpStdio !== false) await mcp.connect(new StdioServerTransport());
console.error(`Home vehicle host listening on configured private address, port ${host.port}. Vehicle scope only; no vault access.`);
