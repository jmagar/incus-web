# Provisioner Contract And Inventory Adapter v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js-side provisioner contract/client boundary so the workspace inventory consumes a constrained `provisioner.v1` facade instead of hardcoded runtime constants. This is a contract-prep PR, not the host-local provisioner service PR.

**Architecture:** Add focused TypeScript contract schemas under `apps/web/lib/provisioner`, then build a local client with a mockable transport and a static prototype status adapter for the current single-container prototype. Wire workspace inventory through `GetWorkspaceStatus` while preserving owner-gated prototype behavior and fail-closed auth posture. The future host-local transport must replace this adapter without changing workspace inventory callers.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Aurora UI already installed.

## Global Constraints

- Contract version is exactly `provisioner.v1`.
- V1 command set is limited to `CreateWorkspace`, `StartWorkspace`, `StopWorkspace`, `RestartWorkspace`, `GetWorkspaceStatus`, and `RunSetup`.
- Next.js server code must not shell out to `incus`, `zfs`, or setup scripts from request handlers.
- This slice must not implement or expose `CreateWorkspace`, lifecycle mutation, or `RunSetup` browser routes.
- Mutation commands remain disabled until a real host-local transport, service authentication, metadata revalidation, and redacted operation store exist.
- Hosted workspaces remain `security.privileged=false`.
- Hosted workspaces keep `security.nesting=true`.
- Shifted workspace disk mounts remain the runtime default; CI may use unshifted disposable mounts only for runner compatibility.
- Raw Incus stderr, raw setup logs, secret material, and host paths must not be returned directly to browser clients.
- Secret-bearing fields must be redacted from logs and operation records.
- Hosted v1 `dotfilesRepo` accepts only canonical GitHub HTTPS repos: `https://github.com/<owner>/<repo>` or `https://github.com/<owner>/<repo>.git`.
- SSH repo forms, GitHub shorthand, and non-GitHub hosts require an explicit future host policy and are rejected in this slice.
- Dotfiles are executable code inside the same personal workspace trust boundary; they are not safe to run for collaborators sharing the same workspace unless that user explicitly trusts the workspace owner.
- `dotfilesRepo` max length is 512 characters.
- `ageKey.value` max length is 200000 characters and must contain valid line-oriented age identity material.
- `ageKey.persistEncrypted=true` is rejected unless host policy explicitly enables encrypted-at-rest key persistence.
- Lifecycle command default timeout is 180 seconds.
- Setup command default timeout is 1200 seconds.
- Static prototype mode must be explicit via `INCUS_WEB_PROVISIONER_MODE=prototype-static`; production must not silently treat a static adapter as a real host provisioner.
- Use Aurora tokens/components for UI changes; this plan should not add new visual design work.

---

## File Structure

- Create `apps/web/lib/provisioner/contracts.ts`
  - Owns provisioner TypeScript types and runtime validators.
  - Exports `validateProvisionerCommand`, `redactProvisionerCommand`, `isProvisionerCommandType`, and constants used by tests and clients.

- Create `apps/web/lib/provisioner/client.ts`
  - Defines `ProvisionerClient`, `ProvisionerTransport`, `createProvisionerClient`, and `createStaticPrototypeStatusClient`.
  - Keeps transport abstract so HTTP/Unix socket can be added without changing workspace inventory.

- Create `apps/web/lib/provisioner/status-adapter.ts`
  - Converts `GetWorkspaceStatus` operation results into existing `Workspace` fields.
  - Provides the prototype `GetWorkspaceStatus` implementation backed by environment-configured metadata, not Incus shell execution from Next.js routes.

- Modify `apps/web/lib/workspaces/provisioner.ts`
  - Replace `currentWorkspace()` hardcoded runtime constants with provisioner status mapping.
  - Keep configured-owner gating from PR 1.

- Modify `apps/web/lib/workspaces/provisioner.test.ts`
  - Add tests that inventory calls the provisioner client, handles failed status operations, preserves owner-only visibility, and maps status resources.

- Create `apps/web/lib/provisioner/contracts.test.ts`
  - Tests command validation, generated name validation, setup input validation, metadata mismatch helpers, and redaction.

- Create `apps/web/lib/provisioner/client.test.ts`
  - Tests operation envelopes and mock transport behavior.

- Modify `docs/contracts/provisioner-boundary-v1.md`
  - Add an implementation note pointing to the concrete TypeScript contract module once created.

---

### Task 1: Add Provisioner Contract Types And Validators

**Files:**
- Create: `apps/web/lib/provisioner/contracts.ts`
- Test: `apps/web/lib/provisioner/contracts.test.ts`

**Interfaces:**
- Produces:
  - `PROVISIONER_CONTRACT_VERSION: "provisioner.v1"`
  - `PROVISIONER_COMMAND_TYPES: readonly ProvisionerCommandType[]`
  - `type ProvisionerCommand<TPayload>`
  - `type ProvisionerOperation<TResult>`
  - `type WorkspaceRuntimeStatus`
  - `type ProvisionerError`
  - `function validateProvisionerCommand(command: unknown): ValidationResult<ProvisionerCommand<unknown>>`
  - `function validateWorkspaceRuntimeStatus(status: unknown, workspace: ProvisionerWorkspaceRef): ValidationResult<WorkspaceRuntimeStatus>`
  - `function validateProvisionerOperation<TResult>(operation: unknown, workspace: ProvisionerWorkspaceRef, type: ProvisionerCommandType): ValidationResult<ProvisionerOperation<TResult>>`
  - `function redactProvisionerCommand<T>(command: ProvisionerCommand<T>): ProvisionerCommand<unknown>`
  - `function redactProvisionerOperation<T>(operation: ProvisionerOperation<T>): ProvisionerOperation<unknown>`
  - `function redactSetupExcerpt(value: string): string`
  - `function validateGeneratedName(value: string, prefix: "user" | "ws"): boolean`
  - `function validateSetupPayload(payload: unknown, policy?: SetupValidationPolicy): ValidationResult<RunSetupPayload>`
- Consumes:
  - No prior task output.

- [ ] **Step 1: Write failing contract validator tests**

