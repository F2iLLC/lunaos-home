# GitHub Actions setup and acceptance

Home is public, and repository Actions is **enabled**. The reviewed test
workflow landed on `main` in [PR #74](https://github.com/F2iLLC/lunaos-home/pull/74).
Its public PR job uses the standard GitHub-hosted `ubuntu-24.04` virtual machine. No new server or
Hetzner runner is needed. GitHub says standard hosted runners are free for
public repositories; this does not change other F2iLLC repositories or their
runner choices. The [repository rules](../REPOSITORY_RULES.md#ci-and-untrusted-contributions)
are authoritative.

## Test workflow

`.github/workflows/test.yml` runs on pushes to `main` and `pull_request`. Its
job requests `ubuntu-24.04`, checks GitHub's `RUNNER_ENVIRONMENT` before
checkout, and has `contents: read`, a ten-minute limit, no job secrets or
cache, and nonpersisted checkout credentials. It verifies the
OpenSSL CLI, installs locked npm dependencies without lifecycle scripts, and
runs `npm test`. The test launcher selects `test/*.test.js`; Linux includes the
Android container test. This workflow does not build native binaries or run
physical-device acceptance checks. Do not add `pull_request_target` or a
self-hosted runner to this untrusted job. The environment check detects an
unexpected runner in this reviewed workflow; it cannot stop a PR author from
editing the workflow and does not replace runner-group exclusion.

## Live proof and remaining checks

On 2026-10-21, an organization administrator verified that the only listed
organization runner group was Default, which disallows public repositories.
A Home-scoped runner-group query returned zero visible groups, and Home had
zero registered repository runners. The administrator set repository-level
self-hosted runner creation to `Selected repositories`, selected the other 11
current F2iLLC repositories, and verified after a reload that Home remained
excluded. Standard hosted runner labels were enabled. These settings were
rechecked immediately before Home Actions was enabled. A PR can edit its
workflow and request a different `runs-on`; the label in this file is not a
security boundary. Recheck group and repository-level policy after changes.

[Synthetic fork PR #75](https://github.com/F2iLLC/lunaos-home/pull/75)
exercised the default-branch test workflow twice:

- [First run](https://github.com/F2iLLC/lunaos-home/actions/runs/39551574609):
  the normal job passed on GitHub Actions runner `1000006239`; logs showed
  `Contents: read`, `Metadata: read`, and `Secret source: None`. The deliberate
  `self-hosted` job remained queued with no runner ID while matching
  organization runners were online and idle. It was canceled.
- [Second run](https://github.com/F2iLLC/lunaos-home/actions/runs/39551657190):
  the normal job passed on a different GitHub Actions runner, `1000006240`,
  with the same token and secret-source restrictions. The self-hosted job
  again remained unassigned and was canceled.

The temporary denial job is removed in the reviewed follow-up to those runs.
Raw logs and any probe values stay outside this repository. If a future
self-hosted job is assigned or another isolation boundary fails, disable Home
Actions and investigate.

**Still required before calling CI accepted:** run an approved private
enterprise-network probe from a hosted fork job without publishing sensitive
targets or credentials, and verify a normal workflow on the exact trusted
`main` commit after this follow-up merges. Keep hosted CI results separate
from native builds, attended device tests, security review, merge and product
acceptance.

GitHub documents [standard hosted runner isolation and public-repository
pricing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[runner-group access controls](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access),
and [fork-PR token restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
