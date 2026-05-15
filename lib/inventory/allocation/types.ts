export type AllocationDemandType = "sales_order_line";

export type AllocationSourceType = "inventory_lot" | "manufacturing_order";

export type AllocationDemandRef = {
  demandType: AllocationDemandType;
  demandId: string;
};

export type AllocationSourceRef = {
  sourceType: AllocationSourceType;
  sourceId: string;
};

export type AllocationAssignment = AllocationDemandRef &
  AllocationSourceRef & {
    itemId: string;
    quantity: string;
    status: "active";
    sourceLabel: string;
    demandLabel: string;
  };

export type AllocationDemandRow = AllocationDemandRef & {
  demandKey: `${AllocationDemandType}:${string}`;
  parentDemandId: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  openQty: string;
  allocatedQty: string;
  shortQty: string;
  isPrimary: boolean;
  assignments: AllocationAssignment[];
};

export type AllocationSourceRow = AllocationSourceRef & {
  sourceKey: `${AllocationSourceType}:${string}`;
  itemId: string;
  label: string;
  contextLabel: string | null;
  status: string;
  date: string | null;
  priorityRank: number | null;
  totalQty: string;
  allocatedQty: string;
  freeQty: string;
  currentPrimaryQty: string;
  maxQtyForPrimaryDemand: string;
  canAllocate: boolean;
};

export type AllocationWorkspace = {
  item: {
    itemId: string;
    itemName: string;
    unitName: string;
  };
  primaryDemand: AllocationDemandRow | null;
  demands: AllocationDemandRow[];
  sources: AllocationSourceRow[];
  assignments: AllocationAssignment[];
  totals: {
    openQty: string;
    allocatedQty: string;
    shortQty: string;
  };
};

export type SaveAllocationsForDemandInput = AllocationDemandRef & {
  itemId: string;
  allocations: Array<AllocationSourceRef & { quantity: string }>;
  actorUserId?: string | null;
};

export type AllocationDemandAdapterRow = {
  demandType: AllocationDemandType;
  demandId: string;
  parentDemandId?: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  openQty: string;
  sortDate: string | null;
  sortLabel: string;
};

export type AllocationDemandAdapter = {
  demandType: AllocationDemandType;
  loadPrimaryDemandInTx: (
    tx: import("@/lib/db/with-org-context").Tx,
    params: { organizationId: string; demandId: string }
  ) => Promise<AllocationDemandAdapterRow | null>;
  loadOpenDemandsForItemInTx: (
    tx: import("@/lib/db/with-org-context").Tx,
    params: { organizationId: string; itemId: string }
  ) => Promise<AllocationDemandAdapterRow[]>;
  validateDemandItemInTx: (
    tx: import("@/lib/db/with-org-context").Tx,
    params: { organizationId: string; demandId: string; itemId: string }
  ) => Promise<AllocationDemandAdapterRow | null>;
  afterSaveAllocationsInTx?: (
    tx: import("@/lib/db/with-org-context").Tx,
    params: {
      organizationId: string;
      demandId: string;
      itemId: string;
      actorUserId?: string | null;
      inventoryLotAllocationQty: number;
    }
  ) => Promise<void>;
};

export function demandKey(ref: AllocationDemandRef) {
  return `${ref.demandType}:${ref.demandId}` as const;
}

export function sourceKey(ref: AllocationSourceRef) {
  return `${ref.sourceType}:${ref.sourceId}` as const;
}
