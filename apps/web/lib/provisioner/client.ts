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
            message:
              "static prototype status client only supports GetWorkspaceStatus",
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
