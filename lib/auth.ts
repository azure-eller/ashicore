import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { sendTeamInvitationEmail } from "@/lib/email/team-invites";

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
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : "http://localhost:3000"),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
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
      sendInvitationEmail: async (data, request) => {
        await sendTeamInvitationEmail({
          invitationId: data.id,
          email: data.email,
          role: data.role,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name ?? null,
          request,
        });
      },
    }),
    nextCookies(),
  ],
});
