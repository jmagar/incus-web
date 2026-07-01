import { describe, expect, it } from "vitest";

import {
  PROVISIONER_CONTRACT_VERSION,
  redactProvisionerCommand,
  redactProvisionerOperation,
  redactSetupExcerpt,
  validateGeneratedName,
  validateProvisionerCommand,
  validateProvisionerOperation,
  validateSetupPayload,
  validateWorkspaceRuntimeStatus,
  type ProvisionerCommand,
  type ProvisionerOperation,
  type RunSetupPayload,
} from "@/lib/provisioner/contracts";

const baseCommand: ProvisionerCommand<Record<string, never>> = {
  version: PROVISIONER_CONTRACT_VERSION,
  requestId: "req-123",
  type: "GetWorkspaceStatus",
  actor: {
    userId: "user-1",
    oidcSubject: "oidc-subject",
    email: "owner@example.com",
    displayName: "Owner",
  },
  workspace: {
    id: "workspace-1",
    ownerUserId: "user-1",
    incusProject: "user-abc123",
    incusContainer: "ws-def456",
  },
  payload: {},
};

describe("provisioner contract validators", () => {
  it("accepts a valid provisioner command envelope", () => {
    const result = validateProvisionerCommand(baseCommand);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("GetWorkspaceStatus");
  });

  it("rejects unknown contract versions and command types", () => {
    expect(
      validateProvisionerCommand({ ...baseCommand, version: "mtcp.v1" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });

    expect(
      validateProvisionerCommand({ ...baseCommand, type: "RawIncusExec" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates generated Incus project and container names", () => {
    expect(validateGeneratedName("user-abc123", "user")).toBe(true);
    expect(validateGeneratedName("ws-def456", "ws")).toBe(true);
    expect(validateGeneratedName("user-", "user")).toBe(false);
    expect(validateGeneratedName("user-../../root", "user")).toBe(false);
    expect(validateGeneratedName("User-Abc", "user")).toBe(false);
  });

  it("rejects malformed workspace refs", () => {
    const result = validateProvisionerCommand({
      ...baseCommand,
      workspace: {
        ...baseCommand.workspace,
        incusContainer: "../escape",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates setup payload constraints", () => {
    const validPayload: RunSetupPayload = {
      dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
      ageKey: {
        value: "AGE-SECRET-KEY-1234567890",
        persistEncrypted: false,
      },
      skipAptScripts: true,
    };

    expect(validateSetupPayload(validPayload).ok).toBe(true);
    expect(
      validateSetupPayload({
        dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
        skipAptScripts: true,
      }).ok,
    ).toBe(true);
    expect(
      validateSetupPayload({
        dotfilesRepo: "git@github.com:jmagar/dotfiles.git",
        skipAptScripts: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      validateSetupPayload({
        dotfilesRepo: "x".repeat(513),
        skipAptScripts: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      validateSetupPayload({
        dotfilesRepo: "file:///tmp/dotfiles",
        skipAptScripts: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      validateSetupPayload({
        ageKey: { value: "not-an-age-key", persistEncrypted: false },
        skipAptScripts: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("validates setup payloads through the command envelope", () => {
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "RunSetup",
        payload: {
          ageKey: { value: "not-an-age-key", persistEncrypted: false },
          skipAptScripts: true,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("rejects unsupported raw payload fields for all command types", () => {
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "CreateWorkspace",
        payload: {
          templateVersion: "prototype",
          resourceProfileId: "local-dev",
          autoStart: true,
          rawIncusConfig: { "security.privileged": true },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "GetWorkspaceStatus",
        payload: { incusProject: "user-abc123" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "RunSetup",
        payload: {
          skipAptScripts: true,
          command: "curl example.test | sh",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("accepts valid command payloads for lifecycle command envelopes", () => {
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "CreateWorkspace",
        payload: {
          templateVersion: "prototype",
          resourceProfileId: "local-dev",
          autoStart: false,
        },
      }).ok,
    ).toBe(true);
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "StopWorkspace",
        payload: { force: false, timeoutSeconds: 180 },
      }).ok,
    ).toBe(true);
    expect(
      validateProvisionerCommand({
        ...baseCommand,
        type: "RestartWorkspace",
        payload: { timeoutSeconds: 180 },
      }).ok,
    ).toBe(true);
  });

  it("rejects age key persistence unless policy enables it", () => {
    const payload: RunSetupPayload = {
      ageKey: {
        value: "AGE-SECRET-KEY-1234567890",
        persistEncrypted: true,
      },
      skipAptScripts: true,
    };

    expect(validateSetupPayload(payload)).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(validateSetupPayload(payload, { allowAgeKeyPersistence: true }).ok).toBe(
      true,
    );
  });

  it("validates returned status tuples against the requested workspace", () => {
    expect(
      validateWorkspaceRuntimeStatus(
        {
          workspaceId: "workspace-1",
          state: "running",
          incusProject: "user-abc123",
          incusContainer: "ws-def456",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
        baseCommand.workspace,
      ).ok,
    ).toBe(true);

    expect(
      validateWorkspaceRuntimeStatus(
        {
          workspaceId: "workspace-2",
          state: "running",
          incusProject: "user-other",
          incusContainer: "ws-other",
          lastCheckedAt: "2026-07-01T00:00:00.000Z",
        },
        baseCommand.workspace,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "metadata_mismatch" },
    });
  });

  it("validates operation envelopes for requested type and workspace", () => {
    const operation: ProvisionerOperation = {
      id: "op-1",
      requestId: "req-123",
      type: "GetWorkspaceStatus",
      workspaceId: "workspace-1",
      status: "succeeded",
      result: {
        workspaceId: "workspace-1",
        state: "running",
        incusProject: "user-abc123",
        incusContainer: "ws-def456",
        lastCheckedAt: "2026-07-01T00:00:00.000Z",
      },
    };

    expect(
      validateProvisionerOperation(
        operation,
        baseCommand.workspace,
        "GetWorkspaceStatus",
      ).ok,
    ).toBe(true);
    expect(
      validateProvisionerOperation(
        { ...operation, workspaceId: "workspace-2" },
        baseCommand.workspace,
        "GetWorkspaceStatus",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "metadata_mismatch" },
    });
  });

  it("validates non-status operation result shapes by command type", () => {
    expect(
      validateProvisionerOperation(
        {
          id: "op-1",
          requestId: "req-123",
          type: "CreateWorkspace",
          workspaceId: "workspace-1",
          status: "succeeded",
          result: {
            workspaceId: "workspace-1",
            incusProject: "user-abc123",
            incusContainer: "ws-def456",
            state: "running",
            templateVersion: "prototype",
            resourceProfileId: "local-dev",
          },
        },
        baseCommand.workspace,
        "CreateWorkspace",
      ).ok,
    ).toBe(true);
    expect(
      validateProvisionerOperation(
        {
          id: "op-1",
          requestId: "req-123",
          type: "RunSetup",
          workspaceId: "workspace-1",
          status: "succeeded",
          result: {
            workspaceId: "workspace-1",
            setup: { phase: "ready" },
          },
        },
        baseCommand.workspace,
        "RunSetup",
      ).ok,
    ).toBe(true);
  });

  it("redacts age key material from commands", () => {
    const command: ProvisionerCommand<RunSetupPayload> = {
      ...baseCommand,
      type: "RunSetup",
      payload: {
        dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
        ageKey: {
          value: "AGE-SECRET-KEY-super-secret",
          persistEncrypted: false,
        },
        skipAptScripts: true,
      },
    };

    expect(JSON.stringify(redactProvisionerCommand(command))).not.toContain(
      "super-secret",
    );
    expect(redactProvisionerCommand(command).payload).toMatchObject({
      dotfilesRepo: "https://github.com/jmagar/dotfiles.git",
      ageKey: {
        value: "[REDACTED]",
        persistEncrypted: false,
      },
      skipAptScripts: true,
    });
  });

  it("redacts secret material, bearer tokens, and host paths from operations", () => {
    const operation: ProvisionerOperation = {
      id: "op-1",
      requestId: "req-123",
      type: "RunSetup",
      workspaceId: "workspace-1",
      status: "failed",
      error: {
        code: "setup_failed",
        message:
          "failed with AGE-SECRET-KEY-super-secret and Bearer token in /home/agent/.config",
        retryable: false,
        details: {
          stderr: "incus error from /var/lib/incus with AGE-SECRET-KEY-super-secret",
        },
      },
    };

    const redacted = redactProvisionerOperation(operation);

    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("Bearer token");
    expect(JSON.stringify(redacted)).not.toContain("/var/lib/incus");
    expect(
      redactSetupExcerpt("raw /home/agent path AGE-SECRET-KEY-super-secret"),
    ).toBe("raw [REDACTED_PATH] path [REDACTED_AGE_KEY]");
    expect(redactSetupExcerpt("x".repeat(5000))).toContain("[TRUNCATED]");
  });
});
