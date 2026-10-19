# Completion report: HOME14-ARM64 — contained ARM64 Android toolchain support

Parent authorization: LunaOS Home issue #14 (Session 2: device connection and
session permissions). This increment only extends the contained Android
toolchain preparation/validation recipe from `x86_64-linux-android` to also
accept and compile/link `aarch64-linux-android`, matching the physical test
phone's actual ABI (Samsung SM-S938U, Android 17/API 37, arm64-v8a).

## Changed behavior

- `scripts/android-container/prepare.mjs`: the permitted Rust target directory
  set now accepts both `x86_64-linux-android` and `aarch64-linux-android`
  (`etc` and the Linux host triple unchanged; no other target). Staging
  requires a complete `libstd-<hash>.rlib` for **both** Android targets, and
  requires both `x86_64-linux-android24-clang` and
  `aarch64-linux-android24-clang` NDK API-24 linker wrappers to be present in
  the manifest and on disk, alongside the existing `clang` requirement. All
  existing path canonicalization, credential/hidden-file rejection, symlink/
  hardlink rejection, archive provenance, SHA256 inventory matching, SDK
  package restrictions, accepted-license check and offline/no-execution
  guarantees are unchanged.
- `scripts/android-container/verify-rust-target.mjs`: `verifyRustTarget` now
  takes an explicit `target` and validates the resulting ELF's class (64-bit),
  endianness (little), type (executable/PIE) and the target's expected
  `e_machine` — 62 (`EM_X86_64`) or 183 (`EM_AARCH64`) — rejecting a wrong or
  cross-target binary. A new `verifyRustTargets({ ndkHome, ... })` helper
  compiles/links both targets against their respective NDK linkers under
  `$NDK_HOME`; the CLI entry point now calls this for both targets. Temporary
  output is removed on every success/failure path; neither Android binary is
  ever executed.
- `scripts/android-container/Containerfile`: the build-time `RUN` step (which
  already invoked `verify-rust-target.mjs` with `NDK_HOME` set) now implicitly
  validates both targets via the updated script, and additionally smoke-checks
  both NDK linker wrapper scripts (`--version`) during the image build.
- `scripts/android-container/probe-rust-target.mjs` (operator regression tool,
  not part of `npm test`): updated to exercise the std-only/missing-core/
  missing-compiler_builtins regression for both targets via the new
  `verifyRustTargets`/`verifyRustTarget` API.
- `docs/prototypes/android-container.md`: documents both supported Rust
  targets, both NDK linkers, the extended provenance/inventory requirements,
  and the per-target ELF machine checks. Explicitly states this still does not
  build an APK, link the Tauri Android library, warm dependencies, or
  establish any device acceptance — including for the Samsung SM-S938U. The
  operator-accepted SDK-license gate (`No license acceptance is automated`)
  is preserved verbatim.

## Tests

- `test/android-container.test.js`: fixtures now include an `aarch64-linux-
  android` `libstd` rlib and NDK linker alongside the existing x86_64 ones. A
  new test asserts `prepare()` rejects staging when the ARM64 library or
  linker (or, symmetrically, the x86_64 library or linker) is individually
  removed from either the manifest or the disk inventory, before any output
  directory is written. 11/11 tests pass.
- `test/android-rust-target.test.js`: rewritten against the new `target`-
  parameterized API. Adds coverage for an unsupported/missing target,
  per-target missing-linker rejection, per-target cross-machine ELF rejection
  (an x86_64 binary presented for the aarch64 check and vice versa), per-
  target ELF class/endianness tampering, and `verifyRustTargets` iterating
  both targets with their matching linker paths plus rejecting a missing
  `ndkHome`. 7/7 tests pass.
- Full `npm test`: 93/93 pass.
- All changes verified with real `node --test` runs on Node 24.19.0; no real
  Rust/NDK/JDK/SDK toolchain was installed or executed in this dispatch.

## Remaining real-toolchain / device gates (unchanged scope)

- No real vendor JDK/Rust/NDK/SDK toolchain, podman image build, or compiler
  execution occurred in this dispatch; the Node tests use inert synthetic
  fixtures and `run` stubs only, never real `rustc`/`clang`.
- The operator must still: supply an authenticated toolchain input including
  both targets' complete Rust standard libraries and both NDK API-24 linkers;
  run `scripts/android-container/probe-rust-target.mjs` and a real
  `verify-rust-target.mjs` pass against real tools; build the image; and
  eventually run the full Tauri Android pipeline (`native:android init`/
  `build`) for `aarch64` the way it is already proven for `x86_64` in
  `docs/prototypes/android-home-vault.md`.
- No APK was built or inspected for ARM64. No emulator or physical device
  (including the Samsung SM-S938U) exercised any binary produced by this
  change. SDK license acceptance remains entirely manual and outside this
  helper. Actions stays disabled; no network, signing, or production behavior
  was touched.
- This increment does not complete Session 2 or issue #14; it only makes the
  contained preparation/validation recipe capable of handling ARM64 inputs
  when an operator supplies them.
