import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { items, stockAllocations, unitDefinitions } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import { allocationDemandAdapters, getAllocationDemandAdapter } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type {
  AllocationAssignment,
  AllocationDemandRef,
  AllocationDemandRow,
  AllocationWorkspace,
} from "./types";
import { demandKey, sourceKey } from "./types";

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

async function loadItemInTx(tx: Tx, itemId: string) {
  const masterItems = alias(items, "allocation_workspace_master_items");
  const [row] = await tx
    .select({
      id: items.id,
      name: items.name,
      variantAttrs: items.variantAttrs,
      unitName: unitDefinitions.name,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(items)
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(eq(items.id, itemId));
  if (!row) return null;
  const display = resolveVariantDisplay(
    row.name,
    row.masterName == null
      ? null
      : { name: row.masterName, variantAxes: row.masterVariantAxes },
    row.variantAttrs
  );
  return {
    itemId: row.id,
    itemName: display.masterName,
    unitName: row.unitName ?? "units",
  };
}

async function loadAssignmentsForItemInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
) {
  const rows = await tx
    .select({
      demandType: stockAllocations.demandType,
      demandId: stockAllocations.demandId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      itemId: stockAllocations.itemId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
      demandLabelSnapshot: stockAllocations.demandLabelSnapshot,
      sourceLabelSnapshot: stockAllocations.sourceLabelSnapshot,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.status, "active")
      )
    );

  return rows
    .filter(
      (row): row is typeof row & {
        demandType: AllocationAssignment["demandType"];
        sourceType: AllocationAssignment["sourceType"];
        sourceId: string;
      } =>
        row.demandType === "sales_order_line" &&
        (row.sourceType === "inventory_lot" ||
          row.sourceType === "manufacturing_order") &&
        row.sourceId != null
    )
    .map((row): AllocationAssignment => ({
      demandType: row.demandType,
      demandId: row.demandId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      itemId: row.itemId,
      quantity: row.quantity,
      status: "active",
      demandLabel: row.demandLabelSnapshot ?? row.demandId,
      sourceLabel: row.sourceLabelSnapshot ?? row.sourceId,
    }));
}

export async function getAllocationWorkspaceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    primaryDemand?: AllocationDemandRef | null;
    itemId?: string | null;
  }
): Promise<AllocationWorkspace | null> {
  const primaryDemand =
    params.primaryDemand == null
      ? null
      : await getAllocationDemandAdapter(params.primaryDemand.demandType).loadPrimaryDemandInTx(
          tx,
          {
            organizationId: params.organizationId,
            demandId: params.primaryDemand.demandId,
          }
        );
  const itemId = primaryDemand?.itemId ?? params.itemId ?? null;
  if (!itemId) return null;

  const item = await loadItemInTx(tx, itemId);
  if (!item) return null;

  const demandAdapterRows = (
    await Promise.all(
      allocationDemandAdapters.map((adapter) =>
        adapter.loadOpenDemandsForItemInTx(tx, {
          organizationId: params.organizationId,
          itemId,
        })
      )
    )
  )
    .flat()
    .sort((left, right) => {
      const dateCompare = (left.sortDate ?? "").localeCompare(right.sortDate ?? "");
      if (dateCompare !== 0) return dateCompare;
      return left.sortLabel.localeCompare(right.sortLabel, undefined, { numeric: true });
    });

  const sources = await loadAllocationSourcesForItemInTx(tx, {
    organizationId: params.organizationId,
    itemId,
    primaryDemand: params.primaryDemand ?? null,
  });
  const sourceLabels = new Map(sources.map((source) => [source.sourceKey, source.label]));
  const assignments = (await loadAssignmentsForItemInTx(tx, {
    organizationId: params.organizationId,
    itemId,
  })).map((assignment) => ({
    ...assignment,
    sourceLabel:
      sourceLabels.get(sourceKey(assignment)) ?? assignment.sourceLabel,
  }));
  const demandLabels = new Map(
    demandAdapterRows.map((row) => [demandKey(row), row.label])
  );
  assignments.forEach((assignment) => {
    assignment.demandLabel =
      demandLabels.get(demandKey(assignment)) ?? assignment.demandLabel;
  });

  const assignmentsByDemand = new Map<string, AllocationAssignment[]>();
  for (const assignment of assignments) {
    const key = demandKey(assignment);
    const current = assignmentsByDemand.get(key) ?? [];
    current.push(assignment);
    assignmentsByDemand.set(key, current);
  }

  const demands: AllocationDemandRow[] = demandAdapterRows.map((row) => {
    const key = demandKey(row);
    const rowAssignments = assignmentsByDemand.get(key) ?? [];
    const allocatedQty = roundQuantity(
      rowAssignments.reduce((sum, assignment) => sum + toQuantity(assignment.quantity), 0)
    );
    const openQty = toQuantity(row.openQty);
    const shortQty = Math.max(0, roundQuantity(openQty - allocatedQty));
    return {
      demandType: row.demandType,
      demandId: row.demandId,
      demandKey: key,
      parentDemandId: row.parentDemandId ?? null,
      itemId: row.itemId,
      itemName: row.itemName,
      unitName: row.unitName,
      label: row.label,
      contextLabel: row.contextLabel,
      requiredDate: row.requiredDate,
      openQty: quantityString(openQty),
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(shortQty),
      isPrimary:
        params.primaryDemand?.demandType === row.demandType &&
        params.primaryDemand.demandId === row.demandId,
      assignments: rowAssignments,
    };
  });

  const totals = demands.reduce(
    (acc, demand) => {
      acc.openQty = roundQuantity(acc.openQty + toQuantity(demand.openQty));
      acc.allocatedQty = roundQuantity(acc.allocatedQty + toQuantity(demand.allocatedQty));
      acc.shortQty = roundQuantity(acc.shortQty + toQuantity(demand.shortQty));
      return acc;
    },
    { openQty: 0, allocatedQty: 0, shortQty: 0 }
  );

  return {
    item,
    primaryDemand: demands.find((demand) => demand.isPrimary) ?? null,
    demands,
    sources,
    assignments,
    totals: {
      openQty: quantityString(totals.openQty),
      allocatedQty: quantityString(totals.allocatedQty),
      shortQty: quantityString(totals.shortQty),
    },
  };
}
