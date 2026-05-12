import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  INVENTORY_EVENT_TYPES,
  type InventoryEventType,
  inventoryEvents,
  items,
  manufacturingOrderBatches,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakes,
  user,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  formatVariantDisplay,
} from "@/lib/format";
import {
  ON_HAND_EVENT_TYPES,
  ledgerOnHandDeltaExpr,
} from "@/lib/inventory/kernel";
import {
  formatInventoryLedgerEventLabel,
  getInventoryLedgerBalanceDimension,
  getInventoryLedgerEventClass,
  getSignedInventoryLedgerQuantity,
  summarizeInventoryLedgerMetadata,
  type InventoryLedgerSourceType,
} from "@/lib/inventory/ledger";
import type { InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import { itemDetailHref, type ItemType } from "../types";
import type {
  InventoryLedgerActorOption,
  InventoryLedgerItemOption,
  InventoryLedgerPageData,
  InventoryLedgerRow,
} from "./types";

const masterItems = alias(items, "ledger_master_items");
const actorUsers = alias(user, "ledger_actor_users");

const directPurchaseOrders = alias(purchaseOrders, "ledger_direct_purchase_orders");
const purchaseOrderLineRefs = alias(purchaseOrderLines, "ledger_purchase_order_line_refs");
const purchaseOrdersViaLines = alias(
  purchaseOrders,
  "ledger_purchase_orders_via_lines"
);

const directSalesOrders = alias(salesOrders, "ledger_direct_sales_orders");
const salesOrderLineRefs = alias(salesOrderLines, "ledger_sales_order_line_refs");
const salesOrdersViaLines = alias(salesOrders, "ledger_sales_orders_via_lines");

const directManufacturingOrders = alias(
  manufacturingOrders,
  "ledger_direct_manufacturing_orders"
);
const manufacturingIngredientRefs = alias(
  manufacturingOrderIngredients,
  "ledger_manufacturing_ingredient_refs"
);
const manufacturingOrdersViaIngredients = alias(
  manufacturingOrders,
  "ledger_manufacturing_orders_via_ingredients"
);
const manufacturingBatchRefs = alias(
  manufacturingOrderBatches,
  "ledger_manufacturing_batch_refs"
);
const manufacturingOrdersViaBatches = alias(
  manufacturingOrders,
  "ledger_manufacturing_orders_via_batches"
);

const stocktakeLineRefs = alias(stocktakeItems, "ledger_stocktake_line_refs");
const stocktakeDocs = alias(stocktakes, "ledger_stocktake_docs");
const DEFAULT_LEDGER_TIME_ZONE = "UTC";

function getLedgerTimeZone(filters: InventoryLedgerFilters) {
  return filters.timeZone ?? DEFAULT_LEDGER_TIME_ZONE;
}

function getStartOfDayInTimeZone(date: string, timeZone: string) {
  return sql`(${date}::date::timestamp AT TIME ZONE ${timeZone})`;
}

function getNextDayInTimeZone(date: string, timeZone: string) {
  return sql`((${date}::date + interval '1 day')::timestamp AT TIME ZONE ${timeZone})`;
}

function buildDocumentConditions(filters: InventoryLedgerFilters) {
  if (!filters.documentType) {
    return [];
  }

  const id = filters.documentId;

  switch (filters.documentType) {
    case "purchase_order":
      return [
        id
          ? or(
              eq(directPurchaseOrders.id, id),
              eq(purchaseOrdersViaLines.id, id)
            )
          : or(
              eq(inventoryEvents.referenceType, "purchase_order"),
              eq(inventoryEvents.referenceType, "purchase_order_line")
            ),
      ];
    case "sales_order":
      return [
        id
          ? or(eq(directSalesOrders.id, id), eq(salesOrdersViaLines.id, id))
          : or(
              eq(inventoryEvents.referenceType, "sales_order"),
              eq(inventoryEvents.referenceType, "sales_order_line")
            ),
      ];
    case "manufacturing_order":
      return [
        id
          ? or(
              eq(directManufacturingOrders.id, id),
              eq(manufacturingOrdersViaIngredients.id, id),
              eq(manufacturingOrdersViaBatches.id, id)
            )
          : or(
              eq(inventoryEvents.referenceType, "manufacturing_order"),
              eq(inventoryEvents.referenceType, "manufacturing_order_ingredient"),
              eq(inventoryEvents.referenceType, "manufacturing_batch")
            ),
      ];
    case "stocktake":
      return [
        id
          ? eq(stocktakeDocs.id, id)
          : eq(inventoryEvents.referenceType, "stocktake_line"),
      ];
    case "item":
      return [
        id
          ? and(eq(inventoryEvents.referenceType, "item"), eq(inventoryEvents.referenceId, id))
          : eq(inventoryEvents.referenceType, "item"),
      ];
    case "seed":
      return [eq(inventoryEvents.referenceType, "seed")];
  }
}

function countNeedsExpandedJoins(filters: InventoryLedgerFilters) {
  if (filters.q) {
    return true;
  }

  if (!filters.documentId) {
    return false;
  }

  return (
    filters.documentType === "purchase_order" ||
    filters.documentType === "sales_order" ||
    filters.documentType === "manufacturing_order" ||
    filters.documentType === "stocktake"
  );
}

function buildLedgerWhere(filters: InventoryLedgerFilters, organizationId: string) {
  const conditions: SQL[] = [eq(inventoryEvents.organizationId, organizationId)];
  const timeZone = getLedgerTimeZone(filters);

  if (filters.itemId) {
    conditions.push(eq(inventoryEvents.itemId, filters.itemId));
  }

  if (filters.itemType) {
    conditions.push(eq(items.itemType, filters.itemType));
  }

  if (filters.actorUserId) {
    conditions.push(eq(inventoryEvents.actorUserId, filters.actorUserId));
  }

  if (filters.dateFrom) {
    conditions.push(
      gte(
        inventoryEvents.occurredAt,
        getStartOfDayInTimeZone(filters.dateFrom, timeZone)
      )
    );
  }

  if (filters.dateTo) {
    conditions.push(
      lt(
        inventoryEvents.occurredAt,
        getNextDayInTimeZone(filters.dateTo, timeZone)
      )
    );
  }

  if (filters.lot) {
    conditions.push(ilike(lots.lotNumber, `%${filters.lot}%`));
  }

  if (filters.eventType) {
    conditions.push(eq(inventoryEvents.eventType, filters.eventType));
  } else if (filters.eventClasses) {
    const allowed = INVENTORY_EVENT_TYPES.filter(
      (eventType) => filters.eventClasses?.includes(getInventoryLedgerEventClass(eventType))
    );
    conditions.push(inArray(inventoryEvents.eventType, allowed));
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const searchCondition = or(
      ilike(items.name, pattern),
      ilike(items.sku, pattern),
      ilike(masterItems.name, pattern),
      ilike(lots.lotNumber, pattern),
      ilike(directPurchaseOrders.orderNumber, pattern),
      ilike(purchaseOrdersViaLines.orderNumber, pattern),
      ilike(directSalesOrders.orderNumber, pattern),
      ilike(salesOrdersViaLines.orderNumber, pattern),
      ilike(directManufacturingOrders.orderNumber, pattern),
      ilike(manufacturingOrdersViaIngredients.orderNumber, pattern),
      ilike(manufacturingOrdersViaBatches.orderNumber, pattern),
      ilike(stocktakeDocs.name, pattern),
      ilike(actorUsers.name, pattern),
      ilike(actorUsers.email, pattern)
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  for (const documentCondition of buildDocumentConditions(filters)) {
    if (documentCondition) {
      conditions.push(documentCondition);
    }
  }

  return and(...conditions);
}

function resolveItemDisplayName(row: {
  itemName: string;
  masterName: string | null;
  masterVariantAxes: string[] | null;
  variantAttrs: Record<string, string> | null;
}) {
  if (row.masterName && row.masterVariantAxes && row.variantAttrs) {
    return formatVariantDisplay(row.masterName, row.variantAttrs, row.masterVariantAxes);
  }

  return row.itemName;
}

function getSourceDocumentHref(
  sourceType: InventoryLedgerSourceType,
  id: string | null,
  itemType: ItemType,
  itemId: string
) {
  if (!id) {
    return null;
  }

  switch (sourceType) {
    case "purchase_order":
      return `/purchasing/orders/${id}`;
    case "sales_order":
      return `/sales/orders/${id}`;
    case "manufacturing_order":
      return `/manufacturing/orders/${id}`;
    case "stocktake":
      return `/inventory/stocktakes/${id}`;
    case "item":
      return itemDetailHref(itemType, itemId);
    case "seed":
      return null;
  }
}

function resolveSourceDocument(row: {
  itemId: string;
  itemType: ItemType;
  referenceType: string | null;
  directPurchaseOrderId: string | null;
  directPurchaseOrderNumber: string | null;
  purchaseOrderIdViaLine: string | null;
  purchaseOrderNumberViaLine: string | null;
  directSalesOrderId: string | null;
  directSalesOrderNumber: string | null;
  salesOrderIdViaLine: string | null;
  salesOrderNumberViaLine: string | null;
  directManufacturingOrderId: string | null;
  directManufacturingOrderNumber: string | null;
  manufacturingOrderIdViaIngredient: string | null;
  manufacturingOrderNumberViaIngredient: string | null;
  manufacturingOrderIdViaBatch: string | null;
  manufacturingOrderNumberViaBatch: string | null;
  stocktakeId: string | null;
  stocktakeName: string | null;
}) {
  if (row.directPurchaseOrderId || row.purchaseOrderIdViaLine) {
    const id = row.directPurchaseOrderId ?? row.purchaseOrderIdViaLine;
    const label =
      row.directPurchaseOrderNumber ?? row.purchaseOrderNumberViaLine ?? id ?? "Purchase order";

    return {
      id,
      type: "purchase_order" as const,
      label,
      href: getSourceDocumentHref("purchase_order", id, row.itemType, row.itemId),
    };
  }

  if (row.directSalesOrderId || row.salesOrderIdViaLine) {
    const id = row.directSalesOrderId ?? row.salesOrderIdViaLine;
    const label =
      row.directSalesOrderNumber ?? row.salesOrderNumberViaLine ?? id ?? "Sales order";

    return {
      id,
      type: "sales_order" as const,
      label,
      href: getSourceDocumentHref("sales_order", id, row.itemType, row.itemId),
    };
  }

  if (
    row.directManufacturingOrderId ||
    row.manufacturingOrderIdViaIngredient ||
    row.manufacturingOrderIdViaBatch
  ) {
    const id =
      row.directManufacturingOrderId ??
      row.manufacturingOrderIdViaIngredient ??
      row.manufacturingOrderIdViaBatch;
    const label =
      row.directManufacturingOrderNumber ??
      row.manufacturingOrderNumberViaIngredient ??
      row.manufacturingOrderNumberViaBatch ??
      id ??
      "Manufacturing order";

    return {
      id,
      type: "manufacturing_order" as const,
      label,
      href: getSourceDocumentHref("manufacturing_order", id, row.itemType, row.itemId),
    };
  }

  if (row.stocktakeId) {
    return {
      id: row.stocktakeId,
      type: "stocktake" as const,
      label: row.stocktakeName ?? row.stocktakeId,
      href: getSourceDocumentHref("stocktake", row.stocktakeId, row.itemType, row.itemId),
    };
  }

  if (row.referenceType === "item") {
    return {
      id: row.itemId,
      type: "item" as const,
      label: "Item detail",
      href: getSourceDocumentHref("item", row.itemId, row.itemType, row.itemId),
    };
  }

  if (row.referenceType === "seed") {
    return {
      id: null,
      type: "seed" as const,
      label: "Seed",
      href: null,
    };
  }

  return null;
}

async function resolveItemFilterLabel(
  tx: Parameters<Parameters<typeof withAuthedOrgContext>[0]>[0],
  itemId: string
) {
  const [row] = await tx
    .select({
      itemId: items.id,
      itemName: items.name,
      itemType: items.itemType,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(items)
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(eq(items.id, itemId));

  if (!row) {
    return null;
  }

  return resolveItemDisplayName({
    itemName: row.itemName,
    masterName: row.masterName,
    masterVariantAxes: (row.masterVariantAxes as string[] | null) ?? null,
    variantAttrs: (row.variantAttrs as Record<string, string> | null) ?? null,
  });
}

async function resolveDocumentFilterLabel(
  tx: Parameters<Parameters<typeof withAuthedOrgContext>[0]>[0],
  filters: InventoryLedgerFilters
) {
  if (!filters.documentType || !filters.documentId) {
    return null;
  }

  switch (filters.documentType) {
    case "purchase_order": {
      const [row] = await tx
        .select({ label: purchaseOrders.orderNumber })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, filters.documentId));
      return row?.label ?? filters.documentId;
    }
    case "sales_order": {
      const [row] = await tx
        .select({ label: salesOrders.orderNumber })
        .from(salesOrders)
        .where(eq(salesOrders.id, filters.documentId));
      return row?.label ?? filters.documentId;
    }
    case "manufacturing_order": {
      const [row] = await tx
        .select({ label: manufacturingOrders.orderNumber })
        .from(manufacturingOrders)
        .where(eq(manufacturingOrders.id, filters.documentId));
      return row?.label ?? filters.documentId;
    }
    case "stocktake": {
      const [row] = await tx
        .select({ label: stocktakes.name })
        .from(stocktakes)
        .where(eq(stocktakes.id, filters.documentId));
      return row?.label ?? filters.documentId;
    }
    case "item":
      return resolveItemFilterLabel(tx, filters.documentId);
    case "seed":
      return "Seed";
  }
}

export async function getInventoryLedger(
  filters: InventoryLedgerFilters
): Promise<InventoryLedgerPageData> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const where = buildLedgerWhere(filters, orgId);
    const offset = (filters.page - 1) * filters.pageSize;
    const countSelection = {
      totalCount: sql<number>`count(*)`,
    };

    const countRows = countNeedsExpandedJoins(filters)
      ? await tx
          .select(countSelection)
          .from(inventoryEvents)
          .innerJoin(items, eq(inventoryEvents.itemId, items.id))
          .leftJoin(masterItems, eq(items.parentId, masterItems.id))
          .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
          .leftJoin(actorUsers, eq(inventoryEvents.actorUserId, actorUsers.id))
          .leftJoin(
            directPurchaseOrders,
            and(
              eq(inventoryEvents.referenceType, "purchase_order"),
              eq(inventoryEvents.referenceId, directPurchaseOrders.id)
            )
          )
          .leftJoin(
            purchaseOrderLineRefs,
            and(
              eq(inventoryEvents.referenceType, "purchase_order_line"),
              eq(inventoryEvents.referenceId, purchaseOrderLineRefs.id)
            )
          )
          .leftJoin(
            purchaseOrdersViaLines,
            eq(purchaseOrderLineRefs.purchaseOrderId, purchaseOrdersViaLines.id)
          )
          .leftJoin(
            directSalesOrders,
            and(
              eq(inventoryEvents.referenceType, "sales_order"),
              eq(inventoryEvents.referenceId, directSalesOrders.id)
            )
          )
          .leftJoin(
            salesOrderLineRefs,
            and(
              eq(inventoryEvents.referenceType, "sales_order_line"),
              eq(inventoryEvents.referenceId, salesOrderLineRefs.id)
            )
          )
          .leftJoin(
            salesOrdersViaLines,
            eq(salesOrderLineRefs.salesOrderId, salesOrdersViaLines.id)
          )
          .leftJoin(
            directManufacturingOrders,
            and(
              eq(inventoryEvents.referenceType, "manufacturing_order"),
              eq(inventoryEvents.referenceId, directManufacturingOrders.id)
            )
          )
          .leftJoin(
            manufacturingIngredientRefs,
            and(
              eq(inventoryEvents.referenceType, "manufacturing_order_ingredient"),
              eq(inventoryEvents.referenceId, manufacturingIngredientRefs.id)
            )
          )
          .leftJoin(
            manufacturingOrdersViaIngredients,
            eq(
              manufacturingIngredientRefs.manufacturingOrderId,
              manufacturingOrdersViaIngredients.id
            )
          )
          .leftJoin(
            manufacturingBatchRefs,
            and(
              eq(inventoryEvents.referenceType, "manufacturing_batch"),
              eq(inventoryEvents.referenceId, manufacturingBatchRefs.id)
            )
          )
          .leftJoin(
            manufacturingOrdersViaBatches,
            eq(
              manufacturingBatchRefs.manufacturingOrderId,
              manufacturingOrdersViaBatches.id
            )
          )
          .leftJoin(
            stocktakeLineRefs,
            and(
              eq(inventoryEvents.referenceType, "stocktake_line"),
              eq(inventoryEvents.referenceId, stocktakeLineRefs.id)
            )
          )
          .leftJoin(stocktakeDocs, eq(stocktakeLineRefs.stocktakeId, stocktakeDocs.id))
          .where(where)
      : filters.lot
        ? await tx
            .select(countSelection)
            .from(inventoryEvents)
            .innerJoin(items, eq(inventoryEvents.itemId, items.id))
            .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
            .where(where)
        : await tx
            .select(countSelection)
            .from(inventoryEvents)
            .innerJoin(items, eq(inventoryEvents.itemId, items.id))
            .where(where);
    const totalCount = Number(countRows[0]?.totalCount ?? 0);
    const balanceConditions: SQL[] = [
      eq(inventoryEvents.organizationId, orgId),
      isNotNull(inventoryEvents.lotId),
      inArray(inventoryEvents.eventType, ON_HAND_EVENT_TYPES),
    ];

    if (filters.itemId) {
      balanceConditions.push(eq(inventoryEvents.itemId, filters.itemId));
    }

    const balanceRows = tx
      .select({
        eventId: inventoryEvents.id,
        onHandBefore: trimScale(sql`COALESCE(SUM(${ledgerOnHandDeltaExpr(
          inventoryEvents.eventType,
          inventoryEvents.quantity
        )}) OVER (
          PARTITION BY
            ${inventoryEvents.organizationId},
            ${inventoryEvents.locationId},
            ${inventoryEvents.itemId}
          ORDER BY ${inventoryEvents.occurredAt} ASC, ${inventoryEvents.id} ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)`).as("onHandBefore"),
        onHandAfter: trimScale(sql`SUM(${ledgerOnHandDeltaExpr(
          inventoryEvents.eventType,
          inventoryEvents.quantity
        )}) OVER (
          PARTITION BY
            ${inventoryEvents.organizationId},
            ${inventoryEvents.locationId},
            ${inventoryEvents.itemId}
          ORDER BY ${inventoryEvents.occurredAt} ASC, ${inventoryEvents.id} ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )`).as("onHandAfter"),
      })
      .from(inventoryEvents)
      .where(and(...balanceConditions))
      .as("ledger_balance_rows");

    const rows = await tx
      .select({
        id: inventoryEvents.id,
        occurredAt: inventoryEvents.occurredAt,
        eventType: inventoryEvents.eventType,
        eventSubtype: inventoryEvents.eventSubtype,
        quantity: trimScale(inventoryEvents.quantity).as("quantity"),
        onHandBefore: balanceRows.onHandBefore,
        onHandAfter: balanceRows.onHandAfter,
        extendedCost: trimScaleNullable(inventoryEvents.extendedCost).as(
          "extendedCost"
        ),
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        metadata: inventoryEvents.metadata,
        itemId: items.id,
        itemName: items.name,
        itemSku: items.sku,
        itemType: items.itemType,
        variantAttrs: items.variantAttrs,
        masterName: masterItems.name,
        masterVariantAxes: masterItems.variantAxes,
        lotId: lots.id,
        lotNumber: lots.lotNumber,
        actorUserId: inventoryEvents.actorUserId,
        actorName: actorUsers.name,
        actorEmail: actorUsers.email,
        directPurchaseOrderId: directPurchaseOrders.id,
        directPurchaseOrderNumber: directPurchaseOrders.orderNumber,
        purchaseOrderIdViaLine: purchaseOrdersViaLines.id,
        purchaseOrderNumberViaLine: purchaseOrdersViaLines.orderNumber,
        directSalesOrderId: directSalesOrders.id,
        directSalesOrderNumber: directSalesOrders.orderNumber,
        salesOrderIdViaLine: salesOrdersViaLines.id,
        salesOrderNumberViaLine: salesOrdersViaLines.orderNumber,
        directManufacturingOrderId: directManufacturingOrders.id,
        directManufacturingOrderNumber: directManufacturingOrders.orderNumber,
        manufacturingOrderIdViaIngredient: manufacturingOrdersViaIngredients.id,
        manufacturingOrderNumberViaIngredient:
          manufacturingOrdersViaIngredients.orderNumber,
        manufacturingOrderIdViaBatch: manufacturingOrdersViaBatches.id,
        manufacturingOrderNumberViaBatch: manufacturingOrdersViaBatches.orderNumber,
        stocktakeId: stocktakeDocs.id,
        stocktakeName: stocktakeDocs.name,
      })
      .from(inventoryEvents)
      .innerJoin(items, eq(inventoryEvents.itemId, items.id))
      .leftJoin(masterItems, eq(items.parentId, masterItems.id))
      .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
      .leftJoin(balanceRows, eq(balanceRows.eventId, inventoryEvents.id))
      .leftJoin(actorUsers, eq(inventoryEvents.actorUserId, actorUsers.id))
      .leftJoin(
        directPurchaseOrders,
        and(
          eq(inventoryEvents.referenceType, "purchase_order"),
          eq(inventoryEvents.referenceId, directPurchaseOrders.id)
        )
      )
      .leftJoin(
        purchaseOrderLineRefs,
        and(
          eq(inventoryEvents.referenceType, "purchase_order_line"),
          eq(inventoryEvents.referenceId, purchaseOrderLineRefs.id)
        )
      )
      .leftJoin(
        purchaseOrdersViaLines,
        eq(purchaseOrderLineRefs.purchaseOrderId, purchaseOrdersViaLines.id)
      )
      .leftJoin(
        directSalesOrders,
        and(
          eq(inventoryEvents.referenceType, "sales_order"),
          eq(inventoryEvents.referenceId, directSalesOrders.id)
        )
      )
      .leftJoin(
        salesOrderLineRefs,
        and(
          eq(inventoryEvents.referenceType, "sales_order_line"),
          eq(inventoryEvents.referenceId, salesOrderLineRefs.id)
        )
      )
      .leftJoin(
        salesOrdersViaLines,
        eq(salesOrderLineRefs.salesOrderId, salesOrdersViaLines.id)
      )
      .leftJoin(
        directManufacturingOrders,
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, directManufacturingOrders.id)
        )
      )
      .leftJoin(
        manufacturingIngredientRefs,
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryEvents.referenceId, manufacturingIngredientRefs.id)
        )
      )
      .leftJoin(
        manufacturingOrdersViaIngredients,
        eq(
          manufacturingIngredientRefs.manufacturingOrderId,
          manufacturingOrdersViaIngredients.id
        )
      )
      .leftJoin(
        manufacturingBatchRefs,
        and(
          eq(inventoryEvents.referenceType, "manufacturing_batch"),
          eq(inventoryEvents.referenceId, manufacturingBatchRefs.id)
        )
      )
      .leftJoin(
        manufacturingOrdersViaBatches,
        eq(
          manufacturingBatchRefs.manufacturingOrderId,
          manufacturingOrdersViaBatches.id
        )
      )
      .leftJoin(
        stocktakeLineRefs,
        and(
          eq(inventoryEvents.referenceType, "stocktake_line"),
          eq(inventoryEvents.referenceId, stocktakeLineRefs.id)
        )
      )
      .leftJoin(stocktakeDocs, eq(stocktakeLineRefs.stocktakeId, stocktakeDocs.id))
      .where(where)
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id))
      .limit(filters.pageSize)
      .offset(offset);

    const mappedRows: InventoryLedgerRow[] = rows.map((row) => {
      const eventType = row.eventType as InventoryEventType;
      const itemType = row.itemType as ItemType;
      const displayName = resolveItemDisplayName({
        itemName: row.itemName,
        masterName: row.masterName,
        masterVariantAxes: (row.masterVariantAxes as string[] | null) ?? null,
        variantAttrs: (row.variantAttrs as Record<string, string> | null) ?? null,
      });
      const sourceDocument = resolveSourceDocument({
        itemId: row.itemId,
        itemType,
        referenceType: row.referenceType,
        directPurchaseOrderId: row.directPurchaseOrderId,
        directPurchaseOrderNumber: row.directPurchaseOrderNumber,
        purchaseOrderIdViaLine: row.purchaseOrderIdViaLine,
        purchaseOrderNumberViaLine: row.purchaseOrderNumberViaLine,
        directSalesOrderId: row.directSalesOrderId,
        directSalesOrderNumber: row.directSalesOrderNumber,
        salesOrderIdViaLine: row.salesOrderIdViaLine,
        salesOrderNumberViaLine: row.salesOrderNumberViaLine,
        directManufacturingOrderId: row.directManufacturingOrderId,
        directManufacturingOrderNumber: row.directManufacturingOrderNumber,
        manufacturingOrderIdViaIngredient: row.manufacturingOrderIdViaIngredient,
        manufacturingOrderNumberViaIngredient:
          row.manufacturingOrderNumberViaIngredient,
        manufacturingOrderIdViaBatch: row.manufacturingOrderIdViaBatch,
        manufacturingOrderNumberViaBatch: row.manufacturingOrderNumberViaBatch,
        stocktakeId: row.stocktakeId,
        stocktakeName: row.stocktakeName,
      });
      const actor =
        row.actorUserId != null
          ? {
              id: row.actorUserId,
              name: row.actorName ?? row.actorEmail ?? row.actorUserId,
              email: row.actorEmail ?? "",
            }
          : null;

      return {
        id: row.id,
        occurredAt: row.occurredAt,
        item: {
          id: row.itemId,
          name: row.itemName,
          displayName,
          sku: row.itemSku,
          itemType,
          href: itemDetailHref(itemType, row.itemId),
        },
        eventClass: getInventoryLedgerEventClass(eventType),
        eventType,
        eventSubtype: row.eventSubtype,
        eventLabel: formatInventoryLedgerEventLabel(eventType),
        quantity: row.quantity,
        signedQuantity: getSignedInventoryLedgerQuantity(eventType, row.quantity),
        onHandBefore: row.onHandBefore,
        onHandAfter: row.onHandAfter,
        balanceDimension: getInventoryLedgerBalanceDimension(eventType),
        lot:
          row.lotId && row.lotNumber
            ? {
                id: row.lotId,
                number: row.lotNumber,
              }
            : null,
        sourceDocument,
        actor,
        extendedCost: row.extendedCost,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        metadataSummary: summarizeInventoryLedgerMetadata(
          (row.metadata as Record<string, unknown> | null) ?? null
        ),
      };
    });

    return {
      rows: mappedRows,
      page: filters.page,
      pageSize: filters.pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filters.pageSize)),
      resolvedFilters: {
        itemLabel: filters.itemId ? await resolveItemFilterLabel(tx, filters.itemId) : null,
        documentLabel: await resolveDocumentFilterLabel(tx, filters),
      },
    };
  });
}

