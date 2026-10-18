# Contained Android toolchain preparation

HOME-14-ANDROID tooling only: prepare a **local** image extending the operator's
approved contained runner. The Home dispatch profile was approved in LunaOS
#7425; later candidate wording does not reopen that approval. Actions stays
disabled. No enterprise runner source is imported. This does not implement or
accept unlock, persistence, expiring permissions, or the two-member workflow.
The separate-app EACCES-versus-ENOENT decision remains pending and unchanged.
Session 2 remains Windows assistant plus manual Android, without a public
endpoint or relay. Existing Windows instructions are not changed here.

## Supervisor inputs (not in Git)

Acquisition and vendor authentication remain supervisor work. No archive URL,
checksum, Rust version, JDK patch, or command-line-tools revision is guessed by
this helper. Supply:

- A locally available, approved Linux amd64 runner **name@sha256:64-lowercase-hex**,
  without a tag, containing Node 24 and the parent build prerequisites. Inspect
  its inherited configuration first: no unreviewed `ONBUILD` hooks, tool path
  collisions, or writable `/opt/home-android`. The image must support the
  supplied Linux tool binaries and a non-root worker with `/workspace` assigned.
- An operator-prepared, isolated Linux x86_64 toolchain directory, consisting
  only of `jdk/`, `rust/`, and `sdk/` as described below. No developer home,
  credentials, `.env`, signing material, source checkout, emulator, system image,
  or platform-tools. The supported native Rust targets are **x86_64-linux-android**
  and **aarch64-linux-android** (HOME14-ARM64); no other Android target is accepted.
- A separate JSON SHA256 inventory/provenance manifest. Authenticate each
  original vendor archive/checksum before extraction, and independently review
  the resulting inventory. A manifest supplied alongside malicious files is not
  authentication. The helper checks prepared-file hashes, not the absent
  original archives or vendor signatures.
- An existing private staging parent outside the checkout; the output leaf
  must not exist. Use `/dispatch-tmp` inside this dispatch's container. On the
  supervisor, use an authorized disposable build location, never a home or
  cloud-synchronized directory. All command paths are explicit operator inputs.

Use a Linux preparation environment, not host installation. Materialize vendor
symlinks/hardlinks as regular files **only after reviewing their targets within
the verified distribution**, then inventory the resulting bytes. The helper
rejects all links, special files, hidden inputs and common credential/key names;
it does not extract archives or follow links. Windows/reparse preparation is
unsupported and rejected. Keep the input and staging parent exclusively owned
and unchanged throughout validation/copy/build; this is not a defense against
another process concurrently replacing files. Filename checks are not a secret
scanner: supervisor review of every included file remains required.

The only filename exceptions are the twelve exact NDK 29 Linux x86_64 vendor
paths enumerated in `ndkPackageFiles` in `scripts/android-container/prepare.mjs`:
Python source/header files, pip authentication modules, the public certifi CA
bundle, two setuptools filenames containing spaces, and two sysroot token
headers. The supervisor authenticated the official archive against Google's
published checksum and computed its SHA256. These exceptions apply to both
manifest and disk inventory checks, not to other SDK paths or similarly named
files. Hash verification, regular-file/link checks and all other credential,
signing, path and manifest restrictions still apply.

### Prepared layout

`jdk/` is a complete JDK 21 Linux x86_64 distribution with `bin/java`,
`bin/javac`, `release`, root `LICENSE`, and all vendor legal notices. Its exact
`JAVA_VERSION` (21.x.y, optionally a fourth numeric component), `OS_NAME=Linux`
and `OS_ARCH=x86_64` must match. Preserve vendor licenses, including `legal/`.
The supervisor-observed Temurin 21 Linux archive has `legal/java.base/LICENSE`
and root `NOTICE`, not a root `LICENSE`. Preserve all original legal
files and copy that vendor `legal/java.base/LICENSE` unchanged to the required
`jdk/LICENSE` before inventorying. This is preparation normalization, not an
edit to legal text.

