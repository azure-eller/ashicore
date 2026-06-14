import { eq, isNull, sql, and } from "drizzle-orm";
import { items, organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { captureAppError } from "@/lib/observability/sentry";
import {
  asBillingPlugins,
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
  setTimeout(() => {
    void (async () => {
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
    })().catch((error) => {
      captureAppError(error, {
        source: "billing_feature_gate_alert",
        operation: plugin,
        route,
      });
    });
  }, 0);
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
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodEnd: organization.currentPeriodEnd,
      entitlements: organization.entitlements,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error("Active organization not found.");
  }

  const [countRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)));

  return {
    plan: org.plan as BillingPlan,
    status: org.status as BillingStatus,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    currentPeriodEnd: org.currentPeriodEnd,
    entitlements: asBillingPlugins(org.entitlements),
    skuCount: Number(countRow?.count ?? 0),
  };
}