Create `apps/web/lib/provisioner/contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  PROVISIONER_CONTRACT_VERSION,
  redactProvisionerCommand,
  redactProvisionerOperation,
  redactSetupExcerpt,
  validateGeneratedName,
  validateProvisionerOperation,
  validateProvisionerCommand,
  validateSetupPayload,
  validateWorkspaceRuntimeStatus,
  type ProvisionerCommand,
  type ProvisionerOperation,
  type RunSetupPayload,
} from "@/lib/provisioner/contracts";

const baseCommand: ProvisionerCommand<Record<string, never>> = {
  version: PROVISIONER_CONTRACT_VERSION,
  requestId: "req-123",
  type: "GetWorkspaceStatus",
  actor: {
    userId: "user-1",
    oidcSubject: "oidc-subject",
    email: "owner@example.com",
    displayName: "Owner",
  },
  workspace: {
    id: "workspace-1",
    ownerUserId: "user-1",
    incusProject: "user-abc123",
    incusContainer: "ws-def456",
  },
  payload: {},
};

describe("provisioner contract validators", () => {
  it("accepts a valid provisioner command envelope", () => {
    const result = validateProvisionerCommand(baseCommand);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("GetWorkspaceStatus");
  });

  it("rejects unknown contract versions and command types", () => {
    expect(
      validateProvisionerCommand({ ...baseCommand, version: "mtcp.v1" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });

    expect(
      validateProvisionerCommand({ ...baseCommand, type: "RawIncusExec" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates generated Incus project and container names", () => {
    expect(validateGeneratedName("user-abc123", "user")).toBe(true);
    expect(validateGeneratedName("ws-def456", "ws")).toBe(true);
    expect(validateGeneratedName("user-", "user")).toBe(false);
    expect(validateGeneratedName("user-../../root", "user")).toBe(false);
    expect(validateGeneratedName("User-Abc", "user")).toBe(false);
  });

  it("rejects malformed workspace refs", () => {
    const result = validateProvisionerCommand({
      ...baseCommand,
      workspace: {
        ...baseCommand.workspace,
        incusContainer: "../escape",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates setup payload constraints", () => {
    const validPayload: RunSetupPayload = {
      dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
      ageKey: {
        value: "AGE-SECRET-KEY-1234567890",
        persistEncrypted: false,
      },
      skipAptScripts: true,
    };

    expect(validateSetupPayload(validPayload).ok).toBe(true);
    expect(validateSetupPayload({ dotfilesRepo: "https://github.com/jmagar/dotfiles.git", skipAptScripts: true }).ok).toBe(true);
    expect(validateSetupPayload({ dotfilesRepo: "git@github.com:jmagar/dotfiles.git", skipAptScripts: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(validateSetupPayload({ dotfilesRepo: "x".repeat(513), skipAptScripts: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(validateSetupPayload({ dotfilesRepo: "file:///tmp/dotfiles", skipAptScripts: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(validateSetupPayload({ ageKey: { value: "not-an-age-key", persistEncrypted: false }, skipAptScripts: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates setup payloads through the command envelope", () => {
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "RunSetup",
        payload: {
          ageKey: { value: "not-an-age-key", persistEncrypted: false },
          skipAptScripts: true,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("rejects age key persistence unless policy enables it", () => {
    const payload: RunSetupPayload = {
      ageKey: {
        value: "AGE-SECRET-KEY-1234567890",
        persistEncrypted: true,
      },
      skipAptScripts: true,
    };

    expect(validateSetupPayload(payload)).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(validateSetupPayload(payload, { allowAgeKeyPersistence: true }).ok).toBe(true);
  });

  it("validates returned status tuples against the requested workspace", () => {
    expect(
      validateWorkspaceRuntimeStatus(
        {
          workspaceId: "workspace-1",
          state: "running",
          incusProject: "user-abc123",
          incusContainer: "ws-def456",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
        baseCommand.workspace,
      ).ok,
    ).toBe(true);

    expect(
      validateWorkspaceRuntimeStatus(
        {
          workspaceId: "workspace-2",
          state: "running",
          incusProject: "user-other",
          incusContainer: "ws-other",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
        baseCommand.workspace,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "metadata_mismatch" },
    });
  });

  it("validates operation envelopes for requested type and workspace", () => {
    const operation: ProvisionerOperation = {
      id: "op-1",
      requestId: "req-123",
      type: "GetWorkspaceStatus",
      workspaceId: "workspace-1",
      status: "succeeded",
      result: {
        workspaceId: "workspace-1",
        state: "running",
        incusProject: "user-abc123",
        incusContainer: "ws-def456",
        lastCheckedAt: "2026-07-01T00:00:00.000Z",
      },
    };

    expect(validateProvisionerOperation(operation, baseCommand.workspace, "GetWorkspaceStatus").ok).toBe(true);
    expect(validateProvisionerOperation({ ...operation, workspaceId: "workspace-2" }, baseCommand.workspace, "GetWorkspaceStatus")).toMatchObject({
      ok: false,
      error: { code: "metadata_mismatch" },
    });
  });

  it("redacts age key material from commands", () => {
    const command: ProvisionerCommand<RunSetupPayload> = {
      ...baseCommand,
      type: "RunSetup",
      payload: {
        dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
        ageKey: {
          value: "AGE-SECRET-KEY-super-secret",
          persistEncrypted: false,
        },
        skipAptScripts: true,
      },
    };

    expect(JSON.stringify(redactProvisionerCommand(command))).not.toContain(
      "super-secret",
    );
    expect(redactProvisionerCommand(command).payload).toMatchObject({
      dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
      ageKey: {
        value: "[REDACTED]",
        persistEncrypted: false,
      },
      skipAptScripts: true,
    });
  });

  it("redacts secret material, bearer tokens, and host paths from operations", () => {
    const operation: ProvisionerOperation = {
      id: "op-1",
      requestId: "req-123",
      type: "RunSetup",
      workspaceId: "workspace-1",
      status: "failed",
      error: {
        code: "setup_failed",
        message:
          "failed with AGE-SECRET-KEY-super-secret and Bearer token in /home/agent/.config",
        retryable: false,
        details: {
          stderr: "incus error from /var/lib/incus with AGE-SECRET-KEY-super-secret",
        },
      },
    };

    const redacted = redactProvisionerOperation(operation);

    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("Bearer token");
    expect(JSON.stringify(redacted)).not.toContain("/var/lib/incus");
    expect(redactSetupExcerpt("raw /home/agent path AGE-SECRET-KEY-super-secret")).toBe(
      "raw [REDACTED_PATH] path [REDACTED_AGE_KEY]",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/contracts.test.ts
```

