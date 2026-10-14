import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryNativeLicenses, readNoticeBytes, supportedTargets } from './audit-native-licenses.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

// Creates review material only. A manifest written last marks a complete export;
// failed exports are left in place and must never be treated as complete bundles.
export async function bundleNativeNotices(inputs, homeManifest, lockBytes, output, checkout) {
  const root = await realpath(checkout);
  const destination = resolve(output);
  const parent = await realpath(dirname(destination));
  if (within(root, destination) || within(root, parent)) throw new Error('Keep notice bundles outside the checkout.');
  const report = await inventoryNativeLicenses(inputs, homeManifest, lockBytes);
  const sources = new Map();
  for (const { metadata } of inputs) {
    const selected = new Set(metadata.resolve.nodes.map(node => node.id));
    for (const pkg of metadata.packages) {
      if (selected.has(pkg.id) && pkg.source === 'registry+https://github.com/rust-lang/crates.io-index') {
        const key = `${pkg.name}@${pkg.version}`;
        if (!sources.has(key)) sources.set(key, pkg.manifest_path);
      }
    }
  }
  const contents = [];
  let totalBytes = 0;
  const packages = [];
  for (const [packageIndex, pkg] of report.packages.entries()) {
    const files = [];
    if (pkg.files.length) {
      const sourceRoot = await realpath(dirname(sources.get(`${pkg.name}@${pkg.version}`)));
      for (const [fileIndex, file] of pkg.files.entries()) {
        const path = resolve(sourceRoot, file.path);
        if (!within(sourceRoot, path)) throw new Error('Notice path leaves package.');
        const actual = await realpath(path);
        if (!within(sourceRoot, actual)) throw new Error('Notice link leaves package.');
        const bytes = await readNoticeBytes(actual);
        if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Notice changed after inventory; retry from fresh metadata.');
        totalBytes += bytes.length;
        if (totalBytes > 32 * 1024 * 1024) throw new Error('Combined notice text exceeds 32 MiB.');
        // Generated numeric names prevent package-controlled output paths.
        const bundlePath = `files/${String(packageIndex).padStart(4, '0')}-${String(fileIndex).padStart(3, '0')}.txt`;
        files.push({ ...file, bundlePath });
        contents.push({ bundlePath, bytes });
      }
    }
    packages.push({ ...pkg, files });
  }
  const manifest = {
    ...report,
    bundleKind: 'candidate-cargo-notices-for-review',
    complete: true,
    limitations: [
      'Complete means export finished, not that license obligations or redistribution are approved.',
      'Candidate license and notice bytes are copied verbatim; missing files and source review gaps remain open.',
      'Build dependencies are included. Java/Gradle, nested/vendor notices, native SDK/runtime terms and source-availability obligations require separate review.',
    ],
    filesCopied: contents.length, totalBytes, packages,
  };
  // Existing directories (including links) are rejected. No recursive deletion,
  // merging with earlier output, or overwriting is performed.
  await mkdir(destination);
  await mkdir(resolve(destination, 'files'));
  for (const { bundlePath, bytes } of contents) await writeFile(resolve(destination, bundlePath), bytes, { flag: 'wx' });
  await writeFile(resolve(destination, 'README.txt'),
    'CANDIDATE NOTICES - REVIEW REQUIRED\n\nThese files preserve the inspected Cargo license/notice bytes. manifest.json maps each file to its package, source archive, targets and SHA-256. Its presence marks a completed export only. Missing licenses, additional notices and source obligations still need review. This is not redistribution approval or the final in-app notice page. Keep this bundle local until reviewed.\n', { flag: 'wx' });
  await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

async function main(args) {
  let output;
  const targets = [];
  while (args.length) {
    const option = args.shift();
    if (option === '--output' && !output && args[0]) output = args.shift();
    else if (option === '--target' && args[0]) targets.push(args.shift());
    else throw new Error('Usage: node scripts/bundle-native-notices.mjs --output <new-directory> [--target <triple>]');
  }
  if (!output) throw new Error('Choose a new directory outside the checkout with --output.');
  if (!targets.length) targets.push(...supportedTargets);
  if (targets.some(target => !supportedTargets.includes(target)) || new Set(targets).size !== targets.length) throw new Error('Unsupported or duplicate target.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifestPath = resolve(root, 'src-tauri/Cargo.toml');
  const lockPath = resolve(root, 'src-tauri/Cargo.lock');
  const lockBytes = await readFile(lockPath);
  const inputs = targets.map(target => ({ target, metadata: JSON.parse(execFileSync('cargo', [
    'metadata', '--manifest-path', manifestPath, '--locked', '--offline', '--format-version', '1', '--filter-platform', target,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) }));
  if (!lockBytes.equals(await readFile(lockPath))) throw new Error('Cargo lockfile changed during resolution.');
  const result = await bundleNativeNotices(inputs, manifestPath, lockBytes, output, root);
  console.log(`Copied ${result.filesCopied} candidate files for ${result.packages.length} packages; ${result.packagesWithGaps} packages still need file/source review.`);
  console.log('Review material only. Redistribution remains unapproved.');
  process.exitCode = result.packagesWithGaps ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
