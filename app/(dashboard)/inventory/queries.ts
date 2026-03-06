// app/(dashboard)/inventory/queries.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, unitDefinitions } from "@/lib/db/schema";
import { getAuthedContext } from "@/lib/dal/auth";
import type { ItemRow } from "./types";

export async function getItems(filters?: { itemType?: string }): Promise<ItemRow[]> {
  const { orgId } = await getAuthedContext();

  const conditions = [
    eq(items.organizationId, orgId),
    isNull(items.deletedAt),
    ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
  ];

  const rows = await db
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

  return rows;
}

export async function deleteItem(id: string): Promise<void> {
  const { orgId } = await getAuthedContext();

  await db
    .update(items)
    .set({ deletedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.organizationId, orgId)));
}