Expected: FAIL because `@/lib/provisioner/contracts` does not exist.

- [ ] **Step 3: Implement contract types and validators**

Create `apps/web/lib/provisioner/contracts.ts`:

```ts
export const PROVISIONER_CONTRACT_VERSION = "provisioner.v1" as const;

export const PROVISIONER_COMMAND_TYPES = [
  "CreateWorkspace",
  "StartWorkspace",
  "StopWorkspace",
  "RestartWorkspace",
  "GetWorkspaceStatus",
  "RunSetup",
] as const;

export type ProvisionerContractVersion = typeof PROVISIONER_CONTRACT_VERSION;
export type ProvisionerCommandType = (typeof PROVISIONER_COMMAND_TYPES)[number];

export type RequestId = string;
export type UserId = string;
export type WorkspaceId = string;
export type OperationId = string;
export type IncusProjectName = string;
export type IncusContainerName = string;
export type ResourceProfileId = "local-dev";

export type ProvisionerErrorCode =
  | "invalid_input"
  | "unauthenticated_service"
  | "metadata_mismatch"
  | "invalid_state"
  | "template_unavailable"
  | "incus_unavailable"
  | "zfs_unavailable"
  | "quota_failed"
  | "setup_failed"
  | "timeout"
  | "operation_failed";

export type ProvisionerError = {
  code: ProvisionerErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProvisionerError };

export type ProvisionerActor = {
  userId: UserId;
  oidcSubject: string;
  email: string;
  displayName?: string;
};

export type ProvisionerWorkspaceRef = {
  id: WorkspaceId;
  ownerUserId: UserId;
  incusProject: IncusProjectName;
  incusContainer: IncusContainerName;
};

export type ProvisionerCommand<TPayload> = {
  version: ProvisionerContractVersion;
  requestId: RequestId;
  type: ProvisionerCommandType;
  actor: ProvisionerActor;
  workspace: ProvisionerWorkspaceRef;
  payload: TPayload;
};

export type OperationStatus = "queued" | "running" | "succeeded" | "failed";

export type ProvisionerOperation<TResult = unknown> = {
  id: OperationId;
  requestId: RequestId;
  type: ProvisionerCommandType;
  workspaceId: WorkspaceId;
  status: OperationStatus;
  result?: TResult;
  error?: ProvisionerError;
  startedAt?: string;
  completedAt?: string;
};

export type ProvisionerWorkspaceState =
  | "creating"
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "restarting"
  | "setting_up"
  | "degraded"
  | "failed";

export type WorkspaceRuntimeStatus = {
  workspaceId: WorkspaceId;
  state: ProvisionerWorkspaceState;
  incusProject: IncusProjectName;
  incusContainer: IncusContainerName;
  cpuCount?: number;
  memoryUsedBytes?: number;
  memoryLimitBytes?: number;
  rootDiskUsedBytes?: number;
  rootDiskLimitBytes?: number;
  loadAverage?: [number, number, number];
  setupPhase?: ProvisionerSetupPhase;
  lastCheckedAt: string;
};

export type ProvisionerSetupPhase =
  | "not_configured"
  | "queued"
  | "installing_mise"
  | "applying_dotfiles"
  | "checking_tools"
  | "ready"
  | "failed";

export type CreateWorkspacePayload = {
  templateVersion: string;
  resourceProfileId: ResourceProfileId;
  autoStart: boolean;
};

export type StopWorkspacePayload = {
  force: boolean;
  timeoutSeconds: number;
};

export type RestartWorkspacePayload = {
  timeoutSeconds: number;
};

export type RunSetupPayload = {
  dotfilesRepo?: string;
  ageKey?: {
    value: string;
    persistEncrypted: boolean;
  };
  skipAptScripts: boolean;
};

export type SetupValidationPolicy = {
  allowAgeKeyPersistence?: boolean;
};

export function isProvisionerCommandType(
  value: unknown,
): value is ProvisionerCommandType {
  return (
    typeof value === "string" &&
    PROVISIONER_COMMAND_TYPES.includes(value as ProvisionerCommandType)
  );
}

export function validateGeneratedName(
  value: string,
  prefix: "user" | "ws",
): boolean {
  if (value.length > 63) {
    return false;
  }
  return new RegExp(`^${prefix}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`).test(
    value,
  );
}

export function validateProvisionerCommand(
  command: unknown,
): ValidationResult<ProvisionerCommand<unknown>> {
  if (!isRecord(command)) {
    return invalid("command must be an object");
  }
  if (command.version !== PROVISIONER_CONTRACT_VERSION) {
    return invalid("unsupported provisioner contract version");
  }
  if (!isProvisionerCommandType(command.type)) {
    return invalid("unsupported provisioner command type");
  }
  if (typeof command.requestId !== "string" || command.requestId.length === 0) {
    return invalid("requestId is required");
  }
  if (!isActor(command.actor)) {
    return invalid("actor is invalid");
  }
  if (!isWorkspaceRef(command.workspace)) {
    return invalid("workspace ref is invalid");
  }
  if (command.type === "RunSetup") {
    const payload = validateSetupPayload(command.payload);
    if (!payload.ok) {
      return payload;
    }
  }
  return { ok: true, value: command as ProvisionerCommand<unknown> };
}

export function validateSetupPayload(
  payload: unknown,
  policy: SetupValidationPolicy = {},
): ValidationResult<RunSetupPayload> {
  if (!isRecord(payload)) {
    return invalid("setup payload must be an object");
  }
  if (typeof payload.skipAptScripts !== "boolean") {
    return invalid("skipAptScripts must be a boolean");
  }
  if (
    payload.dotfilesRepo !== undefined &&
    (typeof payload.dotfilesRepo !== "string" ||
      payload.dotfilesRepo.length === 0 ||
      payload.dotfilesRepo.length > 512 ||
      !isAllowedGitRepo(payload.dotfilesRepo))
  ) {
    return invalid("dotfilesRepo is invalid");
  }
  if (payload.ageKey !== undefined) {
    if (!isRecord(payload.ageKey)) {
      return invalid("ageKey is invalid");
    }
    if (
      typeof payload.ageKey.value !== "string" ||
      payload.ageKey.value.length > 200000 ||
      !isAgeIdentity(payload.ageKey.value)
    ) {
      return invalid("age key did not look like an age identity file");
    }
    if (typeof payload.ageKey.persistEncrypted !== "boolean") {
      return invalid("ageKey.persistEncrypted must be a boolean");
    }
    if (payload.ageKey.persistEncrypted && !policy.allowAgeKeyPersistence) {
      return invalid("age key persistence is not enabled by host policy");
    }
  }
  return { ok: true, value: payload as RunSetupPayload };
}

export function validateWorkspaceRuntimeStatus(
  status: unknown,
  workspace: ProvisionerWorkspaceRef,
): ValidationResult<WorkspaceRuntimeStatus> {
  if (!isRecord(status)) {
    return invalid("workspace status must be an object");
  }
  if (
    status.workspaceId !== workspace.id ||
    status.incusProject !== workspace.incusProject ||
    status.incusContainer !== workspace.incusContainer
  ) {
    return metadataMismatch("workspace status tuple did not match request");
  }
  if (!isWorkspaceState(status.state)) {
    return invalid("workspace state is invalid");
  }
  if (
    typeof status.lastCheckedAt !== "string" ||
    Number.isNaN(Date.parse(status.lastCheckedAt))
  ) {
    return invalid("lastCheckedAt is invalid");
  }
  if (
    status.setupPhase !== undefined &&
    !isProvisionerSetupPhase(status.setupPhase)
  ) {
    return invalid("setupPhase is invalid");
  }
  return { ok: true, value: status as WorkspaceRuntimeStatus };
}

export function validateProvisionerOperation<TResult>(
  operation: unknown,
  workspace: ProvisionerWorkspaceRef,
  type: ProvisionerCommandType,
): ValidationResult<ProvisionerOperation<TResult>> {
  if (!isRecord(operation)) {
    return invalid("operation must be an object");
  }
  if (operation.type !== type || operation.workspaceId !== workspace.id) {
    return metadataMismatch("operation tuple did not match request");
  }
  if (!isOperationStatus(operation.status)) {
    return invalid("operation status is invalid");
  }
  if (operation.status === "succeeded" && operation.result !== undefined) {
    const status = validateWorkspaceRuntimeStatus(operation.result, workspace);
    if (!status.ok) {
      return status;
    }
  }
  return { ok: true, value: operation as ProvisionerOperation<TResult> };
}

export function redactProvisionerCommand<TPayload>(
  command: ProvisionerCommand<TPayload>,
): ProvisionerCommand<unknown> {
  if (command.type !== "RunSetup" || !isRecord(command.payload)) {
    return command as ProvisionerCommand<unknown>;
  }
  const payload = { ...command.payload };
  if (isRecord(payload.ageKey)) {
    payload.ageKey = {
      ...payload.ageKey,
      value: "[REDACTED]",
    };
  }
  return {
    ...command,
    payload,
  };
}

export function redactProvisionerOperation<TResult>(
  operation: ProvisionerOperation<TResult>,
): ProvisionerOperation<unknown> {
  const error = operation.error
    ? {
        ...operation.error,
        message: redactSetupExcerpt(operation.error.message),
        details: operation.error.details
          ? sanitizeDetails(operation.error.details)
          : undefined,
      }
    : undefined;
  return {
    ...operation,
    result: sanitizeValue(operation.result),
    error,
  };
}

function isActor(value: unknown): value is ProvisionerActor {
  return (
    isRecord(value) &&
    typeof value.userId === "string" &&
    value.userId.length > 0 &&
    typeof value.oidcSubject === "string" &&
    value.oidcSubject.length > 0 &&
    typeof value.email === "string" &&
    value.email.length > 0 &&
    (value.displayName === undefined || typeof value.displayName === "string")
  );
}

function isWorkspaceRef(value: unknown): value is ProvisionerWorkspaceRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.ownerUserId === "string" &&
    value.ownerUserId.length > 0 &&
    typeof value.incusProject === "string" &&
    validateGeneratedName(value.incusProject, "user") &&
    typeof value.incusContainer === "string" &&
    validateGeneratedName(value.incusContainer, "ws")
  );
}

function isAllowedGitRepo(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
    value,
  );
}

function isAgeIdentity(value: string): boolean {
  return value
    .split(/\r?\n/)
    .some((line) => /^AGE-SECRET-KEY-[A-Z0-9]+/.test(line.trim()));
}

function isWorkspaceState(value: unknown): value is ProvisionerWorkspaceState {
  return (
    typeof value === "string" &&
    [
      "creating",
      "stopped",
      "starting",
      "running",
      "stopping",
      "restarting",
      "setting_up",
      "degraded",
      "failed",
    ].includes(value)
  );
}

function isProvisionerSetupPhase(
  value: unknown,
): value is ProvisionerSetupPhase {
  return (
    typeof value === "string" &&
    [
      "not_configured",
      "queued",
      "installing_mise",
      "applying_dotfiles",
      "checking_tools",
      "ready",
      "failed",
    ].includes(value)
  );
}

function isOperationStatus(value: unknown): value is OperationStatus {
  return (
    typeof value === "string" &&
    ["queued", "running", "succeeded", "failed"].includes(value)
  );
}

export function redactSetupExcerpt(value: string): string {
  return value
    .replace(/AGE-SECRET-KEY-[A-Z0-9]+/gi, "[REDACTED_AGE_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_TOKEN]")
    .replace(/\/(?:home|srv|mnt|var\/lib\/incus|var\/snap\/lxd)[^\s]*/g, "[REDACTED_PATH]");
}

function sanitizeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeValue(value)]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSetupExcerpt(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (isRecord(value)) {
    return sanitizeDetails(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataMismatch(message: string): ValidationResult<never> {
  return {
    ok: false,
    error: {
      code: "metadata_mismatch",
      message,
      retryable: false,
    },
  };
}

function invalid(message: string): ValidationResult<never> {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message,
      retryable: false,
    },
  };
}
```

