import { getBillingOffer, type BillingPlugin } from "./types";

export type BillingSelection = "free" | string;

export const DEFAULT_BILLING_SELECTION: BillingSelection = "free";

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

export function selectionEntitlementsMet(
  selection: BillingSelection | null | undefined,
  billing: { entitlements: BillingPlugin[] } | null | undefined,
): boolean {
  const lookupKey = billingSelectionLookupKey(selection);
  const offer = lookupKey ? getBillingOffer(lookupKey) : null;
  if (offer == null || billing == null) return false;
  return offer.plugins.every((plugin) => billing.entitlements.includes(plugin));
}

export function orgSetupPathForBillingSelection(selection: BillingSelection) {
  return `/org-setup?plan=${encodeURIComponent(selection)}`;
}

export function appEntryPathForBillingSelection(selection: BillingSelection) {
  return isPaidBillingSelection(selection) ? "/settings/billing" : "/sales/orders";
}
