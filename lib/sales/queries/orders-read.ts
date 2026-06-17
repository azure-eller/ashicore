import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { formatQuantity, normalizeNumericScale, normalizeNumeric, normalizeMoney, roundQuantity, summarizeItems } from "@/lib/format";
import { customerContacts, customerProjects, accountingDocumentSyncs, customers, inventoryEvents, itemFamilies, items, lots, manufacturingOrderBatches, manufacturingOrderOutputs, manufacturingOrderIngredients, manufacturingOrders, salesOrderLines, salesOrders, unitDefinitions } from "@/lib/db/schema";
import { ACCOUNTING_DOCUMENT_SALES_ORDER, ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import type { AccountingProvider } from "@/lib/accounting/constants";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getTaxSettingsInTx } from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { projectedOnHandQtyExpr, projectedPotentialQty } from "@/lib/inventory/kernel";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { compareDocumentNumbers } from "@/lib/document-number-format";
import { calculateMarginMetrics, calculateUnitMarginMetrics } from "@/lib/margin";
import { measureObservedOperation } from "@/lib/observability/request-log";
import { buildFifoLotPickPlanInTx, type LotPickPlanEntry } from "@/lib/inventory/lot-pick-plan";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import type { PricingSourceType, SalesAllocationLineSummary, SalesOrderFulfillmentSummary, SalesOrderDetail, SalesOrderDetailLine, SalesOrderEditData, SalesLinkedManufacturingOrder, SalesOrderListRow, SalesShippingQueueRow, SalesOrderItemOption, SalesShippingReadiness, SalesMarginSummary } from "../types";
import { getSalesOrderManufacturingSummariesInTx, type SalesOrderManufacturingLineSummary } from "@/lib/manufacturing/sales-order-manufacturability";
import { getSalesFulfillmentReadModelsInTx, getAvailabilityLabel, type SalesFulfillmentDemandLine, type SalesIngredientShortageSummary } from "@/lib/sales/fulfillment-read-model";
import { getDemandQueueCoverageByDemandKeyForItemsInTx, type DemandQueueCoverageDemand } from "@/lib/inventory/allocation/demand-queue";
import { getEstimatedUnitCostsByItemIdInTx } from "@/lib/inventory/estimated-cost";
import { parseMoneyValue, getOrderLinesInTx, normalizeShipQuantity } from "./shared";
import { stockSubquery, demandQtySubquery, availableQtySubquery, expectedQtySubquery, getSalesOptionLabelsByItemIdInTx, getSalesVariantValuesByItemIdInTx, formatSalesItemDisplayName } from "./validation";

/**
 * `availableQty` is derived here in the data layer so components never do
 * quantity arithmetic (which leaks float artifacts to the screen).
 */
function serializeIngredientShortage(shortage: SalesIngredientShortageSummary) {
  return {
    ...shortage,
    requiredQty: normalizeNumeric(roundQuantity(shortage.requiredQty)),
    shortQty: normalizeNumeric(roundQuantity(shortage.shortQty)),
    availableQty: normalizeNumeric(roundQuantity(shortage.availableQty)),
    expectedQty: normalizeNumeric(roundQuantity(shortage.expectedQty)),
    missingQty: normalizeNumeric(roundQuantity(shortage.missingQty)),
  };
}

function buildSalesMarginSummary(params: {
  productRevenue: number;
  freightRecovery: number;
  productCogs: number | null;
  fulfillmentCosts: number;
  costStatus: SalesMarginSummary["costStatus"];
}): SalesMarginSummary {
  const revenue = params.productRevenue + params.freightRecovery;
  const totalCosts =
    params.productCogs == null ? null : params.productCogs + params.fulfillmentCosts;
  const metrics =
    totalCosts == null
      ? null
      : calculateMarginMetrics({
          revenue,
          cogs: totalCosts,
        });

  return {
    productRevenue: normalizeMoney(params.productRevenue),
    freightRecovery: normalizeMoney(params.freightRecovery),
    productCogs: params.productCogs == null ? null : normalizeMoney(params.productCogs),
    fulfillmentCosts: normalizeMoney(params.fulfillmentCosts),
    contributionMargin: metrics?.grossProfit ?? null,
    marginPercent: metrics?.marginPercent ?? null,
    costStatus: params.costStatus,
  };
}

async function getActualSalesLineCostsByLineIdInTx(tx: Tx, salesOrderId: string) {
  const salesOrderLineIdExpr = sql<string>`(${inventoryEvents.metadata}->>'salesOrderLineId')`;
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLineIdExpr.as("salesOrderLineId"),
      quantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
        "quantity"
      ),
      cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
        "cogs"
      ),
    })
    .from(inventoryEvents)
    .where(
      and(
        eq(inventoryEvents.eventType, "sales_consumption"),
        sql`${inventoryEvents.metadata}->>'salesOrderLineId' IS NOT NULL`,
        sql`(
          (${inventoryEvents.referenceType} = 'sales_order' AND ${inventoryEvents.referenceId} = ${salesOrderId})
          OR ${inventoryEvents.metadata}->>'salesOrderId' = ${salesOrderId}
        )`
      )
    )
    .groupBy(salesOrderLineIdExpr);

  return new Map(rows.map((row) => [row.salesOrderLineId, row]));
}

type LinkedManufacturingStatus = Pick<
  SalesOrderDetail["linkedManufacturingOrders"][number],
  "orderNumber" | "status" | "productionStatus"
>;

type LinkedManufacturingOrderRead = SalesLinkedManufacturingOrder & {
  salesOrderId: string;
  salesOrderLineId: string | null;
  createdAt: Date;
};

function mergeManufacturingLinkSource(
  current: SalesLinkedManufacturingOrder["linkSource"] | undefined,
  next: SalesLinkedManufacturingOrder["linkSource"]
): SalesLinkedManufacturingOrder["linkSource"] {
  if (!current || current === next) return next;
  return "both";
}

