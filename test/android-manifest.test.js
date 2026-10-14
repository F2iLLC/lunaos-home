import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineManifest } from '../scripts/prepare-android.mjs';

const template = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:usesCleartextTraffic="\${usesCleartextTraffic}">
    <activity android:name=".MainActivity" android:exported="true" />
  </application>
</manifest>`;

test('offline Android manifest removes network access and keeps launch activity on repeat builds', () => {
  const result = offlineManifest(template);
  assert.doesNotMatch(result, /uses-permission/);
  assert.match(result, /android:usesCleartextTraffic="false"/);
  assert.match(result, /android:allowBackup="false"/);
  assert.match(result, /android:name=".MainActivity" android:exported="true"/);
  assert.equal(offlineManifest(result), result);
});

test('unexpected permissions or Android template changes fail before building', () => {
  assert.throws(() => offlineManifest(template.replace('INTERNET', 'CAMERA')), /permissions/);
  assert.throws(() => offlineManifest(template.replace('MainActivity', 'OtherActivity')), /template/);
  assert.throws(() => offlineManifest(template.replace('${usesCleartextTraffic}', 'true')), /network policy/);
  assert.throws(() => offlineManifest(template.replace('<application', '<application android:allowBackup="true"')), /backup policy/);
});
