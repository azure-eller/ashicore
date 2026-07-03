import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  inventoryDemandSummary,
  inventoryEvents,
  itemFamilies,
  items,
  manufacturingOrderIngredients,
  manufacturingOrders,
  organization,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
  type InventoryEventType,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { type Tx, withOrgContext } from "@/lib/db/with-org-context";
import {
  normalizeNumeric,
  parseNumberOrZero,
  roundQuantity,
  todayInTimeZone,
} from "@/lib/format";
import { projectedAvailableQty } from "@/lib/inventory/kernel/read";
import type {
  ReplenishmentContext,
  ReplenishmentDetailContext,
  ReplenishmentLeadTimeSource,
  ReplenishmentSummaryContext,
  ReplenishmentSummaryRow,
} from "./types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const DEFAULT_TIME_ZONE = "America/Denver";

const USAGE_CONSUMPTION_EVENT_TYPES = [
  "sales_consumption",
  "manufacturing_ingredient_consumption",
] as const satisfies readonly InventoryEventType[];
const USAGE_REVERSAL_EVENT_TYPES = [
  "unpick_restock",
] as const satisfies readonly InventoryEventType[];
const USAGE_EVENT_TYPES = [
  ...USAGE_CONSUMPTION_EVENT_TYPES,
  ...USAGE_REVERSAL_EVENT_TYPES,
] as const satisfies readonly InventoryEventType[];

type ReplenishmentItemRecord = {
  id: string;
  name: string;
  sku: string | null;
  stockUnitName: string | null;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  availableQty: string;
  defaultLeadTimeDays: number | null;
  minimumOrderQuantity: string | null;
};

type UsageStats = {
  used7d: number;
  used30d: number;
  used90d: number;
  daysSinceLastUsed: number | null;
};

type DemandStats = {
  manufacturing7d: number;
  manufacturing14d: number;
  manufacturing30d: number;
  directSales7d: number;
  directSales14d: number;
  directSales30d: number;
};

type IncomingPurchase = {
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  orderNumber: string;
  supplierName: string;
  itemId: string;
  purchaseQty: number;
  purchaseUnit: string;
  stockQtyEquivalent: number;
  expectedInDays: number | null;
};

type LeadTimeStats = {
  typical: number | null;
  source: ReplenishmentLeadTimeSource;
  recentSamples: number[];
};

const toNumber = parseNumberOrZero;

function quantity(value: number) {
  return roundQuantity(Math.max(0, value));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function daysBetweenDates(start: Date, end: Date) {
  const startDay = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endDay - startDay) / (24 * 60 * 60 * 1000)));
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left == null || right == null) return null;
  return Math.round((left + right) / 2);
}

function unitsForItem(item: ReplenishmentItemRecord) {
  const stock = item.stockUnitName ?? "stock unit";
  const purchase = item.purchaseUnitName ?? stock;
  const factor = toNumber(item.purchaseToStockFactor || "1") || 1;
  return {
    stock,
    purchase,
    factor,
    conversion: `1 ${purchase} = ${normalizeNumeric(factor)} ${stock}`,
  };
}

function emptyUsage(): UsageStats {
  return {
    used7d: 0,
    used30d: 0,
    used90d: 0,
    daysSinceLastUsed: null,
  };
}

function emptyDemand(): DemandStats {
  return {
    manufacturing7d: 0,
    manufacturing14d: 0,
    manufacturing30d: 0,
    directSales7d: 0,
    directSales14d: 0,
    directSales30d: 0,
  };
}

async function loadTodayInTx(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? DEFAULT_TIME_ZONE);
}

async function loadCandidateItemsInTx(tx: Tx, orgId: string) {
  return tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      stockUnitName: unitDefinitions.name,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})
      )`,
      purchaseToStockFactor: trimScaleNullable(
        sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`
      ).as("purchaseToStockFactor"),
      availableQty: projectedAvailableQty(items.organizationId, items.id).as(
        "availableQty"
      ),
      defaultLeadTimeDays: items.defaultLeadTimeDays,
      minimumOrderQuantity: trimScaleNullable(items.minimumOrderQuantity).as(
        "minimumOrderQuantity"
      ),
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        eq(items.organizationId, orgId),
        eq(items.itemType, "material"),
        isNull(items.deletedAt),
        or(
          isNotNull(items.purchaseUnitDefinitionId),
          isNotNull(items.purchaseToStockFactor),
          isNotNull(itemFamilies.purchaseUnitDefinitionId),
          isNotNull(itemFamilies.purchaseToStockFactor),
          sql`EXISTS (
            SELECT 1
            FROM purchasing.supplier_items si
            WHERE si.organization_id = ${items.organizationId}
              AND si.item_id = ${items.id}
              AND si.deleted_at IS NULL
          )`,
          sql`EXISTS (
            SELECT 1
            FROM purchasing.purchase_order_lines pol
            INNER JOIN purchasing.purchase_orders po ON po.id = pol.purchase_order_id
            WHERE po.organization_id = ${items.organizationId}
              AND pol.item_id = ${items.id}
              AND po.deleted_at IS NULL
          )`
        )
      )
    )
    .orderBy(asc(items.name), asc(items.id));
}

