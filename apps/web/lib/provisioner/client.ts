import {
  isProvisionerCommandType,
  type ProvisionerCommand,
  type ProvisionerCommandType,
  type ProvisionerOperation,
  type WorkspaceRuntimeStatus,
  validateProvisionerCommand,
} from "@/lib/provisioner/contracts";

export type ProvisionerTransport = {
  send<TType extends ProvisionerCommandType>(
    command: ProvisionerCommand<TType>,
  ): Promise<ProvisionerOperation<TType>>;
};

export type ProvisionerClient = {
  send(command: unknown): Promise<ProvisionerOperation>;
};

export function createProvisionerClient(
  transport: ProvisionerTransport,
): ProvisionerClient {
  return {
    async send(command: unknown): Promise<ProvisionerOperation> {
      const validation = validateProvisionerCommand(command);
      if (!validation.ok) {
        return failedOperation(validation.error.message, command);
      }
      try {
        return await transport.send(validation.value);
      } catch (error) {
        console.warn("provisioner transport failed", {
          requestId: validation.value.requestId,
          type: validation.value.type,
          workspaceId: validation.value.workspace.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return failedOperation(
          "provisioner transport failed",
          validation.value,
          "unauthenticated_service",
        );
      }
    },
  };
}

export function createStaticPrototypeStatusClient(
  status: WorkspaceRuntimeStatus,
): ProvisionerClient {
  return createProvisionerClient({
    async send<TType extends ProvisionerCommandType>(
      command: ProvisionerCommand<TType>,
    ): Promise<ProvisionerOperation<TType>> {
      if (command.type !== "GetWorkspaceStatus") {
        return {
          id: `static-prototype-op-${command.requestId}`,
          requestId: command.requestId,
          type: command.type,
          workspaceId: command.workspace.id,
          status: "failed",
          error: {
            code: "invalid_input",
            message:
              "static prototype status client only supports GetWorkspaceStatus",
            retryable: false,
          },
        } as ProvisionerOperation<TType>;
      }
      return {
        id: `static-prototype-op-${command.requestId}`,
        requestId: command.requestId,
        type: command.type,
        workspaceId: command.workspace.id,
        status: "succeeded",
        result: status,
        startedAt: status.lastCheckedAt,
        completedAt: status.lastCheckedAt,
      } as ProvisionerOperation<TType>;
    },
  });
}

function failedOperation(
  message: string,
  command: unknown,
  code: "invalid_input" | "unauthenticated_service" = "invalid_input",
): ProvisionerOperation {
  const context = operationContext(command);
  return {
    id: `failed-${crypto.randomUUID()}`,
    requestId: context.requestId,
    type: context.type,
    workspaceId: context.workspaceId,
    status: "failed",
    error: {
      code,
      message,
      retryable: false,
    },
    completedAt: new Date().toISOString(),
  };
}

function operationContext(command: unknown) {
  if (!isRecord(command)) {
    return defaultOperationContext();
  }
  const workspace = isRecord(command.workspace) ? command.workspace : undefined;
  return {
    requestId:
      typeof command.requestId === "string" && command.requestId.length > 0
        ? command.requestId
        : "unknown",
    type: isProvisionerCommandType(command.type)
      ? command.type
      : "GetWorkspaceStatus",
    workspaceId:
      typeof workspace?.id === "string" && workspace.id.length > 0
        ? workspace.id
        : "unknown",
  };
}

function defaultOperationContext() {
  return {
    requestId: "unknown",
    type: "GetWorkspaceStatus" as const,
    workspaceId: "unknown",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
