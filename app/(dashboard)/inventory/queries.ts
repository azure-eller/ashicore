// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { items, unitDefinitions, lots } from "@/lib/db/schema";
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

// Lot numbers are sequential per org (LOT-000001, LOT-000002, etc.).
// RLS scopes the MAX query to the current org automatically.
async function generateLotNumber(tx: Tx): Promise<string> {
  const [result] = await tx
    .select({ maxLot: sql<string | null>`MAX(${lots.lotNumber})` })
    .from(lots);

  const current = result?.maxLot;
  if (!current) return "LOT-000001";

  const num = parseInt(current.replace("LOT-", ""), 10);
  return `LOT-${String(num + 1).padStart(6, "0")}`;
}

export async function createItemWithLot(
  data: Omit<InsertItem, "initialStock">,
  initialStock: string,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    const lotNumber = await generateLotNumber(tx);

    await tx.insert(lots).values({
      organizationId: orgId,
      itemId: item.id,
      lotNumber,
      quantity: initialStock,
      costPerUnit: data.defaultPurchasePrice ?? null,
    });

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
