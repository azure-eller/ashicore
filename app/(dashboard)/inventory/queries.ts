import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { items, unitDefinitions } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { InsertItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import type { ItemRow, ItemType } from "./types";

export async function getItems(filters?: { itemType?: ItemType }): Promise<ItemRow[]> {
  return withAuthedOrgContext(async (tx, _orgId) => {
    const conditions = [
      isNull(items.deletedAt),
      ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
    ];

    return tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        inStock: items.inStock,
        unit: unitDefinitions.name,
        category: items.category,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));
  });
}

export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx, _orgId) => {
    const [row] = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: items.category,
        unitDefinitionId: items.unitDefinitionId,
        defaultPurchasePrice: items.defaultPurchasePrice,
        inStock: items.inStock,
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

export async function updateItem(id: string, data: InsertItem) {
  return withAuthedOrgContext(async (tx, _orgId) => {
    const [row] = await tx
      .update(items)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return row ?? null;
  });
}

export async function deleteItem(id: string): Promise<void> {
  return withAuthedOrgContext(async (tx, _orgId) => {
    await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(items.id, id));
  });
}

export async function getUnitDefinitions() {
  return withAuthedOrgContext(async (tx, _orgId) => {
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
  return withAuthedOrgContext(async (tx, _orgId) => {
    const rows = await tx
      .selectDistinct({ category: items.category })
      .from(items)
      .where(and(isNotNull(items.category), isNull(items.deletedAt)));

    return rows
      .map((r) => r.category)
      .filter((c): c is string => c !== null);
  });
}

export async function createItem(data: InsertItem): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });
    return row;
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
