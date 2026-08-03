import "server-only";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  itemFamilies,
  items,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakes,
} from "@/lib/db/schema";
import {
  trimScaleNullable,
} from "@/lib/db/numeric";
import {
  getCurrentBomComponentsInTx,
} from "@/lib/bom/revisions";
import {
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import { assertSkuCapacityInTx } from "@/lib/billing/sku-capacity";
import {
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getCurrentOnHandQtyInTx,
  lockItemsInTx,
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  recordCostBasisChangeInTx,
} from "@/lib/inventory/kernel";
import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import {
  getCurrentBomOperationCostsInTx,
} from "@/lib/bom/operation-costs";
import type {
  InsertItem,
  UpdateItem,
} from "@/lib/schemas/items";
import {
  hasBomChanged,
  hasBomOperationCostsChanged,
  type BomInputRow,
  type BomOperationCostInputRow,
} from "./bom-write";
import { InventoryError } from "./errors";
import { createBomRevisionInTx } from "./bom-write";

function normalizeCurrentStockUnitCost(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InventoryError(
      "Current stock unit cost must be a non-negative number."
    );
  }

  return normalizeStockUnitCost(parsed);
}

export async function deleteItem(
  id: string
): Promise<{
  deleted: boolean;
  usedInBom?: boolean;
  usedInActiveOrders?: boolean;
  usedInActiveManufacturing?: boolean;
  usedInActivePurchasing?: boolean;
  usedInDraftStocktakes?: boolean;
}> {
  return withAuthedOrgContext(async (tx) => {
    await lockItemsInTx(tx, [id]);

    // Check BOM usage inside the same transaction to avoid race conditions
    const [bomRef] = await tx
      .select({ id: bomRevisionComponents.id })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .where(
        and(
          eq(bomRevisionComponents.componentId, id),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt)
        )
      )
      .limit(1);

    if (bomRef) {
      return { deleted: false, usedInBom: true };
    }

    const [activeOrderRef] = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrderLines.itemId, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return { deleted: false, usedInActiveOrders: true };
    }

    const [activeManufacturingRef] = await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderIngredients,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "open"),
          or(
            eq(manufacturingOrders.productId, id),
            eq(manufacturingOrderIngredients.itemId, id)
          )
        )
      )
      .limit(1);

    if (activeManufacturingRef) {
      return { deleted: false, usedInActiveManufacturing: true };
    }

    const [activePurchasingRef] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
      )
      .where(
        and(
          eq(purchaseOrderLines.itemId, id),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["not_received", "partial"])
        )
      )
      .limit(1);

    if (activePurchasingRef) {
      return { deleted: false, usedInActivePurchasing: true };
    }

    const [draftStocktakeRef] = await tx
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .innerJoin(stocktakeItems, eq(stocktakeItems.stocktakeId, stocktakes.id))
      .where(
        and(
          eq(stocktakeItems.itemId, id),
          eq(stocktakes.status, "draft")
        )
      )
      .limit(1);

    if (draftStocktakeRef) {
      return { deleted: false, usedInDraftStocktakes: true };
    }

    const [row] = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return { deleted: row != null };
  });
}

export async function deleteItems(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    await lockItemsInTx(tx, uniqueIds);

    const [bomRef] = await tx
      .select({ componentId: bomRevisionComponents.componentId })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .where(
        and(
          inArray(bomRevisionComponents.componentId, uniqueIds),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt)
        )
      )
      .limit(1);

    if (bomRef) {
      return {
        deletedCount: 0,
        error: "Cannot delete: one or more items are used as a component in other products.",
      };
    }

    const [activeOrderRef] = await tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          inArray(salesOrderLines.itemId, uniqueIds),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by active sales orders.",
      };
    }

    const [activeManufacturingRef] = await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderIngredients,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "open"),
          or(
            inArray(manufacturingOrders.productId, uniqueIds),
            inArray(manufacturingOrderIngredients.itemId, uniqueIds)
          )
        )
      )
      .limit(1);

    if (activeManufacturingRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by open manufacturing orders.",
      };
    }

    const [activePurchasingRef] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
      )
      .where(
        and(
          inArray(purchaseOrderLines.itemId, uniqueIds),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["not_received", "partial"])
        )
      )
      .limit(1);

    if (activePurchasingRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by ordered or partially received purchase orders.",
      };
    }

    const [draftStocktakeRef] = await tx
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .innerJoin(stocktakeItems, eq(stocktakeItems.stocktakeId, stocktakes.id))
      .where(
        and(
          inArray(stocktakeItems.itemId, uniqueIds),
          eq(stocktakes.status, "draft")
        )
      )
      .limit(1);

    if (draftStocktakeRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by a draft stocktake.",
      };
    }

    const deleted = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(inArray(items.id, uniqueIds), isNull(items.deletedAt))
      )
      .returning({ id: items.id });

    return { deletedCount: deleted.length };
  });
}

