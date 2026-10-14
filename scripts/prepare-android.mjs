import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The pinned Tauri CLI generates machine-specific Android files. Keep this
// narrow transformation reproducible instead of committing local SDK paths.
export function offlineManifest(xml) {
  if ((xml.match(/<application\b/g) || []).length !== 1 || !xml.includes('android:name=".MainActivity"')) {
    throw new Error('Unexpected Android template. Review it before building.');
  }
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
  const path = new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url);
  let manifest;
  try { manifest = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Initialize Android first: npm run native:android -- init --ci --skip-targets-install');
  }
  await writeFile(path, offlineManifest(manifest));
  console.log('Prepared offline Android source manifest: no requested permissions, cleartext disabled, backup disabled.');
}
