import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeQuantityNumber, roundQuantity } from "@/lib/format";
import { salesOrderLines, salesOrders } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { documentNumberSortSql } from "@/lib/document-numbers";

export function parseMoneyValue(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPgErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") {
    return record.code;
  }

  return getPgErrorCode(record.cause);
}

function isRetryableTransactionError(error: unknown) {
  const code = getPgErrorCode(error);
  return code === "40P01" || code === "40001";
}

export async function withSalesTransactionRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw lastError;
}

export function isEditableOpenSalesOrderStatus(status: string) {
  return status === "open";
}

export const OPEN_SALES_ORDER_STATUSES = [
  "open",
] as const;

export function isOpenSalesOrderStatus(status: string) {
  return (OPEN_SALES_ORDER_STATUSES as readonly string[]).includes(status);
}

export async function rerankOpenSalesOrdersInTx(tx: Tx, orgId: string) {
  await lockSalesPriorityQueueInTx(tx, orgId);

  await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(asc(salesOrders.id))
    .for("update");

  const rows = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(
      sql`${salesOrders.priorityRank} IS NULL`,
      asc(salesOrders.priorityRank),
      asc(salesOrders.shipDate),
      asc(salesOrders.requestedDate),
      asc(salesOrders.orderDate),
      asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
      asc(salesOrders.orderNumber),
      asc(salesOrders.id)
    );

  if (rows.length === 0) {
    return;
  }

  const now = new Date();
  await tx
    .update(salesOrders)
    .set({
      priorityRank: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    );

  for (const [index, row] of rows.entries()) {
    await tx
      .update(salesOrders)
      .set({
        priorityRank: index + 1,
        updatedAt: now,
      })
      .where(eq(salesOrders.id, row.id));
  }
}

export async function getOrderLinesInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
      stockingUnitName: salesOrderLines.stockingUnitName,
      salesToStockFactor: trimScale(salesOrderLines.salesToStockFactor).as(
        "salesToStockFactor"
      ),
      stockQuantity: trimScale(salesOrderLines.stockQuantity).as("stockQuantity"),
      shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as(
        "shippedQuantity"
      ),
      stockShippedQuantity: trimScale(salesOrderLines.stockShippedQuantity).as(
        "stockShippedQuantity"
      ),
      cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
        "cancelledQuantity"
      ),
      stockCancelledQuantity: trimScale(salesOrderLines.stockCancelledQuantity).as(
        "stockCancelledQuantity"
      ),
      listUnitPrice: trimScaleNullable(salesOrderLines.listUnitPrice).as(
        "listUnitPrice"
      ),
      unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
      taxRateId: salesOrderLines.taxRateId,
      taxRateName: salesOrderLines.taxRateName,
      taxRatePercent: trimScale(salesOrderLines.taxRatePercent).as("taxRatePercent"),
      discountPercent: trimScale(salesOrderLines.discountPercent).as(
        "discountPercent"
      ),
      suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
        "suggestedUnitPrice"
      ),
      pricingSourceType: salesOrderLines.pricingSourceType,
      pricingScheduleName: salesOrderLines.pricingScheduleName,
      pricingBreakLabel: salesOrderLines.pricingBreakLabel,
      isPriceOverridden: salesOrderLines.isPriceOverridden,
      lineSubtotal: trimScale(salesOrderLines.lineSubtotal).as("lineSubtotal"),
      lineTaxAmount: trimScale(salesOrderLines.lineTaxAmount).as("lineTaxAmount"),
      lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      updatedAt: salesOrderLines.updatedAt,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));
}

export async function getLockedSalesOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      version: salesOrders.version,
      customerId: salesOrders.customerId,
      customerProjectId: salesOrders.customerProjectId,
      customerName: salesOrders.customerName,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      shipLine1: salesOrders.shipLine1,
      shipLine2: salesOrders.shipLine2,
      shipCity: salesOrders.shipCity,
      shipRegion: salesOrders.shipRegion,
      shipPostcode: salesOrders.shipPostcode,
      shipCountry: salesOrders.shipCountry,
      billingLine1: salesOrders.billingLine1,
      billingLine2: salesOrders.billingLine2,
      billingCity: salesOrders.billingCity,
      billingRegion: salesOrders.billingRegion,
      billingPostcode: salesOrders.billingPostcode,
      billingCountry: salesOrders.billingCountry,
      shippingFeeDescription: salesOrders.shippingFeeDescription,
      shippingFeeAmount: trimScale(salesOrders.shippingFeeAmount).as("shippingFeeAmount"),
      shippingFeeTaxAmount: trimScale(salesOrders.shippingFeeTaxAmount).as("shippingFeeTaxAmount"),
      subtotalAmount: trimScale(salesOrders.subtotalAmount).as("subtotalAmount"),
      taxAmount: trimScale(salesOrders.taxAmount).as("taxAmount"),
      totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

export type SalesOrderLineShipState = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: number;
  cancelledQuantity: number;
  shippedQuantity: number;
  sellingUnitName: string;
  sellingQuantity: number;
  sellingCancelledQuantity: number;
  sellingShippedQuantity: number;
  salesToStockFactor: number;
  plannedQuantity: number;
  sortOrder: number;
};

export function normalizeShipQuantity(value: number) {
  return normalizeQuantityNumber(roundQuantity(value));
}

export function remainingToShip(line: SalesOrderLineShipState) {
  return normalizeShipQuantity(
    line.quantity - line.shippedQuantity - line.cancelledQuantity
  );
}

export function sellingRemainingToShip(line: SalesOrderLineShipState) {
  return normalizeShipQuantity(
    line.sellingQuantity -
      line.sellingShippedQuantity -
      line.sellingCancelledQuantity,
  );
}

export async function getSalesOrderLineShipStatesInTx(
  tx: Tx,
  orderId: string
) {
  const orderLines = await tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.stockingUnitName,
      quantity: salesOrderLines.stockQuantity,
      shippedQuantity: salesOrderLines.stockShippedQuantity,
      cancelledQuantity: salesOrderLines.stockCancelledQuantity,
      sellingUnitName: salesOrderLines.unitName,
      sellingQuantity: salesOrderLines.quantity,
      sellingShippedQuantity: salesOrderLines.shippedQuantity,
      sellingCancelledQuantity: salesOrderLines.cancelledQuantity,
      salesToStockFactor: salesOrderLines.salesToStockFactor,
      sortOrder: salesOrderLines.sortOrder,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt))
    .for("update");

  return new Map<string, SalesOrderLineShipState>(
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
        shippedQuantity: normalizeShipQuantity(Number(line.shippedQuantity)),
        sellingUnitName: line.sellingUnitName,
        sellingQuantity: parseFloat(line.sellingQuantity),
        sellingCancelledQuantity: parseFloat(line.sellingCancelledQuantity),
        sellingShippedQuantity: normalizeShipQuantity(
          Number(line.sellingShippedQuantity),
        ),
        salesToStockFactor: parseFloat(line.salesToStockFactor),
        plannedQuantity: 0,
        sortOrder: line.sortOrder,
      },
    ])
  );
}
