import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { sendAccountEmailVerificationEmail, sendPasswordResetEmail } from "@/lib/email/auth-emails";
import { sendTeamInvitationEmail } from "@/lib/email/team-invites";

const authFallbackUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.PORT ? `http://localhost:${process.env.PORT}` : "http://localhost:3000");

const authAllowedHosts = (() => {
  const hosts = new Set([
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
    "[::1]",
    "[::1]:*",
  ]);

  for (const url of [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!url) {
      continue;
    }

    try {
      hosts.add(new URL(url).host);
    } catch {
      // Better Auth will raise on an invalid fallback URL later.
    }
  }

  for (const host of process.env.BETTER_AUTH_ALLOWED_HOSTS?.split(",") ?? []) {
    const trimmedHost = host.trim();

    if (trimmedHost) {
      hosts.add(trimmedHost);
    }
  }

  return Array.from(hosts);
})();

const organizationAc = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
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

const passiveOrgRole = organizationAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
});

export const auth = betterAuth({
  baseURL: {
    allowedHosts: authAllowedHosts,
    fallback: authFallbackUrl,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({
        email: user.email,
        url,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
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
      roles: {
        owner: ownerOrgRole,
        admin: adminOrgRole,
        operator: passiveOrgRole,
        viewer: passiveOrgRole,
      },
      sendInvitationEmail: async (data) => {
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
