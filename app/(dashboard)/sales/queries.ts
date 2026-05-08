import "server-only";

import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  formatVariantDisplay,
  formatQuantity,
  normalizeNumericScale,
  normalizeNumeric,
  normalizeMoney,
  parsePositive,
  resolveVariantDisplay,
  roundQuantity,
  summarizeItems,
} from "@/lib/format";
import {
  customerCategories,
  customers,
  inventoryEvents,
  inventoryReservationsSummary,
  items,
  manufacturingOrders,
  pricingScheduleBreaks,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  salesShipmentCosts,
  salesShipmentLines,
  salesShipments,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  consumeForShipmentInTx,
  defaultLocationIdSubquery,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getSalesLineQuantitiesForReservationInTx,
  InsufficientStockError,
  lockItemsInTx,
  releaseReservationForSalesLineInTx,
  releaseReservationForSalesQuantitiesInTx,
  projectedAvailableQty,
  projectedCommittedQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedOnHandQty,
  projectedOnHandQtyExpr,
  projectedPotentialQty,
  projectedReservableOnHandQtyExpr,
  projectedShortageQty,
  reserveForSalesInTx,
} from "@/lib/inventory/kernel";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import {
  calculateMarginMetrics,
  calculateUnitMarginMetrics,
} from "@/lib/margin";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { InsertCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import type {
  InsertCustomerCategory,
  UpdateCustomerCategory,
} from "@/lib/schemas/customer-categories";
import type {
  InsertPricingSchedule,
  ResolveSalesLinePricingInput,
  UpdatePricingSchedule,
} from "@/lib/schemas/pricing-schedules";
import type {
  BulkConfirmSalesOrders,
  SalesFulfillmentPlanInput,
  InsertSalesOrder,
  SalesShipmentCostsInput,
  SalesShipmentInput,
  ShipSalesShipment,
  UpdateSalesOrder,
} from "@/lib/schemas/sales-orders";
import type {
  BulkOversellWarningPayload,
  CustomerCategoryOption,
  CustomerCategoryRow,
  CustomerRow,
  OversellWarningPayload,
  PricingScheduleEditData,
  PricingScheduleRow,
  PricingSourceType,
  PricingUnitOption,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderEditData,
  SalesLinePricingResult,
  SalesOrderListRow,
  SalesShippingQueueRow,
  SalesOrderItemOption,
  SalesShippingReadiness,
  SalesMarginSummary,
  SalesShipmentRow,
} from "./types";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import { getEstimatedUnitCostsByItemIdInTx } from "@/lib/inventory/estimated-cost";

const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
const committedQtySubquery = projectedCommittedQty(
  items.organizationId,
  items.id
).as("committedQty");
const demandQtySubquery = projectedDemandQty(
  items.organizationId,
  items.id
).as("demandQty");
const shortageQtySubquery = projectedShortageQty(
  items.organizationId,
  items.id
).as("shortageQty");
const availableQtySubquery = projectedAvailableQty(
  items.organizationId,
  items.id
).as("availableQty");
const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");

type ShipmentCostSelection = {
  amount: number;
  status: SalesMarginSummary["costStatus"];
};

function parseMoneyValue(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function combineMarginStatuses(
  statuses: SalesMarginSummary["costStatus"][]
): SalesMarginSummary["costStatus"] {
  if (statuses.length === 0 || statuses.includes("unknown")) {
    return "unknown";
  }

  const unique = new Set(statuses);
  if (unique.size > 1) {
    return "mixed";
  }

  return statuses[0] ?? "unknown";
}

function selectShipmentCostAmount(
  costs: SalesShipmentRow["costs"],
  fallbackStatus: SalesMarginSummary["costStatus"]
): ShipmentCostSelection {
  const actualCosts = costs.filter((cost) => cost.costStatus === "actual");
  if (actualCosts.length > 0) {
    return {
      amount: actualCosts.reduce((sum, cost) => sum + parseMoneyValue(cost.amount), 0),
      status: "actual",
    };
  }

  const estimatedCosts = costs.filter((cost) => cost.costStatus === "estimated");
  if (estimatedCosts.length > 0) {
    return {
      amount: estimatedCosts.reduce(
        (sum, cost) => sum + parseMoneyValue(cost.amount),
        0
      ),
      status: "estimated",
    };
  }

  return {
    amount: 0,
    status: fallbackStatus,
  };
}

function buildSalesMarginSummary(params: {
  productRevenue: number;
  freightRecovery: number;
  productCogs: number | null;
  shipmentCosts: number;
  costStatus: SalesMarginSummary["costStatus"];
}): SalesMarginSummary {
  const revenue = params.productRevenue + params.freightRecovery;
  const totalCosts =
    params.productCogs == null ? null : params.productCogs + params.shipmentCosts;
  const metrics =
    totalCosts == null
      ? null
      : calculateMarginMetrics({
          revenue,
          cogs: totalCosts,
        });

  return {
    productRevenue: normalizeMoney(params.productRevenue),
    freightRecovery: normalizeMoney(params.freightRecovery),
    productCogs: params.productCogs == null ? null : normalizeMoney(params.productCogs),
    shipmentCosts: normalizeMoney(params.shipmentCosts),
    contributionMargin: metrics?.grossProfit ?? null,
    marginPercent: metrics?.marginPercent ?? null,
    costStatus: params.costStatus,
  };
}

async function getActualSalesLineCostsByLineIdInTx(tx: Tx, salesOrderId: string) {
  const salesOrderLineIdExpr = sql<string>`(${inventoryEvents.metadata}->>'salesOrderLineId')`;
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLineIdExpr.as("salesOrderLineId"),
      quantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
        "quantity"
      ),
      cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
        "cogs"
      ),
    })
    .from(inventoryEvents)
    .where(
      and(
        eq(inventoryEvents.eventType, "sales_consumption"),
        sql`${inventoryEvents.metadata}->>'salesOrderLineId' IS NOT NULL`,
        sql`(
          (${inventoryEvents.referenceType} = 'sales_order' AND ${inventoryEvents.referenceId} = ${salesOrderId})
          OR ${inventoryEvents.metadata}->>'salesOrderId' = ${salesOrderId}
        )`
      )
    )
    .groupBy(salesOrderLineIdExpr);

  return new Map(rows.map((row) => [row.salesOrderLineId, row]));
}

async function getActualShipmentCogsByShipmentIdInTx(
  tx: Tx,
  shipmentIds: string[]
) {
  if (shipmentIds.length === 0) {
    return new Map<string, { quantity: string; cogs: string }>();
  }

  const rows = await tx
    .select({
      shipmentId: inventoryEvents.referenceId,
      quantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
        "quantity"
      ),
      cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
        "cogs"
      ),
    })
    .from(inventoryEvents)
    .where(
      and(
        inArray(inventoryEvents.referenceId, shipmentIds),
        eq(inventoryEvents.referenceType, "sales_shipment"),
        eq(inventoryEvents.eventType, "sales_consumption")
      )
    )
    .groupBy(inventoryEvents.referenceId);

  return new Map(
    rows.flatMap((row) =>
      row.shipmentId == null ? [] : [[row.shipmentId, { quantity: row.quantity, cogs: row.cogs }]]
    )
  );
}

type PreparedOrderLineBase = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
};

type PreparedOrderLine = PreparedOrderLineBase & {
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  isPriceOverridden: boolean;
};

type SalesItemValidationRow = {
  id: string;
  itemType: string;
  name: string;
  sku: string | null;
  parentId: string | null;
  variantAttrs: Record<string, string> | null;
  unitDefinitionId: string;
  unitName: string;
  defaultSellingPrice: string | null;
  stock: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  displayName: string;
};

type ValidatedCustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
};

type PricingScheduleRecord = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  unitDefinitionId: string;
};

type PricingScheduleBreakRecord = {
  id: string;
  pricingScheduleId: string;
  minQuantity: string;
  maxQuantity: string | null;
  discountPercent: string;
  sortOrder: number;
};

type DraftOrderConfirmationPayload = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  shipDate: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  preparedLines: PreparedOrderLineBase[];
  affectedItemIds: string[];
};

function formatPricingUnitLabel(unit: {
  name: string;
  size: string;
  uom: string;
}) {
  return `${unit.name} (${formatQuantity(unit.size)} ${unit.uom})`;
}

function formatPricingBreakLabel(
  minQuantity: string,
  maxQuantity: string | null
) {
  const min = formatQuantity(minQuantity);
  if (maxQuantity == null) {
    return `${min}+`;
  }

  return `${min}-${formatQuantity(maxQuantity)}`;
}

function summarizePricingBreaks(
  breaks: Array<{
    minQuantity: string;
    maxQuantity: string | null;
    discountPercent: string;
  }>
) {
  return breaks
    .map((pricingBreak) => {
      const label = formatPricingBreakLabel(
        pricingBreak.minQuantity,
        pricingBreak.maxQuantity
      );
      return `${label} (${formatQuantity(pricingBreak.discountPercent)}%)`;
    })
    .join(", ");
}

async function ensureCustomerCategoryExistsInTx(
  tx: Tx,
  customerCategoryId: string | null
) {
  if (customerCategoryId == null) {
    return;
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(
      and(
        eq(customerCategories.id, customerCategoryId),
        isNull(customerCategories.deletedAt)
      )
    );

  if (!existingCategory) {
    throw new SalesError("Customer category not found.", 404);
  }
}

async function ensureCustomerCategoryNameAvailableInTx(
  tx: Tx,
  name: string,
  options?: { excludeId?: string }
) {
  const conditions = [
    eq(customerCategories.name, name),
    isNull(customerCategories.deletedAt),
  ];

  if (options?.excludeId) {
    conditions.push(sql`${customerCategories.id} <> ${options.excludeId}`);
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(and(...conditions))
    .limit(1);

  if (existingCategory) {
    throw new SalesError("A customer category with this name already exists.", 400, {
      errors: {
        name: ["A customer category with this name already exists."],
      },
    });
  }
}

async function ensureUnitDefinitionExistsInTx(tx: Tx, unitDefinitionId: string) {
  const [unitDefinition] = await tx
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(
      and(
        eq(unitDefinitions.id, unitDefinitionId),
        isNull(unitDefinitions.deletedAt)
      )
    );

  if (!unitDefinition) {
    throw new SalesError("Unit not found.", 404);
  }
}

async function ensurePricingScheduleScopeAvailableInTx(
  tx: Tx,
  values: {
    customerCategoryId: string | null;
    unitDefinitionId: string;
  },
  options?: { excludeId?: string }
) {
  const conditions = [
    eq(pricingSchedules.unitDefinitionId, values.unitDefinitionId),
    isNull(pricingSchedules.deletedAt),
  ];

  if (values.customerCategoryId == null) {
    conditions.push(isNull(pricingSchedules.customerCategoryId));
  } else {
    conditions.push(eq(pricingSchedules.customerCategoryId, values.customerCategoryId));
  }

  if (options?.excludeId) {
    conditions.push(sql`${pricingSchedules.id} <> ${options.excludeId}`);
  }

  const [existingSchedule] = await tx
    .select({ id: pricingSchedules.id })
    .from(pricingSchedules)
    .where(and(...conditions))
    .limit(1);

  if (existingSchedule) {
    throw new SalesError("A pricing schedule already exists for this scope.", 400, {
      errors: {
        unitDefinitionId: [
          "A pricing schedule already exists for this customer scope and unit.",
        ],
      },
    });
  }
}

async function getPricingScheduleByScopeInTx(
  tx: Tx,
  unitDefinitionId: string,
  customerCategoryId: string | null
): Promise<PricingScheduleRecord | null> {
  if (customerCategoryId != null) {
    const [categorySchedule] = await tx
      .select({
        id: pricingSchedules.id,
        name: pricingSchedules.name,
        customerCategoryId: pricingSchedules.customerCategoryId,
        unitDefinitionId: pricingSchedules.unitDefinitionId,
      })
      .from(pricingSchedules)
      .where(
        and(
          eq(pricingSchedules.unitDefinitionId, unitDefinitionId),
          eq(pricingSchedules.customerCategoryId, customerCategoryId),
          isNull(pricingSchedules.deletedAt)
        )
      )
      .limit(1);

    if (categorySchedule) {
      return categorySchedule;
    }
  }

  const [everyoneSchedule] = await tx
    .select({
      id: pricingSchedules.id,
      name: pricingSchedules.name,
      customerCategoryId: pricingSchedules.customerCategoryId,
      unitDefinitionId: pricingSchedules.unitDefinitionId,
    })
    .from(pricingSchedules)
    .where(
      and(
        eq(pricingSchedules.unitDefinitionId, unitDefinitionId),
        isNull(pricingSchedules.customerCategoryId),
        isNull(pricingSchedules.deletedAt)
      )
    )
    .limit(1);

  return everyoneSchedule ?? null;
}

async function getPricingScheduleBreaksInTx(
  tx: Tx,
  pricingScheduleId: string
): Promise<PricingScheduleBreakRecord[]> {
  return tx
    .select({
      id: pricingScheduleBreaks.id,
      pricingScheduleId: pricingScheduleBreaks.pricingScheduleId,
      minQuantity: trimScale(pricingScheduleBreaks.minQuantity).as("minQuantity"),
      maxQuantity: trimScaleNullable(pricingScheduleBreaks.maxQuantity).as("maxQuantity"),
      discountPercent: trimScale(pricingScheduleBreaks.discountPercent).as(
        "discountPercent"
      ),
      sortOrder: pricingScheduleBreaks.sortOrder,
    })
    .from(pricingScheduleBreaks)
    .where(eq(pricingScheduleBreaks.pricingScheduleId, pricingScheduleId))
    .orderBy(
      asc(pricingScheduleBreaks.sortOrder),
      asc(pricingScheduleBreaks.minQuantity)
    );
}

function findMatchingPricingBreak(
  breaks: PricingScheduleBreakRecord[],
  quantity: string | null
) {
  const parsedQuantity = parsePositive(quantity);
  if (parsedQuantity == null) {
    return null;
  }

  return (
    breaks.find((pricingBreak) => {
      const minQuantity = parseFloat(pricingBreak.minQuantity);
      const maxQuantity =
        pricingBreak.maxQuantity == null
          ? null
          : parseFloat(pricingBreak.maxQuantity);

      return (
        parsedQuantity >= minQuantity &&
        (maxQuantity == null || parsedQuantity <= maxQuantity)
      );
    }) ?? null
  );
}

async function resolvePricingForProductInTx(
  tx: Tx,
  values: {
    customerCategoryId: string | null;
    customerCategoryName: string | null;
    product: Pick<SalesItemValidationRow, "defaultSellingPrice" | "unitDefinitionId">;
    quantity: string | null;
  }
): Promise<Omit<SalesLinePricingResult, "estimatedUnitCost">> {
  const baseUnitPrice = values.product.defaultSellingPrice;

  if (baseUnitPrice == null) {
    return {
      baseUnitPrice: null,
      suggestedUnitPrice: null,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: values.customerCategoryName,
    };
  }

  const pricingSchedule = await getPricingScheduleByScopeInTx(
    tx,
    values.product.unitDefinitionId,
    values.customerCategoryId
  );

  if (!pricingSchedule) {
    return {
      baseUnitPrice,
      suggestedUnitPrice: baseUnitPrice,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: values.customerCategoryName,
    };
  }

  const pricingBreaks = await getPricingScheduleBreaksInTx(tx, pricingSchedule.id);
  const matchingBreak = findMatchingPricingBreak(pricingBreaks, values.quantity);

  if (!matchingBreak) {
    return {
      baseUnitPrice,
      suggestedUnitPrice: baseUnitPrice,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: values.customerCategoryName,
    };
  }

  const suggestedUnitPrice = normalizeMoney(
    Number(baseUnitPrice) *
      (1 - Number(matchingBreak.discountPercent) / 100)
  );

  return {
    baseUnitPrice,
    suggestedUnitPrice,
    pricingSourceType: "schedule_break",
    pricingScheduleName: pricingSchedule.name,
    pricingBreakLabel: formatPricingBreakLabel(
      matchingBreak.minQuantity,
      matchingBreak.maxQuantity
    ),
    customerCategoryName: values.customerCategoryName,
  };
}

export class SalesError extends DomainError {
  errors?: Record<string, string[]>;
  oversell?: OversellWarningPayload;
  bulkOversell?: BulkOversellWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      oversell?: OversellWarningPayload;
      bulkOversell?: BulkOversellWarningPayload;
    }
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "SalesError",
      errors,
    });

    this.errors = options?.errors;
    this.oversell = options?.oversell;
    this.bulkOversell = options?.bulkOversell;
  }

  toResponse() {
    const body = this.bulkOversell
      ? { error: this.message, oversell: this.bulkOversell }
      : this.oversell
        ? { error: this.message, oversell: this.oversell }
        : this.errors
          ? { errors: this.errors }
          : { error: this.message };
    return NextResponse.json(body, { status: this.status });
  }
}

