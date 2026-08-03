import "server-only";

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { normalizeNumeric, normalizeMoney, roundQuantity } from "@/lib/format";
import { manufacturingOrderBatches, manufacturingOrderOutputs, manufacturingOrderIngredients, manufacturingOrders, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getTaxSettingsInTx, getTaxRatesByIdInTx } from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { beginInventoryOperationInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, lockItemsInTx, releaseSalesDemandForSalesLineInTx, recordSalesDemandInTx, releaseSalesDemandForQuantitiesInTx, runIdempotentInventoryOperationInTx } from "@/lib/inventory/kernel";
import { generateShortDocumentNumberInTx } from "@/lib/document-numbers";
import { calculateDiscountPercentString, calculateSalesLineAmounts } from "@/lib/sales/order-calculations";
import type { BulkConfirmSalesOrders, InsertSalesOrder, PatchSalesOrderHeader, PatchSalesOrderLine, UpdateSalesOrder } from "@/lib/schemas/sales-orders";
import type { PricingSourceType, SalesOrderDetail } from "../types";
import { SalesError } from "./errors";
import { withSalesTransactionRetry, isEditableOpenSalesOrderStatus, isOpenSalesOrderStatus, rerankOpenSalesOrdersInTx, getOrderLinesInTx, getLockedSalesOrderInTx, normalizeShipQuantity, getSalesOrderLineShipStatesInTx, remainingToShip } from "./shared";
import { type SalesItemValidationRow, getValidatedCustomerInTx, getValidatedCustomerProjectInTx, getValidatedSalesItemsInTx } from "./validation";
import { getPricingScheduleLookupForProductsInTx, resolvePricingForProduct } from "./pricing";
import { getSalesOrder, getSalesOrderInTx } from "./orders-read";
import {
  PUSHED_ACCOUNTING_INVOICE_SHORT_CLOSE_MESSAGE,
  salesOrderHasPushedAccountingInvoiceInTx,
} from "../accounting-policy";

type PreparedOrderLineBase = {
  id?: string;
  salesOrderLineId?: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  listUnitPrice: string | null;
  unitPrice: string;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePercent: string;
  discountPercent: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  sortOrder: number;
  allocationManagedAt?: Date | null;
};

type PreparedOrderLine = PreparedOrderLineBase & {
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  isPriceOverridden: boolean;
};

function normalizeOptionalLineMoney(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? normalizeMoney(parsed) : null;
}

async function generateOrderNumber(tx: Tx, organizationId: string) {
  return generateShortDocumentNumberInTx(tx, "sales_order", organizationId);
}

async function resolveSalesOrderNumberInTx(
  tx: Tx,
  organizationId: string,
  requestedOrderNumber: string | null | undefined,
  options?: { excludeId?: string }
) {
  const requested = requestedOrderNumber?.trim();
  if (!requested) {
    return await generateOrderNumber(tx, organizationId);
  }

  const orderNumber = requested;
  const conditions = [
    eq(salesOrders.organizationId, organizationId),
    eq(salesOrders.orderNumber, orderNumber),
  ];

  if (options?.excludeId) {
    conditions.push(sql`${salesOrders.id} <> ${options.excludeId}`);
  }

  const [existingOrder] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(...conditions))
    .limit(1);

  if (existingOrder) {
    throw new SalesError("A sales order with this number already exists.", 400, {
      errors: {
        orderNumber: ["A sales order with this number already exists."],
      },
    });
  }

  return orderNumber;
}

async function generateDuplicateSalesOrderNumberInTx(
  tx: Tx,
  organizationId: string,
  sourceOrderNumber: string
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sales-order-duplicate-number:${organizationId}:${sourceOrderNumber}`}))`
  );

  for (let copyNumber = 1; copyNumber <= 100; copyNumber += 1) {
    const suffix = copyNumber === 1 ? "_COPY" : `_COPY${copyNumber}`;
    const candidate = `${sourceOrderNumber.slice(0, 32 - suffix.length)}${suffix}`;
    const [existingOrder] = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, organizationId),
          eq(salesOrders.orderNumber, candidate)
        )
      )
      .limit(1);

    if (!existingOrder) return candidate;
  }

  throw new SalesError("Could not generate a duplicate sales order number.", 400);
}

async function assertSalesOrderHasNoShippedLinesForEditInTx(
  tx: Tx,
  orderId: string
) {
  const states = await getSalesOrderLineShipStatesInTx(tx, orderId);
  const hasShippedLine = [...states.values()].some(
    (line) => line.shippedQuantity > 0
  );

  if (hasShippedLine) {
    throw new SalesError(
      "Partially shipped orders cannot be edited. Create a new sales order for changes.",
      400
    );
  }
}

