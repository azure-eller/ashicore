import type { InventoryEventType } from "@/lib/db/schema";
import type {
  InventoryLedgerBalanceDimension,
  InventoryLedgerEventClass,
  InventoryLedgerMetadataSummaryEntry,
  InventoryLedgerSourceType,
} from "@/lib/inventory/ledger";
import type { InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import type { ItemType } from "../types";

export type InventoryLedgerActorOption = {
  id: string;
  name: string;
  email: string;
};

export type InventoryLedgerRow = {
  id: string;
  occurredAt: Date;
  item: {
    id: string;
    name: string;
    displayName: string;
    sku: string | null;
    itemType: ItemType;
    unitName: string | null;
    href: string;
  };
  eventClass: InventoryLedgerEventClass;
  eventType: InventoryEventType;
  eventSubtype: string | null;
  eventLabel: string;
  quantity: string;
  signedQuantity: string;
  onHandAfter: string | null;
  balanceDimension: InventoryLedgerBalanceDimension;
  lot: {
    id: string;
    number: string;
  } | null;
  sourceDocument: {
    id: string | null;
    type: InventoryLedgerSourceType;
    label: string;
    href: string | null;
  } | null;
  sourceContext: {
    supplierName: string | null;
    customerName: string | null;
    manufacturingProduct: {
      id: string | null;
      name: string;
      href: string | null;
    } | null;
  };
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
  unitCost: string | null;
  extendedCost: string | null;
  referenceType: string | null;
  referenceId: string | null;
  metadataSummary: InventoryLedgerMetadataSummaryEntry[];
};

export type InventoryLedgerPageData = {
  rows: InventoryLedgerRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  resolvedFilters: {
    itemLabel: string | null;
    documentLabel: string | null;
  };
};

export type InventoryLedgerPageProps = {
  initialData: InventoryLedgerPageData;
  initialFilters: InventoryLedgerFilters;
  actorOptions: InventoryLedgerActorOption[];
};