async function getLinkedManufacturingOrdersBySalesOrderIdInTx(
  tx: Tx,
  salesOrderIds: string[]
) {
  const uniqueSalesOrderIds = [...new Set(salesOrderIds)];
  const bySalesOrderId = new Map<string, LinkedManufacturingOrderRead[]>();

  if (uniqueSalesOrderIds.length === 0) {
    return bySalesOrderId;
  }

  const productionStatusExpression = sql<SalesLinkedManufacturingOrder["productionStatus"]>`
    CASE
      WHEN ${manufacturingOrders.status} = 'done' THEN 'done'
      WHEN ${manufacturingOrders.isBlocked} THEN 'blocked'
      WHEN ${manufacturingOrders.startedAt} IS NOT NULL THEN 'in_progress'
      WHEN COALESCE(${manufacturingOrders.actualQuantity}, 0) > 0 THEN 'in_progress'
      WHEN EXISTS (
        SELECT 1
        FROM ${manufacturingOrderBatches}
        WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
          AND ${manufacturingOrderBatches.status} IN ('in_progress', 'completed')
      ) THEN 'in_progress'
      WHEN EXISTS (
        SELECT 1
        FROM ${manufacturingOrderIngredients}
        WHERE ${manufacturingOrderIngredients.manufacturingOrderId} = ${manufacturingOrders.id}
          AND (
            ${manufacturingOrderIngredients.pickStatus} <> 'not_picked'
            OR ${manufacturingOrderIngredients.pickedQuantity} > 0
          )
      ) THEN 'in_progress'
      ELSE 'not_started'
    END
  `;
  const completedBatchCountExpression = sql<number>`(
    SELECT COUNT(*)::int
    FROM ${manufacturingOrderBatches}
    WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
      AND ${manufacturingOrderBatches.status} = 'completed'
  )`;

  const headerRows = await tx
    .select({
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
      actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
      unitName: manufacturingOrders.unitName,
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      status: manufacturingOrders.status,
      productionStatus: productionStatusExpression,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      numberOfBatches: manufacturingOrders.numberOfBatches,
      completedBatchCount: completedBatchCountExpression,
      createdAt: manufacturingOrders.createdAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.salesOrderId, uniqueSalesOrderIds),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    );

  const merged = new Map<string, LinkedManufacturingOrderRead>();
  const productDisplayNamesById = await getItemDisplayNamesByIdInTx(tx, [
    ...headerRows.map((row) => row.productId),
  ]);
  const addRow = (
    row: (typeof headerRows)[number],
    linkSource: SalesLinkedManufacturingOrder["linkSource"]
  ) => {
    if (!row.salesOrderId) return;
    const key = `${row.salesOrderId}:${row.id}`;
    const existing = merged.get(key);
    merged.set(key, {
      salesOrderId: row.salesOrderId,
      salesOrderLineId: row.salesOrderLineId,
      id: row.id,
      orderNumber: row.orderNumber,
      productName: productDisplayNamesById.get(row.productId) ?? row.productName,
      productSku: row.productSku,
      plannedQuantity: row.plannedQuantity,
      actualQuantity: row.actualQuantity,
      unitName: row.unitName,
      plannedDate: row.plannedDate,
      priorityRank: row.priorityRank,
      status: row.status as SalesLinkedManufacturingOrder["status"],
      productionStatus: row.productionStatus,
      manufacturingMode: row.manufacturingMode,
      numberOfBatches: row.numberOfBatches,
      completedBatchCount: row.completedBatchCount,
      linkSource: mergeManufacturingLinkSource(existing?.linkSource, linkSource),
      createdAt: row.createdAt,
    });
  };

  headerRows.forEach((row) => addRow(row, "sales_order"));

  [...merged.values()]
    .toSorted((left, right) => {
      const createdCompare = right.createdAt.getTime() - left.createdAt.getTime();
      if (createdCompare !== 0) return createdCompare;
      const orderCompare = compareDocumentNumbers(
        left.orderNumber,
        right.orderNumber,
        "MO"
      );
      if (orderCompare !== 0) return orderCompare;
      return left.id.localeCompare(right.id);
    })
    .forEach((row) => {
      const bucket = bySalesOrderId.get(row.salesOrderId) ?? [];
      bucket.push(row);
      bySalesOrderId.set(row.salesOrderId, bucket);
    });

  return bySalesOrderId;
}

function openLinkedManufacturingOrders<T extends SalesLinkedManufacturingOrder>(
  orders: T[]
) {
  return orders.filter((order) => order.status === "open");
}

function serializeLinkedManufacturingOrder(
  order: LinkedManufacturingOrderRead
): SalesLinkedManufacturingOrder {
  return {
    id: order.id,
    salesOrderLineId: order.salesOrderLineId,
    orderNumber: order.orderNumber,
    productName: order.productName,
    productSku: order.productSku,
    plannedQuantity: order.plannedQuantity,
    actualQuantity: order.actualQuantity,
    unitName: order.unitName,
    plannedDate: order.plannedDate,
    priorityRank: order.priorityRank,
    status: order.status,
    productionStatus: order.productionStatus,
    manufacturingMode: order.manufacturingMode,
    numberOfBatches: order.numberOfBatches,
    completedBatchCount: order.completedBatchCount,
    linkSource: order.linkSource,
  };
}

function buildShippingReadiness({
  status,
  hasManufacturableLines,
  linkedManufacturingOrders,
  stockBlockers = [],
}: {
  status: SalesOrderDetail["status"] | SalesOrderListRow["status"];
  hasManufacturableLines: boolean;
  linkedManufacturingOrders: LinkedManufacturingStatus[];
  stockBlockers?: string[];
}): SalesShippingReadiness {
  if (status === "done") {
    return {
      state: "shipped",
      message: "Order has already shipped.",
      blockers: [],
    };
  }

  if (status !== "open") {
    return {
      state: "not_confirmed",
      message: "Order is not open.",
      blockers: ["Order is not open"],
    };
  }

  const openManufacturingOrders = linkedManufacturingOrders.filter(
    (order) => order.status === "open"
  );

  if (openManufacturingOrders.length > 0) {
    return {
      state: "in_production",
      message: "Production is still open for this order.",
      blockers: openManufacturingOrders.map(
        (order) => `${order.orderNumber} is ${order.productionStatus.replace("_", " ")}`
      ),
    };
  }

  if (stockBlockers.length > 0) {
    if (hasManufacturableLines) {
      return {
        state: "needs_manufacturing",
        message: "Create manufacturing orders or replenish stock before shipping.",
        blockers: stockBlockers,
      };
    }

    return {
      state: "insufficient_stock",
      message: "Stock is short for one or more lines.",
      blockers: stockBlockers,
    };
  }

  return {
    state: "ready",
    message: "Allocated.",
    blockers: [],
  };
}

async function resolveBolContactInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const [contact] = await tx
    .select({
      name: customerContacts.name,
      title: customerContacts.title,
      email: customerContacts.email,
      phone: customerContacts.phone,
    })
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        isNull(customerContacts.deletedAt)
      )
    )
    .orderBy(
      desc(customerContacts.receivesShipping),
      desc(customerContacts.isOnSite),
      desc(customerContacts.isPrimary),
      asc(customerContacts.name)
    )
    .limit(1);

  return {
    contactName: contact?.name ?? null,
    contactTitle: contact?.title ?? null,
    contactEmail: contact?.email ?? customer?.email ?? null,
    contactPhone: contact?.phone ?? customer?.phone ?? null,
  };
}

