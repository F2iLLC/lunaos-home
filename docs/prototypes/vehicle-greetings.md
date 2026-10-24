# Vehicle greetings v0.1

The [passenger-aware increment](vehicle-passengers.md) adds local manual presence,
owner-confirmed child profiles and simulated sensor tests while retaining this
connection, audio and trip infrastructure.

An opt-in Android vehicle companion slice that preserves the factory infotainment system. The owner configures a vehicle name and spoken nickname on the phone; source code contains only generic templates. The vehicle is a LunaOS endpoint and personality profile. There is no separate assistant account, dashboard app, vehicle firmware change, vehicle telemetry, CAN access, or vehicle control.

## Implemented slice

1. In Home's Android debug build, open **Set up vehicle greetings** while parked. Choose the already bonded vehicle and approve Android's companion association. Selection is by Bluetooth address, not a matching display name. It is disabled until configured.
2. Android companion presence and protected Bluetooth ACL events wake the native service. Presence alone cannot trigger speech: the service verifies the selected bonded device's A2DP profile is connected. It waits up to 30 seconds for the media connection/output.
3. The phone creates one random trip ID and sends `connected` through Home's existing TLS 1.3 transport using the enrolled Android Keystore identity and approved host pin. Pairing alone does not allow this operation: both phone configuration and host endpoint approval must enable vehicle greetings. No vault grant is created.
4. The Home service generates a short greeting using only the phone's current morning/afternoon/evening period. The existing Home MCP server exposes `home_vehicle_style`. With explicitly enabled `assistantStyleSelection`, a sampling-capable assistant may choose the bounded style/variant; no identity, trip ID, Bluetooth address, calendar, or history is sent to the model. Sampling times out after 1.4 seconds; the service falls back after 1.5 seconds. An unavailable backend uses the same kind of local factual greeting after 2.5 seconds. There is no calendar or destination integration in v0.1.
5. Android uses an installed offline English TTS voice by default, or an owner-provisioned ElevenLabs greeting cache. It requests transient audio focus and plays through the selected Bluetooth output. The player starts muted, observes the output, rewinds to the beginning, then verifies the route again before unmuting. Four seconds of actual silent PCM frames precede the first word, allowing vehicle audio's media channel to wake without clipping the opening. Route loss, focus loss, disconnect, permission loss, unavailable speech, or timeout stops playback. The phone speaker is not an intended fallback.
6. A backup-excluded, atomic current-trip marker is committed **before** playback. Brief reconnects reuse it and do not greet again. A disconnect of at least 120 seconds creates a new trip on the next connection. The backend sees `disconnected` immediately and expires it after that grace; a lost phone/network expires after a 180-second lease. Connected phones renew every 60 seconds. No trip archive is retained.
7. **Disable vehicle greetings** stops the service, ends the local session, removes companion observation/association, and clears the current vehicle configuration. A lost disconnect notification expires remotely by lease.

The repertoire has twelve greetings across warm, witty, and dramatic styles. The phone remembers only the last greeting ID, committed with the playback claim, and excludes it from the next trip's choice—even after a process restart or a time-of-day change. If the assistant selects the previous expression, the phone chooses another. Unknown model text is never spoken. The four-second lead-in and one-attempt-per-trip policy apply to every variation.

In setup, **Vehicle name** labels the local vehicle and **Name used in greetings** supplies the spoken nickname. Tap **Save greeting names**; both stay in app-private, backup-excluded configuration. The defaults are “My vehicle” and “LunaOS.” The backend returns a bounded template with a `{name}` placeholder, which the phone fills locally. Neither name is sent to Home or to model sampling. The vehicle model and engine are not needed for this greeting-only capability and are not hardcoded or collected.

“Good morning. Example here. Excellent company. Impeccable taste.” is personality, not a statement about engine condition, appointments, or a planned destination.

## Optional cached ElevenLabs voice

The voice ID is private phone configuration, with no owner-specific ID or audio in the repository. Leaving **ElevenLabs voice ID** blank selects the Android offline voice. Selecting an ID requires an externally prepared cache for that exact voice, nickname, and greeting repertoire. A missing, corrupt, or stale clip stays silent with an actionable audio status; it never silently substitutes another voice. Changing names or voice during preparation cancels the pending greeting before its trip claim.

For this developer preview, prepare speech separately using the owner's authorized ElevenLabs connection or account, then import it into the isolated preview. This is not an automatic provider integration or conversational cloud TTS. Provider synthesis receives the greeting text, including the selected nickname, and incurs provider charges. No Bluetooth address, trip ID, location, calendar, Home records, or API key belongs in the pack. No provider request occurs when connecting to the vehicle.

