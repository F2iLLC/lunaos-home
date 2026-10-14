# Android runtime notice inventory

This developer tool fills the Java/Android dependency gap left by the [Cargo inventory](native-license-audit.md). It reads the generated Android application's resolved external runtime artifacts and hashes candidate notice files bundled inside them. It neither assembles the user-facing notice bundle nor approves redistribution. Keep the [native distribution gates](../../THIRD_PARTY.md) open.

## Run against the prepared Android build

Use the reviewed [Android setup](android.md), its scoped Java/SDK/Gradle environment, an initialized generated project, and the populated dependency cache from the build. No device is needed. From the repository root in PowerShell:

```powershell
$auditScript = (Resolve-Path scripts/audit-android-notices.gradle).Path
$reportPath = Join-Path (Resolve-Path ../work).Path 'android-runtime-notices.json'
& ./src-tauri/gen/android/gradlew.bat -p ./src-tauri/gen/android -I $auditScript --offline --no-configuration-cache :app:verifyLunaNoticeAudit :app:auditLunaAndroidNotices "-PlunaNoticeOutput=$reportPath"
```

Choose a new report filename in an existing directory outside the checkout. The audit refuses an existing output file, output symlinks, and paths whose resolved parent lies inside the checkout. It requires `--offline`; missing cached runtime dependencies are an error rather than permission to download them. Missing cached POM metadata is reported explicitly as `pom-unavailable-offline`. The Gradle wrapper/toolchain must already be available. Gradle evaluates the existing trusted build configuration and may prepare build tooling, but this task does not compile the application, install an APK, read device data or execute code from the inspected archives. No configuration-cache support is claimed; use the flag shown above.

The default configuration is `universalDebugRuntimeClasspath`. Pass `-PlunaNoticeConfiguration=<name>` only to inspect another known resolvable configuration, and record it separately. This is not a CPU-specific Cargo scan: the ARM32 native library still needs its own Cargo/native inventory. Do not infer coverage of release variants from a debug report.

`verifyLunaNoticeAudit` runs synthetic checks for direct and nested notices, blank/missing notices, stable output, path privacy, unsafe archive names, malformed nested JARs, expanded-content limits and exclusive/outside-checkout report creation. POM checks cover exact module identity, direct declarations, absent inherited declarations, rejected local-file references and blocked XML document types/external entities. It uses temporary synthetic archives and checks the directory boundary before cleaning them up. The audit task can also be invoked alone after those checks pass.

## Evidence and limits

The report records selected module coordinates, artifact filenames/sizes/SHA-256 hashes, and notice-entry names/sizes/hashes. It records Gradle version and hashes of generated build configuration inputs, without including their contents or local cache paths. Generated settings can contain machine-specific paths, so input hashes may differ on another machine; do not publish the raw settings as evidence.

Schema version 2 additionally requests the exact selected module's POM through Gradle's offline resolution, without following transitive metadata dependencies. It hashes the POM, verifies its group/artifact/version identity (allowing direct parent group/version), and records direct license names/web URLs and the SCM web URL. It does not fetch those URLs. XML document types/external entities are disabled, input is bounded, and malformed or mismatched metadata fails the scan. Non-web, credential-bearing, query/fragment-bearing or unresolved references are withheld and flagged. License inheritance and property interpolation are deliberately not guessed: missing direct declarations remain review gaps even when a parent POM could supply them.

Gradle can cache a POM as module metadata without making it available to an explicit artifact request. In that case the audit checks only the exact selected group/module/version directory under the configured Gradle cache's `modules-2/files-2.1` layout. It records `obtainedFrom`, checks path containment, and accepts duplicate copies only if their hashes match; conflicting copies fail for review. It does not scan arbitrary cache versions or select a newest file. This fallback is tied to the tested cache layout; a future layout change must produce an unavailable/review result rather than guessed evidence.

The scan covers candidate `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `AUTHORS` and `COPYRIGHT` names throughout JAR/AAR entries, plus notices in an AAR's `classes.jar` and direct `libs/*.jar`. It does not extract files. Notice entries are limited to 2 MiB, nested JAR input to 64 MiB, expanded nested content to 256 MiB and each archive to 20,000 entries. Limits fail the scan rather than silently truncating evidence. Other nested archive layouts need separate review. Presence of attribution text is not proof that all applicable licenses or notices have been included.

External artifacts are selected through Gradle's [artifact view API](https://docs.gradle.org/current/userguide/artifact_views.html). Local project components are listed as excluded, preventing their omission from looking like complete coverage. Modules without a runtime artifact may be platforms/BOMs or metadata redirects; they are flagged for metadata review, not labeled unlicensed. POM declarations are metadata evidence, not the referenced license text. Exact-source notices, local Tauri Android sources, Rust/native binaries, platform runtimes and final APK contents still require separate review. Artifact hashes bind this observation to the cached inputs; they are not a dependency lockfile or a license decision.

The task's success means inventory completed, even if review gaps remain. `distributionApproved` is always false. Inspect `modulesWithGaps`, `modulesWithPomGaps` and each module/artifact/POM's gaps; a POM declaration never clears a missing bundled notice. Do not interpret Gradle's `BUILD SUCCESSFUL` as release clearance.

## Initial verified scope

The October 14, 2026 offline scan with Gradle 9.6.1 found **80 external runtime modules, 70 artifacts and 27 bundled candidate notice entries** for `universalDebugRuntimeClasspath`. **57 modules** require artifact/notice review, including 12 with no selected runtime artifact. Local `:app` and `:tauri-android` projects are explicitly excluded from artifact scanning. These findings are independent of the Cargo inventory's 11 file-review gaps and must not be added together as a count of legal defects.

The schema-2 scan inspected POM metadata for all 80 modules without network access: 79 contain direct license declarations and 77 supply accepted SCM web references. `com.google.guava:listenablefuture:1.0` has no direct license declaration in its POM; parent/source review remains necessary. This adds metadata evidence without clearing any of the 57 artifact/notice flags. The POM identity, XML-security and exact-cache lookup checks passed with synthetic fixtures.

The synthetic verification and real cached scan passed. Existing Android Gradle plugin deprecation warnings remain visible. No hosted Actions, device operation, microphone access, assistant call or household information is involved. Reports and logs stay outside source control. The next notice step is to reconcile the flagged modules with their exact published metadata/source and assemble the reviewed notice bundle; this inventory alone does not complete Session 1 or permit Session 2.
