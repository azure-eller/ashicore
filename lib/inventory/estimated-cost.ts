import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  inventoryLotBalances,
  items,
} from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumericScale } from "@/lib/format";
import { resolveStockUnitCostFromDefaultPurchasePrice } from "@/lib/inventory/cost";
import { calculateAverageUnitConsumptionQuantity } from "@/lib/manufacturing/consumption";
import { calculatePlannedOperationCost } from "@/lib/manufacturing/operation-costs";

export type EstimatedRecipeCostSummary = {
  ingredientsCost: string | null;
  operationsCost: string | null;
  totalCost: string | null;
};

type CostItemRow = {
  id: string;
  itemType: string;
  currentStockUnitCost: string | null;
  defaultPurchasePrice: string | null;
  purchaseToStockFactor: string | null;
  expectedBatchYield: string | null;
  typicalBatchSize: string | null;
  standardCostQuantity: string | null;
  deletedAt: Date | null;
};

type CurrentRevisionRow = {
  id: string;
  productId: string;
  recipeBasis: string;
  outputQuantity: string;
};

type ComponentRow = {
  bomRevisionId: string;
  componentId: string;
  quantity: string;
};

type OperationRow = {
  bomRevisionId: string;
  costScalingMode: "per_output_unit" | "fixed_per_mo";
  crewSize: string;
  plannedMinutes: string;
  loadedCostPerHour: string;
  plannedCostTotal: string;
};

type EstimatedCostGraph = {
  itemsById: Map<string, CostItemRow>;
  lotUnitCostByItemId: Map<string, string | null>;
  currentRevisionByProductId: Map<string, CurrentRevisionRow>;
  componentsByRevisionId: Map<string, ComponentRow[]>;
  operationsByRevisionId: Map<string, OperationRow[]>;
};

function nullSummary(): EstimatedRecipeCostSummary {
  return {
    ingredientsCost: null,
    operationsCost: null,
    totalCost: null,
  };
}

function stockUnitCostForMaterial(item: CostItemRow) {
  return (
    item.currentStockUnitCost ??
    resolveStockUnitCostFromDefaultPurchasePrice({
      defaultPurchasePrice: item.defaultPurchasePrice,
      purchaseToStockFactor: item.purchaseToStockFactor,
    })
  );
}

async function loadEstimatedCostGraphInTx(
  tx: Tx,
  rootItemIds: string[],
  options: { includeLotCosts: boolean }
): Promise<EstimatedCostGraph> {
  const uniqueIds = [...new Set(rootItemIds)];
  const itemsById = new Map<string, CostItemRow>();
  const loadedItemIds = new Set<string>();
  const lotUnitCostByItemId = new Map<string, string | null>();
  const currentRevisionByProductId = new Map<string, CurrentRevisionRow>();
  const componentsByRevisionId = new Map<string, ComponentRow[]>();
  const operationsByRevisionId = new Map<string, OperationRow[]>();
  let pendingItemIds = uniqueIds;

  while (pendingItemIds.length > 0) {
    const batchIds = [...new Set(pendingItemIds)].filter(
      (itemId) => !loadedItemIds.has(itemId)
    );
    pendingItemIds = [];
    if (batchIds.length === 0) {
      continue;
    }

    batchIds.forEach((itemId) => loadedItemIds.add(itemId));

    const itemRows = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        currentStockUnitCost: items.currentStockUnitCost,
        defaultPurchasePrice: items.defaultPurchasePrice,
        purchaseToStockFactor: items.purchaseToStockFactor,
        expectedBatchYield: items.expectedBatchYield,
        typicalBatchSize: items.typicalBatchSize,
        standardCostQuantity: items.standardCostQuantity,
        deletedAt: items.deletedAt,
      })
      .from(items)
      .where(inArray(items.id, batchIds));

    itemRows.forEach((item) => {
      itemsById.set(item.id, item);
    });

    const activeProductIds = itemRows
      .filter((item) => item.deletedAt == null && item.itemType === "product")
      .map((item) => item.id);
    if (activeProductIds.length === 0) {
      continue;
    }

    if (options.includeLotCosts) {
      const lotRows = await tx
        .select({
          itemId: inventoryLotBalances.itemId,
          unitCost: trimScaleNullable(sql`
            CASE
              WHEN COALESCE(SUM(${inventoryLotBalances.quantity}), 0) > 0
                AND COUNT(*) FILTER (WHERE ${inventoryLotBalances.unitCost} IS NULL) = 0
              THEN SUM(${inventoryLotBalances.quantity} * ${inventoryLotBalances.unitCost})
                / SUM(${inventoryLotBalances.quantity})
              ELSE NULL
            END
          `).as("unitCost"),
        })
        .from(inventoryLotBalances)
        .where(
          and(
            inArray(inventoryLotBalances.itemId, activeProductIds),
            eq(inventoryLotBalances.disposition, "available"),
            sql`${inventoryLotBalances.quantity} > 0`
          )
        )
        .groupBy(inventoryLotBalances.itemId);

      lotRows.forEach((row) => {
        lotUnitCostByItemId.set(row.itemId, row.unitCost);
      });
    }

    const revisionRows = await tx
      .select({
        id: bomRevisions.id,
        productId: bomRevisions.productId,
        recipeBasis: bomRevisions.recipeBasis,
        outputQuantity: bomRevisions.outputQuantity,
      })
      .from(bomRevisions)
      .where(
        and(
          inArray(bomRevisions.productId, activeProductIds),
          eq(bomRevisions.isCurrent, true)
        )
      );

    revisionRows.forEach((revision) => {
      currentRevisionByProductId.set(revision.productId, revision);
    });

    const revisionIds = revisionRows.map((revision) => revision.id);
    if (revisionIds.length === 0) {
      continue;
    }

    const componentRows = await tx
      .select({
        bomRevisionId: bomRevisionComponents.bomRevisionId,
        componentId: bomRevisionComponents.componentId,
        quantity: bomRevisionComponents.quantity,
      })
      .from(bomRevisionComponents)
      .where(inArray(bomRevisionComponents.bomRevisionId, revisionIds));

    componentRows.forEach((component) => {
      const rows = componentsByRevisionId.get(component.bomRevisionId) ?? [];
      rows.push(component);
      componentsByRevisionId.set(component.bomRevisionId, rows);

      if (!loadedItemIds.has(component.componentId)) {
        pendingItemIds.push(component.componentId);
      }
    });

    const operationRows = await tx
      .select({
        bomRevisionId: bomRevisionOperationCosts.bomRevisionId,
        costScalingMode: bomRevisionOperationCosts.costScalingMode,
        crewSize: bomRevisionOperationCosts.crewSize,
        plannedMinutes: bomRevisionOperationCosts.plannedMinutes,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
      })
      .from(bomRevisionOperationCosts)
      .where(inArray(bomRevisionOperationCosts.bomRevisionId, revisionIds));

    operationRows.forEach((operation) => {
      const rows = operationsByRevisionId.get(operation.bomRevisionId) ?? [];
      rows.push(operation);
      operationsByRevisionId.set(operation.bomRevisionId, rows);
    });
  }

  return {
    itemsById,
    lotUnitCostByItemId,
    currentRevisionByProductId,
    componentsByRevisionId,
    operationsByRevisionId,
  };
}

