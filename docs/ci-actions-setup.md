# GitHub Actions setup and acceptance

The public Home repository's Actions setting is **disabled**. Its test workflow
requests only the `home-public-untrusted` self-hosted runner group and the
`home-pr-isolated` label. These names are a fail-closed target, not evidence that
the group or runner exists. Do not enable Actions until the checks below pass.
The [repository rules](../REPOSITORY_RULES.md#ci-and-untrusted-contributions)
are authoritative; this handoff does not relax them.

## Repository-side test workflow

`.github/workflows/test.yml` runs on pushes to `main` and `pull_request`, with
`contents: read`, nonpersisted checkout credentials, no job secrets or cache,
and a ten-minute limit. It installs locked npm dependencies without lifecycle
scripts, then calls `npm test`. The test launcher selects only `test/*.test.js`
rather than allowing Node to discover attended device scripts. On Windows it
omits the Linux-only Android container test; the intended Linux runner includes
that test. This workflow does not build native binaries or run physical-device
acceptance checks.

## Administrator setup and proof

An organization runner administrator must:

1. Provision a disposable Linux x64 runner with no enterprise network, data,
   credentials, or privileged host mounts. Give each untrusted job a clean
   execution state and no shared writable cache. Put it in a new group named
   `home-public-untrusted` with the `home-pr-isolated` label. Do not add a
   `ci-general` or other enterprise runner to that group.
2. Restrict the group to selected public repositories and the intended test
   workflow. Remove Home's access to enterprise runner groups at the
   organization/enterprise policy layer; a PR can edit workflow YAML, so the
   `runs-on` value alone is not an access control. Keep trusted release jobs in
   separate groups. Verify the effective group and workflow policies with
   administrator access.
3. Exercise the same runner image, group policy and fork approval behavior in
   a disposable public canary repository before enabling Home. Run a synthetic
   fork PR containing harmless untrusted code. Confirm the assigned runner is
   the disposable pool, the job token is read-only, no job secrets are present,
   an approved enterprise-network probe is denied, and no files or processes
   persist to the next job. Confirm an edited workflow cannot select an
   enterprise runner. Keep probe values and raw logs outside this repository.
4. After those checks pass, enable Actions for Home and repeat the synthetic
   fork/PR routing and cleanup checks against this repository before treating
   CI as accepted. Run the normal test workflow on a trusted push and verify
   its check result on the exact commit. If a check routes to another pool or
   cannot demonstrate isolation, disable Home Actions again and investigate.

The current repository account can read the Home Actions setting but receives
HTTP 403 when listing organization runner groups or Actions policy. The Home
repository currently reports zero registered repository runners. No live group,
runner, canary, hosted check, or isolation proof is claimed here. The workflow
preparation must remain separate from permission to enable Actions.

GitHub documents [runner-group repository and workflow restrictions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
and [the risks of self-hosted runners for public PRs](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization).
