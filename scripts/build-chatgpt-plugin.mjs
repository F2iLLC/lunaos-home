import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const runtimeFiles = [
  'assistant.js', 'server.js', 'package.json', 'package-lock.json',
  'lib/drafts.js', 'lib/profile-review.js', 'lib/profile-draft.js',
  'lib/vehicle-sessions.js',
  'lib/vault-sessions.js', 'lib/vault-store-lifecycle.js', 'lib/vault-record-contract.js',
  'src/index.html', 'src/styles.css', 'src/app.js', 'src/tasks.js', 'src/vault.js', 'src/draft-client.js',
];
const pluginFiles = ['plugin.json', 'mcp.json', 'skills/home-draft-review/SKILL.md'];
const inside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

// A fresh external directory prevents stale contents, personal material and
// an existing plugin cache from being overwritten or swept into the package.
export async function buildChatgptPlugin(output, npmCli = process.env.npm_execpath) {
  if (!output || !isAbsolute(output)) throw new Error('Supply a new absolute output directory outside the checkout.');
  if (!npmCli || !isAbsolute(npmCli)) throw new Error('Run through npm run build:chatgpt-plugin so the npm CLI is known.');
  const parent = await realpath(dirname(output));
  output = resolve(parent, relative(dirname(output), output));
  if (inside(await realpath(root), output)) throw new Error('Plugin output must be outside the checkout.');
  await mkdir(output); // Deliberately fails if it already exists; never remove it.
  const pluginRoot = resolve(output, 'plugins/lunaos-home-preview');
  const copy = async (source, destination) => {
    if (!(await lstat(source)).isFile()) throw new Error('Only regular allowlisted source files may be packaged.');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  };
  for (const name of pluginFiles) await copy(resolve(root, 'plugins/home-draft-preview', name), resolve(pluginRoot, name));
  for (const name of runtimeFiles) await copy(resolve(root, name), resolve(pluginRoot, 'runtime', name));
  await copy(resolve(root, 'LICENSE'), resolve(pluginRoot, 'LICENSE'));
  await copy(resolve(root, 'docs/prototypes/chatgpt-local-plugin.md'), resolve(pluginRoot, 'README.md'));
  // Use the existing integrity-pinned lockfile. Never run package lifecycle
  // scripts or include development tools, .npmrc, .env, logs or repo contents.
  await run(process.execPath, [npmCli, 'ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: resolve(pluginRoot, 'runtime'), windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024,
  });
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  const licenses = [...new Set(Object.values(lock.packages).filter(pkg => !pkg.dev).map(pkg => pkg.license).filter(Boolean))].sort();
  await writeFile(resolve(pluginRoot, 'THIRD_PARTY_NOTICES.txt'),
    `The runtime includes the existing package-lock.json production dependency tree.\nDeclared licenses: ${licenses.join(', ')}.\nFull dependency licenses and notices are retained in runtime/node_modules.\nHome source is Apache-2.0; see LICENSE. No Node runtime is bundled.\n`);
  const marketplace = {
    name: 'lunaos-home-local', interface: { displayName: 'LunaOS Home local preview' },
    plugins: [{ name: 'lunaos-home-preview', source: { source: 'local', path: './plugins/lunaos-home-preview' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  };
  await mkdir(resolve(output, '.agents/plugins'), { recursive: true });
  await writeFile(resolve(output, '.agents/plugins/marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
  return pluginRoot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pluginRoot = await buildChatgptPlugin(process.argv[2]);
    console.log(`Built fictional local plugin: ${pluginRoot}`);
    console.log('Package only: no marketplace registration, installation, ChatGPT call, or record save performed.');
  } catch {
    // Dependency-manager errors can contain machine configuration. Do not
    // serialize child-process output into public build evidence.
    console.error('Plugin build failed. Use npm run build:chatgpt-plugin -- <new absolute external directory> with an existing parent and available locked dependencies. Existing output is never overwritten.');
    process.exitCode = 1;
  }
}