export async function getInventoryLedgerActorOptions(): Promise<
  InventoryLedgerActorOption[]
> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const rows = await tx
      .selectDistinct({
        id: inventoryEvents.actorUserId,
        name: actorUsers.name,
        email: actorUsers.email,
      })
      .from(inventoryEvents)
      .leftJoin(actorUsers, eq(inventoryEvents.actorUserId, actorUsers.id))
      .where(
        and(
          eq(inventoryEvents.organizationId, orgId),
          isNotNull(inventoryEvents.actorUserId)
        )
      )
      .orderBy(asc(actorUsers.name), asc(actorUsers.email));

    return rows
      .filter((row): row is { id: string; name: string | null; email: string | null } => row.id != null)
      .map((row) => ({
        id: row.id,
        name: row.name ?? row.email ?? row.id,
        email: row.email ?? "",
      }));
  });
}

export async function getInventoryLedgerItemOptions(): Promise<
  InventoryLedgerItemOption[]
> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const rows = await tx
      .selectDistinct({
        id: items.id,
        itemName: items.name,
        sku: items.sku,
        itemType: items.itemType,
        masterName: masterItems.name,
        masterVariantAxes: masterItems.variantAxes,
        variantAttrs: items.variantAttrs,
      })
      .from(inventoryEvents)
      .innerJoin(items, eq(inventoryEvents.itemId, items.id))
      .leftJoin(masterItems, eq(items.parentId, masterItems.id))
      .where(
        and(
          eq(inventoryEvents.organizationId, orgId),
          eq(items.organizationId, orgId),
          isNull(items.deletedAt)
        )
      )
      .orderBy(asc(items.name), asc(items.sku), asc(items.id));

    return rows.map((row) => ({
      id: row.id,
      displayName: resolveItemDisplayName(row),
      sku: row.sku,
      itemType: row.itemType as ItemType,
    }));
  });
}
