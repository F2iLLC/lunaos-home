# Reference design iteration · November 12, 2026

Open [the live preview](index.html). Choose Luna notebook or Liam wake in the default
390px portrait view to compare the composition with the supplied references. The
preview bundles the actual Home components with synthetic voice/list snapshots.
The calculator uses the production expression parser. No microphone or vault is
connected; the displayed grocery save is fixture data.

Liam keeps Luna’s exact 320 × 360 canvas, face ellipse, facial features, body,
limbs and pose pivots. Periwinkle hair, glasses, goggles, moon clip, lab coat and
sneaker laces are appearance layers. See the [eight-state comparison](../../liam/state-sheet.png)
and [interactive character studio](../../liam/gallery.html).

Luna’s notebook now has dotted cream paper, shaded purple spiral binding, a
layered cover and spine, brush headings, character stickers, a pencil and
household doodles. TX-18 has a layered lavender case, mint grid display, science
doodles, five side tabs and persistent calculator keys. Recognition, results,
list data and calculation output remain live text. Long results scroll; the
handle expands the drawer. The Graph and Science tabs open examples without
replacing an existing expression or claiming a calculation has run.

This is an interactive vector/CSS interpretation, not a pixel-identical copy.
The supplied art has richer painted shading and texture. Live wording also
varies with the service state rather than reproducing the example’s invented
plan/checklist. Calendar remains unavailable in Home and reports that when tapped.

## Rebuild

```sh
node scripts/build-assistant-preview.mjs docs/assistant-drawers/reference-v2
node scripts/build-liam-gallery.mjs
npm run build:native
```

## Verification

- Focused avatar, presentation, native polling, drawer and calculator tests: 35 pass.
- Studio verification: 1,600 stable state changes, shared face and pose geometry,
  gallery controls, disposal and 16 exported SVG states pass.
- Raster verification: all 16 states retain transparent canvas edges; all eight
  Luna exports match the current production renderer.
- Native frontend build passes. No Android device installation or voice trial performed.
- Safari review at 390 × 700 and 1024 × 700 caught and corrected duplicate
  transcript spacing and calculator header wrapping. The final spacing tweaks
  also remain available in the self-contained preview for inspection.
- Full-suite comparison with Java on PATH and physical `/private/tmp`: 426 pass,
  13 fail, 85 skip; unchanged HEAD: 425 pass, the same 13 fail, 85 skip. The
  additional pass is the shared-character geometry regression. The common
  failures require PowerShell or OpenSSL features absent from this host. The
  focused suite was rerun after the final appearance and calculator-tab changes.

## Font

[Patrick Hand](https://github.com/google/fonts/tree/main/ofl/patrickhand), by
Patrick Wagesreiter, is bundled locally under the SIL Open Font License. Its
license is in `src/fonts/OFL-PatrickHand.txt` and included in native notices.
The runtime does not request fonts from a third-party service.
