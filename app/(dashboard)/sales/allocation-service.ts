import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  inventoryLotBalances,
  items,
  lots,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
  stockAllocations,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  getDefaultInventoryLocationInTx,
  setSalesLineStockReservationInTx,
} from "@/lib/inventory/kernel";
import { normalizeNumeric, resolveVariantDisplay, roundQuantity } from "@/lib/format";
import type {
  SalesAllocationCoverageKind,
  SalesAllocationDemandRow,
  SalesAllocationLineSummary,
  SalesAllocationSheetData,
  SalesAllocationSource,
  SalesAllocationSourceType,
  SalesAllocationVariantOption,
} from "./types";

const ACTIVE_ORDER_STATUSES = ["draft", "confirmed", "partially_shipped"] as const;
const IMPLICIT_COVERAGE_ORDER_STATUSES = ["confirmed", "partially_shipped"] as const;

type AllocationSourceKey = `${SalesAllocationSourceType}:${string}`;

type DemandLine = {
  salesOrderLineId: string;
  salesOrderId: string;
  orderNumber: string;
  orderStatus: "draft" | "confirmed" | "partially_shipped";
  customerName: string;
  shipDate: string | null;
  itemId: string;
  itemName: string;
  masterName: string;
  attrs: string[];
  unitName: string;
  orderedQty: number;
  shippedQty: number;
  cancelledQty: number;
  remainingQty: number;
  allocationManagedAt: Date | null;
  sortOrder: number;
  createdAt: Date;
};

type EffectiveAllocation = {
  sourceType: SalesAllocationSourceType;
  sourceId: string | null;
  label: string;
  quantity: number;
  coverageKind: SalesAllocationCoverageKind;
};

type AllocationVariantOption = SalesAllocationVariantOption;