- [ ] **Step 4: Run contract validator tests**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/web/lib/provisioner/contracts.ts apps/web/lib/provisioner/contracts.test.ts
git commit -m "feat(web): add provisioner contract validators"
```

---

### Task 2: Add Provisioner Client Interface And Mock Transport

**Files:**
- Create: `apps/web/lib/provisioner/client.ts`
- Test: `apps/web/lib/provisioner/client.test.ts`

**Interfaces:**
- Consumes:
  - `ProvisionerCommand<TPayload>`, `ProvisionerOperation<TResult>`, `WorkspaceRuntimeStatus`, `validateProvisionerCommand` from Task 1.
- Produces:
  - `type ProvisionerTransport`
  - `type ProvisionerClient`
  - `function createProvisionerClient(transport: ProvisionerTransport): ProvisionerClient`
  - `function createStaticPrototypeStatusClient(status: WorkspaceRuntimeStatus): ProvisionerClient`

- [ ] **Step 1: Write failing client tests**

Create `apps/web/lib/provisioner/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  PROVISIONER_CONTRACT_VERSION,
  type ProvisionerCommand,
  type WorkspaceRuntimeStatus,
} from "@/lib/provisioner/contracts";
import {
  createStaticPrototypeStatusClient,
  createProvisionerClient,
  type ProvisionerTransport,
} from "@/lib/provisioner/client";

