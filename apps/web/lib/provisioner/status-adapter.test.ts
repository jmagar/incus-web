import { describe, expect, it } from "vitest";

import {
  buildPrototypeWorkspaceRef,
  prototypeRuntimeStatus,
  statusToWorkspace,
} from "@/lib/provisioner/status-adapter";

describe("provisioner status adapter", () => {
  it("builds generated prototype workspace refs", () => {
    expect(buildPrototypeWorkspaceRef("oidc:owner@example.com")).toMatchObject({
      id: "workspace-incus-web",
      ownerUserId: "oidc:owner@example.com",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
    });
  });

  it("creates prototype runtime status from environment defaults", () => {
    const status = prototypeRuntimeStatus("workspace-incus-web");

    expect(status).toMatchObject({
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      cpuCount: 2,
      memoryLimitBytes: 4 * 1024 * 1024 * 1024,
    });
  });

  it("maps runtime status to existing dashboard workspace shape", () => {
    const workspace = statusToWorkspace(
      {
        workspaceId: "workspace-incus-web",
        state: "running",
        incusProject: "user-incus-web",
        incusContainer: "ws-incus-web",
        cpuCount: 2,
        memoryUsedBytes: 128 * 1024 * 1024,
        memoryLimitBytes: 4 * 1024 * 1024 * 1024,
        rootDiskLimitBytes: 20 * 1024 * 1024 * 1024,
        setupPhase: "ready",
        lastCheckedAt: "2026-07-01T00:00:00.000Z",
      },
      "oidc:owner@example.com",
    );

    expect(workspace).toMatchObject({
      id: "workspace-incus-web",
      ownerUserId: "oidc:owner@example.com",
      name: "incus-web",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      state: "running",
      resources: {
        cpu: "2 vCPU",
        memory: "4 GiB",
        storage: "20 GiB",
      },
      setup: {
        phase: "ready",
      },
    });
  });
});
