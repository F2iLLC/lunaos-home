# Native dependency license inventory

This development audit supports the [native shell probe](native-shell.md) and its outstanding binary-notice work. It inventories the committed Cargo dependency graph and identifies missing candidate license files. A separate command collects the inspected text as a **candidate bundle for review**. Neither command approves a dependency's license obligations or creates the final redistributable notice page. Native binary distribution remains gated by [THIRD_PARTY.md](../../THIRD_PARTY.md).

## Run locally

Use Node 24+, Cargo and the same Cargo cache used for the native builds. The audit runs `cargo metadata --locked --offline` separately for Windows x64, Android x86_64, Android ARM64 and Android ARM32. ARM32 is included by default because the physical preview device uses 32-bit Android userspace. It does not fetch packages, compile code, start the app, contact an assistant, or enable Actions. If the local cache is incomplete, it fails; provision dependencies through the reviewed build setup first.

Choose an existing output directory outside the checkout and a new filename:

```sh
npm run audit:native-licenses -- --output ../work/native-license-inventory.json
```

To inspect just one target:

```sh
npm run audit:native-licenses -- --target armv7-linux-androideabi --output ../work/android-arm32-license-inventory.json
```

`--target` can be repeated for these supported triples: `x86_64-pc-windows-msvc`, `x86_64-linux-android`, `aarch64-linux-android`, `armv7-linux-androideabi`. Duplicate or unknown targets fail. Run tests with `npm test`; their fixtures contain synthetic license text and do not require Cargo.

| Exit code | Meaning |
| --- | --- |
| 0 | Inventory completed with no file/source gaps detected by this limited scan. This is not redistribution approval. |
| 2 | Inventory completed and the report identifies packages needing file/source review. |
| 1 | Audit could not complete, including missing cache, invalid metadata, unsafe paths or an existing output filename. Do not interpret an older report as a new result. |

Output creation is exclusive, so it cannot overwrite an earlier report or follow an existing output-file link. Reports belong outside the source checkout. They contain no absolute package paths or raw Cargo metadata; retain them locally as working material.

## Collect candidate notice text

With the same offline Cargo environment, choose a new directory in an existing parent outside the checkout:

```sh
npm run bundle:native-notices -- --output ../work/native-notice-candidates
```

The same optional `--target` arguments and exit codes apply. The command resolves the locked graph again, inventories candidate files, then rereads and verifies every copied file against its inventoried byte length and SHA-256. It keeps original bytes, including line endings, encoding markers and empty files; it does not rewrite license terms, choose a branch of a compound license expression, or fill missing text with a generic license. Each file is limited to 2 MiB and combined copied content to 32 MiB. Oversized or nonregular candidates fail the audit/export.

The output contains numeric filenames under `files/`, a short `README.txt`, and `manifest.json`. The manifest maps each copied file to its original relative name, package/version, targets, declared license, exact-version source archive and hash. Packages with no candidate files remain in the manifest with their gaps. Numeric output names avoid treating dependency-controlled paths as output locations. No absolute source paths or raw Cargo metadata are included.

The tool refuses existing output directories, files or links, and resolved parents inside the checkout. It writes the manifest last: **a directory without `manifest.json` is an incomplete export**. Failed output is left for inspection, never overwritten or recursively deleted. Retry with a fresh destination. A manifest with `complete: true` means only that export finished; `distributionApproved` remains false even with zero file gaps. Keep candidates local for review, and do not ship them automatically or treat this directory as the final APK notice bundle.

## What the report establishes

The report binds the inventory to a SHA-256 of `Cargo.lock`, lists per-target package counts, and merges exact package/version entries across targets. It uses the resolved graph rather than every package present in Cargo metadata. Build dependencies are included conservatively; this is not a runtime-only software bill of materials.

For crates.io packages, it records the declared license expression, an exact-version source archive URL, and hashes/lengths of root `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `AUTHORS` and `COPYRIGHT` files, including customary suffixes. A declared `license_file` may point to a nested file inside that package. Missing or empty license files are gaps. Notices or license metadata alone do not substitute for license text. Paths and symlinks that leave the resolved package cause failure. Unapproved source types are flagged without reading those package directories.

The report is deterministic for unchanged lockfile, metadata and inspected files. Changing target order does not change it. Shared package entries must agree across targets; inconsistent content or incomplete resolution fails instead of silently selecting one version of the evidence.

## Initial findings and remaining work

The October 14, 2026 four-target audit of the committed lockfile resolved 242 Windows packages, 258 each for Android x86_64 and ARM64, and 257 for Android ARM32, with 286 distinct third-party package/version entries overall. The ARM32 resolved graph omits `cpufeatures` 0.2.17, which appears in the other three target graphs; package counts must not be copied between architectures. This is dependency-inventory evidence, not a device-compatibility check. It found the same 11 entries requiring license-file review:

- Shared by Windows and Android: `alloc-stdlib` 0.3.0, `defmt-parser` 1.0.0, `selectors` 0.38.0.
- Windows: `webview2-com` 0.39.1, `webview2-com-macros` 0.8.1, `webview2-com-sys` 0.39.1.
- Android: `cesu8` 1.1.0, `jni-sys-macros` 0.4.1, `ndk` 0.9.0, `ndk-context` 0.1.1, `ndk-sys` 0.6.0+11769913.

These are scan gaps, not claims that those projects are unlicensed. For example, `cesu8` has a `COPYRIGHT-RUST.txt` notice with references to license files; that is retained as notice evidence, while missing candidate license text remains flagged. Resolve each gap using its exact released source and required attribution, then review the complete notice bundle before distribution.

The candidate-bundle command was also run against this four-target graph: it collected 488 files totaling 2,392,929 bytes for the 286 packages. Every output file matched its inventoried hash and length, and a second export produced identical manifest and file bytes. The 11 gaps remain unchanged. This verifies collection, not interpretation or notice completeness.

The scan does not discover every nested/vendor notice, interpret compound license expressions, check legal compatibility, or fulfill source-availability obligations. The [Android runtime notice inventory](android-notice-audit.md) separately inventories resolved JAR/AAR artifacts; Java metadata, embedded SDK/runtime files and the final packaged binary still need review. Even a future zero-gap result keeps `distributionApproved: false`. Neither generated inventory nor candidate bundle is shipped as the user's notice page, and this tooling does not clear Session 1's UI/assistant checks or Session 2's prerequisite.
