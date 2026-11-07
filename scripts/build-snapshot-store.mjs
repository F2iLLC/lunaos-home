import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build the WindowsSnapshotFileStore developer-harness worker into its own
// target directory so a default-feature build can never be mistaken for it.
// The default build has no fixture protector and no fault injection.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const crate = join(root, 'src-tauri', 'crates', 'windows-snapshot-store');
export const manifest = join(crate, 'Cargo.toml');
export const targetDir = join(crate, 'target', 'developer-harness');

if (process.platform !== 'win32') {
  console.error('The WindowsSnapshotFileStore worker builds on Windows only.');
  process.exit(2);
}
const args = process.argv[2] === 'test' ? ['test'] : ['build'];
const result = spawnSync(
  'cargo',
  [
    ...args,
    '--locked',
    '--features',
    'developer-harness',
    '--manifest-path',
    manifest,
    '--target-dir',
    targetDir,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  console.error(
    'cargo is required: install the stable Rust toolchain (rustup) first.',
  );
  process.exit(2);
}
process.exit(result.status ?? 1);
