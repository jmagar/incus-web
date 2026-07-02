"use client";

import { BotIcon, GitBranchIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentRun, AgentRunAgent } from "@/lib/provisioner/contracts";
import type { Workspace } from "@/lib/workspaces/types";

type FormState = {
  agent: AgentRunAgent;
  repoUrl: string;
  ref: string;
  task: string;
};

const emptyForm: FormState = {
  agent: "codex",
  repoUrl: "",
  ref: "",
  task: "",
};

export function AgentRunDispatch({ workspace }: { workspace: Workspace }) {
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [runs, setRuns] = React.useState<AgentRun[]>([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const active = runs.some(
    (run) => run.status === "queued" || run.status === "running",
  );

  const refreshRuns = React.useCallback(async () => {
    setLoadingRuns(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/agent-runs`, {
        headers: { "Cache-Control": "no-store" },
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.error?.message ?? "failed to load agent runs");
      }
      setRuns(Array.isArray(body.runs) ? body.runs : []);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "failed to load agent runs",
      );
    } finally {
      setLoadingRuns(false);
    }
  }, [workspace.id]);

  React.useEffect(() => {
    void Promise.resolve().then(refreshRuns);
  }, [refreshRuns]);

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void refreshRuns();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [active, refreshRuns]);

  async function submitRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/agent-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: form.agent,
          repoUrl: form.repoUrl,
          task: form.task,
          ...(form.ref.trim() ? { ref: form.ref } : {}),
        }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.ok !== true) {
        throw new Error(
          body?.operation?.error?.message ??
            body?.error?.message ??
            "failed to dispatch agent run",
        );
      }
      setRuns((current) => [body.run, ...current.filter((run) => run.id !== body.run.id)]);
      setForm(emptyForm);
      void refreshRuns();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "failed to dispatch agent run",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-panel-medium)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--aurora-border-default)] px-4 py-3">
        <div className="flex items-center gap-2">
          <BotIcon
            aria-hidden="true"
            className="size-4 text-[var(--aurora-accent-primary)]"
          />
          <h2 className="aurora-text-label text-[var(--aurora-text-primary)]">
            Agent runs
          </h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="neutral"
          iconLeft={<RefreshCwIcon aria-hidden="true" className="size-3.5" />}
          loading={loadingRuns}
          onClick={() => void refreshRuns()}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="border-b border-[var(--aurora-border-default)] px-4 py-2 text-sm text-[var(--aurora-error)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-0 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <form
          className="space-y-3 border-b border-[var(--aurora-border-default)] p-4 lg:border-b-0 lg:border-r"
          onSubmit={submitRun}
        >
          <p className="aurora-text-meta">
            Codex attaches through app-server controller sessions. Claude uses
            the host CLI-template controller for this prototype.
          </p>
          <label className="grid gap-1">
            <span className="aurora-text-ui">Agent</span>
            <select
              className="h-9 rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] px-2 text-sm text-[var(--aurora-text-primary)]"
              value={form.agent}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  agent: event.target.value as AgentRunAgent,
                }))
              }
            >
              <option value="codex">Codex app-server</option>
              <option value="claude">Claude CLI-template</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="aurora-text-ui">Repo URL</span>
            <input
              className="h-9 rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] px-2 text-sm text-[var(--aurora-text-primary)]"
              value={form.repoUrl}
              placeholder="https://github.com/org/repo.git"
              onChange={(event) =>
                setForm((current) => ({ ...current, repoUrl: event.target.value }))
              }
              required
            />
          </label>
          <label className="grid gap-1">
            <span className="aurora-text-ui">Branch/ref</span>
            <input
              className="h-9 rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] px-2 text-sm text-[var(--aurora-text-primary)]"
              value={form.ref}
              placeholder="optional"
              onChange={(event) =>
                setForm((current) => ({ ...current, ref: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1">
            <span className="aurora-text-ui">Task</span>
            <textarea
              className="min-h-28 rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] px-2 py-2 text-sm text-[var(--aurora-text-primary)]"
              value={form.task}
              onChange={(event) =>
                setForm((current) => ({ ...current, task: event.target.value }))
              }
              required
            />
          </label>
          <p className="aurora-text-meta">
            Each run gets a fresh golden-container clone. Repo and task content
            execute inside that owned run container.
          </p>
          <Button
            type="submit"
            iconLeft={<SendIcon aria-hidden="true" className="size-3.5" />}
            loading={submitting}
            disabled={submitting}
          >
            Dispatch run
          </Button>
        </form>

        <div className="min-w-0 p-4">
          {runs.length === 0 ? (
            <div className="rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] p-4">
              <p className="aurora-text-ui">No agent runs yet</p>
              <p className="aurora-text-meta mt-1">
                Dispatch creates the run id and owned container before cloning.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              {runs.map((run) => (
                <AgentRunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentRunRow({ run }: { run: AgentRun }) {
  return (
    <article className="grid gap-3 rounded-[4px] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] p-3 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={toneForStatus(run.status)} shape="tag">
            {run.status}
          </Badge>
          <span className="aurora-text-code truncate text-[var(--aurora-text-primary)]">
            {run.id} -&gt; {run.container.name} -&gt;{" "}
            {controllerLabel(run)}
          </span>
        </div>
        <div className="mt-2 grid gap-1 text-sm text-[var(--aurora-text-muted)]">
          <span className="truncate">
            {run.agent} / {run.phase} / {run.repoUrl}
          </span>
          <span className="truncate">
            Container: {run.container.project}/{run.container.name} from{" "}
            {run.container.sourceProject}/{run.container.sourceContainer} (
            {run.container.state})
          </span>
          {run.controller?.sessionId ? (
            <span className="truncate">Session: {run.controller.sessionId}</span>
          ) : null}
          {run.lastLogExcerpt || run.error ? (
            <span className="truncate text-[var(--aurora-text-primary)]">
              {run.lastLogExcerpt ?? run.error}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-start gap-2 xl:justify-end">
        <GitBranchIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-[var(--aurora-accent-pink)]"
        />
        <div className="text-left xl:text-right">
          <p className="aurora-text-meta">{run.ref || "default ref"}</p>
          <p className="aurora-text-meta">{formatDate(run.updatedAt)}</p>
        </div>
      </div>
    </article>
  );
}

function controllerLabel(run: AgentRun) {
  if (run.controller?.sessionId) {
    return `${run.controller.kind}:${run.controller.sessionId}`;
  }
  if (run.controller?.kind) {
    return run.controller.kind;
  }
  return run.agent === "codex" ? "codex-app-server:pending" : "claude-cli:pending";
}

function toneForStatus(status: AgentRun["status"]) {
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "warn";
  return "neutral";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
