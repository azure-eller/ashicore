import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  assertTeamManagementAccess,
  getAuthedMemberContext,
  requireTeamManagementAccess,
} from "@/lib/dal/auth";
import { db } from "@/lib/db";
import { invitation, member, organization, user } from "@/lib/db/schema";
import {
  AuthorizationError,
  buildAssignedRoles,
  canManageTargetRole,
  canManageTeam,
  getModuleAccessMap,
  normalizeAppRole,
} from "@/lib/authz";
import type {
  AccountPageData,
  PendingInviteRow,
  PublicInvitationDetails,
  TeamMemberRow,
  TeamPageData,
} from "./types";

const roleRank = {
  owner: 0,
  admin: 1,
  member: 2,
} as const;

function sortMembers(rows: TeamMemberRow[]) {
  return [...rows].sort((a, b) => {
    const roleDelta = roleRank[a.role] - roleRank[b.role];

    if (roleDelta !== 0) {
      return roleDelta;
    }

    return a.name.localeCompare(b.name);
  });
}

function sortInvites(rows: PendingInviteRow[]) {
  return [...rows].sort((a, b) => {
    return a.email.localeCompare(b.email);
  });
}

async function loadTeamPageData(
  orgId: string,
  currentUserId: string,
  currentAssignedRoles: string[]
): Promise<TeamPageData> {
  const memberRows = await db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(user.name));

  const inviteRows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
    .orderBy(asc(invitation.email));

  return {
    currentRole: normalizeAppRole(currentAssignedRoles),
    members: sortMembers(
      memberRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: normalizeAppRole(row.role),
        moduleAccess: getModuleAccessMap(row.role),
        canManage: canManageTargetRole(currentAssignedRoles, row.role),
        createdAt: row.createdAt,
        isCurrentUser: row.userId === currentUserId,
      }))
    ),
    pendingInvites: sortInvites(
      inviteRows.map((row) => ({
        id: row.id,
        email: row.email,
        status: row.status,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }))
    ),
  };
}

export async function getTeamPageData() {
  const context = await requireTeamManagementAccess();
  return loadTeamPageData(context.orgId, context.userId, context.assignedRoles);
}

export async function getTeamPageDataForRequest(requestHeaders: HeadersInit) {
  const context = await assertTeamManagementAccess(requestHeaders);
  return loadTeamPageData(context.orgId, context.userId, context.assignedRoles);
}

export async function getAccountPageData(): Promise<AccountPageData> {
  const context = await getAuthedMemberContext();

  return {
    name: context.name,
    email: context.email,
    role: context.role,
  };
}

export async function getPublicInvitationDetails(
  invitationId: string
): Promise<PublicInvitationDetails | null> {
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: organization.id,
      organizationName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, invitationId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    isExpired: row.expiresAt < new Date(),
  };
}

export async function ensureInvitableRole(
  requestHeaders: HeadersInit
) {
  const actor = await assertTeamManagementAccess(requestHeaders);

  if (!canManageTeam(actor.assignedRoles)) {
    throw new AuthorizationError("You do not have access to team settings.", 403);
  }

  return actor;
}

export async function getManageableMember(
  requestHeaders: HeadersInit,
  memberId: string
) {
  const actor = await assertTeamManagementAccess(requestHeaders);
  const [memberRow] = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(and(eq(member.organizationId, actor.orgId), eq(member.id, memberId)))
    .limit(1);

  if (!memberRow) {
    return null;
  }

  if (!canManageTargetRole(actor.assignedRoles, memberRow.role)) {
    throw new AuthorizationError(
      "You do not have permission to manage that member.",
      403
    );
  }

  return {
    actor,
    member: {
      id: memberRow.id,
      userId: memberRow.userId,
      role: normalizeAppRole(memberRow.role),
    },
  };
}

export async function getManageableInvitation(
  requestHeaders: HeadersInit,
  invitationId: string
) {
  const actor = await assertTeamManagementAccess(requestHeaders);
  const [inviteRow] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, actor.orgId),
        eq(invitation.id, invitationId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!inviteRow) {
    return null;
  }

  if (!canManageTargetRole(actor.assignedRoles, inviteRow.role)) {
    throw new AuthorizationError(
      "You do not have permission to manage that invitation.",
      403
    );
  }

  return {
    actor,
    invitation: {
      id: inviteRow.id,
      email: inviteRow.email,
      status: inviteRow.status,
    },
  };
}

export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "updateUser",
  payload: {
    name: string;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "changeEmail",
  payload: {
    newEmail: string;
    callbackURL?: string;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "changePassword",
  payload: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "createInvitation",
  payload: {
    email: string;
    role: string | string[];
    resend?: boolean;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "cancelInvitation",
  payload: {
    invitationId: string;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "updateMemberRole",
  payload: {
    memberId: string;
    role: string | string[];
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "removeMember",
  payload: {
    memberIdOrEmail: string;
  }
): Promise<Response>;
export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint:
    | "updateUser"
    | "changeEmail"
    | "changePassword"
    | "createInvitation"
    | "cancelInvitation"
    | "updateMemberRole"
    | "removeMember",
  payload: Record<string, unknown>
) {
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);

  switch (endpoint) {
    case "updateUser":
      return (await auth.api.updateUser({
        headers: normalizedHeaders,
        body: payload as {
          name: string;
        },
        asResponse: true,
      })) as Response;
    case "changeEmail":
      return (await auth.api.changeEmail({
        headers: normalizedHeaders,
        body: payload as {
          newEmail: string;
          callbackURL?: string;
        },
        asResponse: true,
      })) as Response;
    case "changePassword":
      return (await auth.api.changePassword({
        headers: normalizedHeaders,
        body: payload as {
          currentPassword: string;
          newPassword: string;
          revokeOtherSessions?: boolean;
        },
        asResponse: true,
      })) as Response;
    case "createInvitation":
      return (await auth.api.createInvitation({
        headers: normalizedHeaders,
        body: payload as never,
        asResponse: true,
      })) as Response;
    case "cancelInvitation":
      return (await auth.api.cancelInvitation({
        headers: normalizedHeaders,
        body: payload as {
          invitationId: string;
        },
        asResponse: true,
      })) as Response;
    case "updateMemberRole":
      return (await auth.api.updateMemberRole({
        headers: normalizedHeaders,
        body: payload as never,
        asResponse: true,
      })) as Response;
    case "removeMember":
      return (await auth.api.removeMember({
        headers: normalizedHeaders,
        body: payload as {
          memberIdOrEmail: string;
        },
        asResponse: true,
      })) as Response;
  }
}

export function buildInvitationRolePayload() {
  return buildAssignedRoles("member", {});
}