type LinkedManufacturingStatus = Pick<
  SalesOrderDetail["linkedManufacturingOrders"][number],
  "orderNumber" | "status"
>;

function buildShippingReadiness({
  status,
  hasManufacturableLines,
  linkedManufacturingOrders,
  stockBlockers = [],
}: {
  status: SalesOrderDetail["status"] | SalesOrderListRow["status"];
  hasManufacturableLines: boolean;
  linkedManufacturingOrders: LinkedManufacturingStatus[];
  stockBlockers?: string[];
}): SalesShippingReadiness {
  if (status === "shipped") {
    return {
      state: "shipped",
      message: "Order has already shipped.",
      blockers: [],
    };
  }

  if (status === "cancelled") {
    return {
      state: "cancelled",
      message: "Cancelled orders cannot be shipped.",
      blockers: ["Order is cancelled"],
    };
  }

  if (status !== "confirmed" && status !== "partially_shipped") {
    return {
      state: "not_confirmed",
      message: "Confirm the order before shipping.",
      blockers: ["Order is not confirmed"],
    };
  }

  const openManufacturingOrders = linkedManufacturingOrders.filter(
    (order) => order.status === "draft" || order.status === "released"
  );

  if (openManufacturingOrders.length > 0) {
    return {
      state: "in_production",
      message: "Production is still open for this order.",
      blockers: openManufacturingOrders.map(
        (order) => `${order.orderNumber} is ${order.status.replace("_", " ")}`
      ),
    };
  }

  if (stockBlockers.length > 0) {
    if (hasManufacturableLines) {
      return {
        state: "needs_manufacturing",
        message: "Create manufacturing orders or replenish stock before shipping.",
        blockers: stockBlockers,
      };
    }

    return {
      state: "insufficient_stock",
      message: "Stock is short for one or more lines.",
      blockers: stockBlockers,
    };
  }

  return {
    state: "ready",
    message: "Ready to ship.",
    blockers: [],
  };
}

function calcProjectedStock(values: {
  stock: string;
  demandQty: string;
  expectedQty: string;
  safetyStock: string;
}) {
  return roundQuantity(
    parseFloat(values.stock) -
      parseFloat(values.demandQty) +
      parseFloat(values.expectedQty) -
      parseFloat(values.safetyStock)
  );
}

function isCancelPayload(
  payload: UpdateSalesOrder
): payload is Extract<UpdateSalesOrder, { status: "cancelled" }> {
  return payload.status === "cancelled" && !("lines" in payload);
}

async function generateOrderNumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('sales.order_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `SO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

async function getOrderLinesInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
      cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
        "cancelledQuantity"
      ),
      unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
      suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
        "suggestedUnitPrice"
      ),
      pricingSourceType: salesOrderLines.pricingSourceType,
      pricingScheduleName: salesOrderLines.pricingScheduleName,
      pricingBreakLabel: salesOrderLines.pricingBreakLabel,
      isPriceOverridden: salesOrderLines.isPriceOverridden,
      lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      updatedAt: salesOrderLines.updatedAt,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));
}

async function getLockedSalesOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      shipDate: salesOrders.shipDate,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

type ShipmentLineState = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: number;
  cancelledQuantity: number;
  shippedQuantity: number;
  plannedQuantity: number;
  sortOrder: number;
};

function normalizeShipmentQuantity(value: number) {
  return parseFloat(normalizeNumeric(roundQuantity(value)));
}

async function getShipmentLineStatesInTx(
  tx: Tx,
  orderId: string,
  options?: { excludeShipmentId?: string }
) {
  const orderLines = await tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: salesOrderLines.quantity,
      cancelledQuantity: salesOrderLines.cancelledQuantity,
      sortOrder: salesOrderLines.sortOrder,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt))
    .for("update");

  const shipmentRows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: salesShipmentLines.quantity,
      status: salesShipments.status,
    })
    .from(salesShipmentLines)
    .innerJoin(
      salesShipments,
      eq(salesShipmentLines.salesShipmentId, salesShipments.id)
    )
    .where(
      and(
        eq(salesShipments.salesOrderId, orderId),
        inArray(salesShipments.status, ["draft", "shipped"]),
        options?.excludeShipmentId
          ? sql`${salesShipments.id} <> ${options.excludeShipmentId}`
          : undefined
      )
    );

  const shippedByLine = new Map<string, number>();
  const plannedByLine = new Map<string, number>();

  shipmentRows.forEach((row) => {
    const quantity = parseFloat(row.quantity);
    if (row.status === "shipped") {
      shippedByLine.set(
        row.salesOrderLineId,
        normalizeShipmentQuantity((shippedByLine.get(row.salesOrderLineId) ?? 0) + quantity)
      );
    } else if (row.status === "draft") {
      plannedByLine.set(
        row.salesOrderLineId,
        normalizeShipmentQuantity((plannedByLine.get(row.salesOrderLineId) ?? 0) + quantity)
      );
    }
  });

  return new Map<string, ShipmentLineState>(
    orderLines.map((line) => [
      line.id,
      {
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        unitName: line.unitName,
        quantity: parseFloat(line.quantity),
        cancelledQuantity: parseFloat(line.cancelledQuantity),
        shippedQuantity: shippedByLine.get(line.id) ?? 0,
        plannedQuantity: plannedByLine.get(line.id) ?? 0,
        sortOrder: line.sortOrder,
      },
    ])
  );
}

function remainingToShip(line: ShipmentLineState) {
  return normalizeShipmentQuantity(
    line.quantity - line.shippedQuantity - line.cancelledQuantity
  );
}

function unplannedRemaining(line: ShipmentLineState) {
  return normalizeShipmentQuantity(remainingToShip(line) - line.plannedQuantity);
}

function buildShipmentEntries(
  states: Map<string, ShipmentLineState>,
  data: SalesShipmentInput
) {
  return data.lines.map((line, index) => {
    const state = states.get(line.salesOrderLineId);
    if (!state) {
      throw new SalesError("Sales order line not found.", 404, {
        errors: {
          [`lines.${index}.quantity`]: ["Select a valid sales order line"],
        },
      });
    }

    const quantity = parseFloat(line.quantity ?? "0");
    const available = unplannedRemaining(state);
    if (quantity > available) {
      throw new SalesError("Cannot plan more than the remaining quantity.", 400, {
        errors: {
          [`lines.${index}.quantity`]: [
            `Must be ${normalizeNumeric(available)} or less`,
          ],
        },
      });
    }

    return {
      state,
      quantity,
    };
  });
}

type FulfillmentPlanOrderSnapshot = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  shipDate: string | null;
  requestedDate: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

type ShipAddress = {
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

type CustomerShipAddress = ShipAddress & {
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
};

function hasShipAddress(address: ShipAddress) {
  return [
    address.shipLine1,
    address.shipLine2,
    address.shipCity,
    address.shipRegion,
    address.shipPostcode,
    address.shipCountry,
  ].some((part) => part != null && part.trim() !== "");
}

function customerAddressFallback(customer: CustomerShipAddress | null): ShipAddress {
  if (!customer) {
    return {
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
    };
  }

  if (hasShipAddress(customer)) {
    return {
      shipLine1: customer.shipLine1,
      shipLine2: customer.shipLine2,
      shipCity: customer.shipCity,
      shipRegion: customer.shipRegion,
      shipPostcode: customer.shipPostcode,
      shipCountry: customer.shipCountry,
    };
  }

  return {
    shipLine1: customer.billingLine1,
    shipLine2: customer.billingLine2,
    shipCity: customer.billingCity,
    shipRegion: customer.billingRegion,
    shipPostcode: customer.billingPostcode,
    shipCountry: customer.billingCountry,
  };
}

async function resolveShipmentAddressInTx(
  tx: Tx,
  order: ShipAddress & { customerId: string }
): Promise<ShipAddress> {
  if (hasShipAddress(order)) {
    return {
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
    };
  }

  const [customer] = await tx
    .select({
      shipLine1: customers.shipLine1,
      shipLine2: customers.shipLine2,
      shipCity: customers.shipCity,
      shipRegion: customers.shipRegion,
      shipPostcode: customers.shipPostcode,
      shipCountry: customers.shipCountry,
      billingLine1: customers.billingLine1,
      billingLine2: customers.billingLine2,
      billingCity: customers.billingCity,
      billingRegion: customers.billingRegion,
      billingPostcode: customers.billingPostcode,
      billingCountry: customers.billingCountry,
    })
    .from(customers)
    .where(eq(customers.id, order.customerId));

  return customerAddressFallback(customer ?? null);
}

type SalesFulfillmentPlanResult = {
  id: string;
  shipmentId: string;
};

async function getActiveDraftShipmentInTx(
  tx: Tx,
  orderId: string,
  shipmentId?: string | null
) {
  const conditions = [
    eq(salesShipments.salesOrderId, orderId),
    eq(salesShipments.status, "draft"),
  ];

  if (shipmentId) {
    conditions.push(eq(salesShipments.id, shipmentId));
  }

  const [shipment] = await tx
    .select({
      id: salesShipments.id,
      status: salesShipments.status,
    })
    .from(salesShipments)
    .where(and(...conditions))
    .orderBy(asc(salesShipments.sequence), asc(salesShipments.createdAt))
    .limit(1)
    .for("update");

  return shipment ?? null;
}

async function upsertDraftShipmentForFulfillmentPlanInTx(
  tx: Tx,
  orgId: string,
  order: FulfillmentPlanOrderSnapshot,
  data: SalesFulfillmentPlanInput
) {
  const shipAddress = await resolveShipmentAddressInTx(tx, order);
  const shipmentData: SalesShipmentInput = {
    fulfillmentType: data.fulfillmentType,
    scheduledDate: data.deliveryDate,
    notes: data.shipmentNotes,
    lines: data.shipmentLines,
  };
  const existingShipment = await getActiveDraftShipmentInTx(
    tx,
    order.id,
    data.shipmentId
  );

  if (data.shipmentId && !existingShipment) {
    throw new SalesError("Draft shipment not found.", 404);
  }

  if (existingShipment) {
    const states = await getShipmentLineStatesInTx(tx, order.id, {
      excludeShipmentId: existingShipment.id,
    });
    const entries = buildShipmentEntries(states, shipmentData);

    await tx
      .delete(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, existingShipment.id));
    await tx.insert(salesShipmentLines).values(
      entries.map((entry) => ({
        salesShipmentId: existingShipment.id,
        salesOrderLineId: entry.state.id,
        itemId: entry.state.itemId,
        itemName: entry.state.itemName,
        itemSku: entry.state.itemSku,
        unitName: entry.state.unitName,
        quantity: normalizeNumeric(entry.quantity),
        sortOrder: entry.state.sortOrder,
      }))
    );

    await tx
      .update(salesShipments)
      .set({
        fulfillmentType: shipmentData.fulfillmentType,
        scheduledDate: shipmentData.scheduledDate,
        notes: shipmentData.notes,
        ...shipAddress,
        updatedAt: new Date(),
      })
      .where(eq(salesShipments.id, existingShipment.id));

    return existingShipment.id;
  }

  const states = await getShipmentLineStatesInTx(tx, order.id);
  const entries = buildShipmentEntries(states, shipmentData);
  const sequence = await getNextShipmentSequenceInTx(tx, order.id);
  const shipmentNumber = `${order.orderNumber}-S${sequence}`;
  const now = new Date();

  const [shipment] = await tx
    .insert(salesShipments)
    .values({
      organizationId: orgId,
      salesOrderId: order.id,
      shipmentNumber,
      sequence,
      status: "draft",
      fulfillmentType: shipmentData.fulfillmentType,
      scheduledDate: shipmentData.scheduledDate,
      notes: shipmentData.notes,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      ...shipAddress,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: salesShipments.id });

  await tx.insert(salesShipmentLines).values(
    entries.map((entry) => ({
      salesShipmentId: shipment.id,
      salesOrderLineId: entry.state.id,
      itemId: entry.state.itemId,
      itemName: entry.state.itemName,
      itemSku: entry.state.itemSku,
      unitName: entry.state.unitName,
      quantity: normalizeNumeric(entry.quantity),
      sortOrder: entry.state.sortOrder,
    }))
  );

  return shipment.id;
}

type AutoDraftShipmentOrderSnapshot = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  shipDate: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

