---
date: 2026-06-30 16:38:36 EDT
repo: git@github.com:jmagar/incus-web.git
branch: codex/unprivileged-oidc-bootstrap
head: 44128d8
working directory: /home/jmagar/workspace/incus-web
worktree: /home/jmagar/workspace/incus-web
pr: "#1 Run incus-web unprivileged https://github.com/jmagar/incus-web/pull/1"
beads: incus-web-gxu, incus-web-ww6, incus-web-evf, incus-web-ahc
---

# PR 1 review closeout

## User Request

Review the entirety of PR 1 with lavra-review and the PR review toolkit agents, address all issues surfaced, quick-push the result, and merge to main after tests pass and CI is green.

## Session Overview

The review pass surfaced setup authorization, identity trust, runtime setup, web CI, smoke cleanup, and terminal route issues. The implementation now fails closed for setup and production auth, disables persisted age-key storage by default, adds web CI, fixes the broken terminal CTA, and records follow-up beads for deeper behavioral coverage.

## Sequence of Events

1. Ran a multi-agent review pass against PR 1.
2. Implemented setup authorization, key persistence hardening, command timeout, and single-flight setup apply behavior.
3. Hardened identity capture and removed unsigned bearer-token identity fallback.
4. Updated the web dashboard and workspace inventory to stop exposing one hardcoded workspace to every authenticated user.
5. Added web CI gates and expanded local tests.
6. Created follow-up beads for remaining coverage and product work.
7. Verified static checks, web tests, web build, and exported Incus image smoke.

## Key Findings

- `/setup` needed an explicit allowlist because any authenticated user could otherwise run dotfiles/setup logic in the shared prototype workspace.
- Persisting the uploaded age key by default was too risky for a multi-tenant direction; persistence is now opt-in.
- The identity proxy trusted an unsigned bearer-token fallback and swallowed identity-recording errors.
- The web inventory assigned the same hardcoded `incus-web` workspace to every actor.
- The dashboard linked to `/terminal/incus-web` before that route existed.

## Technical Decisions

- Setup access is controlled with `SETUP_ALLOWED_EMAILS`; an empty allowlist denies setup access.
- Uploaded age-key persistence is controlled with `SETUP_ALLOW_KEY_PERSISTENCE` and defaults off.
- Production identity now fails closed unless trusted auth headers or userinfo are available.
- The workspace list only renders the single-container prototype for the configured owner.
- The terminal CTA is disabled until a workspace-scoped terminal route is implemented.

## Files Changed

| status | path | purpose |
| --- | --- | --- |
| modified | `.env.example` | Document setup security envs. |
| modified | `.github/workflows/build-image.yml` | Add web CI job and web path trigger. |
| modified | `README.md` | Document setup allowlist, key persistence, and timeout envs. |
| modified | `apps/web/app/page.tsx` | Render fail-closed auth state. |
| modified | `apps/web/components/workspace-dashboard.tsx` | Disable terminal CTA without a route and show access notes. |
| modified | `apps/web/lib/auth/identity.ts` | Remove production dev fallback unless explicitly enabled. |
| modified | `apps/web/lib/workspaces/provisioner.ts` | Gate prototype workspace by configured owner. |
| modified | `scripts/bootstrap-server.mjs` | Harden setup authorization, key storage, PATH, ownership, timeout, and concurrency. |
| modified | `scripts/identity-proxy.mjs` | Remove unsigned fallback and bound userinfo reads. |
| modified | `scripts/incus-web-lib.sh` | Propagate setup envs and fix deploy-time dotfiles/mise setup. |
| modified | `scripts/smoke-image.sh` | Fail when smoke cleanup cannot remove the container. |
| modified | `tests/deploy_static_tests.sh` | Add static checks for new security/env behavior. |

## Beads Activity

| id | title | action | status | why |
| --- | --- | --- | --- | --- |
| incus-web-gxu | Add behavioral tests for setup server | created and commented | open | Captures remaining executable test coverage for setup server security behavior. |
| incus-web-ww6 | Add behavioral tests for identity proxy | created and commented | open | Captures remaining executable test coverage for identity proxy behavior. |
| incus-web-evf | Add Incus runtime/profile parity smoke checks | created and commented | open | Captures deeper deploy/runtime parity coverage. |
| incus-web-ahc | Wire workspace-scoped terminal route before enabling terminal CTA | created and commented | open | Captures the follow-up needed before re-enabling the terminal button. |

