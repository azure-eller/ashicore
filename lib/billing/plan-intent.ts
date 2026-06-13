import { getBillingOffer } from "./types";

export type BillingPlanIntent = "free" | "paid";
export type BillingSelection = "free" | string;

export const DEFAULT_BILLING_PLAN_INTENT: BillingPlanIntent = "free";
export const DEFAULT_BILLING_SELECTION: BillingSelection = "free";

export function parseBillingPlanIntent(value: unknown): BillingPlanIntent {
  return value === "paid" ? "paid" : DEFAULT_BILLING_PLAN_INTENT;
}

export function normalizeBillingSelection(value: unknown): BillingSelection {
  if (value === "free") return "free";
  if (value === "paid") return "everything";
  if (typeof value === "string" && getBillingOffer(value)) return value;
  return DEFAULT_BILLING_SELECTION;
}

export function isBillingSelection(value: unknown): value is BillingSelection {
  return value === "free" || value === "paid" || (
    typeof value === "string" && getBillingOffer(value) !== null
  );
}

export function isPaidBillingSelection(value: BillingSelection | null | undefined) {
  return billingSelectionLookupKey(value) !== null;
}

export function billingSelectionLookupKey(value: BillingSelection | null | undefined) {
  if (value === "paid") return "everything";
  if (typeof value === "string" && getBillingOffer(value)) return value;
  return null;
}

export function orgSetupPathForPlanIntent(plan: BillingPlanIntent) {
  return plan === "paid" ? "/org-setup?plan=paid" : "/org-setup?plan=free";
}

export function appEntryPathForPlanIntent(plan: BillingPlanIntent) {
  return plan === "paid" ? "/settings/billing" : "/sales/orders";
}

export function orgSetupPathForBillingSelection(selection: BillingSelection) {
  return `/org-setup?plan=${encodeURIComponent(selection)}`;
}

export function appEntryPathForBillingSelection(selection: BillingSelection) {
  return isPaidBillingSelection(selection) ? "/settings/billing" : "/sales/orders";
}
