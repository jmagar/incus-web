"use client";

import {
  CpuIcon,
  DatabaseIcon,
  FolderGit2Icon,
  HardDriveIcon,
  MemoryStickIcon,
  TerminalIcon,
  UserRoundIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/aurora/badge";
import { Button } from "@/components/ui/aurora/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/aurora/card";
import { Separator } from "@/components/ui/aurora/separator";
import type {
  CheckStatus,
  Workspace,
  WorkspaceInventory,
  WorkspaceState,
} from "@/lib/workspaces/types";

function stateTone(state: WorkspaceState) {
  if (state === "running") return "success";
  if (state === "degraded" || state === "setting_up") return "warn";
  if (state === "failed" || state === "deleted") return "error";
  return "neutral";
}

function checkTone(status: CheckStatus) {
  if (status === "ok") return "success";
  if (status === "warn" || status === "unknown") return "warn";
  if (status === "missing") return "error";
  return "neutral";
}

function ResourceItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CpuIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] px-3 py-2">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--aurora-accent-primary)]" />
      <div className="min-w-0">
        <p className="aurora-text-meta">{label}</p>
        <p className="aurora-text-ui truncate text-[var(--aurora-text-primary)]">
          {value}
        </p>
      </div>
    </div>
  );
}

function SetupCheck({ label, status }: { label: string; status: CheckStatus }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="aurora-text-ui text-[var(--aurora-text-muted)]">
        {label}
      </span>
      <Badge tone={checkTone(status)} shape="tag">
        {status}
      </Badge>
    </div>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return (
    <Card accent="cyan" className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>{workspace.name}</CardTitle>
          <CardDescription>
            {workspace.incusProject} / {workspace.incusContainer}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={stateTone(workspace.state)} dot pulse={workspace.state === "running"}>
            {workspace.state}
          </Badge>
          <Button
            asChild
            variant="aurora"
            iconLeft={<TerminalIcon aria-hidden="true" />}
          >
            <a href={workspace.terminalUrl}>Open terminal</a>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ResourceItem icon={CpuIcon} label="CPU" value={workspace.resources.cpu} />
          <ResourceItem
            icon={MemoryStickIcon}
            label="Memory"
            value={workspace.resources.memory}
          />
          <ResourceItem
            icon={HardDriveIcon}
            label="Storage"
            value={workspace.resources.storage}
          />
        </div>

        <Separator />

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <DatabaseIcon
                aria-hidden="true"
                className="size-4 text-[var(--aurora-accent-pink)]"
              />
              <h2 className="aurora-text-label text-[var(--aurora-text-primary)]">
                Setup status
              </h2>
            </div>
            <SetupCheck label="Commands" status={workspace.setup.commandStatus} />
            <SetupCheck label="Packages" status={workspace.setup.packageStatus} />
            <SetupCheck label="mise" status={workspace.setup.miseStatus} />
            <SetupCheck label="dotfiles" status={workspace.setup.dotfilesStatus} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <FolderGit2Icon
                aria-hidden="true"
                className="size-4 text-[var(--aurora-accent-primary)]"
              />
              <h2 className="aurora-text-label text-[var(--aurora-text-primary)]">
                Template
              </h2>
            </div>
            <p className="aurora-text-body-sm text-[var(--aurora-text-muted)]">
              {workspace.templateVersion}
            </p>
            <p className="aurora-text-meta">
              Resource profile: {workspace.resourceProfileId}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkspaceDashboard({
  inventory,
}: {
  inventory: WorkspaceInventory;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-5 py-6 md:px-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="aurora-text-eyebrow text-[var(--aurora-accent-primary)]">
            incus-web
          </p>
          <h1 className="aurora-text-display-2 text-[var(--aurora-text-primary)]">
            Workspaces
          </h1>
          <p className="aurora-text-body text-[var(--aurora-text-muted)]">
            Read-only inventory for the current authenticated workspace.
          </p>
        </div>

        <Card elevated={false} className="min-w-72">
          <CardContent className="flex items-center gap-3">
            <UserRoundIcon
              aria-hidden="true"
              className="size-5 text-[var(--aurora-accent-primary)]"
            />
            <div className="min-w-0">
              <p className="aurora-text-ui truncate text-[var(--aurora-text-primary)]">
                {inventory.actor.displayName}
              </p>
              <p className="aurora-text-meta truncate">{inventory.actor.email}</p>
            </div>
          </CardContent>
        </Card>
      </header>

      <section className="grid gap-4">
        {inventory.workspaces.map((workspace) => (
          <WorkspaceCard key={workspace.id} workspace={workspace} />
        ))}
      </section>
    </main>
  );
}
