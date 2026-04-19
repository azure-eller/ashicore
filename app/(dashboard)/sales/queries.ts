import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  formatVariantDisplay,
  formatQuantity,
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
  items,
  manufacturingOrders,
  pricingScheduleBreaks,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  consumeForShipmentInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getSalesLineQuantitiesForReservationInTx,
  InsufficientStockError,
  lockItemsInTx,
  releaseReservationForSalesLineInTx,
  projectedCommittedQty,
  projectedCommittedQtyExpr,
  projectedExpectedQty,
  projectedExpectedQtyExpr,
  projectedOnHandQty,
  projectedOnHandQtyExpr,
  reserveForSalesInTx,
} from "@/lib/inventory/kernel";
import { invalidateOrgPromptSectionCache } from "@/lib/agent/core/promptSections";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
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
  InsertSalesOrder,
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
  SalesOrderItemOption,
} from "./types";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";

const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
const committedQtySubquery = projectedCommittedQty(
  items.organizationId,
  items.id
).as("committedQty");
const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");

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
): Promise<SalesLinePricingResult> {
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

function calcProjectedStock(values: {
  stock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
}) {
  return roundQuantity(
    parseFloat(values.stock) -
      parseFloat(values.committedQty) +
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
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)))
    .for("update");

  return order ?? null;
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
      status: salesOrders.status,
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
      const projectedCommittedQty = roundQuantity(currentCommittedQty + addedQty);
      const calculatedStock = calcProjectedStock(item);
      const projectedCalculatedStock = roundQuantity(calculatedStock - addedQty);

      if (projectedCalculatedStock >= 0) {
        return null;
      }

      return {
        itemId: item.id,
        itemName: item.displayName,
        itemSku: item.sku,
        unitName: item.unitName,
        inStock: roundQuantity(parseFloat(item.stock)),
        committedQty: roundQuantity(currentCommittedQty),
        expectedQty: roundQuantity(parseFloat(item.expectedQty)),
        safetyStock: roundQuantity(parseFloat(item.safetyStock)),
        calculatedStock,
        addedQty: roundQuantity(addedQty),
        projectedCommittedQty,
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
    const projectedCommittedQty = roundQuantity(currentCommittedQty + addedQty);
    const calculatedStock = calcProjectedStock(item);
    const projectedCalculatedStock = roundQuantity(calculatedStock - addedQty);

    if (projectedCalculatedStock >= 0) {
      return;
    }

    oversoldProducts.set(itemId, {
      itemId: item.id,
      inStock: roundQuantity(parseFloat(item.stock)),
      committedQty: roundQuantity(currentCommittedQty),
      expectedQty: roundQuantity(parseFloat(item.expectedQty)),
      safetyStock: roundQuantity(parseFloat(item.safetyStock)),
      calculatedStock,
      projectedCommittedQty,
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
  const result = await withAuthedOrgContext(async (tx, orgId) => {
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

    return { category, orgId };
  });

  invalidateOrgPromptSectionCache(result.orgId);
  return result.category;
}

export async function updateCustomerCategory(id: string, data: UpdateCustomerCategory) {
  const result = await withAuthedOrgContext(async (tx, orgId) => {
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

    return { category: category ?? null, orgId };
  });

  invalidateOrgPromptSectionCache(result.orgId);
  return result.category;
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
  const result = await withAuthedOrgContext(async (tx, orgId) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, [id]);
    const [category] = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return { deleted: category != null, orgId };
  });

  if (result.deleted) {
    invalidateOrgPromptSectionCache(result.orgId);
  }

  return { deleted: result.deleted };
}

