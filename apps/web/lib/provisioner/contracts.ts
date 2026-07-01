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

export type ProvisionerSetupPhase =
  | "not_configured"
  | "queued"
  | "installing_mise"
  | "applying_dotfiles"
  | "checking_tools"
  | "ready"
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
  const payload: Record<string, unknown> = { ...command.payload };
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

export function redactSetupExcerpt(value: string): string {
  return value
    .replace(/AGE-SECRET-KEY-[A-Z0-9-]+/gi, "[REDACTED_AGE_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_TOKEN]")
    .replace(
      /\/(?:home|srv|mnt|var\/lib\/incus|var\/snap\/lxd)[^\s]*/g,
      "[REDACTED_PATH]",
    );
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
    .some((line) => /^AGE-SECRET-KEY-[A-Z0-9-]+$/i.test(line.trim()));
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
