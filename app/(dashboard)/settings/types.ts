import type { AppRole, DerivedAccessPresetKey, ModuleAccessMap } from "@/lib/authz";
import type { BillingPlugin } from "@/lib/billing/types";

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

export type AgentMcpOAuthGrantRow = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  clientId: string;
  scopes: string[];
  lastUsedAt: string | null;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentAccessPageData = {
  tokens: AgentApiTokenRow[];
  mcpOAuthGrants: AgentMcpOAuthGrantRow[];
  openApiUrl: string;
  mcpServerUrl: string;
  claudeInstallUrl: string;
  chatGptBuilderUrl: string;
};

export type BillingPageData = {
  plan: "free" | "core";
  status: "active" | "past_due" | "canceled";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  entitlements: BillingPlugin[];
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  skuCount: number;
  skuLimit: number | null;
  canCreateSku: boolean;
  enforcementEnabled: boolean;
  billingConfigured: boolean;
  checkoutConfigured: boolean;
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
