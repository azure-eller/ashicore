import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { getCurrentBomCoverageInTx } from "@/lib/bom/revisions";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";

export const SALES_ORDER_MANUFACTURING_SKIP_REASONS = [
  "non_product",
  "inactive_product",
  "no_active_bom",
  "existing_active_mo",
  "no_remaining_demand",
  "order_not_open",
] as const;

export type SalesOrderManufacturingSkipReason =
  (typeof SALES_ORDER_MANUFACTURING_SKIP_REASONS)[number];

export type SalesOrderManufacturingLineSummary = {
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  itemType: string | null;
  itemName: string;
  masterName: string;
  attrs: string[];
  itemSku: string | null;
  quantity: string;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
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
    case "non_product":
      return "Only product lines can create manufacturing orders.";
    case "inactive_product":
      return "Product is inactive or deleted.";
    case "no_active_bom":
      return "Product has no active BOM ingredients.";
    case "existing_active_mo":
      return "A linked manufacturing order already exists.";
    case "no_remaining_demand":
      return "This sales line is already shipped or cancelled.";
    case "order_not_open":
      return "Only open sales orders can create manufacturing orders.";
  }
}

async function getManufacturingOptionValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id),
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, string[]>();
  for (const row of rows) {
    const labels = byItemId.get(row.itemId) ?? [];
    labels.push(row.label);
    byItemId.set(row.itemId, labels);
  }
  return byItemId;
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
    skippedReasons.every((reason) => reason === "non_product")
  ) {
    return "This order has no product lines to manufacture.";
  }

  if (
    skippedReasons.length === lines.length &&
    skippedReasons.every((reason) => reason === "existing_active_mo")
  ) {
    return "All manufacturable lines already have linked manufacturing orders.";
  }

  if (
    skippedReasons.length === lines.length &&
    skippedReasons.every((reason) => reason === "no_remaining_demand")
  ) {
    return "All manufacturable lines are already shipped or cancelled.";
  }

  if (
    skippedReasons.length === lines.length &&
    skippedReasons.every((reason) => reason === "order_not_open")
  ) {
    return "Only open sales orders can create manufacturing orders.";
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
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
      cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
        "cancelledQuantity"
      ),
      unitName: salesOrderLines.unitName,
      orderStatus: salesOrders.status,
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(inArray(salesOrderLines.salesOrderId, uniqueOrderIds))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

  if (lines.length === 0) {
    return summaries;
  }

  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const salesOrderLineIds = lines.map((line) => line.salesOrderLineId);

  const itemRows = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      deletedAt: items.deletedAt,
      name: items.name,
      familyName: itemFamilies.name,
      manufacturingMode: items.manufacturingMode,
      expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
        "expectedBatchYield"
      ),
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(inArray(items.id, itemIds));

  const itemById = new Map(
    itemRows.map((row) => [row.id, row])
  );
  const optionValuesByItemId = await getManufacturingOptionValuesByItemIdInTx(
    tx,
    itemIds,
  );

  const bomCoverage = await getCurrentBomCoverageInTx(tx, itemIds);

  const existingManufacturingRefs = salesOrderLineIds.length
    ? await tx
        .select({
          salesOrderLineId: manufacturingOrders.salesOrderLineId,
          plannedQuantity: trimScale(
            sql`COALESCE(SUM(${manufacturingOrders.plannedQuantity}), 0)`
          ).as("plannedQuantity"),
        })
        .from(manufacturingOrders)
        .where(
          and(
            inArray(manufacturingOrders.salesOrderLineId, salesOrderLineIds),
            isNull(manufacturingOrders.deletedAt),
            isNull(manufacturingOrders.cancelledAt),
            inArray(manufacturingOrders.status, ["open", "done"])
          )
        )
        .groupBy(manufacturingOrders.salesOrderLineId)
    : [];
  const shippedRows = salesOrderLineIds.length
    ? await tx
        .select({
          salesOrderLineId: salesShipmentLines.salesOrderLineId,
          shippedQuantity: trimScale(
            sql`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`
          ).as("shippedQuantity"),
        })
        .from(salesShipmentLines)
        .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
        .where(
          and(
            inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds),
            eq(salesShipments.status, "shipped")
          )
        )
        .groupBy(salesShipmentLines.salesOrderLineId)
    : [];
  const bomBackedProductIds = new Set(
    [...bomCoverage.entries()]
      .filter(([, components]) => components.length > 0)
      .map(([productId]) => productId)
  );
  const linkedManufacturingQtyBySalesOrderLineId = new Map<string, number>();
  existingManufacturingRefs.forEach((row) => {
    if (!row.salesOrderLineId) return;
    linkedManufacturingQtyBySalesOrderLineId.set(
      row.salesOrderLineId,
      Number(row.plannedQuantity)
    );
  });
  const shippedBySalesOrderLineId = new Map<string, number>();
  shippedRows.forEach((row) => {
    shippedBySalesOrderLineId.set(row.salesOrderLineId, Number(row.shippedQuantity));
  });
  lines.forEach((line) => {
    let skipReason: SalesOrderManufacturingSkipReason | null = null;
    let manufacturingQuantity = line.quantity;
    const item = itemById.get(line.itemId);

    if (!item) {
      skipReason = "inactive_product";
    } else if (item.itemType !== "product") {
      skipReason = "non_product";
    } else if (item.deletedAt != null) {
      skipReason = "inactive_product";
    } else {
      const orderedQuantity = Number(line.quantity);
      const cancelledQuantity = Number(line.cancelledQuantity);
      const canCreateFromOrder = line.orderStatus === "open";
      let remainingQuantity: string | null = null;
      let linkedManufacturingQuantity = 0;

      if (Number.isFinite(orderedQuantity) && orderedQuantity > 0) {
        const shippedQuantity =
          shippedBySalesOrderLineId.get(line.salesOrderLineId) ?? 0;
        linkedManufacturingQuantity =
          linkedManufacturingQtyBySalesOrderLineId.get(line.salesOrderLineId) ?? 0;
        const fulfilledOrPinnedQuantity = Math.max(
          shippedQuantity,
          linkedManufacturingQuantity
        );
        remainingQuantity = normalizeNumeric(
          roundQuantity(
            orderedQuantity -
              (Number.isFinite(cancelledQuantity) ? cancelledQuantity : 0) -
              fulfilledOrPinnedQuantity
          )
        );
      }

      if (!bomBackedProductIds.has(line.itemId)) {
        skipReason = "no_active_bom";
      } else if (!canCreateFromOrder) {
        skipReason = "order_not_open";
      } else if (remainingQuantity != null && Number(remainingQuantity) <= 0.0001) {
        skipReason =
          linkedManufacturingQuantity > 0
            ? "existing_active_mo"
            : "no_remaining_demand";
      } else if (remainingQuantity != null) {
        manufacturingQuantity = remainingQuantity;
      }
    }

    const bucket = summaries.get(line.salesOrderId);
    if (!bucket) {
      return;
    }

    const optionValues = optionValuesByItemId.get(line.itemId) ?? [];
    const masterName = item?.familyName ?? item?.name ?? line.itemName;

    bucket.lines.push({
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      itemType: item?.itemType ?? null,
      itemName: line.itemName,
      masterName,
      attrs: optionValues,
      itemSku: line.itemSku,
      quantity: manufacturingQuantity,
      unitName: line.unitName,
      manufacturingMode: item?.manufacturingMode ?? "discrete",
      expectedBatchYield: item?.expectedBatchYield ?? null,
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