export async function deleteCustomerCategories(ids: string[]) {
  const result = await withAuthedOrgContext(async (tx, orgId) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, ids);
    const deletedCategories = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return { deletedCount: deletedCategories.length, orgId };
  });

  if (result.deletedCount > 0) {
    invalidateOrgPromptSectionCache(result.orgId);
  }

  return { deletedCount: result.deletedCount };
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
        inArray(salesOrders.status, ["draft", "confirmed"])
      )
    )
    .limit(1);

  if (blockingOrder) {
    throw new SalesError(
      "Cannot delete customer with active draft or confirmed orders.",
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

    return resolvePricingForProductInTx(tx, {
      customerCategoryId: customer.customerCategoryId,
      customerCategoryName: customer.customerCategoryName,
      product: item,
      quantity: values.quantity,
    });
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
          stock: row.stock,
          committedQty: row.committedQty,
          expectedQty: row.expectedQty,
          safetyStock: row.safetyStock,
        } satisfies SalesOrderItemOption;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const orderRows = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        status: salesOrders.status,
        requestedDate: salesOrders.requestedDate,
        shippedAt: salesOrders.shippedAt,
        totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .where(isNull(salesOrders.deletedAt))
      .orderBy(desc(salesOrders.createdAt));

    if (orderRows.length === 0) {
      return [];
    }

    const orderIds = orderRows.map((order) => order.id);
    const manufacturingSummaries = await getSalesOrderManufacturingSummariesInTx(tx, orderIds);

    return orderRows.map((order) => {
      const manufacturingSummary = manufacturingSummaries.get(order.id);
      const summaryLines = manufacturingSummary?.lines ?? [];
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
        hasManufacturableLines: manufacturingSummary?.hasManufacturableLines ?? false,
        manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
        manufacturableDisabledReason:
          manufacturingSummary?.disabledReason ?? "No manufacturable lines remain on this order.",
      };
    });
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
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
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
        totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
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
        calcStock: trimScaleNullable(
          sql<string | null>`(
            ${projectedOnHandQtyExpr(items.organizationId, items.id)}
            - ${projectedCommittedQtyExpr(items.organizationId, items.id)}
            + ${projectedExpectedQtyExpr(items.organizationId, items.id)}
            - ${items.safetyStock}
          )`
        ).as("calcStock"),
        potential: trimScaleNullable(
          sql<string | null>`(
            CASE WHEN ${items.itemType} = 'product' AND EXISTS (
              SELECT 1
              FROM inventory.bom_revisions br
              INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
              WHERE br.product_id = ${items.id}
                AND br.is_current = true
            ) THEN
              FLOOR(
                (
                  SELECT MIN(
                    (
                      ${projectedOnHandQtyExpr(items.organizationId, sql`brc.component_id`)}
                      - ${projectedCommittedQtyExpr(
                        items.organizationId,
                        sql`brc.component_id`
                      )}
                    )
                    / NULLIF(brc.quantity, 0)
                  )
                  FROM inventory.bom_revisions br
                  INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
                  WHERE br.product_id = ${items.id}
                    AND br.is_current = true
                )
                * CASE WHEN ${items.manufacturingMode} = 'batch' AND ${items.expectedBatchYield} IS NOT NULL
                    THEN ${items.expectedBatchYield}::numeric
                    ELSE 1
                  END
              )
            ELSE NULL END
          )`
        ).as("potential"),
      })
      .from(salesOrderLines)
      .leftJoin(items, eq(salesOrderLines.itemId, items.id))
      .leftJoin(masterItems, eq(items.parentId, masterItems.id))
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    const lines = lineRows.map(({ variantAttrs, masterName, masterVariantAxes, ...rest }) => {
      const display = resolveVariantDisplay(
        rest.itemName,
        masterName == null ? null : { name: masterName, variantAxes: masterVariantAxes },
        variantAttrs
      );
      return { ...rest, masterName: display.masterName, attrs: display.attrs };
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
      .orderBy(desc(manufacturingOrders.createdAt));

    return {
      ...order,
      status: order.status as SalesOrderDetail["status"],
      xeroPushStatus: order.xeroPushStatus as SalesOrderDetail["xeroPushStatus"],
      lines: lines as SalesOrderDetailLine[],
      hasManufacturableLines: manufacturingSummary?.hasManufacturableLines ?? false,
      manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
      manufacturableDisabledReason:
        manufacturingSummary?.disabledReason ?? "No manufacturable lines remain on this order.",
      linkedManufacturingOrders: linkedManufacturingOrders.map((row) => ({
        ...row,
        status: row.status as SalesOrderDetail["linkedManufacturingOrders"][number]["status"],
      })),
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
        customerName: salesOrders.customerName,
        requestedDate: salesOrders.requestedDate,
        shippedAt: salesOrders.shippedAt,
        notes: salesOrders.notes,
        status: salesOrders.status,
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

    return {
      ...order,
      lines,
    };
  });
}

export async function shipSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "shipSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
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
