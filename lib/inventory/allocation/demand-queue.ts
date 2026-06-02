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
import type { AllocationDemandType } from "./types";
import { compareDemandOrder, compareNullableDate } from "./priority";

// Demand-queue mode computes item-level quantity coverage from supply chunks.
// It is a pure read projection: nothing is persisted, no lot identity is chosen.
// Manufacturing-component demand claims supply before sales demand.

export type DemandQueueSupplyChunk = {
  kind: "on_hand" | "expected_mo" | "expected_po";
  sourceType?: "inventory_lot" | "manufacturing_order" | "purchase_order_line";
  sourceId?: string;
  linkedDemand?: {
    demandType: AllocationDemandType;
    demandId: string;
  };
  quantity: number;
  availableDate: string | null;
  label: string | null;
};

export type DemandQueueDemandInput = {
  demandType: AllocationDemandType;
  demandId: string;
  itemId: string;
  itemName: string;
  unitName: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  href: string | null;
  openQty: number;
  priorityRank: number | null;
  priorityDate: string | null;
  priorityLabel: string;
  minimumLotAgeDays?: number | null;
};

export type DemandQueueCoverageRow = {
  demandType: AllocationDemandType;
  demandId: string;
  label: string;
  contextLabel: string | null;
  requiredDate: string | null;
  href: string | null;
  openQty: number;
  inStockQty: number;
  expectedQty: number;
  queueCoveredQty: number;
  earliestExpectedDate: string | null;
  claimedQty: number;
  shortQty: number;
  segments: CoverageSegment[];
};

type DemandQueueCoverageState = DemandQueueCoverageRow & {
  remainingNeed: number;
};

export type CoverageSegment =
  | {
      kind: "in_stock";
      qty: number;
      sourceType?: DemandQueueSupplyChunk["sourceType"];
      sourceId?: string;
      sourceLabel?: string | null;
    }
  | {
      kind: "expected";
      qty: number;
      availableDate: string | null;
      sourceType?: DemandQueueSupplyChunk["sourceType"];
      sourceId?: string;
      sourceLabel?: string | null;
    }
  | { kind: "short"; qty: number };

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

function compareSupplyOrder(
  left: DemandQueueSupplyChunk,
  right: DemandQueueSupplyChunk
) {
  // On-hand is consumed before expected supply; expected supply earliest-first.
  if (left.kind === "on_hand" && right.kind !== "on_hand") return -1;
  if (left.kind !== "on_hand" && right.kind === "on_hand") return 1;
  const dateCompare = compareNullableDate(left.availableDate, right.availableDate);
  if (dateCompare !== 0) return dateCompare;
  return left.kind.localeCompare(right.kind);
}

function expectedSupplyCanCoverDemand(
  supply: DemandQueueSupplyChunk,
  demand: DemandQueueDemandInput,
  today: string
) {
  const minimumLotAgeDays = demand.minimumLotAgeDays ?? null;
  if (minimumLotAgeDays != null) {
    if (supply.availableDate == null) return false;
    return addDays(sourceDate(supply.availableDate), minimumLotAgeDays) <= today;
  }

  if (supply.kind === "on_hand") return true;
  if (supply.availableDate == null) return demand.requiredDate == null;
  if (demand.requiredDate == null) return true;
  return supply.availableDate <= demand.requiredDate;
}

function supplyLinkedToDemand(
  supply: DemandQueueSupplyChunk,
  demand: DemandQueueDemandInput
) {
  return (
    supply.linkedDemand == null ||
    (supply.linkedDemand.demandType === demand.demandType &&
      supply.linkedDemand.demandId === demand.demandId)
  );
}

function segmentQty(row: DemandQueueCoverageRow, kinds: CoverageSegment["kind"][]) {
  const allowed = new Set(kinds);
  return roundQuantity(
    row.segments.reduce(
      (sum, segment) => sum + (allowed.has(segment.kind) ? segment.qty : 0),
      0
    )
  );
}

function assertCoverageSegmentsMatchTotals(row: DemandQueueCoverageRow) {
  const checks = [
    [segmentQty(row, ["in_stock"]), row.inStockQty],
    [segmentQty(row, ["expected"]), row.expectedQty],
    [segmentQty(row, ["in_stock", "expected"]), row.queueCoveredQty],
    [segmentQty(row, ["short"]), row.shortQty],
  ];
  if (checks.some(([left, right]) => roundQuantity(left - right) !== 0)) {
    throw new Error(
      `Demand queue coverage segment totals diverged for ${row.demandType}:${row.demandId}.`
    );
  }
}

