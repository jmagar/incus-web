"use client";

import {
  BoxesIcon,
  CircleGaugeIcon,
  DatabaseIcon,
  FolderGit2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  UserRoundIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/aurora/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/aurora/card";
import {
  DescriptionItem,
  DescriptionList,
} from "@/components/ui/aurora/description-list";
import { Separator } from "@/components/ui/aurora/separator";
import { StatCard, StatGrid } from "@/components/ui/aurora/stat-card";
import { StatusIndicator } from "@/components/ui/aurora/status-indicator";
import { Toolbar, ToolbarGroup } from "@/components/ui/aurora/toolbar";
import { WorkspaceActions } from "@/components/workspace-actions";
import type {
  CheckStatus,
  Workspace,
  WorkspaceInventory,
  WorkspaceState,
} from "@/lib/workspaces/types";

const ICON_CPU =
  '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>';
const ICON_MEMORY =
  '<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8H2Z"/>';
const ICON_STORAGE =
  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>';

function stateTone(state: WorkspaceState) {
  if (state === "running") return "success";
  if (state === "degraded" || state === "setting_up") return "warn";
  if (state === "failed" || state === "deleted") return "error";
  return "neutral";
}

function stateStatusTone(state: WorkspaceState) {
  if (state === "running") return "online";
  if (state === "degraded" || state === "setting_up") return "degraded";
  if (state === "failed" || state === "deleted") return "error";
  if (state === "creating" || state === "starting" || state === "restarting") {
    return "syncing";
  }
  return "queued";
}

function checkTone(status: CheckStatus) {
  if (status === "ok") return "success";
  if (status === "warn" || status === "unknown") return "warn";
  if (status === "missing") return "error";
  return "neutral";
}

function SetupCheck({ label, status }: { label: string; status: CheckStatus }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--aurora-border-default)] hover:bg-[var(--aurora-hover-bg)]">
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
      <CardHeader className="relative flex flex-col gap-5 border-b-[var(--aurora-border-default)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--aurora-accent-primary)_10%,transparent),transparent)] p-5 md:flex-row md:items-start md:justify-between">
        <div className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-[var(--aurora-accent-primary)]" />
        <div className="min-w-0 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle as="h2" className="truncate">
              {workspace.name}
            </CardTitle>
            <Badge tone={stateTone(workspace.state)} dot pulse={workspace.state === "running"}>
              {workspace.state}
            </Badge>
          </div>
          <CardDescription className="aurora-text-code">
            {workspace.incusProject} / {workspace.incusContainer}
          </CardDescription>
        </div>
        <Toolbar className="w-fit">
          <ToolbarGroup>
            <StatusIndicator
              tone={stateStatusTone(workspace.state)}
              label={workspace.state}
            />
          </ToolbarGroup>
          <WorkspaceActions workspace={workspace} />
        </Toolbar>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-5">
        <StatGrid>
          <StatCard
            icon={ICON_CPU}
            label="CPU"
            value={workspace.resources.cpu}
            tone="info"
          />
          <StatCard
            icon={ICON_MEMORY}
            label="Memory"
            value={workspace.resources.memory}
            tone="success"
          />
          <StatCard
            icon={ICON_STORAGE}
            label="Storage"
            value={workspace.resources.storage}
            tone="warn"
          />
        </StatGrid>

        <Separator />

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[var(--aurora-control-surface)] p-4">
            <div className="flex items-center gap-2">
              <DatabaseIcon
                aria-hidden="true"
                className="size-4 text-[var(--aurora-accent-pink)]"
              />
              <h2 className="aurora-text-label text-[var(--aurora-text-primary)]">
                Setup status
              </h2>
            </div>
            <div className="mt-3 grid gap-1">
              <SetupCheck label="Commands" status={workspace.setup.commandStatus} />
              <SetupCheck label="Packages" status={workspace.setup.packageStatus} />
              <SetupCheck label="mise" status={workspace.setup.miseStatus} />
              <SetupCheck label="dotfiles" status={workspace.setup.dotfilesStatus} />
            </div>
          </div>

          <div className="rounded-[var(--aurora-radius-2)] border border-[color-mix(in_srgb,var(--aurora-accent-pink)_28%,var(--aurora-border-default))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--aurora-accent-pink)_8%,transparent),var(--aurora-control-surface))] p-4 shadow-[var(--aurora-highlight-medium)]">
            <div className="flex items-center gap-2">
              <FolderGit2Icon
                aria-hidden="true"
                className="size-4 text-[var(--aurora-accent-pink)]"
              />
              <h2 className="aurora-text-label text-[var(--aurora-text-primary)]">
                Template
              </h2>
            </div>
            <DescriptionList className="mt-3 bg-transparent">
              <DescriptionItem label="Image" value={workspace.templateVersion} active />
              <DescriptionItem
                label="Profile"
                value={
                  <span className="aurora-text-code text-[var(--aurora-accent-pink-strong)]">
                    {workspace.resourceProfileId}
                  </span>
                }
              />
              {workspace.accessNote ? (
                <DescriptionItem label="Access" value={workspace.accessNote} />
              ) : null}
            </DescriptionList>
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
    <main className="min-h-screen overflow-hidden bg-[var(--aurora-shell-bg)] text-[var(--aurora-text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 md:px-6 lg:px-8">
        <header className="mb-5 flex items-center justify-between rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[linear-gradient(180deg,var(--aurora-panel-medium),color-mix(in_srgb,var(--aurora-panel-medium)_82%,var(--aurora-page-bg)))] px-4 py-3 shadow-[var(--aurora-shadow-medium),var(--aurora-highlight-medium)]">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-[12px] border border-[color-mix(in_srgb,var(--aurora-accent-primary)_42%,var(--aurora-border-strong))] bg-[color-mix(in_srgb,var(--aurora-accent-primary)_12%,var(--aurora-control-surface))] shadow-[var(--aurora-active-glow)]">
              <BoxesIcon aria-hidden="true" className="size-4 text-[var(--aurora-accent-primary)]" />
            </div>
            <div>
              <p className="aurora-text-section leading-none">incus-web</p>
              <p className="aurora-text-meta">Workspace control plane</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <ShieldCheckIcon
              aria-hidden="true"
              className="hidden size-4 text-[var(--aurora-success)] sm:block"
            />
            <div className="hidden min-w-0 text-right sm:block">
              <p className="aurora-text-ui truncate">{inventory.actor.displayName}</p>
              <p className="aurora-text-meta truncate">{inventory.actor.email}</p>
            </div>
            <UserRoundIcon
              aria-hidden="true"
              className="size-5 text-[var(--aurora-accent-primary)] sm:hidden"
            />
          </div>
        </header>

        <section className="mb-5 grid items-start gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden rounded-[var(--aurora-radius-3)] border border-[color-mix(in_srgb,var(--aurora-accent-primary)_38%,var(--aurora-border-default))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--aurora-accent-primary)_12%,var(--aurora-panel-strong)),var(--aurora-panel-strong)_46%,color-mix(in_srgb,var(--aurora-accent-pink)_7%,var(--aurora-panel-strong)))] p-6 shadow-[var(--aurora-shadow-strong),var(--aurora-highlight-strong)]">
            <div className="absolute -right-24 -top-24 size-64 rounded-full border border-[color-mix(in_srgb,var(--aurora-accent-primary)_24%,transparent)]" />
            <div className="absolute right-10 top-8 size-20 rounded-full border border-[color-mix(in_srgb,var(--aurora-accent-pink)_24%,transparent)]" />
            <div className="relative max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-[999px] border border-[color-mix(in_srgb,var(--aurora-accent-primary)_36%,var(--aurora-border-default))] bg-[color-mix(in_srgb,var(--aurora-accent-primary)_9%,transparent)] px-3 py-1">
                <SparklesIcon aria-hidden="true" className="size-3.5 text-[var(--aurora-accent-primary)]" />
                <span className="aurora-text-meta text-[var(--aurora-accent-strong)]">
                  Authenticated workspace
                </span>
              </div>
              <h1 className="aurora-text-display-1 text-[var(--aurora-text-primary)]">
                Workspaces
              </h1>
              <p className="aurora-text-body mt-2 max-w-2xl text-[var(--aurora-text-muted)]">
                Provisioned Incus workspaces with isolated containers, terminal access,
                dotfile bootstrap status, and resource limits in one operator view.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[var(--aurora-panel-medium)] p-4 shadow-[var(--aurora-shadow-medium),var(--aurora-highlight-medium)]">
              <CircleGaugeIcon aria-hidden="true" className="mb-3 size-4 text-[var(--aurora-accent-primary)]" />
              <p className="aurora-text-display-2">{inventory.workspaces.length}</p>
              <p className="aurora-text-meta">Workspace{inventory.workspaces.length === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[var(--aurora-panel-medium)] p-4 shadow-[var(--aurora-shadow-medium),var(--aurora-highlight-medium)]">
              <TerminalIcon aria-hidden="true" className="mb-3 size-4 text-[var(--aurora-accent-pink)]" />
              <p className="aurora-text-section">Live shell</p>
              <p className="aurora-text-meta">Ghostty web terminal</p>
            </div>
            <div className="rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[var(--aurora-panel-medium)] p-4 shadow-[var(--aurora-shadow-medium),var(--aurora-highlight-medium)]">
              <ShieldCheckIcon aria-hidden="true" className="mb-3 size-4 text-[var(--aurora-success)]" />
              <p className="aurora-text-section">Authelia</p>
              <p className="aurora-text-meta">Two-factor gate active</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {inventory.workspaces.length > 0 ? (
            inventory.workspaces.map((workspace) => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))
          ) : inventory.provisionerError ? (
            <Card accent="rose" className="p-6">
              <p className="aurora-text-section">Workspace provisioner failed</p>
              <p className="aurora-text-body mt-2 text-[var(--aurora-text-muted)]">
                {inventory.provisionerError.message}
              </p>
              <DescriptionList className="mt-4 bg-transparent">
                <DescriptionItem label="Code" value={inventory.provisionerError.code} active />
                <DescriptionItem label="Request" value={inventory.provisionerError.requestId} />
                {inventory.provisionerError.workspaceId ? (
                  <DescriptionItem
                    label="Workspace"
                    value={inventory.provisionerError.workspaceId}
                  />
                ) : null}
              </DescriptionList>
            </Card>
          ) : (
            <Card accent="rose" className="p-6">
              <p className="aurora-text-section">No workspace access</p>
              <p className="aurora-text-body mt-2 text-[var(--aurora-text-muted)]">
                This authenticated account is not assigned to the current
                prototype workspace.
              </p>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
