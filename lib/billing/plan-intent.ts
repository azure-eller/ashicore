import {
  asBillingAddonLookupKeys,
  asBillingInterval,
  asSalesOrderBand,
  DEFAULT_LOCATION_CAPACITY,
  normalizeCoreBillingSelection,
  getCorePlanSelection,
  getBillingOffer,
  pluginsFromLookupKeys,
  PRO_PLAN_LOOKUP_KEY,
  type BillingAddonLookupKey,
  type CommercialBillingSelection,
  type BillingPlugin,
  type BillingInterval,
  type SalesOrderBand,
} from "./types";

export type BillingSelection = "trial" | "free" | string;

export const DEFAULT_BILLING_SELECTION: BillingSelection = "free";

export type BillingIntent = {
  selectedPlan: BillingSelection;
  locationCapacity: number;
  addonLookupKeys: BillingAddonLookupKey[];
};

export const DEFAULT_BILLING_INTENT: BillingIntent = {
  selectedPlan: DEFAULT_BILLING_SELECTION,
  locationCapacity: DEFAULT_LOCATION_CAPACITY,
  addonLookupKeys: [],
};

export function normalizeBillingSelection(value: unknown): BillingSelection {
  if (value === "trial" || value === "free") return "free";
  if (value === "core" || value === "paid" || value === "pro") {
    return PRO_PLAN_LOOKUP_KEY;
  }
  if (typeof value === "string" && getBillingOffer(value)) return value;
  return DEFAULT_BILLING_SELECTION;
}

export function isBillingSelection(value: unknown): value is BillingSelection {
  return value === "trial" || value === "free" || value === "core" || value === "paid" || (
    typeof value === "string" && getBillingOffer(value) !== null
  );
}

export function isPaidBillingSelection(value: BillingSelection | null | undefined) {
  return billingSelectionLookupKey(value) !== null;
}

export function billingSelectionLookupKey(value: BillingSelection | null | undefined) {
  if (value === "core" || value === "paid" || value === "pro") return PRO_PLAN_LOOKUP_KEY;
  if (typeof value === "string" && getBillingOffer(value)) return value;
  return null;
}

export function billingSelectionToCommercialSelection(
  value: BillingSelection | null | undefined
): CommercialBillingSelection {
  if (value === "free") return { mode: "free" };
  const lookupKey = billingSelectionLookupKey(value);
  if (!lookupKey) return { mode: "trial" };

  const coreSelection = getCorePlanSelection(lookupKey);
  if (coreSelection) {
    return normalizeCoreBillingSelection({
      mode: "core",
      band: coreSelection.band,
      interval: coreSelection.interval,
    });
  }

  const offer = getBillingOffer(lookupKey);
  if (offer?.kind === "plugin" || offer?.kind === "package" || offer?.kind === "everything") {
    return normalizeCoreBillingSelection({
      mode: "core",
      addonLookupKeys: asBillingAddonLookupKeys([lookupKey]),
    });
  }

  return normalizeCoreBillingSelection({ mode: "core" });
}

function normalizeLocationCapacity(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : DEFAULT_LOCATION_CAPACITY;
  if (!Number.isFinite(numeric)) return DEFAULT_LOCATION_CAPACITY;
  return Math.max(DEFAULT_LOCATION_CAPACITY, Math.floor(numeric));
}

function normalizeAddonParam(value: unknown) {
  if (Array.isArray(value)) return asBillingAddonLookupKeys(value);
  if (typeof value === "string") {
    return asBillingAddonLookupKeys(
      value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    );
  }
  return [];
}

export function normalizeBillingIntent(input?: {
  selectedPlan?: unknown;
  plan?: unknown;
  locationCapacity?: unknown;
  locations?: unknown;
  addonLookupKeys?: unknown;
  addons?: unknown;
}): BillingIntent {
  const addonLookupKeys = normalizeAddonParam(input?.addonLookupKeys);
  return {
    selectedPlan: normalizeBillingSelection(input?.selectedPlan ?? input?.plan),
    locationCapacity: normalizeLocationCapacity(
      input?.locationCapacity ?? input?.locations
    ),
    addonLookupKeys:
      addonLookupKeys.length > 0 ? addonLookupKeys : normalizeAddonParam(input?.addons),
  };
}

