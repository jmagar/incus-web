import { headers } from "next/headers";

import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import {
  AuthenticationRequiredError,
  getActorFromHeaders,
} from "@/lib/auth/identity";
import { getWorkspaceInventory } from "@/lib/workspaces/provisioner";

export default async function Home() {
  let actor;
  try {
    actor = getActorFromHeaders(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return (
        <main className="min-h-screen bg-[var(--aurora-page-bg)] px-6 py-10 text-[var(--aurora-text-primary)]">
          <div className="mx-auto max-w-3xl rounded-[var(--aurora-radius-2)] border border-[var(--aurora-border-default)] bg-[var(--aurora-panel-medium)] p-6">
            <p className="aurora-text-eyebrow text-[var(--aurora-accent-primary)]">
              Authentication required
            </p>
            <h1 className="aurora-text-section mt-3">Workspace unavailable</h1>
            <p className="aurora-text-body mt-3 text-[var(--aurora-text-muted)]">
              incus-web did not receive trusted identity headers from the
              authentication proxy.
            </p>
          </div>
        </main>
      );
    }
    throw error;
  }
  const inventory = await getWorkspaceInventory(actor);

  return <WorkspaceDashboard inventory={inventory} />;
}