async function getOpenLinkedManufacturingOrdersForSalesEditInTx(
  tx: Tx,
  salesOrderId: string
) {
  const linkedRows = await tx
    .select({
      id: manufacturingOrders.id,
      productId: manufacturingOrders.productId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      salesLineQuantity: trimScale(salesOrderLines.quantity).as("salesLineQuantity"),
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
    })
    .from(manufacturingOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, manufacturingOrders.salesOrderLineId))
    .where(
      and(
        eq(manufacturingOrders.salesOrderId, salesOrderId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    )
    .for("update");

  if (linkedRows.length === 0) return [];

  const outputRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
      outputQuantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
      ).as("outputQuantity"),
    })
    .from(manufacturingOrderOutputs)
    .where(
      inArray(
        manufacturingOrderOutputs.manufacturingOrderId,
        linkedRows.map((row) => row.id)
      )
    )
    .groupBy(manufacturingOrderOutputs.manufacturingOrderId);
  const outputQuantityByOrderId = new Map(
    outputRows.map((row) => [row.manufacturingOrderId, row.outputQuantity])
  );
  const ingredientStartRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        inArray(
          manufacturingOrderIngredients.manufacturingOrderId,
          linkedRows.map((row) => row.id)
        ),
        or(
          sql`${manufacturingOrderIngredients.pickedQuantity} > 0`,
          sql`${manufacturingOrderIngredients.actualQuantity} IS NOT NULL AND ${manufacturingOrderIngredients.actualQuantity} > 0`
        )
      )
    )
    .groupBy(manufacturingOrderIngredients.manufacturingOrderId);
  const activeBatchRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
    })
    .from(manufacturingOrderBatches)
    .where(
      and(
        inArray(
          manufacturingOrderBatches.manufacturingOrderId,
          linkedRows.map((row) => row.id)
        ),
        ne(manufacturingOrderBatches.status, "pending")
      )
    )
    .groupBy(manufacturingOrderBatches.manufacturingOrderId);
  const startedOrderIds = new Set([
    ...ingredientStartRows.map((row) => row.manufacturingOrderId),
    ...activeBatchRows.map((row) => row.manufacturingOrderId),
    ...outputRows
      .filter((row) => Number(row.outputQuantity) > 0)
      .map((row) => row.manufacturingOrderId),
  ]);

  return linkedRows.map((row) => ({
    ...row,
    outputQuantity: outputQuantityByOrderId.get(row.id) ?? "0",
    hasStarted: startedOrderIds.has(row.id),
  }));
}

async function assertLinkedMtoSalesLinesUnchangedInTx(
  tx: Tx,
  salesOrderId: string,
  preparedLines: PreparedOrderLine[]
) {
  const linkedRows = await getOpenLinkedManufacturingOrdersForSalesEditInTx(
    tx,
    salesOrderId
  );
  if (linkedRows.length === 0) return;

  const replacementByItemId = new Map(
    preparedLines.map((line) => [line.itemId, line])
  );

  for (const linkedRow of linkedRows) {
    const replacement = replacementByItemId.get(linkedRow.productId);
    if (!replacement) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }

    const nextQuantity = Number(replacement.quantity);
    if (
      Number.isFinite(nextQuantity) &&
      nextQuantity !== Number(linkedRow.salesLineQuantity)
    ) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }
  }
}

async function moveLinkedManufacturingOrdersToReplacementSalesLinesInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    salesOrderId: string;
    insertedLines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: string;
      sortOrder: number | null;
    }>;
  }
) {
  const linkedRows = await getOpenLinkedManufacturingOrdersForSalesEditInTx(
    tx,
    params.salesOrderId
  );
  if (linkedRows.length === 0) return;

  const insertedByItemId = new Map<string, typeof params.insertedLines>();
  for (const line of params.insertedLines) {
    const lines = insertedByItemId.get(line.itemId) ?? [];
    lines.push(line);
    insertedByItemId.set(line.itemId, lines);
  }
  for (const lines of insertedByItemId.values()) {
    lines.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  }

  for (const linkedRow of linkedRows) {
    const replacement = insertedByItemId.get(linkedRow.productId)?.shift();
    if (!replacement) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }

    if (replacement.salesOrderLineId === linkedRow.salesOrderLineId) {
      continue;
    }

    await tx
      .update(manufacturingOrders)
      .set({
        salesOrderLineId: replacement.salesOrderLineId,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, linkedRow.id));
  }
}

async function assertSalesOrderLineQuantityEditableInTx(
  tx: Tx,
  salesOrderLineId: string,
  nextQuantity: number,
  currentQuantity: number
) {
  if (nextQuantity === currentQuantity) return;

  const [linkedOrder] = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.salesOrderLineId, salesOrderLineId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    )
    .limit(1)
    .for("update");

  if (!linkedOrder) return;

  throw new SalesError(
    "Sales lines linked to make-to-order manufacturing cannot be changed.",
    400,
    {
      errors: {
        quantity: [
          "Cancel the linked manufacturing order before changing this quantity.",
        ],
      },
    }
  );
}

async function assertSalesOrderCanCancelRemainingInTx(tx: Tx, orderId: string) {
  if (await salesOrderHasPushedAccountingInvoiceInTx(tx, orderId)) {
    throw new SalesError(PUSHED_ACCOUNTING_INVOICE_SHORT_CLOSE_MESSAGE, 409);
  }

  const linkedRows = await getOpenLinkedManufacturingOrdersForSalesEditInTx(
    tx,
    orderId
  );
  if (linkedRows.length === 0) return;

  throw new SalesError(
    "Cancel the linked manufacturing order before closing remaining sales demand.",
    400
  );
}