async function loadUsageStatsInTx(
  tx: Tx,
  itemIds: string[],
  today: string
): Promise<Map<string, UsageStats>> {
  if (itemIds.length === 0) return new Map();

  const start7d = new Date(`${addDays(today, -6)}T00:00:00.000Z`);
  const start30d = new Date(`${addDays(today, -29)}T00:00:00.000Z`);
  const start90d = new Date(`${addDays(today, -89)}T00:00:00.000Z`);

  const usageRows = await tx
    .select({
      itemId: inventoryEvents.itemId,
      used7d: trimScale(
        sql`COALESCE(SUM(CASE
          WHEN ${inventoryEvents.occurredAt} >= ${start7d}
          THEN CASE
            WHEN ${inventoryEvents.eventType} IN (${sql.join(
              USAGE_REVERSAL_EVENT_TYPES.map((eventType) => sql`${eventType}`),
              sql`, `
            )}) THEN -${inventoryEvents.quantity}
            ELSE ${inventoryEvents.quantity}
          END
          ELSE 0
        END), 0)`
      ).as("used7d"),
      used30d: trimScale(
        sql`COALESCE(SUM(CASE
          WHEN ${inventoryEvents.occurredAt} >= ${start30d}
          THEN CASE
            WHEN ${inventoryEvents.eventType} IN (${sql.join(
              USAGE_REVERSAL_EVENT_TYPES.map((eventType) => sql`${eventType}`),
              sql`, `
            )}) THEN -${inventoryEvents.quantity}
            ELSE ${inventoryEvents.quantity}
          END
          ELSE 0
        END), 0)`
      ).as("used30d"),
      used90d: trimScale(
        sql`COALESCE(SUM(CASE
          WHEN ${inventoryEvents.occurredAt} >= ${start90d}
          THEN CASE
            WHEN ${inventoryEvents.eventType} IN (${sql.join(
              USAGE_REVERSAL_EVENT_TYPES.map((eventType) => sql`${eventType}`),
              sql`, `
            )}) THEN -${inventoryEvents.quantity}
            ELSE ${inventoryEvents.quantity}
          END
          ELSE 0
        END), 0)`
      ).as("used90d"),
    })
    .from(inventoryEvents)
    .where(
      and(
        inArray(inventoryEvents.itemId, itemIds),
        inArray(inventoryEvents.eventType, USAGE_EVENT_TYPES),
        sql`${inventoryEvents.occurredAt} >= ${start90d}`
      )
    )
    .groupBy(inventoryEvents.itemId);

  const latestUseRows = await tx
    .select({
      itemId: inventoryEvents.itemId,
      lastUsedAt: sql<Date | null>`MAX(${inventoryEvents.occurredAt})`.as(
        "lastUsedAt"
      ),
    })
    .from(inventoryEvents)
    .where(
      and(
        inArray(inventoryEvents.itemId, itemIds),
        inArray(inventoryEvents.eventType, USAGE_CONSUMPTION_EVENT_TYPES)
      )
    )
    .groupBy(inventoryEvents.itemId);

  const stats = new Map<string, UsageStats>();
  for (const row of usageRows) {
    stats.set(row.itemId, {
      used7d: quantity(toNumber(row.used7d)),
      used30d: quantity(toNumber(row.used30d)),
      used90d: quantity(toNumber(row.used90d)),
      daysSinceLastUsed: null,
    });
  }

  for (const row of latestUseRows) {
    const existing = stats.get(row.itemId) ?? emptyUsage();
    stats.set(row.itemId, {
      ...existing,
      daysSinceLastUsed: row.lastUsedAt
        ? daysBetween(row.lastUsedAt.toISOString().slice(0, 10), today)
        : null,
    });
  }

  return stats;
}

