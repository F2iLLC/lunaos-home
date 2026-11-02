// Explicit local development relay. Provider keys never leave this process.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { parseEnv } from 'node:util';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVehicleModel } from '../lib/vehicle-model.js';
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
  const handler = createQuestionHandler({ token: config.token, voiceId: config.voiceId,
    answer: createVehicleModel({ apiKey: env.OPENAI_API_KEY_LUNAOS_HOME, model: config.model ?? 'gpt-6-luna' }),
    speak: createVehicleSpeech({ apiKey: env.LUNA_HOME_ELEVENLABS_API_KEY }) });
  const server = createServer({ cert: await readFile(external(config.cert)), key: await readFile(external(config.key)), minVersion: 'TLSv1.2' }, handler);
  server.requestTimeout = 60_000; server.headersTimeout = 10_000; server.timeout = 60_000;
  server.listen(18743, '127.0.0.1', () => console.error('Spoken question relay ready on local port 18743.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
} catch { console.error('Spoken question relay setup failed. Check private configuration.'); process.exitCode = 1; }