async function prepareOrderPayload(
  tx: Tx,
  orgId: string,
  payload: InsertSalesOrder,
  options?: { lockItems?: boolean }
): Promise<{
  customerId: string;
  customerProjectId: string | null;
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
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shippingFeeDescription: string | null;
  shippingFeeAmount: string;
  shippingFeeTaxAmount: string;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  preparedLines: PreparedOrderLine[];
  affectedItemIds: string[];
  itemsById: Map<string, SalesItemValidationRow>;
}> {
  const customer = await getValidatedCustomerInTx(tx, payload.customerId);
  const project = await getValidatedCustomerProjectInTx(
    tx,
    customer.id,
    payload.customerProjectId
  );
  const itemIds = payload.lines.map((line) => line.itemId);
  const requestedTaxRateIds = payload.lines
    .map((line) => line.taxRateId?.trim() ?? "")
    .filter(Boolean);
  const taxSettings = await getTaxSettingsInTx(tx, orgId);
  const defaultSalesTaxRateId = taxSettings.defaultSalesTaxRateId;
  if (defaultSalesTaxRateId) {
    requestedTaxRateIds.push(defaultSalesTaxRateId);
  }

  if (options?.lockItems && itemIds.length > 0) {
    await lockItemsInTx(tx, itemIds);
  }

  const itemsById = itemIds.length
    ? await getValidatedSalesItemsInTx(tx, itemIds)
    : new Map<string, SalesItemValidationRow>();
  const pricingLookup = await getPricingScheduleLookupForProductsInTx(
    tx,
    orgId,
    [...itemsById.values()],
    customer.customerCategoryId
  );
  const taxRatesById = await getTaxRatesByIdInTx(tx, requestedTaxRateIds);

  const preparedLines = payload.lines.map((line, index) => {
    const item = itemsById.get(line.itemId);

    if (!item) {
      throw new SalesError("Item not found", 404);
    }

    const pricing = resolvePricingForProduct(
      {
        customerCategoryId: customer.customerCategoryId,
        customerCategoryName: customer.customerCategoryName,
        product: item,
        quantity: line.quantity,
      },
      pricingLookup
    );
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const normalizedUnitPrice = normalizeMoney(unitPrice);
    const effectiveTaxRateId =
      line.taxRateId === undefined ? defaultSalesTaxRateId : line.taxRateId;
    const selectedTaxRate = effectiveTaxRateId
      ? taxRatesById.get(effectiveTaxRateId) ?? null
      : null;
    const listUnitPrice =
      normalizeOptionalLineMoney(line.listUnitPrice) ??
      pricing.baseUnitPrice ??
      normalizedUnitPrice;
    const suggestedUnitPrice =
      normalizeOptionalLineMoney(line.suggestedUnitPrice) ??
      pricing.suggestedUnitPrice;
    const pricingSourceType = line.pricingSourceType ?? pricing.pricingSourceType;
    const pricingScheduleName =
      line.pricingScheduleName !== undefined
        ? line.pricingScheduleName
        : pricing.pricingScheduleName;
    const pricingBreakLabel =
      line.pricingBreakLabel !== undefined
        ? line.pricingBreakLabel
        : pricing.pricingBreakLabel;
    const discountPercent =
      normalizeOptionalLineMoney(line.discountPercent) ??
      calculateDiscountPercentString(listUnitPrice, normalizedUnitPrice);
    const { lineSubtotal, lineTaxAmount, lineTotal } = calculateSalesLineAmounts({
      quantity,
      unitPrice,
      taxRatePercent: selectedTaxRate?.ratePercent ?? 0,
    });

    return {
      id: line.id,
      itemId: item.id,
      itemName: item.displayName,
      itemSku: item.sku,
      unitName: item.unitName,
      quantity: normalizeNumeric(quantity),
      listUnitPrice,
      unitPrice: normalizedUnitPrice,
      taxRateId: selectedTaxRate?.id ?? null,
      taxRateName: selectedTaxRate?.name ?? null,
      taxRatePercent: selectedTaxRate?.ratePercent ?? "0",
      discountPercent,
      suggestedUnitPrice,
      pricingSourceType,
      pricingScheduleName,
      pricingBreakLabel,
      isPriceOverridden:
        line.isPriceOverridden ??
        (suggestedUnitPrice != null && normalizedUnitPrice !== suggestedUnitPrice),
      lineSubtotal,
      lineTaxAmount,
      lineTotal,
      sortOrder: index,
    } satisfies PreparedOrderLine;
  });

  const shippingFeeAmount = normalizeMoney(Number(payload.shippingFeeAmount ?? 0));
  const shippingFeeTaxAmount = normalizeMoney(Number(payload.shippingFeeTaxAmount ?? 0));
  const subtotalAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineSubtotal),
    0
  ) + parseFloat(shippingFeeAmount);
  const taxAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineTaxAmount),
    0
  ) + parseFloat(shippingFeeTaxAmount);
  const totalAmount = subtotalAmount + taxAmount;
  const customerHasShipAddress =
    customer.shipLine1 != null ||
    customer.shipLine2 != null ||
    customer.shipCity != null ||
    customer.shipRegion != null ||
    customer.shipPostcode != null ||
    customer.shipCountry != null;
  const fallbackShipAddress = customerHasShipAddress
    ? {
        shipLine1: customer.shipLine1,
        shipLine2: customer.shipLine2,
        shipCity: customer.shipCity,
        shipRegion: customer.shipRegion,
        shipPostcode: customer.shipPostcode,
        shipCountry: customer.shipCountry,
      }
    : {
        shipLine1: customer.billingLine1,
        shipLine2: customer.billingLine2,
        shipCity: customer.billingCity,
        shipRegion: customer.billingRegion,
        shipPostcode: customer.billingPostcode,
        shipCountry: customer.billingCountry,
      };

  return {
    customerId: customer.id,
    customerProjectId: project?.id ?? null,
    customerName: customer.name,
    orderDate: payload.orderDate,
    shipDate: payload.shipDate ?? null,
    requestedDate: payload.requestedDate ?? null,
    notes: payload.notes ?? null,
    shipLine1: payload.shipLine1 ?? fallbackShipAddress.shipLine1,
    shipLine2: payload.shipLine2 ?? fallbackShipAddress.shipLine2,
    shipCity: payload.shipCity ?? fallbackShipAddress.shipCity,
    shipRegion: payload.shipRegion ?? fallbackShipAddress.shipRegion,
    shipPostcode: payload.shipPostcode ?? fallbackShipAddress.shipPostcode,
    shipCountry: payload.shipCountry ?? fallbackShipAddress.shipCountry,
    billingLine1: payload.billingLine1 ?? customer.billingLine1,
    billingLine2: payload.billingLine2 ?? customer.billingLine2,
    billingCity: payload.billingCity ?? customer.billingCity,
    billingRegion: payload.billingRegion ?? customer.billingRegion,
    billingPostcode: payload.billingPostcode ?? customer.billingPostcode,
    billingCountry: payload.billingCountry ?? customer.billingCountry,
    shippingFeeDescription: payload.shippingFeeDescription ?? null,
    shippingFeeAmount,
    shippingFeeTaxAmount,
    subtotalAmount: normalizeMoney(subtotalAmount),
    taxAmount: normalizeMoney(taxAmount),
    totalAmount: normalizeMoney(totalAmount),
    preparedLines,
    affectedItemIds: preparedLines.map((line) => line.itemId),
    itemsById,
  };
}