async function syncSalesOrderShipDateFromShipmentsInTx(tx: Tx, orderId: string) {
  const [row] = await tx
    .select({
      scheduledDate: salesShipments.scheduledDate,
    })
    .from(salesShipments)
    .where(
      and(
        eq(salesShipments.salesOrderId, orderId),
        sql`${salesShipments.status} <> 'cancelled'`,
        sql`${salesShipments.scheduledDate} IS NOT NULL`
      )
    )
    .orderBy(asc(salesShipments.scheduledDate), asc(salesShipments.sequence))
    .limit(1);

  await tx
    .update(salesOrders)
    .set({ shipDate: row?.scheduledDate ?? null, updatedAt: new Date() })
    .where(eq(salesOrders.id, orderId));
}

async function upsertDefaultDraftShipmentForOrderInTx(
  tx: Tx,
  orgId: string,
  order: AutoDraftShipmentOrderSnapshot
) {
  if (!order.shipDate) {
    throw new SalesError("Ship date is required to confirm a sales order.", 400, {
      errors: {
        shipDate: ["Ship date is required to confirm a sales order"],
      },
    });
  }

  const existingShipment = await getActiveDraftShipmentInTx(tx, order.id);
  const states = await getShipmentLineStatesInTx(tx, order.id, {
    excludeShipmentId: existingShipment?.id,
  });
  const lines = [...states.values()].flatMap((state) => {
    const quantity = existingShipment
      ? normalizeShipmentQuantity(remainingToShip(state) - state.plannedQuantity)
      : unplannedRemaining(state);

    if (quantity <= 0) return [];
    return [{ salesOrderLineId: state.id, quantity: normalizeNumeric(quantity) }];
  });

  if (lines.length === 0) return existingShipment?.id ?? null;

  const shipmentData: SalesShipmentInput = {
    fulfillmentType: "delivery",
    scheduledDate: order.shipDate,
    notes: null,
    lines,
  };
  const shipAddress = await resolveShipmentAddressInTx(tx, order);
  const entries = buildShipmentEntries(states, shipmentData);
  const now = new Date();

  if (existingShipment) {
    await tx
      .delete(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, existingShipment.id));
    await tx.insert(salesShipmentLines).values(
      entries.map((entry) => ({
        salesShipmentId: existingShipment.id,
        salesOrderLineId: entry.state.id,
        itemId: entry.state.itemId,
        itemName: entry.state.itemName,
        itemSku: entry.state.itemSku,
        unitName: entry.state.unitName,
        quantity: normalizeNumeric(entry.quantity),
        sortOrder: entry.state.sortOrder,
      }))
    );

    await tx
      .update(salesShipments)
      .set({ scheduledDate: order.shipDate, ...shipAddress, updatedAt: now })
      .where(eq(salesShipments.id, existingShipment.id));

    return existingShipment.id;
  }

  const sequence = await getNextShipmentSequenceInTx(tx, order.id);
  const shipmentNumber = `${order.orderNumber}-S${sequence}`;
  const [shipment] = await tx
    .insert(salesShipments)
    .values({
      organizationId: orgId,
      salesOrderId: order.id,
      shipmentNumber,
      sequence,
      status: "draft",
      fulfillmentType: shipmentData.fulfillmentType,
      scheduledDate: shipmentData.scheduledDate,
      notes: shipmentData.notes,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      ...shipAddress,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: salesShipments.id });

  await tx.insert(salesShipmentLines).values(
    entries.map((entry) => ({
      salesShipmentId: shipment.id,
      salesOrderLineId: entry.state.id,
      itemId: entry.state.itemId,
      itemName: entry.state.itemName,
      itemSku: entry.state.itemSku,
      unitName: entry.state.unitName,
      quantity: normalizeNumeric(entry.quantity),
      sortOrder: entry.state.sortOrder,
    }))
  );

  return shipment.id;
}

async function getNextShipmentSequenceInTx(tx: Tx, salesOrderId: string) {
  const result = await tx.execute(
    sql`SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM sales.sales_shipments
        WHERE sales_order_id = ${salesOrderId}`
  );
  const raw = (result.rows[0] as { next_sequence: string | number }).next_sequence;
  return Number(raw);
}

async function prepareDraftOrdersForConfirmationInTx(
  tx: Tx,
  orderIds: string[],
  options?: { lockItems?: boolean }
): Promise<{
  orders: DraftOrderConfirmationPayload[];
  itemsById: Map<string, SalesItemValidationRow>;
}> {
  const uniqueIds = [...new Set(orderIds)];

  const orders = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      customerId: salesOrders.customerId,
      customerName: salesOrders.customerName,
      status: salesOrders.status,
      shipDate: salesOrders.shipDate,
      shipLine1: salesOrders.shipLine1,
      shipLine2: salesOrders.shipLine2,
      shipCity: salesOrders.shipCity,
      shipRegion: salesOrders.shipRegion,
      shipPostcode: salesOrders.shipPostcode,
      shipCountry: salesOrders.shipCountry,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .where(and(inArray(salesOrders.id, uniqueIds), isNull(salesOrders.deletedAt)))
    .orderBy(asc(salesOrders.createdAt))
    .for("update");

  if (orders.length !== uniqueIds.length) {
    throw new SalesError("One or more orders were not found.", 404);
  }

  if (orders.some((order) => order.status !== "draft")) {
    throw new SalesError("Only draft orders can be confirmed.", 400);
  }

  if (orders.some((order) => !order.shipDate)) {
    throw new SalesError("Ship date is required to confirm a sales order.", 400, {
      errors: {
        shipDate: ["Ship date is required to confirm a sales order"],
      },
    });
  }

  const lines = await tx
    .select({
      salesOrderId: salesOrderLines.salesOrderId,
      itemId: salesOrderLines.itemId,
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
      unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
      lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
    })
    .from(salesOrderLines)
    .where(inArray(salesOrderLines.salesOrderId, uniqueIds))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

  const linesByOrderId = new Map<string, typeof lines>();
  lines.forEach((line) => {
    const bucket = linesByOrderId.get(line.salesOrderId) ?? [];
    bucket.push(line);
    linesByOrderId.set(line.salesOrderId, bucket);
  });

  const itemIds = [...new Set(lines.map((line) => line.itemId))];

  if (options?.lockItems && itemIds.length > 0) {
    await lockItemsInTx(tx, itemIds);
  }

  const itemsById = itemIds.length
    ? await getValidatedSalesItemsInTx(tx, itemIds)
    : new Map<string, SalesItemValidationRow>();

  const preparedOrders: DraftOrderConfirmationPayload[] = [];

  for (const order of orders) {
    await getValidatedCustomerInTx(tx, order.customerId);

    const orderLines = linesByOrderId.get(order.id) ?? [];
    if (orderLines.length === 0) {
      throw new SalesError("Orders must have at least one line to confirm.", 400);
    }

    const preparedLines = orderLines.map((line) => {
      const item = itemsById.get(line.itemId);

      if (!item) {
        throw new SalesError("Item not found", 404);
      }

      return {
        itemId: item.id,
        itemName: item.displayName,
        itemSku: item.sku,
        unitName: item.unitName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        sortOrder: line.sortOrder,
      };
    });

    preparedOrders.push({
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customerName,
      shipDate: order.shipDate,
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
      preparedLines,
      affectedItemIds: preparedLines.map((line) => line.itemId),
    });
  }

  return { orders: preparedOrders, itemsById };
}

async function getValidatedCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      customerCategoryId: customers.customerCategoryId,
      customerCategoryName: customerCategories.name,
    })
    .from(customers)
    .leftJoin(
      customerCategories,
      and(
        eq(customers.customerCategoryId, customerCategories.id),
        isNull(customerCategories.deletedAt)
      )
    )
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  if (!customer) {
    throw new SalesError("Customer not found", 404);
  }

  return customer satisfies ValidatedCustomerRow;
}

async function getValidatedSalesItemsInTx(
  tx: Tx,
  itemIds: string[]
) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      name: items.name,
      sku: items.sku,
      parentId: items.parentId,
      variantAttrs: items.variantAttrs,
      unitDefinitionId: items.unitDefinitionId,
      unitName: unitDefinitions.name,
      defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
        "defaultSellingPrice"
      ),
      stock: stockSubquery,
      committedQty: committedQtySubquery,
      demandQty: demandQtySubquery,
      shortageQty: shortageQtySubquery,
      availableQty: availableQtySubquery,
      expectedQty: expectedQtySubquery,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        inArray(items.itemType, ["product", "material"]),
        isNull(items.deletedAt)
      )
    );

  // For variant items, fetch parent info for displayName computation
  const variantItemRows = rows.filter((r) => r.parentId != null);
  const parentIds = [...new Set(variantItemRows.map((r) => r.parentId))];

  const parentsByParentId = new Map<string, { name: string; variantAxes: string[] | null }>();
  if (parentIds.length > 0) {
    const parents = await tx
      .select({
        id: items.id,
        name: items.name,
        variantAxes: items.variantAxes,
      })
      .from(items)
      .where(
        and(
          inArray(items.id, parentIds as string[]),
          isNull(items.deletedAt)
        )
      );

    parents.forEach((p) => {
      parentsByParentId.set(p.id, {
        name: p.name,
        variantAxes: (p.variantAxes as string[] | null) ?? null,
      });
    });
  }

  const itemMap = new Map(
    rows.map((row) => {
      let displayName = row.name;

      if (row.parentId && row.variantAttrs) {
        const parent = parentsByParentId.get(row.parentId);
        if (parent && parent.variantAxes && parent.variantAxes.length > 0) {
          const attrValues = (parent.variantAxes as string[]).map(
            (axis) => (row.variantAttrs as Record<string, string>)[axis]
          ).filter(Boolean).join(" / ");
          displayName = `${parent.name} / ${attrValues}`;
        }
      }

      return [
        row.id,
        {
          ...row,
          displayName,
        } as SalesItemValidationRow & { displayName: string },
      ];
    })
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new SalesError("Item not found", 404);
  }

  return itemMap;
}

async function prepareOrderPayload(
  tx: Tx,
  payload: InsertSalesOrder,
  options?: { lockItems?: boolean }
): Promise<{
  customerId: string;
  customerName: string;
  orderDate: string;
  shipDate: string | null;
  requestedDate: string | null;
  notes: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  totalAmount: string;
  preparedLines: PreparedOrderLine[];
  affectedItemIds: string[];
  itemsById: Map<string, SalesItemValidationRow>;
}> {
  const customer = await getValidatedCustomerInTx(tx, payload.customerId);
  const itemIds = payload.lines.map((line) => line.itemId);

  if (options?.lockItems) {
    await lockItemsInTx(tx, itemIds);
  }

  const itemsById = await getValidatedSalesItemsInTx(tx, itemIds);

  const preparedLines = await Promise.all(
    payload.lines.map(async (line, index) => {
      const item = itemsById.get(line.itemId);

      if (!item) {
        throw new SalesError("Item not found", 404);
      }

      const pricing = await resolvePricingForProductInTx(tx, {
        customerCategoryId: customer.customerCategoryId,
        customerCategoryName: customer.customerCategoryName,
        product: item,
        quantity: line.quantity,
      });
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const normalizedUnitPrice = normalizeMoney(unitPrice);
      const lineTotal = quantity * unitPrice;

      return {
        itemId: item.id,
        itemName: item.displayName,
        itemSku: item.sku,
        unitName: item.unitName,
        quantity: normalizeNumeric(quantity),
        unitPrice: normalizedUnitPrice,
        suggestedUnitPrice: pricing.suggestedUnitPrice,
        pricingSourceType: pricing.pricingSourceType,
        pricingScheduleName: pricing.pricingScheduleName,
        pricingBreakLabel: pricing.pricingBreakLabel,
        isPriceOverridden:
          pricing.suggestedUnitPrice != null &&
          normalizedUnitPrice !== pricing.suggestedUnitPrice,
        lineTotal: normalizeMoney(lineTotal),
        sortOrder: index,
      } satisfies PreparedOrderLine;
    })
  );

  const totalAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineTotal),
    0
  );

  return {
    customerId: customer.id,
    customerName: customer.name,
    orderDate: payload.orderDate,
    shipDate: payload.shipDate ?? null,
    requestedDate: payload.requestedDate ?? null,
    notes: payload.notes ?? null,
    shipLine1: payload.shipLine1 ?? null,
    shipLine2: payload.shipLine2 ?? null,
    shipCity: payload.shipCity ?? null,
    shipRegion: payload.shipRegion ?? null,
    shipPostcode: payload.shipPostcode ?? null,
    shipCountry: payload.shipCountry ?? null,
    totalAmount: normalizeMoney(totalAmount),
    preparedLines,
    affectedItemIds: preparedLines.map((line) => line.itemId),
    itemsById,
  };
}

async function buildOversellWarning(
  preparedLines: PreparedOrderLineBase[],
  itemsById: Map<string, SalesItemValidationRow>
) {
  const quantityByItem = new Map<string, number>();

  for (const line of preparedLines) {
    quantityByItem.set(
      line.itemId,
      roundQuantity(
        (quantityByItem.get(line.itemId) ?? 0) + parseFloat(line.quantity)
      )
    );
  }

  const warningProducts = [...quantityByItem.entries()]
    .map(([itemId, addedQty]) => {
      const item = itemsById.get(itemId);
      if (!item) return null;

      const currentCommittedQty = parseFloat(item.committedQty);
      const currentDemandQty = parseFloat(item.demandQty);
      const availableQty = parseFloat(item.availableQty);
      const currentShortageQty = parseFloat(item.shortageQty);
      const projectedDemandQty = roundQuantity(currentDemandQty + addedQty);
      const addedShortageQty = Math.max(0, addedQty - availableQty);
      const projectedShortageQty = roundQuantity(currentShortageQty + addedShortageQty);
      const calculatedStock = calcProjectedStock(item);
      const projectedCalculatedStock = roundQuantity(calculatedStock - addedQty);

      if (projectedCalculatedStock >= 0 && addedShortageQty <= 0) {
        return null;
      }

      return {
        itemId: item.id,
        itemName: item.displayName,
        itemSku: item.sku,
        unitName: item.unitName,
        inStock: roundQuantity(parseFloat(item.stock)),
        availableQty: roundQuantity(availableQty),
        committedQty: roundQuantity(currentCommittedQty),
        demandQty: roundQuantity(currentDemandQty),
        shortageQty: roundQuantity(currentShortageQty),
        expectedQty: roundQuantity(parseFloat(item.expectedQty)),
        safetyStock: roundQuantity(parseFloat(item.safetyStock)),
        calculatedStock,
        addedQty: roundQuantity(addedQty),
        projectedDemandQty,
        projectedShortageQty,
        projectedCalculatedStock,
      };
    })
    .filter((product) => product != null);

  if (warningProducts.length === 0) {
    return null;
  }

  return { products: warningProducts };
}

