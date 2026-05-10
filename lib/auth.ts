import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APP_DOMAIN, APP_URL } from "@/lib/app-brand";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  buildMatrixRole,
  getModulePermissionActions,
  MATRIX_SENTINEL_ROLE,
  MODULE_KEYS,
  type MatrixModuleRole,
} from "@/lib/authz";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const authModuleInitStartedAt = performance.now();
const authModuleLoadedAt = Date.now();

const authFallbackUrl = getCanonicalAppUrl();

const authAllowedHosts = (() => {
  const hosts = new Set([
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
    "[::1]",
    "[::1]:*",
    APP_DOMAIN,
  ]);

  for (const url of [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (!url) {
      continue;
    }

    try {
      hosts.add(new URL(url.startsWith("http") ? url : `https://${url}`).host);
    } catch {
      // Better Auth will raise on an invalid fallback URL later.
    }
  }

  if (process.env.VERCEL_ENV === "preview") {
    hosts.add("*.vercel.app");
  }

  for (const host of process.env.BETTER_AUTH_ALLOWED_HOSTS?.split(",") ?? []) {
    const trimmedHost = host.trim();

    if (trimmedHost) {
      hosts.add(trimmedHost);
    }
  }

  return Array.from(hosts);
})();

export const organizationAc = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
  inventory: ["read", "operate", "admin"],
  sales: ["read", "operate", "admin"],
  manufacturing: ["read", "operate", "admin"],
  purchasing: ["read", "operate", "admin"],
  settings: ["read", "operate", "admin"],
});

const ownerOrgRole = organizationAc.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
});

const adminOrgRole = organizationAc.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
});

const memberOrgRole = organizationAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
});

const matrixSentinelRole = organizationAc.newRole({
  ac: ["read"],
});

function createModuleAccessRole(role: MatrixModuleRole) {
  const [module, level] = role.split(":") as [
    (typeof MODULE_KEYS)[number],
    "read" | "operate" | "admin",
  ];
  const actions = getModulePermissionActions(level);

  switch (module) {
    case "inventory":
      return organizationAc.newRole({ inventory: actions });
    case "sales":
      return organizationAc.newRole({ sales: actions });
    case "manufacturing":
      return organizationAc.newRole({ manufacturing: actions });
    case "purchasing":
      return organizationAc.newRole({ purchasing: actions });
    case "settings":
      if (level === "admin") {
        return organizationAc.newRole({
          member: ["create", "update", "delete"],
          invitation: ["create", "cancel"],
          team: ["create", "update", "delete"],
          ac: ["read"],
          settings: actions,
        });
      }

      return organizationAc.newRole({ settings: actions });
  }
}

export const matrixRoles = Object.fromEntries(
  MODULE_KEYS.flatMap((module) =>
    (["read", "operate", "admin"] as const).map((level) => {
      const role = buildMatrixRole(module, level);
      return [role, createModuleAccessRole(role)];
    })
  )
);

export const organizationRoles = {
  owner: ownerOrgRole,
  admin: adminOrgRole,
  member: memberOrgRole,
  [MATRIX_SENTINEL_ROLE]: matrixSentinelRole,
  ...matrixRoles,
};

export const auth = betterAuth({
  baseURL: {
    allowedHosts: authAllowedHosts,
    fallback: authFallbackUrl,
  },
  rateLimit:
    process.env.BETTER_AUTH_RATE_LIMIT_DISABLED === "1"
      ? { enabled: false }
      : undefined,
  advanced: {
    useSecureCookies: authFallbackUrl.startsWith("https://"),
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const { sendPasswordResetEmail } = await import("@/lib/email/auth-emails");
      await sendPasswordResetEmail({
        email: user.email,
        url,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { sendAccountEmailVerificationEmail } = await import("@/lib/email/auth-emails");
      await sendAccountEmailVerificationEmail({
        email: user.email,
        url,
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
    },
  },
  plugins: [
    organization({
      ac: organizationAc,
      creatorRole: "owner",
      roles: organizationRoles,
      sendInvitationEmail: async (data) => {
        const { sendTeamInvitationEmail } = await import("@/lib/email/team-invites");
        await sendTeamInvitationEmail({
          invitationId: data.id,
          email: data.email,
          role: data.role,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name ?? null,
        });
      },
    }),
    nextCookies(),
  ],
});

export const authModuleInitMs = performance.now() - authModuleInitStartedAt;
export const authModuleAgeMs = () => Date.now() - authModuleLoadedAt;
