import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  AuthorizationError,
  buildPresetAssignedRoles,
  canAssignModuleAccess,
  canGrantTeamManagement,
  canManageLockedBom,
  canManageTeam,
  canManageTargetRole,
  canViewLockedBom,
  canViewUnlockedBom,
  getDerivedAccessPresetKey,
  getModuleAccessMap,
  getDefaultDashboardPath,
  hasModuleAccess,
  normalizeAppRole,
  type AppRole,
  type DerivedAccessPresetKey,
  type ModuleAccessLevel,
  type ModuleAccessMap,
  type ModuleKey,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { invitation, member, organization, user } from "@/lib/db/schema";
import { measureObservedOperation } from "@/lib/observability/request-log";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";

type MemberContext = {
  userId: string;
  orgId: string;
  memberId: string;
  organizationName: string;
  organizationTimeZone: string;
  role: AppRole;
  assignedRoles: string[];
  name: string;
  email: string;
  avatar: string | undefined;
};

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

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

export function isMfaDisabledForDevOrTest(): boolean {
  return (
    process.env.AUTH_MFA_DISABLED === "1" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
  );
}

export function isMfaEnrolled(session: AuthSession): boolean {
  if (isMfaDisabledForDevOrTest()) {
    return true;
  }

  return Boolean(
    session &&
      (session.user as typeof session.user & { twoFactorEnabled?: boolean | null })
        .twoFactorEnabled
  );
}

export async function isMfaRequiredForSession(session: AuthSession): Promise<boolean> {
  if (!session || isMfaDisabledForDevOrTest() || isMfaEnrolled(session)) {
    return false;
  }

  const [row] = await db
    .select({ mfaGraceUsed: user.mfaGraceUsed })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  return row?.mfaGraceUsed ?? true;
}

async function resolveMemberContext(
  requestHeaders: HeadersInit,
  existingSession?: AuthSession
) {
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
  const session =
    existingSession ??
    (await measureObservedOperation(
      "auth.get_session",
      () =>
        auth.api.getSession({
          headers: normalizedHeaders,
        }),
      {
        headers: normalizedHeaders,
        successData: (resolvedSession) => ({
          hasSession: Boolean(resolvedSession),
          hasActiveOrganization: Boolean(resolvedSession?.session.activeOrganizationId),
        }),
      }
    ));

  if (!session || !session.session.activeOrganizationId) {
    return null;
  }

  const activeOrganizationId = session.session.activeOrganizationId;

  const membership = await measureObservedOperation(
    "auth.load_membership",
    () =>
      db.query.member.findFirst({
        where: and(
          eq(member.organizationId, activeOrganizationId),
          eq(member.userId, session.user.id)
        ),
        with: {
          organization: {
            columns: {
              name: true,
              timeZone: true,
              metadata: true,
            },
          },
        },
      }),
    {
      headers: normalizedHeaders,
      successData: (resolvedMembership) => ({
        foundMembership: Boolean(resolvedMembership?.organization),
      }),
    }
  );

  if (!membership || !membership.organization) {
    return null;
  }

  return {
    userId: session.user.id,
    orgId: activeOrganizationId,
    memberId: membership.id,
    organizationName: membership.organization.name,
    organizationTimeZone: membership.organization.timeZone,
    role: normalizeAppRole(membership.role),
    assignedRoles: membership.role.split(",").map((value) => value.trim()).filter(Boolean),
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    avatar: session.user.image ?? undefined,
  } satisfies MemberContext;
}

const getRequestAuthState = cache(async () => {
  const requestHeaders = await headers();
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
  const session = await measureObservedOperation(
    "auth.get_session",
    () =>
      auth.api.getSession({
        headers: normalizedHeaders,
      }),
    {
      headers: normalizedHeaders,
      successData: (resolvedSession) => ({
        hasSession: Boolean(resolvedSession),
        hasActiveOrganization: Boolean(resolvedSession?.session.activeOrganizationId),
      }),
    }
  );

  if (!session || !session.session.activeOrganizationId) {
    return {
      session,
      context: null as MemberContext | null,
    };
  }

  if (await isMfaRequiredForSession(session)) {
    return {
      session,
      context: null as MemberContext | null,
    };
  }

  return {
    session,
    context: await resolveMemberContext(normalizedHeaders, session),
  };
});

export async function getAuthedMemberContext(): Promise<MemberContext> {
  const { session, context } = await getRequestAuthState();

  if (session && (await isMfaRequiredForSession(session))) {
    redirect("/mfa-setup");
  }

  if (!context) {
    if (!session) {
      redirect("/sign-in");
    }

    redirect("/org-setup");
  }

  return context;
}

export async function getAuthedContext() {
  const { orgId, userId } = await getAuthedMemberContext();
  return { orgId, userId };
}

export async function getAuthedOrganizations() {
  const { session } = await getRequestAuthState();

  if (!session) {
    return [];
  }

  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(organization.name), asc(organization.slug));
}

export async function getPendingInvitationForEmail(email: string) {
  const [row] = await db
    .select({
      id: invitation.id,
    })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.toLowerCase()),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
    .orderBy(desc(invitation.createdAt))
    .limit(1);

  return row ?? null;
}

export async function getAuthedApiMemberContext(
  requestHeaders: HeadersInit
): Promise<MemberContext> {
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
  const session = await auth.api.getSession({
    headers: normalizedHeaders,
  });

  if (!session) {
    throw new AuthorizationError("Authentication required.", 401);
  }

  if (await isMfaRequiredForSession(session)) {
    throw new AuthorizationError("Multi-factor authentication setup required.", 403);
  }

  const context = await resolveMemberContext(normalizedHeaders, session);

  if (context) {
    return context;
  }

  throw new AuthorizationError("Active organization required.", 403);
}

