import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  getActorFromHeaders,
} from "@/lib/auth/identity";
import { getWorkspaceInventory } from "@/lib/workspaces/provisioner";

describe("workspace inventory provisioner", () => {
  afterEach(() => {
    delete process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL;
    delete process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT;
    delete process.env.INCUS_WEB_ALLOW_DEV_AUTH;
    vi.unstubAllEnvs();
  });

  it("parses Authelia/oauth2-proxy identity headers", async () => {
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "jmagar@example.com",
        "x-auth-request-preferred-username": "Jacob",
        "x-auth-request-subject": "authelia-user-id",
        "x-request-id": "req-123",
      }),
    );

    expect(actor.email).toBe("jmagar@example.com");
    expect(actor.displayName).toBe("Jacob");
    expect(actor.oidcSubject).toBe("authelia-user-id");
    expect(actor.requestId).toBe("req-123");
  });

  it("falls back to a local development actor without headers", () => {
    process.env.INCUS_WEB_ALLOW_DEV_AUTH = "1";
    const actor = getActorFromHeaders(new Headers());

    expect(actor.email).toBe("dev@incus-web.local");
    expect(actor.displayName).toBe("dev@incus-web.local");
    expect(actor.userId).toBe("oidc:dev@incus-web.local");
  });

  it("fails closed without identity headers when dev auth is not enabled", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.INCUS_WEB_ALLOW_DEV_AUTH;

    expect(() => getActorFromHeaders(new Headers())).toThrow(
      AuthenticationRequiredError,
    );

    vi.stubEnv("NODE_ENV", originalNodeEnv);
  });

  it("returns the current incus-web workspace read-only inventory", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL = "owner@example.com";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "authelia-user-id",
      }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.actor.email).toBe("owner@example.com");
    expect(inventory.actor.userId).toBe("oidc:authelia-user-id");
    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]).toMatchObject({
      name: "incus-web",
      incusContainer: "incus-web",
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
    process.env.INCUS_WEB_WORKSPACE_OWNER_SUBJECT = "authelia-user-id";
    const actor = getActorFromHeaders(
      new Headers({
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-subject": "authelia-user-id",
      }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]?.ownerUserId).toBe("oidc:authelia-user-id");
  });

  it("does not expose the shared prototype workspace to another actor", async () => {
    process.env.INCUS_WEB_WORKSPACE_OWNER_EMAIL = "owner@example.com";
    const actor = getActorFromHeaders(
      new Headers({ "x-auth-request-email": "other@example.com" }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.actor.email).toBe("other@example.com");
    expect(inventory.workspaces).toHaveLength(0);
  });
});
