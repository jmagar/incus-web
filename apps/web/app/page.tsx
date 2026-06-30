import { headers } from "next/headers";

import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import { getActorFromHeaders } from "@/lib/auth/identity";
import { getWorkspaceInventory } from "@/lib/workspaces/provisioner";

export default async function Home() {
  const actor = getActorFromHeaders(await headers());
  const inventory = await getWorkspaceInventory(actor);

  return <WorkspaceDashboard inventory={inventory} />;
}
