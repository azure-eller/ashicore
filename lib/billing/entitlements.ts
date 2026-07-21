import { after } from "next/server";
import { eq } from "drizzle-orm";
import { organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { captureAppError } from "@/lib/observability/sentry";
import { getBillingUsageInTx } from "./usage";
import {
  asBillingInterval,
  asBillingPlugins,
  asBillingAddonLookupKeys,
  asSalesOrderBand,
  BILLING_BETA_PLUGINS,
  DEFAULT_TRIAL_DAYS,
  featureUpgradeMessage,
  BILLING_PLUGIN_LABELS,
  type BillingPlan,
  type BillingOverview,
  type BillingPlugin,
  type BillingStatus,
} from "./types";
import { env } from "@/lib/env";

function billingEnforcementEnabled() {
  return env.BILLING_ENTITLEMENTS_ENFORCED !== "0";
}

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

// Plugins listed here enforce 402s; everything else runs in shadow mode
// (would-be denials are logged, nothing blocks). Both are unset by default.
function enforcedPlugins(): Set<string> {
  return new Set(
    (env.BILLING_ENFORCED_PLUGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

// Orgs created before this instant are grandfathered: never blocked, only
// shadow-logged. Unset means every org is exempt — enforcement cannot fire
// anywhere until launch sets it.
function enforcementLaunchAt(): Date | null {
  const raw = env.BILLING_ENFORCEMENT_LAUNCH_AT?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const [org] = await tx
    .select({
      name: organization.name,
      entitlements: organization.entitlements,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error("Active organization not found for entitlement check.");
  }

  const entitled = asBillingPlugins(org.entitlements).includes(plugin);
  if (BILLING_BETA_PLUGINS.includes(plugin)) {
    return { entitled, locked: !entitled, grandfathered: false, orgName: org.name };
  }
  if (entitled || !billingEnforcementEnabled()) {
    return { entitled, locked: false, grandfathered: false, orgName: org.name };
  }

  const launchAt = enforcementLaunchAt();
  const grandfathered = launchAt == null || org.createdAt < launchAt;
  return {
    entitled,
    locked: !grandfathered && enforcedPlugins().has(plugin),
    grandfathered,
    orgName: org.name,
  };
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

function trialActive(org: { plan: string; trialEndsAt: Date | null; createdAt: Date }) {
  return org.plan === "trial" && effectiveTrialEndsAt(org) > new Date();
}

export async function assertFeatureAccessInTx(
  tx: Tx,
  orgId: string,
  plugin: BillingPlugin,
  context?: { route?: string }
): Promise<FeatureAccessResult> {
  let access: FeatureAccess;
  let shadowDenial = false;

  try {
    access = await getFeatureAccessInTx(tx, orgId, plugin);

    if (!access.entitled && !access.locked && billingEnforcementEnabled()) {
      shadowDenial = true;
      console.warn(
        "[billing-shadow-denial]",
        JSON.stringify({
          orgId,
          plugin,
          route: context?.route ?? null,
          grandfathered: access.grandfathered,
        })
      );
    }
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

  return { allowed: true, entitled: access.entitled, shadowDenial, failedOpen: false };
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
    plan: org.plan as BillingPlan,
    status: org.status as BillingStatus,
    trialEndsAt: effectiveTrialEndsAt(org),
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
    billingAddons: asBillingAddonLookupKeys(org.billingAddons),
    ...usage,
  };
}

async function getOrgBillingCapacityInTx(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({
      name: organization.name,
      plan: organization.plan,
      status: organization.status,
      trialEndsAt: organization.trialEndsAt,
      createdAt: organization.createdAt,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      entitlements: organization.entitlements,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error("Active organization not found for billing capacity check.");
  }

  return {
    ...org,
    salesOrderBand: asSalesOrderBand(org.salesOrderBand),
    entitlements: asBillingPlugins(org.entitlements),
    trialEndsAt: effectiveTrialEndsAt(org),
    trialActive: trialActive(org),
  };
}

export async function assertSalesOrderCapacityInTx(
  tx: Tx,
  orgId: string,
  context?: { route?: string }
) {
  try {
    const org = await getOrgBillingCapacityInTx(tx, orgId);
    if (!billingEnforcementEnabled() || org.trialActive || org.plan === "core") {
      return { allowed: true as const, failedOpen: false };
    }
    const launchAt = enforcementLaunchAt();
    if (launchAt == null || org.createdAt < launchAt) {
      console.warn(
        "[billing-shadow-denial]",
        JSON.stringify({
          orgId,
          dimension: "sales_orders",
          route: context?.route ?? null,
          grandfathered: true,
        })
      );
      return { allowed: true as const, failedOpen: false };
    }

    throw new BillingCapacityError(
      "Start Core to keep creating sales orders.",
      "trial",
      null
    );
  } catch (error) {
    if (error instanceof BillingCapacityError) throw error;
    captureAppError(error, {
      source: "billing_capacity",
      operation: "sales_orders",
      route: context?.route,
    });
    return { allowed: true as const, failedOpen: true };
  }
}

export async function assertLocationCapacityInTx(
  tx: Tx,
  orgId: string,
  context?: { route?: string }
) {
  try {
    const org = await getOrgBillingCapacityInTx(tx, orgId);
    const usage = await getBillingUsageInTx(tx, orgId);
    if (!billingEnforcementEnabled() || org.trialActive) {
      return { allowed: true as const, failedOpen: false };
    }
    if (org.plan === "core" && usage.locationCount < org.locationCapacity) {
      return { allowed: true as const, failedOpen: false };
    }
    const launchAt = enforcementLaunchAt();
    const grandfathered = launchAt == null || org.createdAt < launchAt;
    if (grandfathered || !enforcedPlugins().has("multi_location")) {
      console.warn(
        "[billing-shadow-denial]",
        JSON.stringify({
          orgId,
          dimension: "locations",
          route: context?.route ?? null,
          grandfathered,
        })
      );
      return { allowed: true as const, failedOpen: false };
    }
    throw new BillingCapacityError(
      `Your plan includes ${org.locationCapacity} active location${org.locationCapacity === 1 ? "" : "s"}. Increase location capacity to add another site.`,
      "locations",
      org.locationCapacity
    );
  } catch (error) {
    if (error instanceof BillingCapacityError) throw error;
    captureAppError(error, {
      source: "billing_capacity",
      operation: "locations",
      route: context?.route,
    });
    return { allowed: true as const, failedOpen: true };
  }
}