The supervisor-supplied versions are JDK `21.0.12.1`, Rust `1.99.0` and
command-line-tools `22.0`; the existing version contract accepts these values.
Accepting metadata is not evidence of successful native execution: real image
build, compilation and APK validation remain pending.

`rust/` is a complete relocatable, standalone installed Rust toolchain prefix,
not rustup shims or a developer `.cargo`/`.rustup` directory. Include
`bin/rustc`, `bin/cargo`, host libraries for `x86_64-unknown-linux-gnu`, both
`lib/rustlib/x86_64-linux-android/lib/libstd-<hash>.rlib` and
`lib/rustlib/aarch64-linux-android/lib/libstd-<hash>.rlib` with their complete
target libraries, plus root `LICENSE-APACHE`, `LICENSE-MIT` and all other
notices. The exact stable `1.x.y` toolchain version is supervisor-selected and
recorded; compatibility with this repository's Cargo.lock is not yet
established. Staging requires the complete inventory to contain a `libstd`
rlib for each supported target; a manifest or disk inventory missing either
target's library is rejected before any output is written.

`sdk/` contains only these complete, operator-prepared Linux packages:

| Directory | Required version/evidence |
| --- | --- |
| `cmdline-tools/pinned/` | Exact numeric `Pkg.Revision` in manifest; `bin/sdkmanager`, `NOTICE.txt`, libraries |
| `platforms/android-37.0/` | Platform 37.0, `android.jar`, `source.properties` with exactly `AndroidVersion.ApiLevel=37.0` (supervisor-observed `platform-37.0_r02.zip`, `Pkg.Revision=2`) |
| `build-tools/37.0.0/` | Revision 37.0.0; Linux aapt2, d8, apksigner, zipalign and supporting files |
| `ndk/29.0.14206865/` | Revision 29.0.14206865; Linux x86_64 LLVM, sysroot, `NOTICE`, both the `x86_64-linux-android24-clang` and `aarch64-linux-android24-clang` API-24 wrapper scripts |
| `licenses/` | Existing **operator-accepted** SDK licenses, including nonempty `android-sdk-license` |

Command-line tools are normalized to the fixed directory `pinned`, never
`latest`. Preserve all package license/NOTICE files. Preserve the complete NDK
distribution (its other-architecture sysroot contents are vendor tooling, not
additional Home targets). SDK license receipt syntax is checked but cannot
prove agreement or authority. **No license acceptance is automated.** Absent
receipts fail before staging; obtain them through the operator's existing
authorized SDK preparation process, not through this image build.

### Manifest contract

The manifest has exactly `schema` (integer 1), `jdk`, `rust`,
`commandLineTools`, `archives`, and `files`. The three version fields are exact
numeric version strings, not ranges. `archives` contains exactly one entry per
component: `jdk`, `rust`, `rust-android-std`, `command-line-tools`, `platform`,
`build-tools`, `ndk`. Each entry has exactly:

- `component`: one name from that list;
- `filename`: original vendor basename ending `.tar.gz`, `.tar.xz`, or `.zip`,
  with only letters, digits, dot, underscore, plus or hyphen;
- `sha256`: authenticated archive SHA256, 64 lowercase hex digits;
- `vendor`: non-secret vendor identification (no URLs, local paths or keys).

`files` maps **every** prepared regular file's relative POSIX path to its
64-lowercase-hex SHA256. Extra, missing, changed or unsafe files are rejected.
No concrete production manifest is supplied because no vendor inputs are
available in this dispatch. Test manifests are fictional and not usable pins.
Retain vendor release/build identity and upstream verification records locally
alongside the original archives; their archive digest disambiguates builds
sharing a numeric version. The manifest and distribution notices are copied
into the local image; no binaries or operator paths are published to Git.

## Stage and build locally

In an authorized Linux environment with Node and rootless Podman, set the four
variables to the explicit inputs above (not real paths committed to this repo):

```sh
node scripts/android-container/prepare.mjs \
  --base "$RUNNER_BASE" --input "$TOOLCHAIN_INPUT" \
  --manifest "$TOOLCHAIN_MANIFEST" --output "$STAGING_OUTPUT"
```

