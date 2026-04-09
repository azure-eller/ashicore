// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakes,
  stockMovements,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import {
  getBomRevisionComponentsInTx,
  getBomRevisionHistoryInTx,
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyStockDeltaInTx,
  createPositiveLotAndMovementInTx,
  getCurrentStockInTx,
  lockItemsInTx,
} from "@/lib/inventory/stock";
import type { InsertItem, UpdateItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import type { ItemRow, ItemType } from "./types";

const stockSubquery = trimScale(sql`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`).as("stock");

type BomInputRow = { componentId: string; quantity: string };

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: row.quantity,
    sortOrder: index,
  }));
}

function hasBomChanged(currentBom: BomInputRow[], nextBom: BomInputRow[]) {
  const normalizedCurrent = normalizeBomRows(currentBom);
  const normalizedNext = normalizeBomRows(nextBom);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.componentId !== nextRow.componentId ||
      row.quantity !== nextRow.quantity ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}

async function createBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    productId: string;
    note?: string | null;
    bom: BomInputRow[];
  }
) {
  const [currentRevision] = await tx
    .select({ revisionNumber: bomRevisions.revisionNumber })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)))
    .for("update");

  await tx
    .update(bomRevisions)
    .set({
      isCurrent: false,
      updatedAt: new Date(),
    })
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)));

  const [revision] = await tx
    .insert(bomRevisions)
    .values({
      organizationId: params.orgId,
      productId: params.productId,
      revisionNumber: (currentRevision?.revisionNumber ?? 0) + 1,
      isCurrent: true,
      note: params.note ?? null,
      createdBy: params.userId,
    })
    .returning({
      id: bomRevisions.id,
      revisionNumber: bomRevisions.revisionNumber,
    });

  if (params.bom.length > 0) {
    const componentIds = [...new Set(params.bom.map((row) => row.componentId))];
    const componentRows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        unitName: unitDefinitions.name,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(inArray(items.id, componentIds), isNull(items.deletedAt)));

    const componentById = new Map(componentRows.map((row) => [row.id, row]));

    await tx.insert(bomRevisionComponents).values(
      params.bom.map((row, index) => {
        const component = componentById.get(row.componentId);

        if (!component) {
          throw new Error("BOM component not found");
        }

        return {
          bomRevisionId: revision.id,
          componentId: row.componentId,
          componentName: component.name,
          componentSku: component.sku,
          componentItemType: component.itemType,
          unitName: component.unitName,
          quantity: row.quantity,
          sortOrder: index,
        };
      })
    );
  }

  return revision;
}

export async function getItems(filters?: { itemType?: ItemType }): Promise<ItemRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [
      isNull(items.deletedAt),
      ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
    ];

    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        stock: stockSubquery,
        committedQty: trimScale(items.committedQty).as("committedQty"),
        expectedQty: trimScale(items.expectedQty).as("expectedQty"),
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        unit: unitDefinitions.name,
        category: items.category,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));
    // Cast: Drizzle infers varchar as string, but we know itemType is always a valid ItemType
    return rows as ItemRow[];
  });
}

export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: items.category,
        description: items.description,
        unitDefinitionId: items.unitDefinitionId,
        purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        bomLocked: items.bomLocked,
        bomLockedAt: items.bomLockedAt,
        bomLockedByUserId: items.bomLockedByUserId,
        stock: stockSubquery,
        committedQty: trimScale(items.committedQty).as("committedQty"),
        expectedQty: trimScale(items.expectedQty).as("expectedQty"),
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, id), isNull(items.deletedAt)));

    if (!row) {
      return null;
    }

    const purchaseUnit = row.purchaseUnitDefinitionId
      ? await tx
          .select({
            id: unitDefinitions.id,
            name: unitDefinitions.name,
            size: trimScale(unitDefinitions.size).as("size"),
            uom: unitDefinitions.uom,
          })
          .from(unitDefinitions)
          .where(eq(unitDefinitions.id, row.purchaseUnitDefinitionId))
          .then((rows) => rows[0] ?? null)
      : null;
    const currentBomRevision = await getCurrentBomRevisionInTx(tx, id);

    return {
      ...row,
      purchaseUnitName: purchaseUnit?.name ?? null,
      purchaseUnitSize: purchaseUnit?.size ?? null,
      purchaseUnitUom: purchaseUnit?.uom ?? null,
      currentBomRevision,
    };
  });
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
          inArray(salesOrders.status, ["draft", "confirmed"])
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
          inArray(manufacturingOrders.status, ["draft", "released"]),
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
          inArray(purchaseOrders.status, ["draft", "ordered", "partial"])
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
          inArray(salesOrders.status, ["draft", "confirmed"])
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by draft or confirmed sales orders.",
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
          inArray(manufacturingOrders.status, ["draft", "released"]),
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
          "Cannot delete: one or more items are used by draft or released manufacturing orders.",
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
          inArray(purchaseOrders.status, ["draft", "ordered", "partial"])
        )
      )
      .limit(1);

    if (activePurchasingRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by draft, ordered, or partially received purchase orders.",
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

export async function getUnitDefinitions() {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      })
      .from(unitDefinitions)
      .where(isNull(unitDefinitions.deletedAt));
  });
}

