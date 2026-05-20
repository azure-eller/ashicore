import { todayInTimeZone } from "@/lib/format";
import type {
  InsertSalesOrder,
  PatchSalesOrderHeader,
} from "@/lib/schemas/sales-orders";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
} from "@/app/(dashboard)/sales/types";

/**
 * In draft mode (/sales/order before the order exists) the sections write to
 * local state through this controller instead of hitting PATCH endpoints. When
 * absent, sections use their live per-field PATCH mutations.
 */
export type OrderDraftController = {
  /** Accepts header PATCH fields plus denormalized display fields (customerName,
   *  customerEmail, customerProjectName) so the draft renders without a refetch. */
  patchHeader: (
    patch: PatchSalesOrderHeader &
      Partial<
        Pick<
          SalesOrderDetail,
          "customerName" | "customerEmail" | "customerProjectName"
        >
      >,
  ) => void;
  addLine: (line: SalesOrderDetailLine) => void;
  updateLine: (
    lineId: string,
    patch: { quantity?: string; unitPrice?: string },
  ) => void;
  removeLine: (lineId: string) => void;
};

/**
 * A blank SalesOrderDetail used as the local draft on /sales/order before the
 * order exists server-side. Mirrors ProductCard's emptyCard() pattern — the
 * same <OrderCard> renders this in draft mode, then swaps to live data after
 * the create POST succeeds.
 */
export function makeDraftOrder(timeZone: string): SalesOrderDetail {
  const today = todayInTimeZone(timeZone);
  return {
    id: "",
    customerId: "",
    customerName: "",
    customerEmail: null,
    customerProjectId: null,
    customerProjectName: null,
    orderNumber: "",
    status: "open",
    orderDate: today,
    shipDate: null,
    requestedDate: null,
    notes: null,
    shippedAt: null,
    shipLine1: null,
    shipLine2: null,
    shipCity: null,
    shipRegion: null,
    shipPostcode: null,
    shipCountry: null,
    xeroInvoiceId: null,
    xeroInvoiceNumber: null,
    xeroPushStatus: null,
    xeroPushError: null,
    xeroPushedAt: null,
    xeroPushPayloadHash: null,
    xeroLastPushAttemptAt: null,
    xeroRetryCount: 0,
    xeroEmailStatus: null,
    xeroEmailError: null,
    xeroEmailedAt: null,
    totalAmount: "0",
    hasManufacturableLines: false,
    manufacturableLineCount: 0,
    manufacturableDisabledReason: null,
    fulfillmentSummary: {
      remainingQty: "0",
      allocatedQty: "0",
      shortQty: "0",
      productionAllocatedQty: "0",
      label: "",
    },
    shippingReadiness: {
      state: "not_confirmed",
      message: "",
      blockers: [],
    },
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [],
    shipments: [],
    marginSummary: {
      productRevenue: "0",
      freightRecovery: "0",
      productCogs: null,
      shipmentCosts: "0",
      contributionMargin: null,
      marginPercent: null,
      costStatus: "unknown",
    },
    linkedManufacturingOrders: [],
  };
}

/** A new local line for the draft, before the order exists server-side. */
export function makeDraftLine(input: {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  estimatedUnitCost: string | null;
}): SalesOrderDetailLine {
  const qty = Number(input.quantity) || 0;
  const price = Number(input.unitPrice) || 0;
  const lineTotal = (qty * price).toFixed(2);
  return {
    id: `draft-${crypto.randomUUID()}`,
    itemId: input.itemId,
    itemName: input.itemName,
    masterName: input.itemName,
    attrs: [],
    itemSku: input.itemSku,
    unitName: input.unitName,
    quantity: input.quantity,
    shippedQuantity: "0",
    plannedQuantity: "0",
    cancelledQuantity: "0",
    remainingQuantity: input.quantity,
    unplannedRemainingQuantity: input.quantity,
    unitPrice: input.unitPrice,
    suggestedUnitPrice: null,
    pricingSourceType: null,
    pricingScheduleName: null,
    pricingBreakLabel: null,
    isPriceOverridden: false,
    lineTotal,
    estimatedUnitCost: input.estimatedUnitCost,
    estimatedCogs:
      input.estimatedUnitCost != null
        ? (qty * Number(input.estimatedUnitCost)).toFixed(2)
        : null,
    estimatedGrossProfit: null,
    estimatedMarginPercent:
      input.estimatedUnitCost != null && price > 0
        ? (((price - Number(input.estimatedUnitCost)) / price) * 100).toFixed(1)
        : null,
    actualUnitCost: null,
    actualCogs: null,
    actualGrossProfit: null,
    actualMarginPercent: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    onHandQty: null,
    availableQty: null,
    allocatedQty: "0",
    potential: null,
    shortQty: "0",
    sourceSummary: "",
    allocationStatus: "short",
    allocationSources: [],
  };
}

/** Assemble the create payload from the local draft order. */
export function draftToInsertPayload(draft: SalesOrderDetail): InsertSalesOrder {
  return {
    orderNumber: null,
    customerId: draft.customerId,
    customerProjectId: draft.customerProjectId,
    status: "open",
    orderDate: draft.orderDate,
    shipDate: draft.shipDate,
    requestedDate: draft.requestedDate,
    notes: draft.notes,
    shipLine1: draft.shipLine1,
    shipLine2: draft.shipLine2,
    shipCity: draft.shipCity,
    shipRegion: draft.shipRegion,
    shipPostcode: draft.shipPostcode,
    shipCountry: draft.shipCountry,
    lines: draft.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    shipments: [],
  } as InsertSalesOrder;
}
