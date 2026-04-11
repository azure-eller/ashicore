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
import { formatVariantDisplay } from "@/lib/format";
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
import type { InsertItem, InsertMasterItem, InsertVariant, UpdateItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import { DomainError } from "@/lib/errors/domain-error";
import type { ItemRow, ItemType } from "./types";

export class InventoryError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "InventoryError" });
  }
}

const stockSubquery = trimScale(sql`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`).as("stock");

// Potential: how many finished units could be produced from current available ingredient stock.
// For discrete products: floor(min(component_available / bom_qty))
// For batch products: floor(min(component_available / bom_qty)) * expected_batch_yield
// Available = lot stock - committed qty (stock already allocated to open orders)
const potentialSubquery = sql<string | null>`(
  CASE WHEN ${items.itemType} = 'product' AND EXISTS (
    SELECT 1 FROM inventory.bom_components WHERE item_id = ${items.id}
  ) THEN
    FLOOR(
      (
        SELECT MIN(
          (
            COALESCE((SELECT SUM(${lots.quantity}) FROM ${lots} WHERE ${lots.itemId} = bc.component_id), 0)
            - COALESCE((SELECT ci.committed_qty FROM inventory.items ci WHERE ci.id = bc.component_id), 0)
          )
          / NULLIF(bc.quantity, 0)
        )
        FROM inventory.bom_components bc
        WHERE bc.item_id = ${items.id}
      )
      * CASE WHEN ${items.manufacturingMode} = 'batch' AND ${items.expectedBatchYield} IS NOT NULL
          THEN ${items.expectedBatchYield}
          ELSE 1
        END
    )
  ELSE NULL END
)`.as("potential");

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
      isNull(items.parentId), // top-level rows only (standalone + masters)
      ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
    ];

    const variantCountSubquery = sql<number>`(
      SELECT COUNT(*)::int FROM ${items} AS v
      WHERE v.parent_id = ${items.id} AND v.deleted_at IS NULL
    )`.as("variant_count");

    const variantStockSubquery = trimScale(sql`(
      SELECT COALESCE(SUM(vl.quantity), 0)
      FROM ${items} AS vi
      INNER JOIN ${lots} AS vl ON vl.item_id = vi.id
      WHERE vi.parent_id = ${items.id} AND vi.deleted_at IS NULL
    )`).as("variant_stock");

    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        isMaster: items.isMaster,
        parentId: items.parentId,
        stock: stockSubquery,
        committedQty: trimScale(items.committedQty).as("committedQty"),
        expectedQty: trimScale(items.expectedQty).as("expectedQty"),
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        unit: unitDefinitions.name,
        unitSize: unitDefinitions.size,
        unitUom: unitDefinitions.uom,
        category: items.category,
        potential: potentialSubquery,
        variantCount: variantCountSubquery,
        variantStock: variantStockSubquery,
        variantAxes: items.variantAxes,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));

    // For product lists, eagerly load all variants for search + aggregation
    const masterIds = rows.filter((r) => r.isMaster).map((r) => r.id);
    let variantsByParent = new Map<string, typeof variantRows>();
    type VariantDbRow = typeof variantRows[number];
    const variantRows = masterIds.length > 0
      ? await tx
          .select({
            id: items.id,
            parentId: items.parentId,
            name: items.name,
            sku: items.sku,
            itemType: items.itemType,
            isMaster: items.isMaster,
            stock: stockSubquery,
            committedQty: trimScale(items.committedQty).as("committedQty"),
            expectedQty: trimScale(items.expectedQty).as("expectedQty"),
            safetyStock: trimScale(items.safetyStock).as("safetyStock"),
            defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
            unit: unitDefinitions.name,
            unitSize: unitDefinitions.size,
            unitUom: unitDefinitions.uom,
            category: items.category,
            variantAttrs: items.variantAttrs,
          })
          .from(items)
          .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
          .where(and(inArray(items.parentId, masterIds), isNull(items.deletedAt)))
      : [];

    if (variantRows.length > 0) {
      variantsByParent = new Map<string, VariantDbRow[]>();
      for (const v of variantRows) {
        const pid = v.parentId!;
        const list = variantsByParent.get(pid) ?? [];
        list.push(v);
        variantsByParent.set(pid, list);
      }
    }

    return rows.map((row) => {
      const variants = row.isMaster ? (variantsByParent.get(row.id) ?? []) : null;
      let priceRange: string | null = null;

      if (variants && variants.length > 0) {
        const prices = variants
          .map((v) => v.defaultSellingPrice)
          .filter((p): p is string => p != null)
          .map((p) => parseFloat(p))
          .filter((p) => !isNaN(p));
        if (prices.length > 0) {
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          priceRange = min === max ? `$${min}` : `$${min} \u2013 $${max}`;
        }
      }

      return {
        id: row.id,
        name: row.name,
        displayName: row.name,
        sku: row.sku,
        itemType: row.itemType,
        stock: row.isMaster ? row.variantStock : row.stock,
        committedQty: row.committedQty,
        expectedQty: row.expectedQty,
        safetyStock: row.safetyStock,
        unit: row.unit ?? null,
        unitSize: row.unitSize ?? null,
        unitUom: row.unitUom ?? null,
        category: row.category,
        potential: row.potential,
        isMaster: row.isMaster,
        parentId: row.parentId,
        variantCount: row.variantCount,
        variantAxes: (row.variantAxes as string[] | null) ?? null,
        variantAttrs: null,
        priceRange,
        subRows: variants?.map((v) => ({
          id: v.id,
          name: v.name,
          displayName: row.variantAxes
            ? formatVariantDisplay(
                row.name,
                (v.variantAttrs as Record<string, string>) ?? {},
                row.variantAxes as string[],
              )
            : v.name,
          sku: v.sku,
          itemType: v.itemType,
          stock: v.stock,
          committedQty: v.committedQty,
          expectedQty: v.expectedQty,
          safetyStock: v.safetyStock,
          unit: v.unit ?? null,
          unitSize: v.unitSize ?? null,
          unitUom: v.unitUom ?? null,
          category: v.category,
          potential: null,
          isMaster: false,
          parentId: v.parentId,
          variantCount: 0,
          variantAxes: null,
          variantAttrs: (v.variantAttrs as Record<string, string> | null) ?? null,
          priceRange: null,
        })) ?? undefined,
      } as ItemRow;
    });
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
        isMaster: items.isMaster,
        parentId: items.parentId,
        variantAxes: items.variantAxes,
        variantAttrs: items.variantAttrs,
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
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
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

    const parentName = row.parentId
      ? await tx
          .select({ name: items.name })
          .from(items)
          .where(eq(items.id, row.parentId))
          .then((rows) => rows[0]?.name ?? null)
      : null;

    const masterAxes = row.parentId
      ? await tx
          .select({ variantAxes: items.variantAxes })
          .from(items)
          .where(eq(items.id, row.parentId))
          .then((rows) => (rows[0]?.variantAxes as string[] | null) ?? [])
      : null;

    return {
      ...row,
      parentName,
      variantAxes: (row.variantAxes as string[] | null) ?? null,
      variantAttrs: (row.variantAttrs as Record<string, string> | null) ?? null,
      displayName:
        row.parentId && parentName && masterAxes && masterAxes.length > 0
          ? formatVariantDisplay(
              parentName,
              (row.variantAttrs as Record<string, string>) ?? {},
              masterAxes,
            )
          : row.name,
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
  hasActiveVariants?: boolean;
}> {
  return withAuthedOrgContext(async (tx) => {
    await lockItemsInTx(tx, [id]);

    // Check for active variants (masters can't be deleted while variants exist)
    const [activeVariant] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.parentId, id), isNull(items.deletedAt)))
      .limit(1);

    if (activeVariant) {
      return { deleted: false, hasActiveVariants: true };
    }

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

    // Check for active variants
    const [activeVariantRef] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(inArray(items.parentId, uniqueIds), isNull(items.deletedAt)))
      .limit(1);

    if (activeVariantRef) {
      return {
        deletedCount: 0,
        error: "Cannot delete: one or more products still have active variants.",
      };
    }

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
    const conditions = [isNull(items.deletedAt), eq(items.isMaster, false), isNull(items.parentId)];
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

