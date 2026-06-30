# Multi-Tenant Control Plane Design

Date: 2026-06-29
Status: draft for implementation planning

## Goal

Turn `incus-web` from a single deployed browser terminal into a hosted multi-tenant workspace platform. Users sign in through Authelia/OIDC, create private workspaces, optionally share those workspaces with users or orgs, and connect to a live browser terminal backed by an Incus container.

The default workspace is private. Sharing is explicit and grants access to the same live container as the same Linux user.

## Non-Goals

- Do not build a single-user dashboard first.
- Do not create separate Linux users inside a shared workspace.
- Do not make shared access appear isolated when it is not.
- Do not bake user secrets, dotfiles, shell history, or personalized state into the base image or template.
- Do not fork Aurora UI locally. Missing UI behavior belongs upstream in `../aurora-design-system`.

## Architecture

The system has three main layers:

1. **Next.js control plane**
   - Authenticated product UI.
   - Owns workspace metadata, sharing, setup state, lifecycle views, and terminal routing decisions.
   - Uses Aurora shadcn registry components and tokens from `../aurora-design-system` / `aurora.tootie.tv`.

2. **Host provisioner**
   - Privileged host-side worker or service.
   - Owns Incus, ZFS clone/snapshot operations, profiles, network ACLs, quota application, and container lifecycle.
   - Exposes a narrow command API to the Next.js app.
   - Never runs inside user workspaces.

3. **Workspace containers**
   - One Incus container per workspace.
   - One primary Linux user, initially `agent`.
   - Runs the terminal backend, toolchain checks, dotfiles/mise bootstrap, and workspace banner.
   - Receives only workspace-specific configuration and user-approved secrets.

## Workspace Provisioning

Use both a golden image and a ZFS-backed template.

1. Build and publish a versioned `incus-web-agent:<version>` image from `distrobuilder.yaml`.
2. On each host, create a stopped template container from that image.
3. Run host-local prep once for common service configuration and cache warming.
4. Snapshot the template, for example `workspace-template@v2026-06-29`.
5. New workspace creation clones that snapshot into a new Incus container.
6. The provisioner starts the container with the workspace profile, quotas, network ACLs, and metadata.
7. Per-user bootstrap runs after clone:
   - write workspace identity metadata
   - optional dotfiles repo
   - optional encrypted age key handling
   - mise install/status
   - banner and toolchain status

The golden image is the durable source of truth. ZFS clones are the speed path. Personalized workspaces are never the default template source.

## Tenancy Model

### Users

Users are authenticated through Authelia/OIDC. The control plane stores a local user record keyed by the stable OIDC subject, with email and display name cached for UI.

### Orgs

Orgs group users for explicit sharing. A user may belong to multiple orgs. Org membership does not grant workspace access by itself; workspace access requires an explicit share grant to that org.

### Workspaces

A workspace is owned by one user and maps to one Incus container.

Default access:

- owner only
- private
- same live container for all future collaborators

Workspace metadata tracks:

- id
- owner user id
- display name
- Incus project/container name
- template/image version
- lifecycle state
- resource profile
- setup state
- created/updated timestamps

## Sharing Model

Sharing is explicit. The owner or workspace admin can grant access to:

- a user
- an org

Initial roles:

- `owner`: full control, delete, transfer, share management
- `admin`: setup changes, lifecycle actions, share management except ownership transfer
- `collaborator`: terminal access to the same live container

Do not ship a `viewer` role until there is a file/status browsing surface that is meaningfully useful without shell access.

Critical product language:

> Collaborators access this workspace as the same Linux user. They may be able to read files, shell history, credentials, decrypted dotfiles, running processes, and generated artifacts.

The isolation boundary is workspace-to-workspace, not user-to-user inside a shared workspace.

## Forking And Snapshots

Sharing keeps users in the same live container.

