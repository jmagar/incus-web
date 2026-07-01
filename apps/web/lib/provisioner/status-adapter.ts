import type {
  ProvisionerSetupPhase,
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

const createdAt = "2026-01-01T00:00:00.000Z";
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
    createdAt,
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

function setupPhase(value: ProvisionerSetupPhase | undefined): SetupPhase {
  return value ?? "not_configured";
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