export async function createMasterProduct(
  data: InsertMasterItem,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [item] = await tx
      .insert(items)
      .values({
        ...data,
        organizationId: orgId,
        itemType: "product",
        isMaster: true,
      })
      .returning({ id: items.id });

    return item;
  });
}

export async function createVariant(
  parentId: string,
  data: InsertVariant,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [master] = await tx
      .select({
        id: items.id,
        isMaster: items.isMaster,
        parentId: items.parentId,
        category: items.category,
        name: items.name,
        variantAxes: items.variantAxes,
      })
      .from(items)
      .where(and(eq(items.id, parentId), isNull(items.deletedAt)))
      .for("update");

    if (!master) throw new InventoryError("Master product not found", 404);
    if (!master.isMaster) throw new InventoryError("Parent is not a master product");
    if (master.parentId != null) throw new InventoryError("Cannot create variant under a variant");

    // Validate that all master axes have a value in variantAttrs
    const axes = (master.variantAxes as string[] | null) ?? [];
    for (const axis of axes) {
      if (!data.variantAttrs[axis]) {
        throw new InventoryError(`Missing value for variant axis: ${axis}`);
      }
    }

    // Guard against duplicate variants with identical attribute combinations
    const [duplicate] = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.parentId, parentId),
          isNull(items.deletedAt),
          sql`variant_attrs = ${JSON.stringify(data.variantAttrs)}::jsonb`,
        ),
      )
      .limit(1);

    if (duplicate) {
      throw new InventoryError("A variant with these attribute values already exists");
    }

    const [variant] = await tx
      .insert(items)
      .values({
        organizationId: orgId,
        name: master.name,           // variant name = master name
        sku: data.sku ?? null,
        description: data.description ?? null,
        itemType: "product",
        category: master.category,
        unitDefinitionId: data.unitDefinitionId,
        manufacturingMode: data.manufacturingMode,
        expectedBatchYield: data.expectedBatchYield ?? null,
        defaultSellingPrice: data.defaultSellingPrice ?? null,
        defaultPurchasePrice: data.defaultPurchasePrice ?? null,
        safetyStock: data.safetyStock,
        isMaster: false,
        parentId: parentId,
        variantAttrs: data.variantAttrs,
      })
      .returning({ id: items.id });

    // Create initial BOM only if provided by caller (not copied from master)
    if (data.bom && data.bom.length > 0) {
      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: variant.id,
        note: data.revisionNote,
        bom: data.bom,
      });
    }

    return variant;
  });
}

export async function getVariants(parentId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        stock: stockSubquery,
        committedQty: trimScale(items.committedQty).as("committedQty"),
        expectedQty: trimScale(items.expectedQty).as("expectedQty"),
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
        unit: unitDefinitions.name,
        variantAttrs: items.variantAttrs,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.parentId, parentId), isNull(items.deletedAt)));

    return rows.map((r) => ({
      ...r,
      unit: r.unit ?? null,
      variantAttrs: (r.variantAttrs as Record<string, string> | null) ?? null,
    }));
  });
}