Forking creates a separate workspace from a ZFS snapshot or clone. Forking is the escape hatch when a user wants to collaborate without sharing the same trust boundary.

Snapshot types:

- `template`: host-managed base snapshots for fast new workspaces
- `checkpoint`: user/workspace snapshots for rollback
- `fork-source`: snapshots created to seed a new workspace

## Terminal Routing

The control plane authorizes terminal access before connecting a user to a workspace.

Flow:

1. User opens workspace terminal.
2. Next.js verifies session and workspace role.
3. Next.js issues or proxies a short-lived terminal connection token scoped to workspace id and user id.
4. Terminal gateway connects to the workspace container terminal backend.
5. The container records the authenticated display label for the login banner.
6. Multiple users can attach concurrently to the same container and same Linux user.

The terminal itself is full-bleed or primary-surface UI, not a decorative card.

## Setup Flow

The current `/setup/` page is temporary bootstrap UI. The Next.js app replaces it with an Aurora setup flow.

Setup handles:

- dotfiles repo URL
- age key upload
- optional key persistence encrypted at rest
- mise install status
- dotfiles apply logs
- command/package/toolchain checks
- rerun/retry controls

Secret handling:

- The browser uploads age identity material only through authenticated setup.
- The host/control plane should avoid storing raw keys.
- If key persistence is enabled, encrypt at rest with a host-managed key encryption key.
- The key is written inside the workspace only for the duration required by chezmoi, then removed unless explicitly persisted in encrypted form.

## Data Model

Minimum tables:

- `users`
  - `id`
  - `oidc_subject`
  - `email`
  - `display_name`
  - `created_at`
  - `updated_at`

- `orgs`
  - `id`
  - `name`
  - `slug`
  - `created_at`

- `org_memberships`
  - `org_id`
  - `user_id`
  - `role`

- `workspaces`
  - `id`
  - `owner_user_id`
  - `name`
  - `slug`
  - `incus_project`
  - `incus_container`
  - `template_version`
  - `state`
  - `resource_profile_id`
  - `created_at`
  - `updated_at`

- `workspace_grants`
  - `workspace_id`
  - `subject_type` (`user` or `org`)
  - `subject_id`
  - `role`
  - `created_by_user_id`
  - `created_at`

- `workspace_setup`
  - `workspace_id`
  - `dotfiles_repo`
  - `dotfiles_status`
  - `mise_status`
  - `last_log_excerpt`
  - `updated_at`

- `workspace_snapshots`
  - `id`
  - `workspace_id`
  - `kind`
  - `incus_snapshot`
  - `created_by_user_id`
  - `created_at`

- `audit_events`
  - `id`
  - `actor_user_id`
  - `workspace_id`
  - `action`
  - `metadata`
  - `created_at`

## Host Provisioner API

The Next.js app should not shell out to Incus directly from request handlers.

Provisioner commands:

- `CreateWorkspace`
- `StartWorkspace`
- `StopWorkspace`
- `RestartWorkspace`
- `DeleteWorkspace`
- `SnapshotWorkspace`
- `ForkWorkspace`
- `ApplyResourceProfile`
- `RunSetup`
- `GetWorkspaceStatus`

Commands are idempotent where possible and return operation ids for long-running work.

The provisioner validates that requested Incus project/container names match workspace metadata and never accepts arbitrary shell snippets from the app.

## Incus/ZFS Model

Use Incus projects to isolate tenant/workspace resources at the host layer.

Initial recommendation:

- One Incus project per user for private resources.
- Shared workspaces remain in the owner project.
- Org-level projects can be added when org-owned workspaces exist.

Resource controls:

- CPU limit
- memory limit
- process limit
- root disk quota
- network ACL blocking RFC1918/link-local egress by default

Container naming should be deterministic but not user-controlled, for example `ws-<workspace-id>`.

## Aurora UI Design

Use Aurora as the source of truth.

Required setup:

