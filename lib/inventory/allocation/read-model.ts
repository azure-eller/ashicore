import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  itemFamilies,
  items,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import { allocationDemandAdapters, getAllocationDemandAdapter } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type {
  AllocationAssignment,
  AllocationDemandRef,
  AllocationDemandType,
  AllocationDemandRow,
  AllocationSourceClaim,
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

function aggregateSourceClaims(claims: AllocationSourceClaim[]) {
  const claimsByKey = new Map<string, AllocationSourceClaim>();

  for (const claim of claims) {
    const demandIdentity =
      claim.demandType === "manufacturing_order_ingredient"
        ? claim.href ?? claim.demandLabel
        : claim.demandId;
    const key = [
      claim.demandType,
      demandIdentity,
      claim.sourceType,
      claim.sourceId,
      claim.itemId,
    ].join(":");
    const existing = claimsByKey.get(key);
    if (!existing) {
      claimsByKey.set(key, claim);
      continue;
    }

    claimsByKey.set(key, {
      ...existing,
      quantity: quantityString(toQuantity(existing.quantity) + toQuantity(claim.quantity)),
    });
  }

  return [...claimsByKey.values()];
}

function isPrimaryDemand(
  assignment: AllocationAssignment,
  primaryDemandIdsByType: Map<AllocationDemandType, Set<string>>
) {
  return primaryDemandIdsByType.get(assignment.demandType)?.has(assignment.demandId) ?? false;
}

function applySyntheticAssignmentsToSources(
  sources: AllocationWorkspace["sources"],
  syntheticAssignments: AllocationAssignment[],
  primaryDemandIdsByType: Map<AllocationDemandType, Set<string>>
) {
  if (syntheticAssignments.length === 0) return sources;

  const syntheticBySource = new Map<string, number>();
  const currentSyntheticBySource = new Map<string, number>();

  for (const assignment of syntheticAssignments) {
    const key = sourceKey(assignment);
    const qty = toQuantity(assignment.quantity);
    syntheticBySource.set(key, roundQuantity((syntheticBySource.get(key) ?? 0) + qty));
    if (isPrimaryDemand(assignment, primaryDemandIdsByType)) {
      currentSyntheticBySource.set(
        key,
        roundQuantity((currentSyntheticBySource.get(key) ?? 0) + qty)
      );
    }
  }

  return sources.map((source) => {
    const syntheticQty = syntheticBySource.get(source.sourceKey) ?? 0;
    const currentSyntheticQty = currentSyntheticBySource.get(source.sourceKey) ?? 0;
    if (syntheticQty <= 0 && currentSyntheticQty <= 0) return source;

    const allocatedQty = roundQuantity(toQuantity(source.allocatedQty) + syntheticQty);
    const currentPrimaryQty = roundQuantity(
      toQuantity(source.currentPrimaryQty) + currentSyntheticQty
    );
    const totalQty = toQuantity(source.totalQty);
    const freeQty = Math.max(
      0,
      roundQuantity(totalQty - Math.max(0, allocatedQty - currentPrimaryQty))
    );

    return {
      ...source,
      allocatedQty: quantityString(allocatedQty),
      currentPrimaryQty: quantityString(currentPrimaryQty),
      freeQty: quantityString(freeQty),
      maxQtyForPrimaryDemand: quantityString(freeQty),
    };
  });
}

async function loadItemInTx(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({
      id: items.id,
      name: items.name,
      familyName: itemFamilies.name,
      unitName: unitDefinitions.name,
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(eq(items.id, itemId));
  if (!row) return null;

  const displayNames = await getItemDisplayNamesByIdInTx(tx, [itemId]);
  return {
    itemId: row.id,
    itemName: displayNames.get(row.id) ?? row.familyName ?? row.name,
    unitName: row.unitName ?? "units",
  };
}

async function loadAssignmentsForItemInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
) {
  const allocationOrderLineRefs = alias(
    salesOrderLines,
    "allocation_assignment_sales_order_line_refs"
  );
  const allocationOrderRefs = alias(salesOrders, "allocation_assignment_sales_order_refs");
  const allocationManufacturingIngredientRefs = alias(
    manufacturingOrderIngredients,
    "allocation_assignment_manufacturing_ingredient_refs"
  );
  const allocationManufacturingOrderRefs = alias(
    manufacturingOrders,
    "allocation_assignment_manufacturing_order_refs"
  );

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
      salesOrderIdFromLine: allocationOrderRefs.id,
      salesOrderNumberFromLine: allocationOrderRefs.orderNumber,
      manufacturingOrderId: allocationManufacturingOrderRefs.id,
      manufacturingOrderNumber: allocationManufacturingOrderRefs.orderNumber,
    })
    .from(stockAllocations)
    .leftJoin(
      allocationOrderLineRefs,
      and(
        eq(stockAllocations.demandType, "sales_order_line"),
        eq(stockAllocations.demandId, allocationOrderLineRefs.id)
      )
    )
    .leftJoin(allocationOrderRefs, eq(allocationOrderLineRefs.salesOrderId, allocationOrderRefs.id))
    .leftJoin(
      allocationManufacturingIngredientRefs,
      and(
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        eq(stockAllocations.demandId, allocationManufacturingIngredientRefs.id)
      )
    )
    .leftJoin(
      allocationManufacturingOrderRefs,
      eq(
        allocationManufacturingIngredientRefs.manufacturingOrderId,
        allocationManufacturingOrderRefs.id
      )
    )
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
        (row.demandType === "sales_order_line" ||
          row.demandType === "manufacturing_order_ingredient") &&
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
      demandLabel:
        row.demandLabelSnapshot ??
        row.salesOrderNumberFromLine ??
        row.manufacturingOrderNumber ??
        row.demandId,
      sourceLabel: row.sourceLabelSnapshot ?? row.sourceId,
      salesOrderId: row.salesOrderIdFromLine ?? null,
      href:
        row.salesOrderIdFromLine
          ? `/sales/order/${row.salesOrderIdFromLine}`
          : row.manufacturingOrderId
            ? `/manufacturing/order/${row.manufacturingOrderId}`
            : null,
    }));
}

