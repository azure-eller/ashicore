import type { AppRole, DerivedAccessPresetKey, ModuleAccessMap } from "@/lib/authz";

export type TeamMemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: AppRole;
  moduleAccess: ModuleAccessMap;
  presetKey: DerivedAccessPresetKey | null;
  canManage: boolean;
  createdAt: Date;
  isCurrentUser: boolean;
};

export type PendingInviteRow = {
  id: string;
  email: string;
  moduleAccess: ModuleAccessMap;
  presetKey: DerivedAccessPresetKey;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

export type TeamPageData = {
  currentRole: AppRole;
  canGrantTeamManagement: boolean;
  members: TeamMemberRow[];
  pendingInvites: PendingInviteRow[];
};

export type AccountPageData = {
  name: string;
  email: string;
  role: AppRole;
};

export type AgentApiTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentAccessPageData = {
  tokens: AgentApiTokenRow[];
  openApiUrl: string;
  mcpServerUrl: string;
  claudeInstallUrl: string;
  chatGptBuilderUrl: string;
};

export type PublicInvitationDetails = {
  id: string;
  email: string;
  moduleAccess: ModuleAccessMap;
  presetKey: DerivedAccessPresetKey;
  status: string;
  expiresAt: Date;
  organizationId: string;
  organizationName: string;
  isExpired: boolean;
};
