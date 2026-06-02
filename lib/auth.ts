import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl, organization, twoFactor } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
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
import { withOrgContext } from "@/lib/db/with-org-context";
import { initializeDefaultTaxSettingsInTx } from "@/lib/tax-settings/defaults";
import { xeroSignupAuthPlugin } from "@/lib/xero/signup-auth-plugin";

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

// `allowedHosts` governs Host-header → baseURL resolution, but Better Auth plugins
// (e.g. organization/set-active) validate the request Origin against
// `trustedOrigins`. In dev/test only, trust the scheme-qualified origins that
// `pnpm boot` records (localhost + the Android emulator/device origins) so a
// device hitting the dev server passes the Origin check. Empty in production →
// `trustedOrigins` stays undefined and Better Auth's default behavior is unchanged.
const authTrustedOrigins = (() => {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    return [];
  }

  return (process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean);
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

const twoFactorOtpCleanupPlugin = (): BetterAuthPlugin => ({
  id: "ashicore-two-factor-otp-cleanup",
  hooks: {
    before: [
      {
        matcher(ctx) {
          return ctx.path === "/two-factor/send-otp";
        },
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          const otpKey = session
            ? `${session.user.id}!${session.session.id}`
            : await getTwoFactorCookieKey(ctx);

          if (!otpKey) {
            return;
          }

          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            `2fa-otp-${otpKey}`
          );
        }),
      },
    ],
  },
});

const organizationTaxDefaultsPlugin = (): BetterAuthPlugin => ({
  id: "ashicore-organization-tax-defaults",
  hooks: {
    after: [
      {
        matcher(ctx) {
          return ctx.path === "/organization/create";
        },
        handler: createAuthMiddleware(async (ctx) => {
          const createdOrganization = await getReturnedOrganization(ctx);
          if (!createdOrganization?.id) {
            return;
          }

          await withOrgContext(createdOrganization.id, (tx) =>
            initializeDefaultTaxSettingsInTx(tx, createdOrganization.id),
          );
        }),
      },
    ],
  },
});

const organizationBillingSafetyPlugin = (): BetterAuthPlugin => ({
  id: "ashicore-organization-billing-safety",
  hooks: {
    before: [
      {
        matcher(ctx) {
          return ctx.path === "/organization/delete";
        },
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { organizationId?: unknown } | undefined;
          const organizationId =
            typeof body?.organizationId === "string" ? body.organizationId : null;

          if (!organizationId) {
            throw new APIError("BAD_REQUEST", {
              message: "organizationId is required.",
            });
          }

          const [org] = await db
            .select({
              plan: schema.organization.plan,
              status: schema.organization.status,
            })
            .from(schema.organization)
            .where(eq(schema.organization.id, organizationId))
            .limit(1);

          if (org?.plan === "core" && org.status !== "canceled") {
            throw new APIError("BAD_REQUEST", {
              message:
                "Cancel the organization's billing subscription before deleting this organization.",
            });
          }
        }),
      },
    ],
  },
});

const mfaGraceSignInPlugin = (): BetterAuthPlugin => ({
  id: "ashicore-mfa-grace-sign-in",
  hooks: {
    after: [
      {
        matcher(ctx) {
          return ctx.path === "/sign-in/email";
        },
        handler: createAuthMiddleware(async (ctx) => {
          const userId = await getReturnedAuthUserId(ctx);
          if (!userId) {
            return;
          }

          await db
            .update(schema.user)
            .set({ mfaGraceUsed: true })
            .where(eq(schema.user.id, userId));
        }),
      },
    ],
  },
});

async function getReturnedOrganization(ctx: AuthMiddlewareContext) {
  const returned = ctx.context.returned;
  if (!returned) {
    return null;
  }

  if (returned instanceof Response) {
    if (!returned.ok) {
      return null;
    }

    return parseOrganizationResponse(await returned.clone().json());
  }

  return parseOrganizationResponse(returned);
}

async function getReturnedAuthUserId(ctx: AuthMiddlewareContext) {
  const returned = ctx.context.returned;
  if (!returned) {
    return null;
  }

  if (returned instanceof Response) {
    if (!returned.ok) {
      return null;
    }

    return parseAuthUserId(await returned.clone().json());
  }

  return parseAuthUserId(returned);
}

function parseOrganizationResponse(value: unknown): { id: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as { id?: unknown; organization?: { id?: unknown } };
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.organization?.id === "string"
        ? record.organization.id
        : null;

  return id ? { id } : null;
}

function parseAuthUserId(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as { user?: { id?: unknown }; id?: unknown };
  const id =
    typeof record.user?.id === "string"
      ? record.user.id
      : typeof record.id === "string"
        ? record.id
        : null;

  return id;
}

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

async function getTwoFactorCookieKey(ctx: AuthMiddlewareContext) {
  const twoFactorCookie = ctx.context.createAuthCookie("two_factor");
  return ctx.getSignedCookie(twoFactorCookie.name, ctx.context.secret);
}

export const auth = betterAuth({
  appName: "Ashicore",
  baseURL: {
    allowedHosts: authAllowedHosts,
    fallback: authFallbackUrl,
  },
  trustedOrigins: authTrustedOrigins.length > 0 ? authTrustedOrigins : undefined,
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
    organizationBillingSafetyPlugin(),
    organizationTaxDefaultsPlugin(),
    mfaGraceSignInPlugin(),
    twoFactorOtpCleanupPlugin(),
    twoFactor({
      issuer: "Ashicore",
      otpOptions: {
        storeOTP: "hashed",
        async sendOTP({ user, otp }) {
          if (!user.email) {
            return;
          }

          const { sendMfaCodeEmail } = await import("@/lib/email/auth-emails");
          await sendMfaCodeEmail({
            email: user.email,
            code: otp,
          });
        },
      },
      // RFC6265bis caps cookie Max-Age at 400 days.
      trustDeviceMaxAge: 60 * 60 * 24 * 400,
      twoFactorCookieMaxAge: 60 * 60 * 24,
    }),
    organization({
      ac: organizationAc,
      creatorRole: "owner",
      roles: organizationRoles,
      sendInvitationEmail: async (data) => {
        const { sendTeamInvitationEmail } = await import("@/lib/email/team-invites");
        await sendTeamInvitationEmail({
          invitationId: data.id,
          email: data.email,
          organizationName: data.organization.name,
        });
      },
    }),
    xeroSignupAuthPlugin(),
    nextCookies(),
  ],
});

export const authModuleInitMs = performance.now() - authModuleInitStartedAt;
export const authModuleAgeMs = () => Date.now() - authModuleLoadedAt;
