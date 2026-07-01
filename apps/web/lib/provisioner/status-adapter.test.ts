import { afterEach, describe, expect, it } from "vitest";

import {
  buildPrototypeWorkspaceRef,
  prototypeRuntimeStatus,
  statusToWorkspace,
} from "@/lib/provisioner/status-adapter";

describe("provisioner status adapter", () => {
  afterEach(() => {
    delete process.env.INCUS_WEB_PROTOTYPE_CPU;
    delete process.env.INCUS_WEB_PROTOTYPE_MEMORY_BYTES;
    delete process.env.INCUS_WEB_PROTOTYPE_DISK_BYTES;
  });

  it("builds generated prototype workspace refs", () => {
    expect(buildPrototypeWorkspaceRef("oidc:owner@example.com")).toMatchObject({
      id: "workspace-incus-web",
      ownerUserId: "oidc:owner@example.com",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
    });
  });

  it("creates prototype runtime status from environment defaults", () => {
    delete process.env.INCUS_WEB_PROTOTYPE_CPU;
    delete process.env.INCUS_WEB_PROTOTYPE_MEMORY_BYTES;
    delete process.env.INCUS_WEB_PROTOTYPE_DISK_BYTES;

    const status = prototypeRuntimeStatus(
      buildPrototypeWorkspaceRef("oidc:owner@example.com"),
    );

    expect(status).toMatchObject({
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      cpuCount: 2,
      memoryLimitBytes: 4 * 1024 * 1024 * 1024,
    });
  });

  it("rejects invalid prototype resource environment values", () => {
    process.env.INCUS_WEB_PROTOTYPE_CPU = "nope";

    expect(() =>
      prototypeRuntimeStatus(buildPrototypeWorkspaceRef("oidc:owner@example.com")),
    ).toThrow("INCUS_WEB_PROTOTYPE_CPU must be a positive number");
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
