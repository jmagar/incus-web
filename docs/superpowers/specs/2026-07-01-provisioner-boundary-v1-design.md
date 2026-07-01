# Provisioner Boundary v1 Design

Date: 2026-07-01
Status: draft for implementation planning
Bead: `incus-web-4fd`

## Goal

Define the first implementable slice of the multi-tenant workspace platform: a narrow host provisioner boundary that owns Incus and ZFS operations while the Next.js app owns users, workspaces, authorization, and product state.

This spec narrows the broader contract in `docs/contracts/multi-tenant-control-plane-v1.md` into the first build step after PR 1.

## Context

`incus-web` now has:

- an unprivileged nested Incus image and profile
- Authelia/OIDC identity propagation
- a Next.js dashboard using Aurora tokens/components
- a single hardcoded prototype workspace
- deploy scripts that can build, smoke, and run one container

The next risk is letting the web app grow direct host power. The provisioner boundary prevents that by making Incus, ZFS, network ACL, profile, and setup execution host-owned implementation details.

## Non-Goals

- Do not implement org sharing in this slice.
- Do not implement terminal WebSocket routing in this slice.
- Do not build a multi-host scheduler.
- Do not expose raw Incus REST endpoints to the browser or Next.js route handlers.
- Do not move setup fully out of the container yet; v1 only creates the boundary that will later own it.

## Approach Considered

### Recommended: Local Host Provisioner Service

Run a small host-side service or worker next to Incus. The Next.js app calls product-level commands over a Unix socket or localhost-only HTTP endpoint. The service validates metadata, executes Incus/ZFS commands, and returns bounded operation results.

Why this is the first choice:

- keeps broad Incus authority out of Next.js
- works on the current single host
- can start with shell-backed Incus commands and later move to the Incus API client without changing the web app contract
- maps cleanly to future multi-host provisioners

### Alternative: Direct Incus API From Next.js

Next.js could call Incus directly with a restricted certificate. This is faster to wire but gives the web runtime host mutation power and makes every route handler a security boundary around raw Incus operations.

Reject for v1.

### Alternative: Queue-Only Worker

Next.js could write desired operations to a database and a worker could poll. This is durable and production-friendly, but it adds operation queue complexity before the command boundary is proven.

Defer. The v1 provisioner should expose operation ids and can later be backed by a durable queue.

## Architecture

### Components

1. **Next.js control plane**
   - Authenticates users through trusted OIDC headers.
   - Stores users, workspaces, grants, setup state, and operation records.
   - Resolves authorization before issuing provisioner commands.
   - Never receives Incus host credentials.

2. **Host provisioner**
   - Runs on the host with permission to manage Incus and ZFS.
   - Accepts only product-level commands.
   - Validates workspace id, project name, container name, and allowed state transitions against control-plane metadata.
   - Executes Incus/ZFS/profile/network operations.
   - Returns bounded structured results and operation errors.

3. **Workspace container**
   - Runs one Linux workspace user, initially `agent`.
   - Receives workspace identity metadata and setup inputs through provisioner-mediated operations.
   - Does not know global tenancy or grant data.

## Transport

Use a host-local transport for v1:

- preferred: Unix domain socket at `/run/incus-web/provisioner.sock`
- acceptable fallback: `127.0.0.1` HTTP bound to a random or configured port

The socket or local endpoint is not exposed through SWAG, Tailscale, or the workspace container network.

Authentication between Next.js and the provisioner is host-local plus a shared service token. The token is not a user token and does not contain authorization claims. It only proves the caller is the trusted web control plane.

## Command Envelope

Every command uses a single envelope:

```ts
type ProvisionerCommand<T> = {
  version: "provisioner.v1"
  requestId: string
  type: ProvisionerCommandType
  actor: {
    userId: string
    oidcSubject: string
    email: string
    displayName?: string
  }
  workspace: {
    id: string
    ownerUserId: string
    incusProject: string
    incusContainer: string
  }
  payload: T
}
```

The provisioner records `actor` for audit context but does not trust it for authorization. Authorization is resolved by the control plane before the command is sent. The provisioner still rejects commands when workspace metadata does not match the requested Incus project/container.

## V1 Commands

### CreateWorkspace

Creates a new private workspace from the current template source.

Payload:

```ts
type CreateWorkspacePayload = {
  templateVersion: string
  resourceProfileId: "local-dev"
  autoStart: boolean
}
```

Provisioner behavior:

- ensure the user/workspace Incus project exists
- clone from the configured template when available
- otherwise launch from the current image alias as a fallback
- apply `incus-web-agent` profile
- apply limits from the resource profile
- attach the managed bridge and LAN-blocking ACL
- attach workspace disk mount
- write workspace identity metadata
- optionally start the container

### StartWorkspace

Starts a stopped or degraded workspace container.

Provisioner behavior:

- verify container exists in expected project
- start the container
- wait for running state
- return current status

### StopWorkspace

Stops a running or degraded workspace container.

Payload:

```ts
type StopWorkspacePayload = {
  force: boolean
  timeoutSeconds: number
}
```

### RestartWorkspace

