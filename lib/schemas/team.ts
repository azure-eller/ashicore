import { z } from "zod";

export const teamRoleSchema = z.enum(["admin", "operator", "viewer"]);

export const createTeamInvitationSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: teamRoleSchema,
});

export const updateTeamMemberRoleSchema = z.object({
  role: teamRoleSchema,
});
