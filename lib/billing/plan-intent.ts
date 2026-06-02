export type BillingPlanIntent = "free" | "paid";

export const DEFAULT_BILLING_PLAN_INTENT: BillingPlanIntent = "free";

export function parseBillingPlanIntent(value: unknown): BillingPlanIntent {
  return value === "paid" ? "paid" : DEFAULT_BILLING_PLAN_INTENT;
}

export function orgSetupPathForPlanIntent(plan: BillingPlanIntent) {
  return plan === "paid" ? "/org-setup?plan=paid" : "/org-setup?plan=free";
}

export function appEntryPathForPlanIntent(plan: BillingPlanIntent) {
  return plan === "paid" ? "/settings/billing?checkout=1" : "/sales/orders";
}
