import { and, eq, isNull } from "drizzle-orm";
import { items, unitDefinitions } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { ItemRow } from "./types";

export async function getItems(filters?: { itemType?: string }): Promise<ItemRow[]> {
  return withAuthedOrgContext(async (tx) => {
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

export async function deleteItem(id: string): Promise<void> {
  return withAuthedOrgContext(async (tx) => {
    await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(items.id, id));
  });
}
