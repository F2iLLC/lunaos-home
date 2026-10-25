// Explicit developer provisioning for the isolated vehicle preview only.
import { execFileSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVoicePack } from './vehicle-voice-pack.mjs';

const [sdk, serial, manifest] = process.argv.slice(2);
if (!sdk || !serial || !manifest) throw Error('Usage: node scripts/install-vehicle-voice.mjs <SDK> <explicit device serial> <external private manifest.json>');
const repo = fileURLToPath(new URL('../', import.meta.url));
const rel = relative(repo, resolve(manifest));
if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw Error('Keep personal voice packs outside the checkout');
const pack = readVoicePack(manifest); // Validate every local clip before writing any device file.
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const pkg = 'io.github.f2illc.lunaos.home.vehicleprobe';
const call = (args, input) => execFileSync(adb, ['-s', serial, ...args], { input, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const directory = `no_backup/vehicle-voices/${pack.packId}`;
call(['shell', 'run-as', pkg, 'mkdir', '-p', directory]);
for (const clip of pack.clips) {
  for (const [suffix, bytes] of [['wav', clip.bytes], ['sha256', clip.digest]]) {
    // All shell-interpolated components are generated hex keys and fixed suffixes.
    const target = `${directory}/${clip.key}.${suffix}`;
    // Keep adb's Windows stdin path textual; raw PCM can be truncated at EOF
    // control bytes before it reaches the device. Decode inside app storage.
    call(['shell', '-T', 'run-as', pkg, 'sh', '-c', `'base64 -d > ${target}.pending'`], Buffer.from(bytes).toString('base64') + '\n');
    call(['shell', 'run-as', pkg, 'mv', `${target}.pending`, target]);
  }
}
const result = call(['shell', 'am', 'instrument', '-w', '-e', 'mode', 'configure-voice', '-e', 'voiceId', pack.voiceId, '-e', 'voicePack', pack.packId,
  `${pkg}/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe`]);
if (!result.includes(`verifiedVoiceClips=${pack.clips.length}`) || !/INSTRUMENTATION_CODE: 0\b/.test(result)) throw Error('Device did not activate this voice; check nickname and complete PCM cache');
console.log(`Installed and verified ${pack.clips.length} offline voice clips. Existing names, association and trip claim preserved. No playback attempted.`);
