export const BILLING_PLANS = ["free", "core"] as const;
export const BILLING_STATUSES = ["active", "past_due", "canceled"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const FREE_SKU_LIMIT = 50;

export const BILLING_PLUGINS = [
  "lot_tracking",
  "batch_production",
  "planning",
  "crm",
  "wholesale_pricing",
  "multi_location",
] as const;

export type BillingPlugin = (typeof BILLING_PLUGINS)[number];

export const BILLING_PLUGIN_LABELS: Record<BillingPlugin, string> = {
  lot_tracking: "Lot tracking",
  batch_production: "Batch production",
  planning: "Planning",
  crm: "CRM",
  wholesale_pricing: "Wholesale pricing",
  multi_location: "Multi-location",
};

export const BILLING_PACKAGE_PLUGINS = {
  food_bev: ["lot_tracking", "batch_production", "planning"],
  soil_landscape: ["batch_production", "multi_location", "wholesale_pricing"],
  wholesale_b2b: ["crm", "wholesale_pricing", "planning"],
} as const satisfies Record<string, readonly BillingPlugin[]>;

// Stripe price lookup keys → granted plugins. Prices are created in Stripe with
// these lookup keys; no per-price env vars or deploys to add one.
export const BILLING_PRICE_LOOKUP_PLUGINS: Record<string, readonly BillingPlugin[]> = {
  plugin_lot_tracking: ["lot_tracking"],
  plugin_batch_production: ["batch_production"],
  plugin_planning: ["planning"],
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

export type BillingState = {
  plan: BillingPlan;
  status: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  entitlements: BillingPlugin[];
};

export type BillingSkuEntitlement = BillingState & {
  skuLimit: number | null;
  skuCount: number;
  canCreateSku: boolean;
  enforcementEnabled: boolean;
};
