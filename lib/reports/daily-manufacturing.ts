import "server-only";

import { render } from "@react-email/components";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  manufacturingOrderIngredients,
  manufacturingOrderOutputConsumptions,
  manufacturingOrderOutputs,
  manufacturingOrders,
  notifications,
  organization,
  reportRecipients,
  reportRuns,
  reportSchedules,
  salesOrderLines,
  salesShipmentLines,
  salesShipments,
  user,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { getCanonicalAppUrl } from "@/lib/email/config";
import { sendTransactionalEmail } from "@/lib/email/send";
import { DailyManufacturingReportEmail } from "@/lib/email/components/daily-manufacturing-report";
import { formatDate } from "@/lib/format";
import {
  DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_TYPES,
  REPORT_TYPES,
} from "./constants";
import {
  dailyManufacturingReportPayloadSchema,
  type DailyManufacturingReportPayload,
} from "./daily-manufacturing-schema";
import { getLocalDateTimeParts, isLocalTimePastSendTime } from "./time";

type ReportWindow = {
  startAt: Date;
  endAt: Date;
};

type ReportRecipient = {
  userId: string;
  name: string;
  email: string;
};

type ClaimResult = {
  runId: string;
  window: ReportWindow;
};

function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function formatSubjectDate(reportDate: string) {
  const [year, month, day] = reportDate.split("-");
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function buildReportUrl() {
  return new URL("/settings#reports", getCanonicalAppUrl()).toString();
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

async function getReportWindowInTx(
  tx: Tx,
  reportDate: string,
  timeZone: string
): Promise<ReportWindow> {
  const result = await tx.execute(sql`
    SELECT
      (${reportDate}::date::timestamp AT TIME ZONE ${timeZone}) AS "startAt",
      ((${reportDate}::date + interval '1 day')::timestamp AT TIME ZONE ${timeZone}) AS "endAt"
  `);
  const [row] = toRows<{ startAt: Date; endAt: Date }>(result);

  if (!row) {
    throw new Error("Unable to resolve report window.");
  }

  return {
    startAt: new Date(row.startAt),
    endAt: new Date(row.endAt),
  };
}

async function claimReportRunInTx(
  tx: Tx,
  params: {
    organizationId: string;
    reportDate: string;
    timeZone: string;
  }
): Promise<ClaimResult | null> {
  const window = await getReportWindowInTx(tx, params.reportDate, params.timeZone);
  const result = await tx.execute(sql`
    INSERT INTO reporting.report_runs (
      organization_id,
      report_type,
      report_date,
      time_zone,
      window_start_at,
      window_end_at,
      payload_version,
      payload,
      status,
      failure_message,
      claimed_at,
      created_at,
      updated_at
    )
    VALUES (
      ${params.organizationId},
      ${REPORT_TYPES.DAILY_MANUFACTURING},
      ${params.reportDate}::date,
      ${params.timeZone},
      ${window.startAt},
      ${window.endAt},
      ${DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION},
      '{}'::jsonb,
      'generating',
      NULL,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, report_type, report_date)
    DO UPDATE SET
      status = 'generating',
      failure_message = NULL,
      claimed_at = NOW(),
      updated_at = NOW()
    WHERE reporting.report_runs.status = 'failed'
    RETURNING id
  `);
  const [row] = toRows<{ id: string }>(result);

  if (!row) return null;

  return {
    runId: row.id,
    window,
  };
}

async function getRecipientsInTx(tx: Tx, scheduleId: string) {
  return tx
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(reportRecipients)
    .innerJoin(user, eq(reportRecipients.userId, user.id))
    .where(eq(reportRecipients.scheduleId, scheduleId))
    .orderBy(asc(user.name), asc(user.email));
}

async function buildDailyManufacturingReportPayloadInTx(
  tx: Tx,
  params: {
    runId: string;
    reportDate: string;
    timeZone: string;
    window: ReportWindow;
  }
): Promise<DailyManufacturingReportPayload> {
  const windowWhere = and(
    sql`${manufacturingOrderOutputs.createdAt} >= ${params.window.startAt}`,
    sql`${manufacturingOrderOutputs.createdAt} < ${params.window.endAt}`,
    gt(manufacturingOrderOutputs.quantity, "0")
  );
  const [orgInfo] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, sql`current_setting('app.current_org_id', true)`))
    .limit(1);

  const outputByProduct = await tx
    .select({
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      unit: manufacturingOrders.unitName,
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
      outputEvents: sql<number>`COUNT(*)::int`.as("outputEvents"),
    })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(windowWhere)
    .groupBy(
      manufacturingOrders.productName,
      manufacturingOrders.productSku,
      manufacturingOrders.unitName
    )
    .orderBy(asc(manufacturingOrders.productName));

  const trendStartDate = addDays(params.reportDate, -6);
  const trendWindow = await tx.execute(sql`
    SELECT
      (${trendStartDate}::date::timestamp AT TIME ZONE ${params.timeZone}) AS "startAt",
      ((${params.reportDate}::date + interval '1 day')::timestamp AT TIME ZONE ${params.timeZone}) AS "endAt"
  `);
  const [trendWindowRow] = toRows<{ startAt: Date; endAt: Date }>(trendWindow);

  if (!trendWindowRow) {
    throw new Error("Unable to resolve report trend window.");
  }

  const trendResult = await tx.execute(sql`
    SELECT
      mo.product_name AS "productName",
      mo.product_sku AS "productSku",
      mo.unit_name AS "unit",
      (moo.created_at AT TIME ZONE ${params.timeZone})::date::text AS "date",
      trim_scale(COALESCE(SUM(moo.quantity), 0)) AS "quantity"
    FROM manufacturing.manufacturing_order_outputs moo
    INNER JOIN manufacturing.manufacturing_orders mo
      ON moo.manufacturing_order_id = mo.id
    WHERE moo.created_at >= ${new Date(trendWindowRow.startAt)}
      AND moo.created_at < ${new Date(trendWindowRow.endAt)}
      AND moo.quantity > 0
    GROUP BY mo.product_name, mo.product_sku, mo.unit_name, 4
  `);
  const trendRows = toRows<{
    productName: string;
    productSku: string | null;
    unit: string;
    date: string;
    quantity: string;
  }>(trendResult);
  const trendDates = Array.from({ length: 7 }, (_, index) =>
    addDays(params.reportDate, index - 6)
  );
  const trendByProductKey = new Map<string, Map<string, string>>();

  for (const row of trendRows) {
    const key = `${row.productName}|${row.productSku ?? ""}|${row.unit}`;
    const byDate = trendByProductKey.get(key) ?? new Map<string, string>();
    byDate.set(row.date, row.quantity);
    trendByProductKey.set(key, byDate);
  }
  const outputByProductWithTrend = outputByProduct.map((row) => {
    const key = `${row.productName}|${row.productSku ?? ""}|${row.unit}`;
    const byDate = trendByProductKey.get(key) ?? new Map<string, string>();

    return {
      ...row,
      sevenDayTrend: trendDates.map((date) => ({
        date,
        quantity: byDate.get(date) ?? "0",
      })),
    };
  });

  const outputByRecordedByRows = await tx
    .select({
      userId: manufacturingOrderOutputs.createdBy,
      userName: sql<string>`COALESCE(${user.name}, ${manufacturingOrderOutputs.createdBy})`.as(
        "userName"
      ),
      userEmail: sql<string>`COALESCE(${user.email}, '')`.as("userEmail"),
      unit: manufacturingOrders.unitName,
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
      outputEvents: sql<number>`COUNT(*)::int`.as("outputEvents"),
    })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .leftJoin(user, eq(manufacturingOrderOutputs.createdBy, user.id))
    .where(windowWhere)
    .groupBy(
      manufacturingOrderOutputs.createdBy,
      user.name,
      user.email,
      manufacturingOrders.unitName
    )
    .orderBy(asc(sql`COALESCE(${user.name}, ${manufacturingOrderOutputs.createdBy})`));

  const outputByRecordedBy = Array.from(
    outputByRecordedByRows.reduce((map, row) => {
      const existing = map.get(row.userId) ?? {
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        outputEvents: 0,
        quantities: [] as Array<{ unit: string; quantity: string }>,
      };
      existing.outputEvents += row.outputEvents;
      existing.quantities.push({ unit: row.unit, quantity: row.quantity });
      map.set(row.userId, existing);
      return map;
    }, new Map<string, DailyManufacturingReportPayload["outputByRecordedBy"][number]>()).values()
  );

  const completedBatches = await tx
    .select({
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      unit: manufacturingOrders.unitName,
      batchCount: sql<number>`COUNT(DISTINCT ${manufacturingOrderOutputs.manufacturingOrderBatchId})::int`.as(
        "batchCount"
      ),
      totalOutput: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "totalOutput"
      ),
    })
    .from(manufacturingOrderOutputs)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(and(windowWhere, sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NOT NULL`))
    .groupBy(
      manufacturingOrders.productName,
      manufacturingOrders.productSku,
      manufacturingOrders.unitName
    )
    .orderBy(asc(manufacturingOrders.productName));

  const materialsConsumed = await tx
    .select({
      materialName: manufacturingOrderIngredients.itemName,
      materialSku: manufacturingOrderIngredients.itemSku,
      unit: manufacturingOrderIngredients.unitName,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputConsumptions.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderOutputConsumptions)
    .innerJoin(
      manufacturingOrderOutputs,
      eq(
        manufacturingOrderOutputConsumptions.manufacturingOrderOutputId,
        manufacturingOrderOutputs.id
      )
    )
    .innerJoin(
      manufacturingOrderIngredients,
      eq(
        manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
        manufacturingOrderIngredients.id
      )
    )
    .where(windowWhere)
    .groupBy(
      manufacturingOrderIngredients.itemName,
      manufacturingOrderIngredients.itemSku,
      manufacturingOrderIngredients.unitName
    )
    .orderBy(asc(manufacturingOrderIngredients.itemName));

  const [shipmentSummary] = await tx
    .select({
      shipmentsShipped: sql<number>`COUNT(DISTINCT ${salesShipments.id})::int`.as(
        "shipmentsShipped"
      ),
      shippedLineValue: trimScale(
        sql`COALESCE(SUM(${salesShipmentLines.quantity} * ${salesOrderLines.unitPrice}), 0)`
      ).as("shippedLineValue"),
    })
    .from(salesShipments)
    .leftJoin(salesShipmentLines, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .leftJoin(salesOrderLines, eq(salesShipmentLines.salesOrderLineId, salesOrderLines.id))
    .where(
      and(
        eq(salesShipments.status, "shipped"),
        sql`${salesShipments.shippedAt} >= ${params.window.startAt}`,
        sql`${salesShipments.shippedAt} < ${params.window.endAt}`
      )
    );

  const payload = {
    version: DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION,
    reportType: REPORT_TYPES.DAILY_MANUFACTURING,
    organizationName: orgInfo?.name ?? "ERP",
    reportDate: params.reportDate,
    timeZone: params.timeZone,
    windowStartAt: params.window.startAt.toISOString(),
    windowEndAt: params.window.endAt.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: {
      outputEventsRecorded: outputByProductWithTrend.reduce(
        (sum, row) => sum + row.outputEvents,
        0
      ),
      completedBatches: completedBatches.reduce((sum, row) => sum + row.batchCount, 0),
      productsWithRecordedOutput: outputByProductWithTrend.length,
      materialsConsumedFromRecordedOutputs: materialsConsumed.length,
      shipmentsShipped: shipmentSummary?.shipmentsShipped ?? 0,
      shippedLineValue: shipmentSummary?.shippedLineValue ?? "0",
    },
    outputByProduct: outputByProductWithTrend,
    outputByRecordedBy,
    completedBatches,
    materialsConsumed,
    erpUrl: buildReportUrl(),
  };

  return dailyManufacturingReportPayloadSchema.parse(payload);
}

async function markRunFailed(
  organizationId: string,
  runId: string,
  failureMessage: string
) {
  await withOrgContext(organizationId, async (tx) => {
    await tx
      .update(reportRuns)
      .set({
        status: "failed",
        failureMessage: failureMessage.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(reportRuns.id, runId));
  });
}

async function createNotificationsAndSendEmail(params: {
  organizationId: string;
  runId: string;
  reportDate: string;
  emailEnabled: boolean;
  recipients: ReportRecipient[];
  payload: DailyManufacturingReportPayload;
}) {
  if (params.recipients.length === 0) {
    return;
  }

  const title = `Daily Manufacturing Report - ${formatDate(params.reportDate)}`;
  const body =
    params.payload.summary.outputEventsRecorded === 0
      ? "No manufacturing output was recorded for this day."
      : `${params.payload.summary.outputEventsRecorded} output events recorded.`;

  await withOrgContext(params.organizationId, async (tx) => {
    await tx.insert(notifications).values(
      params.recipients.map((recipient) => ({
        organizationId: params.organizationId,
        userId: recipient.userId,
        type: NOTIFICATION_TYPES.DAILY_MANUFACTURING_REPORT,
        title,
        body,
        entityType: NOTIFICATION_ENTITY_TYPES.REPORT_RUN,
        entityId: params.runId,
        deliveryStatus: "created",
      }))
    );
  });

  if (!params.emailEnabled) {
    return;
  }

  const subject = `Daily Manufacturing Report - ${formatSubjectDate(params.reportDate)}`;
  const email = DailyManufacturingReportEmail({ payload: params.payload });
  const html = await render(email);
  const text = await render(email, { plainText: true });

  for (const recipient of params.recipients) {
    await sendTransactionalEmail({
      tag: "daily-manufacturing-report",
      to: recipient.email,
      subject,
      html,
      text,
      idempotencyKey: `daily-manufacturing-report:${params.runId}:${recipient.userId}`,
    });
  }
}

export async function generateDailyManufacturingReportForOrg(params: {
  organizationId: string;
  reportDate: string;
  timeZone: string;
  scheduleId: string;
  emailEnabled: boolean;
}) {
  const claim = await withOrgContext(params.organizationId, (tx) =>
    claimReportRunInTx(tx, params)
  );

  if (!claim) {
    return { generated: false, reason: "already-generated" as const };
  }

  try {
    const { payload, recipients } = await withOrgContext(
      params.organizationId,
      async (tx) => {
        const payload = await buildDailyManufacturingReportPayloadInTx(tx, {
          runId: claim.runId,
          reportDate: params.reportDate,
          timeZone: params.timeZone,
          window: claim.window,
        });
        const recipients = await getRecipientsInTx(tx, params.scheduleId);

        await tx
          .update(reportRuns)
          .set({
            payloadVersion: DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION,
            payload,
            status: "generated",
            failureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(reportRuns.id, claim.runId));

        return { payload, recipients };
      }
    );

    await createNotificationsAndSendEmail({
      organizationId: params.organizationId,
      runId: claim.runId,
      reportDate: params.reportDate,
      emailEnabled: params.emailEnabled,
      recipients,
      payload,
    });

    await withOrgContext(params.organizationId, async (tx) => {
      await tx
        .update(reportRuns)
        .set({
          status: params.emailEnabled ? "sent" : "generated",
          emailSentAt: params.emailEnabled ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(reportRuns.id, claim.runId));
    });

    return { generated: true, runId: claim.runId };
  } catch (error) {
    await markRunFailed(
      params.organizationId,
      claim.runId,
      error instanceof Error ? error.message : "Report generation failed."
    );
    throw error;
  }
}

export async function generateDueDailyManufacturingReports(now = new Date()) {
  const orgRows = await db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.name));

  const summary = {
    checked: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const orgRow of orgRows) {
    const schedules = await withOrgContext(orgRow.id, (tx) =>
      tx
        .select({
          id: reportSchedules.id,
          enabled: reportSchedules.enabled,
          emailEnabled: reportSchedules.emailEnabled,
          localSendTime: reportSchedules.localSendTime,
          timeZone: reportSchedules.timeZone,
        })
        .from(reportSchedules)
        .where(eq(reportSchedules.reportType, REPORT_TYPES.DAILY_MANUFACTURING))
        .limit(1)
    );
    const schedule = schedules[0];
    summary.checked += 1;

    if (!schedule?.enabled) {
      summary.skipped += 1;
      continue;
    }

    if (!isLocalTimePastSendTime(now, schedule.timeZone, schedule.localSendTime)) {
      summary.skipped += 1;
      continue;
    }

    try {
      const reportDate = getLocalDateTimeParts(now, schedule.timeZone).date;
      const result = await generateDailyManufacturingReportForOrg({
        organizationId: orgRow.id,
        reportDate,
        timeZone: schedule.timeZone,
        scheduleId: schedule.id,
        emailEnabled: schedule.emailEnabled,
      });

      if (result.generated) {
        summary.generated += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("Daily manufacturing report failed:", {
        orgId: orgRow.id,
        error,
      });
    }
  }

  return summary;
}

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

export async function listDailyManufacturingReportRecipients(scheduleId: string) {
  const rows = await withAuthedOrgContext((tx) =>
    tx
      .select({ userId: reportRecipients.userId })
      .from(reportRecipients)
      .where(eq(reportRecipients.scheduleId, scheduleId))
  );

  return rows.map((row) => row.userId);
}

export async function getDailyManufacturingScheduleForOrg(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.reportType, REPORT_TYPES.DAILY_MANUFACTURING))
      .limit(1);

    return row ?? null;
  });
}