export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom" | "revisionNote">,
  stock?: number,
  bom?: BomInputRow[],
  operationCosts?: BomOperationCostInputRow[],
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateItem",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, itemData, stock, bom, operationCosts, revisionNote },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
        unitDefinitionId: items.unitDefinitionId,
        purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
        bomLocked: items.bomLocked,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const delta =
      stock != null ? stock - (await getCurrentOnHandQtyInTx(tx, id)) : null;
    const currentBom = bom !== undefined ? await getCurrentBomComponentsInTx(tx, id) : [];
    const currentOperationCosts =
      bom !== undefined || operationCosts !== undefined
        ? await getCurrentBomOperationCostsInTx(tx, id)
        : [];
    const normalizedCurrentStockUnitCost =
      existingItem.itemType === "material"
        ? normalizeCurrentStockUnitCost(itemData.currentStockUnitCost)
        : undefined;
    const normalizedItemData = {
      ...itemData,
      currentStockUnitCost: normalizedCurrentStockUnitCost,
    };

    const [item] = await tx
      .update(items)
      .set({ ...normalizedItemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (existingItem.familyId) {
      const activeFamilyRows = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.familyId, existingItem.familyId), isNull(items.deletedAt)))
        .for("update");

      if (activeFamilyRows.length <= 1) {
        await tx
          .update(itemFamilies)
          .set({
            name: normalizedItemData.name,
            category: normalizedItemData.category,
            description: normalizedItemData.description,
            unitDefinitionId: existingItem.unitDefinitionId ?? undefined,
            purchaseUnitDefinitionId: normalizedItemData.purchaseUnitDefinitionId,
            purchaseToStockFactor: normalizedItemData.purchaseToStockFactor,
            updatedAt: new Date(),
          })
          .where(eq(itemFamilies.id, existingItem.familyId));
      }
    }

    if (bom !== undefined || operationCosts !== undefined) {
      const [currentRevisionMeta] = await tx
        .select({
          outputQuantity: bomRevisions.outputQuantity,
          recipeBasis: bomRevisions.recipeBasis,
        })
        .from(bomRevisions)
        .where(and(eq(bomRevisions.productId, id), eq(bomRevisions.isCurrent, true)))
        .limit(1);
      const nextBom = bom ?? currentBom.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.alternateItemId,
        })),
      }));
      const nextOperationCosts = operationCosts ?? currentOperationCosts.map((row) => ({
        operationName: row.operationName,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        resourceType: row.resourceType,
        costScalingMode: "per_output_unit" as const,
        crewSize: row.crewSize,
        plannedMinutes: row.plannedMinutes,
        loadedCostPerHour: row.loadedCostPerHour,
      }));
      if (
        (bom !== undefined && hasBomChanged(
          currentBom.map((row) => ({
            componentId: row.componentId,
            quantity: row.quantity,
            minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
            alternates: row.alternates.map((alternate) => ({
              itemId: alternate.alternateItemId,
            })),
          })),
          nextBom
        )) ||
        (operationCosts !== undefined &&
          hasBomOperationCostsChanged(
            currentOperationCosts.map((row) => ({
              operationName: row.operationName,
              resourceId: row.resourceId,
              resourceName: row.resourceName,
              resourceType: row.resourceType,
              costScalingMode: "per_output_unit" as const,
              crewSize: row.crewSize,
              plannedMinutes: row.plannedMinutes,
              loadedCostPerHour: row.loadedCostPerHour,
            })),
            nextOperationCosts
          ))
      ) {
        await createBomRevisionInTx(tx, {
          orgId,
          userId,
          productId: id,
          note: revisionNote,
          outputQuantity: currentRevisionMeta?.outputQuantity ?? "1",
          recipeBasis: currentRevisionMeta?.recipeBasis === "batch" ? "batch" : "unit",
          bom: nextBom,
          operationCosts: nextOperationCosts,
        });

        await recordCostBasisChangeInTx(tx, {
          organizationId: orgId,
          itemId: id,
          actorUserId: userId,
          eventSubtype: "bom_edited",
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "bom-edited"
          ),
          metadata: {
            revisionNote: revisionNote ?? null,
            componentCount: nextBom.length,
            operationCostCount: nextOperationCosts.length,
          },
        });
      }
    }

    if (delta != null && delta !== 0) {
      if (delta > 0) {
        await manualIncreaseStockInTx(tx, {
          organizationId: orgId,
          itemId: id,
          quantity: delta,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "stock-increase"
          ),
        });
      } else {
        await manualDecreaseStockInTx(tx, {
          organizationId: orgId,
          itemId: id,
          quantity: Math.abs(delta),
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "stock-decrease"
          ),
        });
      }
    }

    if (
      (itemData.purchaseUnitDefinitionId !== undefined &&
        itemData.purchaseUnitDefinitionId !== existingItem.purchaseUnitDefinitionId) ||
      (itemData.purchaseToStockFactor !== undefined &&
        itemData.purchaseToStockFactor !== existingItem.purchaseToStockFactor)
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "purchase_unit_config",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "purchase-unit-config"
        ),
        metadata: {
          before: {
            purchaseUnitDefinitionId: existingItem.purchaseUnitDefinitionId,
            purchaseToStockFactor: existingItem.purchaseToStockFactor,
          },
          after: {
            purchaseUnitDefinitionId:
              itemData.purchaseUnitDefinitionId ?? existingItem.purchaseUnitDefinitionId,
            purchaseToStockFactor:
              itemData.purchaseToStockFactor ?? existingItem.purchaseToStockFactor,
          },
        },
      });
    }

    if (
      normalizedItemData.defaultPurchasePrice !== undefined &&
      normalizedItemData.defaultPurchasePrice !== existingItem.defaultPurchasePrice
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "default_purchase_price",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "default-purchase-price"
        ),
        metadata: {
          before: existingItem.defaultPurchasePrice,
          after: normalizedItemData.defaultPurchasePrice,
        },
      });
    }

    if (
      normalizedCurrentStockUnitCost !== undefined &&
      normalizedCurrentStockUnitCost !== existingItem.currentStockUnitCost
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "current_stock_unit_cost_override",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "current-stock-unit-cost-override"
        ),
        metadata: {
          before: existingItem.currentStockUnitCost,
          after: normalizedCurrentStockUnitCost,
        },
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: item,
    });

    return item;
  });
}

