# Private cellular vehicle connection

The phone uses its ordinary Android default network to reach the enrolled Home TLS host through an owner-controlled private VPN. The overlay supplies reachability; Home still requires TLS 1.3, certificate validity, server-name verification, the exact host certificate pin, the enrolled phone certificate and separate vehicle/conversation grants. Provider keys remain on Home. No household records, public listener, router port forwarding, VPN exit node, driving control or Cadillac CUE modification is added.

## Provision the route

Inspect existing host adapters, VPN services/connections and phone VPN apps first. Reuse an owner-controlled network when available. This slice supports literal RFC1918 IPv4 destinations and RFC6598 `100.64.0.0/10` overlay addresses. Wildcard binds, public IPv4, hostnames, malformed addresses and IPv6 remain refused. Supporting the shared range does not establish that an address belongs to an authorized VPN; peer TLS admission remains mandatory.

When no private network exists, the prepared route is Tailscale on Windows and Android. Install only official packages; complete owner account sign-in and Android's VPN consent. Use the same owner-controlled tailnet. Do not invent an account, embed an auth key, enable Funnel/Serve, advertise a route or select an exit node. The APK from the official package server requires manual updates; the Play Store build is preferable for ongoing updates. See [Windows installation](https://tailscale.com/docs/install/windows), [Android installation](https://tailscale.com/docs/install/android) and [stable packages](https://dl.tailscale.com/stable/).

After both devices are enrolled and online, run the following in an authorized elevated PowerShell session, using private paths and the actual phone overlay address:

```powershell
./scripts/configure-vehicle-vpn.ps1 -HostConfig '<private-host.json>' `
  -PhoneConfig '<private-phone-config.json>' -PhoneVpnAddress '<phone-overlay-ipv4>'
