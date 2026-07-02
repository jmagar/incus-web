import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  CODEX_APP_SERVER_NOT_CONFIGURED,
  createAgentRunStore,
  dispatchAgentRun,
  listAgentRuns,
  startAgentController,
} from "../../../../scripts/agent-runs.mjs";
import {
  PROVISIONER_CONTRACT_VERSION,
  type ProvisionerCommand,
} from "@/lib/provisioner/contracts";

const command: ProvisionerCommand<"DispatchAgentRun"> = {
  version: PROVISIONER_CONTRACT_VERSION,
  requestId: "req-agent",
  type: "DispatchAgentRun",
  actor: {
    userId: "user-1",
    oidcSubject: "subject-1",
    email: "owner@example.com",
  },
  workspace: {
    id: "workspace-1",
    ownerUserId: "user-1",
    incusProject: "default",
    incusContainer: "incus-web",
  },
  payload: {
    agent: "codex",
    repoUrl: "https://github.com/jmagar/incus-web.git",
    task: "Run tests",
  },
};

describe("agent run host store", () => {
  it("persists a failed Codex run when app-server config is missing", async () => {
    const storePath = await tempStorePath();
    const store = createAgentRunStore(storePath);
    const result = await dispatchAgentRun(command, {
      store,
      execute: false,
      config: {
        storePath,
        goldenContainer: "incus-web-agent-golden",
        goldenProject: "default",
        runProject: "default",
        codexAppServerUrl: "",
        codexAppServerToken: "",
        codexModel: "",
        codexAppServerTimeoutMs: 43200000,
        claudeCommandTemplate: "claude -p {{task}}",
      },
    });

    expect(result.run).toMatchObject({
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      agent: "codex",
      status: "failed",
      phase: "failed",
      controller: { kind: "codex-app-server" },
      error: CODEX_APP_SERVER_NOT_CONFIGURED,
      container: {
        name: expect.stringMatching(/^agent-run-/),
        sourceContainer: "incus-web-agent-golden",
        state: "planned",
      },
    });

    const stored = JSON.parse(await readFile(storePath, "utf8"));
    expect(stored).toHaveLength(1);
    expect(stored[0].container.name).toBe(result.run.container.name);
  });

  it("lists runs by workspace with newest first", async () => {
    const storePath = await tempStorePath();
    const store = createAgentRunStore(storePath);
    await dispatchAgentRun(command, {
      store,
      execute: false,
      config: config(storePath),
    });
    await dispatchAgentRun(
      {
        ...command,
        requestId: "req-agent-2",
        payload: { ...command.payload, task: "Second run" },
      },
      {
        store,
        execute: false,
        config: config(storePath),
      },
    );

    const result = await listAgentRuns(
      {
        ...command,
        type: "ListAgentRuns",
        payload: { limit: 1 },
      },
      { store, config: config(storePath) },
    );

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].task).toBe("Second run");
  });

  it("starts Codex through the app-server controller seam", async () => {
    const progress: string[] = [];
    const controller = await startAgentController(
      {
        id: "run_20260702000000_abcd1234",
        agent: "codex",
        task: "Run tests",
      },
      {
        ...config("/tmp/not-used.json"),
        codexAppServerUrl: "ws://127.0.0.1:4500",
        codexModel: "gpt-5.4",
        codexAppServerTimeoutMs: 1000,
      },
      async () => {
        throw new Error("codex app-server must not shell out through execInContainer");
      },
      {
        onProgress: async (message) => progress.push(message),
        codexAppServerClient: {
          async startTurn(params) {
            expect(params).toMatchObject({
              cwd: "/workspace/repo",
              model: "gpt-5.4",
              task: "Run tests",
            });
            await params.onProgress("Codex app-server thread thr_123 running");
            return { threadId: "thr_123", turnId: "turn_456" };
          },
        },
      },
    );

    expect(controller).toEqual({
      kind: "codex-app-server",
      sessionId: "thr_123",
      turnId: "turn_456",
      url: "ws://127.0.0.1:4500",
    });
    expect(progress).toEqual(["Codex app-server thread thr_123 running"]);
  });
});

async function tempStorePath() {
  return join(await mkdtemp(join(tmpdir(), "incus-web-agent-runs-")), "runs.json");
}

function config(storePath: string) {
  return {
    storePath,
    goldenContainer: "incus-web-agent-golden",
    goldenProject: "default",
    runProject: "default",
    codexAppServerUrl: "",
    codexAppServerToken: "",
    codexModel: "",
    codexAppServerTimeoutMs: 43200000,
    claudeCommandTemplate: "claude -p {{task}}",
  };
}