export async function createSalesOrder(
  data: InsertSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId, userId) => {
    const { result } = await runIdempotentInventoryOperationInTx<{ id: string }>(
      tx,
      {
        organizationId: orgId,
        operationName: "createSalesOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: data,
      },
      () => createSalesOrderInTx(tx, orgId, userId, data, {
        idempotencyKey: options?.idempotencyKey,
      }),
    );

    return result;
  }));
}

async function createSalesOrderInTx(
  tx: Tx,
  orgId: string,
  userId: string,
  data: InsertSalesOrder,
  options?: { idempotencyKey?: string }
) {

  const prepared = await prepareOrderPayload(tx, orgId, data);

  const orderNumber = await resolveSalesOrderNumberInTx(
    tx,
    orgId,
    data.orderNumber
  );
  await lockSalesPriorityQueueInTx(tx, orgId);
  const [order] = await tx
    .insert(salesOrders)
    .values({
      organizationId: orgId,
      orderNumber,
      customerId: prepared.customerId,
      customerProjectId: prepared.customerProjectId,
      customerName: prepared.customerName,
      status: "open",
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
      billingLine1: prepared.billingLine1,
      billingLine2: prepared.billingLine2,
      billingCity: prepared.billingCity,
      billingRegion: prepared.billingRegion,
      billingPostcode: prepared.billingPostcode,
      billingCountry: prepared.billingCountry,
      shippingFeeDescription: prepared.shippingFeeDescription,
      shippingFeeAmount: prepared.shippingFeeAmount,
      shippingFeeTaxAmount: prepared.shippingFeeTaxAmount,
      subtotalAmount: prepared.subtotalAmount,
      taxAmount: prepared.taxAmount,
      totalAmount: prepared.totalAmount,
    })
    .returning({ id: salesOrders.id });

  const insertedLines =
    prepared.preparedLines.length > 0
      ? await tx
          .insert(salesOrderLines)
          .values(
            prepared.preparedLines.map((line) => ({
              salesOrderId: order.id,
              ...line,
            }))
          )
          .returning({
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            itemName: salesOrderLines.itemName,
            itemSku: salesOrderLines.itemSku,
            unitName: salesOrderLines.unitName,
            quantity: salesOrderLines.quantity,
            sortOrder: salesOrderLines.sortOrder,
          })
      : [];

  await recordSalesDemandInTx(tx, {
    organizationId: orgId,
    salesOrderId: order.id,
    actorUserId: userId,
    idempotencyKey: deriveInventoryIdempotencyKey(
      options?.idempotencyKey,
      "create-open-order"
    ),
    lines: insertedLines.map((line) => ({
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      quantity: parseFloat(line.quantity),
    })),
  });

  if (isOpenSalesOrderStatus(data.status)) {
    await rerankOpenSalesOrdersInTx(tx, orgId);
  }

  return order;
}