export type SaveSalesLineAllocationInput = {
  allocations: Array<{
    sourceType: SalesAllocationSourceType;
    sourceId: string | null;
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

function sourceKey(sourceType: SalesAllocationSourceType, sourceId: string | null) {
  return `${sourceType}:${sourceId ?? "stock_pool"}` as AllocationSourceKey;
}

function getLineStatus(
  remainingQty: number,
  allocatedQty: number,
  sources: EffectiveAllocation[]
): SalesAllocationLineSummary["status"] {
  if (allocatedQty <= 0) return "short";
  if (roundQuantity(allocatedQty) < roundQuantity(remainingQty)) return "partial";
  return sources.some((source) => source.sourceType === "manufacturing_order")
    ? "waiting_production"
    : "ready";
}

function buildSourceSummary(sources: EffectiveAllocation[]) {
  if (sources.length === 0) return "\u2014";
  return sources
    .map((source) => `${quantityString(source.quantity)} ${source.label}`)
    .join(", ");
}

function sortDemandLines(left: DemandLine, right: DemandLine) {
  if (left.shipDate == null && right.shipDate != null) return 1;
  if (left.shipDate != null && right.shipDate == null) return -1;
  const dateCompare = (left.shipDate ?? "").localeCompare(right.shipDate ?? "");
  if (dateCompare !== 0) return dateCompare;
  const orderCompare = left.orderNumber.localeCompare(right.orderNumber, undefined, {
    numeric: true,
  });
  if (orderCompare !== 0) return orderCompare;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  const createdCompare = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdCompare !== 0) return createdCompare;
  return left.salesOrderLineId.localeCompare(right.salesOrderLineId);
}

async function getShippedByLineInTx(tx: Tx, salesOrderLineIds: string[]) {
  if (salesOrderLineIds.length === 0) return new Map<string, number>();

  const rows = await tx
    .select({
      salesOrderLineId: salesShipmentLines.salesOrderLineId,
      quantity: trimScale(sql`COALESCE(SUM(${salesShipmentLines.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipmentLines.salesShipmentId, salesShipments.id))
    .where(
      and(
        inArray(salesShipmentLines.salesOrderLineId, salesOrderLineIds),
        eq(salesShipments.status, "shipped")
      )
    )
    .groupBy(salesShipmentLines.salesOrderLineId);

  return new Map(rows.map((row) => [row.salesOrderLineId, toQuantity(row.quantity)]));
}

async function getActiveDemandLinesForItemInTx(tx: Tx, itemId: string) {
  const masterItems = alias(items, "allocation_master_items");
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      orderNumber: salesOrders.orderNumber,
      orderStatus: salesOrders.status,
      customerName: salesOrders.customerName,
      shipDate: salesOrders.shipDate,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      unitName: salesOrderLines.unitName,
      orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
      cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
      allocationManagedAt: salesOrderLines.allocationManagedAt,
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .leftJoin(items, eq(salesOrderLines.itemId, items.id))
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(
      and(
        eq(salesOrderLines.itemId, itemId),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, [...ACTIVE_ORDER_STATUSES])
      )
    )
    .orderBy(asc(salesOrders.shipDate), asc(salesOrders.orderNumber));

  const shippedByLine = await getShippedByLineInTx(
    tx,
    rows.map((row) => row.salesOrderLineId)
  );

  return rows
    .map((row): DemandLine => {
      const display = resolveVariantDisplay(
        row.itemName,
        row.masterName == null
          ? null
          : { name: row.masterName, variantAxes: row.masterVariantAxes },
        row.variantAttrs
      );
      const orderedQty = toQuantity(row.orderedQty);
      const shippedQty = shippedByLine.get(row.salesOrderLineId) ?? 0;
      const cancelledQty = toQuantity(row.cancelledQty);
      const remainingQty = roundQuantity(orderedQty - shippedQty - cancelledQty);

      return {
        salesOrderLineId: row.salesOrderLineId,
        salesOrderId: row.salesOrderId,
        orderNumber: row.orderNumber,
        orderStatus: row.orderStatus as DemandLine["orderStatus"],
        customerName: row.customerName,
        shipDate: row.shipDate,
        itemId: row.itemId,
        itemName: display.masterName,
        masterName: display.masterName,
        attrs: display.attrs,
        unitName: row.unitName,
        orderedQty,
        shippedQty,
        cancelledQty,
        remainingQty,
        allocationManagedAt: row.allocationManagedAt,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
      };
    })
    .filter((line) => line.remainingQty > 0)
    .sort(sortDemandLines);
}

async function getAllocationVariantOptionsInTx({
  tx,
  targetItemId,
  salesOrderId,
  currentSalesOrderLineId,
}: {
  tx: Tx;
  targetItemId: string;
  salesOrderId?: string | null;
  currentSalesOrderLineId?: string | null;
}): Promise<AllocationVariantOption[]> {
  const [targetItem] = await tx
    .select({
      id: items.id,
      name: items.name,
      isMaster: items.isMaster,
      parentId: items.parentId,
      variantAxes: items.variantAxes,
      variantAttrs: items.variantAttrs,
      unitName: unitDefinitions.name,
    })
    .from(items)
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(eq(items.id, targetItemId));

  if (!targetItem) return [];

  const familyId = targetItem.parentId ?? targetItem.id;
  const [masterItem] = await tx
    .select({
      id: items.id,
      name: items.name,
      variantAxes: items.variantAxes,
    })
    .from(items)
    .where(eq(items.id, familyId));

  const siblingRows = await tx
    .select({
      id: items.id,
      name: items.name,
      variantAttrs: items.variantAttrs,
      unitName: unitDefinitions.name,
      createdAt: items.createdAt,
    })
    .from(items)
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        targetItem.parentId == null
          ? targetItem.isMaster
            ? eq(items.parentId, targetItem.id)
            : or(eq(items.id, targetItem.id), eq(items.parentId, targetItem.id))
          : eq(items.parentId, familyId),
        isNull(items.deletedAt)
      )
    )
    .orderBy(asc(items.createdAt), asc(items.id));

  const itemIds = siblingRows.map((row) => row.id);
  if (itemIds.length === 0) return [];

  const orderLineRows =
    salesOrderId == null
      ? []
      : await tx
          .select({
            id: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            sortOrder: salesOrderLines.sortOrder,
          })
          .from(salesOrderLines)
          .where(
            and(
              eq(salesOrderLines.salesOrderId, salesOrderId),
              inArray(salesOrderLines.itemId, itemIds)
            )
          )
          .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.id));
  const lineByItemId = new Map(orderLineRows.map((row) => [row.itemId, row.id]));

  return siblingRows.map((row) => {
    const display = resolveVariantDisplay(
      row.name,
      masterItem == null
        ? null
        : { name: masterItem.name, variantAxes: masterItem.variantAxes },
      row.variantAttrs
    );

    return {
      itemId: row.id,
      itemName: display.masterName,
      unitName: row.unitName ?? "units",
      salesOrderLineId: lineByItemId.get(row.id) ?? null,
      isCurrent: row.id === targetItemId || lineByItemId.get(row.id) === currentSalesOrderLineId,
    };
  });
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

async function getSalesOrderAllocationItemsInTx({
  tx,
  orgId,
  salesOrderId,
  currentItemId,
  currentSalesOrderLineId,
}: {
  tx: Tx;
  orgId: string;
  salesOrderId: string;
  currentItemId: string;
  currentSalesOrderLineId: string;
}): Promise<SalesAllocationSheetData["salesOrderItems"]> {
  const masterItems = alias(items, "allocation_order_master_items");
  const lineRows = await tx
    .select({
      salesOrderLineId: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      unitName: salesOrderLines.unitName,
      variantAttrs: items.variantAttrs,
      masterName: masterItems.name,
      masterVariantAxes: masterItems.variantAxes,
      sortOrder: salesOrderLines.sortOrder,
    })
    .from(salesOrderLines)
    .leftJoin(items, eq(salesOrderLines.itemId, items.id))
    .leftJoin(masterItems, eq(items.parentId, masterItems.id))
    .where(eq(salesOrderLines.salesOrderId, salesOrderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.id));

  const rows = await Promise.all(
    lineRows.map(async (line) => {
      const model = await getSalesAllocationReadModelForItemInTx(
        tx,
        orgId,
        line.itemId,
        { targetLineId: line.salesOrderLineId }
      );
      const demand = model.demandRows.find(
        (row) => row.salesOrderLineId === line.salesOrderLineId
      );
      const display = resolveVariantDisplay(
        line.itemName,
        line.masterName == null
          ? null
          : { name: line.masterName, variantAxes: line.masterVariantAxes },
        line.variantAttrs
      );

      return {
        itemId: line.itemId,
        itemName: display.masterName,
        unitName: line.unitName,
        salesOrderLineId: line.salesOrderLineId,
        allocatedQty: demand?.allocatedQty ?? "0",
        remainingQty: demand?.remainingQty ?? "0",
        shortQty: demand?.shortQty ?? "0",
        isCurrent:
          line.itemId === currentItemId ||
          line.salesOrderLineId === currentSalesOrderLineId,
        variantOptions: await getAllocationVariantOptionsInTx({
          tx,
          targetItemId: line.itemId,
          salesOrderId,
          currentSalesOrderLineId,
        }),
      };
    })
  );

  return rows;
}

async function getUsableStockQtyInTx(tx: Tx, orgId: string, itemId: string) {
  const location = await getDefaultInventoryLocationInTx(tx, orgId);
  const [row] = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        eq(inventoryLotBalances.locationId, location.id),
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );

  return toQuantity(row?.quantity);
}

async function getUsableLotSourcesInTx(tx: Tx, orgId: string, itemId: string) {
  const location = await getDefaultInventoryLocationInTx(tx, orgId);
  return tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
      receivedAt: lots.receivedAt,
      createdAt: lots.createdAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        eq(inventoryLotBalances.locationId, location.id),
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
}

async function getActiveAllocationRowsForItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string
) {
  return tx
    .select({
      id: stockAllocations.id,
      salesOrderLineId: stockAllocations.demandId,
      itemId: stockAllocations.itemId,
      sourceType: stockAllocations.sourceType,
      sourceId: stockAllocations.sourceId,
      quantity: trimScale(stockAllocations.quantity).as("quantity"),
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
        eq(stockAllocations.itemId, itemId),
        eq(stockAllocations.status, "active"),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, [...ACTIVE_ORDER_STATUSES])
      )
    )
    .orderBy(
      asc(salesOrders.shipDate),
      asc(salesOrders.orderNumber),
      asc(salesOrderLines.sortOrder),
      asc(stockAllocations.createdAt),
      asc(stockAllocations.id)
    );
}

async function getActiveAllocationSourceRowsForItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string
) {
  return tx
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
        eq(stockAllocations.organizationId, orgId),
        eq(stockAllocations.itemId, itemId),
        eq(stockAllocations.status, "active")
      )
    );
}

async function getManufacturingSourcesInTx(tx: Tx, itemId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
      actualQuantity: trimScale(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.productId, itemId),
        isNull(manufacturingOrders.deletedAt),
        inArray(manufacturingOrders.status, ["draft", "released", "completed"])
      )
    );

  return new Map(
    rows.map((row) => {
      const plannedQty = toQuantity(row.plannedQuantity);
      const actualQty = toQuantity(row.actualQuantity);
      const remainingQty =
        row.status === "completed" ? 0 : Math.max(0, roundQuantity(plannedQty - actualQty));

      return [
        row.id,
        {
          id: row.id,
          label: row.orderNumber,
          status: row.status as "draft" | "released" | "completed",
          date: row.plannedDate,
          priorityRank: row.priorityRank,
          totalQty: remainingQty,
        },
      ];
    })
  );
}

export async function getSalesAllocationReadModelForItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  options?: { targetLineId?: string | null }
) {
  const demandLines = await getActiveDemandLinesForItemInTx(tx, itemId);
  const stockTotalQty = await getUsableStockQtyInTx(tx, orgId, itemId);
  const lotSources = await getUsableLotSourcesInTx(tx, orgId, itemId);
  const lotById = new Map(lotSources.map((lot) => [lot.id, lot]));
  const activeAllocationRows = await getActiveAllocationRowsForItemInTx(
    tx,
    orgId,
    itemId
  );
  const activeAllocationSourceRows = await getActiveAllocationSourceRowsForItemInTx(
    tx,
    orgId,
    itemId
  );
  const manufacturingSources = await getManufacturingSourcesInTx(tx, itemId);
  const explicitLotAllocatedQtyById = new Map<string, number>();
  for (const row of activeAllocationSourceRows) {
    if (row.sourceType !== "lot" || !row.sourceId) continue;
    explicitLotAllocatedQtyById.set(
      row.sourceId,
      roundQuantity((explicitLotAllocatedQtyById.get(row.sourceId) ?? 0) + toQuantity(row.quantity))
    );
  }
  function createStockPoolLotRemainingById() {
    return new Map(
      lotSources.map((lot) => [
        lot.id,
        Math.max(
          0,
          roundQuantity(
            toQuantity(lot.quantity) - (explicitLotAllocatedQtyById.get(lot.id) ?? 0)
          )
        ),
      ])
    );
  }
  function takeStockPoolLotSlices(
    quantity: number,
    remainingByLotId: Map<string, number>
  ): EffectiveAllocation[] {
    let remaining = roundQuantity(quantity);
    const slices: EffectiveAllocation[] = [];

    for (const lot of lotSources) {
      if (remaining <= 0) break;
      const lotFreeQty = remainingByLotId.get(lot.id) ?? 0;
      if (lotFreeQty <= 0) continue;
      const sliceQty = Math.min(remaining, lotFreeQty);
      slices.push({
        sourceType: "lot",
        sourceId: lot.id,
        label: lot.lotNumber,
        quantity: sliceQty,
        coverageKind: "explicit",
      });
      remainingByLotId.set(lot.id, roundQuantity(lotFreeQty - sliceQty));
      remaining = roundQuantity(remaining - sliceQty);
    }

    if (remaining > 0) {
      slices.push({
        sourceType: "stock_pool",
        sourceId: null,
        label: "Stock",
        quantity: remaining,
        coverageKind: "explicit",
      });
    }

    return slices;
  }

  const demandLineIds = new Set(demandLines.map((line) => line.salesOrderLineId));
  const effectiveByLine = new Map<string, EffectiveAllocation[]>();
  const explicitByLine = new Map<string, EffectiveAllocation[]>();
  const allocatedBySource = new Map<AllocationSourceKey, number>();
  const displayStockPoolLotRemainingById = createStockPoolLotRemainingById();

  for (const row of activeAllocationRows) {
    if (!demandLineIds.has(row.salesOrderLineId)) continue;
    const sourceType = row.sourceType as SalesAllocationSourceType;
    const sourceId = row.sourceId;
    const quantity = toQuantity(row.quantity);
    const allocations =
      sourceType === "stock_pool" && lotSources.length > 0
        ? takeStockPoolLotSlices(quantity, displayStockPoolLotRemainingById)
        : [
            {
              sourceType,
              sourceId,
              label:
                sourceType === "stock_pool"
                  ? "Stock"
                  : sourceType === "lot"
                    ? lotById.get(sourceId ?? "")?.lotNumber ?? "Lot"
                  : manufacturingSources.get(sourceId ?? "")?.label ?? "Production",
              quantity,
              coverageKind: "explicit" as const,
            },
          ];
    const lineAllocations = effectiveByLine.get(row.salesOrderLineId) ?? [];
    lineAllocations.push(...allocations);
    effectiveByLine.set(row.salesOrderLineId, lineAllocations);
    explicitByLine.set(row.salesOrderLineId, lineAllocations);

  }

  const allocatedStockPoolLotRemainingById = createStockPoolLotRemainingById();
  for (const row of activeAllocationSourceRows) {
    const sourceType = row.sourceType as SalesAllocationSourceType;
    if (sourceType === "stock_pool" && lotSources.length > 0) {
      for (const slice of takeStockPoolLotSlices(
        toQuantity(row.quantity),
        allocatedStockPoolLotRemainingById
      )) {
        const key = sourceKey(slice.sourceType, slice.sourceId);
        allocatedBySource.set(
          key,
          roundQuantity((allocatedBySource.get(key) ?? 0) + slice.quantity)
        );
      }
      continue;
    }
    const key = sourceKey(sourceType, row.sourceId);
    allocatedBySource.set(
      key,
      roundQuantity((allocatedBySource.get(key) ?? 0) + toQuantity(row.quantity))
    );
  }

  const allocatedFromLotsQty = [...allocatedBySource.entries()]
    .filter(([key]) => key.startsWith("lot:"))
    .reduce((sum, [, quantity]) => roundQuantity(sum + quantity), 0);
  const implicitLotFreeQtyById = new Map(
    lotSources.map((lot) => {
      const key = sourceKey("lot", lot.id);
      return [
        lot.id,
        Math.max(
          0,
          roundQuantity(toQuantity(lot.quantity) - (allocatedBySource.get(key) ?? 0))
        ),
      ] as const;
    })
  );
  let remainingImplicitStockQty =
    lotSources.length > 0
      ? [...implicitLotFreeQtyById.values()].reduce(
          (sum, quantity) => roundQuantity(sum + quantity),
          0
        )
      : roundQuantity(
          stockTotalQty -
            (allocatedBySource.get(sourceKey("stock_pool", null)) ?? 0) -
            allocatedFromLotsQty
        );

  for (const line of demandLines) {
    const hasExplicitAllocations = (explicitByLine.get(line.salesOrderLineId)?.length ?? 0) > 0;
    if (
      !IMPLICIT_COVERAGE_ORDER_STATUSES.includes(
        line.orderStatus as (typeof IMPLICIT_COVERAGE_ORDER_STATUSES)[number]
      )
    ) {
      continue;
    }
    if (line.allocationManagedAt != null || hasExplicitAllocations) continue;
    if (remainingImplicitStockQty <= 0) continue;

    const lineAllocations = effectiveByLine.get(line.salesOrderLineId) ?? [];
    let implicitQty = Math.min(line.remainingQty, remainingImplicitStockQty);
    if (implicitQty <= 0) continue;

    if (lotSources.length > 0) {
      for (const lot of lotSources) {
        if (implicitQty <= 0) break;
        const lotFreeQty = implicitLotFreeQtyById.get(lot.id) ?? 0;
        if (lotFreeQty <= 0) continue;
        const quantity = Math.min(implicitQty, lotFreeQty);
        lineAllocations.push({
          sourceType: "lot",
          sourceId: lot.id,
          label: lot.lotNumber,
          quantity,
          coverageKind: "implicit",
        });
        implicitLotFreeQtyById.set(lot.id, roundQuantity(lotFreeQty - quantity));
        implicitQty = roundQuantity(implicitQty - quantity);
        remainingImplicitStockQty = roundQuantity(remainingImplicitStockQty - quantity);

        const key = sourceKey("lot", lot.id);
        allocatedBySource.set(
          key,
          roundQuantity((allocatedBySource.get(key) ?? 0) + quantity)
        );
      }
    } else {
      const allocation: EffectiveAllocation = {
        sourceType: "stock_pool",
        sourceId: null,
        label: "Stock",
        quantity: implicitQty,
        coverageKind: "implicit",
      };
      lineAllocations.push(allocation);
      remainingImplicitStockQty = roundQuantity(remainingImplicitStockQty - implicitQty);

      const key = sourceKey("stock_pool", null);
      allocatedBySource.set(
        key,
        roundQuantity((allocatedBySource.get(key) ?? 0) + implicitQty)
      );
    }
    effectiveByLine.set(line.salesOrderLineId, lineAllocations);
  }

  const lineSummaries = new Map<string, SalesAllocationLineSummary>();
  const demandRows: SalesAllocationDemandRow[] = demandLines.map((line) => {
    const sources = effectiveByLine.get(line.salesOrderLineId) ?? [];
    const allocatedQty = roundQuantity(
      sources.reduce((sum, source) => sum + source.quantity, 0)
    );
    const shortQty = Math.max(0, roundQuantity(line.remainingQty - allocatedQty));
    const sourceSummary = buildSourceSummary(sources);
    const status = getLineStatus(line.remainingQty, allocatedQty, sources);

    lineSummaries.set(line.salesOrderLineId, {
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(shortQty),
      sourceSummary,
      status,
      sources: sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        label: source.label,
        quantity: quantityString(source.quantity),
        coverageKind: source.coverageKind,
      })),
    });

    return {
      salesOrderLineId: line.salesOrderLineId,
      salesOrderId: line.salesOrderId,
      orderNumber: line.orderNumber,
      orderStatus: line.orderStatus,
      customerName: line.customerName,
      shipDate: line.shipDate,
      itemId: line.itemId,
      itemName: line.itemName,
      unitName: line.unitName,
      orderedQty: quantityString(line.orderedQty),
      shippedQty: quantityString(line.shippedQty),
      cancelledQty: quantityString(line.cancelledQty),
      remainingQty: quantityString(line.remainingQty),
      allocatedQty: quantityString(allocatedQty),
      shortQty: quantityString(shortQty),
      sourceSummary,
      sources: sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        label: source.label,
        quantity: quantityString(source.quantity),
        coverageKind: source.coverageKind,
      })),
      isTarget: line.salesOrderLineId === options?.targetLineId,
    };
  });

  const targetSources = options?.targetLineId
    ? effectiveByLine.get(options.targetLineId) ?? []
    : [];
  const targetQtyBySource = new Map<AllocationSourceKey, number>();
  targetSources.forEach((source) => {
    const key = sourceKey(source.sourceType, source.sourceId);
    targetQtyBySource.set(key, roundQuantity((targetQtyBySource.get(key) ?? 0) + source.quantity));
  });

  const supplySources: SalesAllocationSource[] = [];
  const stockAllocatedQty = allocatedBySource.get(sourceKey("stock_pool", null)) ?? 0;
  const stockFreeQty = Math.max(
    0,
    roundQuantity(stockTotalQty - stockAllocatedQty - allocatedFromLotsQty)
  );
  const currentTargetStockQty = targetQtyBySource.get(sourceKey("stock_pool", null)) ?? 0;
  supplySources.push({
    sourceType: "stock_pool",
    sourceId: null,
    label: "Stock",
    status: "available",
    date: null,
    priorityRank: null,
    totalQty: quantityString(stockTotalQty),
    allocatedQty: quantityString(stockAllocatedQty),
    freeQty: quantityString(stockFreeQty),
    currentTargetQty: quantityString(currentTargetStockQty),
    maxQty: quantityString(stockFreeQty + currentTargetStockQty),
    canAllocate: true,
  });

  for (const lot of lotSources) {
    const key = sourceKey("lot", lot.id);
    const totalQty = toQuantity(lot.quantity);
    const allocatedQty = allocatedBySource.get(key) ?? 0;
    const currentTargetQty = targetQtyBySource.get(key) ?? 0;
    const freeQty = Math.max(0, roundQuantity(totalQty - allocatedQty));
    supplySources.push({
      sourceType: "lot",
      sourceId: lot.id,
      label: lot.lotNumber,
      status: "available",
      date: lot.receivedAt.toISOString().slice(0, 10),
      receivedAt: lot.receivedAt.toISOString(),
      createdAt: lot.createdAt.toISOString(),
      priorityRank: null,
      lotNumber: lot.lotNumber,
      totalQty: quantityString(totalQty),
      allocatedQty: quantityString(allocatedQty),
      freeQty: quantityString(freeQty),
      currentTargetQty: quantityString(currentTargetQty),
      maxQty: quantityString(freeQty + currentTargetQty),
      canAllocate: true,
    });
  }

  const manufacturingSourceIds = new Set<string>();
  manufacturingSources.forEach((source, id) => {
    if (source.status === "draft" || source.status === "released") {
      manufacturingSourceIds.add(id);
    }
  });
  activeAllocationSourceRows.forEach((row) => {
    if (row.sourceType === "manufacturing_order" && row.sourceId) {
      manufacturingSourceIds.add(row.sourceId);
    }
  });

  [...manufacturingSourceIds]
    .map((id) => manufacturingSources.get(id))
    .filter((source): source is NonNullable<typeof source> => source != null)
    .sort((left, right) => {
      const dateCompare = (left.date ?? "").localeCompare(right.date ?? "");
      if (dateCompare !== 0) return dateCompare;
      return left.label.localeCompare(right.label, undefined, { numeric: true });
    })
    .forEach((source) => {
      const key = sourceKey("manufacturing_order", source.id);
      const allocatedQty = allocatedBySource.get(key) ?? 0;
      const freeQty =
        source.status === "completed"
          ? 0
          : Math.max(0, roundQuantity(source.totalQty - allocatedQty));
      const currentTargetQty = targetQtyBySource.get(key) ?? 0;
      supplySources.push({
        sourceType: "manufacturing_order",
        sourceId: source.id,
        label: source.label,
        status: source.status,
        date: source.date,
        priorityRank: source.priorityRank,
        totalQty: quantityString(source.status === "completed" ? allocatedQty : source.totalQty),
        allocatedQty: quantityString(allocatedQty),
        freeQty: quantityString(freeQty),
        currentTargetQty: quantityString(currentTargetQty),
        maxQty: quantityString(
          source.status === "completed" ? currentTargetQty : freeQty + currentTargetQty
        ),
        canAllocate: source.status === "draft" || source.status === "released",
      });
    });

  const uncoveredDemandQty = demandRows.reduce(
    (sum, row) => roundQuantity(sum + toQuantity(row.shortQty)),
    0
  );

  return {
    demandLines,
    demandRows,
    lineSummaries,
    supplySources,
    uncoveredDemandQty: quantityString(uncoveredDemandQty),
  };
}

export async function getSalesAllocationSheetData(
  salesOrderLineId: string
): Promise<SalesAllocationSheetData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
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
          inArray(salesOrders.status, [...ACTIVE_ORDER_STATUSES])
        )
      );

    if (!target) return null;

    const model = await getSalesAllocationReadModelForItemInTx(tx, orgId, target.itemId, {
      targetLineId: salesOrderLineId,
    });
    const targetLine = model.demandRows.find(
      (row) => row.salesOrderLineId === salesOrderLineId
    );

    if (!targetLine) return null;

    const targetItem = await getAllocationTargetItemInTx(tx, target.itemId);
    if (!targetItem) return null;

    const variantOptions = await getAllocationVariantOptionsInTx({
      tx,
      targetItemId: target.itemId,
      salesOrderId: target.salesOrderId,
      currentSalesOrderLineId: salesOrderLineId,
    });
    const salesOrderItems = await getSalesOrderAllocationItemsInTx({
      tx,
      orgId,
      salesOrderId: target.salesOrderId,
      currentItemId: target.itemId,
      currentSalesOrderLineId: salesOrderLineId,
    });

    const editableAllocations = model.supplySources
      .filter((source) => source.canAllocate || toQuantity(source.currentTargetQty) > 0)
      .map((source) => {
        const lineSummary = model.lineSummaries.get(salesOrderLineId);
        const matchingSource = lineSummary?.sources.find(
          (summarySource) =>
            summarySource.sourceType === source.sourceType &&
            summarySource.sourceId === source.sourceId
        );

        return {
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceLabel: source.label,
          quantity: source.currentTargetQty,
          freeQuantity: source.freeQty,
          maxQuantity: source.maxQty,
          coverageKind: matchingSource?.coverageKind ?? "explicit",
        };
      });

    return {
      targetItem,
      targetLine: {
        ...targetLine,
        allocationManagedAt: target.allocationManagedAt,
      },
      variantOptions,
      salesOrderItems,
      editableAllocations,
      supplySources: model.supplySources,
      demandRows: model.demandRows,
      uncoveredDemandQty: model.uncoveredDemandQty,
    };
  });
}

export async function getItemAllocationSheetData(
  itemId: string
): Promise<SalesAllocationSheetData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const targetItem = await getAllocationTargetItemInTx(tx, itemId);
    if (!targetItem) return null;

    const model = await getSalesAllocationReadModelForItemInTx(tx, orgId, itemId);
    const variantOptions = await getAllocationVariantOptionsInTx({
      tx,
      targetItemId: itemId,
    });

    return {
      targetItem,
      targetLine: null,
      variantOptions,
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
      .select({
        salesOrderLineId: salesOrderLines.id,
        salesOrderId: salesOrderLines.salesOrderId,
        itemId: salesOrderLines.itemId,
        orderStatus: salesOrders.status,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(eq(salesOrderLines.id, salesOrderLineId))
      .for("update");

    if (!target || target.deletedAt != null) {
      throw new SalesAllocationError("Sales order line not found.", 404);
    }

    if (!ACTIVE_ORDER_STATUSES.includes(target.orderStatus as (typeof ACTIVE_ORDER_STATUSES)[number])) {
      throw new SalesAllocationError(
        "Only draft, confirmed, or partially shipped sales lines can be allocated.",
        400
      );
    }

    await tx
      .select({ id: items.id })
      .from(items)
      .where(eq(items.id, target.itemId))
      .for("update");

    await tx
      .select({ id: stockAllocations.id })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.itemId, target.itemId),
          eq(stockAllocations.status, "active")
        )
      )
      .for("update");

    const normalized = input.allocations
      .map((allocation) => ({
        sourceType: allocation.sourceType,
        sourceId:
          allocation.sourceType === "stock_pool" ? null : allocation.sourceId,
        quantity: roundQuantity(toQuantity(allocation.quantity)),
      }))
      .filter((allocation) => allocation.quantity > 0);

    const seenSources = new Set<AllocationSourceKey>();
    for (const allocation of normalized) {
      const key = sourceKey(allocation.sourceType, allocation.sourceId);
      if (seenSources.has(key)) {
        throw new SalesAllocationError("Each source can only be allocated once.", 400);
      }
      seenSources.add(key);
      if (allocation.sourceType !== "stock_pool" && !allocation.sourceId) {
        throw new SalesAllocationError("Select an allocation source.", 400);
      }
    }

    const model = await getSalesAllocationReadModelForItemInTx(tx, orgId, target.itemId, {
      targetLineId: salesOrderLineId,
    });
    const targetLine = model.demandRows.find(
      (row) => row.salesOrderLineId === salesOrderLineId
    );

    if (!targetLine) {
      throw new SalesAllocationError("Sales order line has no remaining demand.", 400);
    }

    const totalAllocation = roundQuantity(
      normalized.reduce((sum, allocation) => sum + allocation.quantity, 0)
    );
    const remainingToFulfill = toQuantity(targetLine.remainingQty);

    if (totalAllocation > remainingToFulfill) {
      throw new SalesAllocationError(
        "Allocated quantity cannot exceed remaining quantity.",
        409
      );
    }

    const sourcesByKey = new Map(
      model.supplySources.map((source) => [
        sourceKey(source.sourceType, source.sourceId),
        source,
      ])
    );
    const stockSource = sourcesByKey.get(sourceKey("stock_pool", null));
    const stockLikeAllocationQty = roundQuantity(
      normalized
        .filter(
          (allocation) =>
            allocation.sourceType === "stock_pool" || allocation.sourceType === "lot"
        )
        .reduce((sum, allocation) => sum + allocation.quantity, 0)
    );
    const currentTargetStockLikeQty = model.supplySources
      .filter((source) => source.sourceType === "stock_pool" || source.sourceType === "lot")
      .reduce(
        (sum, source) => roundQuantity(sum + toQuantity(source.currentTargetQty)),
        0
      );
    const sharedStockLikeMaxQty = roundQuantity(
      toQuantity(stockSource?.freeQty ?? "0") + currentTargetStockLikeQty
    );

    if (stockLikeAllocationQty > sharedStockLikeMaxQty) {
      throw new SalesAllocationError(
        `Stock and lot allocations cannot exceed ${quantityString(sharedStockLikeMaxQty)} free stock.`,
        409
      );
    }

    for (const allocation of normalized) {
      const key = sourceKey(allocation.sourceType, allocation.sourceId);
      const source = sourcesByKey.get(key);
      if (!source) {
        throw new SalesAllocationError("Allocation source is no longer available.", 409);
      }
      if (
        allocation.sourceType === "manufacturing_order" &&
        !source.canAllocate &&
        allocation.quantity > toQuantity(source.currentTargetQty)
      ) {
        throw new SalesAllocationError(
          "Completed manufacturing orders cannot receive new allocations.",
          409
        );
      }
      if (allocation.sourceType === "manufacturing_order" && source.sourceId) {
        const manufacturingSource = model.supplySources.find(
          (candidate) =>
            candidate.sourceType === "manufacturing_order" &&
            candidate.sourceId === source.sourceId
        );
        if (!manufacturingSource) {
          throw new SalesAllocationError("Manufacturing source not found.", 409);
        }
      }
      if (allocation.quantity > toQuantity(source.maxQty)) {
        throw new SalesAllocationError(
          `${source.label} only has ${source.maxQty} free.`,
          409
        );
      }
    }

    const now = new Date();
    await tx
      .update(stockAllocations)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: userId,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.demandId, salesOrderLineId),
          eq(stockAllocations.status, "active")
        )
      );

    if (normalized.length > 0) {
      await tx.insert(stockAllocations).values(
        normalized.map((allocation) => ({
          organizationId: orgId,
          demandType: "sales_order_line",
          demandId: salesOrderLineId,
          itemId: target.itemId,
          sourceType: allocation.sourceType,
          sourceId: allocation.sourceId,
          quantity: quantityString(allocation.quantity),
          status: "active",
          createdBy: userId,
          updatedBy: userId,
        }))
      );
    }

    await tx
      .update(salesOrderLines)
      .set({
        allocationManagedAt: now,
        allocationManagedBy: userId,
        updatedAt: now,
      })
      .where(eq(salesOrderLines.id, salesOrderLineId));

    if (target.orderStatus === "confirmed" || target.orderStatus === "partially_shipped") {
      const stockAllocationQty = normalized
        .filter((allocation) => allocation.sourceType === "stock_pool" || allocation.sourceType === "lot")
        .reduce((sum, allocation) => roundQuantity(sum + allocation.quantity), 0);
      await setSalesLineStockReservationInTx(tx, {
        organizationId: orgId,
        salesOrderLineId,
        itemId: target.itemId,
        quantity: stockAllocationQty,
        actorUserId: userId,
      });
    }

    const refreshed = await getSalesAllocationReadModelForItemInTx(
      tx,
      orgId,
      target.itemId,
      { targetLineId: salesOrderLineId }
    );
    const refreshedTarget = refreshed.demandRows.find(
      (row) => row.salesOrderLineId === salesOrderLineId
    );

    if (!refreshedTarget) {
      throw new SalesAllocationError("Sales order line has no remaining demand.", 400);
    }

    const targetItem = await getAllocationTargetItemInTx(tx, target.itemId);
    if (!targetItem) {
      throw new SalesAllocationError("Item not found.", 404);
    }
    const variantOptions = await getAllocationVariantOptionsInTx({
      tx,
      targetItemId: target.itemId,
      salesOrderId: target.salesOrderId,
      currentSalesOrderLineId: salesOrderLineId,
    });
    const salesOrderItems = await getSalesOrderAllocationItemsInTx({
      tx,
      orgId,
      salesOrderId: target.salesOrderId,
      currentItemId: target.itemId,
      currentSalesOrderLineId: salesOrderLineId,
    });

    return {
      targetItem,
      targetLine: {
        ...refreshedTarget,
        allocationManagedAt: now,
      },
      variantOptions,
      salesOrderItems,
      editableAllocations: refreshed.supplySources
        .filter((source) => source.canAllocate || toQuantity(source.currentTargetQty) > 0)
        .map((source) => ({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceLabel: source.label,
          quantity: source.currentTargetQty,
          freeQuantity: source.freeQty,
          maxQuantity: source.maxQty,
          coverageKind: "explicit",
        })),
      supplySources: refreshed.supplySources,
      demandRows: refreshed.demandRows,
      uncoveredDemandQty: refreshed.uncoveredDemandQty,
    };
  });
}