```

The helper verifies that Tailscale is running, the selected phone is an online peer, and the host overlay address is assigned to a local interface. It backs up configuration, changes only the destination/bind address, stable port and adb-reverse flag, and creates one inbound TCP rule restricted to the exact host address, phone address, interface, port and Node executable. Existing rules are not overwritten. Config write failure restores both files and removes the new rule. Tailnet policy should independently limit this phone to this host's TLS port. Any existing broad policy needs owner review; this helper does not rewrite the owner's tailnet policy or unrelated firewall rules.

Restart the private host and provision only the updated public phone configuration through the existing trusted debug/enrollment channel. Preserve the existing CA/pin unless explicitly renewing the host identity. Read it back and prove enrolled TLS before using providers. USB may provision or observe this debug slice; never use adb reverse as the remote route. Verify `vehicleHarnessAdbReverse: false`. No overlay address or enrollment value belongs in the repository or PR.

## Android transitions and offline behavior

New sockets follow Android's default network, including its VPN. The app does not bind sockets/processes directly to Wi-Fi or cellular, which could bypass the overlay. Android can change a VPN's underlying transport without replacing the VPN network. Therefore actual TLS operations establish reachability; a connectivity icon alone does not. See [Android network state](https://developer.android.com/develop/connectivity/network-ops/reading-network-state).

Each user turn sends exactly one `ask`. If its acknowledgment is lost, the client only queries that request ID's status. Status and audio reads can reconnect up to three times with bounded backoff, resuming audio at the same offset. Denial, unknown IDs, certificate/pin failures and cancellation fail closed. An unavailable/expired job or a restarted host is never recreated automatically. There are no automatic chargeable retries. The 90-second turn deadline is checked between operations and before delivery; a pending socket operation can add its bounded connect/handshake/read timeout. Initial connection failure leaves the question unsent. The UI explains that an interrupted question may already have reached Home and that cached greetings remain available.

The activity's generation guard, parked consent, selected Bluetooth route and visibility checks still suppress late playback after Stop, leaving the screen or losing the vehicle. Reconnection never claims or resets a trip marker. Home retains the last four completed exchanges in memory for 15 minutes; host restart clears context. Failed turns are omitted. Conversation replies retain zero added lead-in; cached startup clips retain four seconds. Offline greeting selection and duplicate suppression do not depend on the VPN.

On Android 17/target 37, keep the existing `ACCESS_LOCAL_NETWORK` permission granted. Android gates raw sockets to local addresses; do not infer that a cellular link exempts the destination or remove the existing LAN permission checks. Verify the actual overlay route on the target device. See [Android local-network permission](https://developer.android.com/privacy-and-security/local-network-permission). The debug manifest adds read-only network/Wi-Fi-state permissions for diagnostics, not location or background microphone permission.

Keep the conversation screen visible while speaking. Android [Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby) restrict background network work. The VPN app also needs permission to remain connected; inspect its battery/background settings and any existing always-on VPN rather than bypassing them. Bluetooth greeting wake uses the existing companion association/foreground audio service. This slice does not promise unattended live conversation with the app backgrounded or phone locked. Factory vehicle media remains the selected output and is checked before unmuting.

## Certificate lifetime and startup

`node scripts/create-vehicle-host-identity.mjs <new-absolute-private-directory>` creates a 90-day self-signed host certificate and private key, with a `localhost` SAN matching the existing TLS reference identity. Windows ACLs limit the new directory to the current user and SYSTEM. This does not modify a running host, system trust store or phone pin. Preserve the old configuration, select the new host key/certificate in private configuration, and install only its public certificate and fingerprint on the phone through the trusted provisioning channel. Never silently accept a changed pin.

The disposable phone identity also starts with a one-day certificate. The isolated vehicle harness supports explicit renewal:

```text
adb -s <phone> shell am instrument -w -e mode renew-vehicle-identity -e allowIdentityRenewal true io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
```

This signs a new 90-day certificate using the existing non-exportable Android Keystore key. It does not delete/regenerate/export that key. Only the vehicle harness allows this operation. Read its public `client-public.pem` through trusted provisioning, verify its public key matches the previously enrolled key, then replace Home's approved public phone certificate and restart. The certificate fingerprint changes, so reapproval of that certificate is explicit. Other grants and endpoints are not migrated. Renewal is manual, not an automatic remote trust update. Home refuses expired/not-yet-valid configured certificates and warns within seven days of expiry. Repeat trusted renewal before the 90-day deadline; revocation remains available at any time.

Move the existing private credential launcher and its metadata out of temporary storage. Keep using the existing credential resolver and identity/tenant checks; never copy API-key values into files or task arguments. Register current-user startup:

```powershell
./scripts/register-vehicle-host-startup.ps1 -PrivateLauncher '<durable-private-launcher.mjs>'
Start-ScheduledTask -TaskName 'LunaOS Home Vehicle Host'
```

The task uses a hidden Windows PowerShell launcher, an explicit Node executable, current-user interactive logon, a single instance, no execution time limit and three one-minute crash retries. Node's TypeScript transform flag supports the existing private substrate credential helper. The host and helper checkouts must remain at their configured paths. Registration refuses to overwrite an existing task. Verify a task stop/start and actual phone TLS; a task's Running state alone is insufficient. Three failed launches require operator recovery. Authentication/configuration failures are not bypassed.

This is durable **logon startup**, not boot-before-login hosting. Windows must be signed in, online and awake; locking is acceptable but sleep/hibernate/lid closure can interrupt Home. Do not change power settings silently. Tailscale's [Windows unattended mode](https://tailscale.com/docs/how-to/run-unattended) can keep its own service connected after logout, but does not make this user-logon Home task a system service. A reboot without sign-in is not accepted as available Home hosting. No full reboot was performed merely to validate a scheduled-task restart.

## Separate evidence and parked acceptance

Automated checks: `npm test`, full Android debug APK build, and isolated harness build. Fault tests execute the production conversation client with controlled transport failures; real TLS tests verify reconnect status/audio and bounded follow-up context without additional provider calls. These are synthetic tests, not cellular acceptance.

Before involving the driver, install the harness update using its original signing key to preserve configuration/cache/trip state. Verify all cached clips. Then run:

```text
adb -s <phone> shell am instrument -w -e mode remote-readiness io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
adb -s <phone> shell am instrument -w -e mode conversation-check -e allowProviderTest true io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
```

Readiness reports default network presence, VPN/cellular transports, Wi-Fi enabled state, adb-reverse configuration, phone certificate days remaining and enrolled TLS reachability. It sends no provider request. The authorized provider check sends two fictional turns, checks same-conversation color recall and downloads both speech replies; it never records or plays audio and clears its test conversation. Record network evidence separately: the check over Wi-Fi proves only Wi-Fi. ADB is an observation channel, not proof of cellular transport.

For actual acceptance, while parked:

1. Connect the selected vehicle's Bluetooth media, disable phone Wi-Fi, enable cellular and the private VPN. Confirm readiness reports Wi-Fi disabled, VPN/cellular available, no adb reverse, and successful enrolled TLS. Disconnect USB before the audible check.
2. Open Talk while parked, explicitly opt in, speak a harmless question and hear the complete configured-voice reply through the selected vehicle. Confirm no added chat silence and no phone-speaker fallback.
3. Ask a follow-up referring to the first answer. Verify context continuity in the spoken reply.
4. Briefly disable cellular during a pending reply, then restore it. A short interruption may recover that same job; a longer outage must show unavailable, never stale playback or a duplicate paid ask. Send a new explicit question after recovery. Stop or leave during recovery and confirm no late audio.
5. Leave cellular/VPN unavailable for a new trip and verify one cached startup greeting. Briefly reconnect Bluetooth within the existing trip grace period and confirm no duplicate greeting. Restore the network and verify conversation again without resetting trip state.

Report automated, provider, physical-device transport and audible evidence separately. Owner sign-in, Android VPN consent, private route/firewall provisioning and this parked audible check remain real gates. Do not call the slice cellular-accepted until all of them are observed.

## Operator verification, 2026-10-24

The owner enrolled Windows and the physical Android phone in the same private Tailscale network. The configuration helper ran with Windows administrator consent. Read-back verified its exact phone address, host address and TCP port restrictions, the host listener on its overlay address, matching phone destination, unchanged host certificate pin and disabled adb reverse. No actual addresses, account identity, voice selection or configuration contents are published here.

- **Automated:** 308 local Windows tests passed. Hosted CI at implementation head `700e5d0` passed 295 tests with 24 platform skips and no failures. Both the full Home ARM64 debug APK and isolated harness built. A subsequent test-only change strengthened fresh-socket assertions and passed locally and in that CI run.
- **Physical transport:** With phone Wi-Fi disabled, Android reported `defaultNetworkCellular=true`, `defaultNetworkVpn=true`, `wifiEnabled=false`, `adbReverseConfigured=false` and `enrolledTlsReachable=true`. The adb reverse list was empty. USB carried instrumentation commands only; there was no USB network tunnel. The installed app's real TLS client connected through cellular and the private VPN.
- **Providers:** Two fixed fictional turns reached the configured model and speech providers through that phone connection. Same-conversation color recall passed, and speech downloads were 75,834 and 113,728 bytes. No microphone or playback was started by this diagnostic.
- **Outage/recovery:** With Wi-Fi still off, disabling cellular data made enrolled TLS unavailable. Restoring cellular made the same private route reachable again; a fresh two-turn check passed context recall and downloaded 66,918 and 51,314 bytes of speech. This verifies recovery between diagnostic sessions, not an observed in-flight audible recovery. Mid-turn retry and no-replay behavior has automated fault-test evidence.
- **Offline preservation:** All 28 cached voice clips verified after installation and network testing. The trip's claimed flag was true before and after the outage. No new Bluetooth trip or audible greeting was induced; physical greeting playback/duplicate suppression remains an attended check.
- **Runtime:** Both certificates were renewed for 90 days while preserving the phone public key. Hidden scheduled-task stop/start was verified to remove and restore phone TLS reachability. No complete Windows reboot or boot-before-login availability was tested.
- **Audible acceptance:** Pending. The selected vehicle Bluetooth media output was absent during these diagnostics. Spoken recognition, configured-voice playback in the vehicle, a spoken follow-up, no added reply lead-in, disconnected-USB operation and physical trip greeting behavior still require the parked procedure above. The owner was given that procedure after the automated cellular checks. Phone Wi-Fi was restored after testing; Tailscale and the private Home route remain configured.