export async function duplicateSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  return withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId, userId) => {
    const { result } = await runIdempotentInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "duplicateSalesOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id },
      },
      async () => {
        const order = await getSalesOrderInTx(tx, orgId, id);

        if (!order) {
          return null;
        }

        const orderNumber = await generateDuplicateSalesOrderNumberInTx(
          tx,
          orgId,
          order.orderNumber
        );

        return createSalesOrderInTx(tx, orgId, userId, {
          orderNumber,
          customerId: order.customerId,
          customerProjectId: order.customerProjectId,
          status: "open",
          orderDate: order.orderDate,
          shipDate: order.shipDate,
          requestedDate: null,
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
          lines: order.lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRateId: line.taxRateId,
          })),
          confirmOversell: true,
        }, {
          idempotencyKey: options?.idempotencyKey,
        });
      },
    );

    return result;
  }));
}

export async function updateSalesOrder(
  id: string,
  data: UpdateSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      | { kind: "updated"; order: SalesOrderDetail }
      | { kind: "conflict"; order: SalesOrderDetail }
      | null
    >(tx, {
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

    if (
      data.expectedVersion != null &&
      existingOrder.version !== data.expectedVersion
    ) {
      const current = await getSalesOrderInTx(tx, orgId, id);
      const result = current ? { kind: "conflict" as const, order: current } : null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    const existingLines = await getOrderLinesInTx(tx, id);

    if (existingOrder.status === "done") {
      throw new SalesError("Done orders cannot be changed.", 400);
    }

    await assertSalesOrderHasNoShippedLinesForEditInTx(tx, id);

    const prepared = await prepareOrderPayload(tx, orgId, data);

    if (isEditableOpenSalesOrderStatus(existingOrder.status)) {
      await lockItemsInTx(tx, [
        ...existingLines.map((line) => line.itemId),
        ...data.lines.map((line) => line.itemId),
      ]);

      await assertLinkedMtoSalesLinesUnchangedInTx(
        tx,
        id,
        prepared.preparedLines
      );

      await releaseSalesDemandForSalesLineInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "edit-open-order-release"
        ),
        reason: "edited",
        salesOrderLineIds: existingLines.map((line) => line.id),
      });
    }

    await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));

    const insertedLines =
      prepared.preparedLines.length > 0
        ? await tx.insert(salesOrderLines).values(
            prepared.preparedLines.map((line) => ({
              salesOrderId: id,
              ...line,
            }))
          ).returning({
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            itemName: salesOrderLines.itemName,
            itemSku: salesOrderLines.itemSku,
            unitName: salesOrderLines.unitName,
            quantity: salesOrderLines.quantity,
            sortOrder: salesOrderLines.sortOrder,
          })
        : [];

    await moveLinkedManufacturingOrdersToReplacementSalesLinesInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      idempotencyKey: options?.idempotencyKey ?? null,
      salesOrderId: id,
      insertedLines,
    });

    const orderNumber = await resolveSalesOrderNumberInTx(
      tx,
      orgId,
      data.orderNumber,
      { excludeId: id }
    );

    await tx
      .update(salesOrders)
      .set({
        orderNumber,
        customerId: prepared.customerId,
        customerProjectId: prepared.customerProjectId,
        customerName: prepared.customerName,
        status: "open",
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
        billingLine1: prepared.billingLine1,
        billingLine2: prepared.billingLine2,
        billingCity: prepared.billingCity,
        billingRegion: prepared.billingRegion,
        billingPostcode: prepared.billingPostcode,
        billingCountry: prepared.billingCountry,
        shippingFeeDescription: prepared.shippingFeeDescription,
        shippingFeeAmount: prepared.shippingFeeAmount,
        shippingFeeTaxAmount: prepared.shippingFeeTaxAmount,
        subtotalAmount: prepared.subtotalAmount,
        taxAmount: prepared.taxAmount,
        totalAmount: prepared.totalAmount,
        version: sql`${salesOrders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));

    await recordSalesDemandInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "update-open-order"
      ),
      lines: insertedLines.map((line) => ({
        salesOrderLineId: line.salesOrderLineId,
        itemId: line.itemId,
        quantity: parseFloat(line.quantity),
      })),
    });

    const updated = await getSalesOrderInTx(tx, orgId, id);
    if (!updated) {
      throw new SalesError("Sales order not found after update.", 500);
    }
    const result = { kind: "updated" as const, order: updated };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function confirmSalesOrder(
  id: string,
  flags:
    | boolean
    | {
        confirmOversell?: boolean;
      } = false,
  options?: { idempotencyKey?: string }
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "confirmSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, confirmOversell: typeof flags === "boolean" ? flags : flags.confirmOversell === true },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, id);
    if (!existingOrder) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
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

export async function bulkConfirmSalesOrders(
  payload: BulkConfirmSalesOrders,
  options?: { idempotencyKey?: string }
): Promise<{ confirmedCount: number }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ confirmedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "bulkConfirmSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const result = { confirmedCount: payload.ids.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

/**
 * Per-field header patch for the inline-edit flow on the Calm Matrix Sales
 * Order page. Touches only the salesOrders row, never lines or inventory kernel
 * state. For full-document edits, use {@link updateSalesOrder}.
 */
export async function patchSalesOrderHeader(
  id: string,
  patch: PatchSalesOrderHeader,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ ok: true } | null>(tx, {
      organizationId: orgId,
      operationName: "patchSalesOrderHeader",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, patch },
    });
    if (replay.replayed) {
      return replay.result === null ? null : { ok: true };
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
    const nextCustomerId = patch.customerId ?? existingOrder.customerId;
    const customer = await getValidatedCustomerInTx(tx, nextCustomerId);
    const nextCustomerProjectId =
      patch.customerProjectId !== undefined
        ? patch.customerProjectId
        : patch.customerId && patch.customerId !== existingOrder.customerId
          ? null
          : existingOrder.customerProjectId;
    await getValidatedCustomerProjectInTx(tx, customer.id, nextCustomerProjectId);

    const updates: Record<string, unknown> = {};
    if (patch.orderNumber !== undefined) {
      updates.orderNumber = await resolveSalesOrderNumberInTx(
        tx,
        orgId,
        patch.orderNumber,
        { excludeId: id }
      );
    }
    if (patch.customerId != null) {
      updates.customerId = customer.id;
      updates.customerName = customer.name;
    }
    if (patch.customerProjectId !== undefined || patch.customerId != null) {
      updates.customerProjectId = nextCustomerProjectId;
    }
    if (patch.orderDate != null) updates.orderDate = patch.orderDate;
    if (patch.shipDate !== undefined) updates.shipDate = patch.shipDate;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.shipLine1 !== undefined) updates.shipLine1 = patch.shipLine1;
    if (patch.shipLine2 !== undefined) updates.shipLine2 = patch.shipLine2;
    if (patch.shipCity !== undefined) updates.shipCity = patch.shipCity;
    if (patch.shipRegion !== undefined) updates.shipRegion = patch.shipRegion;
    if (patch.shipPostcode !== undefined) updates.shipPostcode = patch.shipPostcode;
    if (patch.shipCountry !== undefined) updates.shipCountry = patch.shipCountry;
    if (patch.billingLine1 !== undefined) updates.billingLine1 = patch.billingLine1;
    if (patch.billingLine2 !== undefined) updates.billingLine2 = patch.billingLine2;
    if (patch.billingCity !== undefined) updates.billingCity = patch.billingCity;
    if (patch.billingRegion !== undefined) updates.billingRegion = patch.billingRegion;
    if (patch.billingPostcode !== undefined) {
      updates.billingPostcode = patch.billingPostcode;
    }
    if (patch.billingCountry !== undefined) updates.billingCountry = patch.billingCountry;
    if (patch.shippingFeeDescription !== undefined) {
      updates.shippingFeeDescription = patch.shippingFeeDescription;
    }
    if (patch.shippingFeeAmount !== undefined) {
      updates.shippingFeeAmount = patch.shippingFeeAmount ?? "0";
    }
    if (patch.shippingFeeTaxAmount !== undefined) {
      updates.shippingFeeTaxAmount = patch.shippingFeeTaxAmount ?? "0";
    }
    if (
      patch.shippingFeeAmount !== undefined ||
      patch.shippingFeeTaxAmount !== undefined
    ) {
      const lineTotals = await tx
        .select({
          subtotal: sql<string>`COALESCE(SUM(${salesOrderLines.lineSubtotal}), 0)`,
          tax: sql<string>`COALESCE(SUM(${salesOrderLines.lineTaxAmount}), 0)`,
        })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, id));
      const nextShippingFee =
        patch.shippingFeeAmount !== undefined
          ? Number(patch.shippingFeeAmount ?? 0)
          : Number(existingOrder.shippingFeeAmount ?? 0);
      const nextShippingTax =
        patch.shippingFeeTaxAmount !== undefined
          ? Number(patch.shippingFeeTaxAmount ?? 0)
          : Number(existingOrder.shippingFeeTaxAmount ?? 0);
      updates.subtotalAmount = normalizeMoney(
        Number(lineTotals[0]?.subtotal ?? 0) + nextShippingFee
      );
      updates.taxAmount = normalizeMoney(
        Number(lineTotals[0]?.tax ?? 0) + nextShippingTax
      );
      updates.totalAmount = normalizeMoney(
        Number(updates.subtotalAmount) + Number(updates.taxAmount)
      );
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      updates.version = sql`${salesOrders.version} + 1`;
      await tx
        .update(salesOrders)
        .set(updates)
        .where(eq(salesOrders.id, id));
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: { ok: true },
    });

    return { ok: true };
  });
  return result === null ? null : await getSalesOrder(id);
}

/**
 * Per-line patch for inline-edit cells. This keeps the existing line id stable
 * while still going through pricing validation and inventory-kernel
 * demand/reservation deltas for quantity changes. Use {@link updateSalesOrder}
 * via PUT for structural changes (item swap, line add/remove/reorder).
 */
export async function patchSalesOrderLine(
  orderId: string,
  lineId: string,
  patch: PatchSalesOrderLine,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ ok: true } | null>(tx, {
      organizationId: orgId,
      operationName: "patchSalesOrderLine",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, lineId, patch },
    });
    if (replay.replayed) {
      return replay.result === null ? null : { ok: true };
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, orderId);
    if (!existingOrder) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }
    if (existingOrder.status === "done") {
      throw new SalesError("Done orders cannot be changed.", 400);
    }

    const [existingLine] = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
        listUnitPrice: salesOrderLines.listUnitPrice,
        unitPrice: salesOrderLines.unitPrice,
        taxRateId: salesOrderLines.taxRateId,
        taxRatePercent: salesOrderLines.taxRatePercent,
        discountPercent: salesOrderLines.discountPercent,
        suggestedUnitPrice: salesOrderLines.suggestedUnitPrice,
        pricingSourceType: salesOrderLines.pricingSourceType,
        pricingScheduleName: salesOrderLines.pricingScheduleName,
        pricingBreakLabel: salesOrderLines.pricingBreakLabel,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.id, lineId),
          eq(salesOrderLines.salesOrderId, orderId)
        )
      )
      .for("update");
    if (!existingLine) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const nextQuantity = patch.quantity ?? existingLine.quantity;
    const nextUnitPrice = patch.unitPrice ?? existingLine.unitPrice;
    const taxRate =
      patch.taxRateId === undefined
        ? null
        : patch.taxRateId
          ? (await getTaxRatesByIdInTx(tx, [patch.taxRateId])).get(patch.taxRateId) ?? null
          : null;
    if (patch.taxRateId && !taxRate) {
      throw new SalesError("Tax rate not found", 404);
    }
    const nextTaxRateId =
      patch.taxRateId === undefined ? existingLine.taxRateId : taxRate?.id ?? null;
    const nextTaxRateName =
      patch.taxRateId === undefined ? undefined : taxRate?.name ?? null;
    const nextTaxRatePercent =
      patch.taxRateId === undefined
        ? existingLine.taxRatePercent
        : taxRate?.ratePercent ?? "0";
    const nextQuantityNumber = parseFloat(nextQuantity);
    const currentQuantityNumber = parseFloat(existingLine.quantity);

    if (
      patch.quantity != null &&
      nextQuantityNumber < Number(existingLine.cancelledQuantity)
    ) {
      throw new SalesError(
        "Quantity cannot be less than cancelled quantity.",
        400
      );
    }

    if (patch.quantity != null) {
      await assertSalesOrderLineQuantityEditableInTx(
        tx,
        lineId,
        nextQuantityNumber,
        currentQuantityNumber
      );

      const lineState = (await getSalesOrderLineShipStatesInTx(tx, orderId)).get(lineId);
      if (!lineState) {
        await finishInventoryOperationInTx(tx, {
          organizationId: orgId,
          idempotencyKey: options?.idempotencyKey ?? null,
          result: null,
        });
        return null;
      }
      const minimumQuantity = normalizeShipQuantity(
        lineState.shippedQuantity +
          lineState.cancelledQuantity
      );
      if (nextQuantityNumber < minimumQuantity) {
        throw new SalesError(
          "Quantity cannot be less than shipped or cancelled quantity.",
          400,
          {
            errors: {
              quantity: [`Must be ${normalizeNumeric(minimumQuantity)} or greater`],
            },
          }
        );
      }
    }

    await lockItemsInTx(tx, [existingLine.itemId]);
    const normalizedUnitPrice = normalizeMoney(Number(nextUnitPrice));
    const {
      lineSubtotal: nextLineSubtotal,
      lineTaxAmount: nextLineTaxAmount,
      lineTotal: nextLineTotal,
    } = calculateSalesLineAmounts({
      quantity: nextQuantityNumber,
      unitPrice: nextUnitPrice,
      taxRatePercent: nextTaxRatePercent,
    });
    let listUnitPrice =
      existingLine.listUnitPrice == null
        ? null
        : normalizeMoney(Number(existingLine.listUnitPrice));
    if (patch.unitPrice != null && listUnitPrice == null) {
      const item = (await getValidatedSalesItemsInTx(tx, [existingLine.itemId])).get(
        existingLine.itemId
      );
      if (!item) {
        throw new SalesError("Item not found", 404);
      }
      listUnitPrice =
        normalizeOptionalLineMoney(item.defaultSellingPrice) ??
        normalizeMoney(Number(existingLine.unitPrice));
    }
    const nextDiscountPercent =
      patch.unitPrice != null
        ? calculateDiscountPercentString(listUnitPrice, normalizedUnitPrice)
        : existingLine.discountPercent;

    const updates: Record<string, unknown> = {
      taxRateId: nextTaxRateId,
      taxRatePercent: nextTaxRatePercent,
      lineSubtotal: nextLineSubtotal,
      lineTaxAmount: nextLineTaxAmount,
      lineTotal: nextLineTotal,
      discountPercent: nextDiscountPercent,
      suggestedUnitPrice: existingLine.suggestedUnitPrice,
      pricingSourceType: existingLine.pricingSourceType,
      pricingScheduleName: existingLine.pricingScheduleName,
      pricingBreakLabel: existingLine.pricingBreakLabel,
      isPriceOverridden:
        patch.unitPrice != null
          ? existingLine.suggestedUnitPrice != null &&
            normalizedUnitPrice !== normalizeMoney(Number(existingLine.suggestedUnitPrice))
          : existingLine.isPriceOverridden,
      updatedAt: new Date(),
    };
    if (patch.taxRateId !== undefined) updates.taxRateName = nextTaxRateName;
    if (patch.quantity != null) updates.quantity = patch.quantity;
    if (patch.unitPrice != null) updates.unitPrice = normalizedUnitPrice;
    if (patch.unitPrice != null && existingLine.listUnitPrice == null) {
      updates.listUnitPrice = listUnitPrice;
    }

    await tx
      .update(salesOrderLines)
      .set(updates)
      .where(eq(salesOrderLines.id, lineId));

    if (patch.quantity != null) {
      const quantityDelta = roundQuantity(nextQuantityNumber - currentQuantityNumber);
      if (quantityDelta > 0) {
        await recordSalesDemandInTx(tx, {
          organizationId: orgId,
          salesOrderId: orderId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "patch-line-quantity-increase"
          ),
          lines: [
            {
              salesOrderLineId: lineId,
              itemId: existingLine.itemId,
              quantity: quantityDelta,
            },
          ],
        });
      } else if (quantityDelta < 0) {
        await releaseSalesDemandForQuantitiesInTx(tx, {
          organizationId: orgId,
          salesOrderId: orderId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "patch-line-quantity-decrease"
          ),
          reason: "edited",
          lines: [
            {
              salesOrderLineId: lineId,
              itemId: existingLine.itemId,
              quantity: Math.abs(quantityDelta),
            },
          ],
        });
      }
    }

    // Refresh order totals from canonical line totals.
    const allLines = await tx
      .select({
        lineSubtotal: salesOrderLines.lineSubtotal,
        lineTaxAmount: salesOrderLines.lineTaxAmount,
        lineTotal: salesOrderLines.lineTotal,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    const total = allLines.reduce(
      (sum, line) => sum + Number(line.lineTotal),
      0
    );
    await tx
      .update(salesOrders)
      .set({
        subtotalAmount: normalizeMoney(
          allLines.reduce((sum, line) => sum + Number(line.lineSubtotal), 0) +
            Number(existingOrder.shippingFeeAmount ?? 0)
        ),
        taxAmount: normalizeMoney(
          allLines.reduce((sum, line) => sum + Number(line.lineTaxAmount), 0) +
            Number(existingOrder.shippingFeeTaxAmount ?? 0)
        ),
        totalAmount: normalizeMoney(
          total +
            Number(existingOrder.shippingFeeAmount ?? 0) +
            Number(existingOrder.shippingFeeTaxAmount ?? 0)
        ),
        version: sql`${salesOrders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: { ok: true },
    });

    return { ok: true };
  });
  return result === null ? null : await getSalesOrder(orderId);
}

