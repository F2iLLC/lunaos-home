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
  or platform-tools. The first native target is **x86_64-linux-android only**.
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

### Prepared layout

`jdk/` is a complete JDK 21 Linux x86_64 distribution with `bin/java`,
`bin/javac`, `release`, root `LICENSE`, and all vendor legal notices. Its exact
`JAVA_VERSION` (21.x.y, optionally a fourth numeric component), `OS_NAME=Linux`
and `OS_ARCH=x86_64` must match. Preserve vendor licenses, including `legal/`.

`rust/` is a complete relocatable, standalone installed Rust toolchain prefix,
not rustup shims or a developer `.cargo`/`.rustup` directory. Include
`bin/rustc`, `bin/cargo`, host libraries for `x86_64-unknown-linux-gnu`,
`lib/rustlib/x86_64-linux-android/lib/libstd-<hash>.rlib` and its complete target
libraries, plus root `LICENSE-APACHE`, `LICENSE-MIT` and all other notices.
The exact stable `1.x.y` toolchain version is supervisor-selected and recorded;
compatibility with this repository's Cargo.lock is not yet established.

`sdk/` contains only these complete, operator-prepared Linux packages:

| Directory | Required version/evidence |
| --- | --- |
| `cmdline-tools/pinned/` | Exact numeric `Pkg.Revision` in manifest; `bin/sdkmanager`, `NOTICE.txt`, libraries |
| `platforms/android-37.0/` | Platform 37.0, `android.jar`, `source.properties` with API level 37 |
| `build-tools/37.0.0/` | Revision 37.0.0; Linux aapt2, d8, apksigner, zipalign and supporting files |
| `ndk/29.0.14206865/` | Revision 29.0.14206865; Linux x86_64 LLVM, sysroot, `NOTICE` |
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

Preparation validation on Node 24.19.0 passed: all six tests in
`node --test test/android-container.test.js`, all 70 tests in `npm test`, and
`npm run build:native` (frontend bundling only). These were run with temporary
fixtures under `/dispatch-tmp`; no real vendor toolchain was used. No product
acceptance, Android GUI/storage change, device test, deployment, workflow change
or merge follows from this preparation.
