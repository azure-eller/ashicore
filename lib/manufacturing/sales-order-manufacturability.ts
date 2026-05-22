import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
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
  "stock_on_hand",
  "existing_active_mo",
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
    case "stock_on_hand":
      return "Allocated stock covers this sales line.";
    case "existing_active_mo":
      return "A linked manufacturing order already exists.";
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
    skippedReasons.every((reason) => reason === "stock_on_hand")
  ) {
    return "Allocated stock covers every manufacturable line.";
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
        })
        .from(manufacturingOrders)
      .where(
        and(
          inArray(manufacturingOrders.salesOrderLineId, salesOrderLineIds),
            isNull(manufacturingOrders.deletedAt),
            inArray(manufacturingOrders.status, ["open", "done"])
          )
        )
    : [];
  const lineAllocationRows = salesOrderLineIds.length
    ? await tx
        .select({
          salesOrderLineId: stockAllocations.demandId,
          allocatedQty: trimScale(
            sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`
          ).as("allocatedQty"),
        })
        .from(stockAllocations)
        .where(
          and(
            eq(stockAllocations.demandType, "sales_order_line"),
            inArray(stockAllocations.demandId, salesOrderLineIds),
            eq(stockAllocations.status, "active")
          )
        )
        .groupBy(stockAllocations.demandId)
    : [];
  const bomBackedProductIds = new Set(
    [...bomCoverage.entries()]
      .filter(([, components]) => components.length > 0)
      .map(([productId]) => productId)
  );
  const existingManufacturingLineIds = new Set(
    existingManufacturingRefs
      .map((row) => row.salesOrderLineId)
      .filter((value): value is string => value != null)
  );
  const allocatedBySalesOrderLineId = new Map<string, number>();
  lineAllocationRows.forEach((row) => {
    allocatedBySalesOrderLineId.set(row.salesOrderLineId, Number(row.allocatedQty));
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
      const canCreateFromOrder = line.orderStatus === "open";
      let allocationCoversLine = false;
      let uncoveredQuantity: string | null = null;

      if (canCreateFromOrder && Number.isFinite(orderedQuantity) && orderedQuantity > 0) {
        const allocatedQuantity = allocatedBySalesOrderLineId.get(line.salesOrderLineId) ?? 0;

        if (allocatedQuantity >= orderedQuantity) {
          allocationCoversLine = true;
        } else if (allocatedQuantity > 0) {
          uncoveredQuantity = normalizeNumeric(
            roundQuantity(orderedQuantity - allocatedQuantity)
          );
        }
      }

      if (existingManufacturingLineIds.has(line.salesOrderLineId)) {
        skipReason = "existing_active_mo";
      } else if (!bomBackedProductIds.has(line.itemId)) {
        skipReason = "no_active_bom";
      } else if (allocationCoversLine) {
        skipReason = "stock_on_hand";
      } else if (uncoveredQuantity != null) {
        manufacturingQuantity = uncoveredQuantity;
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
