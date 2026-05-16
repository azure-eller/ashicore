import { z } from "zod";
import { isValidIsoDate } from "@/lib/schemas/shared";
import { isValidTimeZone } from "@/lib/time-zone";

export const updateDailyManufacturingReportScheduleSchema = z.object({
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  localSendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Send time must be HH:mm"),
  timeZone: z
    .string()
    .trim()
    .refine(isValidTimeZone, "Time zone must be a valid IANA time zone"),
  recipientUserIds: z.array(z.string()).default([]),
});

export type UpdateDailyManufacturingReportScheduleInput = z.infer<
  typeof updateDailyManufacturingReportScheduleSchema
>;

export const manualSendDailyManufacturingReportSchema = z.object({
  reportDate: z
    .string()
    .refine(isValidIsoDate, "Report date must be a real date in YYYY-MM-DD format"),
  recipientUserIds: z.array(z.string()).default([]),
});

export type ManualSendDailyManufacturingReportInput = z.infer<
  typeof manualSendDailyManufacturingReportSchema
>;
