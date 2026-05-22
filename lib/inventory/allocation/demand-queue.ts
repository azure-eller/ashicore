import "server-only";

import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { allocationDemandAdapters } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type { AllocationDemandType } from "./types";

// Demand-queue mode computes item-level quantity coverage from supply chunks.
// It is a pure read projection: nothing is persisted, no lot identity is chosen.
// Manufacturing-component demand claims supply before sales demand.

export type DemandQueueSupplyChunk = {
  kind: "on_hand" | "expected_mo";
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
  earliestExpectedDate: string | null;
  claimedQty: number;
  shortQty: number;
};

const DEMAND_GROUP_RANK: Record<AllocationDemandType, number> = {
  manufacturing_order_ingredient: 0,
  sales_shipment_line: 1,
  sales_order_line: 2,
};

function compareNullableNumber(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1; // nulls last
  if (right == null) return -1;
  return left - right;
}

function compareNullableDate(left: string | null, right: string | null) {
  if (left === right) return 0;
  if (!left) return 1; // nulls last
  if (!right) return -1;
  return left.localeCompare(right);
}

function compareDemandOrder(
  left: DemandQueueDemandInput,
  right: DemandQueueDemandInput
) {
  const groupCompare = DEMAND_GROUP_RANK[left.demandType] - DEMAND_GROUP_RANK[right.demandType];
  if (groupCompare !== 0) return groupCompare;
  const rankCompare = compareNullableNumber(left.priorityRank, right.priorityRank);
  if (rankCompare !== 0) return rankCompare;
  const dateCompare = compareNullableDate(left.priorityDate, right.priorityDate);
  if (dateCompare !== 0) return dateCompare;
  return left.priorityLabel.localeCompare(right.priorityLabel, undefined, {
    numeric: true,
  });
}

function compareSupplyOrder(
  left: DemandQueueSupplyChunk,
  right: DemandQueueSupplyChunk
) {
  // On-hand is consumed before expected supply; expected supply earliest-first.
  if (left.kind !== right.kind) return left.kind === "on_hand" ? -1 : 1;
  return compareNullableDate(left.availableDate, right.availableDate);
}

export function computeDemandQueueCoverage(params: {
  supply: DemandQueueSupplyChunk[];
  demands: DemandQueueDemandInput[];
}): DemandQueueCoverageRow[] {
  const supply = params.supply
    .map((chunk) => ({ ...chunk, remaining: roundQuantity(Math.max(0, chunk.quantity)) }))
    .filter((chunk) => chunk.remaining > 0)
    .sort(compareSupplyOrder);
  const demands = [...params.demands].sort(compareDemandOrder);

  return demands.map((demand) => {
    let remainingNeed = roundQuantity(Math.max(0, demand.openQty));
    let inStockQty = 0;
    let expectedQty = 0;
    let earliestExpectedDate: string | null = null;

    for (const chunk of supply) {
      if (remainingNeed <= 0) break;
      if (chunk.remaining <= 0) continue;
      const claim = roundQuantity(Math.min(remainingNeed, chunk.remaining));
      if (claim <= 0) continue;

      chunk.remaining = roundQuantity(chunk.remaining - claim);
      remainingNeed = roundQuantity(remainingNeed - claim);

      if (chunk.kind === "on_hand") {
        inStockQty = roundQuantity(inStockQty + claim);
      } else {
        expectedQty = roundQuantity(expectedQty + claim);
        if (
          chunk.availableDate &&
          (earliestExpectedDate == null || chunk.availableDate < earliestExpectedDate)
        ) {
          earliestExpectedDate = chunk.availableDate;
        }
      }
    }

    const claimedQty = roundQuantity(inStockQty + expectedQty);
    return {
      demandType: demand.demandType,
      demandId: demand.demandId,
      label: demand.label,
      contextLabel: demand.contextLabel,
      requiredDate: demand.requiredDate,
      href: demand.href,
      openQty: roundQuantity(Math.max(0, demand.openQty)),
      inStockQty,
      expectedQty,
      earliestExpectedDate,
      claimedQty,
      shortQty: roundQuantity(Math.max(0, demand.openQty - claimedQty)),
    };
  });
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
  sales_shipment_line: "Planned shipment",
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
  earliestExpectedDate: string | null;
  shortQty: string;
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
  // Demand-queue planning uses physical/projected quantity (totalQty), never the
  // manual-allocation-aware freeQty. Expected supply = open MO remaining output.
  const supply: DemandQueueSupplyChunk[] = sources
    .filter(
      (source) =>
        toQuantity(source.totalQty) > 0 &&
        (source.sourceType === "inventory_lot" || source.canAllocate)
    )
    .map((source) => ({
      kind: source.sourceType === "inventory_lot" ? "on_hand" : "expected_mo",
      quantity: toQuantity(source.totalQty),
      availableDate: source.sourceType === "inventory_lot" ? null : source.date,
      label: source.label,
    }));

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
  }));

  const coverage = computeDemandQueueCoverage({ supply, demands });

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
      earliestExpectedDate: row.earliestExpectedDate,
      shortQty: quantityString(row.shortQty),
    })),
  };
}