async function buildBulkOversellWarning(
  orders: DraftOrderConfirmationPayload[],
  itemsById: Map<string, SalesItemValidationRow>
): Promise<BulkOversellWarningPayload | null> {
  const totalByProduct = new Map<string, number>();

  for (const order of orders) {
    for (const line of order.preparedLines) {
      totalByProduct.set(
        line.itemId,
        roundQuantity(
          (totalByProduct.get(line.itemId) ?? 0) + parseFloat(line.quantity)
        )
      );
    }
  }

  const oversoldProducts = new Map<
    string,
    Omit<OversellWarningPayload["products"][number], "addedQty" | "itemName" | "itemSku" | "unitName">
  >();

  totalByProduct.forEach((addedQty, itemId) => {
    const item = itemsById.get(itemId);
    if (!item) return;

    const currentCommittedQty = parseFloat(item.committedQty);
    const currentDemandQty = parseFloat(item.demandQty);
    const availableQty = parseFloat(item.availableQty);
    const currentShortageQty = parseFloat(item.shortageQty);
    const projectedDemandQty = roundQuantity(currentDemandQty + addedQty);
    const addedShortageQty = Math.max(0, addedQty - availableQty);
    const projectedShortageQty = roundQuantity(currentShortageQty + addedShortageQty);
    const calculatedStock = calcProjectedStock(item);
    const projectedCalculatedStock = roundQuantity(calculatedStock - addedQty);

    if (projectedCalculatedStock >= 0 && addedShortageQty <= 0) {
      return;
    }

    oversoldProducts.set(itemId, {
      itemId: item.id,
      inStock: roundQuantity(parseFloat(item.stock)),
      availableQty: roundQuantity(availableQty),
      committedQty: roundQuantity(currentCommittedQty),
      demandQty: roundQuantity(currentDemandQty),
      shortageQty: roundQuantity(currentShortageQty),
      expectedQty: roundQuantity(parseFloat(item.expectedQty)),
      safetyStock: roundQuantity(parseFloat(item.safetyStock)),
      calculatedStock,
      projectedDemandQty,
      projectedShortageQty,
      projectedCalculatedStock,
    });
  });

  if (oversoldProducts.size === 0) {
    return null;
  }

  const warningOrders = orders
    .map((order) => {
      const warningProducts = order.preparedLines
        .map((line) => {
          const metrics = oversoldProducts.get(line.itemId);
          if (!metrics) return null;

          return {
            ...metrics,
            itemName: line.itemName,
            itemSku: line.itemSku,
            unitName: line.unitName,
            addedQty: roundQuantity(parseFloat(line.quantity)),
          };
        })
        .filter((product): product is OversellWarningPayload["products"][number] => product != null);

      if (warningProducts.length === 0) {
        return null;
      }

      return {
        salesOrderId: order.id,
        salesOrderNumber: order.orderNumber,
        products: warningProducts,
      };
    })
    .filter((order): order is BulkOversellWarningPayload["orders"][number] => order != null);

  if (warningOrders.length === 0) {
    return null;
  }

  return { orders: warningOrders };
}

export async function getCustomerCategoryOptions(): Promise<CustomerCategoryOption[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));
  });
}

export async function getPricingUnitOptions(): Promise<PricingUnitOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      })
      .from(unitDefinitions)
      .where(isNull(unitDefinitions.deletedAt))
      .orderBy(asc(unitDefinitions.name), asc(unitDefinitions.size));

    return rows.map((row) => ({
      ...row,
      label: formatPricingUnitLabel(row),
    }));
  });
}

export async function getCustomerCategories(): Promise<CustomerCategoryRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        createdAt: customerCategories.createdAt,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const [customerCounts, scheduleCounts] = await Promise.all([
      tx
        .select({
          customerCategoryId: customers.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(customers)
        .where(
          and(
            inArray(customers.customerCategoryId, ids),
            isNull(customers.deletedAt)
          )
        )
        .groupBy(customers.customerCategoryId),
      tx
        .select({
          customerCategoryId: pricingSchedules.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(pricingSchedules)
        .where(
          and(
            inArray(pricingSchedules.customerCategoryId, ids),
            isNull(pricingSchedules.deletedAt)
          )
        )
        .groupBy(pricingSchedules.customerCategoryId),
    ]);

    const customerCountsByCategoryId = new Map(
      customerCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );
    const scheduleCountsByCategoryId = new Map(
      scheduleCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );

    return rows.map((row) => ({
      ...row,
      customerCount: customerCountsByCategoryId.get(row.id) ?? 0,
      scheduleCount: scheduleCountsByCategoryId.get(row.id) ?? 0,
    }));
  });
}

export async function getCustomerCategory(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [category] = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      );

    return category ?? null;
  });
}

export async function createCustomerCategory(data: InsertCustomerCategory) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name);

    const [maxSortOrderRow] = await tx
      .select({
        value: sql<number>`COALESCE(MAX(${customerCategories.sortOrder}), -1)`,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt));

    const [category] = await tx
      .insert(customerCategories)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description,
        sortOrder: Number(maxSortOrderRow?.value ?? -1) + 1,
      })
      .returning({ id: customerCategories.id, name: customerCategories.name });

    return category;
  });
}

export async function updateCustomerCategory(id: string, data: UpdateCustomerCategory) {
  return withAuthedOrgContext(async (tx) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name, {
      excludeId: id,
    });

    const [category] = await tx
      .update(customerCategories)
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      )
      .returning({ id: customerCategories.id });

    return category ?? null;
  });
}

async function ensureCustomerCategoriesDeletableInTx(
  tx: Tx,
  categoryIds: string[]
) {
  const uniqueCategoryIds = [...new Set(categoryIds)];

  const [blockingCustomer, blockingSchedule] = await Promise.all([
    tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          inArray(customers.customerCategoryId, uniqueCategoryIds),
          isNull(customers.deletedAt)
        )
      )
      .limit(1),
    tx
      .select({ id: pricingSchedules.id })
      .from(pricingSchedules)
      .where(
        and(
          inArray(pricingSchedules.customerCategoryId, uniqueCategoryIds),
          isNull(pricingSchedules.deletedAt)
        )
      )
      .limit(1),
  ]);

  if (blockingCustomer[0]) {
    throw new SalesError(
      "Cannot delete a customer category that is still assigned to customers.",
      400
    );
  }

  if (blockingSchedule[0]) {
    throw new SalesError(
      "Cannot delete a customer category that is still used by pricing schedules.",
      400
    );
  }

  return uniqueCategoryIds;
}

async function softDeleteCustomerCategoriesInTx(tx: Tx, categoryIds: string[]) {
  if (categoryIds.length === 0) {
    return [];
  }

  return tx
    .update(customerCategories)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customerCategories.id, categoryIds),
        isNull(customerCategories.deletedAt)
      )
    )
    .returning({ id: customerCategories.id });
}

export async function deleteCustomerCategory(id: string) {
  const deleted = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, [id]);
    const [category] = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return category != null;
  });

  return { deleted };
}

export async function deleteCustomerCategories(ids: string[]) {
  const deletedCount = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, ids);
    const deletedCategories = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return deletedCategories.length;
  });

  return { deletedCount };
}

export async function getPricingSchedules(): Promise<PricingScheduleRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: pricingSchedules.id,
        name: pricingSchedules.name,
        customerCategoryId: pricingSchedules.customerCategoryId,
        customerCategoryName: customerCategories.name,
        unitDefinitionId: unitDefinitions.id,
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
        notes: pricingSchedules.notes,
        updatedAt: pricingSchedules.updatedAt,
      })
      .from(pricingSchedules)
      .leftJoin(
        customerCategories,
        eq(pricingSchedules.customerCategoryId, customerCategories.id)
      )
      .innerJoin(
        unitDefinitions,
        eq(pricingSchedules.unitDefinitionId, unitDefinitions.id)
      )
      .where(isNull(pricingSchedules.deletedAt))
      .orderBy(
        asc(customerCategories.name),
        asc(unitDefinitions.name),
        asc(pricingSchedules.name)
      );

    if (rows.length === 0) {
      return [];
    }

    const scheduleIds = rows.map((row) => row.id);
    const breaks = await tx
      .select({
        pricingScheduleId: pricingScheduleBreaks.pricingScheduleId,
        minQuantity: trimScale(pricingScheduleBreaks.minQuantity).as("minQuantity"),
        maxQuantity: trimScaleNullable(pricingScheduleBreaks.maxQuantity).as("maxQuantity"),
        discountPercent: trimScale(pricingScheduleBreaks.discountPercent).as(
          "discountPercent"
        ),
        sortOrder: pricingScheduleBreaks.sortOrder,
      })
      .from(pricingScheduleBreaks)
      .where(inArray(pricingScheduleBreaks.pricingScheduleId, scheduleIds))
      .orderBy(
        asc(pricingScheduleBreaks.sortOrder),
        asc(pricingScheduleBreaks.minQuantity)
      );

    const breaksByScheduleId = new Map<
      string,
      Array<{
        minQuantity: string;
        maxQuantity: string | null;
        discountPercent: string;
      }>
    >();

    for (const pricingBreak of breaks) {
      const bucket =
        breaksByScheduleId.get(pricingBreak.pricingScheduleId) ?? [];
      bucket.push({
        minQuantity: pricingBreak.minQuantity,
        maxQuantity: pricingBreak.maxQuantity,
        discountPercent: pricingBreak.discountPercent,
      });
      breaksByScheduleId.set(pricingBreak.pricingScheduleId, bucket);
    }

    return rows.map((row) => {
      const scheduleBreaks = breaksByScheduleId.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        customerCategoryId: row.customerCategoryId,
        customerScopeLabel: row.customerCategoryName ?? "Everyone",
        unitDefinitionId: row.unitDefinitionId,
        unitName: row.unitName,
        unitLabel: formatPricingUnitLabel({
          name: row.unitName,
          size: row.unitSize,
          uom: row.unitUom,
        }),
        notes: row.notes,
        breakCount: scheduleBreaks.length,
        breakSummary: summarizePricingBreaks(scheduleBreaks),
        updatedAt: row.updatedAt,
      };
    });
  });
}

export async function getPricingSchedule(
  id: string
): Promise<PricingScheduleEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [schedule] = await tx
      .select({
        id: pricingSchedules.id,
        name: pricingSchedules.name,
        customerCategoryId: pricingSchedules.customerCategoryId,
        unitDefinitionId: pricingSchedules.unitDefinitionId,
        notes: pricingSchedules.notes,
      })
      .from(pricingSchedules)
      .where(and(eq(pricingSchedules.id, id), isNull(pricingSchedules.deletedAt)));

    if (!schedule) {
      return null;
    }

    const breaks = await getPricingScheduleBreaksInTx(tx, id);

    return {
      ...schedule,
      breaks: breaks.map((pricingBreak) => ({
        minQuantity: pricingBreak.minQuantity,
        maxQuantity: pricingBreak.maxQuantity,
        discountPercent: pricingBreak.discountPercent,
      })),
    };
  });
}

export async function createPricingSchedule(data: InsertPricingSchedule) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
    await ensureUnitDefinitionExistsInTx(tx, data.unitDefinitionId);
    await ensurePricingScheduleScopeAvailableInTx(tx, data);

    const [schedule] = await tx
      .insert(pricingSchedules)
      .values({
        organizationId: orgId,
        name: data.name,
        customerCategoryId: data.customerCategoryId,
        unitDefinitionId: data.unitDefinitionId,
        notes: data.notes,
      })
      .returning({ id: pricingSchedules.id });

    await tx.insert(pricingScheduleBreaks).values(
      data.breaks.map((pricingBreak, index) => ({
        pricingScheduleId: schedule.id,
        minQuantity: normalizeNumeric(Number(pricingBreak.minQuantity)),
        maxQuantity:
          pricingBreak.maxQuantity == null
            ? null
            : normalizeNumeric(Number(pricingBreak.maxQuantity)),
        discountPercent: normalizeMoney(Number(pricingBreak.discountPercent)),
        sortOrder: index,
      }))
    );

    return schedule;
  });
}

export async function updatePricingSchedule(
  id: string,
  data: UpdatePricingSchedule
) {
  return withAuthedOrgContext(async (tx) => {
    const [existingSchedule] = await tx
      .select({ id: pricingSchedules.id })
      .from(pricingSchedules)
      .where(and(eq(pricingSchedules.id, id), isNull(pricingSchedules.deletedAt)));

    if (!existingSchedule) {
      return null;
    }

    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
    await ensureUnitDefinitionExistsInTx(tx, data.unitDefinitionId);
    await ensurePricingScheduleScopeAvailableInTx(tx, data, {
      excludeId: id,
    });

    await tx
      .update(pricingSchedules)
      .set({
        name: data.name,
        customerCategoryId: data.customerCategoryId,
        unitDefinitionId: data.unitDefinitionId,
        notes: data.notes,
        updatedAt: new Date(),
      })
      .where(eq(pricingSchedules.id, id));

    await tx
      .delete(pricingScheduleBreaks)
      .where(eq(pricingScheduleBreaks.pricingScheduleId, id));

    await tx.insert(pricingScheduleBreaks).values(
      data.breaks.map((pricingBreak, index) => ({
        pricingScheduleId: id,
        minQuantity: normalizeNumeric(Number(pricingBreak.minQuantity)),
        maxQuantity:
          pricingBreak.maxQuantity == null
            ? null
            : normalizeNumeric(Number(pricingBreak.maxQuantity)),
        discountPercent: normalizeMoney(Number(pricingBreak.discountPercent)),
        sortOrder: index,
      }))
    );

    return { id };
  });
}

async function softDeletePricingSchedulesInTx(tx: Tx, scheduleIds: string[]) {
  if (scheduleIds.length === 0) {
    return [];
  }

  return tx
    .update(pricingSchedules)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(pricingSchedules.id, scheduleIds),
        isNull(pricingSchedules.deletedAt)
      )
    )
    .returning({ id: pricingSchedules.id });
}

export async function deletePricingSchedule(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [schedule] = await softDeletePricingSchedulesInTx(tx, [id]);
    return { deleted: schedule != null };
  });
}

export async function deletePricingSchedules(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const deletedSchedules = await softDeletePricingSchedulesInTx(
      tx,
      [...new Set(ids)]
    );
    return { deletedCount: deletedSchedules.length };
  });
}

