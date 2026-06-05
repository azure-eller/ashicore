export type ResolvedVendorSupplier = {
  id: string;
  name: string;
  email?: string | null;
};

export type ResolvedVendorLine = {
  id: string;
};

export type ResolvedVendorCost = {
  id: string;
  vendorOverrideSupplierId?: string | null;
};

export type ResolvedVendorGroup<
  TLine extends ResolvedVendorLine,
  TCost extends ResolvedVendorCost,
> = {
  key: string;
  supplier: ResolvedVendorSupplier;
  isPurchaseOrderSupplier: boolean;
  lines: TLine[];
  additionalCosts: TCost[];
};

export function resolvedPurchaseOrderVendorGroupKey(supplierId: string) {
  return `supplier:${supplierId}`;
}

export function resolvedFreightVendorGroupKey(supplierId: string) {
  return `freight:${supplierId}`;
}

export function resolveCostVendorId(
  purchaseOrderSupplierId: string,
  cost: ResolvedVendorCost,
) {
  return cost.vendorOverrideSupplierId || purchaseOrderSupplierId;
}

export function groupPurchaseOrderByResolvedVendor<
  TLine extends ResolvedVendorLine,
  TCost extends ResolvedVendorCost,
>(params: {
  purchaseOrderSupplier: ResolvedVendorSupplier;
  suppliersById?: Map<string, ResolvedVendorSupplier>;
  lines: TLine[];
  additionalCosts: TCost[];
}): ResolvedVendorGroup<TLine, TCost>[] {
  const groups = new Map<string, ResolvedVendorGroup<TLine, TCost>>();
  const purchaseOrderSupplier = params.purchaseOrderSupplier;
  const supplierLookup =
    params.suppliersById ?? new Map<string, ResolvedVendorSupplier>();

  const getGroup = (supplierId: string) => {
    const isPurchaseOrderSupplier = supplierId === purchaseOrderSupplier.id;
    const key = isPurchaseOrderSupplier
      ? resolvedPurchaseOrderVendorGroupKey(supplierId)
      : resolvedFreightVendorGroupKey(supplierId);
    const existing = groups.get(key);

    if (existing) return existing;

    const supplier =
      supplierLookup.get(supplierId) ??
      (isPurchaseOrderSupplier
        ? purchaseOrderSupplier
        : { id: supplierId, name: "Vendor" });
    const group: ResolvedVendorGroup<TLine, TCost> = {
      key,
      supplier,
      isPurchaseOrderSupplier,
      lines: [],
      additionalCosts: [],
    };
    groups.set(key, group);
    return group;
  };

  getGroup(purchaseOrderSupplier.id).lines.push(...params.lines);

  for (const cost of params.additionalCosts) {
    getGroup(resolveCostVendorId(purchaseOrderSupplier.id, cost)).additionalCosts.push(
      cost,
    );
  }

  return [...groups.values()].filter(
    (group) => group.lines.length > 0 || group.additionalCosts.length > 0,
  );
}
