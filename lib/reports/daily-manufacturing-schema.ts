import { z } from "zod";
import { DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION } from "./constants";

const quantitySummarySchema = z.object({
  unit: z.string(),
  quantity: z.string(),
});

const trendPointSchema = z.object({
  date: z.string(),
  quantity: z.string(),
});

export const dailyManufacturingReportPayloadSchema = z.object({
  version: z.literal(DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION),
  reportType: z.literal("daily_manufacturing"),
  organizationName: z.string().default("ERP"),
  reportDate: z.string(),
  timeZone: z.string(),
  windowStartAt: z.string(),
  windowEndAt: z.string(),
  generatedAt: z.string(),
  summary: z.object({
    outputEventsRecorded: z.number().int().nonnegative(),
    completedBatches: z.number().int().nonnegative(),
    productsWithRecordedOutput: z.number().int().nonnegative(),
    materialsConsumedFromRecordedOutputs: z.number().int().nonnegative(),
    shipmentsShipped: z.number().int().nonnegative().default(0),
    shippedLineValue: z.string().default("0"),
  }),
  outputByProduct: z.array(
    z.object({
      productName: z.string(),
      productSku: z.string().nullable(),
      quantity: z.string(),
      unit: z.string(),
      outputEvents: z.number().int().nonnegative(),
      sevenDayTrend: z.array(trendPointSchema).default([]),
    })
  ),
  outputByRecordedBy: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
      userEmail: z.string(),
      outputEvents: z.number().int().nonnegative(),
      quantities: z.array(quantitySummarySchema),
    })
  ),
  completedBatches: z.array(
    z.object({
      productName: z.string(),
      productSku: z.string().nullable(),
      batchCount: z.number().int().nonnegative(),
      totalOutput: z.string(),
      unit: z.string(),
    })
  ),
  materialsConsumed: z.array(
    z.object({
      materialName: z.string(),
      materialSku: z.string().nullable(),
      quantity: z.string(),
      unit: z.string(),
    })
  ),
  erpUrl: z.string(),
});

export type DailyManufacturingReportPayload = z.infer<
  typeof dailyManufacturingReportPayloadSchema
>;

export function parseDailyManufacturingReportPayload(value: unknown) {
  return dailyManufacturingReportPayloadSchema.parse(value);
}
