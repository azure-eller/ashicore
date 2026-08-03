import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, organization } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { captureAppError } from "@/lib/observability/sentry";
import {
  asBillingPlugins,
  asBillingAddonLookupKeys,
  asBillingInterval,
  asEffectiveBillingPlan,
  asSalesOrderBand,
  type BillingAddonLookupKey,
  type BillingPlan,
  type BillingOverview,
  type BillingInterval,
  type BillingPlugin,
  type BillingState,
  type BillingStatus,
  type SalesOrderBand,
} from "./types";
import {
  getBillingOverviewInTx,
  getFeatureAccessInTx,
  type FeatureAccess,
} from "./entitlements";
export {
  assertLocationCapacityInTx,
  assertSalesOrderCapacityInTx,
  BillingCapacityError,
  assertFeatureAccessInTx,
  FeatureEntitlementError,
  type FeatureAccess,
} from "./entitlements";

function mapBillingState(row: {
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  skuLimitStartsAt: Date;
  billingInterval: string;
  salesOrderBand: string;
  locationCapacity: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  entitlements: string[] | null;
  betaFeatures: string[] | null;
  billingAddons: string[] | null;
}): BillingState {
  return {
    plan: asEffectiveBillingPlan(row.plan),
    status: row.status as BillingStatus,
    trialEndsAt: row.trialEndsAt,
    skuLimitStartsAt: row.skuLimitStartsAt,
    billingInterval: asBillingInterval(row.billingInterval),
    salesOrderBand: asSalesOrderBand(row.salesOrderBand),
    locationCapacity: row.locationCapacity,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    entitlements: asBillingPlugins(row.entitlements),
    betaFeatures: asBillingPlugins(row.betaFeatures),
    billingAddons: asBillingAddonLookupKeys(row.billingAddons),
  };
}

export async function getBillingStateForCurrentOrg(): Promise<BillingOverview> {
  return withAuthedOrgContext(async (tx, orgId) => getBillingOverviewInTx(tx, orgId));
}

export async function getFeatureAccessForCurrentOrg(
  plugin: BillingPlugin
): Promise<FeatureAccess> {
  return withAuthedOrgContext(async (tx, orgId) => {
    try {
      return await getFeatureAccessInTx(tx, orgId, plugin);
    } catch (error) {
      // Fail open: a billing bug must never lock UI workflows.
      captureAppError(error, {
        source: "billing_feature_entitlement",
        operation: plugin,
      });
      return { entitled: false, locked: false, grandfathered: false };
    }
  });
}

export async function setOrgStripeCustomerId(orgId: string, stripeCustomerId: string) {
  await db
    .update(organization)
    .set({ stripeCustomerId })
    .where(eq(organization.id, orgId));
}

export async function getActiveSkuCountByOrgId(orgId: string) {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)));
  return Number(row?.count ?? 0);
}

export async function getBillingStateByOrgId(orgId: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
      status: organization.status,
      trialEndsAt: organization.trialEndsAt,
      skuLimitStartsAt: organization.skuLimitStartsAt,
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodStart: organization.currentPeriodStart,
      currentPeriodEnd: organization.currentPeriodEnd,
      entitlements: organization.entitlements,
      betaFeatures: organization.betaFeatures,
      billingAddons: organization.billingAddons,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  return row ? { ...row, ...mapBillingState(row) } : null;
}

export async function getOrgByStripeCustomerId(stripeCustomerId: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
      status: organization.status,
      trialEndsAt: organization.trialEndsAt,
      skuLimitStartsAt: organization.skuLimitStartsAt,
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodStart: organization.currentPeriodStart,
      currentPeriodEnd: organization.currentPeriodEnd,
      entitlements: organization.entitlements,
      betaFeatures: organization.betaFeatures,
      billingAddons: organization.billingAddons,
    })
    .from(organization)
    .where(eq(organization.stripeCustomerId, stripeCustomerId))
    .limit(1);

  return row ? { ...row, ...mapBillingState(row) } : null;
}

export async function updateOrgBillingState({
  orgId,
  plan,
  status,
  stripeCustomerId,
  stripeSubscriptionId,
  entitlements,
  billingAddons,
  billingInterval,
  salesOrderBand,
  locationCapacity,
  trialEndsAt,
  cancelAtPeriodEnd,
  currentPeriodStart,
  currentPeriodEnd,
}: {
  orgId: string;
  plan: BillingPlan;
  status: BillingStatus;
  trialEndsAt?: Date | null;
  billingInterval?: BillingInterval;
  salesOrderBand?: SalesOrderBand;
  locationCapacity?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  entitlements?: BillingPlugin[];
  billingAddons?: BillingAddonLookupKey[];
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}) {
  await db
    .update(organization)
    .set({
      plan,
      status,
      trialEndsAt: trialEndsAt === undefined ? undefined : trialEndsAt,
      billingInterval: billingInterval === undefined ? undefined : billingInterval,
      salesOrderBand: salesOrderBand === undefined ? undefined : salesOrderBand,
      locationCapacity: locationCapacity === undefined ? undefined : locationCapacity,
      stripeCustomerId: stripeCustomerId === undefined ? undefined : stripeCustomerId,
      stripeSubscriptionId:
        stripeSubscriptionId === undefined ? undefined : stripeSubscriptionId,
      entitlements: entitlements === undefined ? undefined : [...entitlements],
      billingAddons: billingAddons === undefined ? undefined : [...billingAddons],
      cancelAtPeriodEnd:
        cancelAtPeriodEnd === undefined ? undefined : cancelAtPeriodEnd,
      currentPeriodStart:
        currentPeriodStart === undefined ? undefined : currentPeriodStart,
      currentPeriodEnd: currentPeriodEnd === undefined ? undefined : currentPeriodEnd,
    })
    .where(eq(organization.id, orgId));
}