export async function getEstimatedUnitCostsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];
  const cache = new Map<string, string | null>();

  if (uniqueIds.length === 0) {
    return cache;
  }

  const graph = await loadEstimatedCostGraphInTx(tx, uniqueIds, {
    includeLotCosts: true,
  });

  function resolve(itemId: string, visited = new Set<string>()): string | null {
    if (cache.has(itemId)) {
      return cache.get(itemId) ?? null;
    }

    if (visited.has(itemId)) {
      cache.set(itemId, null);
      return null;
    }

    const item = graph.itemsById.get(itemId);
    if (!item || item.deletedAt != null) {
      cache.set(itemId, null);
      return null;
    }

    if (item.itemType === "material") {
      const stockUnitCost = stockUnitCostForMaterial(item);
      cache.set(itemId, stockUnitCost);
      return stockUnitCost;
    }

    const lotUnitCost = graph.lotUnitCostByItemId.get(itemId);
    if (lotUnitCost != null) {
      cache.set(itemId, lotUnitCost);
      return lotUnitCost;
    }

    const currentRevision = graph.currentRevisionByProductId.get(itemId);
    if (!currentRevision) {
      cache.set(itemId, null);
      return null;
    }

    const components = graph.componentsByRevisionId.get(currentRevision.id) ?? [];
    const operationRows = graph.operationsByRevisionId.get(currentRevision.id) ?? [];

    if (components.length === 0 && operationRows.length === 0) {
      cache.set(itemId, null);
      return null;
    }

    let totalCost = 0;
    const nextVisited = new Set(visited);
    nextVisited.add(itemId);

    for (const component of components) {
      const componentCost = resolve(component.componentId, nextVisited);
      const averageUnitQuantity = calculateAverageUnitConsumptionQuantity({
        quantity: component.quantity,
        recipeBasis: currentRevision.recipeBasis,
        outputQuantity: currentRevision.outputQuantity,
      });
      const componentQuantity = Number.parseFloat(averageUnitQuantity);

      if (componentCost == null || !Number.isFinite(componentQuantity)) {
        cache.set(itemId, null);
        return null;
      }

      totalCost += componentQuantity * Number.parseFloat(componentCost);
    }

    const standardCostQuantity =
      item.expectedBatchYield ?? item.typicalBatchSize ?? item.standardCostQuantity;

    for (const operation of operationRows) {
      if (operation.costScalingMode === "per_output_unit") {
        totalCost += Number.parseFloat(
          calculatePlannedOperationCost({
            costScalingMode: "per_output_unit",
            crewSize: operation.crewSize,
            plannedMinutes: operation.plannedMinutes,
            loadedCostPerHour: operation.loadedCostPerHour,
            outputQuantity: 1,
          })
        );
        continue;
      }

      const quantity = standardCostQuantity == null ? null : Number(standardCostQuantity);
      if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
        cache.set(itemId, null);
        return null;
      }
      totalCost += Number(operation.plannedCostTotal) / quantity;
    }

    const normalized = normalizeNumericScale(totalCost, 6);
    cache.set(itemId, normalized);
    return normalized;
  }

  uniqueIds.forEach((itemId) => resolve(itemId));
  return cache;
}

