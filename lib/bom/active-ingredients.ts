import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import type { BomComponentConstraint } from "./constraints";

export async function getCurrentActiveBomIngredientsInTx(tx: Tx, productId: string) {
  const [revision] = await tx
    .select({ id: bomRevisions.id })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));

  if (!revision) {
    return [];
  }

  const rows = await tx
    .select({
      bomRevisionComponentId: bomRevisionComponents.id,
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

  if (rows.length === 0) {
    return [];
  }

  const constraints = await tx
    .select({
      bomRevisionComponentId:
        bomRevisionComponentConstraints.bomRevisionComponentId,
      constraintType: bomRevisionComponentConstraints.constraintType,
      config: bomRevisionComponentConstraints.config,
      sortOrder: bomRevisionComponentConstraints.sortOrder,
    })
    .from(bomRevisionComponentConstraints)
    .where(
      and(
        eq(bomRevisionComponentConstraints.constraintType, "lot_age_min_days"),
        inArray(
          bomRevisionComponentConstraints.bomRevisionComponentId,
          rows.map((row) => row.bomRevisionComponentId)
        )
      )
    )
    .orderBy(
      asc(bomRevisionComponentConstraints.sortOrder),
      asc(bomRevisionComponentConstraints.createdAt)
    );

  const constraintsByComponentId = new Map<string, BomComponentConstraint[]>();
  for (const constraint of constraints) {
    const bucket =
      constraintsByComponentId.get(constraint.bomRevisionComponentId) ?? [];
    bucket.push({
      constraintType: constraint.constraintType as BomComponentConstraint["constraintType"],
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    });
    constraintsByComponentId.set(constraint.bomRevisionComponentId, bucket);
  }

  return rows.map((row) => ({
    ...row,
    constraints: constraintsByComponentId.get(row.bomRevisionComponentId) ?? [],
  }));
}
