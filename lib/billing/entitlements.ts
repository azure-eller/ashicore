import { eq, sql } from "drizzle-orm";
import { items, organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { captureAppError } from "@/lib/observability/sentry";
import {
  asBillingPlugins,
  BILLING_PLUGIN_LABELS,
  FREE_SKU_LIMIT,
  type BillingPlan,
  type BillingPlugin,
  type BillingSkuEntitlement,
  type BillingStatus,
} from "./types";

type BillingEntitlementErrorExtra = {
  billing: {
    plan: BillingPlan;
    status: BillingStatus;
    skuCount: number;
    skuLimit: number | null;
  };
};

export class BillingEntitlementError extends DomainError<BillingEntitlementErrorExtra> {
  constructor(entitlement: BillingSkuEntitlement) {
    super(
      `Free plan includes ${FREE_SKU_LIMIT} SKUs. Upgrade to Core to add more.`,
      402,
      {
        name: "BillingEntitlementError",
        extra: {
          billing: {
            plan: entitlement.plan,
            status: entitlement.status,
            skuCount: entitlement.skuCount,
            skuLimit: entitlement.skuLimit,
          },
        },
      }
    );
  }
}

function billingEnforcementEnabled() {
  return process.env.BILLING_ENTITLEMENTS_ENFORCED !== "0";
}

export class FeatureEntitlementError extends DomainError<{
  billing: { plugin: BillingPlugin };
}> {
  constructor(plugin: BillingPlugin) {
    super(
      `${BILLING_PLUGIN_LABELS[plugin]} requires a plugin upgrade. Add it in Settings → Billing.`,
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
    (process.env.BILLING_ENFORCED_PLUGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

// Orgs created before this instant are grandfathered: never blocked, only
// shadow-logged. Unset means every org is exempt — enforcement cannot fire
// anywhere until launch sets it.
function enforcementLaunchAt(): Date | null {
  const raw = process.env.BILLING_ENFORCEMENT_LAUNCH_AT?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  let entitled = false;
  let deny = false;
  let shadowDenial = false;

  try {
    const [org] = await tx
      .select({
        entitlements: organization.entitlements,
        createdAt: organization.createdAt,
      })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);

    if (!org) {
      throw new Error("Active organization not found for entitlement check.");
    }

    entitled = asBillingPlugins(org.entitlements).includes(plugin);

    if (!entitled && billingEnforcementEnabled()) {
      const launchAt = enforcementLaunchAt();
      const grandfathered = launchAt == null || org.createdAt < launchAt;
      deny = !grandfathered && enforcedPlugins().has(plugin);

      if (!deny) {
        shadowDenial = true;
        console.warn(
          "[billing-shadow-denial]",
          JSON.stringify({
            orgId,
            plugin,
            route: context?.route ?? null,
            grandfathered,
          })
        );
      }
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

  if (deny) {
    throw new FeatureEntitlementError(plugin);
  }

  return { allowed: true, entitled, shadowDenial, failedOpen: false };
}

export async function getSkuEntitlementInTx(
  tx: Tx,
  orgId: string
): Promise<BillingSkuEntitlement> {
  return readSkuEntitlementInTx(tx, orgId);
}

async function lockOrgForSkuEntitlementInTx(tx: Tx, orgId: string) {
  await tx.execute(
    sql`SELECT 1 FROM ${organization} WHERE ${organization.id} = ${orgId} FOR UPDATE`
  );
}

async function readSkuEntitlementInTx(
  tx: Tx,
  orgId: string
): Promise<BillingSkuEntitlement> {
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
    .where(eq(items.organizationId, orgId));

  const plan = org.plan as BillingPlan;
  const skuLimit = plan === "free" ? FREE_SKU_LIMIT : null;
  const enforcementEnabled = billingEnforcementEnabled();
  const skuCount = Number(countRow?.count ?? 0);

  return {
    plan,
    status: org.status as BillingStatus,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    currentPeriodEnd: org.currentPeriodEnd,
    entitlements: asBillingPlugins(org.entitlements),
    skuLimit,
    skuCount,
    enforcementEnabled,
    canCreateSku:
      !enforcementEnabled ||
      skuLimit == null ||
      skuCount < skuLimit,
  };
}

export async function assertCanCreateSkuInTx(tx: Tx, orgId: string) {
  const initialEntitlement = await readSkuEntitlementInTx(tx, orgId);

  if (
    !initialEntitlement.enforcementEnabled ||
    initialEntitlement.skuLimit == null
  ) {
    return initialEntitlement;
  }

  await lockOrgForSkuEntitlementInTx(tx, orgId);
  const entitlement = await readSkuEntitlementInTx(tx, orgId);

  if (!entitlement.canCreateSku) {
    throw new BillingEntitlementError(entitlement);
  }

  return entitlement;
}

export async function assertCanCreateSkusInTx(
  tx: Tx,
  orgId: string,
  count: number
) {
  if (count <= 0) {
    return getSkuEntitlementInTx(tx, orgId);
  }

  const initialEntitlement = await readSkuEntitlementInTx(tx, orgId);

  if (
    !initialEntitlement.enforcementEnabled ||
    initialEntitlement.skuLimit == null
  ) {
    return initialEntitlement;
  }

  await lockOrgForSkuEntitlementInTx(tx, orgId);
  const entitlement = await readSkuEntitlementInTx(tx, orgId);

  if (
    entitlement.skuLimit != null &&
    entitlement.skuCount + count > entitlement.skuLimit
  ) {
    throw new BillingEntitlementError(entitlement);
  }

  return entitlement;
}