async function loadDemandStatsInTx(
  tx: Tx,
  itemIds: string[],
  today: string
): Promise<Map<string, DemandStats>> {
  if (itemIds.length === 0) return new Map();

  const horizon = addDays(today, 30);
  const demandByItem = new Map<string, DemandStats>();

  const manufacturingDemandRows = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      plannedDate: manufacturingOrders.plannedDate,
      quantity: trimScale(
        sql`GREATEST(${manufacturingOrderIngredients.plannedQuantity} - ${manufacturingOrderIngredients.pickedQuantity}, 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrderIngredients.itemId, itemIds),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNotNull(manufacturingOrders.plannedDate),
        sql`${manufacturingOrders.plannedDate} <= ${horizon}`,
        sql`${manufacturingOrderIngredients.plannedQuantity} > ${manufacturingOrderIngredients.pickedQuantity}`
      )
    );

  for (const row of manufacturingDemandRows) {
    if (!row.plannedDate) continue;
    const days = daysBetween(today, row.plannedDate);
    const qty = toNumber(row.quantity);
    const stats = demandByItem.get(row.itemId) ?? emptyDemand();
    if (days <= 7) stats.manufacturing7d = quantity(stats.manufacturing7d + qty);
    if (days <= 14) stats.manufacturing14d = quantity(stats.manufacturing14d + qty);
    stats.manufacturing30d = quantity(stats.manufacturing30d + qty);
    demandByItem.set(row.itemId, stats);
  }

  const directSalesDemandRows = await tx
    .select({
      itemId: salesOrderLines.itemId,
      requestedDate: salesOrders.requestedDate,
      quantity: trimScale(inventoryDemandSummary.quantity).as("quantity"),
    })
    .from(inventoryDemandSummary)
    .innerJoin(
      salesOrderLines,
      eq(inventoryDemandSummary.referenceId, salesOrderLines.id)
    )
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(inventoryDemandSummary.itemId, itemIds),
        eq(inventoryDemandSummary.referenceType, "sales_order_line"),
        eq(salesOrders.status, "open"),
        isNull(salesOrders.deletedAt),
        isNotNull(salesOrders.requestedDate),
        sql`${salesOrders.requestedDate} <= ${horizon}`,
        sql`${inventoryDemandSummary.quantity} > 0`
      )
    );

  for (const row of directSalesDemandRows) {
    if (!row.requestedDate) continue;
    const days = daysBetween(today, row.requestedDate);
    const qty = toNumber(row.quantity);
    const stats = demandByItem.get(row.itemId) ?? emptyDemand();
    if (days <= 7) stats.directSales7d = quantity(stats.directSales7d + qty);
    if (days <= 14) stats.directSales14d = quantity(stats.directSales14d + qty);
    stats.directSales30d = quantity(stats.directSales30d + qty);
    demandByItem.set(row.itemId, stats);
  }

  return demandByItem;
}

async function loadIncomingPurchasesInTx(
  tx: Tx,
  itemIds: string[],
  today: string
): Promise<Map<string, IncomingPurchase[]>> {
  if (itemIds.length === 0) return new Map();

  const rows = await tx
    .select({
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderLineId: purchaseOrderLines.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierName: purchaseOrders.supplierName,
      expectedDate: purchaseOrders.expectedDate,
      itemId: purchaseOrderLines.itemId,
      purchaseQty: trimScale(
        sql`GREATEST(${purchaseOrderLines.quantityOrdered} - ${purchaseOrderLines.quantityReceived}, 0)`
      ).as("purchaseQty"),
      purchaseUnit: purchaseOrderLines.purchaseUnitName,
      stockQtyEquivalent: trimScale(
        sql`GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}, 0)`
      ).as("stockQtyEquivalent"),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrderLines.itemId, itemIds),
        inArray(purchaseOrders.status, ["not_received", "partial"]),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrderLines.stockQuantityOrdered} > ${purchaseOrderLines.stockQuantityReceived}`
      )
    )
    .orderBy(
      asc(purchaseOrders.expectedDate),
      asc(documentNumberSortSql(purchaseOrders.orderNumber, "PO")),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.id)
    );

  const byItem = new Map<string, IncomingPurchase[]>();
  for (const row of rows) {
    const entries = byItem.get(row.itemId) ?? [];
    entries.push({
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderLineId: row.purchaseOrderLineId,
      orderNumber: row.orderNumber,
      supplierName: row.supplierName,
      itemId: row.itemId,
      purchaseQty: quantity(toNumber(row.purchaseQty)),
      purchaseUnit: row.purchaseUnit,
      stockQtyEquivalent: quantity(toNumber(row.stockQtyEquivalent)),
      expectedInDays: row.expectedDate ? daysBetween(today, row.expectedDate) : null,
    });
    byItem.set(row.itemId, entries);
  }

  return byItem;
}