export async function getEstimatedRecipeCostSummariesByItemIdInTx(
  tx: Tx,
  itemIds: string[]
) {
  const uniqueIds = [...new Set(itemIds)];
  const cache = new Map<string, EstimatedRecipeCostSummary>();

  if (uniqueIds.length === 0) {
    return cache;
  }

  const graph = await loadEstimatedCostGraphInTx(tx, uniqueIds, {
    includeLotCosts: false,
  });

  function resolve(
    itemId: string,
    visited = new Set<string>()
  ): EstimatedRecipeCostSummary {
    const cached = cache.get(itemId);
    if (cached) {
      return cached;
    }

    if (visited.has(itemId)) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    const item = graph.itemsById.get(itemId);
    if (!item || item.deletedAt != null) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    if (item.itemType === "material") {
      const stockUnitCost = stockUnitCostForMaterial(item);
      const summary = {
        ingredientsCost: stockUnitCost,
        operationsCost: null,
        totalCost: stockUnitCost,
      };
      cache.set(itemId, summary);
      return summary;
    }

    const currentRevision = graph.currentRevisionByProductId.get(itemId);
    if (!currentRevision) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    const components = graph.componentsByRevisionId.get(currentRevision.id) ?? [];
    const operationRows = graph.operationsByRevisionId.get(currentRevision.id) ?? [];

    if (components.length === 0 && operationRows.length === 0) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(itemId);

    let ingredientsTotal = 0;
    let ingredientsCost: string | null = components.length === 0 ? "0" : null;
    let ingredientsComplete = true;

    for (const component of components) {
      const componentSummary = resolve(component.componentId, nextVisited);
      const componentCost =
        componentSummary.totalCost == null
          ? Number.NaN
          : Number.parseFloat(componentSummary.totalCost);
      const averageUnitQuantity = calculateAverageUnitConsumptionQuantity({
        quantity: component.quantity,
        recipeBasis: currentRevision.recipeBasis,
        outputQuantity: currentRevision.outputQuantity,
      });
      const componentQuantity = Number.parseFloat(averageUnitQuantity);

      if (!Number.isFinite(componentCost) || !Number.isFinite(componentQuantity)) {
        ingredientsComplete = false;
        break;
      }

      ingredientsTotal += componentQuantity * componentCost;
    }

    if (components.length > 0 && ingredientsComplete) {
      ingredientsCost = normalizeNumericScale(ingredientsTotal, 6);
    }

    const standardCostQuantity =
      item.expectedBatchYield ?? item.typicalBatchSize ?? item.standardCostQuantity;
    let operationsTotal = 0;
    let operationsCost: string | null = operationRows.length === 0 ? null : null;
    let operationsComplete = true;

    for (const operation of operationRows) {
      if (operation.costScalingMode === "per_output_unit") {
        operationsTotal += Number.parseFloat(
          calculatePlannedOperationCost({
            costScalingMode: "per_output_unit",
            crewSize: operation.crewSize,
            plannedMinutes: operation.plannedMinutes,
            loadedCostPerHour: operation.loadedCostPerHour,
            outputQuantity: 1,
          })
        );
        continue;
      }

      const quantity = standardCostQuantity == null ? null : Number(standardCostQuantity);
      if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
        operationsComplete = false;
        break;
      }
      operationsTotal += Number(operation.plannedCostTotal) / quantity;
    }

    if (operationRows.length > 0 && operationsComplete) {
      operationsCost = normalizeNumericScale(operationsTotal, 6);
    }

    const totalCost =
      ingredientsCost == null ||
      (operationRows.length > 0 && operationsCost == null)
        ? null
        : normalizeNumericScale(
            Number.parseFloat(ingredientsCost) +
              (operationsCost == null ? 0 : Number.parseFloat(operationsCost)),
            6
          );
    const summary = {
      ingredientsCost,
      operationsCost,
      totalCost,
    };
    cache.set(itemId, summary);
    return summary;
  }

  uniqueIds.forEach((itemId) => resolve(itemId));
  return cache;
}
