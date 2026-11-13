# Liam character preview

Open [gallery.html](gallery.html) directly in a browser. It is self-contained and
works offline; no app server, account, microphone, or assistant connection is used.
Select any of the eight states, switch between Luna, Liam and side-by-side views,
toggle motion/proportion guides, compare 48/128/300px sizes, inspect speaking mouth
poses, replay both characters together, or export the selected character as SVG.
The expression sheet below the stage is intentionally static.

[Static comparison sheet](state-sheet.png) · [Liam SVG](states/liam-idle.svg)

## Baseline and scope

Based on latest `main` verified on 2026-11-12:
`838744f90e730827dad3e6ba447d9c57abb8e2e1` (Luna 2.0 integration, #363).
The checkout was clean at the start: no tracked or untracked rejected changes
were present to revert. The older feature branch was left intact, and local
`main` was fast-forwarded to the verified commit. Local Git DNS was unavailable;
missing objects were retrieved through the GitHub connector and all blob, tree,
and commit hashes were verified before updating the local ref.

All new files are in `scripts/` and `docs/liam/`. Production `src/`, native code,
server routes, assistant identity, voices, data, dependencies and lockfiles are
unchanged. Nothing is wired into Home or deployed. This change contains the
character design and development preview; app integration is a separate task.

## Reuse and appearance

The authoritative implementation is `src/luna/avatar.js` with motion in
`src/luna/avatar.css`. Its approved reference and existing gallery are in
`docs/luna-2/`. Its eight states are idle, listening, thinking, talking, working,
happy, error and sleeping. Wake activation uses listening; speech uses talking.
The production event mapper in `src/luna/presentation.js` remains untouched.

`scripts/character-preview/avatar.js` mounts the existing Luna controller.
For Liam only, it applies presentation assets once: short fluffy blue hair and
cowlick, blue/white hoodie with a small lightning patch, sneakers, sleeve/cuff
colors and a blue version of the existing sleep mask. It retains the exact
320 × 360 viewBox; face ellipse (160,149; 87 × 77 radii); eyes, mouth, cheeks,
hands, arm/head pivots, folded thinking hand, laptop, effects and mask paths.
Pigtails and bow are removed for short hair. The same CSS controls breathing,
blinking, speaking, thinking, typing, celebration, surprise and sleeping.
No new keyframes, animation engine, per-frame mutations or face scaling exist.
The gallery only resets existing CSS clocks to compare/replay motion together.

Character identity is fixed per mount and separate from assistant identity.
The small `CHARACTERS` configuration contains presentation metadata only.
Liam currently has one home hoodie outfit; enterprise is rejected explicitly.
State changes use the original controller without replacing SVG nodes.
Hidden-page/offscreen handling, compact detail rules, reduced-motion preference
and disposal are inherited from Luna.

## Rebuild and checks

Build the interactive gallery with the repository's existing esbuild:

```sh
node scripts/build-liam-gallery.mjs
node --test test/luna-avatar.test.js test/luna-presentation.test.js test/native-status-polling.test.js test/luna-captions.test.js test/notebook-popup.test.js
```

Optional DOM and raster verification tools use existing developer installations
of jsdom and sharp. They are not new repository dependencies. Set the two
environment variables to module paths if those tools are installed elsewhere:

```sh
LIAM_DOM_MODULE=/absolute/path/to/jsdom node scripts/verify-liam-gallery.mjs
LIAM_SHARP_MODULE=/absolute/path/to/sharp node scripts/render-liam-sheet.mjs
```

The DOM check also regenerates the 16 individual static SVG exports; the raster
check regenerates the comparison PNG. All exports embed the unchanged Luna CSS.

Validated in this session:

- 25 targeted existing tests passed, 0 failed.
- Real jsdom markup checks passed: unchanged Luna markup, 11 identical face
  groups, matching pose paths, 1,600 state updates with stable SVG nodes,
  all mouth presets, compact-size attributes, invalid inputs and disposal.
- Bundled gallery initialized all 18 SVGs; state buttons, character selection,
  motion control, and the 640-transition invariant check passed in jsdom.
  `getAnimations` was stubbed and `getCTM` returned null in this environment;
  those DOM results do not claim browser animation or layout validation.
- All 16 SVGs parsed/rasterized with sharp. None touched the canvas edge.
  All eight Luna raster outputs were pixel-identical to the unmodified renderer.
  The side-by-side raster sheet was visually inspected in all eight states.
- JavaScript syntax and whitespace checks passed. Production paths and package
  files have zero diff from the verified main baseline.

## Remaining visual verification

Interactive browser access was unavailable. Headless Chromium was blocked by
the host sandbox's Mach-port permission restriction. Consequently browser motion
timing/jitter, animated clipping, actual reduced-motion rendering, responsive
layout, SVG download interaction and target-device performance are **not
verified**. Static raster review found no visible face distortion or clipping.
No full application suite or native/device build was run for these preview-only
changes. A browser review should exercise every state, sleep-to-listening,
thinking-to-speaking, repeated happy/error replay, all three speaking mouth
poses, the 48px view, a narrow viewport, and system reduced motion. Use the
gallery's invariant button to run real DOM/matrix checks in that browser.
