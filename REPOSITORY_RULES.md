# Repository rules

These are the authoritative contribution and release rules for this project. They apply to the user/team and human or AI contributors; they do not amend [Apache-2.0](LICENSE) or impose additional downstream usage restrictions. Product controls described below are requirements to implement and verify, not claims that the checklist already enforces them.

## Keep source separate from household data

Keep application code, supporting tests/configuration, and useful user/developer documentation here. The requested product roadmap and contributor rules are allowed. Use synthetic examples and fixtures only.

Do not put household records, IDs, document photos, real private-file paths/links, credentials, secrets, logs, transcripts, scratch plans, progress/status dumps, production exports, or production screenshots in the checkout, Git history, issues, PRs, or CI artifacts. Scratch work belongs outside the tracked checkout. Do not attach real data to demonstrate a bug; recreate it with fictional data.

Review staged files and diffs before every publication. Ignore rules are a precaution, not a scanner or security boundary; do not force-add excluded material. If sensitive content is committed or disclosed, stop further distribution, notify the owner through an existing private channel, revoke exposed credentials as appropriate, and coordinate removal/history remediation. Deleting it from the latest commit alone does not remove history or copies.

## Access and external processing

- Discover only user-authorized locations and configuration. Do not scan arbitrary personal folders, silently inherit enterprise access, or treat a discovered path as permission to read it.
- Keep vault records and credentials in the user's computing environment outside the source tree. Do not create operator custody of records or a hosted vault. Per-person folders organize content; explicit authorization must govern access.
- Use established encryption, key-management, and credential facilities; do not design custom cryptography. Do not return raw passwords/tokens or whole vault contents to a model. Use narrowly scoped local operations or references and minimize returned fields.
- No silent upload or telemetry. Before external document analysis, explain the selected contents, destination provider, purpose, and access in understandable language and obtain consent. Explain that the provider controls its own security, privacy, and retention practices; make no zero-retention guarantee. Home remains responsible for its own application and transfer behavior.
- Make permissions visible, scoped, and revocable. Important external writes must be visible, authorized, and auditable. Honor an existing authorization for routine actions within its stated scope; request a fresh decision when destination, data, action, or scope materially changes. Revocation must stop new work and explain any already-sent or in-flight action it cannot undo.
- GUI access/activity records must distinguish configuration, verification, attempts, and observed results, with source and freshness. Do not claim insight into assistant or third-party connector behavior that Home cannot observe. Audit evidence must minimize sensitive content and remain local.

## Rights, reuse, and dependencies

Apache-2.0 applies to newly authored Home material, not everything reachable from this organization. Enterprise LunaOS has a proprietary license; its source may not be copied, extracted, changed, or distributed into Home without express written authorization from the relevant rights holder and a compatible license review. The GitHub organization does not prove copyright ownership. Do not label enterprise material Apache-2.0 by placing it here.

Before accepting a dependency, copied snippet, generated asset, shared package, or other imported material, verify its source, rights, license compatibility, and required notices. Preserve third-party license/attribution/NOTICE obligations and modification notices where applicable. Do not fabricate a copyright holder, CLA, or blanket rights assurance. Obtain an authorized decision when rights are unclear.

Prefer suitable existing contracts/libraries to duplicate implementations, but share only through deliberately versioned, authorized boundaries. Isolate Home configuration, environment variables, credentials, data/vault, logs, sessions, tool/event names, queues, namespaces, and job identity. Do not import the full enterprise runtime or rely on its defaults. Namespacing alone is not a data-security boundary.

## CI and untrusted contributions

**Current state:** the workflow uses shared F2iLLC self-hosted `ci-general` infrastructure. Read-only job token permissions and nonpersisted checkout credentials are configured; these do not isolate arbitrary contributor code. The repository is private. A safe public-contribution runner/trust policy is not established by this starter.

**Before public visibility or accepting untrusted code for execution:** establish a tested, isolated self-hosted runner/trust policy. Do not route untrusted forks or PR code onto enterprise runners, even after a human clicks an approval button. Use a separate appropriate runner pool with no enterprise network/data/credential access, no secrets for untrusted jobs, minimal token permissions, and disposable clean execution state. Keep trusted release jobs separately controlled. Labels alone are not proof of isolation.

Never use `pull_request_target` to execute an untrusted checkout. Do not allow an untrusted workflow change or build script to select the enterprise pool, obtain secrets, poison shared caches, or persist state for another job. Validate the chosen repository/runner-group controls and trust policy with a synthetic fork/PR: verify the assigned runner, denied enterprise access, absent secrets, and cleanup between runs. Restrict enterprise runner access to trusted repositories/workflows through the appropriate authorized administrator. Do not change organization policy casually to make checks green. If an isolated policy cannot be established, keep the repository private and do not execute untrusted contributions.

Self-hosted infrastructure remains required; this rule is not an instruction to switch to GitHub-hosted compute. Infrastructure and policy changes need their own review and authority; they are not configured by these documents.

## Public source release checklist

The owner must authorize visibility change after a reviewer verifies:

- All publishable history/refs and relevant issues, PRs, release files, and CI artifacts have been reviewed for secrets, personal information, private references, and enterprise material. Resolve findings and credential exposure before publication.
- Copyright/provenance, Apache scope, dependency licenses, and required notices are reviewed; no proprietary enterprise material is included without written rights and compatible terms.
- A clean external checkout builds/tests without enterprise or household access, and the isolated self-hosted trust policy above has been exercised successfully.
- A private vulnerability reporting route is established and tested, with instructions visible to future reporters. Do not claim GitHub private vulnerability reporting is enabled until it has been verified.
- Documentation accurately distinguishes the starter, proposed V1, known limitations, supported combinations, and actually enforced controls. No real screenshots or live data are used as release examples.

This checklist is not yet a passed gate. Public source release may precede V1, but neither happens automatically when a PR passes CI. See [ROADMAP.md](ROADMAP.md) for usable V1 acceptance.

## Vulnerability reports while private

Use an existing private channel to the project owner/maintainer to request secure report handling; share minimal detail until that channel is confirmed appropriate. If you have no such channel, request a private reporting route without disclosing exploit details or personal data. Do not post a vulnerability publicly to get attention. No reporting email is designated here, and GitHub private reporting is not claimed to be enabled. Establishing and testing that route is a public-release blocker, not a reason to invent a contact address.
