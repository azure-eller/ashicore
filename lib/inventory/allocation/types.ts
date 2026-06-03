export type AllocationDemandType =
  | "sales_order_line"
  | "manufacturing_order_ingredient";

export type AllocationSourceType = "inventory_lot" | "manufacturing_order";

export type AllocationDemandRef = {
  demandType: AllocationDemandType;
  demandId: string;
};

export type AllocationSourceRow = {
  sourceType: AllocationSourceType;
  sourceId: string;
  itemId: string;
  label: string;
  date: string | null;
  linkedSalesOrderLineId?: string | null;
  totalQty: string;
};

export type AllocationDemandAdapterRow = {
  demandType: AllocationDemandType;
  demandId: string;
  parentDemandId?: string | null;
  salesOrderId?: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  openQty: string;
  pickedQty?: string | null;
  href?: string | null;
  sortDate: string | null;
  sortLabel: string;
  // Ranking from the parent document (SO/MO), used by demand-queue mode so the
  // queue engine never has to know about SO/MO schemas.
  priorityRank: number | null;
  priorityDate: string | null;
  priorityLabel: string;
  supplyPolicy?: "any" | "linked_only";
  minimumLotAgeDays?: number | null;
};

export type AllocationDemandAdapter = {
  demandType: AllocationDemandType;
  loadOpenDemandsForItemsInTx: (
    tx: import("@/lib/db/with-org-context").Tx,
    params: { organizationId: string; itemIds: string[] }
  ) => Promise<AllocationDemandAdapterRow[]>;
};
