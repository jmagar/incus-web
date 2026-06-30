export type UserId = string;
export type WorkspaceId = string;
export type ResourceProfileId = string;

export type ActorContext = {
  userId: UserId;
  oidcSubject: string;
  email: string;
  displayName?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

export type WorkspaceState =
  | "creating"
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "restarting"
  | "setting_up"
  | "degraded"
  | "deleting"
  | "deleted"
  | "failed";

export type CheckStatus = "ok" | "warn" | "missing" | "unknown";

export type SetupPhase =
  | "not_configured"
  | "queued"
  | "installing_mise"
  | "applying_dotfiles"
  | "checking_tools"
  | "ready"
  | "failed";

export type WorkspaceSetupSummary = {
  phase: SetupPhase;
  dotfilesRepo?: string;
  dotfilesStatus: CheckStatus;
  miseStatus: CheckStatus;
  commandStatus: CheckStatus;
  packageStatus: CheckStatus;
  lastLogExcerpt?: string;
  updatedAt?: string;
};

export type WorkspaceResources = {
  cpu: string;
  memory: string;
  storage: string;
};

export type Workspace = {
  id: WorkspaceId;
  ownerUserId: UserId;
  name: string;
  slug: string;
  incusProject: string;
  incusContainer: string;
  templateVersion: string;
  state: WorkspaceState;
  resourceProfileId: ResourceProfileId;
  resources: WorkspaceResources;
  setup: WorkspaceSetupSummary;
  terminalUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInventory = {
  actor: ActorContext;
  workspaces: Workspace[];
};
