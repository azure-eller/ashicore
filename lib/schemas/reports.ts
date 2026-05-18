import { z } from "zod";
import { isValidIsoDate } from "@/lib/schemas/shared";
import { isValidTimeZone } from "@/lib/time-zone";
import { dailyManufacturingGraphColors } from "@/lib/reports/daily-manufacturing-config";

const graphColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value");

export const dailyManufacturingProductTypeGraphSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1, "Graph label is required").max(80),
  unitName: z.string().trim().min(1, "Unit is required").max(80),
  productTextIncludes: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .transform((value) => value || null),
  color: graphColorSchema.default(dailyManufacturingGraphColors[0]),
});

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
  productTypeGraphs: z.array(dailyManufacturingProductTypeGraphSchema).max(6).default([]),
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
