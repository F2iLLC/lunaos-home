import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'native-dist');
await mkdir(output, { recursive: true });
const built = await build({
  absWorkingDir: root, entryPoints: ['src/native.js'], outfile: 'native-dist/app.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  legalComments: 'external', metafile: true,
  define: {
    __ANDROID_VAULT_DEBUG__: JSON.stringify(process.env.TAURI_ENV_DEBUG === 'true' &&
      ['android', 'androideabi'].includes(process.env.TAURI_ENV_PLATFORM)),
  },
});
if (Object.keys(built.metafile.inputs).some(path => path.includes('@modelcontextprotocol') || path === 'server.js')) {
  throw new Error('The offline package must not include the desktop MCP/HTTP service.');
}
let html = await readFile(resolve(root, 'src/index.html'), 'utf8');
html = html.replace('href="/styles.css"', 'href="./styles.css"').replace('src="/app.js"', 'src="./app.js"');
await writeFile(resolve(output, 'index.html'), html);
await copyFile(resolve(root, 'src/styles.css'), resolve(output, 'styles.css'));
await copyFile(resolve(root, 'src/windows-unlock.html'), resolve(output, 'windows-unlock.html'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
const zodLicense = await readFile(resolve(root, 'node_modules/zod/LICENSE'), 'utf8');
// Native dependency notices are added separately after Cargo resolves its lockfile.
let nativeNotices = '';
try { nativeNotices = await readFile(resolve(root, 'src-tauri/THIRD_PARTY_NOTICES.txt'), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(resolve(output, 'notices.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./styles.css"><title>Open-source notices · Luna OS Home</title></head><body><main class="vault"><a class="back-link" href="./index.html">Back home</a><h1>Open-source notices</h1><p>Returning home starts a fresh fictional draft.</p><h2>Luna OS Home · Apache-2.0</h2><pre>${escape(license)}</pre><h2>Zod · MIT</h2><pre>${escape(zodLicense)}</pre><h2>Native dependencies</h2><pre>${escape(nativeNotices || 'Native dependency notices have not been generated. This frontend-only preview is not a distributable native package.')}</pre></main></body></html>`);
console.log('Built the offline fictional draft frontend. No server or vault storage is included.');