function sourceDate(value: string) {
  return value.slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeDemandQueueCoverage(params: {
  supply: DemandQueueSupplyChunk[];
  demands: DemandQueueDemandInput[];
  today: string;
}): DemandQueueCoverageRow[] {
  const supply = params.supply
    .map((chunk) => ({ ...chunk, remaining: roundQuantity(Math.max(0, chunk.quantity)) }))
    .filter((chunk) => chunk.remaining > 0)
    .sort(compareSupplyOrder);
  const demands = [...params.demands].sort(compareDemandOrder);
  const coverageByKey = new Map<string, DemandQueueCoverageState>();
  for (const demand of demands) {
    coverageByKey.set(demandQueueCoverageKey(demand), {
      demandType: demand.demandType,
      demandId: demand.demandId,
      label: demand.label,
      contextLabel: demand.contextLabel,
      requiredDate: demand.requiredDate,
      href: demand.href,
      openQty: roundQuantity(Math.max(0, demand.openQty)),
      inStockQty: 0,
      expectedQty: 0,
      queueCoveredQty: 0,
      earliestExpectedDate: null,
      claimedQty: 0,
      shortQty: 0,
      segments: [],
      remainingNeed: roundQuantity(Math.max(0, demand.openQty)),
    });
  }

  for (const demand of demands) {
    const coverage = coverageByKey.get(demandQueueCoverageKey(demand));
    if (!coverage) continue;
    for (const chunk of supply) {
      if (coverage.remainingNeed <= 0) break;
      if (chunk.remaining <= 0) continue;
      if (!supplyLinkedToDemand(chunk, demand)) continue;
      if (!expectedSupplyCanCoverDemand(chunk, demand, params.today)) continue;
      const claim = roundQuantity(Math.min(coverage.remainingNeed, chunk.remaining));
      if (claim <= 0) continue;

      chunk.remaining = roundQuantity(chunk.remaining - claim);
      coverage.remainingNeed = roundQuantity(coverage.remainingNeed - claim);

      if (chunk.kind === "on_hand") {
        coverage.inStockQty = roundQuantity(coverage.inStockQty + claim);
        coverage.segments.push({
          kind: "in_stock",
          qty: claim,
          sourceType: chunk.sourceType,
          sourceId: chunk.sourceId,
          sourceLabel: chunk.label,
        });
      } else {
        coverage.expectedQty = roundQuantity(coverage.expectedQty + claim);
        coverage.segments.push({
          kind: "expected",
          qty: claim,
          availableDate: chunk.availableDate,
          sourceType: chunk.sourceType,
          sourceId: chunk.sourceId,
          sourceLabel: chunk.label,
        });
        if (
          chunk.availableDate &&
          (coverage.earliestExpectedDate == null ||
            chunk.availableDate < coverage.earliestExpectedDate)
        ) {
          coverage.earliestExpectedDate = chunk.availableDate;
        }
      }
      coverage.queueCoveredQty = roundQuantity(coverage.queueCoveredQty + claim);
    }
  }

  return demands.map((demand) => {
    const coverage = coverageByKey.get(demandQueueCoverageKey(demand))!;
    const claimedQty = roundQuantity(coverage.inStockQty + coverage.expectedQty);
    const shortQty = roundQuantity(Math.max(0, demand.openQty - claimedQty));
    const row: DemandQueueCoverageRow = {
      demandType: coverage.demandType,
      demandId: coverage.demandId,
      label: coverage.label,
      contextLabel: coverage.contextLabel,
      requiredDate: coverage.requiredDate,
      href: coverage.href,
      openQty: coverage.openQty,
      inStockQty: coverage.inStockQty,
      expectedQty: coverage.expectedQty,
      queueCoveredQty: coverage.queueCoveredQty,
      earliestExpectedDate: coverage.earliestExpectedDate,
      claimedQty,
      shortQty,
      segments:
        shortQty > 0
          ? [...coverage.segments, { kind: "short", qty: shortQty }]
          : coverage.segments,
    };
    assertCoverageSegmentsMatchTotals(row);
    return row;
  });
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

export function demandQueueCoverageKey(ref: {
  demandType: AllocationDemandType;
  demandId: string;
}) {
  return `${ref.demandType}:${ref.demandId}` as const;
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
    await Promise.all([
      ...allocationDemandAdapters.map((adapter) =>
        adapter.loadOpenDemandsForItemInTx(tx, {
          organizationId: params.organizationId,
          itemId: params.itemId,
        })
      ),
    ])
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
    ...sources
      .filter(
        (source) => toQuantity(source.totalQty) > 0
      )
      .map((source) => ({
        kind: (source.sourceType === "inventory_lot"
          ? "on_hand"
          : "expected_mo") as DemandQueueSupplyChunk["kind"],
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
