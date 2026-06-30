import type {
  ActorContext,
  Workspace,
  WorkspaceInventory,
} from "@/lib/workspaces/types";

const now = "2026-06-30T00:00:00.000Z";

function currentWorkspace(actor: ActorContext): Workspace {
  return {
    id: "workspace-incus-web",
    ownerUserId: actor.userId,
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
    terminalUrl: "/terminal/incus-web",
    createdAt: now,
    updatedAt: now,
  };
}

export async function getWorkspaceInventory(
  actor: ActorContext,
): Promise<WorkspaceInventory> {
  return {
    actor,
    workspaces: [currentWorkspace(actor)],
  };
}
