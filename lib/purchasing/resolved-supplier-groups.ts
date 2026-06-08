export type ResolvedSupplier = {
  id: string;
  name: string;
  email?: string | null;
};

export type ResolvedSupplierLine = {
  id: string;
};

export type ResolvedSupplierCost = {
  id: string;
  supplierId?: string | null;
};

export type ResolvedSupplierGroup<
  TLine extends ResolvedSupplierLine,
  TCost extends ResolvedSupplierCost,
> = {
  key: string;
  supplier: ResolvedSupplier;
  isPurchaseOrderSupplier: boolean;
  lines: TLine[];
  additionalCosts: TCost[];
};

export function resolvedPurchaseOrderSupplierGroupKey(supplierId: string) {
  return `supplier:${supplierId}`;
}

export function resolvedAdditionalCostSupplierGroupKey(supplierId: string) {
  return `additional-cost:${supplierId}`;
}

export function resolveCostSupplierId(
  purchaseOrderSupplierId: string,
  cost: ResolvedSupplierCost,
) {
  return cost.supplierId || purchaseOrderSupplierId;
}

export function groupPurchaseOrderByResolvedSupplier<
  TLine extends ResolvedSupplierLine,
  TCost extends ResolvedSupplierCost,
>(params: {
  purchaseOrderSupplier: ResolvedSupplier;
  suppliersById?: Map<string, ResolvedSupplier>;
  lines: TLine[];
  additionalCosts: TCost[];
}): ResolvedSupplierGroup<TLine, TCost>[] {
  const groups = new Map<string, ResolvedSupplierGroup<TLine, TCost>>();
  const purchaseOrderSupplier = params.purchaseOrderSupplier;
  const supplierLookup =
    params.suppliersById ?? new Map<string, ResolvedSupplier>();

  const getGroup = (supplierId: string) => {
    const isPurchaseOrderSupplier = supplierId === purchaseOrderSupplier.id;
    const key = isPurchaseOrderSupplier
      ? resolvedPurchaseOrderSupplierGroupKey(supplierId)
      : resolvedAdditionalCostSupplierGroupKey(supplierId);
    const existing = groups.get(key);

    if (existing) return existing;

    const supplier =
      supplierLookup.get(supplierId) ??
      (isPurchaseOrderSupplier
        ? purchaseOrderSupplier
        : { id: supplierId, name: "Supplier" });
    const group: ResolvedSupplierGroup<TLine, TCost> = {
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
    getGroup(resolveCostSupplierId(purchaseOrderSupplier.id, cost)).additionalCosts.push(
      cost,
    );
  }

  return [...groups.values()].filter(
    (group) => group.lines.length > 0 || group.additionalCosts.length > 0,
  );
}
