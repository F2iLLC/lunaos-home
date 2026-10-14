import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The pinned Tauri CLI generates machine-specific Android files. Keep this
// narrow transformation reproducible instead of committing local SDK paths.
export function offlineManifest(xml, { softwareRendering = false } = {}) {
  if (typeof softwareRendering !== 'boolean') throw new Error('Unexpected Android rendering option.');
  const activities = [...xml.matchAll(/<activity(?=\s|>)[^>]*>/g)]
    .map(match => match[0]).filter(tag => /\bandroid:name="\.MainActivity"/.test(tag));
  if ((xml.match(/<application\b/g) || []).length !== 1 || activities.length !== 1) {
    throw new Error('Unexpected Android template. Review it before building.');
  }
  const activity = activities[0];
  const rendering = `android:hardwareAccelerated="${!softwareRendering}"`;
  const existingRendering = activity.match(/\bandroid:hardwareAccelerated="[^"]*"/g) || [];
  if (existingRendering.length > 1 || (activity.includes('android:hardwareAccelerated') &&
      (existingRendering.length !== 1 || !/^android:hardwareAccelerated="(?:true|false)"$/.test(existingRendering[0])))) {
    throw new Error('Unexpected Android rendering policy. Review it before building.');
  }
  // Set this before activity/WebView creation. Every build explicitly chooses
  // its mode, so an opt-in software build cannot contaminate a later normal one.
  xml = xml.replace(activity, existingRendering.length
    ? activity.replace(existingRendering[0], rendering)
    : activity.replace('<activity', `<activity ${rendering}`));
  xml = xml.replace(/\s*<uses-permission android:name="android\.permission\.INTERNET"\s*\/>/, '');
  if (/<uses-permission\b/.test(xml)) throw new Error('The offline preview must not request Android permissions.');
  return xml.replace(/<application\b[^>]*>/, tag => {
    if (!/android:usesCleartextTraffic="(?:\$\{usesCleartextTraffic\}|false)"/.test(tag)) {
      throw new Error('Unexpected Android network policy. Review it before building.');
    }
    tag = tag.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"');
    if (/android:allowBackup=/.test(tag)) {
      if (!tag.includes('android:allowBackup="false"')) throw new Error('Unexpected Android backup policy.');
    } else {
      tag = tag.replace('<application', '<application android:allowBackup="false"');
    }
    return tag;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--software-rendering')) {
    throw new Error('Usage: node scripts/prepare-android.mjs [--software-rendering]');
  }
  const softwareRendering = args[0] === '--software-rendering';
  const path = new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url);
  let manifest;
  try { manifest = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Initialize Android first: npm run native:android -- init --ci --skip-targets-install');
  }
  await writeFile(path, offlineManifest(manifest, { softwareRendering }));
  console.log(`Prepared offline Android source manifest: no requested permissions, cleartext disabled, backup disabled; MainActivity hardware acceleration ${softwareRendering ? 'disabled' : 'enabled'}.`);
}
