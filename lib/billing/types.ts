export const BILLING_PLANS = ["free", "core"] as const;
export const BILLING_STATUSES = ["active", "past_due", "canceled"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const FREE_SKU_LIMIT = 30;

export type BillingState = {
  plan: BillingPlan;
  status: BillingStatus;
  stripeCustomerId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

export type BillingSkuEntitlement = BillingState & {
  skuLimit: number | null;
  skuCount: number;
  canCreateSku: boolean;
  enforcementEnabled: boolean;
};
