import { z } from "zod";
import { ACCESS_PRESET_KEYS } from "@/lib/authz";

const moduleAccessLevelSchema = z.enum(["none", "read", "operate", "admin"]);

export const moduleAccessSchema = z.object({
  inventory: moduleAccessLevelSchema,
  sales: moduleAccessLevelSchema,
  manufacturing: moduleAccessLevelSchema,
  purchasing: moduleAccessLevelSchema,
  settings: moduleAccessLevelSchema,
});

export const createTeamInvitationSchema = z.object({
  email: z.email("Enter a valid email address."),
  presetKey: z.enum(ACCESS_PRESET_KEYS),
});

export const updateTeamMemberAccessSchema = z.object({
  moduleAccess: moduleAccessSchema,
});
