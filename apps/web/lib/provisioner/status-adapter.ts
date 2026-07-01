import type {
  ProvisionerSetupPhase,
  ProvisionerWorkspaceRef,
  WorkspaceRuntimeStatus,
} from "@/lib/provisioner/contracts";
import {
  validateIncusContainerName,
  validateIncusProjectName,
} from "@/lib/provisioner/contracts";
import type {
  SetupPhase,
  Workspace,
  WorkspaceSetupSummary,
} from "@/lib/workspaces/types";

const createdAt = "2026-01-01T00:00:00.000Z";
const gib = 1024 * 1024 * 1024;

export function buildPrototypeWorkspaceRef(
  ownerUserId: string,
): ProvisionerWorkspaceRef {
  const incusProject = stringEnv(
    "INCUS_WEB_INCUS_PROJECT",
    "default",
  );
  const incusContainer = stringEnv(
    "INCUS_WEB_INCUS_CONTAINER",
    process.env.CONTAINER_NAME?.trim() || "incus-web",
  );
  if (!validateIncusProjectName(incusProject)) {
    throw new Error("INCUS_WEB_INCUS_PROJECT is invalid");
  }
  if (!validateIncusContainerName(incusContainer)) {
    throw new Error("INCUS_WEB_INCUS_CONTAINER is invalid");
  }
  return {
    id: stringEnv("INCUS_WEB_WORKSPACE_ID", "workspace-incus-web"),
    ownerUserId,
    incusProject,
    incusContainer,
  };
}

export function prototypeRuntimeStatus(
  workspace: ProvisionerWorkspaceRef,
): WorkspaceRuntimeStatus {
  return {
    workspaceId: workspace.id,
    state: "running",
    incusProject: workspace.incusProject,
    incusContainer: workspace.incusContainer,
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
    state: status.state,
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
    terminalUrl: optionalUrlEnv("INCUS_WEB_TERMINAL_URL"),
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

function setupPhase(value: ProvisionerSetupPhase | undefined): SetupPhase {
  return value ?? "not_configured";
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function stringEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  return value;
}

function optionalUrlEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return value;
    }
  } catch {
    // Fall through to the config error below.
  }
  throw new Error(`${name} must be a relative path or http(s) URL`);
}
