import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { reportRuns } from "@/lib/db/schema";
import {
  DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION,
  REPORT_TYPES,
} from "./constants";
import { dailyManufacturingReportPayloadSchema } from "./daily-manufacturing-schema";

export async function getDailyManufacturingReportHistory(limit = 60) {
  const rows = await withAuthedOrgContext((tx) =>
    tx
      .select({
        id: reportRuns.id,
        reportDate: reportRuns.reportDate,
        timeZone: reportRuns.timeZone,
        status: reportRuns.status,
        payloadVersion: reportRuns.payloadVersion,
        payload: reportRuns.payload,
        emailSentAt: reportRuns.emailSentAt,
        failureMessage: reportRuns.failureMessage,
        createdAt: reportRuns.createdAt,
        updatedAt: reportRuns.updatedAt,
      })
      .from(reportRuns)
      .where(eq(reportRuns.reportType, REPORT_TYPES.DAILY_MANUFACTURING))
      .orderBy(desc(reportRuns.reportDate), desc(reportRuns.createdAt))
      .limit(limit)
  );

  return rows.map((row) => ({
    ...row,
    payload:
      row.payloadVersion === DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION &&
      row.status !== "failed"
        ? dailyManufacturingReportPayloadSchema.safeParse(row.payload).data ?? null
        : null,
  }));
}

export async function getDailyManufacturingReportRun(id: string) {
  const [row] = await withAuthedOrgContext((tx) =>
    tx
      .select({
        id: reportRuns.id,
        reportDate: reportRuns.reportDate,
        timeZone: reportRuns.timeZone,
        windowStartAt: reportRuns.windowStartAt,
        windowEndAt: reportRuns.windowEndAt,
        status: reportRuns.status,
        payloadVersion: reportRuns.payloadVersion,
        payload: reportRuns.payload,
        emailSentAt: reportRuns.emailSentAt,
        failureMessage: reportRuns.failureMessage,
        createdAt: reportRuns.createdAt,
        updatedAt: reportRuns.updatedAt,
      })
      .from(reportRuns)
      .where(and(eq(reportRuns.id, id), eq(reportRuns.reportType, REPORT_TYPES.DAILY_MANUFACTURING)))
      .limit(1)
  );

  if (!row) return null;

  return {
    ...row,
    payload:
      row.payloadVersion === DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION &&
      row.status !== "failed"
        ? dailyManufacturingReportPayloadSchema.parse(row.payload)
        : null,
  };
}
