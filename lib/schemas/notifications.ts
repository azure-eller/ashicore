import { z } from "zod";
import { NOTIFICATION_TYPES, SUBSCRIBABLE_EVENT_TYPES } from "@/lib/reports/constants";

export const upsertNotificationPreferenceSchema = z.object({
  eventType: z.enum(SUBSCRIBABLE_EVENT_TYPES),
  enabled: z.boolean(),
});

export const setNotificationResourceExclusionSchema = z.object({
  eventType: z.literal(NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED),
  resourceId: z.uuid(),
  excluded: z.boolean(),
});

export const registerPushDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.literal("android"),
});

export const removePushDeviceSchema = z.object({
  token: z.string().min(1).max(4096),
});
