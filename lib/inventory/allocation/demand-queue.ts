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
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import { allocationDemandAdapters } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type { AllocationDemandType, AllocationSourceRow } from "./types";
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
        },
      ];
    });
}

async function getUntrackedOnHandSupplyInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
): Promise<DemandQueueSupplyChunk | null> {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const [row] = await tx
    .select({
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
        eq(inventoryLotBalances.locationId, location.id),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available")
      )
    );

  const quantity = toQuantity(row?.quantity);
  if (quantity <= 0) return null;

  return {
    kind: "on_hand",
    sourceType: "inventory_lot",
    sourceId: row?.sourceId ?? `untracked:${params.itemId}`,
    quantity,
    availableDate: serializeDbTimestamp(row?.receivedAt),
    label: null,
  };
}

async function getOpenPurchaseSupplyInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
): Promise<DemandQueueSupplyChunk[]> {
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
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
        eq(purchaseOrderLines.itemId, params.itemId),
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrderLines.stockQuantityOrdered} > ${purchaseOrderLines.stockQuantityReceived}`
      )
    )
    .orderBy(
      asc(purchaseOrders.expectedDate),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.id)
    );

  return rows
    .map((row) => ({
      kind: "expected_po" as const,
      sourceType: "purchase_order_line" as const,
      sourceId: row.id,
      quantity: toQuantity(row.quantity),
      availableDate: row.expectedDate,
      label: row.orderNumber,
    }))
    .filter((row) => row.quantity > 0);
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
  const demandRows = (
    await Promise.all(
      allocationDemandAdapters.map((adapter) =>
        adapter.loadOpenDemandsForItemInTx(tx, {
          organizationId: params.organizationId,
          itemId: params.itemId,
        })
      )
    )
  ).flat();

  if (demandRows.length === 0) return null;

  const sources = await loadAllocationSourcesForItemInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
  });
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  const untrackedOnHandSupply =
    lotTrackingMode === "untracked"
      ? await getUntrackedOnHandSupplyInTx(tx, {
          organizationId: params.organizationId,
          itemId: params.itemId,
        })
      : null;
  const purchaseSupply = await getOpenPurchaseSupplyInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
  });
  // Demand-queue planning uses physical/projected quantity. Expected supply =
  // open PO remaining quantity and open MO remaining output.
  const supply: DemandQueueSupplyChunk[] = [
    ...(untrackedOnHandSupply ? [untrackedOnHandSupply] : []),
    ...purchaseSupply,
    ...buildInventoryLotSupplyChunks(sources),
    ...sources
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

  const demands: DemandQueueDemandInput[] = demandRows.map((row) => ({
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
    minimumLotAgeDays: row.minimumLotAgeDays ?? null,
  }));

  const today = await getOrganizationTodayInTx(tx, params.organizationId);
  const coverage = computeDemandQueueCoverage({
    supply,
    demands,
    today,
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
      claimsBySourceKey.set(key, [
        ...(claimsBySourceKey.get(key) ?? []),
        {
          demandType: demand.demandType,
          demandId: demand.demandId,
          label: demand.label,
          contextLabel: demand.contextLabel,
          requiredDate: demand.requiredDate,
          qty: quantityString(segment.qty),
        },
      ]);
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

  const first = demandRows[0];
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

export async function getDemandQueueCoverageForItemsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemIds: string[];
    includeManufacturingDetail: boolean;
  }
): Promise<DemandQueueItemCoverage[]> {
  const coverage: DemandQueueItemCoverage[] = [];
  const itemIds = [...new Set(params.itemIds)];

  // TODO: batch-load supply and demand for all itemIds; the pure engine already
  // gives us the seam to compute each item in memory after set-based queries.
  for (const itemId of itemIds) {
    const itemCoverage = await getDemandQueueCoverageForItemInTx(tx, {
      organizationId: params.organizationId,
      itemId,
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