export async function createItemWithLot(
  data: Omit<InsertItem, "stock" | "outputQuantity" | "bom" | "revisionNote">,
  stock: string,
  outputQuantity?: string | null,
  bom?: BomInputRow[],
  operationCosts?: BomOperationCostInputRow[],
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createItemWithLot",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { data, stock, outputQuantity, bom, operationCosts, revisionNote },
    });

    if (replay.replayed) {
      return replay.result;
    }

    await assertSkuCapacityInTx(tx, orgId, 1);

    const normalizedCurrentStockUnitCost =
      data.itemType === "material"
        ? normalizeCurrentStockUnitCost(data.currentStockUnitCost)
        : null;
    const initialCurrentStockUnitCost =
      data.itemType === "material"
        ? normalizedCurrentStockUnitCost ??
          (parseFloat(stock) > 0
            ? resolveStockUnitCostFromDefaultPurchasePrice({
                defaultPurchasePrice: data.defaultPurchasePrice,
                purchaseToStockFactor: data.purchaseToStockFactor,
              })
            : null)
        : null;

    const [family] = await tx
      .insert(itemFamilies)
      .values({
        organizationId: orgId,
        itemType: data.itemType,
        name: data.name,
        category: data.category ?? null,
        description: data.description ?? null,
        unitDefinitionId: data.unitDefinitionId,
        purchaseUnitDefinitionId:
          data.itemType === "material" ? data.purchaseUnitDefinitionId ?? null : null,
        purchaseToStockFactor:
          data.itemType === "material" ? data.purchaseToStockFactor ?? null : null,
      })
      .returning({ id: itemFamilies.id });

    const [item] = await tx
      .insert(items)
      .values({
        ...data,
        familyId: family.id,
        optionCombinationKey: "",
        currentStockUnitCost: initialCurrentStockUnitCost,
        organizationId: orgId,
      })
      .returning({ id: items.id });

    if ((bom && bom.length > 0) || (operationCosts && operationCosts.length > 0)) {
      const recipeBasis = data.manufacturingMode === "batch" ? "batch" : "unit";
      const recipeOutputQuantity =
        recipeBasis === "batch"
          ? data.expectedBatchYield ?? data.typicalBatchSize ?? outputQuantity ?? "1"
          : "1";

      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: item.id,
        note: revisionNote,
        outputQuantity: recipeOutputQuantity,
        recipeBasis,
        bom: bom ?? [],
        operationCosts: operationCosts ?? [],
      });
    }

    if (parseFloat(stock) > 0) {
      await manualIncreaseStockInTx(tx, {
        organizationId: orgId,
        itemId: item.id,
        quantity: parseFloat(stock),
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "opening-stock"
        ),
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: item,
    });

    return item;
  });
}

export async function overrideMaterialCurrentStockUnitCost(
  id: string,
  currentStockUnitCost: string,
  options?: { idempotencyKey?: string },
): Promise<{ id: string; currentStockUnitCost: string | null } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      { id: string; currentStockUnitCost: string | null } | null
    >(tx, {
      organizationId: orgId,
      operationName: "overrideMaterialCurrentStockUnitCost",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, currentStockUnitCost },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const normalizedCurrentStockUnitCost = normalizeCurrentStockUnitCost(
      currentStockUnitCost
    );

    if (normalizedCurrentStockUnitCost == null) {
      throw new InventoryError("Current stock unit cost is required.");
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (existingItem.itemType !== "material") {
      throw new InventoryError("Only materials have a current stock unit cost.");
    }

    const [item] = await tx
      .update(items)
      .set({
        currentStockUnitCost: normalizedCurrentStockUnitCost,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), isNull(items.deletedAt), eq(items.itemType, "material")))
      .returning({
        id: items.id,
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      });

    if (
      item &&
      item.currentStockUnitCost !== existingItem.currentStockUnitCost
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "current_stock_unit_cost_override",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "current-stock-unit-cost-override"
        ),
        metadata: {
          before: existingItem.currentStockUnitCost,
          after: item.currentStockUnitCost,
        },
      });
    }

    const result = item ?? null;

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