async function loadProductionClaimsForItemInTx(
  tx: Tx,
  params: { organizationId: string; itemId: string }
) {
  const rows = await tx
    .select({
      demandId: stockAllocations.demandId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      itemId: stockAllocations.itemId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
      sourceLabelSnapshot: stockAllocations.sourceLabelSnapshot,
      manufacturingOrderId: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      plannedDate: manufacturingOrders.plannedDate,
    })
    .from(stockAllocations)
    .innerJoin(
      manufacturingOrderIngredients,
      eq(stockAllocations.demandId, manufacturingOrderIngredients.id)
    )
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        eq(stockAllocations.status, "active"),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    );

  return rows
    .filter(
      (row): row is typeof row & {
        sourceType: AllocationSourceClaim["sourceType"];
        sourceId: string;
      } =>
        (row.sourceType === "inventory_lot" ||
          row.sourceType === "manufacturing_order") &&
        row.sourceId != null
    )
    .map(
      (row): AllocationSourceClaim => ({
        demandType: "manufacturing_order_ingredient",
        demandId: row.demandId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        itemId: row.itemId,
        quantity: row.quantity,
        status: "active",
        demandLabel: row.orderNumber,
        contextLabel: row.productName,
        requiredDate: row.plannedDate,
        href: `/manufacturing/order/${row.manufacturingOrderId}`,
        sourceLabel: row.sourceLabelSnapshot ?? row.sourceId,
      })
    );
}