This validates the entire structure, versions, license receipt and inventory
before creating output. It writes only a new restricted `context/` and
`build-command.json` in the external output. No tools are executed and no
network access occurs. It preserves executable bits, removes write/set-id bits,
normalizes context timestamps and directory permissions, and verifies copied
bytes again. It refuses existing output rather than overwriting prior work.

Review `build-command.json`, an argument array rather than shell source. Execute
that exact array with a process API (`shell: false`) or invoke its equivalent:

```sh
podman build --pull=never --network=none --platform=linux/amd64 --timestamp=0 \
  --iidfile "$STAGING_OUTPUT/image.id" \
  --build-arg "RUNNER_BASE=$RUNNER_BASE" \
  --build-arg "RUST_VERSION=$EXACT_RUST_VERSION" \
  --build-arg "JDK_VERSION=$EXACT_JDK_VERSION" \
  --file "$STAGING_OUTPUT/context/Containerfile" "$STAGING_OUTPUT/context"
```

Use only the generated context, never the checkout or a broader parent. The
build copies inputs into image layers: **no host SDK/runtime/cache mounts**.
No fetch, host install, SDK manager install or license prompt is involved.
The Containerfile inherits the parent's USER, ENTRYPOINT, CMD and security
policy unchanged; it adds tool paths and workspace-local cache locations only.
It does not turn a runtime network policy on or off. The approved parent and
supervisor still enforce worker isolation. Do not add privileged flags or
override the entrypoint to make a build pass.

Record Podman version, parent digest, input manifest hash and the resulting
image ID. Use that immutable local image ID, not a mutable tag, for dispatch.
This is a repeatable staging recipe, not a proven cross-engine bit-identical
image build. No image publication/export is authorized here; redistribution of
vendor tooling needs its own rights review. Failed builds or reruns need a new
output leaf; disposal of old external output belongs to the operator.

## Evidence and next native checks

### Rust target validation correction (#38)

The image compiles and links a fixed, synthetic Rust program using `std`,
`String` and `Vec` for `x86_64-linux-android` with the configured NDK API-24
linker. A successful exit must also produce an ELF64 x86_64 executable/PIE.
The temporary output is removed on success or failure and is never executed.
The staging inventory's single `libstd` check remains only a preliminary file
check; the image build must pass compilation. Printing `target-libdir` alone
does not prove that the target libraries are usable.

### ARM64 toolchain support (HOME14-ARM64)

The image build and `scripts/android-container/verify-rust-target.mjs` now also
compile and link the same synthetic `std`-using program for
`aarch64-linux-android` with the `aarch64-linux-android24-clang` NDK API-24
linker, alongside the existing `x86_64-linux-android` check. Each target's
output is independently verified as an ELF64 executable/PIE with the little-
endian class/encoding and the target's expected `e_machine`: 62 (`EM_X86_64`)
for `x86_64-linux-android`, 183 (`EM_AARCH64`) for `aarch64-linux-android`.
Either temporary output is removed on every outcome and neither Android binary
is ever executed. Staging (`prepare.mjs`) now requires the complete manifest
and disk inventory to contain a `libstd` rlib for both targets and both NDK
API-24 clang linker wrappers (`sdk/ndk/29.0.14206865/toolchains/llvm/prebuilt/
linux-x86_64/bin/{x86_64,aarch64}-linux-android24-clang`); a manifest or input
directory missing either target's library or linker is rejected before any
output is written, with all prior path, credential, provenance, hash,
accepted-license and offline restrictions unchanged.

This still does not build an APK, link the Tauri Android library, warm Gradle/
Cargo dependencies for either ABI, or run/accept anything on the physical
Samsung SM-S938U (arm64-v8a, Android 17/API 37) or any emulator/device. It
only proves that an operator-supplied, authenticated toolchain input can
compile and correctly link minimal Rust programs for both the historical
x86_64 target and the phone's actual arm64-v8a ABI.

