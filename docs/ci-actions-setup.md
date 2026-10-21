# GitHub Actions setup and acceptance

The public Home repository's Actions setting is **disabled**. Its test workflow
calls a main-pinned reusable job that requests only the `home-public-untrusted`
self-hosted runner group and the `home-pr-isolated` label. These names are a
fail-closed target, not evidence that
the group or runner exists. Do not enable Actions until the checks below pass.
The [repository rules](../REPOSITORY_RULES.md#ci-and-untrusted-contributions)
are authoritative; this handoff does not relax them.

## Repository-side test workflow

`.github/workflows/test.yml` runs on pushes to `main` and `pull_request` and
calls `.github/workflows/test-runner.yml@main`. The reusable workflow defines
the runner job and is the only workflow the isolated group should admit. This
keeps the runner-eligible workflow on `refs/heads/main` even when the caller
runs from a PR merge ref. Both workflows use `contents: read`; the job has
nonpersisted checkout credentials, no passed job secrets or cache, and a
ten-minute limit. Its image must provide the OpenSSL CLI used by the TLS
fixtures; the job checks for it before installing locked npm dependencies
without lifecycle scripts, then calls `npm test`. The test launcher selects
only `test/*.test.js`
rather than allowing Node to discover attended device scripts. On Windows it
omits the Linux-only Android container test; the intended Linux runner includes
that test. This workflow does not build native binaries or run physical-device
acceptance checks.

## Administrator setup and proof

An organization runner administrator must:

1. Provision a Linux x64 runner image with Node 24 support and an OpenSSL CLI
   that supports the test fixture's EC key, certificate and PKCS#12 commands.
   Use one-job JIT registration (or `--ephemeral`) and destroy its clean VM or
   container after automatic deregistration. No enterprise network, data,
   credentials, privileged host mounts or shared writable cache may be present.
   Put the runner in a new group named `home-public-untrusted` with the
   `home-pr-isolated` label. Do not add a
   `ci-general` or other enterprise runner to that group.
2. Restrict the group to selected public repositories and
   `F2iLLC/lunaos-home/.github/workflows/test-runner.yml@refs/heads/main`.
   Remove Home's access to enterprise runner groups at the
   organization/enterprise policy layer; a PR can edit workflow YAML, so the
   `runs-on` value alone is not an access control. Keep trusted release jobs in
   separate groups. Verify the effective group and workflow policies with
   administrator access.
3. Temporarily allowlist the equivalent main-pinned reusable test workflow in
   a disposable public canary repository, using the same runner image and group
   isolation policy before enabling Home. Run a synthetic
   fork PR containing harmless untrusted code. Confirm the assigned runner is
   the disposable pool, the job token is read-only, no job secrets are present,
   an approved enterprise-network probe is denied, and no files or processes
   persist to the next job and the old runner registration cannot take another
   job. Confirm an edited workflow cannot select an
   enterprise runner. Remove the canary workflow from the group allowlist after
   the test. Keep probe values and raw logs outside this repository.
4. Merge the reviewed workflow before enabling Home Actions so the reusable
   workflow exists on `main`. After the canary checks pass, enable Actions for
   Home and repeat the synthetic fork/PR routing and cleanup checks against
   this repository before treating
   CI as accepted. Run the normal test workflow on a trusted push and verify
   its check result on the exact commit. If a check routes to another pool or
   cannot demonstrate isolation, disable Home Actions again and investigate.

The current repository account can read the Home Actions setting but receives
HTTP 403 when listing organization runner groups or Actions policy. The Home
repository currently reports zero registered repository runners. No live group,
runner, canary, hosted check, or isolation proof is claimed here. The workflow
preparation must remain separate from permission to enable Actions.

GitHub documents [runner-group repository and workflow restrictions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
and [one-job JIT runners](https://docs.github.com/en/actions/reference/security/secure-use#using-just-in-time-runners),
as well as [the risks of self-hosted runners for public PRs](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization).
