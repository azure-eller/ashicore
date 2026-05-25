import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import {
  LOT_AGE_MIN_DAYS_CONSTRAINT,
  type BomComponentConstraint,
} from "./constraints";

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
      bomOutputQuantity: trimScale(bomRevisions.outputQuantity).as(
        "bomOutputQuantity"
      ),
      recipeBasis: bomRevisions.recipeBasis,
      itemId: bomRevisionComponents.componentId,
      itemName: items.name,
      itemSku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      quantityPerUnit: trimScale(bomRevisionComponents.quantity).as("quantityPerUnit"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
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

  const bomRevisionComponentIds = rows.map((row) => row.bomRevisionComponentId);
  const [constraints, alternates] = await Promise.all([
    tx
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
          eq(bomRevisionComponentConstraints.constraintType, LOT_AGE_MIN_DAYS_CONSTRAINT),
          inArray(
            bomRevisionComponentConstraints.bomRevisionComponentId,
            bomRevisionComponentIds
          )
        )
      )
      .orderBy(
        asc(bomRevisionComponentConstraints.sortOrder),
        asc(bomRevisionComponentConstraints.createdAt)
      ),
    tx
      .select({
        bomRevisionComponentId:
          bomRevisionComponentAlternates.bomRevisionComponentId,
        alternateItemId: bomRevisionComponentAlternates.alternateItemId,
        alternateItemName: bomRevisionComponentAlternates.alternateItemName,
        alternateItemSku: bomRevisionComponentAlternates.alternateItemSku,
        alternateItemType: bomRevisionComponentAlternates.alternateItemType,
        unitName: bomRevisionComponentAlternates.unitName,
        quantityFactor: trimScale(bomRevisionComponentAlternates.quantityFactor).as(
          "quantityFactor"
        ),
        sortOrder: bomRevisionComponentAlternates.sortOrder,
      })
      .from(bomRevisionComponentAlternates)
      .where(
        inArray(
          bomRevisionComponentAlternates.bomRevisionComponentId,
          bomRevisionComponentIds
        )
      )
      .orderBy(
        asc(bomRevisionComponentAlternates.sortOrder),
        asc(bomRevisionComponentAlternates.createdAt)
      ),
  ]);
  const displayNamesByItemId = await getItemDisplayNamesByIdInTx(tx, [
    ...rows.map((row) => row.itemId),
    ...alternates.map((alternate) => alternate.alternateItemId),
  ]);

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

  const alternatesByComponentId = new Map<
    string,
    Array<{
      itemId: string;
      itemName: string;
      itemSku: string | null;
      itemType: string;
      unitName: string;
      quantityFactor: string;
      sortOrder: number;
    }>
  >();
  for (const alternate of alternates) {
    const bucket = alternatesByComponentId.get(alternate.bomRevisionComponentId) ?? [];
    bucket.push({
      itemId: alternate.alternateItemId,
      itemName:
        displayNamesByItemId.get(alternate.alternateItemId) ??
        alternate.alternateItemName,
      itemSku: alternate.alternateItemSku,
      itemType: alternate.alternateItemType,
      unitName: alternate.unitName,
      quantityFactor: alternate.quantityFactor,
      sortOrder: alternate.sortOrder,
    });
    alternatesByComponentId.set(alternate.bomRevisionComponentId, bucket);
  }

  return rows.map((row) => ({
    ...row,
    itemName: displayNamesByItemId.get(row.itemId) ?? row.itemName,
    constraints: constraintsByComponentId.get(row.bomRevisionComponentId) ?? [],
    alternates: alternatesByComponentId.get(row.bomRevisionComponentId) ?? [],
  }));
}
