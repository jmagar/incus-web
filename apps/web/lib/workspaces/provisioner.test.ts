import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  getActorFromHeaders,
} from "@/lib/auth/identity";
import { createStaticPrototypeStatusClient } from "@/lib/provisioner/client";
import {
  PROVISIONER_CONTRACT_VERSION,
  type WorkspaceRuntimeStatus,
} from "@/lib/provisioner/contracts";
import { getWorkspaceInventory } from "@/lib/workspaces/provisioner";

const ownerEmail = "owner@example.com";
const ownerSubject = "owner-subject";

function authHeaders({
  email = ownerEmail,
  subject = ownerSubject,
  displayName,
  requestId,
}: {
  email?: string;
  subject?: string | null;
  displayName?: string;
  requestId?: string;
} = {}) {
  const headers = new Headers({ "x-auth-request-email": email });
  if (subject) headers.set("x-auth-request-subject", subject);
  if (displayName) {
    headers.set("x-auth-request-preferred-username", displayName);
  }
  if (requestId) headers.set("x-request-id", requestId);
  return headers;
}

function ownerActor() {
  return getActorFromHeaders(authHeaders());
}

function useOwnerEmail() {
  vi.stubEnv("INCUS_WEB_WORKSPACE_OWNER_EMAIL", ownerEmail);
}

function useOwnerSubject() {
  vi.stubEnv("INCUS_WEB_WORKSPACE_OWNER_SUBJECT", ownerSubject);
}

function usePrototypeStaticMode() {
  vi.stubEnv("INCUS_WEB_PROVISIONER_MODE", "prototype-static");
}

