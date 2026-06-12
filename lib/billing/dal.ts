import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { captureAppError } from "@/lib/observability/sentry";
import {
  asBillingPlugins,
  type BillingPlan,
  type BillingOverview,
  type BillingPlugin,
  type BillingState,
  type BillingStatus,
} from "./types";
import {
  getBillingOverviewInTx,
  getFeatureAccessInTx,
  type FeatureAccess,
} from "./entitlements";
export {
  assertFeatureAccessInTx,
  FeatureEntitlementError,
  type FeatureAccess,
} from "./entitlements";

function mapBillingState(row: {
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  entitlements: string[] | null;
}): BillingState {
  return {
    plan: row.plan as BillingPlan,
    status: row.status as BillingStatus,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    entitlements: asBillingPlugins(row.entitlements),
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

export async function getBillingStateByOrgId(orgId: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
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

  return row ? { ...row, ...mapBillingState(row) } : null;
}

export async function getOrgByStripeCustomerId(stripeCustomerId: string) {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
      status: organization.status,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodEnd: organization.currentPeriodEnd,
      entitlements: organization.entitlements,
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
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  orgId: string;
  plan: BillingPlan;
  status: BillingStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  entitlements?: BillingPlugin[];
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
}) {
  await db
    .update(organization)
    .set({
      plan,
      status,
      stripeCustomerId: stripeCustomerId === undefined ? undefined : stripeCustomerId,
      stripeSubscriptionId:
        stripeSubscriptionId === undefined ? undefined : stripeSubscriptionId,
      entitlements: entitlements === undefined ? undefined : [...entitlements],
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
      currentPeriodEnd: currentPeriodEnd ?? null,
    })
    .where(eq(organization.id, orgId));
}
