import { todayInTimeZone } from "@/lib/format";
import type { InsertSalesOrder } from "@/lib/schemas/sales-orders";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
} from "@/app/(dashboard)/sales/types";

/**
 * A blank SalesOrderDetail used as the local draft on /sales/order before the
 * order exists server-side. The Sales Order draft controller owns this as the
 * live editable document and serializes create/update persistence.
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
    billingLine1: null,
    billingLine2: null,
    billingCity: null,
    billingRegion: null,
    billingPostcode: null,
    billingCountry: null,
    shippingFeeDescription: null,
    shippingFeeAmount: "0",
    shippingFeeTaxAmount: "0",
    subtotalAmount: "0",
    taxAmount: "0",
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
      manualReservationQty: "0",
      manualReservationSummary: null,
      availabilityState: "complete",
      expectedDate: null,
      label: "",
      salesItemsState: "complete",
      salesItemsExpectedDate: null,
      ingredientsState: "not_applicable",
      ingredientsExpectedDate: null,
      ingredientShortages: [],
      productionState: "not_applicable",
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
    taxRates: [],
    defaultTaxRateId: null,
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
  taxRateId?: string | null;
  taxRateName?: string | null;
  taxRatePercent?: string | null;
  estimatedUnitCost: string | null;
}): SalesOrderDetailLine {
  const qty = Number(input.quantity) || 0;
  const price = Number(input.unitPrice) || 0;
  const rate = Number(input.taxRatePercent ?? 0) || 0;
  const lineSubtotal = (qty * price).toFixed(2);
  const lineTaxAmount = (Number(lineSubtotal) * (rate / 100)).toFixed(2);
  const lineTotal = (Number(lineSubtotal) + Number(lineTaxAmount)).toFixed(2);
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
    taxRateId: input.taxRateId ?? null,
    taxRateName: input.taxRateName ?? null,
    taxRatePercent: input.taxRatePercent ?? "0",
    suggestedUnitPrice: null,
    pricingSourceType: null,
    pricingScheduleName: null,
    pricingBreakLabel: null,
    isPriceOverridden: false,
    lineSubtotal,
    lineTaxAmount,
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
    demandQueuePinnedQty: "0",
    demandQueuePinnedDateValidQty: "0",
    demandQueuePinnedDateInvalidQty: "0",
    demandQueueQueueCoveredQty: "0",
    demandQueueSegments: [],
    demandQueueInStockQty: "0",
    demandQueueExpectedQty: "0",
    demandQueueShortQty: input.quantity,
    demandQueueExpectedDate: null,
    fulfillmentSummary: {
      remainingQty: input.quantity,
      allocatedQty: "0",
      shortQty: input.quantity,
      productionAllocatedQty: "0",
      manualReservationQty: "0",
      manualReservationSummary: null,
      availabilityState: "not_available",
      expectedDate: null,
      label: "Not available",
      salesItemsState: "not_available",
      salesItemsExpectedDate: null,
      ingredientsState: "not_applicable",
      ingredientsExpectedDate: null,
      ingredientShortages: [],
      productionState: "not_applicable",
    },
  };
}

/**
 * Serialize a live order into the full update (PUT) payload. Used for line
 * add/remove on a saved order: this reuses the canonical updateSalesOrder DAL
 * (correct reservation release + re-reserve) instead of hand-rolling kernel
 * logic. Shipment rows are legacy history and are never re-created from order
 * edits.
 */
export function orderToUpdatePayload(
  order: SalesOrderDetail,
  mutate?: (lines: SalesOrderDetail["lines"]) => SalesOrderDetail["lines"],
): InsertSalesOrder {
  const lines = mutate ? mutate(order.lines) : order.lines;
  return {
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerProjectId: order.customerProjectId,
    status: "open",
    orderDate: order.orderDate,
    shipDate: order.shipDate,
    requestedDate: order.requestedDate,
    notes: order.notes,
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
    billingLine1: order.billingLine1,
    billingLine2: order.billingLine2,
    billingCity: order.billingCity,
    billingRegion: order.billingRegion,
    billingPostcode: order.billingPostcode,
    billingCountry: order.billingCountry,
    shippingFeeDescription: order.shippingFeeDescription,
    shippingFeeAmount: order.shippingFeeAmount,
    shippingFeeTaxAmount: order.shippingFeeTaxAmount,
    lines: lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateId: line.taxRateId,
    })),
    shipments: [],
  } as InsertSalesOrder;
}

/** Assemble the create payload from the local draft order. */
export function draftToInsertPayload(
  draft: SalesOrderDetail,
  options?: { useServerOrderNumber?: boolean },
): InsertSalesOrder {
  return {
    orderNumber: options?.useServerOrderNumber ? null : draft.orderNumber.trim() || null,
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
    billingLine1: draft.billingLine1,
    billingLine2: draft.billingLine2,
    billingCity: draft.billingCity,
    billingRegion: draft.billingRegion,
    billingPostcode: draft.billingPostcode,
    billingCountry: draft.billingCountry,
    shippingFeeDescription: draft.shippingFeeDescription,
    shippingFeeAmount: draft.shippingFeeAmount,
    shippingFeeTaxAmount: draft.shippingFeeTaxAmount,
    lines: draft.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateId: line.taxRateId,
    })),
    shipments: [],
  } as InsertSalesOrder;
}
