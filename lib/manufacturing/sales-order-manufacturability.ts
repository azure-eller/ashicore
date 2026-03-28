import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  bomComponents,
  items,
  manufacturingOrders,
  salesOrderLines,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export const SALES_ORDER_MANUFACTURING_SKIP_REASONS = [
  "inactive_product",
  "no_active_bom",
  "existing_active_mo",
] as const;

export type SalesOrderManufacturingSkipReason =
  (typeof SALES_ORDER_MANUFACTURING_SKIP_REASONS)[number];

export type SalesOrderManufacturingLineSummary = {
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitName: string;
  status: "will_create" | "skipped";
  skipReason: SalesOrderManufacturingSkipReason | null;
  skipMessage: string | null;
};

export type SalesOrderManufacturingSummary = {
  lines: SalesOrderManufacturingLineSummary[];
  manufacturableLineCount: number;
  hasManufacturableLines: boolean;
  disabledReason: string | null;
};

function getSkipMessage(reason: SalesOrderManufacturingSkipReason) {
  switch (reason) {
    case "inactive_product":
      return "Product is inactive or deleted.";
    case "no_active_bom":
      return "Product has no active BOM ingredients.";
    case "existing_active_mo":
      return "A linked manufacturing order already exists.";
  }
}

function getDisabledReason(lines: SalesOrderManufacturingLineSummary[]) {
  if (lines.length === 0) {
    return "This order has no product lines to manufacture.";
  }

  const skippedReasons = lines
    .map((line) => line.skipReason)
    .filter((reason): reason is SalesOrderManufacturingSkipReason => reason != null);

    if (
      skippedReasons.length === lines.length &&
      skippedReasons.every((reason) => reason === "existing_active_mo")
    ) {
      return "All manufacturable lines already have linked manufacturing orders.";
    }

  if (
    skippedReasons.length === lines.length &&
    skippedReasons.every(
      (reason) => reason === "inactive_product" || reason === "no_active_bom"
    )
  ) {
    return "No active BOM-backed products remain on this order.";
  }

  return "No manufacturable lines remain on this order.";
}

export async function getSalesOrderManufacturingSummariesInTx(
  tx: Tx,
  salesOrderIds: string[]
): Promise<Map<string, SalesOrderManufacturingSummary>> {
  const uniqueOrderIds = [...new Set(salesOrderIds)];
  const summaries = new Map<string, SalesOrderManufacturingSummary>();

  uniqueOrderIds.forEach((orderId) => {
    summaries.set(orderId, {
      lines: [],
      manufacturableLineCount: 0,
      hasManufacturableLines: false,
      disabledReason: "This order has no product lines to manufacture.",
    });
  });

  if (uniqueOrderIds.length === 0) {
    return summaries;
  }

  const lines = await tx
    .select({
      salesOrderId: salesOrderLines.salesOrderId,
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      quantity: salesOrderLines.quantity,
      unitName: salesOrderLines.unitName,
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
    })
    .from(salesOrderLines)
    .where(inArray(salesOrderLines.salesOrderId, uniqueOrderIds))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

  if (lines.length === 0) {
    return summaries;
  }

  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const salesOrderLineIds = lines.map((line) => line.salesOrderLineId);

  const activeProducts = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        inArray(items.id, itemIds),
        eq(items.itemType, "product"),
        isNull(items.deletedAt)
      )
    );

  const bomRows = await tx
    .select({
      productId: bomComponents.itemId,
    })
    .from(bomComponents)
    .innerJoin(items, eq(bomComponents.componentId, items.id))
    .where(
      and(
        inArray(bomComponents.itemId, itemIds),
        isNull(items.deletedAt)
      )
    );

  const existingManufacturingRefs = salesOrderLineIds.length
    ? await tx
        .select({
          salesOrderLineId: manufacturingOrders.salesOrderLineId,
        })
        .from(manufacturingOrders)
        .where(
          and(
            inArray(manufacturingOrders.salesOrderLineId, salesOrderLineIds),
            isNull(manufacturingOrders.deletedAt),
            inArray(manufacturingOrders.status, [
              "draft",
              "released",
              "completed",
            ])
          )
        )
    : [];

  const activeProductIds = new Set(activeProducts.map((row) => row.id));
  const bomBackedProductIds = new Set(bomRows.map((row) => row.productId));
  const existingManufacturingLineIds = new Set(
    existingManufacturingRefs
      .map((row) => row.salesOrderLineId)
      .filter((value): value is string => value != null)
  );

  lines.forEach((line) => {
    let skipReason: SalesOrderManufacturingSkipReason | null = null;

    if (!activeProductIds.has(line.itemId)) {
      skipReason = "inactive_product";
    } else if (existingManufacturingLineIds.has(line.salesOrderLineId)) {
      skipReason = "existing_active_mo";
    } else if (!bomBackedProductIds.has(line.itemId)) {
      skipReason = "no_active_bom";
    }

    const bucket = summaries.get(line.salesOrderId);
    if (!bucket) {
      return;
    }

    bucket.lines.push({
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      itemName: line.itemName,
      itemSku: line.itemSku,
      quantity: line.quantity,
      unitName: line.unitName,
      status: skipReason == null ? "will_create" : "skipped",
      skipReason,
      skipMessage: skipReason == null ? null : getSkipMessage(skipReason),
    });
  });

  summaries.forEach((summary) => {
    summary.manufacturableLineCount = summary.lines.filter(
      (line) => line.status === "will_create"
    ).length;
    summary.hasManufacturableLines = summary.manufacturableLineCount > 0;
    summary.disabledReason = summary.hasManufacturableLines
      ? null
      : getDisabledReason(summary.lines);
  });

  return summaries;
}