const customerRowSelect = {
  id: customers.id,
  name: customers.name,
  customerCategoryId: customers.customerCategoryId,
  customerCategoryName: customerCategories.name,
  email: customers.email,
  phone: customers.phone,
  billingLine1: customers.billingLine1,
  billingLine2: customers.billingLine2,
  billingCity: customers.billingCity,
  billingRegion: customers.billingRegion,
  billingPostcode: customers.billingPostcode,
  billingCountry: customers.billingCountry,
  shipLine1: customers.shipLine1,
  shipLine2: customers.shipLine2,
  shipCity: customers.shipCity,
  shipRegion: customers.shipRegion,
  shipPostcode: customers.shipPostcode,
  shipCountry: customers.shipCountry,
  xeroContactId: customers.xeroContactId,
  notes: customers.notes,
  deletedAt: customers.deletedAt,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

export async function getCustomers(): Promise<CustomerRow[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select(customerRowSelect)
      .from(customers)
      .leftJoin(
        customerCategories,
        eq(customers.customerCategoryId, customerCategories.id)
      )
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));
  });
}

export async function getCustomer(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(customers.id, id)];
    if (!options?.includeDeleted) {
      conditions.push(isNull(customers.deletedAt));
    }

    const [customer] = await tx
      .select(customerRowSelect)
      .from(customers)
      .leftJoin(
        customerCategories,
        eq(customers.customerCategoryId, customerCategories.id)
      )
      .where(and(...conditions));

    return customer ?? null;
  });
}

export async function createCustomer(data: InsertCustomer) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        ...data,
      })
      .returning({ id: customers.id });

    return customer;
  });
}

export async function updateCustomer(id: string, data: UpdateCustomer) {
  return withAuthedOrgContext(async (tx) => {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

    const [customer] = await tx
      .update(customers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .returning({ id: customers.id });

    return customer ?? null;
  });
}

async function ensureCustomersDeletableInTx(tx: Tx, customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds)];

  const [blockingOrder] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        inArray(salesOrders.customerId, uniqueCustomerIds),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"])
      )
    )
    .limit(1);

  if (blockingOrder) {
    throw new SalesError(
      "Cannot delete customer with active draft, confirmed, or partially shipped orders.",
      400
    );
  }

  return uniqueCustomerIds;
}

async function softDeleteCustomersInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  return tx
    .update(customers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customers.id, customerIds),
        isNull(customers.deletedAt)
      )
    )
    .returning({ id: customers.id });
}

export async function deleteCustomer(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(tx, [id]);
    const [customer] = await softDeleteCustomersInTx(tx, customerIds);

    return { deleted: customer != null };
  });
}

export async function deleteCustomers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(tx, ids);
    const deletedCustomers = await softDeleteCustomersInTx(tx, customerIds);

    return { deletedCount: deletedCustomers.length };
  });
}

export async function resolveSalesLinePricing(
  values: ResolveSalesLinePricingInput
): Promise<SalesLinePricingResult> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await getValidatedCustomerInTx(tx, values.customerId);
    const itemsById = await getValidatedSalesItemsInTx(tx, [values.itemId]);
    const item = itemsById.get(values.itemId);

    if (!item) {
      throw new SalesError("Item not found", 404);
    }

    const [pricing, estimatedUnitCosts] = await Promise.all([
      resolvePricingForProductInTx(tx, {
        customerCategoryId: customer.customerCategoryId,
        customerCategoryName: customer.customerCategoryName,
        product: item,
        quantity: values.quantity,
      }),
      getEstimatedUnitCostsByItemIdInTx(tx, [values.itemId]),
    ]);

    return {
      ...pricing,
      estimatedUnitCost: estimatedUnitCosts.get(values.itemId) ?? null,
    };
  });
}

export async function getSalesOrderItemOptions(): Promise<SalesOrderItemOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        name: items.name,
        parentId: items.parentId,
        variantAttrs: items.variantAttrs,
        sku: items.sku,
        unitName: unitDefinitions.name,
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        stock: stockSubquery,
        committedQty: committedQtySubquery,
        demandQty: demandQtySubquery,
        shortageQty: shortageQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(
        and(
          inArray(items.itemType, ["product", "material"]),
          isNull(items.deletedAt),
          eq(items.isMaster, false),
        )
      )
      .orderBy(asc(items.name));

    const variantRows = rows.filter((row) => row.parentId != null);
    const parentIds = [
      ...new Set(variantRows.map((row) => row.parentId).filter((id): id is string => id != null)),
    ];

    const parentsById = new Map<string, { name: string; variantAxes: string[] | null }>();
    if (parentIds.length > 0) {
      const parents = await tx
        .select({
          id: items.id,
          name: items.name,
          variantAxes: items.variantAxes,
        })
        .from(items)
        .where(and(inArray(items.id, parentIds), isNull(items.deletedAt)));

      parents.forEach((parent) => {
        parentsById.set(parent.id, {
          name: parent.name,
          variantAxes: (parent.variantAxes as string[] | null) ?? null,
        });
      });
    }

    return rows
      .map((row) => {
        let displayName = row.name;

        if (row.parentId && row.variantAttrs) {
          const parent = parentsById.get(row.parentId);
          if (parent) {
            displayName = formatVariantDisplay(
              parent.name,
              (row.variantAttrs as Record<string, string>) ?? {},
              parent.variantAxes ?? [],
            );
          }
        }

        return {
          id: row.id,
          itemType: row.itemType as SalesOrderItemOption["itemType"],
          name: row.name,
          displayName,
          sku: row.sku,
          unitName: row.unitName,
          defaultSellingPrice: row.defaultSellingPrice,
          estimatedUnitCost: null,
          stock: row.stock,
          committedQty: row.committedQty,
          demandQty: row.demandQty,
          shortageQty: row.shortageQty,
          availableQty: row.availableQty,
          expectedQty: row.expectedQty,
          safetyStock: row.safetyStock,
        } satisfies SalesOrderItemOption;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  return measureObservedOperation(
    "sales.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const orderRows = await tx
          .select({
            id: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            customerName: salesOrders.customerName,
            customerEmail: customers.email,
            status: salesOrders.status,
            orderDate: salesOrders.orderDate,
            shipDate: salesOrders.shipDate,
            requestedDate: salesOrders.requestedDate,
            shippedAt: salesOrders.shippedAt,
            totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
            deletedAt: salesOrders.deletedAt,
            createdAt: salesOrders.createdAt,
            updatedAt: salesOrders.updatedAt,
          })
          .from(salesOrders)
          .leftJoin(customers, eq(salesOrders.customerId, customers.id))
          .where(isNull(salesOrders.deletedAt))
          .orderBy(
            desc(salesOrders.createdAt),
            asc(salesOrders.orderNumber),
            asc(salesOrders.id)
          );

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const manufacturingSummaries = await getSalesOrderManufacturingSummariesInTx(
          tx,
          orderIds
        );
        const openManufacturingRows = await tx
          .select({
            salesOrderId: manufacturingOrders.salesOrderId,
            orderNumber: manufacturingOrders.orderNumber,
            status: manufacturingOrders.status,
          })
          .from(manufacturingOrders)
          .where(
            and(
              inArray(manufacturingOrders.salesOrderId, orderIds),
              isNull(manufacturingOrders.deletedAt),
              inArray(manufacturingOrders.status, ["draft", "released"])
            )
          );
        const openManufacturingBySalesOrderId = new Map<
          string,
          LinkedManufacturingStatus[]
        >();

        openManufacturingRows.forEach((row) => {
          if (!row.salesOrderId) return;
          const bucket = openManufacturingBySalesOrderId.get(row.salesOrderId) ?? [];
          bucket.push({
            orderNumber: row.orderNumber,
            status: row.status as LinkedManufacturingStatus["status"],
          });
          openManufacturingBySalesOrderId.set(row.salesOrderId, bucket);
        });

        const itemIds = [
          ...new Set(
            [...manufacturingSummaries.values()]
              .flatMap((summary) => summary.lines)
              .map((line) => line.itemId)
          ),
        ];
        const reservableRows = itemIds.length
          ? await tx
              .select({
                itemId: items.id,
                reservableOnHandQty: trimScaleNullable(
                  projectedReservableOnHandQtyExpr(items.organizationId, items.id)
                ).as("reservableOnHandQty"),
              })
              .from(items)
              .where(inArray(items.id, itemIds))
          : [];
        const reservableByItemId = new Map(
          reservableRows.map((row) => [row.itemId, row.reservableOnHandQty])
        );

        return orderRows.map((order) => {
          const manufacturingSummary = manufacturingSummaries.get(order.id);
          const summaryLines = manufacturingSummary?.lines ?? [];
          const hasManufacturableLines =
            manufacturingSummary?.hasManufacturableLines ?? false;
          const openManufacturingOrders =
            openManufacturingBySalesOrderId.get(order.id) ?? [];
          const stockBlockers = summaryLines.flatMap((line) => {
            const reservableOnHandQty = Number(
              reservableByItemId.get(line.itemId) ?? "0"
            );
            const quantity = Number(line.quantity);

            if (!Number.isFinite(quantity) || reservableOnHandQty >= quantity) {
              return [];
            }

            return [
              `${line.itemName} needs ${formatQuantity(line.quantity)} ${line.unitName}; ${formatQuantity(
                reservableByItemId.get(line.itemId) ?? "0"
              )} ${line.unitName} available`,
            ];
          });

          return {
            ...order,
            status: order.status as SalesOrderListRow["status"],
            itemSummary: summarizeItems(summaryLines),
            lines: summaryLines.map((line) => ({
              masterName: line.masterName,
              attrs: line.attrs,
              quantity: line.quantity,
              unitName: line.unitName,
            })),
            hasManufacturableLines,
            manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
            manufacturableDisabledReason:
              manufacturingSummary?.disabledReason ??
              "No manufacturable lines remain on this order.",
            openManufacturingOrderCount: openManufacturingOrders.length,
            shippingReadiness: buildShippingReadiness({
              status: order.status as SalesOrderListRow["status"],
              hasManufacturableLines,
              linkedManufacturingOrders: openManufacturingOrders,
              stockBlockers,
            }),
          };
        });
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    }
  );
}

export async function getSalesShippingQueue(): Promise<SalesShippingQueueRow[]> {
  const orders = await getSalesOrders();
  const queueCandidates = orders.filter(
    (order) => order.status === "confirmed" || order.status === "partially_shipped"
  );

  const details = await Promise.all(
    queueCandidates.map((order) => getSalesOrder(order.id))
  );

  return details.flatMap((order) => {
    if (!order) return [];
    if (order.status !== "confirmed" && order.status !== "partially_shipped") {
      return [];
    }
    const activeDraftShipment =
      order.shipments.find((shipment) => shipment.status === "draft") ?? null;
    const openManufacturingOrders = order.linkedManufacturingOrders.filter(
      (manufacturingOrder) =>
        manufacturingOrder.status === "draft" ||
        manufacturingOrder.status === "released"
    );

    return [
      {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: order.status,
        deliveryDate: order.requestedDate,
        requestedDate: order.requestedDate,
        shipDate: order.shipDate,
        notes: order.notes,
        shipLine1: order.shipLine1,
        shipLine2: order.shipLine2,
        shipCity: order.shipCity,
        shipRegion: order.shipRegion,
        shipPostcode: order.shipPostcode,
        shipCountry: order.shipCountry,
        activeDraftShipmentId: activeDraftShipment?.id ?? null,
        recommendedShipmentId: activeDraftShipment?.id ?? null,
        shippingReadiness: order.shippingReadiness,
        lines: order.lines,
        shipments: order.shipments,
        openManufacturingOrders,
      } satisfies SalesShippingQueueRow,
    ];
  });
}