Run `node scripts/android-container/probe-rust-target.mjs` in a disposable Linux
toolchain container with networking disabled. It first checks the complete
toolchain for both targets, then copies each target's libraries into three
temporary sysroots per target: only `libstd`, missing `core`, and missing
`compiler_builtins`. Each must pass the old path-print check but fail the new
compile/link check. Installed libraries are never changed; only those
temporary copies are removed.

On 2026-10-17, the x86_64-only regression passed with the configured Linux
Rust 1.99.0 and NDK 29.0.14206865 toolchain. The aarch64-linux-android checks
added for HOME14-ARM64 have only run against Node's inert synthetic fixtures
in this dispatch (`test/android-container.test.js`,
`test/android-rust-target.test.js`); no real Rust/NDK toolchain exercised the
new ARM64 compile/link path here. This establishes a minimal target
compile/link contract and rejects the reproduced incomplete-library and
incorrect-ELF cases for both targets. It does not establish a fresh image
build, full APK build, runtime compatibility or device acceptance for either
ABI. The earlier preparation-only evidence below remains historical.

### Earlier preparation-only evidence

This dispatch has no JDK, Rust, Android SDK, container image build, compiler
execution, APK, emulator or device evidence. Node safety tests use inert fake
files, never real tool binaries. Their passing status cannot establish native
readiness. The Containerfile's version/smoke commands are **unexecuted here**.

The supervisor must distinguish these subsequent steps:

1. **Toolchain smoke:** build the image offline; check inherited identity/policy,
   exact versions, Linux binary compatibility, target libraries, notices and
   immutable image ID. Check NDK linker and build-tools execution separately.
2. **Java compile:** compile the existing synthetic Android Java sources against
   this platform's `android.jar` into disposable workspace output. This checks
   Java/API compatibility only, not Rust, Kotlin, Gradle, APK packaging or vault
   behavior. Do not introduce signing keys into this toolchain context.
3. **Dependency warming:** separately prepare verified npm packages, Cargo
   registry/git dependencies, Gradle wrapper distribution, plugins, Maven
   artifacts and Android/Tauri dependencies for the exact locks/generated
   project. Tool binaries are not dependency caches. Acquisition requires a
   separately authorized supervisor process; never enable runtime worker
   networking or mount developer caches. Keep reviewed caches in a subsequent
   local image or assigned workspace, not a sibling mount.
4. **Tauri Android build:** initialize using
   `npm run native:android -- init --ci --skip-targets-install`, then build with
   `npm run native:android -- build --debug --target x86_64 --apk --ci` and the
   existing Android configuration. Confirm generated Gradle SDK/NDK versions
   match the supplied packages. Standalone Rust/Tauri integration and all host
   prerequisites still need verification; do not fall back to online rustup or
   SDK installation. Existing preparation enforces the offline manifest.
5. **Final offline rebuild:** run from fresh generated output with network
   denied and reviewed dependencies available; enforce Cargo locked/offline
   resolution and Gradle offline mode in the validated native invocation.
   A prior warm build or Java compile does not prove this succeeds. Inspect APK
   x86_64 contents, merged permissions, backup policy and development signature.
   Any disposable signing material belongs only in the assigned build workspace,
   never the toolchain input/image or repository history.

Preparation validation on Node 24.19.0 passed: all eleven tests in
`node --test test/android-container.test.js`, all seven tests in
`node --test test/android-rust-target.test.js` (covering both
`x86_64-linux-android` and `aarch64-linux-android`), all 93 tests in
`npm test`, and `npm run build:native` (frontend bundling only). These were run
with synthetic Node fixtures only, under a disposable temporary directory; no
real vendor toolchain, JDK, Rust, NDK, SDK license acceptance or network access
was used. No product acceptance, Android GUI/storage change, device test,
deployment, workflow change or merge follows from this preparation. The
operator must still run `probe-rust-target.mjs` and a real image build/APK
build against actual authenticated toolchain inputs, and the Samsung
SM-S938U/arm64-v8a device acceptance for issue #14 remains entirely open.
