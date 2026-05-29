import "server-only";

import { randomUUID } from "node:crypto";
import { render } from "@react-email/components";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  items,
  manufacturingOrderIngredients,
  manufacturingOrderOutputConsumptions,
  manufacturingOrderOutputs,
  manufacturingOrders,
  member,
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
import { formatDate, todayInTimeZone } from "@/lib/format";
import { AuthorizationError } from "@/lib/authz";
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
  return new URL("/settings/reports", getCanonicalAppUrl()).toString();
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

async function getRecipientsByUserIdsInTx(tx: Tx, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];

  if (uniqueUserIds.length === 0) {
    return [];
  }

  return tx
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, sql`current_setting('app.current_org_id', true)`),
        inArray(member.userId, uniqueUserIds)
      )
    )
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
    .innerJoin(items, eq(manufacturingOrders.productId, items.id))
    .where(and(windowWhere, eq(items.sellable, true)))
    .groupBy(
      manufacturingOrders.productName,
      manufacturingOrders.productSku,
      manufacturingOrders.unitName
    )
    .orderBy(asc(manufacturingOrders.productName));

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
    .innerJoin(items, eq(manufacturingOrders.productId, items.id))
    .leftJoin(user, eq(manufacturingOrderOutputs.createdBy, user.id))
    .where(and(windowWhere, eq(items.sellable, true)))
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
    .innerJoin(items, eq(manufacturingOrders.productId, items.id))
    .where(
      and(
        windowWhere,
        eq(items.sellable, true),
        sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NOT NULL`,
        eq(manufacturingOrders.manufacturingMode, "batch")
      )
    )
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
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
    )
    .innerJoin(items, eq(manufacturingOrders.productId, items.id))
    .where(and(windowWhere, eq(items.sellable, true)))
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
      outputEventsRecorded: outputByProduct.reduce(
        (sum, row) => sum + row.outputEvents,
        0
      ),
      completedBatches: completedBatches.reduce((sum, row) => sum + row.batchCount, 0),
      productsWithRecordedOutput: outputByProduct.length,
      materialsConsumedFromRecordedOutputs: materialsConsumed.length,
      shipmentsShipped: shipmentSummary?.shipmentsShipped ?? 0,
      shippedLineValue: shipmentSummary?.shippedLineValue ?? "0",
    },
    outputByProduct,
    outputByRecordedBy,
    completedBatches,
    materialsConsumed,
    erpUrl: buildReportUrl(),
  };

  return dailyManufacturingReportPayloadSchema.parse(payload);
}

async function sendDailyManufacturingReportEmails(params: {
  runId: string;
  reportDate: string;
  recipients: ReportRecipient[];
  payload: DailyManufacturingReportPayload;
  idempotencyKeyPrefix?: string;
}) {
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
      idempotencyKey: `${params.idempotencyKeyPrefix ?? "daily-manufacturing-report"}:${params.runId}:${recipient.userId}`,
    });
  }
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

  await sendDailyManufacturingReportEmails(params);
}

export async function generateDailyManufacturingReportForOrg(params: {
  organizationId: string;
  reportDate: string;
  timeZone: string;
  scheduleId: string;
  emailEnabled: boolean;
  recipientsOverride?: ReportRecipient[];
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
        const recipients =
          params.recipientsOverride ?? (await getRecipientsInTx(tx, params.scheduleId));

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

export async function manualSendDailyManufacturingReportForOrg(params: {
  organizationId: string;
  reportDate: string;
  recipientUserIds: string[];
}) {
  const existingRun = await withOrgContext(params.organizationId, async (tx) => {
    const [schedule] = await tx
      .select({
        id: reportSchedules.id,
        timeZone: reportSchedules.timeZone,
      })
      .from(reportSchedules)
      .where(eq(reportSchedules.reportType, REPORT_TYPES.DAILY_MANUFACTURING))
      .limit(1);

    if (!schedule) {
      throw new AuthorizationError("Configure report settings before sending.", 400);
    }

    const uniqueRecipientUserIds = [...new Set(params.recipientUserIds)];
    const recipients = await getRecipientsByUserIdsInTx(tx, uniqueRecipientUserIds);

    if (recipients.length === 0) {
      throw new AuthorizationError("Select at least one report recipient before sending.", 400);
    }

    if (recipients.length !== uniqueRecipientUserIds.length) {
      throw new AuthorizationError("Selected report recipients must be active organization members.", 400);
    }

    const [run] = await tx
      .select({
        id: reportRuns.id,
        status: reportRuns.status,
        payloadVersion: reportRuns.payloadVersion,
        payload: reportRuns.payload,
      })
      .from(reportRuns)
      .where(
        and(
          eq(reportRuns.reportType, REPORT_TYPES.DAILY_MANUFACTURING),
          eq(reportRuns.reportDate, params.reportDate)
        )
      )
      .limit(1);

    return { schedule, recipients, run };
  });
  const today = todayInTimeZone(existingRun.schedule.timeZone);

  if (params.reportDate > today) {
    throw new AuthorizationError("Report date cannot be in the future.", 400);
  }

  if (existingRun.run && existingRun.run.status !== "failed") {
    if (existingRun.run.status === "generating") {
      throw new AuthorizationError("Report is already generating.", 409);
    }

    if (existingRun.run.payloadVersion !== DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION) {
      throw new AuthorizationError("Saved report payload is not compatible with manual send.", 409);
    }

    const payload = dailyManufacturingReportPayloadSchema.parse(existingRun.run.payload);
    const previousStatus = existingRun.run.status;
    const claim = await withOrgContext(params.organizationId, async (tx) => {
      const [row] = await tx
        .update(reportRuns)
        .set({
          status: "generating",
          failureMessage: null,
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reportRuns.id, existingRun.run!.id),
            sql`${reportRuns.status} <> 'generating'`
          )
        )
        .returning({ id: reportRuns.id });

      return row ?? null;
    });

    if (!claim) {
      throw new AuthorizationError("Report is already generating.", 409);
    }

    const manualSendId = randomUUID();

    try {
      await sendDailyManufacturingReportEmails({
        runId: existingRun.run.id,
        reportDate: params.reportDate,
        recipients: existingRun.recipients,
        payload,
        idempotencyKeyPrefix: `daily-manufacturing-report:manual:${manualSendId}`,
      });

      await withOrgContext(params.organizationId, async (tx) => {
        await tx
          .update(reportRuns)
          .set({
            status: "sent",
            emailSentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reportRuns.id, existingRun.run!.id));
      });
    } catch (error) {
      await withOrgContext(params.organizationId, async (tx) => {
        await tx
          .update(reportRuns)
          .set({
            status: previousStatus,
            failureMessage:
              error instanceof Error ? error.message.slice(0, 2000) : "Manual send failed.",
            updatedAt: new Date(),
          })
          .where(eq(reportRuns.id, existingRun.run!.id));
      });
      throw error;
    }

    return {
      runId: existingRun.run.id,
      reportDate: params.reportDate,
      recipientCount: existingRun.recipients.length,
      source: "snapshot" as const,
    };
  }

  const result = await generateDailyManufacturingReportForOrg({
    organizationId: params.organizationId,
    reportDate: params.reportDate,
    timeZone: existingRun.schedule.timeZone,
    scheduleId: existingRun.schedule.id,
    emailEnabled: true,
    recipientsOverride: existingRun.recipients,
  });

  if (!result.generated) {
    throw new AuthorizationError("Report payload is unavailable for manual send.", 409);
  }

  const source = existingRun.run?.status === "failed" ? "retried" : "generated";

  return {
    runId: result.runId,
    reportDate: params.reportDate,
    recipientCount: existingRun.recipients.length,
    source,
  };
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