async function getSalesLotPickPlansByLineInTx(
  tx: Tx,
  orgId: string,
  lines: SalesOrderDetailLine[]
) {
  const plans = new Map<string, LotPickPlanEntry[]>();
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const lotTrackedItemIds =
    itemIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await tx
              .select({ itemId: items.id })
              .from(items)
              .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
              .where(
                and(
                  eq(items.organizationId, orgId),
                  inArray(items.id, itemIds),
                  eq(itemFamilies.lotTrackingMode, "tracked")
                )
              )
          ).map((row) => row.itemId)
        );
  const lotTrackedLines = lines.filter((line) => lotTrackedItemIds.has(line.itemId));
  for (const line of lines) {
    if (!lotTrackedItemIds.has(line.itemId)) {
      plans.set(line.id, []);
    }
  }
  const manufacturingSourceIds = [
    ...new Set(
      lotTrackedLines.flatMap((line) =>
        line.allocationSources
          .filter(
            (source) => source.sourceType === "manufacturing_order" && source.sourceId
          )
          .map((source) => source.sourceId as string)
      )
    ),
  ];
  const linkedManufacturingRows =
    lotTrackedLines.length === 0
      ? []
      : await tx
          .select({
            id: manufacturingOrders.id,
            salesOrderLineId: manufacturingOrders.salesOrderLineId,
            orderNumber: manufacturingOrders.orderNumber,
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
              "plannedQuantity"
            ),
          })
          .from(manufacturingOrders)
          .where(
            and(
              inArray(
                manufacturingOrders.salesOrderLineId,
                lotTrackedLines.map((line) => line.id)
              ),
              isNull(manufacturingOrders.deletedAt),
              inArray(manufacturingOrders.status, ["open", "done"])
            )
          )
          .orderBy(
            asc(manufacturingOrders.plannedDate),
            asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
            asc(manufacturingOrders.orderNumber)
          );
  const linkedManufacturingRowsByLineId = new Map<
    string,
    Array<(typeof linkedManufacturingRows)[number]>
  >();
  for (const row of linkedManufacturingRows) {
    if (!row.salesOrderLineId) continue;
    linkedManufacturingRowsByLineId.set(row.salesOrderLineId, [
      ...(linkedManufacturingRowsByLineId.get(row.salesOrderLineId) ?? []),
      row,
    ]);
  }
  for (const row of linkedManufacturingRows) {
    if (!manufacturingSourceIds.includes(row.id)) {
      manufacturingSourceIds.push(row.id);
    }
  }
  const outputRows =
    manufacturingSourceIds.length === 0
      ? []
      : await tx
          .select({
            manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
            lotId: manufacturingOrderOutputs.lotId,
            lotNumber: lots.lotNumber,
            quantity: trimScale(manufacturingOrderOutputs.quantity).as("quantity"),
          })
          .from(manufacturingOrderOutputs)
          .innerJoin(lots, eq(lots.id, manufacturingOrderOutputs.lotId))
          .where(
            and(
              inArray(
                manufacturingOrderOutputs.manufacturingOrderId,
                manufacturingSourceIds
              ),
              eq(manufacturingOrderOutputs.disposition, "available"),
              sql`${manufacturingOrderOutputs.quantity} > 0`
            )
          )
          .orderBy(asc(manufacturingOrderOutputs.createdAt));
  const outputRowsByMoId = new Map<
    string,
    Array<(typeof outputRows)[number] & { remainingQuantity: number }>
  >();

  for (const row of outputRows) {
    const rows = outputRowsByMoId.get(row.manufacturingOrderId) ?? [];
    rows.push({
      ...row,
      remainingQuantity: Number(row.quantity),
    });
    outputRowsByMoId.set(row.manufacturingOrderId, rows);
  }

  for (const line of lotTrackedLines) {
    const plan: LotPickPlanEntry[] = [];
    const unavailableByLotId = new Map<string, number>();
    let coveredQuantity = 0;
    const remainingQuantity = Number(line.remainingQuantity);
    const explicitManufacturingSourceIds = new Set(
      line.allocationSources
        .filter((source) => source.sourceType === "manufacturing_order")
        .map((source) => source.sourceId)
    );
    const linkedSources = (linkedManufacturingRowsByLineId.get(line.id) ?? [])
      .filter((source) => !explicitManufacturingSourceIds.has(source.id))
      .map((source) => ({
        sourceType: "manufacturing_order" as const,
        sourceId: source.id,
        label: source.orderNumber,
        quantity: normalizeNumeric(
          Math.min(Number(source.plannedQuantity), remainingQuantity)
        ),
        coverageKind: "explicit" as const,
      }));

    for (const source of [...linkedSources, ...line.allocationSources]) {
      const openPlanQty = roundQuantity(remainingQuantity - coveredQuantity);
      if (openPlanQty <= 0) break;
      const quantity = Math.min(Number(source.quantity), openPlanQty);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      coveredQuantity = roundQuantity(coveredQuantity + quantity);

      if (source.sourceType === "inventory_lot") {
        if (source.sourceId) {
          unavailableByLotId.set(
            source.sourceId,
            roundQuantity((unavailableByLotId.get(source.sourceId) ?? 0) + quantity)
          );
        }
        plan.push({
          lotId: source.sourceId,
          lotNumber: source.label,
          quantity: source.quantity,
          unitName: line.unitName,
          sourceType: "inventory_lot",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "allocated",
          status: "ready",
        });
        continue;
      }

      const producedLots = source.sourceId
        ? outputRowsByMoId.get(source.sourceId) ?? []
        : [];
      let remainingSourceQuantity = quantity;
      for (const producedLot of producedLots) {
        if (remainingSourceQuantity <= 0) break;
        const lotQuantity = roundQuantity(
          Math.min(producedLot.remainingQuantity, remainingSourceQuantity)
        );
        if (lotQuantity <= 0) continue;
        plan.push({
          lotId: producedLot.lotId,
          lotNumber: producedLot.lotNumber,
          quantity: normalizeNumeric(lotQuantity),
          unitName: line.unitName,
          sourceType: "manufacturing_order",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "production",
          status: "ready",
        });
        remainingSourceQuantity = roundQuantity(
          remainingSourceQuantity - lotQuantity
        );
        producedLot.remainingQuantity = roundQuantity(
          producedLot.remainingQuantity - lotQuantity
        );
      }
      if (remainingSourceQuantity > 0) {
        plan.push({
          lotId: null,
          lotNumber: null,
          quantity: normalizeNumeric(remainingSourceQuantity),
          unitName: line.unitName,
          sourceType: "manufacturing_order",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "production",
          status: "waiting",
        });
      }
    }

    const fifoQuantity = roundQuantity(remainingQuantity - coveredQuantity);
    if (fifoQuantity > 0) {
      plan.push(
        ...(await buildFifoLotPickPlanInTx(tx, {
          organizationId: orgId,
          itemId: line.itemId,
          quantity: fifoQuantity,
          unitName: line.unitName,
          unavailableByLotId,
        }))
      );
    }

    plans.set(line.id, plan);
  }

  return plans;
}

function deriveDemandQueueSalesItemsState(params: {
  remainingQty: number;
  shortQty: number;
  expectedQty: number;
}): SalesOrderFulfillmentSummary["salesItemsState"] {
  if (params.remainingQty <= 0) return "complete";
  if (params.shortQty > 0) return "not_available";
  if (params.expectedQty > 0) return "expected";
  return "available";
}

