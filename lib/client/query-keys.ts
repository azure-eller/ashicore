/**
 * Canonical TanStack Query keys. Every queryKey, invalidateQueries target, and
 * setQueryData key in app/components code must come from here — inline arrays
 * drift (three dead invalidation targets shipped before this factory existed)
 * and are blocked by lint.
 *
 * Detail keys extend their list root (["sales-orders", id]) so invalidating
 * the root refreshes open detail views too. Card read-models (item-card,
 * customer-card) are deliberately separate roots: they are draft-save
 * surfaces with their own setQueryData flows, not row caches.
 */
export const queryKeys = {
  items: {
    root: ["items"] as const,
    list: (organizationId: string, itemType: string) =>
      ["items", organizationId, itemType] as const,
    allocation: (organizationId: string) =>
      ["items", organizationId, "allocation"] as const,
    history: (itemId: string, mode: string, days: number) =>
      ["items", itemId, "history", mode, days] as const,
  },
  itemCards: {
    root: ["item-card"] as const,
    detail: (itemId: string) => ["item-card", itemId] as const,
    variantsPreview: (itemId: string) =>
      ["item-card", itemId, "variants-preview"] as const,
    variantConfigSources: (itemType: string) =>
      ["item-card", itemType, "variant-config-sources"] as const,
  },
  itemLots: {
    byVariant: (variantId: string) => ["item-lots", variantId] as const,
  },
  itemLocationBalances: {
    root: ["item-location-balances"] as const,
    byItem: (itemId: string | null) => ["item-location-balances", itemId] as const,
  },
  locations: {
    root: ["locations"] as const,
  },
  itemCategories: {
    byType: (itemType: string) => ["item-categories", itemType] as const,
  },
  productTabs: {
    recipe: (variantId: string) => ["product-recipe-tab", variantId] as const,
    production: (variantId: string) =>
      ["product-production-tab", variantId] as const,
  },
  stocktakes: {
    root: ["stocktakes"] as const,
  },
  customers: {
    root: ["customers"] as const,
    list: (view: string) => ["customers", view] as const,
    card: (customerId: string) => ["customer-card", customerId] as const,
  },
  salesOrders: {
    root: ["sales-orders"] as const,
    detail: (orderId: string) => ["sales-orders", orderId] as const,
    manufacturingPreview: (orderId: string) =>
      ["sales-orders", orderId, "manufacturing-preview"] as const,
  },
  pricingSchedules: {
    root: ["pricing-schedules"] as const,
  },
  suppliers: {
    root: ["suppliers"] as const,
    card: (supplierId: string) => ["supplier-card", supplierId] as const,
  },
  purchaseOrders: {
    root: ["purchase-orders"] as const,
    detail: (orderId: string) => ["purchase-orders", orderId] as const,
    receive: (orderId: string) => ["purchase-orders", orderId, "receive"] as const,
  },
  manufacturingOrders: {
    root: ["manufacturing-orders"] as const,
    detail: (orderId: string) => ["manufacturing-orders", orderId] as const,
  },
  manufacturingResources: {
    root: ["manufacturing-resources"] as const,
  },
  team: {
    root: ["team"] as const,
  },
  agentAccess: {
    root: ["agent-access"] as const,
  },
  xeroAccounts: {
    root: ["xero-accounts"] as const,
    byTenant: (tenantId: string) => ["xero-accounts", tenantId] as const,
  },
  quickbooksAccounts: {
    byTenant: (tenantId: string) => ["quickbooks-accounts", tenantId] as const,
  },
  accountingAccounts: {
    byProvider: (providerLabel: string | null) =>
      ["accounting-accounts", providerLabel] as const,
  },
} as const;
