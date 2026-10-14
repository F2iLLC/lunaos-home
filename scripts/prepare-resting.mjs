import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src-tauri/android/', import.meta.url));
const marker = 'Luna Home resting screen';
const declaration = `<!-- ${marker} -->
        <service android:name=".RestingDreamService"
            android:label="@string/resting_name"
            android:exported="true"
            android:permission="android.permission.BIND_DREAM_SERVICE">
            <intent-filter>
                <action android:name="android.service.dreams.DreamService" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </service>
        <!-- End ${marker} -->`;

export function restingManifest(xml) {
  const original = xml;
  const start = `<!-- ${marker} -->`;
  const end = `<!-- End ${marker} -->`;
  if (xml.includes(start)) {
    if (xml.split(start).length !== 2 || xml.split(end).length !== 2 ||
        !xml.includes(declaration)) throw new Error('Unexpected resting service declaration.');
    xml = xml.replace(declaration, '');
  } else if (xml.includes(end)) throw new Error('Unexpected resting service declaration.');
  if (/RestingDreamService|android\.service\.dreams\.DreamService/.test(xml)) {
    throw new Error('Duplicate or unmanaged resting service.');
  }
  if (xml.split('</application>').length !== 2) throw new Error('Unexpected Android application.');
  // Replace our exact block in place on subsequent preparations (no whitespace drift).
  return original.includes(declaration)
    ? original
    : xml.replace('</application>', `${declaration}\n    </application>`);
}

export async function copyRestingSources(mainDirectory) {
  const java = join(mainDirectory, 'java/io/github/f2illc/lunaos/home/preview');
  await mkdir(java, { recursive: true });
  await copyFile(join(source, 'RestingDreamService.java'), join(java, 'RestingDreamService.java'));
  for (const type of ['layout', 'drawable', 'values']) {
    const destination = join(mainDirectory, 'res', type);
    await mkdir(destination, { recursive: true });
    for (const file of await readdir(join(source, 'res', type))) {
      await copyFile(join(source, 'res', type, file), join(destination, file));
    }
  }
}
