"use client";

import { useRouter } from "next/navigation";
import { PlayIcon, RotateCwIcon, SquareIcon, TerminalIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/aurora/button";
import {
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/aurora/toolbar";
import type { Workspace, WorkspaceState } from "@/lib/workspaces/types";

type WorkspaceAction = "start" | "stop" | "restart";

export function WorkspaceActions({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = React.useState<WorkspaceAction>();
  const [error, setError] = React.useState<string>();
  const [isPending, startTransition] = React.useTransition();

  async function runAction(action: WorkspaceAction) {
    setPendingAction(action);
    setError(undefined);
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.ok !== true) {
        const message =
          body?.operation?.error?.message ??
          body?.error?.message ??
          "workspace action failed";
        throw new Error(message);
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "workspace action failed",
      );
    } finally {
      setPendingAction(undefined);
    }
  }

  const busy = isPending || pendingAction !== undefined;
  const controls = actionsForState(workspace.state);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <ToolbarGroup>
          {controls.map((action) => (
            <Button
              key={action}
              variant={action === "stop" ? "warn" : "aurora"}
              iconLeft={iconForAction(action)}
              loading={pendingAction === action}
              disabled={busy}
              onClick={() => void runAction(action)}
            >
              {labelForAction(action)}
            </Button>
          ))}
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Button variant="neutral" disabled>
            Share later
          </Button>
          {workspace.terminalUrl ? (
            <Button
              asChild
              variant="aurora"
              iconLeft={<TerminalIcon aria-hidden="true" />}
            >
              <a href={workspace.terminalUrl}>Open terminal</a>
            </Button>
          ) : (
            <Button
              variant="neutral"
              disabled
              iconLeft={<TerminalIcon aria-hidden="true" />}
            >
              Terminal pending
            </Button>
          )}
        </ToolbarGroup>
      </div>
      {error ? (
        <p className="aurora-text-meta max-w-md text-right text-[var(--aurora-error)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function actionsForState(state: WorkspaceState): WorkspaceAction[] {
  if (state === "running" || state === "degraded" || state === "setting_up") {
    return ["restart", "stop"];
  }
  if (state === "stopped" || state === "failed") {
    return ["start"];
  }
  return [];
}

function iconForAction(action: WorkspaceAction) {
  switch (action) {
    case "start":
      return <PlayIcon aria-hidden="true" />;
    case "stop":
      return <SquareIcon aria-hidden="true" />;
    case "restart":
      return <RotateCwIcon aria-hidden="true" />;
  }
}

function labelForAction(action: WorkspaceAction) {
  switch (action) {
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "restart":
      return "Restart";
  }
}