async function loadLinkedManufacturingAssignmentsForItemInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    demandRows: Array<{
      demandType: AllocationDemandType;
      demandId: string;
      parentDemandId?: string | null;
      salesOrderId?: string | null;
      label: string;
      openQty: string;
    }>;
    existingAssignments: AllocationAssignment[];
    sourceLabels: Map<`${AllocationAssignment["sourceType"]}:${string}`, string>;
  }
) {
  const salesDemandRows = params.demandRows.filter(
    (row) => row.demandType === "sales_order_line"
  );
  if (salesDemandRows.length === 0) return [];

  const demandRowsById = new Map(salesDemandRows.map((row) => [row.demandId, row]));
  const existingAllocatedByDemand = new Map<string, number>();
  const existingSourceKeysByDemand = new Map<string, Set<string>>();

  for (const assignment of params.existingAssignments) {
    if (assignment.demandType !== "sales_order_line") continue;

    const qty = toQuantity(assignment.quantity);
    existingAllocatedByDemand.set(
      assignment.demandId,
      roundQuantity((existingAllocatedByDemand.get(assignment.demandId) ?? 0) + qty)
    );

    const sourceKeys = existingSourceKeysByDemand.get(assignment.demandId) ?? new Set<string>();
    sourceKeys.add(sourceKey(assignment));
    existingSourceKeysByDemand.set(assignment.demandId, sourceKeys);
  }

  const rows = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productName: manufacturingOrders.productName,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      remainingExpectedQty: trimScale(sql`GREATEST(
        ${manufacturingOrders.plannedQuantity} - COALESCE(${manufacturingOrders.actualQuantity}, 0),
        0
      )`).as("remainingExpectedQty"),
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, params.organizationId),
        eq(manufacturingOrders.productId, params.itemId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        inArray(manufacturingOrders.salesOrderLineId, salesDemandRows.map((row) => row.demandId))
      )
    );

  const assignments: AllocationAssignment[] = [];
  for (const row of rows) {
    if (!row.salesOrderLineId) continue;
    const demand = demandRowsById.get(row.salesOrderLineId);
    if (!demand) continue;

    const linkedSourceKey = sourceKey({
      sourceType: "manufacturing_order",
      sourceId: row.id,
    });
    if (existingSourceKeysByDemand.get(row.salesOrderLineId)?.has(linkedSourceKey)) {
      continue;
    }

    const remainingDemand = roundQuantity(
      toQuantity(demand.openQty) - (existingAllocatedByDemand.get(row.salesOrderLineId) ?? 0)
    );
    const quantity = Math.min(remainingDemand, toQuantity(row.remainingExpectedQty));
    if (quantity <= 0) continue;

    existingAllocatedByDemand.set(
      row.salesOrderLineId,
      roundQuantity((existingAllocatedByDemand.get(row.salesOrderLineId) ?? 0) + quantity)
    );

    assignments.push({
      demandType: "sales_order_line",
      demandId: row.salesOrderLineId,
      sourceType: "manufacturing_order",
      sourceId: row.id,
      itemId: params.itemId,
      quantity: quantityString(quantity),
      status: "active",
      sourceLabel: params.sourceLabels.get(linkedSourceKey) ?? row.orderNumber,
      demandLabel: demand.label,
      salesOrderId: demand.salesOrderId ?? demand.parentDemandId ?? null,
      href:
        demand.salesOrderId || demand.parentDemandId
          ? `/sales/order/${demand.salesOrderId ?? demand.parentDemandId}`
          : null,
    });
  }

  return assignments;
}

