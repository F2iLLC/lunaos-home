# Dependency provenance

The original draft preview introduced two direct dependencies, pinned in `package.json` and `package-lock.json`:

| Package | Version | Upstream | License | Purpose |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1 | [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT, copyright Anthropic PBC | Maintained stdio protocol implementation. |
| `zod` | 4.6.7 | [Zod](https://github.com/colinhacks/zod) | MIT, copyright Colin McDonnell | Bound and validate draft inputs. |

Installed package manifests and direct LICENSE files were inspected. The initial npm-only locked dependency tree contained 85 MIT, seven ISC, two BSD-3-Clause and one BSD-2-Clause packages, excluding Home itself. These permissive licenses can accompany Apache-2.0 Home; dependencies retain their own licenses. Source is installed from the public npm registry using the lockfile integrity values, not copied from enterprise LunaOS. Install scripts were disabled. The initial npm advisory audit reported no known vulnerabilities; this is not a security review or future guarantee.

No third-party source is vendored in this repository. npm packages include their own notices. Any future bundle or installer that redistributes dependency code must preserve the applicable copyright/license notices, including transitive packages; do not label dependencies as newly authored Apache code. Recheck this record and notice obligations when updating the lockfile or packaging native dependencies.

The preview and tests were authored with AI assistance and reviewed against the public SDK API. No enterprise source, user reference-image assets or private data were copied.

## Native shell development dependencies

| Package | Version | Upstream | License | Purpose |
| --- | --- | --- | --- | --- |
| `@tauri-apps/cli` | 2.12.2 | [Tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT | Development/build CLI and icon generation. |
| `esbuild` | 0.28.2 | [esbuild](https://github.com/evanw/esbuild) | MIT | Bundle the offline frontend. |
| `tauri` | 2.12.3 | [Tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT | Native WebView shell. |
| `tauri-build` | 2.7.2 | [Tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT | Native build support. |

Direct versions are pinned; `package-lock.json` and `src-tauri/Cargo.lock` retain registry sources and integrity/checksum values. The direct npm license texts and registry/crate license metadata were inspected. npm installation used `--ignore-scripts`; the new npm audit reported no known vulnerabilities. Cargo build scripts necessarily execute during a native build. No Cargo vulnerability-audit result is claimed.

Windows-filtered Cargo metadata resolved 242 third-party packages, including build dependencies, plus Home. Their declared license expressions use MIT, Apache-2.0, BSD-3-Clause, 0BSD, Unicode-3.0, Unlicense, Zlib, CC0-1.0, MIT-0 and MPL-2.0, including dual/combined expressions. This replaces the original npm-only inventory as the relevant native-build scope; other target trees need their own review.

The MPL-2.0 crates are `cssparser` 0.37.0, `cssparser-macros` 0.7.1, `dtoa-short` 0.3.5, `option-ext` 0.2.0 and `selectors` 0.38.0. They retain their own licensing and source-availability requirements; none is modified or vendored here. Source distributions are available by exact package/version from crates.io and their upstream repositories. Home's Apache license does not replace those terms.

**Native binary distribution is still gated.** Six resolved crates omit a root license file from their published archive: `alloc-stdlib`, `defmt-parser`, `selectors`, `webview2-com`, `webview2-com-macros` and `webview2-com-sys`. Upstream repositories and archive VCS revisions were identified, but a complete redistributable native notice/source bundle has not been assembled or reviewed. Include applicable upstream notices, bundled loader/runtime terms and MPL source information before publishing an installer or executable. Installer bundling is disabled in this source-only probe. Do not infer binary-distribution clearance from successful compilation.

The bundled JavaScript uses only Home and Zod; the build rejects accidental MCP SDK/server inclusion and preserves Zod's MIT license in the frontend notices page. The Tauri CLI and esbuild are build tools; their runtime dependencies have their own terms. The moon icon is original SVG artwork authored for this project and rendered with the Tauri CLI, not copied from the user's inspiration images.

## Android build probe

The Android build uses the same pinned Tauri packages and Cargo lockfile. Android x86_64 metadata resolves 258 third-party Cargo packages plus Home, using the same declared license families listed above. This inventory includes build dependencies and does not replace a complete APK notice review.

The Android project and its Gradle wrapper are generated locally by the pinned CLI and remain excluded from Git. The generated project selects Gradle 9.6.1, Android Gradle Plugin 9.3.1 and Kotlin Gradle Plugin 2.2.10; AndroidX/Material/runtime dependencies also need to be included in the eventual APK dependency and notice inventory. No generated third-party source or wrapper JAR is newly vendored by this change. The manifest preparation script and Android configuration are original project code.

Development tools were obtained from official Google and Eclipse Adoptium sources. The Android command-line tools 22.0 and Temurin JDK 21.0.12.1+1 archives matched vendor SHA-256 checksums. The SDK agreement was accepted with explicit owner authorization. SDK/NDK/emulator/JDK/Gradle distributions retain their own terms and are not included in Home source or offered as Home binaries. This does not clear APK redistribution: the complete native/Java dependency notices and applicable source-availability obligations remain outstanding.
