# Native notice source candidates

The [Cargo inventory](native-license-audit.md) finds 11 released crates with no candidate license text in the published archive. The [pinned source catalog](../licenses/native-source-candidates.json) records where to review supplementary upstream material. It is a dependency-provenance record, not a license approval, a replacement for the archive inventory, or a notice bundle shipped to users.

Nine packages have repository-root license files at their recorded release revisions: 14 package/file references to 11 distinct upstream URLs. Each catalog entry includes the crate archive checksum, released revision, source directory, license declaration, candidate URL, byte length and SHA-256. Both files of dual-licensed projects remain candidates; this record does not select a licensing branch. The other two packages require the specific follow-up below.

| Released crate | Upstream source at the recorded revision | Candidate material |
| --- | --- | --- |
| alloc-stdlib 0.3.0 | [Dropbox source](https://github.com/dropbox/rust-alloc-no-stdlib/tree/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/alloc-stdlib) | Root `LICENSE` (BSD-3-Clause declaration) |
| defmt-parser 1.0.0 | [defmt parser](https://github.com/knurling-rs/defmt/tree/4a8cdb44891ed57b8ff5a023b6bec7137c48708f/parser) | Root `LICENSE-APACHE` and `LICENSE-MIT` |
| jni-sys-macros 0.4.1 | [JNI macros](https://github.com/jni-rs/jni-sys/tree/64d77b7a5f119d7b55b4e2c169a4668067ff59e6/jni-sys-macros) | Root `LICENSE-APACHE` and `LICENSE-MIT` |
| ndk 0.9.0 | [NDK wrapper](https://github.com/rust-mobile/ndk/tree/49bbbba16c58ff63cb8a0ad0eca5a9fb7ecaec25/ndk) | Root `LICENSE-APACHE` and `LICENSE-MIT` |
| ndk-context 0.1.1 | [NDK context](https://github.com/rust-windowing/android-ndk-rs/tree/10f2ba388fca20f7349996ebae26ccda7a6fda5c/ndk-context) | Root `LICENSE-APACHE` and `LICENSE-MIT` |
| ndk-sys 0.6.0+11769913 | [NDK bindings](https://github.com/rust-mobile/ndk/tree/49bbbba16c58ff63cb8a0ad0eca5a9fb7ecaec25/ndk-sys) | Root `LICENSE-APACHE` and `LICENSE-MIT` |
| webview2-com 0.39.1 | [WebView2 wrapper](https://github.com/wravery/webview2-rs/tree/edc2caf886175ccaebe86078c9cfe1ae2a187328/crates/webview2-com) | Root `LICENSE` (MIT); loader/runtime terms remain separate |
| webview2-com-macros 0.8.1 | [WebView2 macros](https://github.com/wravery/webview2-rs/tree/dffa41a8a46d3f5565eefbff2de57d38d399f158/crates/callback-macros) | Root `LICENSE` (MIT) |
| webview2-com-sys 0.39.1 | [WebView2 bindings](https://github.com/wravery/webview2-rs/tree/edc2caf886175ccaebe86078c9cfe1ae2a187328/crates/bindings) | Root `LICENSE` (MIT); loader/runtime terms remain separate |
| cesu8 1.1.0 | [Matching source revision](https://github.com/emk/cesu8-rs/tree/f18962a9de5189f21600b7ff2898845157df4447) | `COPYRIGHT-RUST.txt` only; referenced license files are also absent upstream |
| selectors 0.38.0 | [Released selectors source](https://github.com/servo/stylo/tree/572ecba2d1600e7c3d490586692a209faf703baa/selectors) | MPL source headers; no standalone root/selectors license file found |

## Evidence and reproduction

All 11 cached `.crate` archive hashes matched their package/version checksums in the committed `src-tauri/Cargo.lock`. Read those archives without extracting or executing their contents. Ten include `.cargo_vcs_info.json`; the revision and crate subdirectory in the catalog come from those archive bytes, not from a current default branch. Their normalized package manifests also identify the recorded upstream repositories.

The older `cesu8` archive contains no VCS metadata, and the upstream tag list has no 1.1.0 tag. The upstream version-bump commit alone was not treated as proof: **all seven regular files in the published archive were compared byte-for-byte with revision `f18962a9de5189f21600b7ff2898845157df4447` and matched**, including its manifest, Rust sources and existing copyright notice. This establishes the recorded content match, not that the revision contains complete license terms.

Candidate files were retrieved from the exact-revision raw URLs listed in the catalog, inspected as UTF-8 text and hashed without changing line endings. Root and crate-directory license/notice paths were checked in those revision trees. Downloaded text and scratch comparisons stay outside the checkout; only public source references and hashes are recorded here. Reproduction should verify the catalog's lockfile hash, archive checksums, revision evidence, and each candidate's byte length/hash before accepting material. A changed lockfile or differing upstream bytes requires a fresh review, not silently updating the pins.

## Follow-up before including supplementary text

- Confirm each repository-root license applies to the corresponding released crate and preserve its actual notices. Do not infer a copyright holder where the upstream text does not provide one, or replace project-specific text with a generic template. The catalog remains `reviewRequired: true` for every package.
- For `cesu8`, preserve its existing `COPYRIGHT-RUST.txt`. The exact matching source also lacks the `LICENSE-APACHE` and `LICENSE-MIT` files referenced by that notice. Obtain authoritative applicable terms before adding substitute text; no maintainer has been contacted by this work.
- For `selectors`, the [released source header](https://github.com/servo/stylo/blob/572ecba2d1600e7c3d490586692a209faf703baa/selectors/lib.rs) points to the [MPL 2.0 steward text](https://www.mozilla.org/en-US/MPL/2.0/). Review that text together with retained source notices and the source-availability information required for the distributed binary. Do not substitute a neighboring crate's MIT/Apache files.
- WebView loader/runtime, Android Java/SDK, nested/vendor notices, final binary coverage and source-availability obligations remain outside this catalog. No file is automatically fed into the audit/exporter, and the original 11 archive gaps stay visible. The complete bundle and binary distribution still need the review described in [THIRD_PARTY.md](../../THIRD_PARTY.md).
