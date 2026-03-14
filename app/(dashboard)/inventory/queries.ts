// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, eq, isNull, isNotNull, sql, desc } from "drizzle-orm";
import { items, unitDefinitions, lots, stockMovements } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertItem, UpdateItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import type { ItemRow, ItemType } from "./types";

const inStockSubquery = sql<string>`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`.as("in_stock");

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
        inStock: inStockSubquery,
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
        inStock: inStockSubquery,
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

export async function updateItem(id: string, data: UpdateItem) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .update(items)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return row ?? null;
  });
}

export async function deleteItem(id: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return row != null;
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
export async function updateItemWithStock(
  id: string,
  itemData: UpdateItem,
  newStock?: number,
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (!item) return null;

    if (newStock != null) {
      const [stockResult] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
        .from(lots)
        .where(eq(lots.itemId, id));

      const currentStock = parseFloat(stockResult.total);
      const delta = newStock - currentStock;

      if (delta !== 0) {
        await adjustStockInTx(tx, orgId, userId, id, delta);
      }
    }

    return item;
  });
}

export async function createItemWithLot(
  data: Omit<InsertItem, "initialStock">,
  initialStock: string,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    if (parseFloat(initialStock) > 0) {
      const lotNumber = await generateLotNumber(tx);
      const [lot] = await tx.insert(lots).values({
        organizationId: orgId,
        itemId: item.id,
        lotNumber,
        quantity: initialStock,
        costPerUnit: data.defaultPurchasePrice ?? null,
      }).returning({ id: lots.id });

      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId: item.id,
        lotId: lot.id,
        quantity: initialStock,
        createdBy: userId,
      });
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