function latestExpectedDate(
  current: string | null,
  next: string | null | undefined
) {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

function demandQueueCoverageToSalesAllocationSummary(params: {
  lineId: string;
  itemId: string;
  remainingQty: number;
  coverage: DemandQueueCoverageDemand | undefined;
}): SalesAllocationLineSummary {
  const queueCoveredQty = roundQuantity(
    Number(params.coverage?.queueCoveredQty ?? 0)
  );
  const shortQty = roundQuantity(
    Number(params.coverage?.shortQty ?? params.remainingQty)
  );
  const expectedQty = roundQuantity(Number(params.coverage?.expectedQty ?? 0));
  const sources: SalesAllocationLineSummary["sources"] =
    params.coverage?.segments.flatMap((segment) => {
      if (
        segment.kind === "short" ||
        !segment.sourceId ||
        (segment.sourceType !== "inventory_lot" &&
          segment.sourceType !== "manufacturing_order")
      ) {
        return [];
      }

      return [
        {
          sourceType: segment.sourceType,
          sourceId: segment.sourceId,
          label: segment.sourceLabel ?? "\u2014",
          quantity: segment.qty,
          coverageKind: "explicit" as const,
        },
      ];
    }) ?? [];
  const sourceSummary =
    sources.length > 0
      ? sources.map((source) => `${source.label} ${source.quantity}`).join(", ")
      : "\u2014";

  return {
    demandType: "sales_order_line",
    demandId: params.lineId,
    salesOrderLineId: params.lineId,
    itemId: params.itemId,
    allocatedQty: normalizeNumeric(queueCoveredQty),
    shortQty: normalizeNumeric(shortQty),
    sourceSummary,
    status:
      queueCoveredQty <= 0
        ? "short"
        : shortQty > 0
          ? "partial"
          : expectedQty > 0 ||
              sources.some((source) => source.sourceType === "manufacturing_order")
            ? "waiting_production"
            : "ready",
    sources,
  };
}

export async function getSalesOrderItemOptions(): Promise<SalesOrderItemOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        name: items.name,
        familyName: itemFamilies.name,
        sellable: items.sellable,
        sku: items.sku,
        category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
        unitName: unitDefinitions.name,
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        stock: stockSubquery,
        demandQty: demandQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(
        and(
          inArray(items.itemType, ["product", "material"]),
          isNull(items.deletedAt),
          isNotNull(items.familyId),
          sql`(${items.itemType} != 'product' OR ${items.sellable} = true)`,
        )
      )
      .orderBy(asc(items.name));

    const rowIds = rows.map((row) => row.id);
    const [optionLabelsByItemId, variantValuesByItemId] = await Promise.all([
      getSalesOptionLabelsByItemIdInTx(tx, rowIds),
      getSalesVariantValuesByItemIdInTx(tx, rowIds),
    ]);

    return rows
      .map((row) => {
        const displayName = formatSalesItemDisplayName(
          row.name,
          row.familyName,
          optionLabelsByItemId.get(row.id) ?? []
        );

        return {
          id: row.id,
          itemType: row.itemType as SalesOrderItemOption["itemType"],
          name: row.name,
          displayName,
          sku: row.sku,
          category: row.category,
          unitName: row.unitName,
          variantValues: variantValuesByItemId.get(row.id) ?? [],
          defaultSellingPrice: row.defaultSellingPrice,
          estimatedUnitCost: null,
          stock: row.stock,
          demandQty: row.demandQty,
          availableQty: row.availableQty,
          expectedQty: row.expectedQty,
          safetyStock: row.safetyStock,
        } satisfies SalesOrderItemOption;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  return measureObservedOperation(
    "sales.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx, orgId) => {
        const orderRows = await tx
          .select({
            id: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            customerId: salesOrders.customerId,
            customerName: salesOrders.customerName,
            customerEmail: customers.email,
            customerProjectId: salesOrders.customerProjectId,
            customerProjectName: customerProjects.name,
            notes: salesOrders.notes,
            status: salesOrders.status,
            priorityRank: salesOrders.priorityRank,
            orderDate: salesOrders.orderDate,
            shipDate: salesOrders.shipDate,
            requestedDate: salesOrders.requestedDate,
            shippedAt: salesOrders.shippedAt,
            totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
            deletedAt: salesOrders.deletedAt,
            createdAt: salesOrders.createdAt,
            updatedAt: salesOrders.updatedAt,
          })
          .from(salesOrders)
          .leftJoin(customers, eq(salesOrders.customerId, customers.id))
          .leftJoin(
            customerProjects,
            and(
              eq(salesOrders.customerProjectId, customerProjects.id),
              isNull(customerProjects.deletedAt)
            )
          )
          .where(isNull(salesOrders.deletedAt))
          .orderBy(
            sql`${salesOrders.priorityRank} IS NULL`,
            asc(salesOrders.priorityRank),
            asc(salesOrders.shipDate),
            desc(salesOrders.createdAt),
            asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
            asc(salesOrders.orderNumber),
            asc(salesOrders.id)
          );

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const manufacturingSummaries = await getSalesOrderManufacturingSummariesInTx(
          tx,
          orderIds
        );
        const linkedManufacturingOrdersBySalesOrderId =
          await getLinkedManufacturingOrdersBySalesOrderIdInTx(tx, orderIds);
        const shippedByLine = new Map<string, number>();
        const plannedByLine = new Map<string, number>();

        const orderById = new Map(orderRows.map((order) => [order.id, order]));
        const availabilityLineRows = await tx
          .select({
            salesOrderId: salesOrderLines.salesOrderId,
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            quantity: trimScale(salesOrderLines.quantity).as("quantity"),
            shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as("shippedQuantity"),
            sortOrder: salesOrderLines.sortOrder,
          })
          .from(salesOrderLines)
          .where(inArray(salesOrderLines.salesOrderId, orderIds))
          .orderBy(asc(salesOrderLines.salesOrderId), asc(salesOrderLines.sortOrder));
        const demandQueueCoverageByDemandKey =
          await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
            organizationId: orgId,
            itemIds: availabilityLineRows.map((line) => line.itemId),
            includeManufacturingDetail: false,
          });
        const demandQueueCoverageBySalesLineId = new Map(
          [...demandQueueCoverageByDemandKey.values()]
            .filter((coverage) => coverage.demandType === "sales_order_line")
            .map((coverage) => [coverage.demandId, coverage])
        );
        const orderedQuantityByLineId = new Map(
          availabilityLineRows.map((line) => [line.salesOrderLineId, line.quantity])
        );
        availabilityLineRows.forEach((line) => {
          shippedByLine.set(line.salesOrderLineId, normalizeShipQuantity(Number(line.shippedQuantity)));
        });
        const demandLines = availabilityLineRows.flatMap((line) => {
          const order = orderById.get(line.salesOrderId);
          if (!order || order.status !== "open") return [];

          const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
          const remainingQty = normalizeShipQuantity(
            Number(line.quantity) - shippedQty
          );
          if (!Number.isFinite(remainingQty) || remainingQty <= 0) {
            return [];
          }

          return [
            {
              salesOrderId: line.salesOrderId,
              salesOrderLineId: line.salesOrderLineId,
              itemId: line.itemId,
              requiredDate: order.shipDate,
              quantity: remainingQty,
              priorityRank: order.priorityRank,
              orderDate: order.orderDate,
              orderNumber: order.orderNumber,
              sortOrder: line.sortOrder,
            } satisfies SalesFulfillmentDemandLine,
          ];
        });
        const fulfillmentTotalsByOrderId = new Map<
          string,
          {
            remainingQty: number;
            allocatedQty: number;
            shortQty: number;
            expectedQty: number;
            expectedDate: string | null;
            productionAllocatedQty: number;
          }
        >();
        const salesLinesByOrderId = new Map<
          string,
          SalesOrderManufacturingLineSummary[]
        >();
        for (const order of orderRows) {
          const manufacturingSummary = manufacturingSummaries.get(order.id);
          const salesLines = (manufacturingSummary?.lines ?? []).map((line) => ({
            ...line,
            quantity: orderedQuantityByLineId.get(line.salesOrderLineId) ?? line.quantity,
          }));
          salesLinesByOrderId.set(order.id, salesLines);
          fulfillmentTotalsByOrderId.set(
            order.id,
            salesLines.reduce<{
              remainingQty: number;
              allocatedQty: number;
              shortQty: number;
              expectedQty: number;
              expectedDate: string | null;
              productionAllocatedQty: number;
            }>(
              (acc, line) => {
                const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
                const remainingQty = normalizeShipQuantity(
                  Number(line.quantity) - shippedQty
                );
                const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
                  line.salesOrderLineId
                );
                const demandQueueInStockQty = Number(
                  demandQueueCoverage?.inStockQty ?? 0
                );
                const demandQueueExpectedQty = Number(
                  demandQueueCoverage?.expectedQty ?? 0
                );
                const demandQueueShortQty = Number(
                  demandQueueCoverage?.shortQty ?? remainingQty
                );
                acc.remainingQty += remainingQty;
                acc.allocatedQty += roundQuantity(
                  demandQueueInStockQty + demandQueueExpectedQty
                );
                acc.shortQty += demandQueueShortQty;
                acc.expectedQty += demandQueueExpectedQty;
                if (demandQueueExpectedQty > 0) {
                  acc.expectedDate = latestExpectedDate(
                    acc.expectedDate,
                    demandQueueCoverage?.latestExpectedDate
                  );
                }
                const allocation = demandQueueCoverageToSalesAllocationSummary({
                  lineId: line.salesOrderLineId,
                  itemId: line.itemId,
                  remainingQty,
                  coverage: demandQueueCoverage,
                });
                acc.productionAllocatedQty +=
                  allocation.sources
                    .filter((source) => source.sourceType === "manufacturing_order")
                    .reduce((sum, source) => sum + Number(source.quantity), 0) ?? 0;
                return acc;
              },
              {
                remainingQty: 0,
                allocatedQty: 0,
                shortQty: 0,
                expectedQty: 0,
                expectedDate: null,
                productionAllocatedQty: 0,
              }
            )
          );
        }
        const fulfillmentReadModels = await getSalesFulfillmentReadModelsInTx(
          tx,
          orgId,
          orderRows.map((order) => {
            const manufacturingSummary = manufacturingSummaries.get(order.id);
            const totals = fulfillmentTotalsByOrderId.get(order.id);
            return {
              id: order.id,
              status: order.status,
              hasManufacturableLines:
                manufacturingSummary?.hasManufacturableLines ?? false,
              shortQty: totals?.shortQty ?? 0,
              productionAllocatedQty: totals?.productionAllocatedQty ?? 0,
              linkedManufacturingOrders:
                linkedManufacturingOrdersBySalesOrderId.get(order.id) ?? [],
              manufacturableLines: manufacturingSummary?.lines ?? [],
            };
          }),
          demandLines
        );

        return orderRows.map((order) => {
          const manufacturingSummary = manufacturingSummaries.get(order.id);
          const salesLines = salesLinesByOrderId.get(order.id) ?? [];
          const fulfillmentReadModel = fulfillmentReadModels.get(order.id);
          const fulfillmentTotals = fulfillmentTotalsByOrderId.get(order.id) ?? {
            remainingQty: 0,
            allocatedQty: 0,
            shortQty: 0,
            expectedQty: 0,
            expectedDate: null,
            productionAllocatedQty: 0,
          };
          const hasManufacturableLines =
            manufacturingSummary?.hasManufacturableLines ?? false;
          const linkedManufacturingOrders =
            linkedManufacturingOrdersBySalesOrderId.get(order.id) ?? [];
          const openManufacturingOrders = openLinkedManufacturingOrders(
            linkedManufacturingOrders
          ).map(serializeLinkedManufacturingOrder);
          const stockBlockers = salesLines.flatMap((line) => {
            const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
            const remainingQty = normalizeShipQuantity(
              Number(line.quantity) - shippedQty
            );
            const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
              line.salesOrderLineId
            );
            const shortQty = roundQuantity(
              Number(demandQueueCoverage?.shortQty ?? remainingQty)
            );

            if (!Number.isFinite(shortQty) || shortQty <= 0) {
              return [];
            }

            const inStockQty = demandQueueCoverage?.inStockQty ?? "0";
            const expectedQty = demandQueueCoverage?.expectedQty ?? "0";
            const coveredQty = normalizeNumeric(
              roundQuantity(Number(inStockQty) + Number(expectedQty))
            );

            return [
              `${line.itemName} needs ${formatQuantity(normalizeNumeric(remainingQty))} ${line.unitName}; ${formatQuantity(
                coveredQty
              )} ${line.unitName} covered`,
            ];
          });

          return {
            ...order,
            status: order.status as SalesOrderListRow["status"],
            itemSummary: summarizeItems(salesLines),
            lines: salesLines.map((line) => {
              const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
              const remainingQty = normalizeShipQuantity(
                Number(line.quantity) - shippedQty
              );
              const unplannedQty = normalizeShipQuantity(
                remainingQty - (plannedByLine.get(line.salesOrderLineId) ?? 0)
              );
              const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
                line.salesOrderLineId
              );
              const allocation = demandQueueCoverageToSalesAllocationSummary({
                lineId: line.salesOrderLineId,
                itemId: line.itemId,
                remainingQty,
                coverage: demandQueueCoverage,
              });

              return {
                id: line.salesOrderLineId,
                itemId: line.itemId,
                itemType: line.itemType,
                masterName: line.masterName,
                attrs: line.attrs,
                itemSku: line.itemSku,
                quantity: line.quantity,
                shippedQuantity: normalizeNumeric(shippedQty),
                remainingQty: normalizeNumeric(remainingQty),
                allocatedQty: allocation.allocatedQty,
                shortQty: allocation.shortQty,
                sourceSummary: allocation.sourceSummary,
                allocationSources: allocation.sources,
                allocationStatus: allocation.status,
                demandQueueQueueCoveredQty:
                  demandQueueCoverage?.queueCoveredQty ?? "0",
                demandQueueSegments: demandQueueCoverage?.segments ?? [],
                demandQueueInStockQty: demandQueueCoverage?.inStockQty ?? "0",
                demandQueueExpectedQty: demandQueueCoverage?.expectedQty ?? "0",
                demandQueueShortQty:
                  demandQueueCoverage?.shortQty ?? normalizeNumeric(remainingQty),
                demandQueueExpectedDate:
                  demandQueueCoverage?.latestExpectedDate ?? null,
                unplannedAllocatedQty: allocation.allocatedQty,
                unplannedShortQty: normalizeNumeric(unplannedQty),
                unplannedSourceSummary: allocation.sourceSummary,
                unplannedAllocationStatus: allocation.status,
                unitName: line.unitName,
              };
            }),
            fulfillmentSummary: (() => {
              const allocated = normalizeNumeric(
                roundQuantity(fulfillmentTotals.allocatedQty)
              );
              const remaining = normalizeNumeric(
                roundQuantity(fulfillmentTotals.remainingQty)
              );
              const short = normalizeNumeric(roundQuantity(fulfillmentTotals.shortQty));
              const salesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
                deriveDemandQueueSalesItemsState(fulfillmentTotals);
              const salesItemsExpectedDate =
                salesItemsState === "expected"
                  ? fulfillmentTotals.expectedDate
                  : null;
              return {
                remainingQty: remaining,
                allocatedQty: allocated,
                shortQty: short,
                productionAllocatedQty: normalizeNumeric(
                  roundQuantity(fulfillmentTotals.productionAllocatedQty)
                ),
                availabilityState: salesItemsState,
                expectedDate: salesItemsExpectedDate,
                label: getAvailabilityLabel(
                  salesItemsState,
                  salesItemsExpectedDate
                ),
                salesItemsState,
                salesItemsExpectedDate,
                ingredientsState:
                  fulfillmentReadModel?.ingredientsState ?? "not_applicable",
                ingredientsExpectedDate:
                  fulfillmentReadModel?.ingredientsExpectedDate ?? null,
                ingredientShortages:
                  fulfillmentReadModel?.ingredientShortages.map(
                    serializeIngredientShortage
                  ) ?? [],
                productionState:
                  fulfillmentReadModel?.productionState ?? "not_applicable",
              };
            })(),
            hasManufacturableLines,
            manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
            manufacturableDisabledReason:
              manufacturingSummary?.disabledReason ??
              "No manufacturable lines remain on this order.",
            openManufacturingOrderCount: openManufacturingOrders.length,
            linkedManufacturingOrders,
            openManufacturingOrders,
            shippingReadiness: buildShippingReadiness({
              status: order.status as SalesOrderListRow["status"],
              hasManufacturableLines,
              linkedManufacturingOrders: openManufacturingOrders,
              stockBlockers,
            }),
          };
        });
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    }
  );
}

