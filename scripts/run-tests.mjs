import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = readdirSync(join(root, 'test'))
  .filter(name => name.endsWith('.test.js'))
  .filter(name => process.platform === 'linux' || name !== 'android-container.test.js')
  .sort()
  .map(name => join('test', name));

if (files.length === 0) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
