import { roundQuantity } from "@/lib/format";
import type { AllocationDemandType } from "./types";
import { compareDemandOrder, compareNullableDate } from "./priority";

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
  latestExpectedDate: string | null;
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

type SupplyCoverageTiming =
  | {
      kind: "in_stock";
      availableDate: null;
    }
  | {
      kind: "expected";
      availableDate: string | null;
    };

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

function getSupplyCoverageTiming(
  supply: DemandQueueSupplyChunk,
  demand: DemandQueueDemandInput,
  today: string
): SupplyCoverageTiming | null {
  const minimumLotAgeDays = demand.minimumLotAgeDays ?? null;
  if (minimumLotAgeDays != null) {
    if (supply.availableDate == null) return null;
    const requiredBy = sourceDate(demand.requiredDate ?? today);
    const matureDate = addDays(sourceDate(supply.availableDate), minimumLotAgeDays);
    if (matureDate > requiredBy) return null;
    if (supply.kind === "on_hand" && matureDate <= today) {
      return { kind: "in_stock", availableDate: null };
    }
    return { kind: "expected", availableDate: matureDate };
  }

  if (supply.kind === "on_hand") {
    return { kind: "in_stock", availableDate: null };
  }
  if (supply.availableDate == null) {
    return demand.requiredDate == null
      ? { kind: "expected", availableDate: null }
      : null;
  }
  if (demand.requiredDate != null && supply.availableDate > demand.requiredDate) {
    return null;
  }
  return { kind: "expected", availableDate: supply.availableDate };
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
  const rows: DemandQueueCoverageRow[] = [];

  for (const demand of demands) {
    const coverage: DemandQueueCoverageState = {
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
      latestExpectedDate: null,
      claimedQty: 0,
      shortQty: 0,
      segments: [],
      remainingNeed: roundQuantity(Math.max(0, demand.openQty)),
    };

    for (const chunk of supply) {
      if (coverage.remainingNeed <= 0) break;
      if (chunk.remaining <= 0) continue;
      if (!supplyLinkedToDemand(chunk, demand)) continue;
      const timing = getSupplyCoverageTiming(chunk, demand, params.today);
      if (!timing) continue;
      const claim = roundQuantity(Math.min(coverage.remainingNeed, chunk.remaining));
      if (claim <= 0) continue;

      chunk.remaining = roundQuantity(chunk.remaining - claim);
      coverage.remainingNeed = roundQuantity(coverage.remainingNeed - claim);

      if (timing.kind === "in_stock") {
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
          availableDate: timing.availableDate,
          sourceType: chunk.sourceType,
          sourceId: chunk.sourceId,
          sourceLabel: chunk.label,
        });
        if (
          timing.availableDate &&
          (coverage.earliestExpectedDate == null ||
            timing.availableDate < coverage.earliestExpectedDate)
        ) {
          coverage.earliestExpectedDate = timing.availableDate;
        }
        if (
          timing.availableDate &&
          (coverage.latestExpectedDate == null ||
            timing.availableDate > coverage.latestExpectedDate)
        ) {
          coverage.latestExpectedDate = timing.availableDate;
        }
      }
      coverage.queueCoveredQty = roundQuantity(coverage.queueCoveredQty + claim);
    }

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
      latestExpectedDate: coverage.latestExpectedDate,
      claimedQty,
      shortQty,
      segments:
        shortQty > 0
          ? [...coverage.segments, { kind: "short", qty: shortQty }]
          : coverage.segments,
    };
    assertCoverageSegmentsMatchTotals(row);
    rows.push(row);
  }

  return rows;
}

export function demandQueueCoverageKey(ref: {
  demandType: AllocationDemandType;
  demandId: string;
}) {
  return `${ref.demandType}:${ref.demandId}` as const;
}