export async function getOpenSalesProductItemIds(): Promise<string[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const rows = await tx
      .selectDistinct({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .innerJoin(items, eq(salesOrderLines.itemId, items.id))
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          eq(salesOrders.status, "open"),
          isNull(salesOrders.deletedAt),
          eq(items.itemType, "product"),
          sql`${salesOrderLines.quantity} > ${salesOrderLines.cancelledQuantity}`
        )
      );

    return rows.map((row) => row.itemId);
  });
}

export async function getSalesShippingQueue(): Promise<SalesShippingQueueRow[]> {
  const orders = await getSalesOrders();
  const queueCandidates = orders.filter((order) => order.status === "open");

  const details = await Promise.all(
    queueCandidates.map((order) => getSalesOrder(order.id))
  );

  return details.flatMap((order) => {
    if (!order) return [];
    if (order.status !== "open") {
      return [];
    }
    const openManufacturingOrders = order.linkedManufacturingOrders.filter(
      (manufacturingOrder) =>
        manufacturingOrder.status === "open"
    );

    return [
      {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: order.status,
        deliveryDate: order.shipDate,
        requestedDate: order.shipDate,
        shipDate: order.shipDate,
        notes: order.notes,
        shipLine1: order.shipLine1,
        shipLine2: order.shipLine2,
        shipCity: order.shipCity,
        shipRegion: order.shipRegion,
        shipPostcode: order.shipPostcode,
        shipCountry: order.shipCountry,
        shippingReadiness: order.shippingReadiness,
        lines: order.lines,
        openManufacturingOrders,
      } satisfies SalesShippingQueueRow,
    ];
  });
}

