# Passenger-aware greetings: simulated increment

This extends the [v0.1 companion](vehicle-greetings.md), including its selected
Bluetooth output, offline speech, atomic trip claim, reconnect grace, local
configuration and Node/JVM test infrastructure. It does not install or access
vehicle sensors. The dependency is PR #117; this change is reviewed separately.

The dependency's cached ElevenLabs voice and four-second lead-in are preserved.
For this manual increment, select the Android offline voice to hear new group and
named greetings. Existing imported driver voice packs do not contain passenger
phrases. If a cached voice is selected and the exact passenger clip is absent,
playback reports unavailable and stays quiet; it never substitutes a different
voice or sends children's names to a speech provider. Passenger voice-pack
generation/provisioning is not implemented here.

## Capability investigation and decision

Target: 2018 Cadillac XT5 with factory CUE and wired Android Auto. Sources checked
2026-10-24; these are documentation findings, not inspection of a particular VIN.

| Question | Finding |
| --- | --- |
| Rear pressure/occupancy sensors? | The GM-authored [2018 XT5 owner's manual, pp. 66 and 83–87](https://manualmachine.com/cadillac/xt52018/2303181-owners-manual/) describes a door-triggered rear reminder and front outboard passenger sensing. It does not establish usable rear occupancy/pressure sensing. Rear hardware availability is unverified; do not assume it exists. The linked copy is a mirror of the manufacturer manual. |
| Rear belt status? | No documented rear belt-status application interface was found in the reviewed XT5 documentation. Neither belt fastening nor a door event proves a person is present. This is not a claim that every trim lacks buckle switches. |
| Rear Seat Reminder? | Cadillac explicitly says it [does not detect people, pets or objects](https://www.cadillac.com/support/vehicle/security/rear-seat-reminder). It cannot supply this feature's presence input. |
| Android interface? | Google's documented [Car Hardware APIs](https://developer.android.com/training/cars/apps/library/car-hardware-api) expose a limited set of vehicle information and motion/location sensors; they do not document a projected Android Auto rear-occupancy or rear-belt API. Android Automotive OS properties are not evidence of support on this CUE projection system. |
| Existing Home integration? | Its native Android adapter observes selected bonded A2DP connection and audio routing. It has no occupancy or belt adapter and no CAN/OBD access. Wired Android Auto does not add a passenger signal to it. |

**Decision:** no safe supported factory passenger interface was established by
this investigation. Ship explicit manual confirmation and a simulated independent
provider first. Do not connect to vehicle wiring or diagnostic buses. The factory
front passenger classification system is outside the integration boundary.

For later automatic sensing, evaluate a standalone noncontact rear-zone presence
sensor with its own power and a documented local read-only output. A candidate
design is a securely mounted, cabin-rated radar module, independent of seats,
belts, airbags and their wiring, with local processing and no recordings. No
hardware product, placement, reliability, identity detection or compatibility is
validated here. Before selecting it, measure stationary occupants, empty child
seats, luggage, motion, front-seat spillover, multiple passengers, disconnects,
heat and power-cycle behavior. Mounting must not obstruct restraints, visibility
or occupants. Avoid pressure mats under child restraints. If no safe mounting
and reliable signal can be validated, keep manual confirmation.

No safety system modifications, safety wiring taps, arbitrary CAN commands,
factory behavior changes, or weight-based identity inference are permitted.

## Contract and local behavior

`VehiclePassengers.Provider.snapshot()` supplies current rear-row observations:

| Field | Contract |
| --- | --- |
| `occupied` | `TRUE`, `FALSE`, `UNKNOWN` (tri-state; never coerce unknown to false) |
| `seat_position` | Optional `rear_left`, `rear_center`, `rear_right`; absent means the whole rear row |
| `source` | `supported_vehicle`, `independent_sensor`, `manual` |
| `confidence` | Optional finite 0–1 value; omitted by manual and simulated inputs. A future adapter must document actual calibration; the reducer does not invent or rank confidence. |
| `observed_at` | UTC epoch milliseconds of observation, not receipt time |
| `trip` | Local session binding; prevents evidence reuse on a later trip |

The provider is an in-process trusted adapter interface, not an exported service
or a network endpoint. A source label alone does not authenticate evidence.
There is no physical factory or independent-sensor adapter yet. A future adapter
must admit only its explicitly configured sensor and clear its snapshot on
disconnect. Pure JVM tests inject synthetic snapshots through the same interface.

Readings at least 120 seconds old, future-dated, or for a different trip are
unusable. Exceptions/disconnect/absence produce unknown. Conflicting observations
of a seat or the rear row produce unknown. A negative for one seat does not mean
the row is empty; that requires an explicit row-wide negative or all three seats.
Sensor-specific qualification/debounce belongs in a documented future adapter.

The existing connection starts a 2.5-second evidence window. At speech preparation
the phone selects the latest local evidence; unavailable data uses the existing
driver catalog, with no assertion that the driver is alone. Known presence uses
an age-neutral group greeting. Only fresh, same-trip `owner_confirmation` evidence
and enabled owner configuration can select names from the saved child profiles.
Presence never establishes age, number of passengers or identity. An unknown,
duplicate, stale, unsupported or mismatched identity falls back to the group
greeting. No weights, calendar, appointments or free-form model speech enter the
contract; passenger data and names are never sent to Home or model sampling.

Profile preferences are named, generic, or silent. Rider confirmation is separate
from permission to speak names. A confirmed silent preference suppresses the
greeting even when spoken names are disabled; a generic preference suppresses all
names in that group. With spoken names disabled, other confirmed riders receive
the generic group greeting. Unconfirmed or stale identity cannot apply a profile's
preferences.
The owner can also silence every greeting or use the existing disable control.
Explicit confirmation can still be mistaken: the system does not verify a human's
selection. Correct it or clear it while parked. Profiles alone are not evidence.

Evidence is checked again before unmuting. If selection changed or expired during
speech/route preparation, skip that attempt. Data arriving after speech starts
does not trigger a second greeting. The existing durable trip claim remains the
at-most-once playback boundary, including quick reconnects. Neither a passenger
update nor a sensor callback resets it. No automatic replay is introduced.

## Try the working manual increment

Use Home's Android debug vehicle setup, or build the isolated existing harness
following the v0.1 guide. This increment does not install it automatically.

1. While parked, save **Child names and preferences**. Optionally enable **Speak
   confirmed children's names**. Rider confirmation and silent preferences also
   work with this setting off. No household names ship as fixtures.
2. Choose **Confirm rear passengers (names unknown)** for a generic greeting, or
   **Confirm children riding along** and explicitly select the riders.
3. Choose **Next connection**, then connect within two minutes. This confirmation
   is consumed by that connection's trip, even if it is a quick reconnect that
   stays quiet. **Current trip** updates only an already connected trip and can
   affect the first greeting only before speech preparation.
4. **Confirm rear seats empty** supplies a row-wide negative. **Clear passenger
   confirmation** restores unknown; it does not assert empty seats.
5. **Silence all greetings** immediately stops the service's audio and prevents
   later claims while enabled. Turning it off does not replay speech by itself.

Profiles and temporary confirmation live in the existing backup-excluded atomic
phone state. Editing profiles clears evidence. New trips, stale timestamps, or
reboot invalidate confirmation; expired persisted values are ignored, never
reused as current evidence. The manual input retains only the latest confirmation,
not passenger history. Disable clears the confirmation and vehicle enrollment.

## Validation and remaining device work

```powershell
npm ci --ignore-scripts
node --test test/vehicle-passengers.test.js test/vehicle.test.js
npm test
```

The passenger suite uses fictional Alex/Sam profiles, synthetic independent
readings, production Java selection/trip/playback policies and a simulated audio
sink. It covers driver-only, one/multiple passengers, unknown/partial coverage,
conflicting/stale/future readings, disconnect/failure, late readings, same-trip
reconnect/new trip, missing/incorrect/stale identity, attempted weight identity,
disabled/silent preferences, evidence changes before audio and unavailable route.
The original driver catalog, TLS/MCP privacy boundaries, silent lead-in and trip
tests remain in the full suite. Android compilation checks native integration;
these tests do not execute Android lifecycle callbacks or prove audible sound.

Physical acceptance remains separate: on a parked vehicle, verify manual group
and named speech from its speakers, unknown fallback, silence/disable during
preparation and playback, repeated reconnects, locked-phone wake, and behavior
with wired Android Auto. Confirm source/age and preference changes locally without
publishing household data. A physical sensor requires additional qualification
before being admitted as a provider. No new phone, CUE, wired Android Auto,
physical-sensor or passenger audibility acceptance is claimed by this increment.
