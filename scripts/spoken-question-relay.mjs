// Explicit local development relay. Provider keys never leave this process.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { parseEnv } from 'node:util';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQwenModel } from '../lib/qwen-model.js';
import { createVehicleSpeech } from '../lib/vehicle-speech.js';
import { createQuestionHandler } from '../lib/spoken-questions.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function external(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Error('External configuration required');
  const rel = relative(root, resolve(path));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw Error('Keep private files outside Git');
  return path;
}
try {
  const config = JSON.parse(await readFile(external(process.argv[2]), 'utf8'));
  if (config.enabled !== true) throw Error();
  const env = parseEnv(await readFile(external(config.envFile), 'utf8'));
  const address = config.bindAddress;
  const bytes = typeof address === 'string' ? address.split('.').map(Number) : [];
  const tailnetAddress = bytes.length === 4 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    && bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127;
  if (config.provider !== 'ollama-qwen' || typeof address !== 'string' || isIP(address) !== 4
    || (address !== '127.0.0.1' && !tailnetAddress)) throw Error();
  const handler = createQuestionHandler({ token: config.token, voiceId: config.voiceId,
    answer: createQwenModel({ endpoint: config.ollamaEndpoint ?? 'http://127.0.0.1:11434/api/chat', model: config.model ?? 'qwen3:32b' }),
    speak: createVehicleSpeech({ apiKey: env.LUNA_HOME_ELEVENLABS_API_KEY }) });
  const server = createServer({ cert: await readFile(external(config.cert)), key: await readFile(external(config.key)), minVersion: 'TLSv1.2' }, handler);
  server.requestTimeout = 60_000; server.headersTimeout = 10_000; server.timeout = 60_000;
  server.listen(18743, config.bindAddress, () => console.error('Spoken question relay ready on configured interface, port 18743.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
} catch { console.error('Spoken question relay setup failed. Check private configuration.'); process.exitCode = 1; }
