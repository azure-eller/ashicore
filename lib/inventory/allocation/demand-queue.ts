import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  organization,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { serializeDbTimestamp } from "@/lib/db/timestamps";
import { roundQuantity, todayInTimeZone } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import {
  allocationQuantityString,
  toAllocationQuantity,
} from "@/lib/inventory/allocation/format";
import {
  getDefaultInventoryLocationInTx,
  INTERNAL_UNTRACKED_LOT_NUMBER,
} from "@/lib/inventory/kernel";
import { getItemLotTrackingModesByItemIdInTx } from "@/lib/inventory/lot-tracking";
import { allocationDemandAdapters } from "./adapters";
import {
  loadAllocationSourcesForItemsInTx,
  loadLinkedSalesOrderLineIdsByLotIdInTx,
} from "./sources";
import type {
  AllocationDemandAdapterRow,
  AllocationDemandType,
  AllocationSourceRow,
} from "./types";
import {
  computeDemandQueueCoverage,
  demandQueueCoverageKey,
  type CoverageSegment,
  type DemandQueueDemandInput,
  type DemandQueueSupplyChunk,
} from "./coverage-engine";

// Demand-queue mode computes item-level quantity coverage from supply chunks.
// It is a pure read projection: nothing is persisted, no lot identity is chosen.
// Manufacturing-component demand claims supply before sales demand.

export { computeDemandQueueCoverage, demandQueueCoverageKey } from "./coverage-engine";
export type {
  CoverageSegment,
  DemandQueueCoverageRow,
  DemandQueueDemandInput,
  DemandQueueSupplyChunk,
} from "./coverage-engine";

export type DemandQueueCoverageSegment =
  | {
      kind: "in_stock";
      qty: string;
      sourceType?: DemandQueueSupplyChunk["sourceType"];
      sourceId?: string;
      sourceLabel?: string | null;
    }
  | {
      kind: "expected";
      qty: string;
      availableDate: string | null;
      sourceType?: DemandQueueSupplyChunk["sourceType"];
      sourceId?: string;
      sourceLabel?: string | null;
    }
  | { kind: "short"; qty: string };

function serializeCoverageSegment(
  segment: CoverageSegment
): DemandQueueCoverageSegment {
  return { ...segment, qty: quantityString(segment.qty) };
}

async function getOrganizationTodayInTx(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? "America/Denver");
}

const toQuantity = toAllocationQuantity;
const quantityString = allocationQuantityString;

const DEMAND_TYPE_LABELS: Record<AllocationDemandType, string> = {
  manufacturing_order_ingredient: "Manufacturing",
  sales_order_line: "Sales order",
};
const DEMAND_QUEUE_ITEM_ID_WARNING_THRESHOLD = 1000;

export type DemandQueueCoverageDemand = {
  demandType: AllocationDemandType;
  demandId: string;
  typeLabel: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  href: string | null;
  requiredQty: string;
  inStockQty: string;
  expectedQty: string;
  queueCoveredQty: string;
  earliestExpectedDate: string | null;
  latestExpectedDate: string | null;
  shortQty: string;
  segments: DemandQueueCoverageSegment[];
};

export type DemandQueueSourceClaim = {
  demandType: AllocationDemandType;
  demandId: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  qty: string;
};

export type DemandQueueSupplySource = {
  sourceType: NonNullable<DemandQueueSupplyChunk["sourceType"]>;
  sourceId: string;
  label: string | null;
  date: string | null;
  totalQty: string;
  claimedQty: string;
  availableQty: string;
  claims: DemandQueueSourceClaim[];
};

export type DemandQueueItemCoverage = {
  itemId: string;
  itemName: string;
  unitName: string;
  onHandQty: string;
  expectedQty: string;
  claimedByManufacturingQty: string;
  sellableQty: string;
  shortQty: string;
  sources: DemandQueueSupplySource[];
  demands: DemandQueueCoverageDemand[];
};

export type DemandQueueInventoryLotClaimConflict = {
  demandType: AllocationDemandType;
  demandId: string;
  label: string;
  contextLabel: string | null;
  quantity: number;
  href: string | null;
};

