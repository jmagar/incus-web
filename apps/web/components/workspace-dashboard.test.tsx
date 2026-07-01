import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import type { WorkspaceInventory } from "@/lib/workspaces/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const inventory: WorkspaceInventory = {
  actor: {
    userId: "oidc:test@example.com",
    oidcSubject: "test@example.com",
    email: "test@example.com",
    displayName: "Test User",
    requestId: "req-test",
  },
  workspaces: [
    {
      id: "workspace-incus-web",
      ownerUserId: "oidc:test@example.com",
      name: "incus-web",
      slug: "incus-web",
      incusProject: "incus-web",
      incusContainer: "incus-web",
      templateVersion: "prototype",
      state: "running",
      resourceProfileId: "local-dev",
      resources: {
        cpu: "2 vCPU",
        memory: "4 GiB",
        storage: "host quota pending",
      },
      setup: {
        phase: "ready",
        dotfilesStatus: "unknown",
        miseStatus: "unknown",
        commandStatus: "unknown",
        packageStatus: "unknown",
      },
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
  ],
};

describe("WorkspaceDashboard", () => {
  it("renders actor, workspace, setup checks, and terminal link", () => {
    render(<WorkspaceDashboard inventory={inventory} />);

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "incus-web" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Packages")).toBeInTheDocument();
    expect(screen.getByText("mise")).toBeInTheDocument();
    expect(screen.getByText("dotfiles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /share later/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /terminal pending/i }),
    ).toBeDisabled();
  });

  it("renders an empty-access state when no workspace is visible", () => {
    render(<WorkspaceDashboard inventory={{ ...inventory, workspaces: [] }} />);

    expect(screen.getByText("No workspace access")).toBeInTheDocument();
  });
});
