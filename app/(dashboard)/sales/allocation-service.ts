import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  items,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  unitDefinitions,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";
import { saveAllocationsForDemandInTx } from "@/lib/inventory/allocation/commands";
import type { AllocationWorkspace } from "@/lib/inventory/allocation/types";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import type {
  SalesAllocationDemandRow,
  SalesAllocationLineSummary,
  SalesAllocationSheetData,
  SalesAllocationSource,
  SalesAllocationSourceType,
  SalesAllocationVariantOption,
} from "./types";

export type SaveSalesLineAllocationInput = {
  allocations: Array<{
    sourceType: SalesAllocationSourceType;
    sourceId: string;
    quantity: string;
  }>;
};

export class SalesAllocationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SalesAllocationError";
    this.status = status;
  }
}

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}

function getLineStatus(
  remainingQty: number,
  allocatedQty: number,
  sources: SalesAllocationLineSummary["sources"]
): SalesAllocationLineSummary["status"] {
  if (allocatedQty <= 0) return "short";
  if (roundQuantity(allocatedQty) < roundQuantity(remainingQty)) return "partial";
  return sources.some((source) => source.sourceType === "manufacturing_order")
    ? "waiting_production"
    : "ready";
}

function buildSourceSummary(sources: SalesAllocationLineSummary["sources"]) {
  if (sources.length === 0) return "\u2014";
  return sources
    .map((source) => `${quantityString(toQuantity(source.quantity))} ${source.label}`)
    .join(", ");
}

function sourceStatus(status: string): SalesAllocationSource["status"] {
  return status === "draft" || status === "released" || status === "completed"
    ? status
    : "available";
}

function workspaceToSalesReadModel(workspace: AllocationWorkspace) {
  const lineSummaries = new Map<string, SalesAllocationLineSummary>();
  const demandRows: SalesAllocationDemandRow[] = workspace.demands
    .filter((demand) => demand.demandType === "sales_order_line")
    .map((demand) => {
      const sources = demand.assignments.map((assignment) => ({
        sourceType: assignment.sourceType,
        sourceId: assignment.sourceId,
        label: assignment.sourceLabel,
        quantity: assignment.quantity,
        coverageKind: "explicit" as const,
      }));
      const remainingQty = toQuantity(demand.openQty);
      const allocatedQty = toQuantity(demand.allocatedQty);
      const sourceSummary = buildSourceSummary(sources);
      const status = getLineStatus(remainingQty, allocatedQty, sources);

      lineSummaries.set(demand.demandId, {
        salesOrderLineId: demand.demandId,
        itemId: demand.itemId,
        allocatedQty: demand.allocatedQty,
        shortQty: demand.shortQty,
        sourceSummary,
        status,
        sources,
      });

      return {
        salesOrderLineId: demand.demandId,
        salesOrderId: "",
        orderNumber: demand.label,
        orderStatus: "draft",
        customerName: demand.contextLabel ?? "",
        shipDate: demand.requiredDate,
        itemId: demand.itemId,
        itemName: demand.itemName,
        unitName: demand.unitName,
        orderedQty: demand.openQty,
        shippedQty: "0",
        cancelledQty: "0",
        remainingQty: demand.openQty,
        allocatedQty: demand.allocatedQty,
        shortQty: demand.shortQty,
        sourceSummary,
        sources,
        isTarget: demand.isPrimary,
      };
    });

  const supplySources: SalesAllocationSource[] = workspace.sources.map((source) => ({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    label: source.label,
    status: sourceStatus(source.status),
    date: source.date,
    receivedAt: source.sourceType === "inventory_lot" ? source.date : null,
    createdAt: null,
    priorityRank: null,
    lotNumber: source.sourceType === "inventory_lot" ? source.label : null,
    totalQty: source.totalQty,
    allocatedQty: source.allocatedQty,
    freeQty: source.freeQty,
    currentTargetQty: source.currentPrimaryQty,
    maxQty: source.maxQtyForPrimaryDemand,
    canAllocate: source.canAllocate,
  }));

  return {
    demandRows,
    lineSummaries,
    supplySources,
    uncoveredDemandQty: workspace.totals.shortQty,
  };
}