export async function getSalesOrderInTx(
  tx: Tx,
  orgId: string,
  id: string,
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider }
): Promise<SalesOrderDetail | null> {
    const orderConditions = [eq(salesOrders.id, id)];
    if (!options?.includeDeleted) {
      orderConditions.push(isNull(salesOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        customerEmail: customers.email,
        customerProjectId: salesOrders.customerProjectId,
        customerProjectName: customerProjects.name,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        version: salesOrders.version,
        priorityRank: salesOrders.priorityRank,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shippedAt: salesOrders.shippedAt,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        billingLine1: salesOrders.billingLine1,
        billingLine2: salesOrders.billingLine2,
        billingCity: salesOrders.billingCity,
        billingRegion: salesOrders.billingRegion,
        billingPostcode: salesOrders.billingPostcode,
        billingCountry: salesOrders.billingCountry,
        shippingFeeDescription: salesOrders.shippingFeeDescription,
        shippingFeeAmount: trimScale(salesOrders.shippingFeeAmount).as("shippingFeeAmount"),
        shippingFeeTaxAmount: trimScale(salesOrders.shippingFeeTaxAmount).as("shippingFeeTaxAmount"),
        subtotalAmount: trimScale(salesOrders.subtotalAmount).as("subtotalAmount"),
        taxAmount: trimScale(salesOrders.taxAmount).as("taxAmount"),
        xeroInvoiceId: accountingDocumentSyncs.externalDocumentId,
        xeroInvoiceNumber: accountingDocumentSyncs.externalDocumentNumber,
        xeroPushStatus: accountingDocumentSyncs.pushStatus,
        xeroPushError: accountingDocumentSyncs.pushError,
        xeroPushedAt: accountingDocumentSyncs.pushedAt,
        xeroPushPayloadHash: accountingDocumentSyncs.pushPayloadHash,
        xeroLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
        xeroRetryCount: sql<number>`COALESCE(${accountingDocumentSyncs.retryCount}, 0)`,
        xeroEmailStatus: accountingDocumentSyncs.emailStatus,
        xeroEmailError: accountingDocumentSyncs.emailError,
        xeroEmailedAt: accountingDocumentSyncs.emailedAt,
        totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .leftJoin(customers, eq(salesOrders.customerId, customers.id))
      .leftJoin(
        customerProjects,
        and(
          eq(salesOrders.customerProjectId, customerProjects.id),
          isNull(customerProjects.deletedAt)
        )
      )
      .leftJoin(
        accountingDocumentSyncs,
        and(
          eq(
            accountingDocumentSyncs.provider,
            options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO
          ),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_SALES_ORDER),
          eq(accountingDocumentSyncs.documentId, salesOrders.id)
        )
      )
      .where(and(...orderConditions));

    if (!order) {
      return null;
    }

    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        unitName: salesOrderLines.unitName,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as(
          "shippedQuantity"
        ),
        cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
          "cancelledQuantity"
        ),
        listUnitPrice: trimScaleNullable(salesOrderLines.listUnitPrice).as(
          "listUnitPrice"
        ),
        unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
        taxRateId: salesOrderLines.taxRateId,
        taxRateName: salesOrderLines.taxRateName,
        taxRatePercent: trimScale(salesOrderLines.taxRatePercent).as("taxRatePercent"),
        discountPercent: trimScale(salesOrderLines.discountPercent).as(
          "discountPercent"
        ),
        suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
          "suggestedUnitPrice"
        ),
        pricingSourceType: salesOrderLines.pricingSourceType,
        pricingScheduleName: salesOrderLines.pricingScheduleName,
        pricingBreakLabel: salesOrderLines.pricingBreakLabel,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
        lineSubtotal: trimScale(salesOrderLines.lineSubtotal).as("lineSubtotal"),
        lineTaxAmount: trimScale(salesOrderLines.lineTaxAmount).as("lineTaxAmount"),
        lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
        sortOrder: salesOrderLines.sortOrder,
        createdAt: salesOrderLines.createdAt,
        updatedAt: salesOrderLines.updatedAt,
        familyName: itemFamilies.name,
        onHandQty: trimScaleNullable(
          projectedOnHandQtyExpr(items.organizationId, items.id)
        ).as("onHandQty"),
        availableQty: availableQtySubquery,
        allocatedQty: sql<string>`'0'`.as("allocatedQty"),
        potential: projectedPotentialQty(
          items.organizationId,
          items.id,
          items.itemType
        ).as("potential"),
      })
      .from(salesOrderLines)
      .leftJoin(items, eq(salesOrderLines.itemId, items.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    const [estimatedUnitCosts, actualLineCosts, optionLabelsByItemId, taxSettings] =
      await Promise.all([
        getEstimatedUnitCostsByItemIdInTx(
          tx,
          lineRows.map((line) => line.itemId),
        ),
        getActualSalesLineCostsByLineIdInTx(tx, id),
        getSalesOptionLabelsByItemIdInTx(
          tx,
          lineRows.map((line) => line.itemId),
        ),
        getTaxSettingsInTx(tx, orgId),
      ]);

    const lines = lineRows.map(({ familyName, ...rest }) => {
      const optionLabels = optionLabelsByItemId.get(rest.itemId) ?? [];
      const display = {
        masterName: familyName ?? rest.itemName,
        attrs: optionLabels,
      };
      const estimatedUnitCost = estimatedUnitCosts.get(rest.itemId) ?? null;
      const estimatedMargin = calculateUnitMarginMetrics({
        quantity: rest.quantity,
        unitPrice: rest.unitPrice,
        unitCost: estimatedUnitCost,
      });
      const actualCost = actualLineCosts.get(rest.id) ?? null;
      const actualMargin = actualCost
          ? calculateMarginMetrics({
            revenue: rest.lineSubtotal,
            cogs: actualCost.cogs,
          })
        : null;
      const actualQuantity = actualCost ? Number.parseFloat(actualCost.quantity) : null;
      const actualCogs = actualCost ? Number.parseFloat(actualCost.cogs) : null;
      const actualUnitCost =
        actualQuantity != null &&
        actualCogs != null &&
        Number.isFinite(actualQuantity) &&
        Number.isFinite(actualCogs) &&
        actualQuantity > 0
          ? normalizeNumericScale(actualCogs / actualQuantity, 6)
          : null;

      return {
        ...rest,
        masterName: display.masterName,
        attrs: display.attrs,
        estimatedUnitCost,
        estimatedCogs: estimatedMargin?.cogs ?? null,
        estimatedGrossProfit: estimatedMargin?.grossProfit ?? null,
        estimatedMarginPercent: estimatedMargin?.marginPercent ?? null,
        actualUnitCost,
        actualCogs: actualMargin?.cogs ?? null,
        actualGrossProfit: actualMargin?.grossProfit ?? null,
        actualMarginPercent: actualMargin?.marginPercent ?? null,
      };
    });
    const shippedByLine = new Map<string, number>();
    const plannedByLine = new Map<string, number>();
    for (const line of lines) {
      shippedByLine.set(line.id, normalizeShipQuantity(Number(line.shippedQuantity ?? 0)));
    }
    const orderFreightRecovery = parseMoneyValue(order.shippingFeeAmount);
    const orderProductCogs = order.status === "done"
      ? lines.some((line) => line.actualCogs == null)
        ? null
        : lines.reduce((sum, line) => sum + parseMoneyValue(line.actualCogs), 0)
      : lines.some((line) => line.estimatedCogs == null)
        ? null
        : lines.reduce((sum, line) => sum + parseMoneyValue(line.estimatedCogs), 0);
    const orderMarginSummary = buildSalesMarginSummary({
      productRevenue: lines.reduce(
        (sum, line) => sum + parseMoneyValue(line.lineSubtotal),
        0
      ),
      freightRecovery: orderFreightRecovery,
      productCogs: orderProductCogs,
      fulfillmentCosts: 0,
      costStatus: orderProductCogs == null
        ? "unknown"
        : order.status === "done"
          ? "actual"
          : "estimated",
    });

    const linesWithFulfillment = lines.map((line) => {
      const shippedQuantity = shippedByLine.get(line.id) ?? 0;
      const plannedQuantity = plannedByLine.get(line.id) ?? 0;
      const cancelledQuantity = parseFloat(line.cancelledQuantity);
      const orderedQuantity = parseFloat(line.quantity);
      const remainingQuantity = normalizeShipQuantity(
        orderedQuantity - shippedQuantity - cancelledQuantity
      );
      const unplannedRemainingQuantity = normalizeShipQuantity(
        remainingQuantity - plannedQuantity
      );

      return {
        ...line,
        reservationAllocatedQty: line.allocatedQty,
        shippedQuantity: normalizeNumeric(shippedQuantity),
        plannedQuantity: normalizeNumeric(plannedQuantity),
        cancelledQuantity: normalizeNumeric(cancelledQuantity),
        remainingQuantity: normalizeNumeric(remainingQuantity),
        unplannedRemainingQuantity: normalizeNumeric(unplannedRemainingQuantity),
      };
    });
    const demandQueueCoverageByDemandKey =
      await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
        organizationId: orgId,
        itemIds: linesWithFulfillment.map((line) => line.itemId),
        includeManufacturingDetail: false,
      });
    const demandQueueCoverageBySalesLineId = new Map(
      [...demandQueueCoverageByDemandKey.values()]
        .filter((coverage) => coverage.demandType === "sales_order_line")
        .map((coverage) => [coverage.demandId, coverage])
    );
    const linesWithAllocation = linesWithFulfillment.map((line) => {
      const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(line.id);
      const allocation = demandQueueCoverageToSalesAllocationSummary({
        lineId: line.id,
        itemId: line.itemId,
        remainingQty: Number(line.remainingQuantity),
        coverage: demandQueueCoverage,
      });

      return {
        ...line,
        allocatedQty: allocation.allocatedQty,
        shortQty: allocation.shortQty,
        sourceSummary: allocation.sourceSummary,
        allocationStatus: allocation.status,
        allocationSources: allocation.sources,
        demandQueueQueueCoveredQty:
          demandQueueCoverage?.queueCoveredQty ?? "0",
        demandQueueSegments: demandQueueCoverage?.segments ?? [],
        demandQueueInStockQty: demandQueueCoverage?.inStockQty ?? "0",
        demandQueueExpectedQty: demandQueueCoverage?.expectedQty ?? "0",
        demandQueueShortQty:
          demandQueueCoverage?.shortQty ?? line.remainingQuantity,
        demandQueueExpectedDate: demandQueueCoverage?.latestExpectedDate ?? null,
      };
    });
    let fulfillmentSummary: SalesOrderFulfillmentSummary = (() => {
      const remainingQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.remainingQuantity)),
        0
      );
      const allocatedQty = linesWithAllocation.reduce(
        (sum, line) =>
          roundQuantity(
            sum +
              Number(line.demandQueueInStockQty) +
              Number(line.demandQueueExpectedQty)
          ),
        0
      );
      const shortQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.demandQueueShortQty)),
        0
      );
      const expectedQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.demandQueueExpectedQty)),
        0
      );
      const expectedDate = linesWithAllocation.reduce<string | null>(
        (latest, line) =>
          Number(line.demandQueueExpectedQty) > 0
            ? latestExpectedDate(latest, line.demandQueueExpectedDate)
            : latest,
        null
      );
      const productionAllocatedQty = linesWithAllocation.reduce(
        (sum, line) =>
          roundQuantity(
            sum +
              line.allocationSources
                .filter((source) => source.sourceType === "manufacturing_order")
                .reduce((sourceSum, source) => sourceSum + Number(source.quantity), 0)
          ),
        0
      );
      const label =
        shortQty > 0
          ? "Short"
          : productionAllocatedQty > 0
            ? "Waiting production"
            : "Ready";
      const availabilityState: SalesOrderFulfillmentSummary["availabilityState"] =
        deriveDemandQueueSalesItemsState({ remainingQty, shortQty, expectedQty });

      return {
        remainingQty: normalizeNumeric(remainingQty),
        allocatedQty: normalizeNumeric(allocatedQty),
        shortQty: normalizeNumeric(shortQty),
        productionAllocatedQty: normalizeNumeric(productionAllocatedQty),
        availabilityState,
        expectedDate: availabilityState === "expected" ? expectedDate : null,
        label,
        salesItemsState: availabilityState,
        salesItemsExpectedDate: availabilityState === "expected" ? expectedDate : null,
        ingredientsState: "not_applicable",
        ingredientsExpectedDate: null,
        ingredientShortages: [],
        productionState: "not_applicable",
      };
    })();

    const manufacturingSummary = (
      await getSalesOrderManufacturingSummariesInTx(tx, [id])
    ).get(id);

    const linkedManufacturingOrders =
      (await getLinkedManufacturingOrdersBySalesOrderIdInTx(tx, [id])).get(id) ?? [];

    const hasManufacturableLines = manufacturingSummary?.hasManufacturableLines ?? false;
    const linkedManufacturingOrderRows = linkedManufacturingOrders.map(
      serializeLinkedManufacturingOrder
    );
    const fulfillmentReadModel = (
      await getSalesFulfillmentReadModelsInTx(
        tx,
        orgId,
        [
          {
            id,
            status: order.status,
            hasManufacturableLines,
            shortQty: Number(fulfillmentSummary.shortQty),
            productionAllocatedQty: Number(fulfillmentSummary.productionAllocatedQty),
            linkedManufacturingOrders,
            manufacturableLines: manufacturingSummary?.lines ?? [],
          },
        ],
        order.status === "open"
          ? linesWithAllocation.flatMap((line) => {
              const remainingQty = Number(line.remainingQuantity);
              if (!Number.isFinite(remainingQty) || remainingQty <= 0) return [];

              return [
                {
                  salesOrderId: id,
                  salesOrderLineId: line.id,
                  itemId: line.itemId,
                  requiredDate: order.shipDate,
                  quantity: remainingQty,
                  priorityRank: order.priorityRank,
                  orderDate: order.orderDate,
                  orderNumber: order.orderNumber,
                  sortOrder: line.sortOrder,
                } satisfies SalesFulfillmentDemandLine,
              ];
            })
          : []
      )
    ).get(id);
    const salesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
      fulfillmentSummary.salesItemsState;
    const salesItemsExpectedDate =
      salesItemsState === "expected"
        ? fulfillmentSummary.salesItemsExpectedDate
        : null;
    fulfillmentSummary = {
      ...fulfillmentSummary,
      availabilityState: salesItemsState,
      expectedDate: salesItemsExpectedDate,
      label: getAvailabilityLabel(salesItemsState, salesItemsExpectedDate),
      salesItemsState,
      salesItemsExpectedDate,
      ingredientsState: fulfillmentReadModel?.ingredientsState ?? "not_applicable",
      ingredientsExpectedDate: fulfillmentReadModel?.ingredientsExpectedDate ?? null,
      ingredientShortages:
        fulfillmentReadModel?.ingredientShortages.map(
          serializeIngredientShortage
        ) ?? [],
      productionState: fulfillmentReadModel?.productionState ?? "not_applicable",
    };
    const manufacturingLinesByLineId = new Map(
      (manufacturingSummary?.lines ?? []).map((line) => [
        line.salesOrderLineId,
        line,
      ])
    );
    const lineFulfillmentDemandLines = linesWithAllocation.flatMap((line) => {
      const remainingQty = Number(line.remainingQuantity);
      if (
        order.status !== "open" ||
        !Number.isFinite(remainingQty) ||
        remainingQty <= 0
      ) {
        return [];
      }

      return [
        {
          salesOrderId: line.id,
          salesOrderLineId: line.id,
          itemId: line.itemId,
          requiredDate: order.shipDate,
          quantity: remainingQty,
          priorityRank: order.priorityRank,
          orderDate: order.orderDate,
          orderNumber: order.orderNumber,
          sortOrder: line.sortOrder,
        } satisfies SalesFulfillmentDemandLine,
      ];
    });
    const lineFulfillmentReadModels = await getSalesFulfillmentReadModelsInTx(
      tx,
      orgId,
      linesWithAllocation.map((line) => {
        const manufacturingLine = manufacturingLinesByLineId.get(line.id);
        const linkedLineManufacturingOrders = linkedManufacturingOrders.filter(
          (linkedOrder) => linkedOrder.salesOrderLineId === line.id
        );
        const productionAllocatedQty = line.allocationSources
          .filter((source) => source.sourceType === "manufacturing_order")
          .reduce((sum, source) => sum + Number(source.quantity), 0);

        return {
          id: line.id,
          status: order.status,
          hasManufacturableLines: manufacturingLine?.status === "will_create",
          shortQty: Number(line.demandQueueShortQty),
          productionAllocatedQty,
          linkedManufacturingOrders: linkedLineManufacturingOrders,
          manufacturableLines: manufacturingLine
            ? [
                {
                  ...manufacturingLine,
                  salesOrderId: line.id,
                },
              ]
            : [],
        };
      }),
      lineFulfillmentDemandLines
    );
    const lineFulfillmentSummariesByLineId = new Map<
      string,
      SalesOrderFulfillmentSummary
    >();
    for (const line of linesWithAllocation) {
      const readModel = lineFulfillmentReadModels.get(line.id);
      const remainingQty = Number(line.remainingQuantity);
      const allocatedQty = roundQuantity(
        Number(line.demandQueueInStockQty) + Number(line.demandQueueExpectedQty)
      );
      const shortQty = Number(line.demandQueueShortQty);
      const productionAllocatedQty = roundQuantity(
        line.allocationSources
          .filter((source) => source.sourceType === "manufacturing_order")
          .reduce((sum, source) => sum + Number(source.quantity), 0)
      );
      const lineSalesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
        deriveDemandQueueSalesItemsState({
          remainingQty,
          shortQty,
          expectedQty: Number(line.demandQueueExpectedQty),
        });
      const lineSalesItemsExpectedDate =
        lineSalesItemsState === "expected"
          ? line.demandQueueExpectedDate
          : null;

      lineFulfillmentSummariesByLineId.set(line.id, {
        remainingQty: normalizeNumeric(roundQuantity(remainingQty)),
        allocatedQty: normalizeNumeric(allocatedQty),
        shortQty: normalizeNumeric(roundQuantity(shortQty)),
        productionAllocatedQty: normalizeNumeric(productionAllocatedQty),
        availabilityState: lineSalesItemsState,
        expectedDate: lineSalesItemsExpectedDate,
        label: getAvailabilityLabel(lineSalesItemsState, lineSalesItemsExpectedDate),
        salesItemsState: lineSalesItemsState,
        salesItemsExpectedDate: lineSalesItemsExpectedDate,
        ingredientsState: readModel?.ingredientsState ?? "not_applicable",
        ingredientsExpectedDate: readModel?.ingredientsExpectedDate ?? null,
        ingredientShortages:
          readModel?.ingredientShortages.map(serializeIngredientShortage) ?? [],
        productionState: readModel?.productionState ?? "not_applicable",
      });
    }
    const stockBlockers = linesWithAllocation.flatMap((line) => {
      const shortQty = Number(line.demandQueueShortQty);

      if (!Number.isFinite(shortQty) || shortQty <= 0) {
        return [];
      }

      const coveredQty = normalizeNumeric(
        roundQuantity(
          Number(line.demandQueueInStockQty) + Number(line.demandQueueExpectedQty)
        )
      );

      return [
        `${line.itemName} needs ${formatQuantity(line.remainingQuantity)} ${line.unitName}; ${formatQuantity(
          coveredQty
        )} ${line.unitName} covered`,
      ];
    });
    const linesWithLineFulfillment = linesWithAllocation.map((line) => ({
      ...line,
      fulfillmentSummary:
        lineFulfillmentSummariesByLineId.get(line.id) ?? fulfillmentSummary,
      linkedManufacturingOrders: openLinkedManufacturingOrders(
        linkedManufacturingOrders.filter(
          (linkedOrder) => linkedOrder.salesOrderLineId === line.id
        )
      ).map(serializeLinkedManufacturingOrder),
    })) as SalesOrderDetailLine[];
    const lotPickPlansByLineId = await getSalesLotPickPlansByLineInTx(
      tx,
      orgId,
      linesWithLineFulfillment
    );
    const linesWithLotGuidance = linesWithLineFulfillment.map((line) => ({
      ...line,
      lotPickPlan: lotPickPlansByLineId.get(line.id) ?? [],
    }));

    return {
      ...order,
      status: order.status as SalesOrderDetail["status"],
      xeroPushStatus: order.xeroPushStatus as SalesOrderDetail["xeroPushStatus"],
      xeroEmailStatus:
        order.xeroEmailStatus as SalesOrderDetail["xeroEmailStatus"],
      lines: linesWithLotGuidance as SalesOrderDetailLine[],
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultSalesTaxRateId,
      marginSummary: orderMarginSummary,
      hasManufacturableLines,
      manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
      manufacturableDisabledReason:
        manufacturingSummary?.disabledReason ?? "No manufacturable lines remain on this order.",
      fulfillmentSummary,
      shippingReadiness: buildShippingReadiness({
        status: order.status as SalesOrderDetail["status"],
        hasManufacturableLines,
        linkedManufacturingOrders: linkedManufacturingOrderRows,
        stockBlockers,
      }),
      linkedManufacturingOrders: linkedManufacturingOrderRows,
    };
}