export async function requireModuleReadAccess(module: ModuleKey) {
  return requireModuleAccess(module, "read");
}

export async function requireModuleWriteAccess(module: ModuleKey) {
  return requireModuleAccess(module, "operate");
}

export async function requireModuleAccess(
  module: ModuleKey,
  level: Exclude<ModuleAccessLevel, "none">
) {
  const context = await getAuthedMemberContext();

  if (!hasModuleAccess(context.assignedRoles, module, level)) {
    redirect(getDefaultDashboardPath(context.assignedRoles));
  }

  return context;
}

export async function requireTeamManagementAccess() {
  const context = await getAuthedMemberContext();

  if (!canManageTeam(context.assignedRoles)) {
    redirect(getDefaultDashboardPath(context.assignedRoles));
  }

  return context;
}

export async function assertModuleReadAccess(
  module: ModuleKey,
  requestHeaders: HeadersInit
) {
  return assertModuleAccess(module, "read", requestHeaders);
}

export async function assertModuleWriteAccess(
  module: ModuleKey,
  requestHeaders: HeadersInit
) {
  return assertModuleAccess(module, "operate", requestHeaders);
}

export async function assertModuleAccess(
  module: ModuleKey,
  level: Exclude<ModuleAccessLevel, "none">,
  requestHeaders: HeadersInit
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!hasModuleAccess(context.assignedRoles, module, level)) {
    throw new AuthorizationError(
      level === "read"
        ? `You do not have access to ${module}.`
        : `You do not have permission to ${level === "admin" ? "administer" : "update"} ${module}.`,
      403
    );
  }

  return context;
}

export async function assertTeamManagementAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!canManageTeam(context.assignedRoles)) {
    throw new AuthorizationError("You do not have access to team settings.", 403);
  }

  return context;
}

export async function getAccountPageData(): Promise<AccountPageData> {
  const context = await getAuthedMemberContext();

  return {
    name: context.name,
    email: context.email,
    role: context.role,
  };
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
    canGrantTeamManagement: canGrantTeamManagement(currentAssignedRoles),
    members: sortMembers(
      memberRows.map((row) => {
        const moduleAccess = getModuleAccessMap(row.role);
        const normalizedRole = normalizeAppRole(row.role);

        return {
          id: row.id,
          userId: row.userId,
          name: row.name,
          email: row.email,
          role: normalizedRole,
          moduleAccess,
          presetKey: normalizedRole === "owner" ? null : getDerivedAccessPresetKey(moduleAccess),
          canManage: canManageTargetRole(currentAssignedRoles, row.role),
          createdAt: row.createdAt,
          isCurrentUser: row.userId === currentUserId,
        };
      })
    ),
    pendingInvites: sortInvites(
      inviteRows.map((row) => {
        const moduleAccess = getModuleAccessMap(row.role);

        return {
          id: row.id,
          email: row.email,
          moduleAccess,
          presetKey: getDerivedAccessPresetKey(moduleAccess),
          status: row.status,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        };
      })
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

  const moduleAccess = getModuleAccessMap(row.role);

  return {
    id: row.id,
    email: row.email,
    moduleAccess,
    presetKey: getDerivedAccessPresetKey(moduleAccess),
    status: row.status,
    expiresAt: row.expiresAt,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    isExpired: row.expiresAt < new Date(),
  };
}

export async function ensureInvitableRole(requestHeaders: HeadersInit) {
  const actor = await assertTeamManagementAccess(requestHeaders);

  if (!canManageTeam(actor.assignedRoles)) {
    throw new AuthorizationError("You do not have access to team settings.", 403);
  }

  return actor;
}

export function buildInvitationRolePayload(
  presetKey: Parameters<typeof buildPresetAssignedRoles>[0]
) {
  return buildPresetAssignedRoles(presetKey);
}

export function assertAssignableModuleAccess(
  actorRole: string | string[] | null | undefined,
  moduleAccess: Parameters<typeof canAssignModuleAccess>[1]
) {
  if (!canAssignModuleAccess(actorRole, moduleAccess)) {
    throw new AuthorizationError("Only owners can grant team management access.", 403);
  }
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
      role: inviteRow.role,
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

export async function requireBomViewAccess(bomLocked: boolean) {
  const context = await getAuthedMemberContext();

  const allowed = bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);

  if (!allowed) {
    redirect(getDefaultDashboardPath(context.assignedRoles));
  }

  return context;
}

export async function assertBomViewAccess(
  requestHeaders: HeadersInit,
  bomLocked: boolean
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  const allowed = bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);

  if (!allowed) {
    throw new AuthorizationError("You do not have permission to view this BOM.", 403);
  }

  return context;
}

export async function assertLockedBomManagementAccess(requestHeaders: HeadersInit) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!canManageLockedBom(context.assignedRoles)) {
    throw new AuthorizationError("You do not have permission to manage locked recipes.", 403);
  }

  return context;
}

export async function withAuthedOrgContext<T>(
  callback: (tx: Tx, orgId: string, userId: string) => Promise<T>
): Promise<T> {
  const { orgId, userId } = await getAuthedContext();
  const requestHeaders = await headers();

  return withOrgContext(
    orgId,
    (tx) => callback(tx, orgId, userId),
    {
      setOrgContext: (setOrgContext) =>
        measureObservedOperation("db.set_org_context", setOrgContext, {
          headers: requestHeaders,
          extra: {
            hasOrgId: Boolean(orgId),
          },
        }),
    }
  );
}