export function getDemandQueueInventoryLotClaimConflicts(params: {
  coverage: DemandQueueItemCoverage | undefined;
  excludeDemand: {
    demandType: AllocationDemandType;
    demandId: string;
  };
  quantity: number;
}): DemandQueueInventoryLotClaimConflict[] {
  let remainingConflictQty = roundQuantity(Math.max(0, params.quantity));
  if (!params.coverage || remainingConflictQty <= 0) return [];

  const conflicts: DemandQueueInventoryLotClaimConflict[] = [];
  for (const demand of params.coverage.demands) {
    if (
      demand.demandType === params.excludeDemand.demandType &&
      demand.demandId === params.excludeDemand.demandId
    ) {
      continue;
    }

    const inventoryLotQty = roundQuantity(
      demand.segments.reduce(
        (sum, segment) =>
          segment.kind !== "short" && segment.sourceType === "inventory_lot"
            ? roundQuantity(sum + toQuantity(segment.qty))
            : sum,
        0
      )
    );
    const quantity = roundQuantity(
      Math.min(remainingConflictQty, inventoryLotQty)
    );
    if (quantity <= 0) continue;

    remainingConflictQty = roundQuantity(remainingConflictQty - quantity);
    conflicts.push({
      demandType: demand.demandType,
      demandId: demand.demandId,
      label: demand.label,
      contextLabel: demand.contextLabel,
      quantity,
      href: demand.href,
    });

    if (remainingConflictQty <= 0) break;
  }

  return conflicts;
}

function buildInventoryLotSupplyChunks(sources: AllocationSourceRow[]) {
  let negativeDebtQty = roundQuantity(
    sources
      .filter((source) => source.sourceType === "inventory_lot")
      .reduce(
        (sum, source) => sum + Math.min(0, toQuantity(source.totalQty)),
        0
      )
  );
  negativeDebtQty = Math.abs(negativeDebtQty);

  return sources
    .filter((source) => source.sourceType === "inventory_lot")
    .flatMap((source): DemandQueueSupplyChunk[] => {
      let quantity = toQuantity(source.totalQty);
      if (quantity <= 0) return [];

      if (negativeDebtQty > 0) {
        const debtApplied = Math.min(quantity, negativeDebtQty);
        quantity = roundQuantity(quantity - debtApplied);
        negativeDebtQty = roundQuantity(negativeDebtQty - debtApplied);
      }

      if (quantity <= 0) return [];

      return [
        {
          kind: "on_hand",
          sourceType: "inventory_lot",
          sourceId: source.sourceId,
          quantity,
          availableDate: source.date,
          label: source.label,
          linkedDemand: source.linkedSalesOrderLineId
            ? {
                demandType: "sales_order_line" as const,
                demandId: source.linkedSalesOrderLineId,
              }
            : undefined,
        },
      ];
    });
}

async function getUntrackedOnHandSupplyForItemsInTx(
  tx: Tx,
  params: { organizationId: string; locationId: string; itemIds: string[] }
): Promise<Map<string, DemandQueueSupplyChunk[]>> {
  const itemIds = [...new Set(params.itemIds)].filter(Boolean);
  const supplyByItemId = new Map<string, DemandQueueSupplyChunk[]>();
  if (itemIds.length === 0) return supplyByItemId;

  const totals = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "quantity"
      ),
      receivedAt: sql<Date | null>`MIN(${inventoryLotBalances.receivedAt})`.as(
        "receivedAt"
      ),
      sourceId: sql<string | null>`COALESCE(
        MAX(${inventoryLotBalances.lotId}::text) FILTER (WHERE ${lots.lotNumber} = ${INTERNAL_UNTRACKED_LOT_NUMBER}),
        MIN(${inventoryLotBalances.lotId}::text)
      )`.as("sourceId"),
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .groupBy(inventoryLotBalances.itemId)
    .orderBy(asc(inventoryLotBalances.itemId));

  const lotRows = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      lotId: inventoryLotBalances.lotId,
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(
      asc(inventoryLotBalances.itemId),
      asc(inventoryLotBalances.receivedAt),
      asc(inventoryLotBalances.lotId)
    );
  const linkedSalesOrderLineIdByLotId = await loadLinkedSalesOrderLineIdsByLotIdInTx(
    tx,
    {
      organizationId: params.organizationId,
      lotIds: lotRows.map((row) => row.lotId),
    }
  );
  const linkedLotRowsByItemId = groupByItemId(
    lotRows.filter((row) => linkedSalesOrderLineIdByLotId.has(row.lotId))
  );

  for (const row of totals) {
    let remainingQuantity = toQuantity(row.quantity);
    if (remainingQuantity <= 0) continue;

    const chunks: DemandQueueSupplyChunk[] = [];
    for (const lot of linkedLotRowsByItemId.get(row.itemId) ?? []) {
      if (remainingQuantity <= 0) break;
      const linkedQuantity = roundQuantity(
        Math.min(remainingQuantity, toQuantity(lot.quantity))
      );
      if (linkedQuantity <= 0) continue;
      const salesOrderLineId = linkedSalesOrderLineIdByLotId.get(lot.lotId);
      if (!salesOrderLineId) continue;

      chunks.push({
        kind: "on_hand",
        sourceType: "inventory_lot",
        sourceId: lot.lotId,
        quantity: linkedQuantity,
        availableDate: serializeDbTimestamp(lot.receivedAt),
        label: null,
        linkedDemand: {
          demandType: "sales_order_line",
          demandId: salesOrderLineId,
        },
      });
      remainingQuantity = roundQuantity(remainingQuantity - linkedQuantity);
    }

    if (remainingQuantity > 0) {
      chunks.push({
        kind: "on_hand",
        sourceType: "inventory_lot",
        sourceId: row.sourceId ?? `untracked:${row.itemId}`,
        quantity: remainingQuantity,
        availableDate: serializeDbTimestamp(row.receivedAt),
        label: null,
      });
    }

    supplyByItemId.set(row.itemId, chunks);
  }

  return supplyByItemId;
}

