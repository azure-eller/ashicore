import { and, eq, sql } from "drizzle-orm";
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

export async function getEstimatedUnitCostsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];
  const cache = new Map<string, string | null>();

  async function resolve(itemId: string, visited = new Set<string>()): Promise<string | null> {
    if (cache.has(itemId)) {
      return cache.get(itemId) ?? null;
    }

    if (visited.has(itemId)) {
      cache.set(itemId, null);
      return null;
    }

    const [item] = await tx
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
      .where(eq(items.id, itemId));

    if (!item || item.deletedAt != null) {
      cache.set(itemId, null);
      return null;
    }

    if (item.itemType === "material") {
      const stockUnitCost =
        item.currentStockUnitCost ??
        resolveStockUnitCostFromDefaultPurchasePrice({
          defaultPurchasePrice: item.defaultPurchasePrice,
          purchaseToStockFactor: item.purchaseToStockFactor,
        });
      cache.set(itemId, stockUnitCost);
      return stockUnitCost;
    }

    const [lotCost] = await tx
      .select({
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
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.disposition, "available"),
          sql`${inventoryLotBalances.quantity} > 0`
        )
      );

    if (lotCost?.unitCost != null) {
      cache.set(itemId, lotCost.unitCost);
      return lotCost.unitCost;
    }

    const [currentRevision] = await tx
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, itemId), eq(bomRevisions.isCurrent, true)));

    if (!currentRevision) {
      cache.set(itemId, null);
      return null;
    }

    const components = await tx
      .select({
        componentId: bomRevisionComponents.componentId,
        quantity: bomRevisionComponents.quantity,
        everyQuantity: bomRevisionComponents.everyQuantity,
        outputQuantity: bomRevisions.outputQuantity,
        consumptionMode: bomRevisionComponents.consumptionMode,
        basisOutputQuantity: bomRevisionComponents.basisOutputQuantity,
        batchScalingMode: bomRevisionComponents.batchScalingMode,
        groupRemainderPolicy: bomRevisionComponents.groupRemainderPolicy,
      })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));

    const operationRows = await tx
      .select({
        costScalingMode: bomRevisionOperationCosts.costScalingMode,
        crewSize: bomRevisionOperationCosts.crewSize,
        plannedMinutes: bomRevisionOperationCosts.plannedMinutes,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
      })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, currentRevision.id));

    if (components.length === 0 && operationRows.length === 0) {
      cache.set(itemId, null);
      return null;
    }

    let totalCost = 0;
    const nextVisited = new Set(visited);
    nextVisited.add(itemId);

    for (const component of components) {
      const componentCost = await resolve(component.componentId, nextVisited);
      const averageUnitQuantity = calculateAverageUnitConsumptionQuantity({
        quantity: component.quantity,
        everyQuantity: component.everyQuantity,
        basisOutputQuantity: component.basisOutputQuantity,
        outputQuantity: component.outputQuantity,
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

  await Promise.all(uniqueIds.map((itemId) => resolve(itemId)));
  return cache;
}

export async function getEstimatedRecipeCostSummariesByItemIdInTx(
  tx: Tx,
  itemIds: string[]
) {
  const uniqueIds = [...new Set(itemIds)];
  const cache = new Map<string, EstimatedRecipeCostSummary>();

  const nullSummary = (): EstimatedRecipeCostSummary => ({
    ingredientsCost: null,
    operationsCost: null,
    totalCost: null,
  });

  async function resolve(
    itemId: string,
    visited = new Set<string>()
  ): Promise<EstimatedRecipeCostSummary> {
    const cached = cache.get(itemId);
    if (cached) {
      return cached;
    }

    if (visited.has(itemId)) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    const [item] = await tx
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
      .where(eq(items.id, itemId));

    if (!item || item.deletedAt != null) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    if (item.itemType === "material") {
      const stockUnitCost =
        item.currentStockUnitCost ??
        resolveStockUnitCostFromDefaultPurchasePrice({
          defaultPurchasePrice: item.defaultPurchasePrice,
          purchaseToStockFactor: item.purchaseToStockFactor,
        });
      const summary = {
        ingredientsCost: stockUnitCost,
        operationsCost: null,
        totalCost: stockUnitCost,
      };
      cache.set(itemId, summary);
      return summary;
    }

    const [currentRevision] = await tx
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, itemId), eq(bomRevisions.isCurrent, true)));

    if (!currentRevision) {
      const summary = nullSummary();
      cache.set(itemId, summary);
      return summary;
    }

    const components = await tx
      .select({
        componentId: bomRevisionComponents.componentId,
        quantity: bomRevisionComponents.quantity,
        everyQuantity: bomRevisionComponents.everyQuantity,
        outputQuantity: bomRevisions.outputQuantity,
        basisOutputQuantity: bomRevisionComponents.basisOutputQuantity,
      })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));

    const operationRows = await tx
      .select({
        costScalingMode: bomRevisionOperationCosts.costScalingMode,
        crewSize: bomRevisionOperationCosts.crewSize,
        plannedMinutes: bomRevisionOperationCosts.plannedMinutes,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
      })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, currentRevision.id));

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
      const componentSummary = await resolve(component.componentId, nextVisited);
      const componentCost =
        componentSummary.totalCost == null
          ? Number.NaN
          : Number.parseFloat(componentSummary.totalCost);
      const averageUnitQuantity = calculateAverageUnitConsumptionQuantity({
        quantity: component.quantity,
        everyQuantity: component.everyQuantity,
        basisOutputQuantity: component.basisOutputQuantity,
        outputQuantity: component.outputQuantity,
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

  await Promise.all(uniqueIds.map((itemId) => resolve(itemId)));
  return cache;
}
