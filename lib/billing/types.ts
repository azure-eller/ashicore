export const BILLING_PLANS = ["trial", "free", "core"] as const;
export const BILLING_STATUSES = ["active", "past_due", "canceled"] as const;
export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export const SALES_ORDER_BANDS = ["starter", "growth", "pro", "scale"] as const;
export const PRICED_SALES_ORDER_BANDS = ["starter", "growth", "pro"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export type SalesOrderBand = (typeof SALES_ORDER_BANDS)[number];
export type PricedSalesOrderBand = (typeof PRICED_SALES_ORDER_BANDS)[number];

export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_BILLING_INTERVAL: BillingInterval = "monthly";
export const DEFAULT_SALES_ORDER_BAND: SalesOrderBand = "starter";
export const DEFAULT_LOCATION_CAPACITY = 1;

export const SALES_ORDER_BAND_LIMITS: Record<SalesOrderBand, number | null> = {
  starter: 100,
  growth: 250,
  pro: 1000,
  scale: null,
};

export const SALES_ORDER_BAND_PRICE_ADD: Record<SalesOrderBand, number | null> = {
  starter: 0,
  growth: 100,
  pro: 250,
  scale: null,
};

export function salesOrderBandForUsage(count: number): SalesOrderBand {
  if (count <= (SALES_ORDER_BAND_LIMITS.starter ?? 0)) return "starter";
  if (count <= (SALES_ORDER_BAND_LIMITS.growth ?? 0)) return "growth";
  if (count <= (SALES_ORDER_BAND_LIMITS.pro ?? 0)) return "pro";
  return "scale";
}

export function salesOrderBandRank(band: SalesOrderBand) {
  return SALES_ORDER_BANDS.indexOf(band);
}

export function compareSalesOrderBands(left: SalesOrderBand, right: SalesOrderBand) {
  return salesOrderBandRank(left) - salesOrderBandRank(right);
}

export function asBillingInterval(value: string | null | undefined): BillingInterval {
  return BILLING_INTERVALS.includes(value as BillingInterval)
    ? (value as BillingInterval)
    : DEFAULT_BILLING_INTERVAL;
}

export function asSalesOrderBand(value: string | null | undefined): SalesOrderBand {
  return SALES_ORDER_BANDS.includes(value as SalesOrderBand)
    ? (value as SalesOrderBand)
    : DEFAULT_SALES_ORDER_BAND;
}

export function isPricedSalesOrderBand(
  value: string | null | undefined
): value is PricedSalesOrderBand {
  return PRICED_SALES_ORDER_BANDS.includes(value as PricedSalesOrderBand);
}

export const BILLING_PLUGINS = [
  "lot_tracking",
  "batch_production",
  "crm",
  "wholesale_pricing",
  "multi_location",
  "pricing_scenarios",
] as const;

export type BillingPlugin = (typeof BILLING_PLUGINS)[number];

export const BILLING_PLUGIN_LABELS: Record<BillingPlugin, string> = {
  lot_tracking: "Lot tracking",
  batch_production: "Batch production",
  crm: "CRM",
  wholesale_pricing: "Wholesale pricing",
  multi_location: "Multi-location",
  pricing_scenarios: "Pricing scenarios",
};

// Beta plugins are visible only to orgs holding the entitlement: locked for
// everyone else regardless of shadow mode or grandfathering. They are not
// sellable — no lookup key or catalog offer until they graduate.
export const BILLING_BETA_PLUGINS: readonly BillingPlugin[] = ["pricing_scenarios"];

export const BILLING_COMMERCIAL_PLUGINS = BILLING_PLUGINS.filter(
  (plugin) => !BILLING_BETA_PLUGINS.includes(plugin)
);

export function featureUpgradeMessage(plugin: BillingPlugin) {
  return `${BILLING_PLUGIN_LABELS[plugin]} requires a plugin upgrade. Add it in Settings → Billing.`;
}

export const BILLING_PACKAGE_PLUGINS = {
  food_bev: ["lot_tracking", "batch_production", "wholesale_pricing"],
  soil_landscape: ["batch_production", "multi_location", "wholesale_pricing"],
  wholesale_b2b: ["crm", "wholesale_pricing", "multi_location"],
} as const satisfies Record<string, readonly BillingPlugin[]>;

// Stripe price lookup keys → granted plugins. Prices are created in Stripe with
// these lookup keys; no per-price env vars or deploys to add one.
export const BILLING_PRICE_LOOKUP_PLUGINS: Record<string, readonly BillingPlugin[]> = {
  plugin_lot_tracking: ["lot_tracking"],
  plugin_batch_production: ["batch_production"],
  plugin_crm: ["crm"],
  plugin_wholesale_pricing: ["wholesale_pricing"],
  plugin_multi_location: ["multi_location"],
  package_food_bev: BILLING_PACKAGE_PLUGINS.food_bev,
  package_soil_landscape: BILLING_PACKAGE_PLUGINS.soil_landscape,
  package_wholesale_b2b: BILLING_PACKAGE_PLUGINS.wholesale_b2b,
  everything: BILLING_COMMERCIAL_PLUGINS,
};

export const CORE_PLAN_LOOKUP_KEYS = [
  "core_starter_monthly",
  "core_growth_monthly",
  "core_pro_monthly",
  "core_starter_annual",
  "core_growth_annual",
  "core_pro_annual",
] as const;

export type CorePlanLookupKey = (typeof CORE_PLAN_LOOKUP_KEYS)[number];

export type CorePlanSelection = {
  lookupKey: CorePlanLookupKey;
  band: SalesOrderBand;
  interval: BillingInterval;
  monthlyUsd: number;
};

export const CORE_PLAN_CATALOG: readonly CorePlanSelection[] = [
  { lookupKey: "core_starter_monthly", band: "starter", interval: "monthly", monthlyUsd: 299 },
  { lookupKey: "core_growth_monthly", band: "growth", interval: "monthly", monthlyUsd: 399 },
  { lookupKey: "core_pro_monthly", band: "pro", interval: "monthly", monthlyUsd: 549 },
  { lookupKey: "core_starter_annual", band: "starter", interval: "annual", monthlyUsd: 249 },
  { lookupKey: "core_growth_annual", band: "growth", interval: "annual", monthlyUsd: 333 },
  { lookupKey: "core_pro_annual", band: "pro", interval: "annual", monthlyUsd: 458 },
];

export function coreMonthlyUsdForBand(
  band: SalesOrderBand,
  interval: BillingInterval = "monthly"
) {
  return (
    CORE_PLAN_CATALOG.find(
      (selection) => selection.band === band && selection.interval === interval
    )?.monthlyUsd ?? null
  );
}

export function salesOrderBandDeltaCents({
  from,
  to,
  interval = "monthly",
}: {
  from: SalesOrderBand;
  to: SalesOrderBand;
  interval?: BillingInterval;
}) {
  const fromUsd = coreMonthlyUsdForBand(from, interval);
  const toUsd = coreMonthlyUsdForBand(to, interval);
  if (fromUsd == null || toUsd == null) return null;
  const periodMultiplier = interval === "annual" ? 12 : 1;
  return Math.max(0, Math.round((toUsd - fromUsd) * periodMultiplier * 100));
}

export function getCorePlanSelection(
  lookupKey: string | null | undefined
): CorePlanSelection | null {
  if (!lookupKey) return null;
  return CORE_PLAN_CATALOG.find((selection) => selection.lookupKey === lookupKey) ?? null;
}

export const EXTRA_LOCATION_LOOKUP_KEY = "extra_location" as const;
const ANNUAL_RECURRING_LOOKUP_SUFFIX = "_annual" as const;

export const BILLING_ADDON_LOOKUP_KEYS = [
  "plugin_lot_tracking",
  "plugin_batch_production",
  "plugin_crm",
  "plugin_wholesale_pricing",
  "plugin_multi_location",
  "package_food_bev",
  "package_soil_landscape",
  "package_wholesale_b2b",
  "everything",
] as const;

export type BillingAddonLookupKey = (typeof BILLING_ADDON_LOOKUP_KEYS)[number];

export function isBillingAddonLookupKey(
  value: string | null | undefined
): value is BillingAddonLookupKey {
  return BILLING_ADDON_LOOKUP_KEYS.includes(value as BillingAddonLookupKey);
}

export function canonicalBillingAddonLookupKey(
  value: string | null | undefined
): BillingAddonLookupKey | null {
  if (!value) return null;
  if (isBillingAddonLookupKey(value)) return value;
  if (!value.endsWith(ANNUAL_RECURRING_LOOKUP_SUFFIX)) return null;
  const base = value.slice(0, -ANNUAL_RECURRING_LOOKUP_SUFFIX.length);
  return isBillingAddonLookupKey(base) ? base : null;
}

export function asBillingAddonLookupKeys(
  values: string[] | null | undefined
): BillingAddonLookupKey[] {
  if (!values) return [];
  const unique = new Set<BillingAddonLookupKey>();
  for (const value of values) {
    const canonical = canonicalBillingAddonLookupKey(value);
    if (canonical) unique.add(canonical);
  }
  return BILLING_ADDON_LOOKUP_KEYS.filter((key) => unique.has(key));
}

export function recurringLookupKeyForBillingInterval(
  lookupKey: string,
  interval: BillingInterval
) {
  if (
    interval === "annual" &&
    (lookupKey === EXTRA_LOCATION_LOOKUP_KEY || isBillingAddonLookupKey(lookupKey))
  ) {
    return `${lookupKey}${ANNUAL_RECURRING_LOOKUP_SUFFIX}`;
  }
  return lookupKey;
}

export function canonicalRecurringLookupKey(lookupKey: string | null | undefined) {
  if (!lookupKey?.endsWith(ANNUAL_RECURRING_LOOKUP_SUFFIX)) return lookupKey ?? null;
  const base = lookupKey.slice(0, -ANNUAL_RECURRING_LOOKUP_SUFFIX.length);
  if (base === EXTRA_LOCATION_LOOKUP_KEY || isBillingAddonLookupKey(base)) return base;
  return lookupKey;
}

export function coreLookupKeyForSelection({
  band = DEFAULT_SALES_ORDER_BAND,
  interval = DEFAULT_BILLING_INTERVAL,
}: {
  band?: SalesOrderBand;
  interval?: BillingInterval;
} = {}) {
  const selection = CORE_PLAN_CATALOG.find(
    (selection) => selection.band === band && selection.interval === interval
  );
  if (!selection) {
    throw new Error("Scale Core requires sales-assisted pricing.");
  }
  return selection.lookupKey;
}

export type CoreBillingSelection = {
  mode: "core";
  band?: SalesOrderBand;
  interval?: BillingInterval;
  locationCapacity?: number;
  addonLookupKeys?: BillingAddonLookupKey[];
};

export type TrialBillingSelection = {
  mode: "trial";
};

export type FreeBillingSelection = {
  mode: "free";
};

export type CommercialBillingSelection =
  | CoreBillingSelection
  | TrialBillingSelection
  | FreeBillingSelection;

export type BillingLineItemSelection = {
  lookupKey: string;
  quantity: number;
};

export function normalizeCoreBillingSelection(
  selection: CoreBillingSelection = { mode: "core" }
): Required<CoreBillingSelection> {
  return {
    mode: "core",
    band: asSalesOrderBand(selection.band),
    interval: asBillingInterval(selection.interval),
    locationCapacity: Math.max(
      DEFAULT_LOCATION_CAPACITY,
      Math.floor(selection.locationCapacity ?? DEFAULT_LOCATION_CAPACITY)
    ),
    addonLookupKeys: asBillingAddonLookupKeys(selection.addonLookupKeys),
  };
}

export function billingLineItemsForCoreSelection(
  selection: CoreBillingSelection
): BillingLineItemSelection[] {
  const normalized = normalizeCoreBillingSelection(selection);
  const lineItems: BillingLineItemSelection[] = [
    {
      lookupKey: coreLookupKeyForSelection(normalized),
      quantity: 1,
    },
  ];

  const extraLocationQuantity =
    normalized.locationCapacity - DEFAULT_LOCATION_CAPACITY;
  if (extraLocationQuantity > 0) {
    lineItems.push({
      lookupKey: recurringLookupKeyForBillingInterval(
        EXTRA_LOCATION_LOOKUP_KEY,
        normalized.interval
      ),
      quantity: extraLocationQuantity,
    });
  }

  for (const lookupKey of normalized.addonLookupKeys) {
    lineItems.push({
      lookupKey: recurringLookupKeyForBillingInterval(lookupKey, normalized.interval),
      quantity: 1,
    });
  }

  return lineItems;
}

export function pluginsFromLookupKeys(
  lookupKeys: Array<string | null | undefined>
): BillingPlugin[] {
  const granted = new Set<BillingPlugin>();
  for (const key of lookupKeys) {
    if (!key) continue;
    const offer = getBillingOffer(key);
    for (const plugin of offer?.plugins ?? BILLING_PRICE_LOOKUP_PLUGINS[key] ?? []) {
      granted.add(plugin);
    }
  }
  return BILLING_PLUGINS.filter((plugin) => granted.has(plugin));
}

export function asBillingPlugins(values: string[] | null | undefined): BillingPlugin[] {
  if (!values) return [];
  return BILLING_PLUGINS.filter((plugin) => values.includes(plugin));
}

// The sellable catalog. Display copy and prices live here; Stripe owns the
// charging truth — prices are created with these lookup keys
// (scripts/stripe-create-catalog.ts) and the webhook resolves them back to
// plugins via BILLING_PRICE_LOOKUP_PLUGINS above.
export type BillingOfferKind =
  | "core"
  | "extra_location"
  | "plugin"
  | "package"
  | "everything";

export type BillingOffer = {
  lookupKey: string;
  kind: BillingOfferKind;
  name: string;
  blurb: string;
  monthlyUsd: number;
  plugins: readonly BillingPlugin[];
  salesOrderBand?: SalesOrderBand;
  interval?: BillingInterval;
};

const CORE_CATALOG: readonly BillingOffer[] = CORE_PLAN_CATALOG.map((selection) => ({
  lookupKey: selection.lookupKey,
  kind: "core" as const,
  name: `Core ${selection.band}`,
  blurb: "Core ERP with unlimited users, SKUs, integrations, and mobile app.",
  monthlyUsd: selection.monthlyUsd,
  plugins: [],
  salesOrderBand: selection.band,
  interval: selection.interval,
}));

const RECURRING_ADDON_CATALOG: readonly BillingOffer[] = [
  {
    lookupKey: EXTRA_LOCATION_LOOKUP_KEY,
    kind: "extra_location",
    name: "Additional location",
    blurb: "Additional active inventory location capacity.",
    monthlyUsd: 40,
    plugins: [],
  },
  {
    lookupKey: "plugin_lot_tracking",
    kind: "plugin",
    name: "Lot tracking",
    blurb: "Lots, dispositions, and full traceability from intake to shipment.",
    monthlyUsd: 99,
    plugins: ["lot_tracking"],
  },
  {
    lookupKey: "plugin_batch_production",
    kind: "plugin",
    name: "Batch production",
    blurb: "Batch-native manufacturing with per-batch lots and yields.",
    monthlyUsd: 99,
    plugins: ["batch_production"],
  },
  {
    lookupKey: "plugin_crm",
    kind: "plugin",
    name: "CRM",
    blurb: "Contacts, activity log, and projects on every customer.",
    monthlyUsd: 99,
    plugins: ["crm"],
  },
  {
    lookupKey: "plugin_wholesale_pricing",
    kind: "plugin",
    name: "Wholesale pricing",
    blurb: "Pricing schedules with customer- and quantity-based breaks.",
    monthlyUsd: 99,
    plugins: ["wholesale_pricing"],
  },
  {
    lookupKey: "plugin_multi_location",
    kind: "plugin",
    name: "Multi-location",
    blurb: "Stock by location and transfers between sites.",
    monthlyUsd: 99,
    plugins: ["multi_location"],
  },
  {
    lookupKey: "package_food_bev",
    kind: "package",
    name: "Food & Bev",
    blurb: "Lot tracking, batch production, and wholesale pricing.",
    monthlyUsd: 199,
    plugins: BILLING_PACKAGE_PLUGINS.food_bev,
  },
  {
    lookupKey: "package_soil_landscape",
    kind: "package",
    name: "Soil & Landscape",
    blurb: "Batch production, multi-location, and wholesale pricing.",
    monthlyUsd: 199,
    plugins: BILLING_PACKAGE_PLUGINS.soil_landscape,
  },
  {
    lookupKey: "package_wholesale_b2b",
    kind: "package",
    name: "Wholesale B2B",
    blurb: "CRM, wholesale pricing, and multi-location.",
    monthlyUsd: 199,
    plugins: BILLING_PACKAGE_PLUGINS.wholesale_b2b,
  },
  {
    lookupKey: "everything",
    kind: "everything",
    name: "Everything",
    blurb: "Every generally available plugin.",
    monthlyUsd: 399,
    plugins: BILLING_COMMERCIAL_PLUGINS,
  },
];

export const BILLING_CATALOG: readonly BillingOffer[] = [
  ...CORE_PLAN_CATALOG.map((selection) => ({
    lookupKey: selection.lookupKey,
    kind: "core" as const,
    name: `Core ${selection.band}`,
    blurb: "Core ERP with unlimited users, SKUs, integrations, and mobile app.",
    monthlyUsd: selection.monthlyUsd,
    plugins: [],
    salesOrderBand: selection.band,
    interval: selection.interval,
  })),
  ...RECURRING_ADDON_CATALOG,
];

export const STRIPE_BILLING_CATALOG: readonly BillingOffer[] = [
  ...CORE_CATALOG,
  ...RECURRING_ADDON_CATALOG,
  ...RECURRING_ADDON_CATALOG.map((offer) => ({
    ...offer,
    lookupKey: recurringLookupKeyForBillingInterval(offer.lookupKey, "annual"),
    name: `${offer.name} annual`,
    interval: "annual" as const,
  })),
];

export function getBillingOffer(lookupKey: string): BillingOffer | null {
  return STRIPE_BILLING_CATALOG.find((offer) => offer.lookupKey === lookupKey) ?? null;
}

export type BillingState = {
  plan: BillingPlan;
  status: BillingStatus;
  trialEndsAt: Date | null;
  billingInterval: BillingInterval;
  salesOrderBand: SalesOrderBand;
  locationCapacity: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  entitlements: BillingPlugin[];
  billingAddons: BillingAddonLookupKey[];
};

export type BillingOverview = BillingState & {
  billingUsagePeriodStart: Date | null;
  billingUsagePeriodEnd: Date | null;
  skuCount: number;
  salesOrderCount: number;
  locationCount: number;
};