async function loadLeadTimesInTx(
  tx: Tx,
  itemsList: ReplenishmentItemRecord[]
): Promise<Map<string, LeadTimeStats>> {
  const itemIds = itemsList.map((item) => item.id);
  if (itemIds.length === 0) return new Map();

  const rows = await tx
    .select({
      itemId: purchaseOrderLines.itemId,
      orderedAt: purchaseOrders.orderedAt,
      createdAt: purchaseOrders.createdAt,
      receivedAt: purchaseOrders.receivedAt,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrderLines.itemId, itemIds),
        isNull(purchaseOrders.deletedAt),
        isNotNull(purchaseOrders.receivedAt),
        sql`${purchaseOrderLines.stockQuantityReceived} > 0`
      )
    )
    .orderBy(desc(purchaseOrders.receivedAt), desc(purchaseOrders.id));

  const samplesByItem = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.receivedAt) continue;
    const samples = samplesByItem.get(row.itemId) ?? [];
    if (samples.length >= 5) continue;
    samples.push(daysBetweenDates(row.orderedAt ?? row.createdAt, row.receivedAt));
    samplesByItem.set(row.itemId, samples);
  }

  const leadTimes = new Map<string, LeadTimeStats>();
  for (const item of itemsList) {
    const recentSamples = samplesByItem.get(item.id) ?? [];
    if (recentSamples.length > 0) {
      leadTimes.set(item.id, {
        typical: median(recentSamples),
        source: "recent_receipts",
        recentSamples,
      });
      continue;
    }

    leadTimes.set(item.id, {
      typical: item.defaultLeadTimeDays,
      source: item.defaultLeadTimeDays == null ? "unknown" : "item_default",
      recentSamples: [],
    });
  }

  return leadTimes;
}

function demandWindowTotals(stats: DemandStats) {
  return {
    required7d: quantity(stats.manufacturing7d + stats.directSales7d),
    required14d: quantity(stats.manufacturing14d + stats.directSales14d),
    required30d: quantity(stats.manufacturing30d + stats.directSales30d),
  };
}

function incoming30d(entries: IncomingPurchase[]) {
  return quantity(
    entries.reduce((sum, entry) => {
      if (entry.expectedInDays == null || entry.expectedInDays > 30) return sum;
      return sum + entry.stockQtyEquivalent;
    }, 0)
  );
}

function nextIncomingDays(entries: IncomingPurchase[]) {
  const dated = entries
    .map((entry) => entry.expectedInDays)
    .filter((value): value is number => value != null);
  if (dated.length === 0) return null;
  return Math.min(...dated);
}

function summaryRow(args: {
  item: ReplenishmentItemRecord;
  usage: UsageStats;
  demand: DemandStats;
  incoming: IncomingPurchase[];
  leadTime: LeadTimeStats;
  includeSku: boolean;
}): ReplenishmentSummaryRow {
  const units = unitsForItem(args.item);
  const required = demandWindowTotals(args.demand);

  return {
    itemId: args.item.id,
    item: args.item.name,
    ...(args.includeSku && args.item.sku ? { sku: args.item.sku } : {}),
    units: `stock: ${units.stock}; purchase: ${units.purchase}; ${units.conversion}`,
    available: quantity(toNumber(args.item.availableQty)),
    used7d: args.usage.used7d,
    used30d: args.usage.used30d,
    used90d: args.usage.used90d,
    ...required,
    incoming30dStockEquivalent: incoming30d(args.incoming),
    nextIncomingDays: nextIncomingDays(args.incoming),
    typicalLeadTimeDays: args.leadTime.typical,
    daysSinceLastUsed: args.usage.daysSinceLastUsed,
  };
}

