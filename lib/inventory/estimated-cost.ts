import { and, eq, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  inventoryLotBalances,
  items,
} from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumericScale } from "@/lib/format";
import { resolveStockUnitCostFromDefaultPurchasePrice } from "@/lib/inventory/cost";
import { calculateAverageUnitConsumptionQuantity } from "@/lib/manufacturing/consumption";

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
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: items.expectedBatchYield,
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

    const components = await tx
      .select({
        componentId: bomRevisionComponents.componentId,
        quantity: bomRevisionComponents.quantity,
        consumptionMode: bomRevisionComponents.consumptionMode,
        basisOutputQuantity: bomRevisionComponents.basisOutputQuantity,
        batchScalingMode: bomRevisionComponents.batchScalingMode,
        groupRemainderPolicy: bomRevisionComponents.groupRemainderPolicy,
      })
      .from(bomRevisions)
      .innerJoin(
        bomRevisionComponents,
        eq(bomRevisionComponents.bomRevisionId, bomRevisions.id)
      )
      .where(
        and(
          eq(bomRevisions.productId, itemId),
          eq(bomRevisions.isCurrent, true)
        )
      );

    if (components.length === 0) {
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
        consumptionMode: component.consumptionMode as never,
        basisOutputQuantity: component.basisOutputQuantity,
      });
      const componentQuantity = Number.parseFloat(averageUnitQuantity);

      if (componentCost == null || !Number.isFinite(componentQuantity)) {
        cache.set(itemId, null);
        return null;
      }

      totalCost += componentQuantity * Number.parseFloat(componentCost);
    }

    const normalized = normalizeNumericScale(totalCost, 6);
    cache.set(itemId, normalized);
    return normalized;
  }

  await Promise.all(uniqueIds.map((itemId) => resolve(itemId)));
  return cache;
}