Restarts a running or degraded workspace container. The implementation may compose `StopWorkspace` and `StartWorkspace` internally.

### GetWorkspaceStatus

Returns runtime state for dashboard/detail screens.

Result:

```ts
type WorkspaceRuntimeStatus = {
  workspaceId: string
  state: "creating" | "stopped" | "starting" | "running" | "stopping" | "degraded" | "failed"
  incusProject: string
  incusContainer: string
  cpuCount?: number
  memoryUsedBytes?: number
  memoryLimitBytes?: number
  rootDiskUsedBytes?: number
  rootDiskLimitBytes?: number
  loadAverage?: [number, number, number]
  setupPhase?: string
  lastCheckedAt: string
}
```

### RunSetup

Runs the existing dotfiles/mise setup flow through the provisioner boundary.

Payload:

```ts
type RunSetupPayload = {
  dotfilesRepo?: string
  ageKey?: {
    value: string
    persistEncrypted: boolean
  }
  skipAptScripts: boolean
}
```

Provisioner behavior:

- validate repo and age key input
- deny key persistence unless host policy enables it
- execute setup in the target workspace only
- bound logs and output returned to the control plane
- remove raw age key after use

## Operation Model

V1 may execute commands synchronously internally, but the external response shape is operation-based:

```ts
type OperationStatus = "queued" | "running" | "succeeded" | "failed"

type ProvisionerOperation<T = unknown> = {
  id: string
  requestId: string
  type: ProvisionerCommandType
  workspaceId: string
  status: OperationStatus
  result?: T
  error?: ProvisionerError
  startedAt?: string
  completedAt?: string
}
```

This lets the UI and database model move to async queues later without changing product routes.

## Error Handling

Errors are mapped into stable codes:

```ts
type ProvisionerErrorCode =
  | "invalid_input"
  | "metadata_mismatch"
  | "invalid_state"
  | "template_unavailable"
  | "incus_unavailable"
  | "zfs_unavailable"
  | "quota_failed"
  | "setup_failed"
  | "timeout"
  | "operation_failed"
```

Browser-facing responses never include raw Incus stderr. Raw output belongs in host logs. UI-visible excerpts are bounded and redacted.

## Security Rules

- Next.js never shells out to `incus`, `zfs`, or setup scripts from request handlers.
- The provisioner never accepts arbitrary shell snippets.
- Incus project/container names are generated by the control plane and validated by the provisioner.
- Workspace containers remain unprivileged with nesting enabled by default.
- `security.privileged=true` is not part of the hosted multi-tenant path.
- Shifted workspace mounts remain the runtime default; CI may use unshifted disposable mounts only for runner compatibility.
- Setup may install user dotfiles into the user’s personal workspace container, but never into the golden image or template.

## Data Flow

1. User signs in through Authelia/OIDC.
2. Next.js upserts the local user record.
3. User requests workspace creation.
4. Next.js creates workspace metadata in `creating` state.
5. Next.js sends `CreateWorkspace` to the provisioner with generated Incus names.
6. Provisioner creates/clones/configures the container and returns an operation result.
7. Next.js stores the operation, updates workspace state, and renders status.
8. Later lifecycle/setup/status actions follow the same command envelope.

## Testing Strategy

### Unit Tests

- command schema validation
- workspace metadata mismatch rejection
- allowed state transition checks
- error mapping from provisioner failures
- setup input validation

### Contract Tests

- every control-plane operation emits the expected provisioner command envelope
- provisioner rejects raw/unexpected command types
- provisioner rejects mismatched workspace id/project/container tuples

### Local Integration Tests

- create workspace from current image alias
- start, stop, restart, status
- run setup with a test dotfiles repo
- verify container remains unprivileged and nested
- verify LAN-blocking network ACL is attached

### CI Strategy

CI should keep building and smoking the image. Full Incus lifecycle tests can run on hosts that support required Incus features. GitHub-hosted runners may need compatibility flags for idmapped mounts, so CI tests must distinguish runner compatibility from production runtime policy.

## Implementation Slice

The first implementation plan should deliver:

1. Provisioner TypeScript contract types under `apps/web/lib/provisioner`.
2. A local provisioner client interface used by server code.
3. A static prototype status adapter that is explicitly scoped to current single-container inventory compatibility.
4. Workspace inventory backed by provisioner `GetWorkspaceStatus` instead of hardcoded constants.
5. Tests for command validation, status tuple validation, non-owner workspace visibility, and failed/malformed status results.

The host-side script-backed provisioner implementation is the next slice. It should add a Unix socket or localhost-only authenticated transport, host metadata revalidation, redacted operation storage, and a `GetWorkspaceStatus` implementation that can replace the static adapter without changing workspace inventory callers.

Database-backed persistence can be added in the next slice if it makes the first slice too large. The contract should already assume persistence exists so the implementation does not paint itself into a single-process corner.

## Acceptance Criteria

- The spec clearly separates control-plane authorization from host mutation.
- The first command set is limited to create, lifecycle, status, and setup.
- Raw Incus API access is not exposed to browser or Next.js route handlers.
- The design preserves unprivileged hosted containers.
- The implementation slice is small enough to plan and review as one PR.
