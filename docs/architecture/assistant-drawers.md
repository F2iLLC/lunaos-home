# Home assistant drawers

Luna’s Notebook and LIAM TX-18 are presentations of the same native Home voice service. The Android debug Home entry point mounts one `createNotebookPopup` controller and feeds it the existing `get_luna_snapshot` poll. It does not create another recognizer, command dispatcher, or timer store. Other platforms retain their existing voice availability.

## Snapshot contract

The existing capture phase, listening availability, reply caption, notebook event and timer fields remain authoritative. Additional memory-only presentation fields are:

- `wakeEvent`: incremented when a wake phrase or an authorized follow-up starts a command exchange. This survives an exchange that advances past `awake` between polls.
- `activeAssistant`: `luna` or `liam`; the Mac-backed capture boundary recognizes both wake names and uses the same `WakeSession` command gate.
- `lastHeard` and `transcriptFinal`: actual recognizer text and its finality. Diagnostic completion messages are never used as a transcript.
- `commandSpeechActive`: speech energy observed during the post-wake command window, not just an enabled microphone.
- `commandError`: a confirmed failure or uncertainty message; it does not assert that a remote write was rolled back.

The current Mac recognizer returns complete segments only. It does not produce streaming partials. The drawer renders tentative text when `transcriptFinal` is false; the legacy on-device probe publishes partial recognition through the same listener interface. Home does not synthesize interim words.

The pure `voicePresentation` function derives display labels. It does not drive capture. Idle/wake/capturing/processing/responding/disabled remain distinct. A detected wake clears the previous exchange’s transcript and output. Dismissal remains in effect for that exchange; it never cancels voice work or changes avatar state. A ringing timer takes precedence over the drawer.

## Content and controls

Saved list contents are read with the existing notebook request using the service-provided list ID. Reads have a generation guard so a late response cannot populate another exchange. Navigation uses the existing `#notebook`, `#vault`, and `#luna` routes. Calendar explicitly reports that it is unavailable.

Liam’s calculator runs locally and labels its output separately from the service response. The parser accepts bounded arithmetic, parentheses, powers, constants, and `sqrt`, `sin`, `cos`, `tan`, `abs`, and `log`. It never evaluates JavaScript. Angles use radians; `log` is base ten. Expressions containing `x` produce a sampled SVG graph in a fixed −10 to 10 window, with invalid domains and large discontinuities split. No decorative curves stand in for computed output. This is a real-number calculator, not a symbolic algebra system.

Final speech beginning with calculate/evaluate/graph/plot is offered to that parser. “What is” questions are only calculated when the expression parses. Ordinary assistant responses still come from the existing service. Spoken math vocabulary is deliberately limited; the editable expression field supports the full parser grammar.

Companion and Liam wardrobe preferences are stored using the existing browser preference pattern. Speech, calculations, and replies are not persisted by the drawer. The science outfit is manually configured, not selected by keyword guessing. The shared SVG controller changes character/outfit attributes without replacing the face, pose, or animation nodes. The sleep mask follows explicit listening-disabled state, including while another animation runs.

## Verification

Focused automated coverage lives in `notebook-popup.test.js`, `calculator.test.js`, `luna-avatar.test.js`, `native-status-polling.test.js`, and `luna-captions.test.js`. The native service fixture in `WakeServiceProbe.java` also exercises transcript finality, wake identity, stale callback rejection, timer creation, multiple timers, cancellation, and lifecycle behavior. Its execution requires a JDK.

Before device release, use the existing Android debug build and verify both names at the target Echo Show size and a narrow portrait viewport. Check wake-only silence, partial/final text where supported, successful and failed list writes, service disconnection, swipe/backdrop/Escape dismissal, all tabs, manual math while listening is off, graph discontinuities, running and canceled timers, reduced motion, and both Liam outfits. Browser mocks do not prove live microphone or Android playback behavior.