export async function getSalesOrder(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<SalesOrderDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const orderConditions = [eq(salesOrders.id, id)];
    if (!options?.includeDeleted) {
      orderConditions.push(isNull(salesOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        customerEmail: customers.email,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shippedAt: salesOrders.shippedAt,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        xeroInvoiceId: salesOrders.xeroInvoiceId,
        xeroInvoiceNumber: salesOrders.xeroInvoiceNumber,
        xeroPushStatus: salesOrders.xeroPushStatus,
        xeroPushError: salesOrders.xeroPushError,
        xeroPushedAt: salesOrders.xeroPushedAt,
        xeroPushPayloadHash: salesOrders.xeroPushPayloadHash,
        xeroLastPushAttemptAt: salesOrders.xeroLastPushAttemptAt,
        xeroRetryCount: salesOrders.xeroRetryCount,
        xeroEmailStatus: salesOrders.xeroEmailStatus,
        xeroEmailError: salesOrders.xeroEmailError,
        xeroEmailedAt: salesOrders.xeroEmailedAt,
        totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .leftJoin(customers, eq(salesOrders.customerId, customers.id))
      .where(and(...orderConditions));

    if (!order) {
      return null;
    }

    const masterItems = alias(items, "master_items");
    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        unitName: salesOrderLines.unitName,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
          "cancelledQuantity"
        ),
        unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
        suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
          "suggestedUnitPrice"
        ),
        pricingSourceType: salesOrderLines.pricingSourceType,
        pricingScheduleName: salesOrderLines.pricingScheduleName,
        pricingBreakLabel: salesOrderLines.pricingBreakLabel,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
        lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
        sortOrder: salesOrderLines.sortOrder,
        createdAt: salesOrderLines.createdAt,
        updatedAt: salesOrderLines.updatedAt,
        variantAttrs: items.variantAttrs,
        masterName: masterItems.name,
        masterVariantAxes: masterItems.variantAxes,
        onHandQty: trimScaleNullable(
          projectedOnHandQtyExpr(items.organizationId, items.id)
        ).as("onHandQty"),
        availableQty: availableQtySubquery,
        allocatedQty: trimScale(sql`COALESCE((
          SELECT SUM(${inventoryReservationsSummary.quantity})
          FROM ${inventoryReservationsSummary}
          WHERE ${inventoryReservationsSummary.organizationId} = ${items.organizationId}
            AND ${inventoryReservationsSummary.itemId} = ${items.id}
            AND ${inventoryReservationsSummary.locationId} = ${defaultLocationIdSubquery(items.organizationId)}
            AND ${inventoryReservationsSummary.referenceType} = 'sales_order_line'
            AND ${inventoryReservationsSummary.referenceId} = ${salesOrderLines.id}
            AND ${inventoryReservationsSummary.quantity} > 0
        ), 0)`).as("allocatedQty"),
        potential: projectedPotentialQty(
          items.organizationId,
          items.id,
          items.itemType,
          items.manufacturingMode,
          items.expectedBatchYield
        ).as("potential"),
      })
      .from(salesOrderLines)
      .leftJoin(items, eq(salesOrderLines.itemId, items.id))
      .leftJoin(masterItems, eq(items.parentId, masterItems.id))
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    const estimatedUnitCosts = await getEstimatedUnitCostsByItemIdInTx(
      tx,
      lineRows.map((line) => line.itemId)
    );
    const actualLineCosts = await getActualSalesLineCostsByLineIdInTx(tx, id);

    const lines = lineRows.map(({
      variantAttrs,
      masterName,
      masterVariantAxes,
      ...rest
    }) => {
      const display = resolveVariantDisplay(
        rest.itemName,
        masterName == null ? null : { name: masterName, variantAxes: masterVariantAxes },
        variantAttrs
      );
      const estimatedUnitCost = estimatedUnitCosts.get(rest.itemId) ?? null;
      const estimatedMargin = calculateUnitMarginMetrics({
        quantity: rest.quantity,
        unitPrice: rest.unitPrice,
        unitCost: estimatedUnitCost,
      });
      const actualCost = actualLineCosts.get(rest.id) ?? null;
      const actualMargin = actualCost
        ? calculateMarginMetrics({
            revenue: rest.lineTotal,
            cogs: actualCost.cogs,
          })
        : null;
      const actualQuantity = actualCost ? Number.parseFloat(actualCost.quantity) : null;
      const actualCogs = actualCost ? Number.parseFloat(actualCost.cogs) : null;
      const actualUnitCost =
        actualQuantity != null &&
        actualCogs != null &&
        Number.isFinite(actualQuantity) &&
        Number.isFinite(actualCogs) &&
        actualQuantity > 0
          ? normalizeNumericScale(actualCogs / actualQuantity, 6)
          : null;

      return {
        ...rest,
        masterName: display.masterName,
        attrs: display.attrs,
        estimatedUnitCost,
        estimatedCogs: estimatedMargin?.cogs ?? null,
        estimatedGrossProfit: estimatedMargin?.grossProfit ?? null,
        estimatedMarginPercent: estimatedMargin?.marginPercent ?? null,
        actualUnitCost,
        actualCogs: actualMargin?.cogs ?? null,
        actualGrossProfit: actualMargin?.grossProfit ?? null,
        actualMarginPercent: actualMargin?.marginPercent ?? null,
      };
    });

    const shipmentRows = await tx
      .select({
        id: salesShipments.id,
        shipmentNumber: salesShipments.shipmentNumber,
        sequence: salesShipments.sequence,
        status: salesShipments.status,
        fulfillmentType: salesShipments.fulfillmentType,
        scheduledDate: salesShipments.scheduledDate,
        shippedAt: salesShipments.shippedAt,
        notes: salesShipments.notes,
        customerFreightChargeAmount: trimScaleNullable(
          salesShipments.customerFreightChargeAmount
        ).as("customerFreightChargeAmount"),
        createdAt: salesShipments.createdAt,
        updatedAt: salesShipments.updatedAt,
        lineId: salesShipmentLines.id,
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        itemId: salesShipmentLines.itemId,
        itemName: salesShipmentLines.itemName,
        itemSku: salesShipmentLines.itemSku,
        unitName: salesShipmentLines.unitName,
        lineQuantity: trimScale(salesShipmentLines.quantity).as("lineQuantity"),
        sortOrder: salesShipmentLines.sortOrder,
      })
      .from(salesShipments)
      .leftJoin(
        salesShipmentLines,
        eq(salesShipmentLines.salesShipmentId, salesShipments.id)
      )
      .where(eq(salesShipments.salesOrderId, id))
      .orderBy(asc(salesShipments.sequence), asc(salesShipmentLines.sortOrder));

    const shipmentsById = new Map<string, SalesShipmentRow>();
    const shippedByLine = new Map<string, number>();
    const plannedByLine = new Map<string, number>();

    shipmentRows.forEach((row) => {
      const existing = shipmentsById.get(row.id);
      const shipment =
        existing ??
        ({
          id: row.id,
          shipmentNumber: row.shipmentNumber,
          sequence: row.sequence,
          status: row.status as SalesShipmentRow["status"],
          fulfillmentType: row.fulfillmentType as SalesShipmentRow["fulfillmentType"],
          scheduledDate: row.scheduledDate,
          shippedAt: row.shippedAt,
          notes: row.notes,
          customerFreightChargeAmount: row.customerFreightChargeAmount,
          lines: [],
          costs: [],
          marginSummary: buildSalesMarginSummary({
            productRevenue: 0,
            freightRecovery: 0,
            productCogs: 0,
            shipmentCosts: 0,
            costStatus: row.status === "shipped" ? "actual" : "estimated",
          }),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies SalesShipmentRow);

      if (row.lineId && row.salesOrderLineId && row.itemId && row.lineQuantity) {
        shipment.lines.push({
          id: row.lineId,
          salesOrderLineId: row.salesOrderLineId,
          itemId: row.itemId,
          itemName: row.itemName ?? "",
          itemSku: row.itemSku,
          unitName: row.unitName ?? "",
          quantity: row.lineQuantity,
          sortOrder: row.sortOrder ?? 0,
        });

        const quantity = parseFloat(row.lineQuantity);
        if (row.status === "shipped") {
          shippedByLine.set(
            row.salesOrderLineId,
            normalizeShipmentQuantity(
              (shippedByLine.get(row.salesOrderLineId) ?? 0) + quantity
            )
          );
        } else if (row.status === "draft") {
          plannedByLine.set(
            row.salesOrderLineId,
            normalizeShipmentQuantity(
              (plannedByLine.get(row.salesOrderLineId) ?? 0) + quantity
            )
          );
        }
      }

      shipmentsById.set(row.id, shipment);
    });

    const shipments = [...shipmentsById.values()];
    const shipmentIds = shipments.map((shipment) => shipment.id);
    const shipmentCostRows =
      shipmentIds.length === 0
        ? []
        : await tx
            .select({
              id: salesShipmentCosts.id,
              salesShipmentId: salesShipmentCosts.salesShipmentId,
              costType: salesShipmentCosts.costType,
              costStatus: salesShipmentCosts.costStatus,
              amount: trimScale(salesShipmentCosts.amount).as("amount"),
              vendorName: salesShipmentCosts.vendorName,
              referenceNumber: salesShipmentCosts.referenceNumber,
              incurredDate: salesShipmentCosts.incurredDate,
              notes: salesShipmentCosts.notes,
              createdAt: salesShipmentCosts.createdAt,
              updatedAt: salesShipmentCosts.updatedAt,
            })
            .from(salesShipmentCosts)
            .where(inArray(salesShipmentCosts.salesShipmentId, shipmentIds))
            .orderBy(
              asc(salesShipmentCosts.costStatus),
              asc(salesShipmentCosts.costType),
              asc(salesShipmentCosts.createdAt)
            );

    shipmentCostRows.forEach((row) => {
      const shipment = shipmentsById.get(row.salesShipmentId);
      if (!shipment) return;

      shipment.costs.push({
        id: row.id,
        costType: row.costType as SalesShipmentRow["costs"][number]["costType"],
        costStatus: row.costStatus as SalesShipmentRow["costs"][number]["costStatus"],
        amount: row.amount,
        vendorName: row.vendorName,
        referenceNumber: row.referenceNumber,
        incurredDate: row.incurredDate,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });

    const actualShipmentCogs = await getActualShipmentCogsByShipmentIdInTx(
      tx,
      shipmentIds
    );
    const orderLinesById = new Map(lines.map((line) => [line.id, line]));

    shipments.forEach((shipment) => {
      const productRevenue = shipment.lines.reduce((sum, shipmentLine) => {
        const orderLine = orderLinesById.get(shipmentLine.salesOrderLineId);
        return (
          sum +
          parseMoneyValue(orderLine?.unitPrice) *
            parseMoneyValue(shipmentLine.quantity)
        );
      }, 0);
      let productCogs: number | null = null;
      let productCostStatus: SalesMarginSummary["costStatus"] = "unknown";

      if (shipment.status === "shipped") {
        const actual = actualShipmentCogs.get(shipment.id);
        productCogs = actual == null ? null : parseMoneyValue(actual.cogs);
        productCostStatus = actual == null ? "unknown" : "actual";
      } else if (shipment.status !== "cancelled") {
        let estimatedCogs = 0;
        let hasMissingCost = false;

        for (const shipmentLine of shipment.lines) {
          const estimatedUnitCost = estimatedUnitCosts.get(shipmentLine.itemId);
          if (estimatedUnitCost == null) {
            hasMissingCost = true;
            break;
          }

          estimatedCogs +=
            parseMoneyValue(estimatedUnitCost) *
            parseMoneyValue(shipmentLine.quantity);
        }

        productCogs = hasMissingCost ? null : estimatedCogs;
        productCostStatus = hasMissingCost ? "unknown" : "estimated";
      }

      const shipmentCostSelection = selectShipmentCostAmount(
        shipment.costs,
        productCostStatus
      );
      shipment.marginSummary = buildSalesMarginSummary({
        productRevenue,
        freightRecovery: 0,
        productCogs,
        shipmentCosts: shipmentCostSelection.amount,
        costStatus: combineMarginStatuses([
          productCostStatus,
          shipmentCostSelection.status,
        ]),
      });
    });

    const activeShipmentSummaries = shipments
      .filter((shipment) => shipment.status !== "cancelled")
      .map((shipment) => shipment.marginSummary);
    const orderFreightRecovery = activeShipmentSummaries.reduce(
      (sum, summary) => sum + parseMoneyValue(summary.freightRecovery),
      0
    );
    const orderShipmentCosts = activeShipmentSummaries.reduce(
      (sum, summary) => sum + parseMoneyValue(summary.shipmentCosts),
      0
    );
    const orderMarginSummary =
      order.status === "shipped"
        ? (() => {
            const orderProductCogs = activeShipmentSummaries.some(
              (summary) => summary.productCogs == null
            )
              ? null
              : activeShipmentSummaries.reduce(
                  (sum, summary) => sum + parseMoneyValue(summary.productCogs),
                  0
                );

            return buildSalesMarginSummary({
              productRevenue: activeShipmentSummaries.reduce(
                (sum, summary) => sum + parseMoneyValue(summary.productRevenue),
                0
              ),
              freightRecovery: orderFreightRecovery,
              productCogs: orderProductCogs,
              shipmentCosts: orderShipmentCosts,
              costStatus: combineMarginStatuses(
                activeShipmentSummaries.map((summary) => summary.costStatus)
              ),
            });
          })()
        : buildSalesMarginSummary({
            productRevenue: lines.reduce(
              (sum, line) => sum + parseMoneyValue(line.lineTotal),
              0
            ),
            freightRecovery: orderFreightRecovery,
            productCogs: lines.some((line) => line.estimatedCogs == null)
              ? null
              : lines.reduce(
                  (sum, line) => sum + parseMoneyValue(line.estimatedCogs),
                  0
                ),
            shipmentCosts: orderShipmentCosts,
            costStatus: lines.some((line) => line.estimatedCogs == null)
              ? "unknown"
              : "estimated",
          });

    const linesWithFulfillment = lines.map((line) => {
      const shippedQuantity = shippedByLine.get(line.id) ?? 0;
      const plannedQuantity = plannedByLine.get(line.id) ?? 0;
      const cancelledQuantity = parseFloat(line.cancelledQuantity);
      const orderedQuantity = parseFloat(line.quantity);
      const remainingQuantity = normalizeShipmentQuantity(
        orderedQuantity - shippedQuantity - cancelledQuantity
      );
      const unplannedRemainingQuantity = normalizeShipmentQuantity(
        remainingQuantity - plannedQuantity
      );

      return {
        ...line,
        shippedQuantity: normalizeNumeric(shippedQuantity),
        plannedQuantity: normalizeNumeric(plannedQuantity),
        cancelledQuantity: normalizeNumeric(cancelledQuantity),
        remainingQuantity: normalizeNumeric(remainingQuantity),
        unplannedRemainingQuantity: normalizeNumeric(unplannedRemainingQuantity),
      };
    });

    const manufacturingSummary = (
      await getSalesOrderManufacturingSummariesInTx(tx, [id])
    ).get(id);

    const linkedManufacturingOrders = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        unitName: manufacturingOrders.unitName,
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.salesOrderId, id),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .orderBy(
        desc(manufacturingOrders.createdAt),
        asc(manufacturingOrders.orderNumber),
        asc(manufacturingOrders.id)
      );

    const hasManufacturableLines = manufacturingSummary?.hasManufacturableLines ?? false;
    const linkedManufacturingOrderRows = linkedManufacturingOrders.map((row) => ({
      ...row,
      status: row.status as SalesOrderDetail["linkedManufacturingOrders"][number]["status"],
    }));
    const stockBlockers = linesWithFulfillment.flatMap((line) => {
      const availableQty = Number(line.availableQty ?? "0");
      const allocatedQty = Number(line.allocatedQty ?? "0");
      const fulfillmentAvailableQty =
        availableQty + (Number.isFinite(allocatedQty) ? allocatedQty : 0);
      const quantity = Number(line.remainingQuantity);

      if (!Number.isFinite(quantity) || fulfillmentAvailableQty >= quantity) {
        return [];
      }

      return [
        `${line.itemName} needs ${formatQuantity(line.remainingQuantity)} ${line.unitName}; ${formatQuantity(
          fulfillmentAvailableQty.toString()
        )} ${line.unitName} available`,
      ];
    });

    return {
      ...order,
      status: order.status as SalesOrderDetail["status"],
      xeroPushStatus: order.xeroPushStatus as SalesOrderDetail["xeroPushStatus"],
      xeroEmailStatus:
        order.xeroEmailStatus as SalesOrderDetail["xeroEmailStatus"],
      lines: linesWithFulfillment as SalesOrderDetailLine[],
      shipments,
      marginSummary: orderMarginSummary,
      hasManufacturableLines,
      manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
      manufacturableDisabledReason:
        manufacturingSummary?.disabledReason ?? "No manufacturable lines remain on this order.",
      shippingReadiness: buildShippingReadiness({
        status: order.status as SalesOrderDetail["status"],
        hasManufacturableLines,
        linkedManufacturingOrders: linkedManufacturingOrderRows,
        stockBlockers,
      }),
      linkedManufacturingOrders: linkedManufacturingOrderRows,
    };
  });
}

export async function getEditableSalesOrder(id: string): Promise<SalesOrderEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        status: salesOrders.status,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "draft")
        )
      );

    if (!order) {
      return null;
    }

    const lines = await getOrderLinesInTx(tx, id);

    return {
      ...order,
      status: "draft",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        suggestedUnitPrice: line.suggestedUnitPrice,
        pricingSourceType: (line.pricingSourceType ??
          "base_price") as PricingSourceType,
        pricingScheduleName: line.pricingScheduleName,
        pricingBreakLabel: line.pricingBreakLabel,
        isPriceOverridden: line.isPriceOverridden,
      })),
    };
  });
}

