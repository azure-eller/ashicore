import { and, asc, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type Stripe from "stripe";
import {
  billingPeriodAdjustments,
  billingUsageEvents,
  organization,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { env } from "@/lib/env";
import { captureAppError } from "@/lib/observability/sentry";
import {
  asBillingInterval,
  asSalesOrderBand,
  compareSalesOrderBands,
  salesOrderBandDeltaCents,
  salesOrderBandForUsage,
  type SalesOrderBand,
} from "./types";

const MAX_ADJUSTMENT_RETRY_ATTEMPTS = 5;

type BillingPeriodAdjustment = InferSelectModel<typeof billingPeriodAdjustments>;

function monthPeriod(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function billingPeriodForOrg(org: {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}) {
  if (org.currentPeriodStart && org.currentPeriodEnd) {
    return { start: org.currentPeriodStart, end: org.currentPeriodEnd };
  }
  return monthPeriod(new Date());
}

function bucketAdjustmentPeriodForOrg(
  org: {
    billingInterval: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  },
  usagePeriod: { start: Date; end: Date }
) {
  return asBillingInterval(org.billingInterval) === "annual"
    ? billingPeriodForOrg(org)
    : usagePeriod;
}

function bucketAdjustmentChargesEnabled(org: { createdAt: Date }) {
  if (env.BILLING_ENTITLEMENTS_ENFORCED === "0") return false;
  const rawLaunchAt = env.BILLING_ENFORCEMENT_LAUNCH_AT?.trim();
  if (!rawLaunchAt) return false;
  const launchAt = new Date(rawLaunchAt);
  if (Number.isNaN(launchAt.getTime())) return false;
  return org.createdAt >= launchAt;
}

async function chargedBandForPeriodInTx(
  tx: Tx,
  orgId: string,
  periodStart: Date,
  baseBand: SalesOrderBand
) {
  const rows = await tx
    .select({ toBand: billingPeriodAdjustments.toBand })
    .from(billingPeriodAdjustments)
    .where(
      and(
        eq(billingPeriodAdjustments.organizationId, orgId),
        eq(billingPeriodAdjustments.billingPeriodStart, periodStart)
      )
    );

  return rows.reduce<SalesOrderBand>((current, row) => {
    const band = asSalesOrderBand(row.toBand);
    return compareSalesOrderBands(band, current) > 0 ? band : current;
  }, baseBand);
}

async function hasAdjustmentForPeriodInTx(tx: Tx, orgId: string, periodStart: Date) {
  const [row] = await tx
    .select({ id: billingPeriodAdjustments.id })
    .from(billingPeriodAdjustments)
    .where(
      and(
        eq(billingPeriodAdjustments.organizationId, orgId),
        eq(billingPeriodAdjustments.billingPeriodStart, periodStart)
      )
    )
    .limit(1);

  return row != null;
}

function duePendingAdjustmentPredicate(orgId: string, now: Date) {
  return and(
    eq(billingPeriodAdjustments.organizationId, orgId),
    eq(billingPeriodAdjustments.status, "pending"),
    or(
      sql`${billingPeriodAdjustments.nextRetryAt} IS NULL`,
      lte(billingPeriodAdjustments.nextRetryAt, now)
    )
  );
}

export function bucketAdjustmentInvoiceParams({
  orgId,
  stripeCustomerId,
  stripeSubscriptionId,
  adjustment,
}: {
  orgId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  adjustment: Pick<
    BillingPeriodAdjustment,
    "id" | "billingPeriodStart" | "fromBand" | "toBand"
  >;
}): Stripe.InvoiceCreateParams {
  return {
    customer: stripeCustomerId,
    subscription: stripeSubscriptionId,
    auto_advance: false,
    collection_method: "charge_automatically",
    pending_invoice_items_behavior: "exclude",
    metadata: {
      organizationId: orgId,
      billingAdjustmentId: adjustment.id,
      billingPeriodStart: adjustment.billingPeriodStart.toISOString(),
      fromBand: adjustment.fromBand,
      toBand: adjustment.toBand,
    },
  };
}

async function lockBillingBucketUsageInTx(tx: Tx, orgId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-bucket-usage:${orgId}`}))`
  );
}

export async function recordSalesOrderShippedUsageInTx(
  tx: Tx,
  params: {
    orgId: string;
    salesOrderId: string;
    occurredAt: Date;
  }
) {
  const [org] = await tx
    .select({
      plan: organization.plan,
      status: organization.status,
      salesOrderBand: organization.salesOrderBand,
      billingInterval: organization.billingInterval,
      currentPeriodStart: organization.currentPeriodStart,
      currentPeriodEnd: organization.currentPeriodEnd,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(eq(organization.id, params.orgId))
    .limit(1);

  if (!org || org.plan !== "core" || org.status === "canceled") {
    return { usageRecorded: false, adjustmentQueued: false };
  }

  const usagePeriod = monthPeriod(params.occurredAt);
  const adjustmentPeriod = bucketAdjustmentPeriodForOrg(org, usagePeriod);
  await lockBillingBucketUsageInTx(tx, params.orgId);

  await tx
    .insert(billingUsageEvents)
    .values({
      organizationId: params.orgId,
      salesOrderId: params.salesOrderId,
      eventType: "sales_order_shipped",
      billingPeriodStart: usagePeriod.start,
      billingPeriodEnd: usagePeriod.end,
      occurredAt: params.occurredAt,
    })
    .onConflictDoNothing({
      target: [
        billingUsageEvents.organizationId,
        billingUsageEvents.salesOrderId,
        billingUsageEvents.eventType,
        billingUsageEvents.billingPeriodStart,
      ],
    });

  const [usageRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(billingUsageEvents)
    .where(
      and(
        eq(billingUsageEvents.organizationId, params.orgId),
        eq(billingUsageEvents.billingPeriodStart, usagePeriod.start)
      )
    );

  const requiredBand = salesOrderBandForUsage(Number(usageRow?.count ?? 0));
  if (requiredBand === "scale") {
    return { usageRecorded: true, adjustmentQueued: false };
  }
  if (!bucketAdjustmentChargesEnabled(org)) {
    return { usageRecorded: true, adjustmentQueued: false };
  }

  const baseBand = asSalesOrderBand(org.salesOrderBand);
  const interval = asBillingInterval(org.billingInterval);
  if (
    interval === "annual" &&
    (await hasAdjustmentForPeriodInTx(tx, params.orgId, adjustmentPeriod.start))
  ) {
    return { usageRecorded: true, adjustmentQueued: false };
  }

  const chargedBand = await chargedBandForPeriodInTx(
    tx,
    params.orgId,
    adjustmentPeriod.start,
    baseBand
  );
  if (compareSalesOrderBands(requiredBand, chargedBand) <= 0) {
    return { usageRecorded: true, adjustmentQueued: false };
  }

  const amountCents = salesOrderBandDeltaCents({
    from: chargedBand,
    to: requiredBand,
    interval,
  });
  if (amountCents == null || amountCents <= 0) {
    return { usageRecorded: true, adjustmentQueued: false };
  }

  const idempotencyKey = [
    "bucket-adjustment",
    params.orgId,
    adjustmentPeriod.start.toISOString(),
    chargedBand,
    requiredBand,
  ].join(":");

  await tx
    .insert(billingPeriodAdjustments)
    .values({
      organizationId: params.orgId,
      billingPeriodStart: adjustmentPeriod.start,
      billingPeriodEnd: adjustmentPeriod.end,
      fromBand: chargedBand,
      toBand: requiredBand,
      amountCents,
      status: "pending",
      idempotencyKey,
    })
    .onConflictDoNothing({
      target: [
        billingPeriodAdjustments.organizationId,
        billingPeriodAdjustments.billingPeriodStart,
        billingPeriodAdjustments.toBand,
      ],
    });

  return { usageRecorded: true, adjustmentQueued: true };
}

export async function processPendingBucketAdjustments(orgId: string) {
  try {
    const [org] = await db
      .select({
        stripeCustomerId: organization.stripeCustomerId,
        stripeSubscriptionId: organization.stripeSubscriptionId,
      })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);

    if (!org?.stripeCustomerId || !org.stripeSubscriptionId) return { processed: 0 };

    const adjustments = await withOrgContext(orgId, async (tx) => {
      return tx
        .select()
        .from(billingPeriodAdjustments)
        .where(duePendingAdjustmentPredicate(orgId, new Date()))
        .orderBy(asc(billingPeriodAdjustments.createdAt))
        .limit(50);
    });

    if (adjustments.length === 0) return { processed: 0 };

    const { getBillingConfig, getStripeClient } = await import("./stripe");
    const config = getBillingConfig();
    const stripe = getStripeClient(config);
    let processed = 0;

    for (const adjustment of adjustments) {
      try {
        const invoice = await stripe.invoices.create(
          bucketAdjustmentInvoiceParams({
            orgId,
            stripeCustomerId: org.stripeCustomerId,
            stripeSubscriptionId: org.stripeSubscriptionId,
            adjustment,
          }),
          { idempotencyKey: `${adjustment.idempotencyKey}:invoice` }
        );
        const invoiceItem = await stripe.invoiceItems.create(
          {
            customer: org.stripeCustomerId,
            invoice: invoice.id,
            amount: adjustment.amountCents,
            currency: "usd",
            subscription: org.stripeSubscriptionId,
            description: `Ashicore ${adjustment.toBand} sales-order bucket adjustment`,
            metadata: {
              organizationId: orgId,
              billingAdjustmentId: adjustment.id,
              billingPeriodStart: adjustment.billingPeriodStart.toISOString(),
              fromBand: adjustment.fromBand,
              toBand: adjustment.toBand,
            },
          },
          { idempotencyKey: adjustment.idempotencyKey }
        );
        const finalizedInvoice = await stripe.invoices.finalizeInvoice(
          invoice.id,
          { auto_advance: true },
          { idempotencyKey: `${adjustment.idempotencyKey}:invoice:finalize` }
        );

        await withOrgContext(orgId, (tx) =>
          tx
            .update(billingPeriodAdjustments)
            .set({
              status: "sent",
              stripeInvoiceItemId: invoiceItem.id,
              stripeInvoiceId: finalizedInvoice.id,
              retryAttempts: 0,
              nextRetryAt: null,
              error: null,
              updatedAt: new Date(),
            })
            .where(eq(billingPeriodAdjustments.id, adjustment.id))
        );
        processed += 1;
      } catch (error) {
        const retryAttempts = adjustment.retryAttempts + 1;
        const terminal = retryAttempts >= MAX_ADJUSTMENT_RETRY_ATTEMPTS;
        const retryAt = terminal
          ? null
          : new Date(Date.now() + Math.min(60, retryAttempts * 10) * 60 * 1000);
        captureAppError(error, {
          source: "billing_bucket_adjustment",
          operation: "process_pending_adjustment",
          appDebug: {
            billingAdjustmentId: adjustment.id,
            organizationId: orgId,
            retryAttempts,
            terminal,
          },
        });
        await withOrgContext(orgId, (tx) =>
          tx
            .update(billingPeriodAdjustments)
            .set({
              status: terminal ? "failed" : "pending",
              retryAttempts,
              nextRetryAt: retryAt,
              error: error instanceof Error ? error.message : String(error),
              updatedAt: new Date(),
            })
            .where(eq(billingPeriodAdjustments.id, adjustment.id))
        );
      }
    }

    return { processed };
  } catch (error) {
    captureAppError(error, {
      source: "billing_bucket_adjustment",
      operation: "process_pending",
      appDebug: { organizationId: orgId },
    });
    return { processed: 0 };
  }
}

export async function processPendingBucketAdjustmentsForAllOrgs(limit = 100) {
  const orgs = await db
    .select({ id: organization.id })
    .from(organization)
    .where(isNotNull(organization.stripeCustomerId))
    .orderBy(asc(organization.createdAt));

  let processed = 0;
  let organizations = 0;
  for (const org of orgs) {
    if (organizations >= limit) break;
    const hasPending = await withOrgContext(org.id, async (tx) => {
      const [row] = await tx
        .select({ id: billingPeriodAdjustments.id })
        .from(billingPeriodAdjustments)
        .where(duePendingAdjustmentPredicate(org.id, new Date()))
        .limit(1);
      return row != null;
    });

    if (!hasPending) continue;
    organizations += 1;
    const result = await processPendingBucketAdjustments(org.id);
    processed += result.processed;
  }

  return { organizations, processed };
}
