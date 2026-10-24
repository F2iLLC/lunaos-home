# Fergalicious v0.1

An opt-in Android development slice for the 2018 Cadillac XT5 (3.6L V6), preserving factory CUE. Fergalicious, **Fergie** in spoken greetings, is a LunaOS endpoint and personality profile. There is no separate assistant account, dashboard app, vehicle firmware change, vehicle telemetry, CAN access, or vehicle control.

## Implemented slice

1. In Home's Android debug build, open **Set up Fergalicious greetings** while parked. Choose the already bonded Cadillac and approve Android's companion association. Selection is by Bluetooth address, not a matching display name. It is disabled until configured.
2. Android companion presence and protected Bluetooth ACL events wake the native service. Presence alone cannot trigger speech: the service verifies the selected bonded device's A2DP profile is connected. It waits up to 30 seconds for the media connection/output.
3. The phone creates one random trip ID and sends `connected` through Home's existing TLS 1.3 transport using the enrolled Android Keystore identity and approved host pin. Pairing alone does not allow this operation: both phone configuration and host endpoint approval must enable vehicle greetings. No vault grant is created.
4. The Home service generates a short greeting using only the phone's current morning/afternoon/evening period. The existing Home MCP server exposes `home_vehicle_style`. With explicitly enabled `assistantStyleSelection`, a sampling-capable assistant may choose the bounded style/variant; no identity, trip ID, Bluetooth address, calendar, or history is sent to the model. Sampling times out after 1.4 seconds; the service falls back after 1.5 seconds. An unavailable backend uses the same kind of local factual greeting after 2.5 seconds. There is no calendar or destination integration in v0.1.
5. Android synthesizes through an installed offline English TTS voice, requests transient audio focus, and plays through the selected Bluetooth output. The player starts muted and unmutes only after observing that output, then rewinds to the beginning. Three seconds of actual silent PCM frames precede the first word, allowing CUE's media channel to wake without clipping the opening. Route loss, focus loss, disconnect, permission loss, unavailable TTS, or timeout stops playback. The phone speaker is not an intended fallback.
6. A backup-excluded, atomic current-trip marker is committed **before** playback. Brief reconnects reuse it and do not greet again. A disconnect of at least 120 seconds creates a new trip on the next connection. The backend sees `disconnected` immediately and expires it after that grace; a lost phone/network expires after a 180-second lease. Connected phones renew every 60 seconds. No trip archive is retained.
7. **Disable vehicle greetings** stops the service, ends the local session, removes companion observation/association, and clears the current vehicle configuration. A lost disconnect notification expires remotely by lease.

“Good morning. Fergie here. Excellent company. Impeccable taste.” is personality, not a statement about engine condition, appointments, or a planned destination.

## Platform constraints verified

- [Companion pairing](https://developer.android.com/develop/connectivity/bluetooth/companion-device-pairing) supplies the system consent UI and a documented foreground-service background-start exemption. Association does not establish an actual vehicle connection. Presence callbacks are hints; A2DP confirmation is required. This slice supports Android 12/API31 and later and uses the still-supported legacy companion callbacks for cross-version compatibility.
- [Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions) require Nearby devices (`BLUETOOTH_CONNECT`) for bonded-device access. CDM handles initial selection without a location permission. This app neither requests location nor derives it from discovery.
- [Foreground service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) still apply. The service is visible and declares `connectedDevice`; `mediaPlayback` is added only during speech. A force-stopped app or manufacturer power restrictions may prevent automatic starts. Background denial offers a notification to open setup while parked; notification denial can prevent that fallback.
- [Audio focus](https://developer.android.com/media/optimize/audio-focus) on target API35+ requires a foreground service or top app. Calls/other focus owners can prevent speech. No volume or Do Not Disturb override is attempted.
- [Android for Cars](https://developer.android.com/training/cars/apps/library) restricts dashboard apps to supported categories/templates and quality rules. There is no generic assistant dashboard surface assumed here. Wired Android Auto is **not** used as an identity signal, and USB/projection output is not guessed to be the Cadillac. If CUE exposes no address-matched Bluetooth media output while Android Auto is connected, this version stays quiet and offers the parked setup fallback. Actual CUE playback remains an attended acceptance check.

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
| Setup | Open **Fergalicious Preview** (or Home's vehicle setup), approve requested Android permissions, select Cadillac CUE, approve companion access | Setup says automatic greetings enabled; another device cannot qualify by name |
| Audio | Connect CUE Bluetooth with media audio enabled; select Bluetooth Audio in CUE and leave volume at a normal audible level | After the silent lead-in, exactly one complete greeting from the first word; phone status says playback completed on the selected output |
| Backend | Keep the local host running and Wi-Fi reachable | Phone says `Home session acknowledged`; host reports `connected` without identifiers |
| Automatic wake | After ending the previous trip, leave the app in the background, lock the phone, then reconnect the Cadillac | Greeting without manually opening Home; persistent vehicle notification is visible |
| Duplicate | Disconnect and reconnect in under 120 seconds, including repeated flaps | Same trip remains quiet; backend changes reconnecting/connected |
| Termination | Disconnect for at least 120 seconds | Local setup reports session ended; host reports zero sessions after grace, or after the 180-second lease if offline |
| New trip | Reconnect after the previous termination | One new greeting, potentially different wording |
| Android Auto | Repeat with wired Android Auto connected | Either confirmed vehicle audio or truthful unavailable/parked fallback; record which occurred |
| Offline | Stop the host or remove Wi-Fi, then begin a new trip | Local time-based greeting only, or explicit audio unavailable; no invented context |
| Focus loss | Interrupt greeting with another audio-focus owner | Speech stops; it does not restart or speak over a call |
| Disable | Disable in setup and reconnect | No new greeting or backend session renewal |

Do not publish raw device logs, Bluetooth identifiers, network addresses, or household screenshots as evidence. Automated output confirms protocol and state behavior, not audible sound from CUE. Hearing a greeting during setup is not proof of background wake; run the separate locked-phone case.

## Limits and extension points

This is a development slice using Home's existing prototype transport, not a production vault or remotely reachable cloud service. It needs reachable private Home hosting for backend context; away from that network it uses a local fallback. It provides at-most-once **attempts**, not transactional exactly-once sound: a crash after the durable claim can omit a greeting. An unobserved disconnect during process death or reboot is deliberately treated as uncertain and can suppress a later greeting until an observed disconnect ends the trip. No unattended test can certify CUE audibility.

The endpoint capability list currently contains only `greeting`. Future navigation handoff, selected-calendar context, conversational voice, home routines, and isolated read-only diagnostics need their own implemented permissions and validation. Location/history remain off and absent from the event schema. Do not add CAN writes or safety-critical control capabilities. Read-only telemetry must stay isolated from control networks. The current schema deliberately rejects unknown fields rather than silently accepting future sensitive data.
