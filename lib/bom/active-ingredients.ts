import { and, asc, eq, isNull } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";

export async function getCurrentActiveBomIngredientsInTx(tx: Tx, productId: string) {
  const [revision] = await tx
    .select({ id: bomRevisions.id })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));

  if (!revision) {
    return [];
  }

  return tx
    .select({
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      itemId: bomRevisionComponents.componentId,
      itemName: items.name,
      itemSku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      quantityPerUnit: trimScale(bomRevisionComponents.quantity).as("quantityPerUnit"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .innerJoin(items, eq(bomRevisionComponents.componentId, items.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        eq(bomRevisionComponents.bomRevisionId, revision.id),
        isNull(items.deletedAt)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );
}
