import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { inventoryLotBalances, organization, stockAllocations } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, roundQuantity, todayInTimeZone } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import { allocationDemandAdapters } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type { AllocationDemandType } from "./types";
import { compareDemandOrder, compareNullableDate } from "./priority";

// Demand-queue mode computes item-level quantity coverage from supply chunks.
// It is a pure read projection: nothing is persisted, no lot identity is chosen.
// Manufacturing-component demand claims supply before sales demand.

export type DemandQueueSupplyChunk = {
  kind: "on_hand" | "expected_mo";
  sourceType?: "inventory_lot" | "manufacturing_order";
  sourceId?: string;
  linkedDemand?: {
    demandType: AllocationDemandType;
    demandId: string;
  };
  quantity: number;
  availableDate: string | null;
  label: string | null;
};

export type DemandQueuePin = {
  demandType: AllocationDemandType;
  demandId: string;
  sourceType: "inventory_lot" | "manufacturing_order";
  sourceId: string;
  quantity: number;
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
  pinnedQty: number;
  pinnedDateValidQty: number;
  pinnedDateInvalidQty: number;
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
  | { kind: "in_stock"; qty: number }
  | { kind: "expected"; qty: number; availableDate: string | null }
  | { kind: "pinned_in_stock"; qty: number; sourceId: string }
  | {
      kind: "pinned_expected";
      qty: number;
      sourceId: string;
      availableDate: string | null;
    }
  | {
      kind: "pinned_late";
      qty: number;
      sourceId: string;
      availableDate: string | null;
    }
  | { kind: "short"; qty: number };

export type DemandQueueCoverageSegment =
  | { kind: "in_stock"; qty: string }
  | { kind: "expected"; qty: string; availableDate: string | null }
  | { kind: "pinned_in_stock"; qty: string; sourceId: string }
  | {
      kind: "pinned_expected";
      qty: string;
      sourceId: string;
      availableDate: string | null;
    }
  | {
      kind: "pinned_late";
      qty: string;
      sourceId: string;
      availableDate: string | null;
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
  if (left.kind !== right.kind) return left.kind === "on_hand" ? -1 : 1;
  return compareNullableDate(left.availableDate, right.availableDate);
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
    [segmentQty(row, ["in_stock", "pinned_in_stock"]), row.inStockQty],
    [segmentQty(row, ["expected", "pinned_expected"]), row.expectedQty],
    [
      segmentQty(row, ["pinned_in_stock", "pinned_expected", "pinned_late"]),
      row.pinnedQty,
    ],
    [
      segmentQty(row, ["pinned_in_stock", "pinned_expected"]),
      row.pinnedDateValidQty,
    ],
    [segmentQty(row, ["pinned_late"]), row.pinnedDateInvalidQty],
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
  pins?: DemandQueuePin[];
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
      pinnedQty: 0,
      pinnedDateValidQty: 0,
      pinnedDateInvalidQty: 0,
      queueCoveredQty: 0,
      earliestExpectedDate: null,
      claimedQty: 0,
      shortQty: 0,
      segments: [],
      remainingNeed: roundQuantity(Math.max(0, demand.openQty)),
    });
  }

  const pinsByDemandKey = new Map<string, DemandQueuePin[]>();
  for (const pin of params.pins ?? []) {
    const key = demandQueueCoverageKey(pin);
    const current = pinsByDemandKey.get(key) ?? [];
    current.push({ ...pin, quantity: roundQuantity(Math.max(0, pin.quantity)) });
    pinsByDemandKey.set(key, current);
  }

  const pinnedDemandKeys = new Set(pinsByDemandKey.keys());
  const sortedPinnedDemands = demands.filter((demand) =>
    pinnedDemandKeys.has(demandQueueCoverageKey(demand))
  );

  for (const demand of sortedPinnedDemands) {
    const key = demandQueueCoverageKey(demand);
    const coverage = coverageByKey.get(key);
    if (!coverage) continue;
    for (const pin of pinsByDemandKey.get(key) ?? []) {
      if (coverage.remainingNeed <= 0) break;
      if (pin.quantity <= 0) continue;
      const chunk = supply.find(
        (candidate) =>
          candidate.sourceType === pin.sourceType &&
          candidate.sourceId === pin.sourceId &&
          candidate.remaining > 0
      );
      if (!chunk) continue;
      const claim = roundQuantity(
        Math.min(coverage.remainingNeed, chunk.remaining, pin.quantity)
      );
      if (claim <= 0) continue;

      chunk.remaining = roundQuantity(chunk.remaining - claim);
      coverage.remainingNeed = roundQuantity(coverage.remainingNeed - claim);
      coverage.pinnedQty = roundQuantity(coverage.pinnedQty + claim);

      if (expectedSupplyCanCoverDemand(chunk, demand, params.today)) {
        coverage.pinnedDateValidQty = roundQuantity(
          coverage.pinnedDateValidQty + claim
        );
        if (chunk.kind === "on_hand") {
          coverage.inStockQty = roundQuantity(coverage.inStockQty + claim);
          coverage.segments.push({
            kind: "pinned_in_stock",
            qty: claim,
            sourceId: pin.sourceId,
          });
        } else {
          coverage.expectedQty = roundQuantity(coverage.expectedQty + claim);
          coverage.segments.push({
            kind: "pinned_expected",
            qty: claim,
            sourceId: pin.sourceId,
            availableDate: chunk.availableDate,
          });
          if (
            chunk.availableDate &&
            (coverage.earliestExpectedDate == null ||
              chunk.availableDate < coverage.earliestExpectedDate)
          ) {
            coverage.earliestExpectedDate = chunk.availableDate;
          }
        }
      } else {
        coverage.pinnedDateInvalidQty = roundQuantity(
          coverage.pinnedDateInvalidQty + claim
        );
        coverage.segments.push({
          kind: "pinned_late",
          qty: claim,
          sourceId: pin.sourceId,
          availableDate: chunk.availableDate,
        });
      }
    }
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
        coverage.segments.push({ kind: "in_stock", qty: claim });
      } else {
        coverage.expectedQty = roundQuantity(coverage.expectedQty + claim);
        coverage.segments.push({
          kind: "expected",
          qty: claim,
          availableDate: chunk.availableDate,
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
      pinnedQty: coverage.pinnedQty,
      pinnedDateValidQty: coverage.pinnedDateValidQty,
      pinnedDateInvalidQty: coverage.pinnedDateInvalidQty,
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

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

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
  pinnedQty: string;
  pinnedDateValidQty: string;
  pinnedDateInvalidQty: string;
  queueCoveredQty: string;
  earliestExpectedDate: string | null;
  shortQty: string;
  segments: DemandQueueCoverageSegment[];
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
  demands: DemandQueueCoverageDemand[];
};

export function demandQueueCoverageKey(ref: {
  demandType: AllocationDemandType;
  demandId: string;
}) {
  return `${ref.demandType}:${ref.demandId}` as const;
}

function isAllocationDemandType(value: string): value is AllocationDemandType {
  return (
    value === "sales_order_line" ||
    value === "manufacturing_order_ingredient"
  );
}

function isDemandQueuePinSourceType(
  value: string
): value is DemandQueuePin["sourceType"] {
  return value === "inventory_lot" || value === "manufacturing_order";
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
    })
    .from(inventoryLotBalances)
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
    sourceId: `untracked:${params.itemId}`,
    quantity,
    availableDate: row?.receivedAt?.toISOString() ?? null,
    label: null,
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
  // Demand-queue planning uses physical/projected quantity (totalQty), never the
  // manual-allocation-aware freeQty. Expected supply = open MO remaining output.
  const supply: DemandQueueSupplyChunk[] = [
    ...(untrackedOnHandSupply ? [untrackedOnHandSupply] : []),
    ...sources
      .filter(
        (source) =>
          toQuantity(source.totalQty) > 0 &&
          (source.sourceType === "inventory_lot" || source.canAllocate)
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

  const demandKeys = new Set(demands.map((demand) => demandQueueCoverageKey(demand)));
  const pinRows = await tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.status, "active")
      )
    );
  const pins: DemandQueuePin[] = pinRows
    .filter(
      (
        row
      ): row is typeof row & {
        demandType: AllocationDemandType;
        sourceType: DemandQueuePin["sourceType"];
        sourceId: string;
      } =>
        isAllocationDemandType(row.demandType) &&
        isDemandQueuePinSourceType(row.sourceType) &&
        row.sourceId != null &&
        demandKeys.has(
          demandQueueCoverageKey({
            demandType: row.demandType,
            demandId: row.demandId,
          })
        )
    )
    .map((row) => ({
      demandType: row.demandType,
      demandId: row.demandId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      quantity: toQuantity(row.quantity),
    }));
  const linkedManufacturingPins: DemandQueuePin[] = supply.flatMap((chunk) =>
    chunk.sourceType === "manufacturing_order" &&
    chunk.sourceId &&
    chunk.linkedDemand &&
    demandKeys.has(demandQueueCoverageKey(chunk.linkedDemand))
      ? [
          {
            demandType: chunk.linkedDemand.demandType,
            demandId: chunk.linkedDemand.demandId,
            sourceType: "manufacturing_order" as const,
            sourceId: chunk.sourceId,
            quantity: chunk.quantity,
          },
        ]
      : []
  );

  const today = await getOrganizationTodayInTx(tx, params.organizationId);
  const coverage = computeDemandQueueCoverage({
    supply,
    demands,
    pins: [...pins, ...linkedManufacturingPins],
    today,
  });

  const onHandQty = supply
    .filter((chunk) => chunk.kind === "on_hand")
    .reduce((sum, chunk) => sum + chunk.quantity, 0);
  const expectedSupplyQty = supply
    .filter((chunk) => chunk.kind === "expected_mo")
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
      pinnedQty: quantityString(row.pinnedQty),
      pinnedDateValidQty: quantityString(row.pinnedDateValidQty),
      pinnedDateInvalidQty: quantityString(row.pinnedDateInvalidQty),
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
