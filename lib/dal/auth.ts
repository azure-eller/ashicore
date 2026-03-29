import "server-only";

import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  AuthorizationError,
  canManageTeam,
  canReadModule,
  canWriteModule,
  getDefaultDashboardPath,
  normalizeAppRole,
  type AppRole,
  type ModuleKey,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { member } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";

type MemberContext = {
  userId: string;
  orgId: string;
  memberId: string;
  organizationName: string;
  role: AppRole;
  name: string;
  email: string;
  avatar: string | undefined;
};

async function resolveMemberContext(requestHeaders: HeadersInit) {
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
  const session = await auth.api.getSession({
    headers: normalizedHeaders,
  });

  if (!session || !session.session.activeOrganizationId) {
    return null;
  }

  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, session.session.activeOrganizationId),
      eq(member.userId, session.user.id)
    ),
    with: {
      organization: {
        columns: {
          name: true,
        },
      },
    },
  });

  if (!membership || !membership.organization) {
    return null;
  }

  return {
    userId: session.user.id,
    orgId: session.session.activeOrganizationId,
    memberId: membership.id,
    organizationName: membership.organization.name,
    role: normalizeAppRole(membership.role),
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    avatar: session.user.image ?? undefined,
  } satisfies MemberContext;
}

const getRequestAuthState = cache(async () => {
  const requestHeaders = await headers();
  const normalizedHeaders =
    requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders);
  const session = await auth.api.getSession({
    headers: normalizedHeaders,
  });

  if (!session || !session.session.activeOrganizationId) {
    return {
      session,
      context: null as MemberContext | null,
    };
  }

  return {
    session,
    context: await resolveMemberContext(normalizedHeaders),
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
  const context = await getAuthedMemberContext();

  if (!canReadModule(context.role, module)) {
    redirect(getDefaultDashboardPath(context.role));
  }

  return context;
}

export async function requireModuleWriteAccess(module: ModuleKey) {
  const context = await getAuthedMemberContext();

  if (!canWriteModule(context.role, module)) {
    redirect(getDefaultDashboardPath(context.role));
  }

  return context;
}

export async function requireTeamManagementAccess() {
  const context = await requireModuleReadAccess("settings");

  if (!canManageTeam(context.role)) {
    redirect(getDefaultDashboardPath(context.role));
  }

  return context;
}

export async function assertModuleReadAccess(
  module: ModuleKey,
  requestHeaders: HeadersInit
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!canReadModule(context.role, module)) {
    throw new AuthorizationError(`You do not have access to ${module}.`, 403);
  }

  return context;
}

export async function assertModuleWriteAccess(
  module: ModuleKey,
  requestHeaders: HeadersInit
) {
  const context = await getAuthedApiMemberContext(requestHeaders);

  if (!canWriteModule(context.role, module)) {
    throw new AuthorizationError(
      `You do not have permission to update ${module}.`,
      403
    );
  }

  return context;
}

export async function assertTeamManagementAccess(requestHeaders: HeadersInit) {
  const context = await assertModuleReadAccess("settings", requestHeaders);

  if (!canManageTeam(context.role)) {
    throw new AuthorizationError("You do not have access to team settings.", 403);
  }

  return context;
}

export async function withAuthedOrgContext<T>(
  callback: (tx: Tx, orgId: string, userId: string) => Promise<T>
): Promise<T> {
  const { orgId, userId } = await getAuthedContext();
  return withOrgContext(orgId, (tx) => callback(tx, orgId, userId));
}
