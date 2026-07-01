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

export type StartWorkspacePayload = Record<string, never>;
export type GetWorkspaceStatusPayload = Record<string, never>;

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

export type CreateWorkspaceResult = {
  workspaceId: WorkspaceId;
  incusProject: IncusProjectName;
  incusContainer: IncusContainerName;
  state: "stopped" | "running";
  templateVersion: string;
  resourceProfileId: ResourceProfileId;
};

export type LifecycleWorkspaceResult = {
  workspaceId: WorkspaceId;
  state: "running" | "stopped";
  status?: WorkspaceRuntimeStatus;
};

export type RunSetupResult = {
  workspaceId: WorkspaceId;
  setup: Record<string, unknown>;
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
  const payload = validateCommandPayload(command.type, command.payload);
  if (!payload.ok) {
    return payload;
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
  if (!hasOnlyKeys(payload, ["dotfilesRepo", "ageKey", "skipAptScripts"])) {
    return invalid("setup payload contains unsupported fields");
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
    const result = validateOperationResult(type, operation.result, workspace);
    if (!result.ok) {
      return result;
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
  const truncated =
    value.length > MAX_REDACTED_STRING_LENGTH
      ? `${value.slice(0, MAX_REDACTED_STRING_LENGTH)}[TRUNCATED]`
      : value;
  return truncated
    .replace(/AGE-SECRET-KEY-[A-Z0-9-]+/gi, "[REDACTED_AGE_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_TOKEN]")
    .replace(
      /\/(?:home|srv|mnt|var\/lib\/incus|var\/snap\/lxd)[^\s]*/g,
      "[REDACTED_PATH]",
    );
}

const MAX_REDACTED_STRING_LENGTH = 4096;
const MAX_REDACTION_DEPTH = 4;
const MAX_REDACTION_ENTRIES = 32;

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

function validateCommandPayload(
  type: ProvisionerCommandType,
  payload: unknown,
): ValidationResult<unknown> {
  switch (type) {
    case "CreateWorkspace":
      return validateCreateWorkspacePayload(payload);
    case "StartWorkspace":
    case "GetWorkspaceStatus":
      return validateEmptyPayload(payload);
    case "StopWorkspace":
      return validateStopWorkspacePayload(payload);
    case "RestartWorkspace":
      return validateRestartWorkspacePayload(payload);
    case "RunSetup":
      return validateSetupPayload(payload);
  }
}

function validateCreateWorkspacePayload(
  payload: unknown,
): ValidationResult<CreateWorkspacePayload> {
  if (!isRecord(payload)) {
    return invalid("CreateWorkspace payload must be an object");
  }
  if (!hasOnlyKeys(payload, ["templateVersion", "resourceProfileId", "autoStart"])) {
    return invalid("CreateWorkspace payload contains unsupported fields");
  }
  if (
    typeof payload.templateVersion !== "string" ||
    payload.templateVersion.length === 0 ||
    typeof payload.autoStart !== "boolean" ||
    payload.resourceProfileId !== "local-dev"
  ) {
    return invalid("CreateWorkspace payload is invalid");
  }
  return { ok: true, value: payload as CreateWorkspacePayload };
}

function validateStopWorkspacePayload(
  payload: unknown,
): ValidationResult<StopWorkspacePayload> {
  if (!isRecord(payload)) {
    return invalid("StopWorkspace payload must be an object");
  }
  if (!hasOnlyKeys(payload, ["force", "timeoutSeconds"])) {
    return invalid("StopWorkspace payload contains unsupported fields");
  }
  if (
    typeof payload.force !== "boolean" ||
    !isPositiveTimeout(payload.timeoutSeconds)
  ) {
    return invalid("StopWorkspace payload is invalid");
  }
  return { ok: true, value: payload as StopWorkspacePayload };
}

function validateRestartWorkspacePayload(
  payload: unknown,
): ValidationResult<RestartWorkspacePayload> {
  if (!isRecord(payload)) {
    return invalid("RestartWorkspace payload must be an object");
  }
  if (!hasOnlyKeys(payload, ["timeoutSeconds"])) {
    return invalid("RestartWorkspace payload contains unsupported fields");
  }
  if (!isPositiveTimeout(payload.timeoutSeconds)) {
    return invalid("RestartWorkspace payload is invalid");
  }
  return { ok: true, value: payload as RestartWorkspacePayload };
}

function validateEmptyPayload(
  payload: unknown,
): ValidationResult<StartWorkspacePayload | GetWorkspaceStatusPayload> {
  if (!isRecord(payload)) {
    return invalid("payload must be an object");
  }
  if (!hasOnlyKeys(payload, [])) {
    return invalid("payload contains unsupported fields");
  }
  return { ok: true, value: {} };
}

function validateOperationResult(
  type: ProvisionerCommandType,
  result: unknown,
  workspace: ProvisionerWorkspaceRef,
): ValidationResult<unknown> {
  switch (type) {
    case "GetWorkspaceStatus":
      return validateWorkspaceRuntimeStatus(result, workspace);
    case "CreateWorkspace":
      return validateCreateWorkspaceResult(result, workspace);
    case "StartWorkspace":
    case "RestartWorkspace":
      return validateLifecycleWorkspaceResult(result, workspace, "running");
    case "StopWorkspace":
      return validateLifecycleWorkspaceResult(result, workspace, "stopped");
    case "RunSetup":
      return validateRunSetupResult(result, workspace);
  }
}

function validateCreateWorkspaceResult(
  result: unknown,
  workspace: ProvisionerWorkspaceRef,
): ValidationResult<CreateWorkspaceResult> {
  if (!isRecord(result)) {
    return invalid("CreateWorkspace result must be an object");
  }
  if (
    result.workspaceId !== workspace.id ||
    result.incusProject !== workspace.incusProject ||
    result.incusContainer !== workspace.incusContainer
  ) {
    return metadataMismatch("CreateWorkspace result tuple did not match request");
  }
  if (
    (result.state !== "stopped" && result.state !== "running") ||
    typeof result.templateVersion !== "string" ||
    result.templateVersion.length === 0 ||
    result.resourceProfileId !== "local-dev"
  ) {
    return invalid("CreateWorkspace result is invalid");
  }
  return { ok: true, value: result as CreateWorkspaceResult };
}

function validateLifecycleWorkspaceResult(
  result: unknown,
  workspace: ProvisionerWorkspaceRef,
  state: "running" | "stopped",
): ValidationResult<LifecycleWorkspaceResult> {
  if (!isRecord(result)) {
    return invalid("lifecycle result must be an object");
  }
  if (result.workspaceId !== workspace.id) {
    return metadataMismatch("lifecycle result workspace did not match request");
  }
  if (result.state !== state) {
    return invalid("lifecycle result state is invalid");
  }
  if (result.status !== undefined) {
    const status = validateWorkspaceRuntimeStatus(result.status, workspace);
    if (!status.ok) {
      return status;
    }
  }
  return { ok: true, value: result as LifecycleWorkspaceResult };
}

function validateRunSetupResult(
  result: unknown,
  workspace: ProvisionerWorkspaceRef,
): ValidationResult<RunSetupResult> {
  if (!isRecord(result)) {
    return invalid("RunSetup result must be an object");
  }
  if (result.workspaceId !== workspace.id) {
    return metadataMismatch("RunSetup result workspace did not match request");
  }
  if (!isRecord(result.setup)) {
    return invalid("RunSetup setup summary is invalid");
  }
  return { ok: true, value: result as RunSetupResult };
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
  return sanitizeRecord(details, 0);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactSetupExcerpt(value);
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return "[REDACTED_DEPTH_LIMIT]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_REDACTION_ENTRIES)
      .map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (isRecord(value)) {
    return sanitizeRecord(value, depth + 1);
  }
  return value;
}

function sanitizeRecord(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_REDACTION_ENTRIES)
      .map(([key, entry]) => [key, sanitizeValue(entry, depth)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPositiveTimeout(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1200;
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
