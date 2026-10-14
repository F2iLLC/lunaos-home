import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const supportedTargets = ['x86_64-pc-windows-msvc', 'x86_64-linux-android', 'aarch64-linux-android'];
const registry = 'registry+https://github.com/rust-lang/crates.io-index';
const licenseName = /^(LICENSE|LICENCE|COPYING)([._-]|$)/i;
const noticeName = /^(NOTICE|AUTHORS|COPYRIGHT)([._-]|$)/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

async function inspectPackage(pkg) {
  const gaps = [];
  if (pkg.source !== registry) return {
    name: pkg.name, version: pkg.version, source: 'requires-review',
    license: pkg.license || null, sourceArchive: null,
    files: [], gaps: ['source-needs-review'],
  };
  if (!pkg.license && !pkg.license_file) gaps.push('missing-license-declaration');
  const root = await realpath(dirname(pkg.manifest_path));
  const candidates = new Map();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if ((entry.isFile() || entry.isSymbolicLink()) && (licenseName.test(entry.name) || noticeName.test(entry.name))) {
      candidates.set(entry.name, licenseName.test(entry.name) ? 'license' : 'notice');
    }
  }
  if (pkg.license_file) candidates.set(pkg.license_file, 'license');
  const files = [];
  for (const [name, kind] of [...candidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const path = resolve(root, name);
    if (!within(root, path)) throw new Error(`License path leaves package: ${pkg.name}@${pkg.version}`);
    let actual;
    try { actual = await realpath(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      gaps.push('declared-license-file-missing');
      continue;
    }
    if (!within(root, actual)) throw new Error(`License link leaves package: ${pkg.name}@${pkg.version}`);
    const bytes = await readFile(actual);
    if (!bytes.toString('utf8').trim()) gaps.push(`empty-${kind}-file`);
    files.push({ path: relative(root, path).split(sep).join('/'), kind, bytes: bytes.length, sha256: hash(bytes) });
  }
  if (!files.some(file => file.kind === 'license' && file.bytes > 0)) gaps.push('license-text-not-found');
  return {
    name: pkg.name, version: pkg.version,
    source: pkg.source === registry ? 'crates.io' : 'requires-review',
    license: pkg.license || null,
    sourceArchive: pkg.source === registry ? `https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/download` : null,
    files, gaps: [...new Set(gaps)].sort(),
  };
}

// Metadata must come from a locked, target-filtered Cargo invocation. Paths are
// used only to inspect that resolved dependency tree, never included in output.
export async function inventoryNativeLicenses(inputs, homeManifest, lockfileBytes) {
  if (!inputs.length) throw new Error('At least one target is required.');
  const homePath = await realpath(homeManifest);
  const seenTargets = new Set();
  const packages = new Map();
  const targets = [];
  for (const { target, metadata } of inputs) {
    if (!supportedTargets.includes(target) || seenTargets.has(target)) throw new Error('Unsupported or duplicate target.');
    seenTargets.add(target);
    if (!metadata.resolve?.root || !Array.isArray(metadata.resolve.nodes)) throw new Error('Cargo resolution is required.');
    const byId = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
    if (byId.size !== metadata.packages.length) throw new Error('Duplicate Cargo package identity.');
    const home = byId.get(metadata.resolve.root);
    if (!home || await realpath(home.manifest_path) !== homePath) throw new Error('Unexpected Cargo root.');
    if (!metadata.resolve.nodes.some(node => node.id === metadata.resolve.root)) throw new Error('Root is missing from Cargo resolution.');
    let count = 0;
    const seenNodes = new Set();
    for (const node of metadata.resolve.nodes) {
      if (seenNodes.has(node.id)) throw new Error('Duplicate resolved package.');
      seenNodes.add(node.id);
      const pkg = byId.get(node.id);
      if (!pkg) throw new Error('Resolved package is missing metadata.');
      if (node.id === metadata.resolve.root) continue;
      count++;
      const key = `${pkg.name}@${pkg.version}`;
      const inspected = await inspectPackage(pkg);
      const existing = packages.get(key);
      if (existing) {
        const { targets: previousTargets, ...previous } = existing;
        if (JSON.stringify(previous) !== JSON.stringify(inspected)) throw new Error(`Inconsistent package across targets: ${key}`);
        previousTargets.push(target);
      } else packages.set(key, { ...inspected, targets: [target] });
    }
    targets.push({ target, packageCount: count });
  }
  const ordered = [...packages.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, pkg]) => ({ ...pkg, targets: pkg.targets.sort() }));
  return {
    schemaVersion: 1,
    scope: 'Cargo target dependencies including build dependencies; root license/notice files and declared license_file only',
    distributionApproved: false,
    limitations: [
      'File discovery does not establish complete license obligations or redistribution approval.',
      'Nested/vendor notices, Java/Gradle, bundled native SDK/runtime files and source-availability obligations require separate review.',
      'This report is an inventory, not the license text bundle shown to users.',
    ],
    cargoLockSha256: hash(lockfileBytes),
    targets: targets.sort((a, b) => a.target < b.target ? -1 : 1),
    packages: ordered,
    packagesWithGaps: ordered.filter(pkg => pkg.gaps.length).length,
  };
}

async function main(args) {
  let output;
  const targets = [];
  while (args.length) {
    const option = args.shift();
    if (option === '--output' && !output && args[0]) output = args.shift();
    else if (option === '--target' && args[0]) targets.push(args.shift());
    else throw new Error('Usage: node scripts/audit-native-licenses.mjs --output <report.json> [--target <triple>]');
  }
  if (!output) throw new Error('Choose an output path outside the checkout with --output.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outputPath = resolve(output);
  const outputParent = await realpath(dirname(outputPath));
  const actualRoot = await realpath(root);
  if (within(actualRoot, outputPath) || within(actualRoot, outputParent)) throw new Error('Keep generated audit reports outside the checkout.');
  if (!targets.length) targets.push(...supportedTargets);
  if (targets.some(target => !supportedTargets.includes(target)) || new Set(targets).size !== targets.length) throw new Error('Unsupported or duplicate target.');
  const manifest = resolve(root, 'src-tauri/Cargo.toml');
  const lockPath = resolve(root, 'src-tauri/Cargo.lock');
  const lockBefore = await readFile(lockPath);
  const inputs = targets.map(target => ({
    target,
    metadata: JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', manifest, '--locked', '--offline', '--format-version', '1', '--filter-platform', target], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })),
  }));
  const report = await inventoryNativeLicenses(inputs, manifest, lockBefore);
  if (!lockBefore.equals(await readFile(lockPath))) throw new Error('Cargo lockfile changed during inventory.');
  // Exclusive creation avoids following a pre-existing output symlink or
  // overwriting an earlier report. Pick a new filename for each invocation.
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Inventoried ${report.packages.length} distinct packages across ${report.targets.length} targets; ${report.packagesWithGaps} packages need license-file/source review.`);
  console.log('Native redistribution remains unapproved. See the report limitations and THIRD_PARTY.md.');
  process.exitCode = report.packagesWithGaps ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
