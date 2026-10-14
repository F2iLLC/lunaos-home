# Collaborators

This guide applies to human contributors, AI workers, reviewers, and maintainers. It assigns responsibilities by role, not named individuals. The [repository rules](REPOSITORY_RULES.md) are authoritative; [ROADMAP.md](ROADMAP.md) defines proposed product scope. No contributor agreement or individual collaborator roster is created by this document.

## Decision ownership

| Role | Responsibility and decisions |
| --- | --- |
| Project owner | Set product scope and priorities; select supported release combinations; authorize public visibility and releases after gates pass. Resolve scope changes and identify the appropriate rights holder for reuse decisions. |
| Maintainer | Keep interfaces and dependencies coherent, assign bounded work, preserve unrelated changes, review publication evidence, and merge only with authority and required review. |
| Contributor / supervising human or agent | Implement the agreed change, inspect generated work, use synthetic fixtures, disclose provenance and limitations, and publish a reviewable PR. A supervisor publishes for a worker that is not permitted to push. |
| Reviewer | Check behavior, tests, scope, data handling, rights, and user-facing claims. For sensitive access or release-gate changes, provide a second-person review rather than treating author self-review as approval. |
| Security / CI maintainer | Verify scoped access and failure behavior, manage the private vulnerability route, and establish/test runner trust isolation before public contributions. Do not grant broad access just to unblock a test. |
| Rights holder or authorized licensing decision maker | Confirm rights and license compatibility for imported/shared material. Repository membership or a maintainer role alone does not establish that authority. |

One person can perform multiple roles; identify who is taking a consequential decision in the PR. Keep second-person review for sensitive changes. Do not invent approvals, identities, or claims that a policy is technically enforced.

## A small contribution workflow

1. Read the relevant roadmap acceptance criteria and repository rules. Inspect existing Home and approved reusable capabilities before building duplicates. Agree significant scope or interface changes with the owner; routine implementation choices stay with the contributor.
2. Use a branch or isolated checkout, preserve other workers' changes, and keep scratch material outside the tracked checkout. Do not copy enterprise code while investigating reuse.
3. Make the smallest coherent change. GUI and MCP behavior must share services, authorization, and state. Include meaningful tests for changed behavior and failure paths; documentation-only changes need document, link, and license checks rather than redundant application tests.
4. Review the staged paths and diff, including generated files. Use fictional fixtures and sanitized evidence. State which code was AI-generated or externally sourced when that helps a reviewer assess provenance; AI output gets the same correctness, rights, privacy, and review checks as other contributions.
5. Commit and publish to a PR within the authorized scope. Use `$yeet` if available, or Git/GitHub tooling otherwise. Workers without publication authority hand off to their supervisor. Verify the actual remote head and PR instead of reporting only a local commit.
6. Describe the problem, final behavior, validation, and material limits. Address review findings. Publication is not permission to merge, change visibility, deploy, or release; preserve a user-selected draft state.

## Reviewable evidence

Keep evidence concise and synthetic: changed behavior, exact commit, checks actually run and their outcomes, manual GUI/MCP observations where relevant, and unresolved decisions. Distinguish local checks, CI, review, merge, deployment, and release. A queued or skipped job is not a passing test; green CI is not a security or V1 acceptance sign-off.

PRs that add access or external actions should show what is authorized, how revocation behaves, and what the GUI can actually observe. Dependency or shared-code changes must include provenance/license review and required notices. Release-gate evidence belongs in a sanitized review record, never a dump of household data or credentials.

## Public collaboration

Use issues and PRs for product defects, proposed changes, and fictional reproductions. The repository rules cover prohibited data and the private vulnerability route. Do not invite public contributions onto the current shared enterprise runner setup: public source release first requires the isolated self-hosted trust policy and publication review described there. External contributors must not need enterprise code, enterprise credentials, or access to a household vault to build and test accepted Home source.