async function getOpenPurchaseSupplyForItemsInTx(
  tx: Tx,
  params: { organizationId: string; itemIds: string[] }
): Promise<Map<string, DemandQueueSupplyChunk[]>> {
  const itemIds = [...new Set(params.itemIds)].filter(Boolean);
  const supplyByItemId = new Map<string, DemandQueueSupplyChunk[]>();
  if (itemIds.length === 0) return supplyByItemId;

  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      orderNumber: purchaseOrders.orderNumber,
      expectedDate: purchaseOrders.expectedDate,
      quantity: trimScale(
        sql`GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}, 0)`
      ).as("quantity"),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        eq(purchaseOrders.organizationId, params.organizationId),
        inArray(purchaseOrderLines.itemId, itemIds),
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrderLines.stockQuantityOrdered} > ${purchaseOrderLines.stockQuantityReceived}`
      )
    )
    .orderBy(
      asc(purchaseOrderLines.itemId),
      asc(purchaseOrders.expectedDate),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.id)
    );

  for (const row of rows) {
    const chunk = {
      kind: "expected_po" as const,
      sourceType: "purchase_order_line" as const,
      sourceId: row.id,
      quantity: toQuantity(row.quantity),
      availableDate: row.expectedDate,
      label: row.orderNumber,
    };
    if (chunk.quantity <= 0) continue;
    const bucket = supplyByItemId.get(row.itemId);
    if (bucket) {
      bucket.push(chunk);
    } else {
      supplyByItemId.set(row.itemId, [chunk]);
    }
  }

  return supplyByItemId;
}

function groupByItemId<T extends { itemId: string }>(rows: T[]) {
  const byItemId = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byItemId.get(row.itemId);
    if (bucket) {
      bucket.push(row);
    } else {
      byItemId.set(row.itemId, [row]);
    }
  }
  return byItemId;
}

function buildDemandQueueItemCoverage(params: {
  itemId: string;
  demandRows: AllocationDemandAdapterRow[];
  sources: AllocationSourceRow[];
  untrackedOnHandSupply: DemandQueueSupplyChunk[];
  purchaseSupply: DemandQueueSupplyChunk[];
  today: string;
  includeManufacturingDetail: boolean;
}): DemandQueueItemCoverage | null {
  if (params.demandRows.length === 0) return null;

  // Demand-queue planning uses physical/projected quantity. Expected supply =
  // open PO remaining quantity and open MO remaining output.
  const supply: DemandQueueSupplyChunk[] = [
    ...params.untrackedOnHandSupply,
    ...params.purchaseSupply,
    ...buildInventoryLotSupplyChunks(params.sources),
    ...params.sources
      .filter(
        (source) => source.sourceType === "manufacturing_order" && toQuantity(source.totalQty) > 0
      )
      .map((source) => ({
        kind: "expected_mo" as DemandQueueSupplyChunk["kind"],
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        quantity: toQuantity(source.totalQty),
        availableDate: source.date,
        label: source.label,
        linkedDemand:
          source.sourceType === "manufacturing_order" && source.linkedSalesOrderLineId
            ? {
                demandType: "sales_order_line" as const,
                demandId: source.linkedSalesOrderLineId,
              }
            : undefined,
      })),
  ];

  const demands: DemandQueueDemandInput[] = params.demandRows.map((row) => ({
    demandType: row.demandType,
    demandId: row.demandId,
    itemId: row.itemId,
    itemName: row.itemName,
    unitName: row.unitName,
    label: row.label,
    contextLabel: row.contextLabel,
    requiredDate: row.requiredDate,
    href: row.href ?? null,
    openQty: toQuantity(row.openQty),
    priorityRank: row.priorityRank,
    priorityDate: row.priorityDate,
    priorityLabel: row.priorityLabel,
    supplyPolicy: row.supplyPolicy ?? "any",
    minimumLotAgeDays: row.minimumLotAgeDays ?? null,
  }));

  const coverage = computeDemandQueueCoverage({
    supply,
    demands,
    today: params.today,
  });

  const onHandQty = supply
    .filter((chunk) => chunk.kind === "on_hand")
    .reduce((sum, chunk) => sum + chunk.quantity, 0);
  const expectedSupplyQty = supply
    .filter((chunk) => chunk.kind === "expected_mo" || chunk.kind === "expected_po")
    .reduce((sum, chunk) => sum + chunk.quantity, 0);
  const claimedByManufacturing = coverage
    .filter((row) => row.demandType === "manufacturing_order_ingredient")
    .reduce((sum, row) => sum + row.claimedQty, 0);
  const totalSupply = onHandQty + expectedSupplyQty;
  const visibleCoverage = coverage.filter(
    (row) =>
      params.includeManufacturingDetail ||
      row.demandType !== "manufacturing_order_ingredient"
  );
  const claimsBySourceKey = new Map<string, DemandQueueSourceClaim[]>();
  for (const demand of visibleCoverage) {
    for (const segment of demand.segments) {
      if (segment.kind === "short") continue;
      if (!segment.sourceType || !segment.sourceId) continue;
      const key = `${segment.sourceType}:${segment.sourceId}`;
      const claim = {
        demandType: demand.demandType,
        demandId: demand.demandId,
        label: demand.label,
        contextLabel: demand.contextLabel,
        requiredDate: demand.requiredDate,
        qty: quantityString(segment.qty),
      };
      const claims = claimsBySourceKey.get(key);
      if (claims) {
        claims.push(claim);
      } else {
        claimsBySourceKey.set(key, [claim]);
      }
    }
  }
  const visibleSources = supply
    .filter(
      (
        chunk
      ): chunk is DemandQueueSupplyChunk & {
        sourceType: NonNullable<DemandQueueSupplyChunk["sourceType"]>;
        sourceId: string;
      } => Boolean(chunk.sourceType && chunk.sourceId)
    )
    .map((chunk) => {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      const claims = claimsBySourceKey.get(key) ?? [];
      const claimedQty = claims.reduce(
        (sum, claim) => sum + toQuantity(claim.qty),
        0
      );

      return {
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        label: chunk.label,
        date: chunk.availableDate,
        totalQty: quantityString(chunk.quantity),
        claimedQty: quantityString(claimedQty),
        availableQty: quantityString(
          Math.max(0, roundQuantity(chunk.quantity - claimedQty))
        ),
        claims,
      };
    });
  const visibleShortTotal = visibleCoverage.reduce((sum, row) => sum + row.shortQty, 0);

  const first = params.demandRows[0];
  return {
    itemId: params.itemId,
    itemName: first.itemName,
    unitName: first.unitName,
    onHandQty: quantityString(onHandQty),
    expectedQty: quantityString(expectedSupplyQty),
    claimedByManufacturingQty: quantityString(claimedByManufacturing),
    sellableQty: quantityString(Math.max(0, totalSupply - claimedByManufacturing)),
    shortQty: quantityString(visibleShortTotal),
    sources: visibleSources,
    demands: visibleCoverage.map((row) => ({
      demandType: row.demandType,
      demandId: row.demandId,
      typeLabel: DEMAND_TYPE_LABELS[row.demandType],
      label: row.label,
      contextLabel: row.contextLabel,
      requiredDate: row.requiredDate,
      href: row.href,
      requiredQty: quantityString(row.openQty),
      inStockQty: quantityString(row.inStockQty),
      expectedQty: quantityString(row.expectedQty),
      queueCoveredQty: quantityString(row.queueCoveredQty),
      earliestExpectedDate: row.earliestExpectedDate,
      latestExpectedDate: row.latestExpectedDate,
      shortQty: quantityString(row.shortQty),
      segments: row.segments.map(serializeCoverageSegment),
    })),
  };
}

export async function getDemandQueueCoverageForItemInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    // Manufacturing demand always participates in the queue computation (it
    // claims supply and reduces sellable). This flag only controls whether
    // identifying MO detail rows (order numbers, products, dates, links) are
    // returned — gated by the viewer's manufacturing read access.
    includeManufacturingDetail: boolean;
  }
): Promise<DemandQueueItemCoverage | null> {
  return (
    (
      await getDemandQueueCoverageForItemsInTx(tx, {
        organizationId: params.organizationId,
        itemIds: [params.itemId],
        includeManufacturingDetail: params.includeManufacturingDetail,
      })
    )[0] ?? null
  );
}

export async function getDemandQueueCoverageForItemsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemIds: string[];
    includeManufacturingDetail: boolean;
  }
): Promise<DemandQueueItemCoverage[]> {
  const itemIds = [...new Set(params.itemIds)].filter(Boolean);
  if (itemIds.length === 0) return [];
  if (itemIds.length > DEMAND_QUEUE_ITEM_ID_WARNING_THRESHOLD) {
    console.warn("Demand queue coverage received a large item set.", {
      organizationId: params.organizationId,
      itemCount: itemIds.length,
      threshold: DEMAND_QUEUE_ITEM_ID_WARNING_THRESHOLD,
    });
  }

  const today = await getOrganizationTodayInTx(tx, params.organizationId);
  const location = await getDefaultInventoryLocationInTx(
    tx,
    params.organizationId
  );
  const lotTrackingModesByItemId = await getItemLotTrackingModesByItemIdInTx(
    tx,
    itemIds
  );

  const demandRows: AllocationDemandAdapterRow[] = [];
  for (const adapter of allocationDemandAdapters) {
    demandRows.push(
      ...(await adapter.loadOpenDemandsForItemsInTx(tx, {
        organizationId: params.organizationId,
        itemIds,
      }))
    );
  }

  const demandRowsByItemId = groupByItemId(demandRows);
  const itemIdsWithDemand = itemIds.filter(
    (itemId) => (demandRowsByItemId.get(itemId)?.length ?? 0) > 0
  );
  if (itemIdsWithDemand.length === 0) return [];

  const sources = await loadAllocationSourcesForItemsInTx(tx, {
    organizationId: params.organizationId,
    itemIds: itemIdsWithDemand,
    locationId: location.id,
    lotTrackingModesByItemId,
  });
  const sourcesByItemId = groupByItemId(sources);
  const untrackedOnHandSupplyByItemId = await getUntrackedOnHandSupplyForItemsInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    itemIds: itemIdsWithDemand.filter(
      (itemId) => (lotTrackingModesByItemId.get(itemId) ?? "tracked") === "untracked"
    ),
  });
  const purchaseSupplyByItemId = await getOpenPurchaseSupplyForItemsInTx(tx, {
    organizationId: params.organizationId,
    itemIds: itemIdsWithDemand,
  });

  const coverage: DemandQueueItemCoverage[] = [];
  for (const itemId of itemIdsWithDemand) {
    const itemCoverage = buildDemandQueueItemCoverage({
      itemId,
      demandRows: demandRowsByItemId.get(itemId) ?? [],
      sources: sourcesByItemId.get(itemId) ?? [],
      untrackedOnHandSupply: untrackedOnHandSupplyByItemId.get(itemId) ?? [],
      purchaseSupply: purchaseSupplyByItemId.get(itemId) ?? [],
      today,
      includeManufacturingDetail: params.includeManufacturingDetail,
    });
    if (itemCoverage) {
      coverage.push(itemCoverage);
    }
  }

  return coverage;
}

export async function getOpenManufacturingIngredientItemIdsInTx(
  tx: Tx,
  organizationId: string
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ itemId: manufacturingOrderIngredients.itemId })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .innerJoin(items, eq(manufacturingOrderIngredients.itemId, items.id))
    .where(
      and(
        eq(manufacturingOrders.organizationId, organizationId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.completedAt),
        isNull(manufacturingOrders.cancelledAt),
        eq(items.itemType, "product"),
        eq(items.sellable, true),
        sql`${manufacturingOrderIngredients.plannedQuantity} > COALESCE(${manufacturingOrderIngredients.pickedQuantity}, 0)`
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.itemId));

  return rows.map((row) => row.itemId);
}

export async function getDemandQueueCoverageByDemandKeyForItemsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemIds: string[];
    includeManufacturingDetail: boolean;
  }
): Promise<Map<ReturnType<typeof demandQueueCoverageKey>, DemandQueueCoverageDemand>> {
  const coverage = await getDemandQueueCoverageForItemsInTx(tx, params);
  const byDemandKey = new Map<
    ReturnType<typeof demandQueueCoverageKey>,
    DemandQueueCoverageDemand
  >();

  for (const item of coverage) {
    for (const demand of item.demands) {
      byDemandKey.set(demandQueueCoverageKey(demand), demand);
    }
  }

  return byDemandKey;
}
