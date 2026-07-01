import type {
  ActorContext,
  WorkspaceInventory,
} from "@/lib/workspaces/types";
import {
  PROVISIONER_CONTRACT_VERSION,
  type ProvisionerCommand,
  type ProvisionerError,
  validateProvisionerOperation,
} from "@/lib/provisioner/contracts";
import {
  createStaticPrototypeStatusClient,
  type ProvisionerClient,
} from "@/lib/provisioner/client";
import {
  createHostProvisionerClient,
  hostProvisionerConfigFromEnv,
} from "@/lib/provisioner/host-transport";
import {
  buildPrototypeWorkspaceRef,
  prototypeRuntimeStatus,
  statusToWorkspace,
} from "@/lib/provisioner/status-adapter";

type ConfiguredOwner = {
  userId: string;
  email?: string;
};

function configuredOwner(actor: ActorContext): ConfiguredOwner | undefined {
  const subject = process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT?.trim();
  if (subject) return { userId: `oidc:${subject}` };

  const email = process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL?.trim();
  if (email) return { userId: `oidc:${email}`, email: email.toLowerCase() };

  const ownerMode = process.env.INCUS_WEB_WORKSPACE_OWNER_MODE ?? "none";
  if (ownerMode === "authenticated") {
    return {
      userId: actor.userId,
      email: actor.email.toLowerCase(),
    };
  }
  if (ownerMode === "none") {
    return undefined;
  }

  throw new Error(
    "INCUS_WEB_WORKSPACE_OWNER_MODE must be authenticated or none",
  );
}

function actorMatchesOwner(actor: ActorContext, owner: ConfiguredOwner) {
  return (
    actor.userId === owner.userId ||
    (owner.email !== undefined && actor.email.toLowerCase() === owner.email)
  );
}

function defaultProvisionerClient(ownerUserId: string): ProvisionerClient {
  let workspace;
  try {
    workspace = buildPrototypeWorkspaceRef(ownerUserId);
  } catch (error) {
    return failedProvisionerClient(
      "invalid_input",
      error instanceof Error ? error.message : "invalid workspace metadata",
      "unknown",
    );
  }
  const mode = process.env.INCUS_WEB_PROVISIONER_MODE ?? "host-local";
  if (mode === "prototype-static") {
    if (process.env.NODE_ENV === "production") {
      return failedProvisionerClient(
        "invalid_state",
        "prototype-static provisioner mode is not allowed in production",
        workspace.id,
      );
    }
    try {
      return createStaticPrototypeStatusClient(prototypeRuntimeStatus(workspace));
    } catch (error) {
      return failedProvisionerClient(
        "invalid_input",
        error instanceof Error ? error.message : "invalid prototype config",
        workspace.id,
      );
    }
  }
  if (mode !== "host-local") {
    return failedProvisionerClient(
      "invalid_input",
      `unsupported provisioner mode: ${mode}`,
      workspace.id,
    );
  }

  try {
    const config = hostProvisionerConfigFromEnv();
    if (config) {
      return createHostProvisionerClient(config);
    }
  } catch (error) {
    return failedProvisionerClient(
      "invalid_input",
      error instanceof Error ? error.message : "invalid host provisioner config",
      workspace.id,
    );
  }

  return failedProvisionerClient(
    "unauthenticated_service",
    "host provisioner transport is not configured",
    workspace.id,
  );
}

export async function getWorkspaceInventory(
  actor: ActorContext,
  client?: ProvisionerClient,
): Promise<WorkspaceInventory> {
  let owner;
  try {
    owner = configuredOwner(actor);
  } catch (error) {
    return inventoryFailure(actor, "unknown", actor.requestId, {
      code: "invalid_input",
      message:
        error instanceof Error ? error.message : "invalid workspace owner config",
      retryable: false,
    });
  }
  if (!owner || !actorMatchesOwner(actor, owner)) {
    return { actor, workspaces: [] };
  }

  let workspace;
  try {
    workspace = buildPrototypeWorkspaceRef(owner.userId);
  } catch (error) {
    return inventoryFailure(actor, "unknown", actor.requestId, {
      code: "invalid_input",
      message: error instanceof Error ? error.message : "invalid workspace metadata",
      retryable: false,
    });
  }
  const provisioner = client ?? defaultProvisionerClient(owner.userId);
  const command: ProvisionerCommand<"GetWorkspaceStatus"> = {
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
  };
  const operation = await provisioner.send(command);

  const validated = validateProvisionerOperation(
    operation,
    workspace,
    "GetWorkspaceStatus",
  );
  if (!validated.ok) {
    return inventoryFailure(actor, workspace.id, command.requestId, validated.error);
  }
  if (validated.value.status !== "succeeded") {
    return inventoryFailure(
      actor,
      workspace.id,
      validated.value.requestId,
      validated.value.error ?? {
        code: "invalid_state",
        message: `provisioner operation is ${validated.value.status}`,
        retryable: true,
      },
      validated.value.id,
    );
  }
  if (!validated.value.result) {
    return inventoryFailure(actor, workspace.id, validated.value.requestId, {
      code: "invalid_state",
      message: "provisioner succeeded without a workspace status result",
      retryable: false,
    });
  }

  return {
    actor,
    workspaces: [statusToWorkspace(validated.value.result, owner.userId)],
  };
}

function failedProvisionerClient(
  code: ProvisionerError["code"],
  message: string,
  workspaceId: string,
): ProvisionerClient {
  return {
    async send(command) {
      const requestId = isProvisionerCommand(command)
        ? command.requestId
        : "unknown";
      return {
        id: `failed-${requestId}`,
        requestId,
        type: "GetWorkspaceStatus",
        workspaceId,
        status: "failed",
        error: {
          code,
          message,
          retryable: false,
        },
        completedAt: new Date().toISOString(),
      };
    },
  };
}

function inventoryFailure(
  actor: ActorContext,
  workspaceId: string,
  requestId: string,
  error: ProvisionerError,
  operationId?: string,
): WorkspaceInventory {
  console.warn("workspace provisioner failed", {
    requestId,
    actor: actor.userId,
    workspaceId,
    operationId,
    code: error.code,
  });
  return {
    actor,
    workspaces: [],
    provisionerError: {
      code: error.code,
      message: error.message,
      requestId,
      workspaceId,
      operationId,
    },
  };
}

function isProvisionerCommand(
  command: unknown,
): command is ProvisionerCommand<"GetWorkspaceStatus"> {
  return (
    typeof command === "object" &&
    command !== null &&
    "requestId" in command &&
    typeof command.requestId === "string"
  );
}