1. Use `greetingTexts(nickname)` from `scripts/vehicle-voice-pack.mjs` to obtain all 28 distinct texts (twelve expressions across three periods, with period-independent expressions reused). Generate one clip per text using the configured voice.
2. Convert each clip to PCM16 WAV, for example `ffmpeg -i input.mp3 -map_metadata -1 -ac 1 -ar 24000 -c:a pcm_s16le output.wav`. Keep the pack outside every checkout.
3. Create an external JSON manifest with `voiceId`, `nickname`, and `clips`: each clip has exact `text`, a relative `file` path, and the WAV's lowercase SHA-256 in `sha256`. The nickname must match phone setup. Audio files are at most 2 MiB each. Do not commit the manifest, generated audio, provider links, credentials, or real names.
4. Install the updated isolated harness using its existing signing key, then run:

   ```powershell
   node scripts/install-vehicle-voice.mjs <android-sdk> <selected-phone> <external-manifest.json>
   adb -s <selected-phone> shell am instrument -w -e mode verify-voice io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
   ```

The importer validates the whole local pack first. It writes a content-addressed folder into the app's backup-excluded storage; the on-device production reader checks every clip's hash and PCM structure before atomically selecting the new voice/pack. Incomplete imports leave the old selection intact. It preserves the vehicle association, names, last greeting and current trip claim. Old packs remain private until app data is explicitly cleared or the preview uninstalled. Provisioning currently targets only the isolated developer harness; Home's debug build shares the playback/UI code but has no end-user cache import screen yet.

Verify reports 28 clips without playing or fabricating a vehicle connection. For audible acceptance, end the previous trip by disconnecting for at least two minutes, then reconnect while parked with Bluetooth media audio selected. Confirm the chosen voice, a complete first word, quiet reconnect within two minutes, and continued offline operation. The setup audio line identifies cached ElevenLabs playback separately from Android TTS. Audibility still requires the physical vehicle check.

## Platform constraints verified

