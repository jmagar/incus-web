import type {
  ActorContext,
  Workspace,
  WorkspaceInventory,
} from "@/lib/workspaces/types";

const now = "2026-06-30T00:00:00.000Z";

type ConfiguredOwner = {
  userId: string;
  email?: string;
};

function configuredOwner(): ConfiguredOwner | undefined {
  const subject = process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT?.trim();
  if (subject) return { userId: `oidc:${subject}` };

  const email = process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL?.trim();
  if (email) return { userId: `oidc:${email}`, email: email.toLowerCase() };

  if (
    process.env.INCUS_WEB_ALLOW_DEV_AUTH === "1" ||
    process.env.NODE_ENV !== "production"
  ) {
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

function currentWorkspace(ownerUserId: string): Workspace {
  return {
    id: "workspace-incus-web",
    ownerUserId,
    name: "incus-web",
    slug: "incus-web",
    incusProject: "incus-web",
    incusContainer: "incus-web",
    templateVersion: "prototype",
    state: "running",
    resourceProfileId: "local-dev",
    resources: {
      cpu: "2 vCPU",
      memory: "4 GiB",
      storage: "host quota pending",
    },
    setup: {
      phase: "ready",
      dotfilesStatus: "unknown",
      miseStatus: "unknown",
      commandStatus: "unknown",
      packageStatus: "unknown",
      updatedAt: now,
    },
    accessNote:
      "Single-container prototype. Terminal routing moves behind workspace-scoped sessions before multi-user sharing.",
    createdAt: now,
    updatedAt: now,
  };
}

export async function getWorkspaceInventory(
  actor: ActorContext,
): Promise<WorkspaceInventory> {
  const owner = configuredOwner();
  const workspaces =
    owner && actorMatchesOwner(actor, owner)
      ? [currentWorkspace(owner.userId)]
      : [];

  return {
    actor,
    workspaces,
  };
}
