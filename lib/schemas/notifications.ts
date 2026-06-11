import { z } from "zod";
import { SUBSCRIBABLE_EVENT_TYPES } from "@/lib/reports/constants";

export const upsertNotificationPreferenceSchema = z.object({
  eventType: z.enum(SUBSCRIBABLE_EVENT_TYPES),
  enabled: z.boolean(),
});

export const registerPushDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.literal("android"),
});

export const removePushDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
});