export async function createSalesOrder(
  data: InsertSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: data,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const shouldCheckOversell =
      data.status === "confirmed" && data.confirmOversell !== true;
    const prepared = await prepareOrderPayload(tx, data, {
      lockItems: shouldCheckOversell,
    });

    if (shouldCheckOversell) {
      const oversell = await buildOversellWarning(
        prepared.preparedLines,
        prepared.itemsById
      );

      if (oversell) {
        throw new SalesError(
          "This confirmation would oversell one or more items.",
          409,
          { oversell }
        );
      }
    }

    const orderNumber = await generateOrderNumber(tx);
    const [order] = await tx
      .insert(salesOrders)
      .values({
        organizationId: orgId,
        orderNumber,
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        status: data.status,
        orderDate: prepared.orderDate,
        shipDate: prepared.shipDate,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
        totalAmount: prepared.totalAmount,
      })
      .returning({ id: salesOrders.id });

    const insertedLines = await tx.insert(salesOrderLines).values(
      prepared.preparedLines.map((line) => ({
        salesOrderId: order.id,
        ...line,
      }))
    ).returning({
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      quantity: salesOrderLines.quantity,
    });

    if (data.status === "confirmed") {
      await reserveForSalesInTx(tx, {
        organizationId: orgId,
        salesOrderId: order.id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "create-confirmed-order"
        ),
        lines: insertedLines.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: parseFloat(line.quantity),
        })),
      });

      await upsertDefaultDraftShipmentForOrderInTx(tx, orgId, {
        id: order.id,
        orderNumber,
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        shipDate: prepared.shipDate,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: order,
    });

    return order;
  });
}

export async function updateSalesOrder(
  id: string,
  data: UpdateSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, data },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, id);

    if (!existingOrder) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const existingLines = await getOrderLinesInTx(tx, id);

    if (existingOrder.status === "confirmed") {
      if (!isCancelPayload(data)) {
        throw new SalesError("Confirmed orders cannot be edited.", 400);
      }

      await tx
        .update(salesOrders)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, id));

      await releaseReservationForSalesLineInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "cancel-confirmed-order"
        ),
        reason: "cancelled",
        salesOrderLineIds: existingLines.map((line) => line.id),
      });
      const result = { id };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (existingOrder.status === "cancelled") {
      throw new SalesError("Cancelled orders cannot be changed.", 400);
    }

    if (existingOrder.status === "shipped") {
      throw new SalesError("Shipped orders cannot be changed.", 400);
    }

    if (existingOrder.status === "partially_shipped") {
      throw new SalesError("Use cancel remaining for partially shipped orders.", 400);
    }

    if (isCancelPayload(data)) {
      throw new SalesError("Draft orders cannot be cancelled.", 400);
    }

    const shouldCheckOversell =
      data.status === "confirmed" && data.confirmOversell !== true;
    const prepared = await prepareOrderPayload(tx, data, {
      lockItems: shouldCheckOversell,
    });

    if (shouldCheckOversell) {
      const oversell = await buildOversellWarning(
        prepared.preparedLines,
        prepared.itemsById
      );

      if (oversell) {
        throw new SalesError(
          "This confirmation would oversell one or more items.",
          409,
          { oversell }
        );
      }
    }

    await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));

    const insertedLines = await tx.insert(salesOrderLines).values(
      prepared.preparedLines.map((line) => ({
        salesOrderId: id,
        ...line,
      }))
    ).returning({
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      quantity: salesOrderLines.quantity,
    });

    await tx
      .update(salesOrders)
      .set({
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        status: data.status,
        orderDate: prepared.orderDate,
        shipDate: prepared.shipDate,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
        totalAmount: prepared.totalAmount,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));

    if (data.status === "confirmed") {
      await reserveForSalesInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "update-to-confirmed"
        ),
        lines: insertedLines.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: parseFloat(line.quantity),
        })),
      });

      await upsertDefaultDraftShipmentForOrderInTx(tx, orgId, {
        id,
        orderNumber: existingOrder.orderNumber,
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        shipDate: prepared.shipDate,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
      });
    }

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export type BolSalesOrderData = {
  orderNumber: string;
  customerName: string;
  requestedDate: string | null;
  shippedAt: Date | null;
  notes: string | null;
  status: string;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  lines: Array<{
    itemName: string;
    itemSku: string | null;
    quantity: string;
    unitName: string;
  }>;
};

export async function getSalesOrderForBol(
  id: string
): Promise<BolSalesOrderData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        orderNumber: salesOrders.orderNumber,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        requestedDate: salesOrders.requestedDate,
        shippedAt: salesOrders.shippedAt,
        notes: salesOrders.notes,
        status: salesOrders.status,
        shipDate: salesOrders.shipDate,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));

    if (!order) return null;
    if (order.status !== "shipped") return null;

    const lines = await tx
      .select({
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        unitName: salesOrderLines.unitName,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder));

    const shipAddress = await resolveShipmentAddressInTx(tx, order);

    return {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      requestedDate: order.requestedDate,
      shippedAt: order.shippedAt,
      notes: order.notes,
      status: order.status,
      ...shipAddress,
      lines,
    };
  });
}

export type BolSalesShipmentData = {
  orderNumber: string;
  shipmentNumber: string;
  customerName: string;
  requestedDate: string | null;
  scheduledDate: string | null;
  shippedAt: Date | null;
  notes: string | null;
  status: string;
  fulfillmentType: string;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  lines: Array<{
    itemName: string;
    itemSku: string | null;
    quantity: string;
    unitName: string;
  }>;
};

export async function getSalesShipmentForBol(
  orderId: string,
  shipmentId: string
): Promise<BolSalesShipmentData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [shipment] = await tx
      .select({
        orderNumber: salesShipments.orderNumber,
        shipmentNumber: salesShipments.shipmentNumber,
        customerName: salesShipments.customerName,
        customerId: salesOrders.customerId,
        requestedDate: salesOrders.requestedDate,
        scheduledDate: salesShipments.scheduledDate,
        shippedAt: salesShipments.shippedAt,
        notes: salesShipments.notes,
        status: salesShipments.status,
        fulfillmentType: salesShipments.fulfillmentType,
        shipLine1: salesShipments.shipLine1,
        shipLine2: salesShipments.shipLine2,
        shipCity: salesShipments.shipCity,
        shipRegion: salesShipments.shipRegion,
        shipPostcode: salesShipments.shipPostcode,
        shipCountry: salesShipments.shipCountry,
        orderShipLine1: salesOrders.shipLine1,
        orderShipLine2: salesOrders.shipLine2,
        orderShipCity: salesOrders.shipCity,
        orderShipRegion: salesOrders.shipRegion,
        orderShipPostcode: salesOrders.shipPostcode,
        orderShipCountry: salesOrders.shipCountry,
      })
      .from(salesShipments)
      .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesShipments.id, shipmentId),
          eq(salesShipments.salesOrderId, orderId),
          isNull(salesOrders.deletedAt)
        )
      );

    if (!shipment || shipment.status === "cancelled") return null;

    const lines = await tx
      .select({
        itemName: salesShipmentLines.itemName,
        itemSku: salesShipmentLines.itemSku,
        quantity: trimScale(salesShipmentLines.quantity).as("quantity"),
        unitName: salesShipmentLines.unitName,
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipmentId))
      .orderBy(asc(salesShipmentLines.sortOrder));

    const shipAddress = hasShipAddress(shipment)
      ? {
          shipLine1: shipment.shipLine1,
          shipLine2: shipment.shipLine2,
          shipCity: shipment.shipCity,
          shipRegion: shipment.shipRegion,
          shipPostcode: shipment.shipPostcode,
          shipCountry: shipment.shipCountry,
        }
      : await resolveShipmentAddressInTx(tx, {
          customerId: shipment.customerId,
          shipLine1: shipment.orderShipLine1,
          shipLine2: shipment.orderShipLine2,
          shipCity: shipment.orderShipCity,
          shipRegion: shipment.orderShipRegion,
          shipPostcode: shipment.orderShipPostcode,
          shipCountry: shipment.orderShipCountry,
        });

    return {
      orderNumber: shipment.orderNumber,
      shipmentNumber: shipment.shipmentNumber,
      customerName: shipment.customerName,
      requestedDate: shipment.requestedDate,
      scheduledDate: shipment.scheduledDate,
      shippedAt: shipment.shippedAt,
      notes: shipment.notes,
      status: shipment.status,
      fulfillmentType: shipment.fulfillmentType,
      ...shipAddress,
      lines,
    };
  });
}

export async function planSalesOrderFulfillment(
  orderId: string,
  data: SalesFulfillmentPlanInput,
  options?: { idempotencyKey?: string }
): Promise<SalesFulfillmentPlanResult | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<SalesFulfillmentPlanResult | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "planSalesOrderFulfillment",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { orderId, data },
      }
    );

    if (replay.replayed) return replay.result;

    const [order] = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        status: salesOrders.status,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, orderId), isNull(salesOrders.deletedAt)))
      .for("update");

    if (!order) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (!["confirmed", "partially_shipped"].includes(order.status)) {
      throw new SalesError(
        "Only confirmed or partially shipped orders can be planned for fulfillment.",
        400
      );
    }

    if (order.requestedDate !== data.deliveryDate) {
      await tx
        .update(salesOrders)
        .set({ requestedDate: data.deliveryDate, updatedAt: new Date() })
        .where(eq(salesOrders.id, order.id));
    }

    const shipmentId = await upsertDraftShipmentForFulfillmentPlanInTx(
      tx,
      orgId,
      order,
      data
    );
    await syncSalesOrderShipDateFromShipmentsInTx(tx, order.id);
    const result = {
      id: order.id,
      shipmentId,
    };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function createSalesShipment(
  orderId: string,
  data: SalesShipmentInput,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "createSalesShipment",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, data },
    });

    if (replay.replayed) return replay.result;

    const [order] = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        status: salesOrders.status,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, orderId), isNull(salesOrders.deletedAt)))
      .for("update");

    if (!order) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (!["confirmed", "partially_shipped"].includes(order.status)) {
      throw new SalesError(
        "Only confirmed or partially shipped orders can have shipments.",
        400
      );
    }

    const states = await getShipmentLineStatesInTx(tx, orderId);
    const entries = buildShipmentEntries(states, data);
    const sequence = await getNextShipmentSequenceInTx(tx, orderId);
    const shipmentNumber = `${order.orderNumber}-S${sequence}`;
    const shipAddress = await resolveShipmentAddressInTx(tx, order);
    const now = new Date();

    const [shipment] = await tx
      .insert(salesShipments)
      .values({
        organizationId: orgId,
        salesOrderId: orderId,
        shipmentNumber,
        sequence,
        status: "draft",
        fulfillmentType: data.fulfillmentType,
        scheduledDate: data.scheduledDate,
        notes: data.notes,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        ...shipAddress,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: salesShipments.id });

    await tx.insert(salesShipmentLines).values(
      entries.map((entry) => ({
        salesShipmentId: shipment.id,
        salesOrderLineId: entry.state.id,
        itemId: entry.state.itemId,
        itemName: entry.state.itemName,
        itemSku: entry.state.itemSku,
        unitName: entry.state.unitName,
        quantity: normalizeNumeric(entry.quantity),
        sortOrder: entry.state.sortOrder,
      }))
    );

    await syncSalesOrderShipDateFromShipmentsInTx(tx, orderId);

    const result = { id: shipment.id };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function updateSalesShipment(
  orderId: string,
  shipmentId: string,
  data: SalesShipmentInput,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateSalesShipment",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, shipmentId, data },
    });

    if (replay.replayed) return replay.result;

    const [shipment] = await tx
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        customerId: salesOrders.customerId,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesShipments)
      .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesShipments.id, shipmentId),
          eq(salesShipments.salesOrderId, orderId),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (!shipment) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (shipment.status !== "draft") {
      throw new SalesError("Only draft shipments can be edited.", 400);
    }

    const states = await getShipmentLineStatesInTx(tx, orderId, {
      excludeShipmentId: shipmentId,
    });
    const entries = buildShipmentEntries(states, data);
    const shipAddress = await resolveShipmentAddressInTx(tx, shipment);

    await tx.delete(salesShipmentLines).where(
      eq(salesShipmentLines.salesShipmentId, shipmentId)
    );
    await tx.insert(salesShipmentLines).values(
      entries.map((entry) => ({
        salesShipmentId: shipmentId,
        salesOrderLineId: entry.state.id,
        itemId: entry.state.itemId,
        itemName: entry.state.itemName,
        itemSku: entry.state.itemSku,
        unitName: entry.state.unitName,
        quantity: normalizeNumeric(entry.quantity),
        sortOrder: entry.state.sortOrder,
      }))
    );

    await tx
      .update(salesShipments)
      .set({
        fulfillmentType: data.fulfillmentType,
        scheduledDate: data.scheduledDate,
        notes: data.notes,
        ...shipAddress,
        updatedAt: new Date(),
      })
      .where(eq(salesShipments.id, shipmentId));

    await syncSalesOrderShipDateFromShipmentsInTx(tx, orderId);

    const result = { id: shipmentId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function updateSalesShipmentCosts(
  orderId: string,
  shipmentId: string,
  data: SalesShipmentCostsInput
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [shipment] = await tx
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
      })
      .from(salesShipments)
      .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesShipments.id, shipmentId),
          eq(salesShipments.salesOrderId, orderId),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (!shipment) {
      return null;
    }

    if (shipment.status === "cancelled") {
      throw new SalesError("Cancelled shipments cannot have costs edited.", 400);
    }

    const now = new Date();

    await tx
      .update(salesShipments)
      .set({
        customerFreightChargeAmount: data.customerFreightChargeAmount,
        updatedAt: now,
      })
      .where(eq(salesShipments.id, shipmentId));

    await tx
      .delete(salesShipmentCosts)
      .where(eq(salesShipmentCosts.salesShipmentId, shipmentId));

    if (data.costs.length > 0) {
      await tx.insert(salesShipmentCosts).values(
        data.costs.map((cost) => ({
          organizationId: orgId,
          salesShipmentId: shipmentId,
          costType: cost.costType,
          costStatus: cost.costStatus,
          amount: cost.amount,
          vendorName: cost.vendorName,
          referenceNumber: cost.referenceNumber,
          incurredDate: cost.incurredDate,
          notes: cost.notes,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    return { id: shipmentId };
  });
}

export async function cancelSalesShipment(
  orderId: string,
  shipmentId: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "cancelSalesShipment",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, shipmentId },
    });

    if (replay.replayed) return replay.result;

    const [shipment] = await tx
      .select({ id: salesShipments.id, status: salesShipments.status })
      .from(salesShipments)
      .innerJoin(salesOrders, eq(salesShipments.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesShipments.id, shipmentId),
          eq(salesShipments.salesOrderId, orderId),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (!shipment) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (shipment.status === "shipped") {
      throw new SalesError("Shipped shipments cannot be cancelled.", 400);
    }

    if (shipment.status !== "cancelled") {
      await tx
        .update(salesShipments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(salesShipments.id, shipmentId));

      await syncSalesOrderShipDateFromShipmentsInTx(tx, orderId);
    }

    const result = { id: shipmentId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function shipSalesShipment(
  orderId: string,
  shipmentId: string,
  payload: ShipSalesShipment = {},
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      shipmentId: string;
      orderId: string;
      orderShipped: boolean;
    } | null>(tx, {
      organizationId: orgId,
      operationName: "shipSalesShipment",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, shipmentId, payload },
    });

    if (replay.replayed) {
      return { replayed: true as const, result: replay.result, orgId };
    }

    const order = await getLockedSalesOrderInTx(tx, orderId);
    if (!order) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return { replayed: false as const, result, orgId };
    }

    if (!["confirmed", "partially_shipped"].includes(order.status)) {
      throw new SalesError(
        "Only confirmed or partially shipped orders can ship shipments.",
        400
      );
    }

    const [shipment] = await tx
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
      })
      .from(salesShipments)
      .where(
        and(
          eq(salesShipments.id, shipmentId),
          eq(salesShipments.salesOrderId, orderId)
        )
      )
      .for("update");

    if (!shipment) {
      throw new SalesError("Shipment not found.", 404);
    }

    if (shipment.status === "shipped") {
      throw new SalesError("Shipment is already shipped.", 400);
    }
    if (shipment.status === "cancelled") {
      throw new SalesError("Cancelled shipments cannot be shipped.", 400);
    }

    const shipmentLines = await tx
      .select({
        salesOrderLineId: salesShipmentLines.salesOrderLineId,
        itemId: salesShipmentLines.itemId,
        itemName: salesShipmentLines.itemName,
        quantity: trimScale(salesShipmentLines.quantity).as("quantity"),
      })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipmentId))
      .orderBy(asc(salesShipmentLines.sortOrder));

    if (shipmentLines.length === 0) {
      throw new SalesError("Shipment must include at least one line.", 400);
    }

    const states = await getShipmentLineStatesInTx(tx, orderId, {
      excludeShipmentId: shipmentId,
    });
    for (const line of shipmentLines) {
      const state = states.get(line.salesOrderLineId);
      if (!state) {
        throw new SalesError("Shipment line no longer matches this order.", 400);
      }
      const quantity = parseFloat(line.quantity);
      if (quantity > remainingToShip(state)) {
        throw new SalesError("Cannot ship more than the remaining quantity.", 400);
      }
    }

    const shippedAt = new Date();
    try {
      await consumeForShipmentInTx(tx, {
        organizationId: orgId,
        salesOrderId: orderId,
        salesShipmentId: shipmentId,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "ship-sales-shipment"
        ),
        shippedAt,
        lines: shipmentLines.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: parseFloat(line.quantity),
        })),
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        const blockingLine = shipmentLines.find(
          (line) => line.itemId === error.itemId
        );
        throw new SalesError(
          `Cannot ship shipment. Insufficient stock for ${blockingLine?.itemName ?? "one item"}.`,
          409
        );
      }
      throw error;
    }

    await tx
      .update(salesShipments)
      .set({
        status: "shipped",
        shippedAt,
        updatedAt: shippedAt,
      })
      .where(eq(salesShipments.id, shipmentId));

    const finalStates = await getShipmentLineStatesInTx(tx, orderId);
    const allClosed = [...finalStates.values()].every(
      (line) => remainingToShip(line) <= 0
    );
    const [updatedOrder] = await tx
      .update(salesOrders)
      .set({
        status: allClosed ? "shipped" : "partially_shipped",
        shippedAt: allClosed ? shippedAt : null,
        updatedAt: shippedAt,
      })
      .where(eq(salesOrders.id, orderId))
      .returning({ id: salesOrders.id, status: salesOrders.status });

    const result = {
      shipmentId,
      orderId: updatedOrder.id,
      orderShipped: updatedOrder.status === "shipped",
    };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return { replayed: false as const, result, orgId };
  });

  if (!result.result) return null;
  if (result.replayed || !result.result.orderShipped || payload.syncAccounting === false) {
    return result.result;
  }

  const { pushSalesOrderToXero, markXeroPushFailed } = await import(
    "@/lib/xero/push-invoice"
  );
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushSalesOrderToXero(result.orgId, orderId);
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      if (!error.message.includes("not connected")) {
        await markXeroPushFailed(result.orgId, orderId, error);
      }
    } else {
      await markXeroPushFailed(result.orgId, orderId, error);
    }
  }

  return result.result;
}