export function billingIntentToCommercialSelection(
  intent: BillingIntent | null | undefined
): CommercialBillingSelection {
  const normalized = normalizeBillingIntent(intent ?? DEFAULT_BILLING_INTENT);
  const selection = billingSelectionToCommercialSelection(normalized.selectedPlan);
  if (selection.mode !== "core") return selection;
  return normalizeCoreBillingSelection({
    ...selection,
    locationCapacity: normalized.locationCapacity,
    addonLookupKeys: [
      ...(selection.addonLookupKeys ?? []),
      ...normalized.addonLookupKeys,
    ],
  });
}

export function billingIntentQueryString(intent: BillingIntent) {
  const params = new URLSearchParams({
    plan: String(intent.selectedPlan),
  });
  if (intent.locationCapacity > DEFAULT_LOCATION_CAPACITY) {
    params.set("locations", String(intent.locationCapacity));
  }
  if (intent.addonLookupKeys.length > 0) {
    params.set("addons", intent.addonLookupKeys.join(","));
  }
  return params.toString();
}

export function commercialSelectionFromInput(input: {
  mode?: unknown;
  band?: unknown;
  interval?: unknown;
  locationCapacity?: unknown;
  addonLookupKeys?: unknown;
}): CommercialBillingSelection | null {
  if (input.mode === "trial") return { mode: "trial" };
  if (input.mode === "free") return { mode: "free" };
  if (input.mode !== "core") return null;

  const addonLookupKeys = Array.isArray(input.addonLookupKeys)
    ? asBillingAddonLookupKeys(input.addonLookupKeys)
    : [];
  return normalizeCoreBillingSelection({
    mode: "core",
    band: asSalesOrderBand(input.band as SalesOrderBand),
    interval: asBillingInterval(input.interval as BillingInterval),
    locationCapacity:
      typeof input.locationCapacity === "number" ? input.locationCapacity : undefined,
    addonLookupKeys: addonLookupKeys as BillingAddonLookupKey[],
  });
}

export function selectionEntitlementsMet(
  selection: BillingSelection | null | undefined,
  billing:
    | { plan?: string; status?: string; entitlements: BillingPlugin[] }
    | null
    | undefined,
): boolean {
  const lookupKey = billingSelectionLookupKey(selection);
  const offer = lookupKey ? getBillingOffer(lookupKey) : null;
  if (offer == null || billing == null) return false;
  if (offer.kind === "core") {
    return (billing.plan === "core" || billing.plan === "pro") && billing.status !== "canceled";
  }
  return offer.plugins.every((plugin) => billing.entitlements.includes(plugin));
}

export function billingIntentEntitlementsMet(
  intent: BillingIntent | null | undefined,
  billing:
    | {
        plan?: string;
        status?: string;
        locationCapacity?: number;
        entitlements: BillingPlugin[];
      }
    | null
    | undefined,
): boolean {
  const normalized = normalizeBillingIntent(intent ?? DEFAULT_BILLING_INTENT);
  const selection = billingIntentToCommercialSelection(normalized);
  if (selection.mode !== "core") return true;
  if (
    !billing ||
    (billing.plan !== "core" && billing.plan !== "pro") ||
    billing.status === "canceled"
  ) {
    return false;
  }
  if ((billing.locationCapacity ?? DEFAULT_LOCATION_CAPACITY) < normalized.locationCapacity) {
    return false;
  }
  return pluginsFromLookupKeys(selection.addonLookupKeys ?? []).every((plugin) =>
    billing.entitlements.includes(plugin)
  );
}

export function orgSetupPathForBillingSelection(selection: BillingSelection) {
  return `/org-setup?plan=${encodeURIComponent(selection)}`;
}

export function orgSetupPathForBillingIntent(intent: BillingIntent) {
  return `/org-setup?${billingIntentQueryString(intent)}`;
}

export function appEntryPathForBillingSelection(selection: BillingSelection) {
  return isPaidBillingSelection(selection) ? "/settings/billing" : "/sales/orders";
}
