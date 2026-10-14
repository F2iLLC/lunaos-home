# Dependency provenance

The draft preview introduces two direct dependencies, pinned in `package.json` and `package-lock.json`:

| Package | Version | Upstream | License | Purpose |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1 | [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT, copyright Anthropic PBC | Maintained stdio protocol implementation. |
| `zod` | 4.6.7 | [Zod](https://github.com/colinhacks/zod) | MIT, copyright Colin McDonnell | Bound and validate draft inputs. |

Installed package manifests and direct LICENSE files were inspected. The locked dependency tree contains 85 MIT, seven ISC, two BSD-3-Clause and one BSD-2-Clause packages, excluding Home itself. These permissive licenses can accompany Apache-2.0 Home; dependencies retain their own licenses. Source is installed from the public npm registry using the lockfile integrity values, not copied from enterprise LunaOS. Install scripts were disabled. The initial npm advisory audit reported no known vulnerabilities; this is not a security review or future guarantee.

No third-party source is vendored in this repository. npm packages include their own notices. Any future bundle or installer that redistributes dependency code must preserve the applicable copyright/license notices, including transitive packages; do not label dependencies as newly authored Apache code. Recheck this record and notice obligations when updating the lockfile or packaging native dependencies.

The preview and tests were authored with AI assistance and reviewed against the public SDK API. No enterprise source, user reference-image assets or private data were copied. Candidate native facilities in the architecture document are not yet imported dependencies.
