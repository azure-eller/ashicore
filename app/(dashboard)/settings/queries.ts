import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  assertTeamManagementAccess,
  requireTeamManagementAccess,
} from "@/lib/dal/auth";
import { db } from "@/lib/db";
import { invitation, member, organization, user } from "@/lib/db/schema";
import {
  AuthorizationError,
  canAssignRole,
  canManageTargetRole,
  normalizeAppRole,
  normalizeAssignableRole,
} from "@/lib/authz";
import type {
  PendingInviteRow,
  PublicInvitationDetails,
  TeamMemberRow,
  TeamPageData,
} from "./types";

type OrganizationRole = "owner" | "admin" | "operator" | "viewer";

const roleRank = {
  owner: 0,
  admin: 1,
  operator: 2,
  viewer: 3,
  member: 4,
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
    const roleDelta = roleRank[a.role] - roleRank[b.role];

    if (roleDelta !== 0) {
      return roleDelta;
    }

    return a.email.localeCompare(b.email);
  });
}

async function loadTeamPageData(
  orgId: string,
  currentUserId: string,
  currentRole: TeamPageData["currentRole"]
): Promise<TeamPageData> {
  const [orgRow] = await db
    .select({
      id: organization.id,
      name: organization.name,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!orgRow) {
    throw new AuthorizationError("Organization not found.", 404);
  }

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
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
    .orderBy(asc(invitation.email));

  return {
    organization: orgRow,
    currentRole,
    members: sortMembers(
      memberRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: normalizeAppRole(row.role),
        createdAt: row.createdAt,
        isCurrentUser: row.userId === currentUserId,
      }))
    ),
    pendingInvites: sortInvites(
      inviteRows.map((row) => ({
        id: row.id,
        email: row.email,
        role: normalizeAppRole(row.role),
        status: row.status,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }))
    ),
  };
}

export async function getTeamPageData() {
  const context = await requireTeamManagementAccess();
  return loadTeamPageData(context.orgId, context.userId, context.role);
}

export async function getTeamPageDataForRequest(requestHeaders: HeadersInit) {
  const context = await assertTeamManagementAccess(requestHeaders);
  return loadTeamPageData(context.orgId, context.userId, context.role);
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
    role: normalizeAppRole(row.role),
    status: row.status,
    expiresAt: row.expiresAt,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    isExpired: row.expiresAt < new Date(),
  };
}

export async function ensureInvitableRole(
  requestHeaders: HeadersInit,
  role: string
) {
  const actor = await assertTeamManagementAccess(requestHeaders);
  const normalizedRole = normalizeAssignableRole(role);

  if (!normalizedRole) {
    throw new AuthorizationError("Invalid role.", 400);
  }

  if (!canAssignRole(actor.role, normalizedRole)) {
    throw new AuthorizationError(
      "You do not have permission to assign that role.",
      403
    );
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

  if (!canManageTargetRole(actor.role, memberRow.role)) {
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
        eq(invitation.status, "pending")
      )
    )
    .limit(1);

  if (!inviteRow) {
    return null;
  }

  if (!canManageTargetRole(actor.role, inviteRow.role)) {
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
      role: normalizeAppRole(inviteRow.role),
      status: inviteRow.status,
    },
  };
}

export async function callAuthApi(
  requestHeaders: HeadersInit,
  endpoint: "createInvitation",
  payload: {
    email: string;
    role: string;
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
    role: string;
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
    | "createInvitation"
    | "cancelInvitation"
    | "updateMemberRole"
    | "removeMember",
  payload: Record<string, unknown>
) {
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);

  switch (endpoint) {
    case "createInvitation":
      return (await auth.api.createInvitation({
        headers: normalizedHeaders,
        body: payload as {
          email: string;
          role: OrganizationRole;
          resend?: boolean;
        },
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
        body: payload as {
          memberId: string;
          role: OrganizationRole | OrganizationRole[];
        },
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
