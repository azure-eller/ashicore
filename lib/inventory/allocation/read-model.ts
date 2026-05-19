import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  itemFamilies,
  itemVariantValues,
  items,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
  unitDefinitions,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import { allocationDemandAdapters, getAllocationDemandAdapter } from "./adapters";
import { loadAllocationSourcesForItemInTx } from "./sources";
import type {
  AllocationAssignment,
  AllocationDemandRef,
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

async function loadItemInTx(tx: Tx, itemId: string) {
  const masterItems = alias(items, "allocation_workspace_master_items");
  const [row] = await tx
    .select({
      id: items.id,
      name: items.name,
      familyName: itemFamilies.name,
      variantAttrs: items.variantAttrs,
      unitName: unitDefinitions.name,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(eq(items.id, itemId));
  if (!row) return null;

  const optionRows = await tx
    .select({
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(eq(itemVariantValues.itemId, itemId))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));
  if (row.familyName) {
    return {
      itemId: row.id,
      itemName:
        optionRows.length > 0
          ? `${row.familyName} / ${optionRows.map((option) => option.label).join(" / ")}`
          : row.familyName,
      unitName: row.unitName ?? "units",
    };
  }

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
  const allocationOrderLineRefs = alias(
    salesOrderLines,
    "allocation_assignment_sales_order_line_refs"
  );
  const allocationOrderRefs = alias(salesOrders, "allocation_assignment_sales_order_refs");
  const allocationShipmentLineRefs = alias(
    salesShipmentLines,
    "allocation_assignment_sales_shipment_line_refs"
  );
  const allocationShipmentRefs = alias(
    salesShipments,
    "allocation_assignment_sales_shipment_refs"
  );
  const allocationShipmentOrderRefs = alias(
    salesOrders,
    "allocation_assignment_sales_shipment_order_refs"
  );
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
      salesOrderIdFromShipment: allocationShipmentOrderRefs.id,
      salesOrderNumberFromShipment: allocationShipmentOrderRefs.orderNumber,
      shipmentNumber: allocationShipmentRefs.shipmentNumber,
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
      allocationShipmentLineRefs,
      and(
        eq(stockAllocations.demandType, "sales_shipment_line"),
        eq(stockAllocations.demandId, allocationShipmentLineRefs.id)
      )
    )
    .leftJoin(
      allocationShipmentRefs,
      eq(allocationShipmentLineRefs.salesShipmentId, allocationShipmentRefs.id)
    )
    .leftJoin(
      allocationShipmentOrderRefs,
      eq(allocationShipmentRefs.salesOrderId, allocationShipmentOrderRefs.id)
    )
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
          row.demandType === "sales_shipment_line" ||
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
        row.shipmentNumber ??
        row.salesOrderNumberFromShipment ??
        row.manufacturingOrderNumber ??
        row.demandId,
      sourceLabel: row.sourceLabelSnapshot ?? row.sourceId,
      salesOrderId: row.salesOrderIdFromLine ?? row.salesOrderIdFromShipment ?? null,
      href:
        row.salesOrderIdFromLine || row.salesOrderIdFromShipment
          ? `/sales/orders/${row.salesOrderIdFromLine ?? row.salesOrderIdFromShipment}`
          : row.manufacturingOrderId
            ? `/manufacturing/orders/${row.manufacturingOrderId}`
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
        href: `/manufacturing/orders/${row.manufacturingOrderId}`,
        sourceLabel: row.sourceLabelSnapshot ?? row.sourceId,
      })
    );
}

export async function getAllocationWorkspaceInTx(
  tx: Tx,
  params: {
    organizationId: string;
    primaryDemand?: AllocationDemandRef | null;
    itemId?: string | null;
    includeManufacturingDemand?: boolean;
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
  if (
    primaryDemand &&
    !demandAdapterRows.some((row) => demandKey(row) === demandKey(primaryDemand))
  ) {
    demandAdapterRows = [primaryDemand, ...demandAdapterRows];
  }

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
        ? `/sales/orders/${assignment.salesOrderId}`
        : assignment.demandType === "sales_order_line" && demand?.parentDemandId
          ? `/sales/orders/${demand.parentDemandId}`
          : assignment.href,
    };
  });
  const sourceClaimsByKey = new Map<string, AllocationSourceClaim>();
  [...assignmentClaims, ...productionClaims].forEach((claim) => {
    const key = [
      claim.demandType,
      claim.demandId,
      claim.sourceType,
      claim.sourceId,
      claim.itemId,
    ].join(":");
    if (!sourceClaimsByKey.has(key)) {
      sourceClaimsByKey.set(key, claim);
    }
  });
  const sourceClaims = [...sourceClaimsByKey.values()];

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
    sourceClaims,
    totals: {
      openQty: quantityString(totals.openQty),
      allocatedQty: quantityString(totals.allocatedQty),
      shortQty: quantityString(totals.shortQty),
    },
  };
}
