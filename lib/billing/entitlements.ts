import { after } from "next/server";
import { eq } from "drizzle-orm";
import { organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { captureAppError } from "@/lib/observability/sentry";
import { getBillingUsageInTx } from "./usage";
import {
  asBillingInterval,
  asEffectiveBillingPlan,
  asBillingPlugins,
  asBillingAddonLookupKeys,
  asSalesOrderBand,
  BILLING_BETA_PLUGINS,
  DEFAULT_TRIAL_DAYS,
  FREE_SKU_LIMIT,
  featureUpgradeMessage,
  BILLING_PLUGIN_LABELS,
  type BillingOverview,
  type BillingPlugin,
  type BillingStatus,
} from "./types";

export class FeatureEntitlementError extends DomainError<{
  billing: { plugin: BillingPlugin };
}> {
  constructor(plugin: BillingPlugin) {
    super(
      featureUpgradeMessage(plugin),
      402,
      {
        name: "FeatureEntitlementError",
        extra: { billing: { plugin } },
      }
    );
  }
}

export class BillingCapacityError extends DomainError<{
  billing: { dimension: "sales_orders" | "locations" | "trial"; limit?: number | null };
}> {
  constructor(
    message: string,
    dimension: "sales_orders" | "locations" | "trial",
    limit?: number | null
  ) {
    super(message, 402, {
      name: "BillingCapacityError",
      extra: { billing: { dimension, limit } },
    });
  }
}

export type FeatureAccess = {
  entitled: boolean;
  /** True when an enforced gate would deny this org right now. */
  locked: boolean;
  grandfathered: boolean;
  orgName?: string;
};

function scheduleFeatureGateHitAlert({
  orgId,
  orgName,
  plugin,
  route,
}: {
  orgId: string;
  orgName?: string;
  plugin: BillingPlugin;
  route?: string;
}) {
  const deliver = async () => {
    try {
      const { sendFounderAlert } = await import("@/lib/internal-alerts");
      await sendFounderAlert({
        kind: "feature_gate_hit",
        subject: `Ashicore feature gate hit: ${BILLING_PLUGIN_LABELS[plugin]}`,
        idempotencyKey: `founder-alert-feature-gate-${orgId}-${plugin}-${route ?? "unknown"}`,
        fields: [
          { label: "Organization", value: orgName ?? null },
          { label: "Organization ID", value: orgId },
          { label: "Plugin", value: BILLING_PLUGIN_LABELS[plugin] },
          { label: "Route", value: route ?? null },
        ],
      });
    } catch (error) {
      captureAppError(error, {
        source: "billing_feature_gate_alert",
        operation: plugin,
        route,
      });
    }
  };

  try {
    after(deliver);
  } catch {
    void deliver();
  }
}

// Pure read of the gate decision — no logging, no throwing. UI mirrors use
// this so upsell states match exactly what the server gates would do.
export async function getFeatureAccessInTx(
  tx: Tx,
  orgId: string,
  plugin: BillingPlugin
): Promise<FeatureAccess> {
  if (!BILLING_BETA_PLUGINS.includes(plugin)) {
    return { entitled: true, locked: false, grandfathered: false };
  }

  const [org] = await tx
    .select({
      name: organization.name,
      entitlements: organization.entitlements,
      betaFeatures: organization.betaFeatures,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error("Active organization not found for entitlement check.");
  }

  const entitled = [
    ...asBillingPlugins(org.entitlements),
    ...asBillingPlugins(org.betaFeatures),
  ].includes(plugin);
  return { entitled, locked: !entitled, grandfathered: false, orgName: org.name };
}

export type FeatureAccessResult = {
  allowed: true;
  entitled: boolean;
  shadowDenial: boolean;
  failedOpen: boolean;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function effectiveTrialEndsAt(org: { trialEndsAt: Date | null; createdAt: Date }) {
  return org.trialEndsAt ?? addDays(org.createdAt, DEFAULT_TRIAL_DAYS);
}

function monthUsagePeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function assertFeatureAccessInTx(
  tx: Tx,
  orgId: string,
  plugin: BillingPlugin,
  context?: { route?: string }
): Promise<FeatureAccessResult> {
  let access: FeatureAccess;
  try {
    access = await getFeatureAccessInTx(tx, orgId, plugin);
  } catch (error) {
    // Fail open: a billing bug must never block a customer's operations.
    captureAppError(error, {
      source: "billing_feature_entitlement",
      operation: plugin,
      route: context?.route,
    });
    return { allowed: true, entitled: false, shadowDenial: false, failedOpen: true };
  }

  if (access.locked) {
    const route = context?.route;
    console.warn(
      "[billing-gate-hit]",
      JSON.stringify({
        orgId,
        orgName: access.orgName ?? null,
        plugin,
        route: route ?? null,
      })
    );
    scheduleFeatureGateHitAlert({
      orgId,
      orgName: access.orgName,
      plugin,
      route,
    });
    throw new FeatureEntitlementError(plugin);
  }

  return { allowed: true, entitled: access.entitled, shadowDenial: false, failedOpen: false };
}

export async function getBillingOverviewInTx(
  tx: Tx,
  orgId: string
): Promise<BillingOverview> {
  const [org] = await tx
    .select({
      plan: organization.plan,
      status: organization.status,
      trialEndsAt: organization.trialEndsAt,
      skuLimitStartsAt: organization.skuLimitStartsAt,
      createdAt: organization.createdAt,
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      billingAddons: organization.billingAddons,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodStart: organization.currentPeriodStart,
      currentPeriodEnd: organization.currentPeriodEnd,
      entitlements: organization.entitlements,
      betaFeatures: organization.betaFeatures,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error("Active organization not found.");
  }

  const usagePeriod =
    org.plan === "core"
      ? monthUsagePeriod()
      : { start: org.currentPeriodStart ?? org.createdAt, end: null };
  const usage = await getBillingUsageInTx(tx, orgId, {
    periodStart: usagePeriod.start,
    periodEnd: usagePeriod.end,
    salesOrderSource: org.plan === "trial" ? "shipped_orders" : "billing_events",
  });

  return {
    plan: asEffectiveBillingPlan(org.plan),
    status: org.status as BillingStatus,
    trialEndsAt: effectiveTrialEndsAt(org),
    skuLimitStartsAt: org.skuLimitStartsAt,
    billingInterval: asBillingInterval(org.billingInterval),
    salesOrderBand: asSalesOrderBand(org.salesOrderBand),
    locationCapacity: org.locationCapacity,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    currentPeriodStart: org.currentPeriodStart,
    currentPeriodEnd: org.currentPeriodEnd,
    billingUsagePeriodStart: usagePeriod.start,
    billingUsagePeriodEnd: usagePeriod.end,
    entitlements: asBillingPlugins(org.entitlements),
    betaFeatures: asBillingPlugins(org.betaFeatures),
    billingAddons: asBillingAddonLookupKeys(org.billingAddons),
    ...usage,
    skuLimit: asEffectiveBillingPlan(org.plan) === "pro" ? null : FREE_SKU_LIMIT,
  };
}

export async function assertSalesOrderCapacityInTx(
  tx: Tx,
  orgId: string,
  context?: { route?: string }
) {
  void tx;
  void orgId;
  void context;
  return { allowed: true as const, failedOpen: false };
}

export async function assertLocationCapacityInTx(
  tx: Tx,
  orgId: string,
  context?: { route?: string }
) {
  void tx;
  void orgId;
  void context;
  return { allowed: true as const, failedOpen: false };
}