function detailContext(args: {
  item: ReplenishmentItemRecord;
  usage: UsageStats;
  demand: DemandStats;
  incoming: IncomingPurchase[];
  leadTime: LeadTimeStats;
  includeSku: boolean;
}): ReplenishmentDetailContext {
  const units = unitsForItem(args.item);
  const required = demandWindowTotals(args.demand);
  const minimumOrderQuantity = toNumber(args.item.minimumOrderQuantity);

  return {
    view: "detail",
    itemId: args.item.id,
    item: args.item.name,
    ...(args.includeSku && args.item.sku ? { sku: args.item.sku } : {}),
    units: {
      stock: units.stock,
      purchase: units.purchase,
      conversion: units.conversion,
    },
    availableStock: quantity(toNumber(args.item.availableQty)),
    usedStockUnits: {
      last7d: args.usage.used7d,
      last30d: args.usage.used30d,
      last90d: args.usage.used90d,
    },
    requiredStockUnits: {
      next7d: required.required7d,
      next14d: required.required14d,
      next30d: required.required30d,
    },
    requiredDemandSources: {
      manufacturingIngredientDemand: quantity(args.demand.manufacturing30d),
      directSalesDemand: quantity(args.demand.directSales30d),
    },
    incomingPurchases: args.incoming.map((entry) => ({
      purchaseOrderId: entry.purchaseOrderId,
      purchaseOrderLineId: entry.purchaseOrderLineId,
      orderNumber: entry.orderNumber,
      supplierName: entry.supplierName,
      purchaseQty: entry.purchaseQty,
      purchaseUnit: entry.purchaseUnit,
      stockQtyEquivalent: entry.stockQtyEquivalent,
      expectedInDays: entry.expectedInDays,
    })),
    leadTimeDays: args.leadTime,
    ...(minimumOrderQuantity > 0
      ? {
          purchaseRules: {
            minimum: `${normalizeNumeric(minimumOrderQuantity)} ${units.purchase}`,
          },
        }
      : {}),
    daysSinceLastUsed: args.usage.daysSinceLastUsed,
  };
}

function skuDisambiguation(itemsList: ReplenishmentItemRecord[]) {
  const counts = new Map<string, number>();
  for (const item of itemsList) {
    const name = item.name.toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set(
    itemsList
      .filter((item) => (counts.get(item.name.toLocaleLowerCase()) ?? 0) > 1)
      .map((item) => item.id)
  );
}

function findDetailItem(itemsList: ReplenishmentItemRecord[], itemQuery: string) {
  const query = itemQuery.trim().toLocaleLowerCase();
  if (!query) {
    throw new Error("Detail view requires an item name, SKU, or item id.");
  }

  const exact = itemsList.filter(
    (item) =>
      item.id.toLocaleLowerCase() === query ||
      item.name.toLocaleLowerCase() === query ||
      item.sku?.toLocaleLowerCase() === query
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Multiple replenishment items match "${itemQuery}". Use a more specific item id or SKU.`
    );
  }

  const partial = itemsList.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(query) ||
      item.sku?.toLocaleLowerCase().includes(query)
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Multiple replenishment items match "${itemQuery}". Use a more specific item id or SKU.`
    );
  }

  throw new Error(`No replenishment item matches "${itemQuery}".`);
}

export async function getAgentReplenishmentContextForOrg(
  orgId: string,
  options: {
    view?: "summary" | "detail";
    item?: string;
    limit?: number;
  } = {}
): Promise<ReplenishmentContext> {
  return withOrgContext(orgId, async (tx) => {
    const view = options.view ?? "summary";
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const today = await loadTodayInTx(tx, orgId);
    const candidates = await loadCandidateItemsInTx(tx, orgId);
    const itemIds = candidates.map((item) => item.id);
    const includeSkuForItem = skuDisambiguation(candidates);

    const usageByItem = await loadUsageStatsInTx(tx, itemIds, today);
    const demandByItem = await loadDemandStatsInTx(tx, itemIds, today);
    const incomingByItem = await loadIncomingPurchasesInTx(tx, itemIds, today);
    const leadTimeByItem = await loadLeadTimesInTx(tx, candidates);

    if (view === "detail") {
      const item = findDetailItem(candidates, options.item ?? "");
      return detailContext({
        item,
        usage: usageByItem.get(item.id) ?? emptyUsage(),
        demand: demandByItem.get(item.id) ?? emptyDemand(),
        incoming: incomingByItem.get(item.id) ?? [],
        leadTime: leadTimeByItem.get(item.id) ?? {
          typical: null,
          source: "unknown",
          recentSamples: [],
        },
        includeSku: includeSkuForItem.has(item.id),
      });
    }

    const rows = candidates.slice(0, limit).map((item) =>
      summaryRow({
        item,
        usage: usageByItem.get(item.id) ?? emptyUsage(),
        demand: demandByItem.get(item.id) ?? emptyDemand(),
        incoming: incomingByItem.get(item.id) ?? [],
        leadTime: leadTimeByItem.get(item.id) ?? {
          typical: null,
          source: "unknown",
          recentSamples: [],
        },
        includeSku: includeSkuForItem.has(item.id),
      })
    );

    return {
      view: "summary",
      returnedCount: rows.length,
      totalCandidateCount: candidates.length,
      truncated: candidates.length > rows.length,
      items: rows,
    } satisfies ReplenishmentSummaryContext;
  });
}
