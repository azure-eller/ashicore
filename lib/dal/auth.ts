import "server-only";

import { cache } from "react";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  AuthorizationError,
  canManageLockedBom,
  canManageTeam,
  canViewLockedBom,
  canViewUnlockedBom,
  getDefaultDashboardPath,
  hasModuleAccess,
  normalizeAppRole,
  type AppRole,
  type ModuleAccessLevel,
  type ModuleKey,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { invitation, member, organization } from "@/lib/db/schema";
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

  return {
    session,
    context: await resolveMemberContext(normalizedHeaders, session),
  };
});

export async function getAuthedMemberContext(): Promise<MemberContext> {
  const { session, context } = await getRequestAuthState();

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
  const context = await resolveMemberContext(requestHeaders);

  if (context) {
    return context;
  }

  const session = await auth.api.getSession({
    headers: requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders),
  });

  if (!session) {
    throw new AuthorizationError("Authentication required.", 401);
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
