import { describe, expect, it } from "vitest";

import { getActorFromHeaders } from "@/lib/auth/identity";
import { getWorkspaceInventory } from "@/lib/workspaces/provisioner";

describe("workspace inventory provisioner", () => {
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
    const actor = getActorFromHeaders(new Headers());

    expect(actor.email).toBe("dev@incus-web.local");
    expect(actor.displayName).toBe("dev@incus-web.local");
    expect(actor.userId).toBe("oidc:dev@incus-web.local");
  });

  it("returns the current incus-web workspace read-only inventory", async () => {
    const actor = getActorFromHeaders(
      new Headers({ "x-auth-request-email": "owner@example.com" }),
    );
    const inventory = await getWorkspaceInventory(actor);

    expect(inventory.actor.email).toBe("owner@example.com");
    expect(inventory.workspaces).toHaveLength(1);
    expect(inventory.workspaces[0]).toMatchObject({
      name: "incus-web",
      incusContainer: "incus-web",
      state: "running",
      ownerUserId: "oidc:owner@example.com",
    });
    expect(inventory.workspaces[0]?.setup).toMatchObject({
      phase: "ready",
      miseStatus: "unknown",
      dotfilesStatus: "unknown",
    });
  });
});