export async function cancelRemainingSalesOrder(
  orderId: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "cancelRemainingSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId },
    });

    if (replay.replayed) return replay.result;

    const order = await getLockedSalesOrderInTx(tx, orderId);
    if (!order) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (!["confirmed", "partially_shipped"].includes(order.status)) {
      throw new SalesError(
        "Only confirmed or partially shipped orders can cancel remaining quantities.",
        400
      );
    }

    await tx
      .update(salesShipments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(salesShipments.salesOrderId, orderId),
          eq(salesShipments.status, "draft")
        )
      );

    const states = await getShipmentLineStatesInTx(tx, orderId);
    const remainingLines = [...states.values()]
      .map((line) => ({
        ...line,
        remaining: remainingToShip(line),
      }))
      .filter((line) => line.remaining > 0);

    if (remainingLines.length === 0) {
      throw new SalesError("There is no remaining quantity to cancel.", 400);
    }

    for (const line of remainingLines) {
      await tx
        .update(salesOrderLines)
        .set({
          cancelledQuantity: normalizeNumeric(
            line.cancelledQuantity + line.remaining
          ),
          updatedAt: new Date(),
        })
        .where(eq(salesOrderLines.id, line.id));
    }

    await releaseReservationForSalesQuantitiesInTx(tx, {
      organizationId: orgId,
      salesOrderId: orderId,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "cancel-remaining"
      ),
      reason: "cancelled",
      lines: remainingLines.map((line) => ({
        salesOrderLineId: line.id,
        itemId: line.itemId,
        quantity: line.remaining,
      })),
    });

    await tx
      .update(salesOrders)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));

    const result = { id: orderId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}

export async function shipSalesOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
    syncAccounting?: boolean;
  }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "shipSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        id,
        syncAccounting: options?.syncAccounting ?? true,
      },
    });

    if (replay.replayed) {
      return {
        replayed: true as const,
        shipped: replay.result,
        orgId,
      };
    }

    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        shipped: null,
        orgId,
      };
    }

    if (order.status === "draft") {
      throw new SalesError("Only confirmed orders can be shipped.", 400);
    }

    if (order.status === "cancelled") {
      throw new SalesError("Cancelled orders cannot be shipped.", 400);
    }

    if (order.status === "shipped") {
      throw new SalesError("Order is already shipped.", 400);
    }

    if (order.status === "partially_shipped") {
      throw new SalesError("Create a shipment for the remaining quantities.", 400);
    }

    const lines = await getOrderLinesInTx(tx, id);

    try {
      await consumeForShipmentInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "ship-order"
        ),
        shippedAt: new Date(),
        lines: lines.map((line) => ({
          salesOrderLineId: line.id,
          itemId: line.itemId,
          quantity: parseFloat(line.quantity),
        })),
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        const blockingLine = lines.find((line) => line.itemId === error.itemId);
        throw new SalesError(
          `Cannot ship order. Insufficient stock for ${blockingLine?.itemName ?? "one item"}.`,
          409
        );
      }

      throw error;
    }

    const [currentOrder] = await tx
      .select({
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, id));

    const orderHasShipAddress =
      currentOrder &&
      (currentOrder.shipLine1 != null ||
        currentOrder.shipLine2 != null ||
        currentOrder.shipCity != null ||
        currentOrder.shipRegion != null ||
        currentOrder.shipPostcode != null ||
        currentOrder.shipCountry != null);

    let shipLine1 = currentOrder?.shipLine1 ?? null;
    let shipLine2 = currentOrder?.shipLine2 ?? null;
    let shipCity = currentOrder?.shipCity ?? null;
    let shipRegion = currentOrder?.shipRegion ?? null;
    let shipPostcode = currentOrder?.shipPostcode ?? null;
    let shipCountry = currentOrder?.shipCountry ?? null;

    if (!orderHasShipAddress && currentOrder) {
      const [customer] = await tx
        .select({
          shipLine1: customers.shipLine1,
          shipLine2: customers.shipLine2,
          shipCity: customers.shipCity,
          shipRegion: customers.shipRegion,
          shipPostcode: customers.shipPostcode,
          shipCountry: customers.shipCountry,
          billingLine1: customers.billingLine1,
          billingLine2: customers.billingLine2,
          billingCity: customers.billingCity,
          billingRegion: customers.billingRegion,
          billingPostcode: customers.billingPostcode,
          billingCountry: customers.billingCountry,
        })
        .from(customers)
        .where(eq(customers.id, currentOrder.customerId));

      if (customer) {
        const customerHasShip =
          customer.shipLine1 != null ||
          customer.shipLine2 != null ||
          customer.shipCity != null ||
          customer.shipRegion != null ||
          customer.shipPostcode != null ||
          customer.shipCountry != null;

        if (customerHasShip) {
          shipLine1 = customer.shipLine1;
          shipLine2 = customer.shipLine2;
          shipCity = customer.shipCity;
          shipRegion = customer.shipRegion;
          shipPostcode = customer.shipPostcode;
          shipCountry = customer.shipCountry;
        } else {
          shipLine1 = customer.billingLine1;
          shipLine2 = customer.billingLine2;
          shipCity = customer.billingCity;
          shipRegion = customer.billingRegion;
          shipPostcode = customer.billingPostcode;
          shipCountry = customer.billingCountry;
        }
      }
    }

    const shippedAt = new Date();
    const [shipped] = await tx
      .update(salesOrders)
      .set({
        status: "shipped",
        shippedAt,
        shipLine1,
        shipLine2,
        shipCity,
        shipRegion,
        shipPostcode,
        shipCountry,
        updatedAt: shippedAt,
      })
      .where(eq(salesOrders.id, id))
      .returning({ id: salesOrders.id });

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: shipped,
    });

    return {
      replayed: false as const,
      shipped,
      orgId,
    };
  });

  if (!result || !result.shipped) {
    return null;
  }

  if (result.replayed) {
    return result.shipped;
  }

  if (options?.syncAccounting === false) {
    return result.shipped;
  }

  // Stock tx has committed. Attempt the Xero push; a failure must NOT roll
  // back the ship — the order is shipped regardless of accounting state.
  const { pushSalesOrderToXero, markXeroPushFailed } = await import(
    "@/lib/xero/push-invoice"
  );
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushSalesOrderToXero(result.orgId, id);
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      // Xero isn't set up for this org — leave push_status null rather than
      // flagging a failure that the user can't act on.
      if (!error.message.includes("not connected")) {
        await markXeroPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPushFailed(result.orgId, id, error);
    }
  }

  return result.shipped;
}

export async function getXeroOnlineInvoiceUrlForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { getOnlineInvoiceUrlForOrder } = await import("@/lib/xero/push-invoice");
    return { url: await getOnlineInvoiceUrlForOrder(orgId, id) };
  });
}

export async function retryXeroPushForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushSalesOrderToXero, markXeroPushFailed } = await import(
      "@/lib/xero/push-invoice"
    );
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushSalesOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (error instanceof XeroError && (error.status === 404 || error.status === 409)) {
        throw error;
      }

      await markXeroPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function confirmSalesOrder(
  id: string,
  confirmOversell = false,
  options?: { idempotencyKey?: string }
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "confirmSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, confirmOversell },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const { orders, itemsById } = await prepareDraftOrdersForConfirmationInTx(
      tx,
      [id],
      { lockItems: true }
    );
    const [order] = orders;

    if (!confirmOversell) {
      const oversell = await buildOversellWarning(order.preparedLines, itemsById);

      if (oversell) {
        throw new SalesError(
          "This confirmation would oversell one or more items.",
          409,
          { oversell }
        );
      }
    }

    await tx
      .update(salesOrders)
      .set({
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));

    await upsertDefaultDraftShipmentForOrderInTx(tx, orgId, order);

    const lineRows = await getSalesLineQuantitiesForReservationInTx(tx, id);
    await reserveForSalesInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "confirm-order"
      ),
      lines: lineRows.map((line) => ({
        salesOrderLineId: line.salesOrderLineId,
        itemId: line.itemId,
        quantity: parseFloat(line.quantity),
      })),
    });

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function bulkConfirmSalesOrders(
  payload: BulkConfirmSalesOrders,
  options?: { idempotencyKey?: string }
): Promise<{ confirmedCount: number }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ confirmedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "bulkConfirmSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const { orders, itemsById } = await prepareDraftOrdersForConfirmationInTx(
      tx,
      payload.ids,
      { lockItems: true }
    );

    if (orders.length === 0) {
      const result = { confirmedCount: 0 };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    if (!payload.confirmOversell) {
      const bulkOversell = await buildBulkOversellWarning(orders, itemsById);

      if (bulkOversell) {
        throw new SalesError(
          "These confirmations would oversell one or more items.",
          409,
          { bulkOversell }
        );
      }
    }

    const orderIds = orders.map((order) => order.id);

    await tx
      .update(salesOrders)
      .set({
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(inArray(salesOrders.id, orderIds));

    for (const order of orders) {
      await upsertDefaultDraftShipmentForOrderInTx(tx, orgId, order);

      const lineRows = await getSalesLineQuantitiesForReservationInTx(tx, order.id);
      await reserveForSalesInTx(tx, {
        organizationId: orgId,
        salesOrderId: order.id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `bulk-confirm:${order.id}`
        ),
        lines: lineRows.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: parseFloat(line.quantity),
        })),
      });
    }

    const result = { confirmedCount: orderIds.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deleteSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deleted: boolean }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      const result = { deleted: false };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    const existingLines = await getOrderLinesInTx(tx, id);
    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(salesOrders.id, id));

    await releaseReservationForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "delete-order"
      ),
      reason: "deleted",
      salesOrderLineIds: existingLines.map((line) => line.id),
    });

    const result = { deleted: true };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deleteSalesOrders(
  ids: string[],
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deletedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { ids: [...new Set(ids)].sort() },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const uniqueIds = [...new Set(ids)];

    const orders = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          inArray(salesOrders.id, uniqueIds),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (orders.length === 0) {
      const result = { deletedCount: 0 };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    const orderIds = orders.map((o) => o.id);

    const lines = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(inArray(salesOrderLines.salesOrderId, orderIds));
    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(salesOrders.id, orderIds));

    await releaseReservationForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: orderIds.join(","),
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "bulk-delete-orders"
      ),
      reason: "deleted",
      salesOrderLineIds: lines.map((line) => line.id),
    });

    const result = { deletedCount: orders.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
