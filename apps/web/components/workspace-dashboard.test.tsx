import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      templateVersion: "ubuntu-24.04-code-v1",
      state: "running",
      resourceProfileId: "local-dev",
      resources: {
        cpu: "2 vCPU",
        memory: "96 MiB / 4 GiB",
        storage: "5 GiB / 20 GiB",
      },
      setup: {
        phase: "ready",
        dotfilesStatus: "ok",
        miseStatus: "ok",
        commandStatus: "ok",
        packageStatus: "ok",
      },
      terminalUrl: "/terminal/",
      accessNote:
        "Private workspace. Sharing requires an explicit user or org grant.",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
  ],
};

describe("WorkspaceDashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders actor, workspace, setup completion, and terminal link", () => {
    render(<WorkspaceDashboard inventory={inventory} />);

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "incus-web" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Setup: complete", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Commands")).not.toBeInTheDocument();
    expect(screen.queryByText("Packages")).not.toBeInTheDocument();
    expect(screen.queryByText("mise")).not.toBeInTheDocument();
    expect(screen.getAllByText("Dotfiles")).toHaveLength(2);
    expect(screen.getByText("ubuntu-24.04-code-v1")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Private workspace. Sharing requires an explicit user or org grant.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /stop/i })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /open terminal/i }),
    ).toHaveAttribute("href", "/terminal/");
  });

  it("dismisses ready setup for the current container", () => {
    render(<WorkspaceDashboard inventory={inventory} />);

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss setup complete/i }),
    );

    expect(
      screen.queryByText("Setup: complete", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("shows setup details while provisioning is not complete", () => {
    render(
      <WorkspaceDashboard
        inventory={{
          ...inventory,
          workspaces: [
            {
              ...inventory.workspaces[0],
              setup: {
                ...inventory.workspaces[0].setup,
                phase: "checking_tools",
                commandStatus: "ok",
                packageStatus: "warn",
                miseStatus: "ok",
              },
            },
          ],
        }}
      />,
    );

    expect(
      screen.queryByText("Setup: complete", { selector: "p" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Setup" })).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Packages")).toBeInTheDocument();
    expect(screen.getByText("mise")).toBeInTheDocument();
  });

  it("renders an empty-access state when no workspace is visible", () => {
    render(<WorkspaceDashboard inventory={{ ...inventory, workspaces: [] }} />);

    expect(screen.getByText("No workspace access")).toBeInTheDocument();
  });
});
