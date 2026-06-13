export const BILLING_PLANS = ["free", "core"] as const;
export const BILLING_STATUSES = ["active", "past_due", "canceled"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_PLUGINS = [
  "lot_tracking",
  "batch_production",
  "crm",
  "wholesale_pricing",
  "multi_location",
] as const;

export type BillingPlugin = (typeof BILLING_PLUGINS)[number];

export const BILLING_PLUGIN_LABELS: Record<BillingPlugin, string> = {
  lot_tracking: "Lot tracking",
  batch_production: "Batch production",
  crm: "CRM",
  wholesale_pricing: "Wholesale pricing",
  multi_location: "Multi-location",
};

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
  everything: BILLING_PLUGINS,
};

export function pluginsFromLookupKeys(
  lookupKeys: Array<string | null | undefined>
): BillingPlugin[] {
  const granted = new Set<BillingPlugin>();
  for (const key of lookupKeys) {
    if (!key) continue;
    for (const plugin of BILLING_PRICE_LOOKUP_PLUGINS[key] ?? []) {
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
export type BillingOfferKind = "plugin" | "package" | "everything";

export type BillingOffer = {
  lookupKey: string;
  kind: BillingOfferKind;
  name: string;
  blurb: string;
  monthlyUsd: number;
  plugins: readonly BillingPlugin[];
};

export const BILLING_CATALOG: readonly BillingOffer[] = [
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
    blurb: "Every plugin, current and future.",
    monthlyUsd: 399,
    plugins: BILLING_PLUGINS,
  },
];

export function getBillingOffer(lookupKey: string): BillingOffer | null {
  return BILLING_CATALOG.find((offer) => offer.lookupKey === lookupKey) ?? null;
}

export type BillingState = {
  plan: BillingPlan;
  status: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  entitlements: BillingPlugin[];
};

export type BillingOverview = BillingState & {
  skuCount: number;
};
