# incus-web Codebase Profile

## Stack

- Bash provisioning entrypoint in `deploy.sh`.
- Shared shell library in `scripts/incus-web-lib.sh`.
- Node `.mjs` helper services for setup, identity proxying, and browser terminal integration.
- Incus profile and distrobuilder image recipe for the workspace container.
- Markdown contracts/specs for the planned multi-tenant control plane.

## Runtime Shape

- The host owns Incus project/profile/container lifecycle.
- The workspace container remains unprivileged with `security.nesting=true`.
- Access can be Tailscale-based or OIDC-based; the current live path uses Authelia/OIDC through the reverse proxy.
- `ghostty-web` is the browser terminal experiment; WeTTY remains part of the existing provisioning path.

## Product Direction

- Build toward a multi-user workspace model where each authenticated user has an owned workspace.
- Sharing should be explicit and should grant access to the same live container/session for the same Linux user unless a later product decision changes that.
- The future web UI should use Next.js plus the Aurora shadcn-compatible registry/components from `../aurora-design-system`.

## Review Focus

- Keep host/container privilege boundaries clear.
- Do not reintroduce privileged Incus containers.
- Treat OIDC identity propagation and workspace ownership as security-sensitive.
- Prefer focused verification of changed provisioning paths over broad unrelated rewrites.
