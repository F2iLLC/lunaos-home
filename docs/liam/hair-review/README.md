# Liam hair correction

[Review the concept and before/after at actual sizes](index.html) ·
[Before-and-after image](before-after.png) · [Direct concept comparison](concept-comparison.png)

Only `src/luna/avatar.js` hair markup changed in this correction. Existing work
in the repository was preserved. The before images capture the exact working
version at the start of the haircut, rather than the older Git HEAD.

The new hair uses a controlled rounded crown, five overlapping cubic fringe
locks, asymmetrical downward side layers, a small cowlick, powder-blue fills,
lavender-blue shadows and pale highlights. The rear volume is drawn before the
face within the same head pivot. The fringe remains before the glasses. Neither
goggles nor crescent needed repositioning. No new animation or SVG resources.

Reviewed against the supplied original Liam concept at 112px and 190px, including
a grayscale silhouette comparison. The concept is shown unaltered through a
cropped SVG viewport in the review page; the full original remains expandable.

Verification: all 32 character/state/science-outfit combinations preserve every
non-hair SVG element exactly; all eight Luna raster renders are unchanged;
back/face/fringe/glasses ordering and cubic path checks pass. Existing gallery
checks cover 1,600 stable state transitions, face/pose parity, mouth states,
disposal, controls and 16 exported states. Raster checks confirm clear canvas
edges. Updated generated previews use the production renderer.

Focused avatar, presentation and native polling tests: 23 pass. Native frontend
build passes. No runtime interface or animation-controller change.
