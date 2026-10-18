import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineManifest, insetActivity } from '../scripts/prepare-android.mjs';

test('Android activity preparation is repeatable and refuses unrelated activity changes', () => {
  const original = `package io.github.f2illc.lunaos.home.preview

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}`;
  const prepared = insetActivity(original.replace(/\n/g, '\r\n'));
  assert.equal(insetActivity(prepared), prepared);
  assert.throws(() => insetActivity(original.replace('super.onCreate(savedInstanceState)', 'super.onCreate(savedInstanceState)\n    startOtherFeature()')), /Unexpected Android activity/);
  assert.throws(() => insetActivity(prepared.replace('WindowInsetsCompat.Type.ime()', '0')), /Unexpected Android activity/);
});

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

test('generated components from another feature cannot silently enter the offline build', () => {
  for (const component of [
    '<service android:name=".RestingDreamService" android:permission="android.permission.BIND_DREAM_SERVICE" />',
    '<receiver android:name=".OtherFeatureReceiver" />',
    '<activity-alias android:name=".OtherLauncher" android:targetActivity=".MainActivity" />',
    '<activity android:name=".OtherActivity" android:exported="false" />',
  ]) {
    const contaminated = template.replace('</application>', `${component}</application>`);
    assert.throws(() => offlineManifest(contaminated), /Unexpected Android component/);
    assert.throws(() => offlineManifest(contaminated, { softwareRendering: true }), /Unexpected Android component/);
  }
  assert.doesNotThrow(() => offlineManifest(template));
});

test('software rendering is activity-scoped, preserves offline policy and resets on a normal build', () => {
  const software = offlineManifest(template, { softwareRendering: true });
  assert.match(software, /<activity android:hardwareAccelerated="false" android:name="\.MainActivity" android:exported="true"/);
  assert.doesNotMatch(software, /<application[^>]*hardwareAccelerated|uses-permission/);
  assert.match(software, /android:allowBackup="false"/);
  assert.match(software, /android:usesCleartextTraffic="false"/);
  assert.equal(offlineManifest(software, { softwareRendering: true }), software);
  const standard = offlineManifest(software);
  assert.match(standard, /<activity android:hardwareAccelerated="true" android:name="\.MainActivity"/);
  assert.equal(offlineManifest(standard, { softwareRendering: true }), software);
});

test('ambiguous activity or rendering settings fail instead of silently applying a workaround', () => {
  assert.throws(() => offlineManifest(template.replace('</application>', '<activity android:name=".MainActivity" /></application>')), /template/);
  assert.throws(() => offlineManifest(template.replace('<activity', '<activity android:hardwareAccelerated="${unknown}"')), /rendering policy/);
  assert.throws(() => offlineManifest(template.replace('<activity', '<activity android:hardwareAccelerated="false" android:hardwareAccelerated="true"')), /rendering policy/);
  assert.throws(() => offlineManifest(template, { softwareRendering: 'false' }), /rendering option/);
});