async function getAllocationTargetItemInTx(tx: Tx, itemId: string) {
  const masterItems = alias(items, "allocation_target_master_items");
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

async function getAllocationVariantOptionsInTx(
  tx: Tx,
  targetItemId: string
): Promise<SalesAllocationVariantOption[]> {
  const target = await getAllocationTargetItemInTx(tx, targetItemId);
  if (!target) return [];
  return [
    {
      itemId: target.itemId,
      itemName: target.itemName,
      unitName: target.unitName,
      salesOrderLineId: null,
      isCurrent: true,
    },
  ];
}

async function getSalesOrderItemsInTx(
  tx: Tx,
  orgId: string,
  salesOrderId: string,
  currentSalesOrderLineId: string
): Promise<SalesAllocationSheetData["salesOrderItems"]> {
  const lineRows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, salesOrderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.id));

  const rows: SalesAllocationSheetData["salesOrderItems"] = [];
  for (const line of lineRows) {
    const workspace = await getAllocationWorkspaceInTx(tx, {
      organizationId: orgId,
      primaryDemand: {
        demandType: "sales_order_line",
        demandId: line.salesOrderLineId,
      },
      itemId: line.itemId,
    });
    if (!workspace) continue;
    const demand = workspace.primaryDemand;
    rows.push({
      itemId: workspace.item.itemId,
      itemName: workspace.item.itemName,
      unitName: workspace.item.unitName,
      salesOrderLineId: line.salesOrderLineId,
      allocatedQty: demand?.allocatedQty ?? "0",
      remainingQty: demand?.openQty ?? "0",
      shortQty: demand?.shortQty ?? "0",
      isCurrent: line.salesOrderLineId === currentSalesOrderLineId,
      variantOptions: await getAllocationVariantOptionsInTx(tx, line.itemId),
    });
  }
  return rows;
}

export async function getSalesAllocationReadModelForItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  options?: { targetLineId?: string | null }
) {
  const workspace = await getAllocationWorkspaceInTx(tx, {
    organizationId: orgId,
    primaryDemand: options?.targetLineId
      ? { demandType: "sales_order_line", demandId: options.targetLineId }
      : null,
    itemId,
  });
  if (!workspace) {
    return {
      demandRows: [],
      lineSummaries: new Map<string, SalesAllocationLineSummary>(),
      supplySources: [],
      uncoveredDemandQty: "0",
    };
  }
  return workspaceToSalesReadModel(workspace);
}