const status: WorkspaceRuntimeStatus = {
  workspaceId: "workspace-1",
  state: "running",
  incusProject: "user-owner",
  incusContainer: "ws-workspace",
  cpuCount: 2,
  memoryUsedBytes: 128 * 1024 * 1024,
  memoryLimitBytes: 4 * 1024 * 1024 * 1024,
  rootDiskLimitBytes: 20 * 1024 * 1024 * 1024,
  lastCheckedAt: "2026-07-01T00:00:00.000Z",
};

const command: ProvisionerCommand<Record<string, never>> = {
  version: PROVISIONER_CONTRACT_VERSION,
  requestId: "req-1",
  type: "GetWorkspaceStatus",
  actor: {
    userId: "user-1",
    oidcSubject: "subject-1",
    email: "owner@example.com",
  },
  workspace: {
    id: "workspace-1",
    ownerUserId: "user-1",
    incusProject: "user-owner",
    incusContainer: "ws-workspace",
  },
  payload: {},
};

describe("provisioner client", () => {
  it("sends validated command envelopes through the transport", async () => {
    const send = vi.fn<ProvisionerTransport["send"]>().mockResolvedValue({
      id: "op-1",
      requestId: "req-1",
      type: "GetWorkspaceStatus",
      workspaceId: "workspace-1",
      status: "succeeded",
      result: status,
    });
    const client = createProvisionerClient({ send });

    const operation = await client.send(command);

    expect(send).toHaveBeenCalledWith(command);
    expect(operation.status).toBe("succeeded");
    expect(operation.result).toMatchObject({ state: "running" });
  });

  it("rejects invalid command envelopes before transport", async () => {
    const send = vi.fn<ProvisionerTransport["send"]>();
    const client = createProvisionerClient({ send });

    const operation = await client.send({
      ...command,
      type: "RawIncusExec",
    });

    expect(send).not.toHaveBeenCalled();
    expect(operation).toMatchObject({
      type: "GetWorkspaceStatus",
      workspaceId: "unknown",
      status: "failed",
      error: { code: "invalid_input" },
    });
  });

  it("creates a static prototype status client for local inventory tests", async () => {
    const client = createStaticPrototypeStatusClient(status);
    const operation = await client.send(command);

    expect(operation).toMatchObject({
      id: "mock-op-req-1",
      status: "succeeded",
      result: { workspaceId: "workspace-1", state: "running" },
    });
  });

  it("rejects non-status commands in the static prototype status client", async () => {
    const client = createStaticPrototypeStatusClient(status);
    const operation = await client.send({
      ...command,
      type: "StartWorkspace",
    });

    expect(operation).toMatchObject({
      status: "failed",
      error: { code: "invalid_input" },
    });
  });
});
```

- [ ] **Step 2: Run client tests to verify they fail**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/client.test.ts
```

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 3: Implement client interface**

Create `apps/web/lib/provisioner/client.ts`:

```ts
import {
  type ProvisionerCommand,
  type ProvisionerOperation,
  type WorkspaceRuntimeStatus,
  validateProvisionerCommand,
} from "@/lib/provisioner/contracts";

export type ProvisionerTransport = {
  send<TPayload, TResult>(
    command: ProvisionerCommand<TPayload>,
  ): Promise<ProvisionerOperation<TResult>>;
};

export type ProvisionerClient = {
  send<TResult = unknown>(
    command: unknown,
  ): Promise<ProvisionerOperation<TResult>>;
};

export function createProvisionerClient(
  transport: ProvisionerTransport,
): ProvisionerClient {
  return {
    async send<TResult>(
      command: unknown,
    ): Promise<ProvisionerOperation<TResult>> {
      const validation = validateProvisionerCommand(command);
      if (!validation.ok) {
        return failedOperation(validation.error.message);
      }
      return transport.send<unknown, TResult>(validation.value);
    },
  };
}

export function createStaticPrototypeStatusClient(
  status: WorkspaceRuntimeStatus,
): ProvisionerClient {
  return createProvisionerClient({
    async send<TPayload, TResult>(
      command: ProvisionerCommand<TPayload>,
    ): Promise<ProvisionerOperation<TResult>> {
      if (command.type !== "GetWorkspaceStatus") {
        return {
          id: `static-prototype-op-${command.requestId}`,
          requestId: command.requestId,
          type: command.type,
          workspaceId: command.workspace.id,
          status: "failed",
          error: {
            code: "invalid_input",
            message: "static prototype status client only supports GetWorkspaceStatus",
            retryable: false,
          },
        };
      }
      return {
        id: `static-prototype-op-${command.requestId}`,
        requestId: command.requestId,
        type: command.type,
        workspaceId: command.workspace.id,
        status: "succeeded",
        result: status as TResult,
        startedAt: status.lastCheckedAt,
        completedAt: status.lastCheckedAt,
      };
    },
  });
}

function failedOperation<TResult>(
  message: string,
): ProvisionerOperation<TResult> {
  return {
    id: `failed-${crypto.randomUUID()}`,
    requestId: "unknown",
    type: "GetWorkspaceStatus",
    workspaceId: "unknown",
    status: "failed",
    error: {
      code: "invalid_input",
      message,
      retryable: false,
    },
    completedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run client tests**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web/lib/provisioner/client.ts apps/web/lib/provisioner/client.test.ts
git commit -m "feat(web): add provisioner client interface"
```

---

### Task 3: Add Prototype Status Adapter

