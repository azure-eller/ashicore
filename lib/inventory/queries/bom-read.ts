import "server-only";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  itemFamilies,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  getBomRevisionComponentsInTx,
  getBomRevisionComponentsByRevisionIdInTx,
  getBomRevisionHistoryInTx,
  getCurrentBomComponentsInTx,
} from "@/lib/bom/revisions";
import {
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import {
  getAuthedMemberContext,
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import {
  getCurrentBomOperationCostsInTx,
} from "@/lib/bom/operation-costs";
import { getVariantOptionValuesByItemIdInTx, formatNormalizedVariantDisplay, getBomViewPermissions, hasBomViewAccess, getBomParentVisibilityCondition } from "./shared";

export async function getBomComponents(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await getCurrentBomComponentsInTx(tx, itemId);

    return rows.map((row) => ({
      id: row.id,
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
      constraints: row.constraints,
      componentName: row.componentName,
      componentItemType: row.componentItemType,
      componentUnit: row.unitName,
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
        itemName: alternate.alternateItemName,
        itemSku: alternate.alternateItemSku,
        itemType: alternate.alternateItemType,
        unitName: alternate.unitName,
        quantityFactor: alternate.quantityFactor,
      })),
    }));
  });
}

export async function getBomOperationCosts(itemId: string) {
  return withAuthedOrgContext(async (tx) =>
    getCurrentBomOperationCostsInTx(tx, itemId)
  );
}

export async function getBomRevisionHistory(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);
    const componentsByRevisionId = await getBomRevisionComponentsByRevisionIdInTx(
      tx,
      revisions.map((revision) => revision.id)
    );

    return revisions.map((revision) => ({
      ...revision,
      components: componentsByRevisionId.get(revision.id) ?? [],
    }));
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

export async function getUsedInParents(itemId: string) {
  const context = await getAuthedMemberContext();
  const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

  return withAuthedOrgContext(async (tx) => {
    if (!hasBomViewAccess(bomViewPermissions)) {
      return [];
    }

    const bomParentVisibilityCondition = getBomParentVisibilityCondition(
      items.bomLocked,
      bomViewPermissions,
    );
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
      })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(
        and(
          eq(bomRevisionComponents.componentId, itemId),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt),
          bomParentVisibilityCondition,
        ),
      )
      .orderBy(asc(items.name));

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(
      tx,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const optionValues = optionValuesByItemId.get(row.id) ?? [];
      const displayName = formatNormalizedVariantDisplay(
        row.familyName,
        row.name,
        optionValues,
      );

      return {
        id: row.id,
        name: row.name,
        displayName,
      };
    });
  });
}

export async function getAvailableComponents(excludeItemId?: string) {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [isNull(items.deletedAt), isNotNull(items.familyId)];
    if (excludeItemId) {
      conditions.push(sql`${items.id} != ${excludeItemId}`);
    }
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
        itemType: items.itemType,
        unit: unitDefinitions.name,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(
      tx,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const optionValues = optionValuesByItemId.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        displayName: formatNormalizedVariantDisplay(
          row.familyName,
          row.name,
          optionValues,
        ),
        itemType: row.itemType,
        unit: row.unit,
      };
    });
  });
}