- [Companion pairing](https://developer.android.com/develop/connectivity/bluetooth/companion-device-pairing) supplies the system consent UI and a documented foreground-service background-start exemption. Association does not establish an actual vehicle connection. Presence callbacks are hints; A2DP confirmation is required. This slice supports Android 12/API31 and later and uses the still-supported legacy companion callbacks for cross-version compatibility.
- [Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions) require Nearby devices (`BLUETOOTH_CONNECT`) for bonded-device access. CDM handles initial selection without a location permission. This app neither requests location nor derives it from discovery.
- [Bluetooth broadcast exemptions](https://developer.android.com/develop/background-work/background-tasks/broadcasts/broadcast-exceptions) allow the manifest receiver to wake for an A2DP media reconnection even if the hands-free/ACL connection never dropped. Speech rechecks the actual output after asynchronous preparation before unmuting.
- [Foreground service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) still apply. The service is visible and declares `connectedDevice`; `mediaPlayback` is added only during speech. A force-stopped app or manufacturer power restrictions may prevent automatic starts. Background denial offers a notification to open setup while parked; notification denial can prevent that fallback.
- [Audio focus](https://developer.android.com/media/optimize/audio-focus) on target API35+ requires a foreground service or top app. Calls/other focus owners can prevent speech. No volume or Do Not Disturb override is attempted.
- [Android for Cars](https://developer.android.com/training/cars/apps/library) restricts dashboard apps to supported categories/templates and quality rules. There is no generic assistant dashboard surface assumed here. Wired Android Auto is **not** used as an identity signal, and USB/projection output is not guessed to be the vehicle. If vehicle audio exposes no address-matched Bluetooth media output while Android Auto is connected, this version stays quiet and offers the parked setup fallback. Actual vehicle audio playback remains an attended acceptance check.

## Build and local checks

Use Node 24+, JDK and the existing Android SDK prerequisites:

```powershell
npm ci --ignore-scripts
npm test
```

The test suite exercises the real Java trip state machine, exact silent lead-in length and preservation of spoken samples, real TLS peer admission and revocation, independent vehicle permissions, lease/grace boundaries, stale/duplicate events, assistant selection failures, forbidden fields, and unchanged Home behavior. Tests use synthetic fixtures only. `prepare-android.mjs` includes the same vehicle Java sources in Home's debug source set and preserves the permission-free release shell. Build Home through its existing Android procedure.

For an isolated attended test without replacing an existing Home install:

```powershell
./scripts/build-vehicle-probe.ps1 -OutputDirectory <new-directory-outside-checkout> -Sdk <android-sdk> -Jdk <jdk>
adb -s <selected-phone> install <output>/vehicle.apk
adb -s <selected-phone> shell am instrument -w io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
node scripts/test-vehicle-device-host.mjs <android-sdk> <selected-phone> <computer-private-ipv4>
```

The developer host explicitly enrolls only that isolated test app's public certificate, writes the host's public trust configuration into its no-backup directory, and grants **vehicle events only**. It does not change the OS trust store, expose the unauthenticated preview server, or unlock any vault. The temporary host identity expires after one day. Keep the Node process running and the phone/computer on an owner-controlled reachable private network. The script does not open firewall rules. USB is needed for initial test provisioning only. Stop the host with Ctrl+C. The harness package is `io.github.f2illc.lunaos.home.vehicleprobe`; uninstall it explicitly when finished. Installing over an existing signed harness requires the same development key; do not delete an existing install to bypass a signature mismatch.

For a transport-only diagnostic when a firewall blocks Wi-Fi, pass `127.0.0.1 --usb` instead of the private address. This creates an explicit `adb reverse` tunnel for the isolated harness only; Home itself cannot opt into this exception. It is **not** Wi-Fi or vehicle acceptance. The helper removes its reverse mapping on graceful exit. Run instrumentation with `-e mode network` to check actual TLS and enrolled resume without fabricating a vehicle connection, or `-e mode audio` for sanitized current route/playback evidence. No device names, Bluetooth addresses, certificates, or trip IDs are returned by those diagnostics.

For the existing assistant client, `node scripts/vehicle-assistant.mjs <absolute-private-config>` serves the same Home MCP tools and paired vehicle transport. The private JSON contains absolute external paths `hostCert`, `hostKey`, `ca`, `approvedPhoneCert`, the private `bindAddress`, `vehicleGreetings: true`, and optionally `assistantStyleSelection: true`. The approved phone certificate is an explicit enrollment decision. Standard output is reserved for MCP; the selected port is reported on stderr. Configure the phone's existing private `config.json` with `transportAddress`, `port`, `hostFingerprint`, and `vehicleGreetings: true`, plus `ca.pem` and its existing Keystore identity. The phone resumes that existing pairing. Do not copy key material, private addresses, device IDs, or configuration into source control. Client support for MCP sampling is optional and must be tested with that client; a subscription does not imply unattended model access.

## Parked vehicle acceptance procedure

Use a passenger/operator for all phone interaction. Keep the vehicle parked throughout.

| Check | Action | Required observation |
| --- | --- | --- |
| Setup | Open **Vehicle Preview** (or Home's vehicle setup), approve requested Android permissions, select your vehicle audio system, approve companion access | Setup says automatic greetings enabled; another device cannot qualify by name |
| Audio | Connect vehicle audio Bluetooth with media audio enabled; select Bluetooth Audio in vehicle audio and leave volume at a normal audible level | After the silent lead-in, exactly one complete greeting from the first word; phone status says playback completed on the selected output |
| Backend | Keep the local host running and Wi-Fi reachable | Phone says `Home session acknowledged`; host reports `connected` without identifiers |
| Automatic wake | After ending the previous trip, leave the app in the background, lock the phone, then reconnect the vehicle | Greeting without manually opening Home; persistent vehicle notification is visible |
| Duplicate | Disconnect and reconnect in under 120 seconds, including repeated flaps | Same trip remains quiet; backend changes reconnecting/connected |
| Termination | Disconnect for at least 120 seconds | Local setup reports session ended; host reports zero sessions after grace, or after the 180-second lease if offline |
| New trip | Reconnect after the previous termination | One new greeting, potentially different wording |
| Android Auto | Repeat with wired Android Auto connected | Either confirmed vehicle audio or truthful unavailable/parked fallback; record which occurred |
| Offline | Stop the host or remove Wi-Fi, then begin a new trip | Local time-based greeting only, or explicit audio unavailable; no invented context |
| Focus loss | Interrupt greeting with another audio-focus owner | Speech stops; it does not restart or speak over a call |
| Disable | Disable in setup and reconnect | No new greeting or backend session renewal |

Do not publish raw device logs, Bluetooth identifiers, network addresses, or household screenshots as evidence. Automated output confirms protocol and state behavior, not audible sound from vehicle audio. Hearing a greeting during setup is not proof of background wake; run the separate locked-phone case.

## Limits and extension points

This is a development slice using Home's existing prototype transport, not a production vault or remotely reachable cloud service. It needs reachable private Home hosting for backend context; away from that network it uses a local fallback. It provides at-most-once **attempts**, not transactional exactly-once sound: a crash after the durable claim can omit a greeting. An unobserved disconnect during process death or reboot is deliberately treated as uncertain and can suppress a later greeting until an observed disconnect ends the trip. No unattended test can certify vehicle audio audibility.

The endpoint capability list currently contains only `greeting`. Future navigation handoff, selected-calendar context, conversational voice, home routines, and isolated read-only diagnostics need their own implemented permissions and validation. Location/history remain off and absent from the event schema. Do not add CAN writes or safety-critical control capabilities. Read-only telemetry must stay isolated from control networks. The current schema deliberately rejects unknown fields rather than silently accepting future sensitive data.
