import { eq, sql } from "drizzle-orm";
import { items, organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import {
  FREE_SKU_LIMIT,
  type BillingPlan,
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
      cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      currentPeriodEnd: organization.currentPeriodEnd,
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
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    currentPeriodEnd: org.currentPeriodEnd,
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
