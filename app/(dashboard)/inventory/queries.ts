// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, eq, isNull, isNotNull, sql, desc } from "drizzle-orm";
import { items, unitDefinitions, lots, stockMovements, bomComponents } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertItem, UpdateItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import type { ItemRow, ItemType } from "./types";

const stockSubquery = sql<string>`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`.as("stock");

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
        committedQty: items.committedQty,
        expectedQty: items.expectedQty,
        safetyStock: items.safetyStock,
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
        defaultPurchasePrice: items.defaultPurchasePrice,
        defaultSellingPrice: items.defaultSellingPrice,
        bomMode: items.bomMode,
        stock: stockSubquery,
        committedQty: items.committedQty,
        expectedQty: items.expectedQty,
        safetyStock: items.safetyStock,
        unitName: unitDefinitions.name,
        unitSize: unitDefinitions.size,
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, id), isNull(items.deletedAt)));
    return row ?? null;
  });
}

export async function deleteItem(id: string): Promise<{ deleted: boolean; usedInBom?: boolean }> {
  return withAuthedOrgContext(async (tx) => {
    // Check BOM usage inside the same transaction to avoid race conditions
    const [bomRef] = await tx
      .select({ id: bomComponents.id })
      .from(bomComponents)
      .innerJoin(items, eq(bomComponents.itemId, items.id))
      .where(and(eq(bomComponents.componentId, id), isNull(items.deletedAt)))
      .limit(1);

    if (bomRef) {
      return { deleted: false, usedInBom: true };
    }

    const [row] = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return { deleted: row != null };
  });
}

export async function getUnitDefinitions() {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: unitDefinitions.size,
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
        quantity: lots.quantity,
        costPerUnit: lots.costPerUnit,
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
        quantity: stockMovements.quantity,
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


async function generateLotNumber(tx: Tx): Promise<string> {
  const result = await tx.execute(
    sql`SELECT nextval('inventory.lot_number_seq') AS val`
  );
  const val = Number((result.rows[0] as { val: string }).val);
  return `LOT-${String(val).padStart(6, "0")}`;
}

// Deduct stock FIFO across lots for a given item within an existing transaction.
// Throws if insufficient stock — caller should catch and handle.
async function fifoDeduct(
  tx: Tx,
  itemId: string,
  amount: number
): Promise<Array<{ lotId: string; quantity: number }>> {
  const availableLots = await tx
    .select({
      id: lots.id,
      quantity: lots.quantity,
    })
    .from(lots)
    .where(and(eq(lots.itemId, itemId), sql`${lots.quantity} > 0`))
    .orderBy(lots.receivedAt);

  const totalAvailable = availableLots.reduce(
    (sum, lot) => sum + parseFloat(lot.quantity),
    0
  );

  if (totalAvailable < amount) {
    throw new Error(
      `Insufficient stock. Available: ${totalAvailable}, requested: ${amount}`
    );
  }

  let remaining = amount;
  const allocations: Array<{ lotId: string; quantity: number }> = [];

  for (const lot of availableLots) {
    if (remaining <= 0) break;
    const lotQty = parseFloat(lot.quantity);
    const deduct = Math.min(lotQty, remaining);

    await tx
      .update(lots)
      .set({
        quantity: (lotQty - deduct).toString(),
        updatedAt: new Date(),
      })
      .where(eq(lots.id, lot.id));

    allocations.push({ lotId: lot.id, quantity: deduct });
    remaining -= deduct;
  }

  return allocations;
}

// Adjust stock within an existing transaction. Does not create its own transaction.
async function adjustStockInTx(
  tx: Tx,
  orgId: string,
  userId: string,
  itemId: string,
  delta: number,
): Promise<void> {
  if (delta > 0) {
    const lotNumber = await generateLotNumber(tx);
    const [newLot] = await tx
      .insert(lots)
      .values({
        organizationId: orgId,
        itemId,
        lotNumber,
        quantity: delta.toString(),
      })
      .returning({ id: lots.id });

    await tx.insert(stockMovements).values({
      organizationId: orgId,
      itemId,
      lotId: newLot.id,
      quantity: delta.toString(),
      createdBy: userId,
    });
  } else {
    const allocations = await fifoDeduct(tx, itemId, Math.abs(delta));

    for (const alloc of allocations) {
      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId,
        lotId: alloc.lotId,
        quantity: (-alloc.quantity).toString(),
        createdBy: userId,
      });
    }
  }
}

// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom">,
  stock?: number,
  bom?: Array<{ componentId: string; quantity: string | null; percentage: string | null }>,
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (!item) return null;

    if (stock != null) {
      const [stockResult] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
        .from(lots)
        .where(eq(lots.itemId, id));

      const currentStock = parseFloat(stockResult.total);
      const delta = stock - currentStock;

      if (delta !== 0) {
        await adjustStockInTx(tx, orgId, userId, id, delta);
      }
    }

    if (bom !== undefined) {
      await tx.delete(bomComponents).where(eq(bomComponents.itemId, id));
      if (bom.length > 0) {
        await tx.insert(bomComponents).values(
          bom.map((row) => ({
            itemId: id,
            componentId: row.componentId,
            quantity: row.quantity,
            percentage: row.percentage,
          }))
        );
      }
    }

    return item;
  });
}

export async function createItemWithLot(
  data: Omit<InsertItem, "stock" | "bom">,
  stock: string,
  bom?: Array<{ componentId: string; quantity: string | null; percentage: string | null }>,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    if (parseFloat(stock) > 0) {
      const lotNumber = await generateLotNumber(tx);
      const [lot] = await tx.insert(lots).values({
        organizationId: orgId,
        itemId: item.id,
        lotNumber,
        quantity: stock,
        costPerUnit: data.defaultPurchasePrice ?? null,
      }).returning({ id: lots.id });

      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId: item.id,
        lotId: lot.id,
        quantity: stock,
        createdBy: userId,
      });
    }

    if (bom && bom.length > 0) {
      await tx.insert(bomComponents).values(
        bom.map((row) => ({
          itemId: item.id,
          componentId: row.componentId,
          quantity: row.quantity,
          percentage: row.percentage,
        }))
      );
    }

    return item;
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
        size: unitDefinitions.size,
        uom: unitDefinitions.uom,
      });
    return row;
  });
}

export async function getBomComponents(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: bomComponents.id,
        componentId: bomComponents.componentId,
        quantity: bomComponents.quantity,
        percentage: bomComponents.percentage,
        componentName: items.name,
        componentItemType: items.itemType,
        componentUnit: unitDefinitions.name,
      })
      .from(bomComponents)
      .innerJoin(items, eq(bomComponents.componentId, items.id))
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(bomComponents.itemId, itemId), isNull(items.deletedAt)));
    return rows;
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

export async function isItemUsedInBom(itemId: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({ id: bomComponents.id })
      .from(bomComponents)
      .innerJoin(items, eq(bomComponents.itemId, items.id))
      .where(and(eq(bomComponents.componentId, itemId), isNull(items.deletedAt)))
      .limit(1);
    return row != null;
  });
}