describe("workspace inventory provisioner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses Authelia/oauth2-proxy identity headers", () => {
    const actor = getActorFromHeaders(
      authHeaders({
        email: "jmagar@example.com",
        subject: "authelia-user-id",
        displayName: "Jacob",
        requestId: "req-123",
      }),
    );

    expect(actor.email).toBe("jmagar@example.com");
    expect(actor.displayName).toBe("Jacob");
    expect(actor.oidcSubject).toBe("authelia-user-id");
    expect(actor.requestId).toBe("req-123");
  });

  it("falls back to a local development actor without headers", () => {
    vi.stubEnv("INCUS_WEB_ALLOW_DEV_AUTH", "1");
    const actor = getActorFromHeaders(new Headers());

    expect(actor.email).toBe("dev@incus-web.local");
    expect(actor.displayName).toBe("dev@incus-web.local");
    expect(actor.userId).toBe("oidc:dev@incus-web.local");
  });

  it("fails closed without identity headers when dev auth is not enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INCUS_WEB_ALLOW_DEV_AUTH", "");

    expect(() => getActorFromHeaders(new Headers())).toThrow(
      AuthenticationRequiredError,
    );
  });

  it("returns the current incus-web workspace read-only inventory", async () => {
    useOwnerEmail();
    usePrototypeStaticMode();
    const actor = getActorFromHeaders(
      authHeaders({ subject: "authelia-user-id" }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.actor.email).toBe(ownerEmail);
    expect(inventory.actor.userId).toBe("oidc:authelia-user-id");
    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]).toMatchObject({
      name: "incus-web",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      state: "running",
      ownerUserId: "oidc:owner@example.com",
    });
    expect(inventory.workspaces[0]?.terminalUrl).toBeUndefined();
    expect(inventory.workspaces[0]?.setup).toMatchObject({
      phase: "ready",
      miseStatus: "unknown",
      dotfilesStatus: "unknown",
    });
  });

  it("matches a configured owner subject when present", async () => {
    vi.stubEnv("INCUS_WEB_WORKSPACE_OWNER_SUBJECT", "authelia-user-id");
    usePrototypeStaticMode();
    const actor = getActorFromHeaders(
      authHeaders({ subject: "authelia-user-id" }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]?.ownerUserId).toBe("oidc:authelia-user-id");
  });

  it("uses provisioner status when rendering the owner workspace", async () => {
    useOwnerEmail();
    const actor = ownerActor();
    const status: WorkspaceRuntimeStatus = {
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      cpuCount: 4,
      memoryLimitBytes: 8 * 1024 * 1024 * 1024,
      rootDiskLimitBytes: 40 * 1024 * 1024 * 1024,
      setupPhase: "ready",
      lastCheckedAt: "2026-07-01T00:00:00.000Z",
    };

    const inventory = await getWorkspaceInventory(
      actor,
      createStaticPrototypeStatusClient(status),
    );

    expect(inventory.workspaces[0]).toMatchObject({
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      resources: {
        cpu: "4 vCPU",
        memory: "8 GiB",
        storage: "40 GiB",
      },
    });
  });

  it("sends the expected status command to the provisioner", async () => {
    useOwnerEmail();
    const actor = getActorFromHeaders(
      authHeaders({
        subject: "authelia-user-id",
        displayName: "Owner",
        requestId: "req-command",
      }),
    );
    const status: WorkspaceRuntimeStatus = {
      workspaceId: "workspace-incus-web",
      state: "running",
      incusProject: "user-incus-web",
      incusContainer: "ws-incus-web",
      lastCheckedAt: "2026-07-01T00:00:00.000Z",
    };
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-command",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "succeeded",
        result: status,
      }),
    };

    await getWorkspaceInventory(actor, client);

    expect(client.send).toHaveBeenCalledWith({
      version: PROVISIONER_CONTRACT_VERSION,
      requestId: "req-command",
      type: "GetWorkspaceStatus",
      actor: {
        userId: "oidc:authelia-user-id",
        oidcSubject: "authelia-user-id",
        email: ownerEmail,
        displayName: "Owner",
      },
      workspace: {
        id: "workspace-incus-web",
        ownerUserId: "oidc:owner@example.com",
        incusProject: "user-incus-web",
        incusContainer: "ws-incus-web",
      },
      payload: {},
    });
  });

  it("does not call provisioner for non-owners", async () => {
    useOwnerEmail();
    const actor = getActorFromHeaders(
      authHeaders({ email: "other@example.com", subject: null }),
    );
    const client = {
      send: vi.fn(),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(client.send).not.toHaveBeenCalled();
    expect(inventory.workspaces).toHaveLength(0);
  });

  it("returns no workspace when provisioner status fails", async () => {
    useOwnerSubject();
    const actor = ownerActor();
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "failed",
        error: {
          code: "incus_unavailable",
          message: "raw /home/agent/.local path should not be rendered",
          retryable: true,
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
    expect(inventory.provisionerError).toMatchObject({
      code: "incus_unavailable",
      requestId: "req-1",
      workspaceId: "workspace-incus-web",
      operationId: "op-1",
    });
  });

  it("returns no workspace when provisioner status tuple is mismatched", async () => {
    useOwnerSubject();
    const actor = ownerActor();
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "succeeded",
        result: {
          workspaceId: "workspace-other",
          state: "running",
          incusProject: "user-other",
          incusContainer: "ws-other",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
    expect(inventory.provisionerError).toMatchObject({
      code: "metadata_mismatch",
      requestId: actor.requestId,
      workspaceId: "workspace-incus-web",
    });
  });

  it("returns no workspace when provisioner status result is malformed", async () => {
    useOwnerSubject();
    const actor = ownerActor();
    const client = {
      send: vi.fn().mockResolvedValue({
        id: "op-1",
        requestId: "req-1",
        type: "GetWorkspaceStatus",
        workspaceId: "workspace-incus-web",
        status: "succeeded",
        result: {
          workspaceId: "workspace-incus-web",
          state: "running",
        },
      }),
    };

    const inventory = await getWorkspaceInventory(actor, client);

    expect(inventory.workspaces).toHaveLength(0);
    expect(inventory.provisionerError).toMatchObject({
      code: "metadata_mismatch",
      requestId: actor.requestId,
      workspaceId: "workspace-incus-web",
    });
  });

  it("surfaces static prototype mode as a production configuration error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    useOwnerSubject();
    usePrototypeStaticMode();
    const actor = ownerActor();

    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(0);
    expect(inventory.provisionerError).toMatchObject({
      code: "invalid_state",
      message: "prototype-static provisioner mode is not allowed in production",
      workspaceId: "workspace-incus-web",
    });
  });

  it("surfaces invalid prototype resource configuration", async () => {
    useOwnerSubject();
    usePrototypeStaticMode();
    vi.stubEnv("INCUS_WEB_PROTOTYPE_CPU", "nope");
    const actor = ownerActor();

    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(0);
    expect(inventory.provisionerError).toMatchObject({
      code: "invalid_input",
      message: "INCUS_WEB_PROTOTYPE_CPU must be a positive number",
      workspaceId: "workspace-incus-web",
    });
  });

  it("requires subject-configured ownership in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    useOwnerEmail();
    const actor = ownerActor();

    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(0);
  });

  it("does not expose the shared prototype workspace to another actor", async () => {
    useOwnerEmail();
    const actor = getActorFromHeaders(
      authHeaders({ email: "other@example.com", subject: null }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.actor.email).toBe("other@example.com");
    expect(inventory.workspaces).toHaveLength(0);
  });
});