**Files:**
- Create: `apps/web/lib/provisioner/status-adapter.ts`
- Test: `apps/web/lib/provisioner/status-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `WorkspaceRuntimeStatus`, `ProvisionerClient` from Tasks 1-2.
  - `Workspace`, `WorkspaceSetupSummary`, `WorkspaceResources` from `apps/web/lib/workspaces/types.ts`.
- Produces:
  - `function buildPrototypeWorkspaceRef(ownerUserId: string): ProvisionerWorkspaceRef`
  - `function prototypeRuntimeStatus(workspaceId: string): WorkspaceRuntimeStatus`
  - `function statusToWorkspace(status: WorkspaceRuntimeStatus, ownerUserId: string): Workspace`

- [ ] **Step 1: Write failing status adapter tests**

Create `apps/web/lib/provisioner/status-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildPrototypeWorkspaceRef,
  prototypeRuntimeStatus,
  statusToWorkspace,
} from "@/lib/provisioner/status-adapter";

describe("provisioner status adapter", () => {
  it("builds generated prototype workspace refs", () => {
    expect(buildPrototypeWorkspaceRef("oidc:owner@example.com")).toMatchObject({
      id: "workspace-incus-web",
      ownerUserId: "oidc:owner@example.com",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
    });
  });

  it("creates prototype runtime status from environment defaults", () => {
    const status = prototypeRuntimeStatus("workspace-incus-web");

    expect(status).toMatchObject({
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      cpuCount: 2,
      memoryLimitBytes: 4 * 1024 * 1024 * 1024,
    });
  });

  it("maps runtime status to existing dashboard workspace shape", () => {
    const workspace = statusToWorkspace(
      {
        workspaceId: "workspace-incus-web",
        state: "running",
        incusProject: "user-incus-web",
        incusContainer: "ws-incus-web",
        cpuCount: 2,
        memoryUsedBytes: 128 * 1024 * 1024,
        memoryLimitBytes: 4 * 1024 * 1024 * 1024,
        rootDiskLimitBytes: 20 * 1024 * 1024 * 1024,
        setupPhase: "ready",
        lastCheckedAt: "2026-07-01T00:00:00.000Z",
      },
      "oidc:owner@example.com",
    );

    expect(workspace).toMatchObject({
      id: "workspace-incus-web",
      ownerUserId: "oidc:owner@example.com",
      name: "incus-web",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      state: "running",
      resources: {
        cpu: "2 vCPU",
        memory: "4 GiB",
        storage: "20 GiB",
      },
      setup: {
        phase: "ready",
      },
    });
  });
});
```

- [ ] **Step 2: Run status adapter tests to verify they fail**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/status-adapter.test.ts
```

Expected: FAIL because `status-adapter.ts` does not exist.

- [ ] **Step 3: Implement status adapter**

Create `apps/web/lib/provisioner/status-adapter.ts`:

```ts
import type {
  ProvisionerWorkspaceRef,
  ProvisionerWorkspaceState,
  WorkspaceRuntimeStatus,
} from "@/lib/provisioner/contracts";
import type {
  SetupPhase,
  Workspace,
  WorkspaceSetupSummary,
  WorkspaceState,
} from "@/lib/workspaces/types";

const now = "2026-01-01T00:00:00.000Z";
const gib = 1024 * 1024 * 1024;

export function buildPrototypeWorkspaceRef(
  ownerUserId: string,
): ProvisionerWorkspaceRef {
  return {
    id: "workspace-incus-web",
    ownerUserId,
    incusProject: "user-incus-web",
    incusContainer: "ws-incus-web",
  };
}

export function prototypeRuntimeStatus(
  workspaceId: string,
): WorkspaceRuntimeStatus {
  return {
    workspaceId,
    state: "running",
    incusProject: "user-incus-web",
    incusContainer: "ws-incus-web",
    cpuCount: numberEnv("INCUS_WEB_PROTOTYPE_CPU", 2),
    memoryLimitBytes: numberEnv("INCUS_WEB_PROTOTYPE_MEMORY_BYTES", 4 * gib),
    rootDiskLimitBytes: numberEnv("INCUS_WEB_PROTOTYPE_DISK_BYTES", 20 * gib),
    setupPhase: "ready",
    lastCheckedAt: new Date().toISOString(),
  };
}

export function statusToWorkspace(
  status: WorkspaceRuntimeStatus,
  ownerUserId: string,
): Workspace {
  return {
    id: status.workspaceId,
    ownerUserId,
    name: "incus-web",
    slug: "incus-web",
    incusProject: status.incusProject,
    incusContainer: status.incusContainer,
    templateVersion: "prototype",
    state: workspaceState(status.state),
    resourceProfileId: "local-dev",
    resources: {
      cpu: status.cpuCount ? `${status.cpuCount} vCPU` : "unknown",
      memory: status.memoryLimitBytes
        ? `${Math.round(status.memoryLimitBytes / gib)} GiB`
        : "unknown",
      storage: status.rootDiskLimitBytes
        ? `${Math.round(status.rootDiskLimitBytes / gib)} GiB`
        : "host quota pending",
    },
    setup: setupSummary(status),
    accessNote:
      "Single-container prototype. Terminal routing moves behind workspace-scoped sessions before multi-user sharing.",
    createdAt: now,
    updatedAt: status.lastCheckedAt,
  };
}

function setupSummary(status: WorkspaceRuntimeStatus): WorkspaceSetupSummary {
  return {
    phase: setupPhase(status.setupPhase),
    dotfilesStatus: "unknown",
    miseStatus: "unknown",
    commandStatus: "unknown",
    packageStatus: "unknown",
    updatedAt: status.lastCheckedAt,
  };
}

function workspaceState(state: ProvisionerWorkspaceState): WorkspaceState {
  return state;
}

function setupPhase(value: string | undefined): SetupPhase {
  switch (value) {
    case "ready":
    case "failed":
    case "not_configured":
      return value;
    case "setting_up":
      return "checking_tools";
    default:
      return "not_configured";
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
```