export async function getAllocationWorkspaceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    primaryDemand?: AllocationDemandRef | null;
    primaryDemands?: AllocationDemandRef[] | null;
    itemId?: string | null;
    includeManufacturingDemand?: boolean;
  }
): Promise<AllocationWorkspace | null> {
  const primaryDemandRefs =
    params.primaryDemands && params.primaryDemands.length > 0
      ? params.primaryDemands
      : params.primaryDemand
        ? [params.primaryDemand]
        : [];
  const primaryDemandRows = (
    await Promise.all(
      primaryDemandRefs.map((primaryDemand) =>
        getAllocationDemandAdapter(primaryDemand.demandType).loadPrimaryDemandInTx(
          tx,
          {
            organizationId: params.organizationId,
            demandId: primaryDemand.demandId,
          }
        )
      )
    )
  ).filter((row): row is NonNullable<typeof row> => row != null);
  const primaryDemand = primaryDemandRows[0] ?? null;
  const itemId = primaryDemand?.itemId ?? params.itemId ?? null;
  if (!itemId) return null;
  if (primaryDemandRows.some((row) => row.itemId !== itemId)) return null;
  const primaryDemandIdsByType = new Map<AllocationDemandType, Set<string>>();
  for (const row of primaryDemandRows) {
    const ids = primaryDemandIdsByType.get(row.demandType) ?? new Set<string>();
    ids.add(row.demandId);
    primaryDemandIdsByType.set(row.demandType, ids);
  }

  const item = await loadItemInTx(tx, itemId);
  if (!item) return null;

  let demandAdapterRows = (
    await Promise.all(
      allocationDemandAdapters
        .filter(
          (adapter) =>
            params.includeManufacturingDemand !== false ||
            adapter.demandType !== "manufacturing_order_ingredient"
        )
        .map((adapter) =>
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
  for (const row of primaryDemandRows) {
    if (!demandAdapterRows.some((demandRow) => demandKey(demandRow) === demandKey(row))) {
      demandAdapterRows = [row, ...demandAdapterRows];
    }
  }

  let sources = await loadAllocationSourcesForItemInTx(tx, {
    organizationId: params.organizationId,
    itemId,
    primaryDemand: params.primaryDemand ?? null,
    primaryDemands: primaryDemandRows.map((row) => ({
      demandType: row.demandType,
      demandId: row.demandId,
    })),
  });
  const sourceLabels = new Map(sources.map((source) => [source.sourceKey, source.label]));
  const persistedAssignments = (await loadAssignmentsForItemInTx(tx, {
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
  persistedAssignments.forEach((assignment) => {
    assignment.demandLabel =
      demandLabels.get(demandKey(assignment)) ?? assignment.demandLabel;
  });
  const linkedManufacturingAssignments =
    await loadLinkedManufacturingAssignmentsForItemInTx(tx, {
      organizationId: params.organizationId,
      itemId,
      demandRows: demandAdapterRows,
      existingAssignments: persistedAssignments,
      sourceLabels,
    });
  linkedManufacturingAssignments.forEach((assignment) => {
    assignment.demandLabel =
      demandLabels.get(demandKey(assignment)) ?? assignment.demandLabel;
  });
  const assignments = [...persistedAssignments, ...linkedManufacturingAssignments];
  sources = applySyntheticAssignmentsToSources(
    sources,
    linkedManufacturingAssignments,
    primaryDemandIdsByType
  );
  const productionClaims = (await loadProductionClaimsForItemInTx(tx, {
    organizationId: params.organizationId,
    itemId,
  })).map((claim) => ({
    ...claim,
    sourceLabel: sourceLabels.get(sourceKey(claim)) ?? claim.sourceLabel,
  }));
  const assignmentClaims: AllocationSourceClaim[] = assignments.map((assignment) => {
    const demand = demandAdapterRows.find(
      (row) => demandKey(row) === demandKey(assignment)
    );
    return {
      ...assignment,
      contextLabel: demand?.contextLabel ?? null,
      requiredDate: demand?.requiredDate ?? null,
      href: assignment.salesOrderId
        ? `/sales/order/${assignment.salesOrderId}`
        : assignment.demandType === "sales_order_line" && demand?.parentDemandId
          ? `/sales/order/${demand.parentDemandId}`
          : assignment.href,
    };
  });
  const sourceClaims = aggregateSourceClaims([
    ...assignmentClaims,
    ...productionClaims,
  ]);

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
      salesOrderId: row.salesOrderId ?? null,
      itemId: row.itemId,
      itemName: row.itemName,
      unitName: row.unitName,
      label: row.label,
      contextLabel: row.contextLabel,
      requiredDate: row.requiredDate,
      openQty: quantityString(openQty),
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(shortQty),
      pickedQty: row.pickedQty ?? null,
      href: row.href ?? null,
      isPrimary:
        primaryDemandIdsByType.get(row.demandType)?.has(row.demandId) ?? false,
      assignments: rowAssignments,
    };
  });

  const primaryRows =
    primaryDemandRows.length > 0
      ? demands.filter((row) =>
          primaryDemandIdsByType.get(row.demandType)?.has(row.demandId)
        )
      : [];
  const aggregatePrimaryDemand =
    primaryRows.length <= 1
      ? primaryRows[0] ?? null
      : ({
          ...primaryRows[0],
          demandIds: primaryRows.map((row) => row.demandId),
          openQty: quantityString(
            primaryRows.reduce((sum, row) => sum + toQuantity(row.openQty), 0)
          ),
          allocatedQty: quantityString(
            primaryRows.reduce((sum, row) => sum + toQuantity(row.allocatedQty), 0)
          ),
          shortQty: quantityString(
            primaryRows.reduce((sum, row) => sum + toQuantity(row.shortQty), 0)
          ),
          pickedQty: quantityString(
            primaryRows.reduce((sum, row) => sum + toQuantity(row.pickedQty), 0)
          ),
          assignments: primaryRows.flatMap((row) => row.assignments),
          isPrimary: true,
        } satisfies AllocationDemandRow);

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
    primaryDemand: aggregatePrimaryDemand,
    demands,
    sources,
    assignments,
    sourceClaims,
    totals: {
      openQty: quantityString(totals.openQty),
      allocatedQty: quantityString(totals.allocatedQty),
      shortQty: quantityString(totals.shortQty),
    },
  };
}