export async function getCategories(): Promise<string[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .selectDistinct({ category: items.category })
      .from(items)
      .where(and(isNotNull(items.category), isNull(items.deletedAt)));

    // isNotNull(items.category) in the WHERE clause guarantees no nulls
    return rows.map((r) => r.category as string);
  });
}

export async function getLots(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: trimScale(lots.quantity).as("quantity"),
        costPerUnit: trimScaleNullable(lots.costPerUnit).as("costPerUnit"),
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.receivedAt);
  });
}

export async function getStockMovements(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: stockMovements.id,
        quantity: trimScale(stockMovements.quantity).as("quantity"),
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        createdBy: stockMovements.createdBy,
        createdAt: stockMovements.createdAt,
        lotNumber: lots.lotNumber,
      })
      .from(stockMovements)
      .leftJoin(lots, eq(stockMovements.lotId, lots.id))
      .where(eq(stockMovements.itemId, itemId))
      .orderBy(desc(stockMovements.createdAt));
  });
}

// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom" | "revisionNote">,
  stock?: number,
  bom?: Array<{ componentId: string; quantity: string }>,
  revisionNote?: string | null,
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [existingItem] = await tx
      .select({
        id: items.id,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem) return null;

    const delta =
      stock != null ? stock - (await getCurrentStockInTx(tx, id)) : null;
    const currentBom = bom !== undefined ? await getCurrentBomComponentsInTx(tx, id) : [];

    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (bom !== undefined) {
      if (
        hasBomChanged(
          currentBom.map((row) => ({
            componentId: row.componentId,
            quantity: row.quantity,
          })),
          bom
        )
      ) {
        await createBomRevisionInTx(tx, {
          orgId,
          userId,
          productId: id,
          note: revisionNote,
          bom,
        });
      }
    }

    if (delta != null && delta !== 0) {
      await applyStockDeltaInTx(tx, {
        orgId,
        userId,
        itemId: id,
        delta,
        movementType: "manual_adjustment",
      });
    }

    return item;
  });
}

export async function createItemWithLot(
  data: Omit<InsertItem, "stock" | "bom" | "revisionNote">,
  stock: string,
  bom?: Array<{ componentId: string; quantity: string }>,
  revisionNote?: string | null,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    if (bom && bom.length > 0) {
      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: item.id,
        note: revisionNote,
        bom,
      });
    }

    if (parseFloat(stock) > 0) {
      await createPositiveLotAndMovementInTx(tx, {
        orgId,
        itemId: item.id,
        quantity: parseFloat(stock),
        userId,
        movementType: "manual_adjustment",
      });
    }

    return item;
  });
}

export async function setBomLock(
  id: string,
  locked: boolean
): Promise<{ id: string; bomLocked: boolean } | null> {
  return withAuthedOrgContext(async (tx, _orgId, userId) => {
    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem || existingItem.itemType !== "product") {
      return null;
    }

    const [item] = await tx
      .update(items)
      .set({
        bomLocked: locked,
        bomLockedAt: locked ? new Date() : null,
        bomLockedByUserId: locked ? userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({
        id: items.id,
        bomLocked: items.bomLocked,
      });

    return item ?? null;
  });
}

export async function createUnitDefinition(
  data: InsertUnitDefinition
): Promise<{ id: string; name: string; size: string; uom: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .insert(unitDefinitions)
      .values({ ...data, organizationId: orgId })
      .returning({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      });
    return row;
  });
}

export async function getBomComponents(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await getCurrentBomComponentsInTx(tx, itemId);

    return rows.map((row) => ({
      id: row.id,
      componentId: row.componentId,
      quantity: row.quantity,
      componentName: row.componentName,
      componentItemType: row.componentItemType,
      componentUnit: row.unitName,
    }));
  });
}

export async function getBomRevisionHistory(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);

    return Promise.all(
      revisions.map(async (revision) => ({
        ...revision,
        components: await getBomRevisionComponentsInTx(tx, revision.id),
      }))
    );
  });
}

export async function getBomRevision(itemId: string, revisionId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);
    const revision = revisions.find((entry) => entry.id === revisionId);

    if (!revision) {
      return null;
    }

    return {
      ...revision,
      components: await getBomRevisionComponentsInTx(tx, revision.id),
    };
  });
}

export async function getAvailableComponents(excludeItemId?: string) {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [isNull(items.deletedAt)];
    if (excludeItemId) {
      conditions.push(sql`${items.id} != ${excludeItemId}`);
    }
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        unit: unitDefinitions.name,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));
    return rows;
  });
}