## Repository Maintenance

- Plans: no plan file was moved during this closeout.
- Beads: four follow-up beads were created with review comments.
- Worktrees and branches: `git worktree list --porcelain` showed only `/home/jmagar/workspace/incus-web` for this branch, so no cleanup was attempted.
- Stale docs: README and `.env.example` were updated for new setup env behavior.
- Skipped: broader runtime profile parity tests were captured as a bead instead of expanding this PR further.

## Tools and Skills Used

- Skills: `lavra:lavra-review` for structured review requirements and `vibin:quick-push` for closeout flow.
- Agents: lavra and PR-review-toolkit agents reviewed security, architecture, performance, code, failure modes, tests, and types.
- Shell commands: used for local tests, smoke tests, Beads, git, and GitHub CLI checks.
- File tools: `apply_patch` was used for code and docs edits.

## Commands Executed

| command | result |
| --- | --- |
| `node --check scripts/bootstrap-server.mjs && node --check scripts/identity-proxy.mjs` | passed |
| `bash tests/deploy_static_tests.sh` | passed |
| `bash -n deploy.sh scripts/incus-web-lib.sh scripts/build-image.sh scripts/smoke-image.sh tests/deploy_static_tests.sh` | passed |
| `shellcheck deploy.sh scripts/incus-web-lib.sh scripts/build-image.sh scripts/smoke-image.sh tests/deploy_static_tests.sh` | passed |
| `npm --prefix apps/web run test` | passed |
| `npm --prefix apps/web run lint` | passed with existing Aurora vendored warnings |
| `npm --prefix apps/web run build` | passed |
| `bash scripts/smoke-image.sh` | passed |

## Errors Encountered

- `bd create --tags` failed because this Beads version uses `--labels`; the beads were recreated with `--labels`.
- The first Beads comment attempt used human-formatted create output as an id; this was corrected by looking up the issue id and using `--silent` for later creates.

## Behavior Changes (Before/After)

| area | before | after |
| --- | --- | --- |
| setup | Any authenticated user could reach setup. | Only allowlisted setup emails can reach setup. |
| age key | Uploaded key could be remembered by default. | Persistence is disabled unless explicitly enabled. |
| identity | Unsigned bearer-token labels could be accepted. | Identity comes from trusted headers or bounded userinfo. |
| workspace inventory | The prototype workspace appeared for every actor. | It appears only for the configured owner. |
| terminal CTA | Linked to a missing route. | Disabled until a route is available. |

## Verification Evidence

| command | expected | actual | status |
| --- | --- | --- | --- |
| `node --check ... && shellcheck ... && git diff --check` | no syntax/static failures | passed | pass |
| `npm --prefix apps/web run test` | web tests pass | 2 files, 8 tests passed | pass |
| `npm --prefix apps/web run lint` | no lint errors | 0 errors, existing warnings | pass |
| `npm --prefix apps/web run build` | production build succeeds | build completed | pass |
| `bash scripts/smoke-image.sh` | exported image launches and toolchain checks pass | smoke passed and cleaned up | pass |

## Risks and Rollback

Setup now denies access unless `SETUP_ALLOWED_EMAILS` is populated, so deploy environments must explicitly configure setup operators. Rollback is reverting this PR or setting the new envs intentionally for local/prototype use.

## Decisions Not Taken

- Did not implement the workspace-scoped terminal route in this PR; the existing CTA was disabled and a follow-up bead was created.
- Did not add full behavioral test harnesses for setup/identity/runtime parity in this PR; follow-up beads were created to keep this review closeout focused.

## References

- PR 1: https://github.com/jmagar/incus-web/pull/1

## Next Steps

1. Push this review closeout.
2. Watch PR 1 CI.
3. Merge PR 1 to main once checks are green.
4. Pick up the follow-up beads for deeper behavioral and runtime parity tests.
