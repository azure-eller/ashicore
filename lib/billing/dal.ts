import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type {
  BillingPlan,
  BillingSkuEntitlement,
  BillingState,
  BillingStatus,
} from "./types";
import { getSkuEntitlementInTx } from "./entitlements";
export {
  assertCanCreateSkuInTx,
  assertCanCreateSkusInTx,
  BillingEntitlementError,
  getSkuEntitlementInTx,
} from "./entitlements";

function mapBillingState(row: {
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}): BillingState {
  return {
    plan: row.plan as BillingPlan,
    status: row.status as BillingStatus,
    stripeCustomerId: row.stripeCustomerId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

export async function getBillingStateForCurrentOrg(): Promise<BillingSkuEntitlement> {
  return withAuthedOrgContext(async (tx, orgId) => getSkuEntitlementInTx(tx, orgId));
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
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodEnd: organization.currentPeriodEnd,
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
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodEnd: organization.currentPeriodEnd,
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
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  orgId: string;
  plan: BillingPlan;
  status: BillingStatus;
  stripeCustomerId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
}) {
  await db
    .update(organization)
    .set({
      plan,
      status,
      stripeCustomerId: stripeCustomerId === undefined ? undefined : stripeCustomerId,
      cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
      currentPeriodEnd: currentPeriodEnd ?? null,
    })
    .where(eq(organization.id, orgId));
}
