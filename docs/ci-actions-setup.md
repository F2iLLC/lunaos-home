# GitHub Actions setup and acceptance

Home is public, and repository Actions is currently **disabled**. The reviewed
test workflow must be on `main` before enablement. Its public PR job uses the
standard GitHub-hosted `ubuntu-24.04` virtual machine. No new server or
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

## Enablement and proof

1. An organization administrator verifies that **no** organization or
   enterprise self-hosted runner group is available to the public Home
   repository. The organization's repository-level self-hosted runner policy
   must also be `Disabled` or `Selected repositories` with Home excluded;
   zero registered Home runners alone does not prevent a new one. Preserve
   other repositories' existing runner access. A PR can edit its workflow and
   request a different `runs-on`; the workflow label alone cannot enforce this
   boundary. Recheck effective group and repository-level policy immediately
   before enablement and after policy changes.
2. Review and merge the hosted workflow and this policy change. Verify the
   exact `main` commit and that the normal job has read-only permissions, no
   secrets or shared cache, and no self-hosted target. Confirm the organization
   allows standard hosted runners. Enable Actions for Home only; leave other
   repository Actions settings unchanged.
3. Open a harmless synthetic PR **from a fork**. Verify the normal job ran on
   the GitHub-hosted Linux VM, not the Hetzner fleet; the token is read-only;
   no secrets are passed; and an approved private enterprise-network probe is
   denied. Run a second job and verify a fresh VM. The temporary
   `self_hosted_denial_canary` job is already in the default-branch workflow;
   it requests `runs-on: self-hosted` only for the named `ci-deny-self-hosted`
   branch of the designated canary fork, has no checkout or token permissions,
   and executes only a harmless command if misrouted. Confirm the run is
   eligible to start (not awaiting fork approval), remains unassigned with no
   runner ID despite an idle matching organization runner, and matches the
   administrator's zero-access policy query. Cancel the queued canary, then
   remove the temporary job in a reviewed follow-up change.
   A normal `ubuntu-24.04` run alone does not test the denied self-hosted
   route. Keep raw logs and any probe values outside this repository. If a
   self-hosted job is assigned or another boundary fails, disable Home Actions
   and investigate.
4. Run the normal workflow on a trusted `main` push and verify the check on
   that exact commit. Keep this hosted CI result separate from native builds,
   attended device tests, security review, merge and product acceptance.

At this review, the only listed organization runner group was Default,
which disallows public repositories; a query scoped to Home returned zero
visible groups. The repository reports zero registered repository runners.
On 2026-10-21, an organization administrator set repository-level self-hosted
runner creation to `Selected repositories`, selected the other 11 current
F2iLLC repositories, and verified after a reload that Home remains excluded.
The organization also allows standard hosted runner labels. Recheck these
settings immediately before enablement; these observations do not prove
future group settings or a completed hosted run.

GitHub documents [standard hosted runner isolation and public-repository
pricing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[runner-group access controls](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access),
and [fork-PR token restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