export async function cancelRemainingSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  const result = await withSalesTransactionRetry(() =>
    withAuthedOrgContext(async (tx, orgId, userId) => {
      const replay = await beginInventoryOperationInTx<{
        id: string;
        status: string;
      } | null>(tx, {
        organizationId: orgId,
        operationName: "cancelRemainingSalesOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id },
      });

      if (replay.replayed) {
        return replay.result;
      }

      await lockSalesPriorityQueueInTx(tx, orgId);
      const order = await getLockedSalesOrderInTx(tx, id);
      if (!order) {
        await finishInventoryOperationInTx(tx, {
          organizationId: orgId,
          idempotencyKey: options?.idempotencyKey ?? null,
          result: null,
        });
        return null;
      }

      if (order.status === "done") {
        throw new SalesError("Order is already closed.", 400);
      }
      if (order.status !== "open") {
        throw new SalesError("Only open orders can be closed.", 400);
      }

      await assertSalesOrderCanCancelRemainingInTx(tx, id);

      const states = await getSalesOrderLineShipStatesInTx(tx, id);
      const hasShippedQuantity = [...states.values()].some(
        (line) => line.shippedQuantity > 0
      );
      if (!hasShippedQuantity) {
        throw new SalesError(
          "Only partially shipped orders can cancel remaining items.",
          400
        );
      }

      const linesToCancel = [...states.values()].flatMap((line) => {
        const quantity = remainingToShip(line);
        if (quantity <= 0) return [];
        return [{ ...line, quantityToCancel: quantity }];
      });
      if (linesToCancel.length === 0) {
        throw new SalesError("No remaining quantity to cancel.", 400);
      }

      await lockItemsInTx(tx, linesToCancel.map((line) => line.itemId));
      const now = new Date();
      await releaseSalesDemandForQuantitiesInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "cancel-remaining-demand"
        ),
        reason: "cancelled",
        lines: linesToCancel.map((line) => ({
          salesOrderLineId: line.id,
          itemId: line.itemId,
          quantity: line.quantityToCancel,
        })),
      });

      for (const line of linesToCancel) {
        await tx
          .update(salesOrderLines)
          .set({
            cancelledQuantity: sql`${salesOrderLines.cancelledQuantity} + ${normalizeNumeric(line.quantityToCancel)}`,
            updatedAt: now,
          })
          .where(eq(salesOrderLines.id, line.id));
      }

      const [closed] = await tx
        .update(salesOrders)
        .set({
          status: "done",
          priorityRank: null,
          version: sql`${salesOrders.version} + 1`,
          updatedAt: now,
        })
        .where(eq(salesOrders.id, id))
        .returning({ id: salesOrders.id, status: salesOrders.status });

      await rerankOpenSalesOrdersInTx(tx, orgId);

      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: closed,
      });

      return closed;
    })
  );

  return result === null ? null : await getSalesOrder(id);
}
