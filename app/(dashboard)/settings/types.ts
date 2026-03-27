import type { AppRole } from "@/lib/authz";

export type TeamMemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: AppRole;
  createdAt: Date;
  isCurrentUser: boolean;
};

export type PendingInviteRow = {
  id: string;
  email: string;
  role: AppRole;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

export type TeamPageData = {
  organization: {
    id: string;
    name: string;
  };
  currentRole: AppRole;
  members: TeamMemberRow[];
  pendingInvites: PendingInviteRow[];
};

export type PublicInvitationDetails = {
  id: string;
  email: string;
  role: AppRole;
  status: string;
  expiresAt: Date;
  organizationId: string;
  organizationName: string;
  isExpired: boolean;
};