export async function getSalesOrder(
  id: string,
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider }
): Promise<SalesOrderDetail | null> {
  return withAuthedOrgContext((tx, orgId) =>
    getSalesOrderInTx(tx, orgId, id, options)
  );
}

export async function getEditableSalesOrder(id: string): Promise<SalesOrderEditData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerProjectId: salesOrders.customerProjectId,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        billingLine1: salesOrders.billingLine1,
        billingLine2: salesOrders.billingLine2,
        billingCity: salesOrders.billingCity,
        billingRegion: salesOrders.billingRegion,
        billingPostcode: salesOrders.billingPostcode,
        billingCountry: salesOrders.billingCountry,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      );

    if (!order) {
      return null;
    }

    const [lines, taxSettings] = await Promise.all([
      getOrderLinesInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
    ]);

    return {
      ...order,
      status: order.status as "open",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        listUnitPrice: line.listUnitPrice,
        unitPrice: line.unitPrice,
        taxRateId: line.taxRateId,
        discountPercent: line.discountPercent,
        suggestedUnitPrice: line.suggestedUnitPrice,
        pricingSourceType: (line.pricingSourceType ??
          "base_price") as PricingSourceType,
        pricingScheduleName: line.pricingScheduleName,
        pricingBreakLabel: line.pricingBreakLabel,
        isPriceOverridden: line.isPriceOverridden,
      })),
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultSalesTaxRateId,
    };
  });
}

export type BolSalesOrderData = {
  orderNumber: string;
  customerName: string;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requestedDate: string | null;
  shippedAt: Date | null;
  notes: string | null;
  status: string;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  lines: Array<{
    itemName: string;
    itemSku: string | null;
    quantity: string;
    unitName: string;
  }>;
};

export async function getSalesOrderForBol(
  id: string
): Promise<BolSalesOrderData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        orderNumber: salesOrders.orderNumber,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        requestedDate: salesOrders.requestedDate,
        shippedAt: salesOrders.shippedAt,
        notes: salesOrders.notes,
        status: salesOrders.status,
        shipDate: salesOrders.shipDate,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));

    if (!order) return null;
    if (order.status !== "done") return null;

    const lines = await tx
      .select({
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        unitName: salesOrderLines.unitName,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder));

    const shipAddress = {
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
    };
    const contact = await resolveBolContactInTx(tx, order.customerId);

    return {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      ...contact,
      requestedDate: null,
      shippedAt: order.shippedAt,
      notes: order.notes,
      status: order.status,
      ...shipAddress,
      lines,
    };
  });
}