async function getSalesAllocationSheetDataInTx(
  tx: Tx,
  orgId: string,
  salesOrderLineId: string
): Promise<SalesAllocationSheetData | null> {
  const [target] = await tx
    .select({
      itemId: salesOrderLines.itemId,
      salesOrderId: salesOrderLines.salesOrderId,
      allocationManagedAt: salesOrderLines.allocationManagedAt,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        eq(salesOrderLines.id, salesOrderLineId),
        isNull(salesOrders.deletedAt),
        sql`${salesOrders.status} IN ('draft', 'confirmed', 'partially_shipped')`
      )
    );

  if (!target) return null;

  const workspace = await getAllocationWorkspaceInTx(tx, {
    organizationId: orgId,
    primaryDemand: {
      demandType: "sales_order_line",
      demandId: salesOrderLineId,
    },
    itemId: target.itemId,
  });
  if (!workspace?.primaryDemand) return null;
  const model = workspaceToSalesReadModel(workspace);
  const targetLine = model.demandRows.find(
    (row) => row.salesOrderLineId === salesOrderLineId
  );
  const targetItem = await getAllocationTargetItemInTx(tx, target.itemId);
  if (!targetLine || !targetItem) return null;

  const lineSummary = model.lineSummaries.get(salesOrderLineId);
  return {
    targetItem,
    targetLine: {
      ...targetLine,
      salesOrderId: target.salesOrderId,
      allocationManagedAt: target.allocationManagedAt,
    },
    variantOptions: await getAllocationVariantOptionsInTx(tx, target.itemId),
    salesOrderItems: await getSalesOrderItemsInTx(
      tx,
      orgId,
      target.salesOrderId,
      salesOrderLineId
    ),
    editableAllocations: model.supplySources
      .filter((source) => source.canAllocate || toQuantity(source.currentTargetQty) > 0)
      .map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceLabel: source.label,
        quantity: source.currentTargetQty,
        freeQuantity: source.freeQty,
        maxQuantity: source.maxQty,
        coverageKind:
          lineSummary?.sources.find(
            (candidate) =>
              candidate.sourceType === source.sourceType &&
              candidate.sourceId === source.sourceId
          )?.coverageKind ?? "explicit",
      })),
    supplySources: model.supplySources,
    demandRows: model.demandRows,
    uncoveredDemandQty: model.uncoveredDemandQty,
  };
}

export async function getSalesAllocationSheetData(salesOrderLineId: string) {
  return withAuthedOrgContext((tx, orgId) =>
    getSalesAllocationSheetDataInTx(tx, orgId, salesOrderLineId)
  );
}

export async function getItemAllocationSheetData(itemId: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const targetItem = await getAllocationTargetItemInTx(tx, itemId);
    if (!targetItem) return null;
    const workspace = await getAllocationWorkspaceInTx(tx, {
      organizationId: orgId,
      itemId,
    });
    if (!workspace) return null;
    const model = workspaceToSalesReadModel(workspace);
    return {
      targetItem,
      targetLine: null,
      variantOptions: await getAllocationVariantOptionsInTx(tx, itemId),
      salesOrderItems: [],
      editableAllocations: [],
      supplySources: model.supplySources,
      demandRows: model.demandRows,
      uncoveredDemandQty: model.uncoveredDemandQty,
    };
  });
}

export async function saveSalesLineAllocation(
  salesOrderLineId: string,
  input: SaveSalesLineAllocationInput
): Promise<SalesAllocationSheetData> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [target] = await tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, salesOrderLineId));
    if (!target) throw new SalesAllocationError("Sales order line not found.", 404);

    await saveAllocationsForDemandInTx(tx, {
      organizationId: orgId,
      demandType: "sales_order_line",
      demandId: salesOrderLineId,
      itemId: target.itemId,
      allocations: input.allocations,
      actorUserId: userId,
    });

    const refreshed = await getSalesAllocationSheetDataInTx(
      tx,
      orgId,
      salesOrderLineId
    );
    if (!refreshed) throw new SalesAllocationError("Sales order line not found.", 404);
    return refreshed;
  });
}

export async function unallocateAllSalesOrderAllocations() {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const activeRows = await tx
      .select({
        salesOrderLineId: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
      })
      .from(stockAllocations)
      .innerJoin(
        salesOrderLines,
        eq(stockAllocations.demandId, salesOrderLines.id)
      )
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.status, "active"),
          isNull(salesOrders.deletedAt),
          sql`${salesOrders.status} IN ('draft', 'confirmed', 'partially_shipped')`
        )
      );

    const targets = new Map<string, { salesOrderLineId: string; itemId: string }>();
    for (const row of activeRows) {
      targets.set(row.salesOrderLineId, row);
    }

    for (const target of targets.values()) {
      await saveAllocationsForDemandInTx(tx, {
        organizationId: orgId,
        demandType: "sales_order_line",
        demandId: target.salesOrderLineId,
        itemId: target.itemId,
        allocations: [],
        actorUserId: userId,
      });
    }

    return { unallocatedLineCount: targets.size };
  });
}