- Install Aurora tokens first.
- Install components from the Aurora shadcn registry.
- Use Manrope, Inter, and JetBrains Mono according to Aurora typography rules.
- Keep dark-first operator-console density.
- No raw hex colors in app code.
- No hand-rolled primitives when Aurora components exist.

Primary screens:

1. **Workspace dashboard**
   - private workspaces
   - shared with me
   - org workspaces
   - status, owner, resource profile, last activity

2. **Workspace detail**
   - lifecycle controls
   - setup state
   - members/shares
   - snapshots
   - resource usage

3. **Terminal**
   - focused terminal workspace
   - connection status
   - current user/workspace identity
   - no marketing content

4. **Setup**
   - dotfiles repo form
   - age key upload
   - encrypted persistence toggle
   - live setup log
   - toolchain checks

5. **Share dialog**
   - user/org search
   - role picker
   - clear warning for same-user shared container semantics

6. **Admin/operations**
   - template version
   - host provisioner status
   - failed operations
   - quota and network policy overview

## Error Handling

- Workspace creation is asynchronous and visible as an operation.
- Failed provisioner operations retain logs and are retryable when safe.
- Setup failures show the failed command phase and a bounded log excerpt.
- Terminal access denial explains whether the workspace is missing, stopped, or unauthorized.
- If the identity banner cannot resolve a display name, the terminal still opens and falls back to workspace name.

## Security Notes

- Browser-authenticated users never receive Incus host credentials.
- Host provisioner is the only component allowed to perform Incus/ZFS mutations.
- Workspace sharing grants shell-level access to the same Linux user and must be treated as high trust.
- Dotfiles and age keys are per-workspace/user setup material, not template material.
- Audit terminal opens, setup runs, lifecycle actions, share changes, snapshots, forks, and deletes.
- Keep the current default of nested but unprivileged containers for hosted multi-tenant workspaces.

## Testing Strategy

Unit tests:

- role and grant resolution
- workspace state transitions
- provisioner command validation
- setup input validation

Integration tests:

- create workspace from template
- start/stop/restart lifecycle
- share with user/org
- terminal authorization
- setup flow with test dotfiles repo
- snapshot/fork behavior

Browser tests:

- dashboard loads for authenticated user
- private workspace is not visible to another user
- shared workspace appears after explicit grant
- share dialog warning is visible
- setup form validates repo/key input
- terminal route connects only when authorized

Operational tests:

- container starts unprivileged with nesting
- quota enforcement exists
- network ACL blocks LAN egress
- ZFS clone creation is fast and storage-efficient

## Migration From Current Prototype

1. Keep current deploy scripts and `/setup/` as the working prototype path.
2. Add Next.js app and DB without removing the current path.
3. Implement read-only workspace inventory against the current `incus-web` container.
4. Add provisioner with create/start/status for cloned workspaces.
5. Move setup UI from container-local `/setup/` into Next.js.
6. Route terminal sessions through workspace authorization.
7. Retire direct public access to container-local setup once the Next.js setup flow is complete.

## Open Implementation Choices

- Database: likely Postgres for production; SQLite is acceptable only for early local development.
- Provisioner transport: local Unix socket is preferred on a single host; HTTP with mTLS can come later for multi-host.
- Terminal gateway placement: can begin as Next.js route/proxy, but may need a dedicated WebSocket service if load or session control becomes complex.
- Org-owned workspaces: defer until user-owned workspaces and explicit sharing are stable.

## Acceptance Criteria

- A new user can sign in and create a private workspace from the current template.
- The workspace is created by ZFS clone, not full reprovisioning.
- The owner can open a browser terminal into the workspace.
- The owner can explicitly share the workspace with another user.
- The collaborator opens the same live container as the same Linux user.
- The UI uses Aurora tokens and registry components.
- No user secrets or personalized state are present in the golden image/template.
- Host Incus/ZFS operations are isolated behind the provisioner boundary.
