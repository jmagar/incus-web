import type {
  ActorContext,
  WorkspaceInventory,
} from "@/lib/workspaces/types";
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

type ConfiguredOwner = {
  userId: string;
  email?: string;
};

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

function actorMatchesOwner(actor: ActorContext, owner: ConfiguredOwner) {
  return (
    actor.userId === owner.userId ||
    (owner.email !== undefined && actor.email.toLowerCase() === owner.email)
  );
}

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
