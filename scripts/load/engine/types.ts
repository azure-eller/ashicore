// Opening stock can be entered as a bare string (in the seed's stock unit)
// or as { quantity, unitKey } where unitKey is the seed's purchase unit
// (the engine converts via purchaseToStockFactor at write time).
export type InitialStockEntry =
  | string
  | { quantity: string; unitKey: string };

export type UnitSeed = {
  key: string;
  name: string;
  size: string;
  uom: string;
};

export type ItemSeed = {
  key: string;
  sku: string;
  name: string;
  itemType: "material" | "product";
  unitKey: string;
  category: string;
  description: string;
  defaultPurchasePrice?: string | null;
  currentStockUnitCost?: string | null;
  defaultSellingPrice?: string | null;
  purchaseUnitKey?: string;
  purchaseToStockFactor?: string;
  manufacturingMode?: "discrete" | "batch";
  expectedBatchYield?: string | null;
  bom?: Array<{ componentKey: string; quantity: string }>;
  unresolvedFormulaNote?: string;
  legacySkus?: string[];
  legacyNames?: string[];
  isMaster?: boolean;
  parentKey?: string;
  variantAxes?: string[];
  variantAttrs?: Record<string, string>;
  sellable?: boolean;
};

export type ExistingUnit = {
  id: string;
  name: string;
  size: string;
  uom: string;
  deletedAt: Date | null;
};

export type ExistingItem = {
  id: string;
  sku: string | null;
  name: string;
  itemType: string;
  unitDefinitionId: string | null;
  purchaseUnitDefinitionId: string | null;
  purchaseToStockFactor: string | null;
  category: string | null;
  description: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
  defaultSellingPrice: string | null;
  manufacturingMode: string;
  expectedBatchYield: string | null;
  isMaster: boolean;
  parentId: string | null;
  variantAxes: string[] | null;
  variantAttrs: Record<string, string> | null;
  sellable: boolean | null;
  deletedAt: Date | null;
};

export type ExistingBomRow = {
  itemId: string;
  componentId: string;
  quantity: string;
};

export type BomSeedRow = {
  componentId: string;
  quantity: string;
};

export type ExistingCustomer = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  deletedAt: Date | null;
};

export type ExistingSalesOrder = {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  requestedDate: string | null;
  notes: string | null;
  lineSignature: string;
};

export type CustomerSeed = {
  name: string;
  address: string | null;
  phone: string | null;
};

export type SupplierSeed = {
  name: string;
  code: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingRegion?: string | null;
  billingPostcode?: string | null;
  billingCountry?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
};

export type CustomerPlan = {
  key: string;
  seed: CustomerSeed;
  existingId: string | null;
  action: "create" | "reactivate" | "update" | "unchanged";
  nextAddress: string | null;
  nextPhone: string | null;
  nextNotes: string | null;
};

export type PreparedSalesImportLine = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
};

export type ReadySalesImportOrder = {
  kind: "ready";
  label: string;
  sourceRows: number[];
  existingId: string | null;
  existingOrderNumber: string | null;
  customerKey: string;
  customerName: string;
  notes: string | null;
  totalAmount: string;
  lines: PreparedSalesImportLine[];
  requestedDate: string | null;
};

export type SkippedSalesImportOrder = {
  kind: "skipped";
  label: string;
  sourceRows: number[];
  issues: string[];
};

export type EvaluatedSalesImportOrder =
  | ReadySalesImportOrder
  | SkippedSalesImportOrder;

export type SalesImportEvaluation = {
  customerPlans: CustomerPlan[];
  existingCustomerIdByKey: Map<string, string>;
  orders: EvaluatedSalesImportOrder[];
};

export type SalesImportReport = {
  createdCustomers: string[];
  updatedCustomers: string[];
  reactivatedCustomers: string[];
  unchangedCustomers: string[];
  createdOrders: string[];
  existingOrders: string[];
  skippedOrders: Array<{
    label: string;
    sourceRows: number[];
    issues: string[];
  }>;
};

export type Report = {
  createdUnits: string[];
  updatedUnits: string[];
  reactivatedUnits: string[];
  unchangedUnits: string[];
  createdItems: string[];
  updatedItems: string[];
  reactivatedItems: string[];
  unchangedItems: string[];
  syncedBoms: string[];
  unchangedBoms: string[];
  unresolvedFormulae: string[];
  stockLotsCreated: string[];
  stockLotsExisting: string[];
  stockLotsSkippedMissingCost: string[];
  createdSuppliers: string[];
  updatedSuppliers: string[];
  reactivatedSuppliers: string[];
  unchangedSuppliers: string[];
  repairedSoSnapshots: number;
};

export function createEmptyReport(): Report {
  return {
    createdUnits: [],
    updatedUnits: [],
    reactivatedUnits: [],
    unchangedUnits: [],
    createdItems: [],
    updatedItems: [],
    reactivatedItems: [],
    unchangedItems: [],
    syncedBoms: [],
    unchangedBoms: [],
    unresolvedFormulae: [],
    stockLotsCreated: [],
    stockLotsExisting: [],
    stockLotsSkippedMissingCost: [],
    createdSuppliers: [],
    updatedSuppliers: [],
    reactivatedSuppliers: [],
    unchangedSuppliers: [],
    repairedSoSnapshots: 0,
  };
}

export function createEmptySalesImportReport(): SalesImportReport {
  return {
    createdCustomers: [],
    updatedCustomers: [],
    reactivatedCustomers: [],
    unchangedCustomers: [],
    createdOrders: [],
    existingOrders: [],
    skippedOrders: [],
  };
}

export type OrderSeedLine =
  | {
      kind: "mapped";
      product: string;
      quantity: string;
      raw: string;
      priceOverride?: string;
    }
  | {
      kind: "unmapped";
      raw: string;
      reason: string;
    };

export type OrderSeed = {
  sourceRows: number[];
  customerName: string;
  reference: string | null;
  address: string | null;
  contact: string | null;
  specialInstructions: string | null;
  lines: OrderSeedLine[];
};

export type SalesImportConfig = {
  orderSeeds: OrderSeed[];
  productAliasToSeedKey: Record<string, string>;
  requestedDateBySourceRow: Record<number, string>;
  customerNotesDefault: string;
  orderMarkerPrefix: string;
};

export type LoaderConfig = {
  customerSlug: string;
  customerLabel: string;
  defaultOrgRef: string;
  units: UnitSeed[];
  seeds: ItemSeed[];
  initialStockByKey: Record<string, InitialStockEntry>;
  suppliers?: SupplierSeed[];
  openingLotPrefix: string;
  internalOnlyProductCategories?: Set<string>;
  bomRevisionNote?: string;
  salesImport?: SalesImportConfig;
};
