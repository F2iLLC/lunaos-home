import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildChatgptPlugin } from '../scripts/build-chatgpt-plugin.mjs';
import { probeChatgptPlugin } from '../scripts/probe-chatgpt-plugin.mjs';

test('local plugin is self-contained after cache relocation and preserves existing destinations', { timeout: 180000 }, async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'home-plugin-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const output = resolve(temp, 'marketplace');
  await assert.rejects(buildChatgptPlugin('relative-path'), /absolute/);
  await assert.rejects(buildChatgptPlugin(resolve('plugin-test-output')), /outside/);
  const plugin = await buildChatgptPlugin(output);
  await writeFile(resolve(output, 'keep.txt'), 'existing destination');
  await assert.rejects(buildChatgptPlugin(output), { code: 'EEXIST' });
  assert.equal(await readFile(resolve(output, 'keep.txt'), 'utf8'), 'existing destination');
  const manifest = JSON.parse(await readFile(resolve(plugin, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions['com.openai'].requires_local_executor, true);
  const catalog = JSON.parse(await readFile(resolve(output, '.agents/plugins/marketplace.json'), 'utf8'));
  assert.equal(resolve(output, catalog.plugins[0].source.path), plugin);
  assert.deepEqual((await readdir(resolve(plugin, 'runtime'))).sort(), ['assistant.js', 'lib', 'node_modules', 'package-lock.json', 'package.json', 'scripts', 'server.js', 'src']);
  assert.ok((await readFile(resolve(plugin, 'runtime/node_modules/@modelcontextprotocol/sdk/LICENSE'), 'utf8')).includes('MIT'));
  assert.ok((await readFile(resolve(plugin, 'runtime/node_modules/zod/LICENSE'), 'utf8')).includes('MIT'));
  const installed = resolve(temp, 'cache with spaces', 'lunaos-home-preview', 'local');
  await cp(plugin, installed, { recursive: true });
  // Remove only this test's generated source, proving the copied plugin never
  // relies on its original location or an ancestor checkout's node_modules.
  await rm(output, { recursive: true });
  const mcpPath = resolve(installed, 'mcp.json');
  const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
  const { $schema, ...withoutSchema } = mcp;
  await writeFile(mcpPath, JSON.stringify(withoutSchema));
  await assert.rejects(probeChatgptPlugin(installed), /requires the portable MCP schema/);
  await writeFile(mcpPath, JSON.stringify(mcp));
  assert.equal((await probeChatgptPlugin(installed)).packageProtocol, 'PASS');
});