- [ ] **Step 4: Run status adapter tests**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/status-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/lib/provisioner/status-adapter.ts apps/web/lib/provisioner/status-adapter.test.ts
git commit -m "feat(web): map provisioner status to workspaces"
```

---

### Task 4: Wire Workspace Inventory Through Provisioner Client

**Files:**
- Modify: `apps/web/lib/workspaces/provisioner.ts`
- Modify: `apps/web/lib/workspaces/provisioner.test.ts`

**Interfaces:**
- Consumes:
  - `createStaticPrototypeStatusClient`, `ProvisionerClient` from Task 2.
  - `validateProvisionerOperation` from Task 1.
  - `buildPrototypeWorkspaceRef`, `prototypeRuntimeStatus`, `statusToWorkspace` from Task 3.
- Produces:
  - `function getWorkspaceInventory(actor: ActorContext, client?: ProvisionerClient): Promise<WorkspaceInventory>`

- [ ] **Step 1: Add failing inventory tests**

Modify `apps/web/lib/workspaces/provisioner.test.ts` by adding these imports:

```ts
import { createStaticPrototypeStatusClient } from "@/lib/provisioner/client";
import type { WorkspaceRuntimeStatus } from "@/lib/provisioner/contracts";
```

Update the existing `"returns the current incus-web workspace read-only inventory"` expectation so it expects generated prototype names:

```ts
    expect(inventory.workspaces[0]).toMatchObject({
      name: "incus-web",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      state: "running",
      ownerUserId: "oidc:owner@example.com",
    });
```

Add these tests inside the existing `describe` block:

```ts
  it("uses provisioner status when rendering the owner workspace", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL = "owner@example.com";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "owner-subject",
      }),
    );
    const status: WorkspaceRuntimeStatus = {
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      cpuCount: 4,
      memoryLimitBytes: 8 * 1024 * 1024 * 1024,
      rootDiskLimitBytes: 40 * 1024 * 1024 * 1024,
      setupPhase: "ready",
      lastCheckedAt: "2026-07-01T00:00:00.000Z",
    };

    const inventory = await getWorkspaceInventory(
      actor,
      createStaticPrototypeStatusClient(status),
    );

    expect(inventory.workspaces[0]).toMatchObject({
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      resources: {
        cpu: "4 vCPU",
        memory: "8 GiB",
        storage: "40 GiB",
      },
    });
  });

  it("does not call provisioner for non-owners", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL = "owner@example.com";
    const actor = getActorFromHeaders(
      new Headers({ "x-auth-request-email": "other@example.com" }),
    );
    const client = {
      send: vi.fn(),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(client.send).not.toHaveBeenCalled();
    expect(inventory.workspaces).toHaveLength(0);
  });

  it("returns no workspace when provisioner status fails", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT = "owner-subject";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "owner-subject",
      }),
    );
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "failed",
        error: {
          code: "incus_unavailable",
          message: "raw /var/lib/incus path should not be rendered",
          retryable: true,
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
  });

  it("returns no workspace when provisioner status tuple is mismatched", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT = "owner-subject";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "owner-subject",
      }),
    );
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "succeeded",
        result: {
          workspaceId: "workspace-other",
          state: "running",
          incusProject: "user-other",
          incusContainer: "ws-other",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
  });

  it("returns no workspace when provisioner status result is malformed", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT = "owner-subject";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "owner-subject",
      }),
    );
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "succeeded",
        result: {
          workspaceId: "workspace-incus-web",
          state: "running",
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
  });

  it("requires subject-configured ownership in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL = "owner@example.com";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "owner-subject",
      }),
    );

    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(0);
    vi.stubEnv("NODE_ENV", originalNodeEnv);
  });
```

- [ ] **Step 2: Run inventory tests to verify they fail**

Run:

```bash
npm --prefix apps/web run test -- lib/workspaces/provisioner.test.ts
```

Expected: FAIL because `getWorkspaceInventory` does not accept an injected client and still uses hardcoded constants.

- [ ] **Step 3: Implement provisioner-backed inventory**

Modify `apps/web/lib/workspaces/provisioner.ts` to:

```ts
import type { ActorContext, WorkspaceInventory } from "@/lib/workspaces/types";
import {
  PROVISIONER_CONTRACT_VERSION,
  type WorkspaceRuntimeStatus,
  validateProvisionerOperation,
} from "@/lib/provisioner/contracts";
import {
  createStaticPrototypeStatusClient,
  type ProvisionerClient,
} from "@/lib/provisioner/client";
import {
  buildPrototypeWorkspaceRef,
  prototypeRuntimeStatus,
  statusToWorkspace,
} from "@/lib/provisioner/status-adapter";
```

Keep the existing `ConfiguredOwner` and `actorMatchesOwner()` shape, but update `configuredOwner()` so production requires `INCUS_WEB_WORKSPACE_OWNER_SUBJECT`. Email owner fallback remains available only for local prototype/development mode:

```ts
function configuredOwner(): ConfiguredOwner | undefined {
  const subject = process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT?.trim();
  if (subject) return { userId: `oidc:${subject}` };

  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  const email = process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL?.trim();
  if (email) return { userId: `oidc:${email}`, email: email.toLowerCase() };

  if (process.env.INCUS_WEB_ALLOW_DEV_AUTH === "1") {
    return {
      userId: "oidc:dev@incus-web.local",
      email: "dev@incus-web.local",
    };
  }

  return undefined;
}
```

Replace `currentWorkspace()` with:

```ts
function defaultProvisionerClient(ownerUserId: string): ProvisionerClient {
  const workspace = buildPrototypeWorkspaceRef(ownerUserId);
  if (
    process.env.INCUS_WEB_PROVISIONER_MODE === "prototype-static" ||
    process.env.NODE_ENV !== "production"
  ) {
    return createStaticPrototypeStatusClient(prototypeRuntimeStatus(workspace.id));
  }

  return {
    async send() {
      return {
        id: "missing-provisioner",
        requestId: "unknown",
        type: "GetWorkspaceStatus",
        workspaceId: workspace.id,
        status: "failed",
        error: {
          code: "unauthenticated_service",
          message: "host provisioner transport is not configured",
          retryable: false,
        },
      };
    },
  };
}
```

Update `getWorkspaceInventory` to:

```ts
export async function getWorkspaceInventory(
  actor: ActorContext,
  client?: ProvisionerClient,
): Promise<WorkspaceInventory> {
  const owner = configuredOwner();
  if (!owner || !actorMatchesOwner(actor, owner)) {
    return { actor, workspaces: [] };
  }

  const workspace = buildPrototypeWorkspaceRef(owner.userId);
  const provisioner = client ?? defaultProvisionerClient(owner.userId);
  const operation = await provisioner.send<WorkspaceRuntimeStatus>({
    version: PROVISIONER_CONTRACT_VERSION,
    requestId: actor.requestId,
    type: "GetWorkspaceStatus",
    actor: {
      userId: actor.userId,
      oidcSubject: actor.oidcSubject,
      email: actor.email,
      displayName: actor.displayName,
    },
    workspace,
    payload: {},
  });

  if (operation.status !== "succeeded" || !operation.result) {
    return { actor, workspaces: [] };
  }
  const validated = validateProvisionerOperation<WorkspaceRuntimeStatus>(
    operation,
    workspace,
    "GetWorkspaceStatus",
  );
  if (!validated.ok || !validated.value.result) {
    return { actor, workspaces: [] };
  }

  return {
    actor,
    workspaces: [statusToWorkspace(validated.value.result, owner.userId)],
  };
}
```

- [ ] **Step 4: Run inventory tests**

Run:

```bash
npm --prefix apps/web run test -- lib/workspaces/provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/web/lib/workspaces/provisioner.ts apps/web/lib/workspaces/provisioner.test.ts
git commit -m "feat(web): route workspace inventory through provisioner"
```

---

### Task 5: Document Implementation Entry Point And Run Full Gates

**Files:**
- Modify: `docs/contracts/provisioner-boundary-v1.md`
- Modify: `docs/superpowers/specs/2026-07-01-provisioner-boundary-v1-design.md`

**Interfaces:**
- Consumes:
  - Concrete module paths from Tasks 1-4.
- Produces:
  - Docs that point implementers to `apps/web/lib/provisioner/contracts.ts`, `client.ts`, and `status-adapter.ts`.

- [ ] **Step 1: Update contract implementation note**

In `docs/contracts/provisioner-boundary-v1.md`, add this after `## Acceptance Criteria`:

```md
## Implementation Entry Points

The first TypeScript implementation lives in:

- `apps/web/lib/provisioner/contracts.ts` for contract types and validators
- `apps/web/lib/provisioner/client.ts` for the provisioner client interface
- `apps/web/lib/provisioner/status-adapter.ts` for mapping v1 status into workspace dashboard data

Future host transports must preserve these interfaces so the Next.js workspace inventory does not learn raw Incus details.
```

- [ ] **Step 2: Update design implementation note**

In `docs/superpowers/specs/2026-07-01-provisioner-boundary-v1-design.md`, add this after `## Implementation Slice`:

```md
Implementation starts with the Next.js-side provisioner client facade and explicit static prototype status adapter. This intentionally proves the contract and call boundary before adding the host-local provisioner transport. The next slice can replace the static adapter with a Unix-socket or localhost provisioner service without changing workspace inventory callers.
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm --prefix apps/web run test -- lib/provisioner/contracts.test.ts lib/provisioner/client.test.ts lib/provisioner/status-adapter.test.ts lib/workspaces/provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full web gates**

Run:

```bash
npm --prefix apps/web run test
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

Expected:

- Tests PASS.
- Lint exits 0. Existing Aurora vendored warnings may remain.
- Build PASS.

- [ ] **Step 5: Run repo static gates**

Run:

```bash
bash tests/deploy_static_tests.sh
bash -n deploy.sh scripts/incus-web-lib.sh scripts/build-image.sh scripts/smoke-image.sh tests/deploy_static_tests.sh
shellcheck deploy.sh scripts/incus-web-lib.sh scripts/build-image.sh scripts/smoke-image.sh tests/deploy_static_tests.sh
node <<'NODE'
const fs = require("fs");
const path = require("path");
const forbidden = [
  "child_process",
  "spawn(",
  "execFile(",
  "incus ",
  "zfs ",
  "scripts/",
  "/var/snap/lxd",
  "/var/lib/incus",
  "/run/incus",
];
const allowed = new Set([
  "apps/web/lib/provisioner/contracts.test.ts",
  "apps/web/lib/workspaces/provisioner.test.ts",
]);
const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".next"].includes(entry.name)) walk(file);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const rel = path.relative(process.cwd(), file);
    if (allowed.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (text.includes(needle)) hits.push(`${rel}: ${needle}`);
    }
    if (/(^|[^.A-Za-z0-9_$])exec\s*\(/.test(text)) {
      hits.push(`${rel}: shell-like exec(`);
    }
  }
}
walk("apps/web");
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
NODE
node <<'NODE'
const fs = require("fs");
const text = [
  fs.existsSync("deploy.sh") ? fs.readFileSync("deploy.sh", "utf8") : "",
  fs.existsSync("scripts/incus-web-lib.sh") ? fs.readFileSync("scripts/incus-web-lib.sh", "utf8") : "",
  fs.existsSync("incus-web-profile.yaml") ? fs.readFileSync("incus-web-profile.yaml", "utf8") : "",
  fs.existsSync("distrobuilder.yaml") ? fs.readFileSync("distrobuilder.yaml", "utf8") : "",
].join("\n");
for (const expected of [
  'security.nesting: "true"',
  'security.privileged: "false"',
  'shift: "true"',
]) {
  if (!text.includes(expected)) {
    console.error(`missing runtime profile invariant: ${expected}`);
    process.exit(1);
  }
}
NODE
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add docs/contracts/provisioner-boundary-v1.md docs/superpowers/specs/2026-07-01-provisioner-boundary-v1-design.md
git commit -m "docs: link provisioner implementation entry points"
```

---

## Plan Self-Review

Spec coverage:

- Next.js-side provisioner facade: Tasks 2 and 4 introduce the client boundary; Task 5 documents that the real host transport remains a follow-up.
- Command envelope, payload validation, tuple validation, and redaction: Task 1.
- Operation shape and validation: Tasks 1 and 2.
- Status inventory integration: Tasks 3 and 4.
- Setup validation, dotfiles repo policy, age key persistence policy, and redaction: Task 1.
- Tests: every implementation task starts with failing tests and ends with focused tests; Task 5 adds full web gates, forbidden-call scan, and runtime profile invariant checks.

Scope decision:

- This plan intentionally does not build the host-local provisioner service, host-local transport, terminal routing, durable database, org sharing, snapshots, or a queue worker. Those are separate follow-up slices after the TypeScript contract and inventory call boundary are proven.
- Static prototype mode is an explicit compatibility adapter, not a host security boundary.

Placeholder scan:

- No placeholders are allowed in implementation steps.
- Every code-changing step includes concrete code blocks and commands.

Type consistency:

- `WorkspaceRuntimeStatus`, `ProvisionerCommand`, `ProvisionerOperation`, `ProvisionerClient`, and `ProvisionerTransport` are defined before any consuming task.
