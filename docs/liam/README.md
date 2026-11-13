# Luna and Liam character studio

Open [gallery.html](gallery.html) directly in a browser. It is self-contained,
works offline and uses Home’s production renderer. Switch characters and any of
the eight states, enable proportion guides, compare 48/128/300px sizes, inspect
speaking mouth poses, replay motion or export the selected character as SVG.

[Eight-state comparison](state-sheet.png) · [Liam SVG](states/liam-idle.svg) ·
[Notebook/calculator preview](../assistant-drawers/reference-v2/index.html)

## Shared proportions

Both characters use `src/luna/avatar.js` and `src/luna/avatar.css`. Liam retains
Luna’s 320 × 360 canvas, face ellipse (160,149; 87 × 77 radii), eyes, cheeks,
mouth shapes, body size, hands, arm/head pivots and animation states. Only the
appearance layers change: periwinkle hair, round glasses, a moon clip, blue
clothing and sneakers; the science outfit adds goggles and a lab coat.

The studio adapter selects the same production character rather than maintaining
separate Liam artwork. Both characters retain stable DOM nodes through state
changes, reduced-motion behavior, visibility pausing and disposal. The studio
keeps character identity fixed per mount; the Home controller supports switching.

This November 12 iteration follows the two supplied notebook/calculator reference
images and the instruction to keep Liam’s proportions identical to Luna’s.
The state mapper, voice engine and assistant identity are unchanged by the artwork.
No device deployment is implied by these browser and static previews.

## Rebuild and verify

```sh
node scripts/build-liam-gallery.mjs
node --test test/luna-avatar.test.js test/luna-presentation.test.js test/native-status-polling.test.js test/notebook-popup.test.js
```

Optional DOM and raster checks use external developer installations of jsdom and
sharp; neither is added to the app’s dependencies:

```sh
LIAM_DOM_MODULE=/absolute/path/to/jsdom node scripts/verify-liam-gallery.mjs
LIAM_SHARP_MODULE=/absolute/path/to/sharp node scripts/render-liam-sheet.mjs
```

The checks cover stable state changes, matching faces/poses, controls, invalid
inputs, mouth presets, disposal, SVG export, transparent canvas edges and parity
between exported Luna states and the current production renderer. Raster checks
do not certify browser animation timing or pixel parity with the supplied art.
