import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  inventoryDemandSummary,
  inventoryLocations,
  inventoryLotBalances,
  items,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { getCurrentBomCoverageInTx } from "@/lib/bom/revisions";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
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
  status: "will_create" | "skipped";
  skipReason: SalesOrderManufacturingSkipReason | null;
  skipMessage: string | null;
  groupRemainderRows: Array<{
    basisOutputQuantity: string | null;
    groupRemainderPolicy: string | null;
  }>;
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
      return "Finished goods stock covers this sales line.";
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
    return "Finished goods stock covers every manufacturable line.";
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

  const masterItems = alias(items, "master_items");
  const itemRows = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      deletedAt: items.deletedAt,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(items)
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(inArray(items.id, itemIds));

  const [defaultLocation] = await tx
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(eq(inventoryLocations.isDefault, true), isNull(inventoryLocations.deletedAt)))
    .limit(1);

  const demandRows = defaultLocation
    ? await tx
        .select({
          itemId: inventoryDemandSummary.itemId,
          demandQty: trimScale(
            sql`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)`
          ).as("demandQty"),
        })
        .from(inventoryDemandSummary)
        .where(
          and(
            eq(inventoryDemandSummary.locationId, defaultLocation.id),
            eq(inventoryDemandSummary.referenceType, "sales_order_line"),
            inArray(inventoryDemandSummary.itemId, itemIds)
          )
        )
        .groupBy(inventoryDemandSummary.itemId)
    : [];

  const reservableRows = defaultLocation
    ? await tx
        .select({
          itemId: inventoryLotBalances.itemId,
          reservableOnHandQty: trimScale(
            sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`
          ).as("reservableOnHandQty"),
        })
        .from(inventoryLotBalances)
        .where(
          and(
            eq(inventoryLotBalances.locationId, defaultLocation.id),
            inArray(inventoryLotBalances.itemId, itemIds),
            eq(inventoryLotBalances.disposition, "available"),
            sql`${inventoryLotBalances.quantity} > 0`
          )
        )
        .groupBy(inventoryLotBalances.itemId)
    : [];

  const itemById = new Map(
    itemRows.map((row) => [row.id, row])
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
  const demandByItemId = new Map(
    demandRows.map((row) => [row.itemId, Number(row.demandQty)])
  );
  const reservableStockByItemId = new Map(
    reservableRows.map((row) => [row.itemId, Number(row.reservableOnHandQty)])
  );
  const selectedDemandByItem = new Map<string, number>();
  lines.forEach((line) => {
    selectedDemandByItem.set(
      line.itemId,
      roundQuantity((selectedDemandByItem.get(line.itemId) ?? 0) + Number(line.quantity))
    );
  });
  const remainingAllocatableStockByItemId = new Map<string, number>();

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
      let stockCoversLine = false;
      let uncoveredQuantity: string | null = null;

      if (canCreateFromOrder && Number.isFinite(orderedQuantity) && orderedQuantity > 0) {
        const demandOutsideSelection = Math.max(
          0,
          roundQuantity(
            (demandByItemId.get(line.itemId) ?? 0) -
              (selectedDemandByItem.get(line.itemId) ?? 0)
          )
        );
        const remainingStock =
          remainingAllocatableStockByItemId.get(line.itemId) ??
          roundQuantity(
            (reservableStockByItemId.get(line.itemId) ?? 0) -
              demandOutsideSelection
          );
        const updatedRemainingStock = roundQuantity(
          remainingStock - orderedQuantity
        );

        remainingAllocatableStockByItemId.set(line.itemId, updatedRemainingStock);

        if (remainingStock >= orderedQuantity) {
          stockCoversLine = true;
        } else if (remainingStock > 0) {
          uncoveredQuantity = normalizeNumeric(roundQuantity(orderedQuantity - remainingStock));
        }
      }

      if (existingManufacturingLineIds.has(line.salesOrderLineId)) {
        skipReason = "existing_active_mo";
      } else if (!bomBackedProductIds.has(line.itemId)) {
        skipReason = "no_active_bom";
      } else if (stockCoversLine) {
        skipReason = "stock_on_hand";
      } else if (uncoveredQuantity != null) {
        manufacturingQuantity = uncoveredQuantity;
      }
    }

    const bucket = summaries.get(line.salesOrderId);
    if (!bucket) {
      return;
    }

    const display = resolveVariantDisplay(
      line.itemName,
      item?.masterName == null
        ? null
        : { name: item.masterName, variantAxes: item.masterVariantAxes },
      item?.variantAttrs ?? null
    );

    bucket.lines.push({
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      itemType: item?.itemType ?? null,
      itemName: line.itemName,
      masterName: display.masterName,
      attrs: display.attrs,
      itemSku: line.itemSku,
      quantity: manufacturingQuantity,
      unitName: line.unitName,
      status: skipReason == null ? "will_create" : "skipped",
      skipReason,
      skipMessage: skipReason == null ? null : getSkipMessage(skipReason),
      groupRemainderRows: (bomCoverage.get(line.itemId) ?? [])
        .filter((component) => component.consumptionMode === "per_group")
        .map((component) => ({
          basisOutputQuantity: component.basisOutputQuantity,
          groupRemainderPolicy: component.groupRemainderPolicy,
        })),
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
