import "server-only";
// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import {
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  inventoryEvents,
  itemVariantValues,
  items,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import {
  canViewLockedBom,
  canViewUnlockedBom,
} from "@/lib/authz";
import type {
  Tx,
} from "@/lib/db/with-org-context";
import {
  projectedAvailableQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedOnHandQty,
  projectedPotentialQty,
} from "@/lib/inventory/kernel";
import { formatItemDisplayName } from "@/lib/inventory/display-name";
import type {
  DuplicateCombinationWarning,
  VariantOptionValueDisplay,
} from "../types";

export const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
// Most recent physical count for the item — drives the mobile "Counted Nd ago" label.
// Derived from stocktake reconciliation events (no denormalized column needed).
export const lastCountedAtSubquery = sql<string | null>`(
  SELECT MAX(${inventoryEvents.occurredAt})
  FROM ${inventoryEvents}
  WHERE ${inventoryEvents.itemId} = ${items.id}
    AND ${inventoryEvents.eventType} IN ('stocktake_verification', 'stocktake_gain', 'stocktake_loss')
)`.as("lastCountedAt");
export const demandQtySubquery = projectedDemandQty(
  items.organizationId,
  items.id
).as("demandQty");
export const availableQtySubquery = projectedAvailableQty(
  items.organizationId,
  items.id
).as("availableQty");
export const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");
export const potentialSubquery = projectedPotentialQty(
  items.organizationId,
  items.id,
  items.itemType
).as("potential");

export async function getVariantOptionValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, VariantOptionValueDisplay[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionId: variantOptions.id,
      optionName: variantOptions.name,
      optionCode: variantOptions.code,
      valueId: variantOptionValues.id,
      valueLabel: variantOptionValues.label,
      valueCode: variantOptionValues.code,
      optionDisabledAt: variantOptions.disabledAt,
      valueDisabledAt: variantOptionValues.disabledAt,
      sortOrder: variantOptions.sortOrder,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id),
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, VariantOptionValueDisplay[]>();
  for (const row of rows) {
    const values = byItemId.get(row.itemId) ?? [];
    values.push({
      optionId: row.optionId,
      optionName: row.optionName,
      optionCode: row.optionCode,
      valueId: row.valueId,
      valueLabel: row.valueLabel,
      valueCode: row.valueCode,
      optionDisabledAt: row.optionDisabledAt,
      valueDisabledAt: row.valueDisabledAt,
    });
    byItemId.set(row.itemId, values);
  }

  return byItemId;
}

export function formatNormalizedVariantDisplay(
  familyName: string | null,
  itemName: string,
  optionValues: VariantOptionValueDisplay[],
  deletedAt?: Date | null,
) {
  return formatItemDisplayName({
    name: itemName,
    familyName,
    optionLabels: optionValues.map((value) => value.valueLabel),
    deletedAt,
  });
}

export function buildDuplicateCombinationWarnings(
  rows: Array<{
    id: string;
    optionCombinationKey: string;
  }>,
) {
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.optionCombinationKey) continue;
    idsByKey.set(row.optionCombinationKey, [
      ...(idsByKey.get(row.optionCombinationKey) ?? []),
      row.id,
    ]);
  }

  const warningsByVariantId = new Map<string, DuplicateCombinationWarning[]>();
  for (const [optionCombinationKey, variantIds] of idsByKey.entries()) {
    if (variantIds.length < 2) continue;

    for (const variantId of variantIds) {
      warningsByVariantId.set(variantId, [
        ...(warningsByVariantId.get(variantId) ?? []),
        {
          variantId,
          duplicateOfVariantIds: variantIds.filter((id) => id !== variantId),
          optionCombinationKey,
          message: "Another variant uses the same option values.",
        },
      ]);
    }
  }

  return warningsByVariantId;
}

export type BomViewPermissions = {
  canViewUnlockedBom: boolean;
  canViewLockedBom: boolean;
};

export function getBomViewPermissions(assignedRoles: string[]): BomViewPermissions {
  return {
    canViewUnlockedBom: canViewUnlockedBom(assignedRoles),
    canViewLockedBom: canViewLockedBom(assignedRoles),
  };
}

export function hasBomViewAccess(permissions: BomViewPermissions) {
  return permissions.canViewUnlockedBom || permissions.canViewLockedBom;
}

export function getBomParentVisibilityCondition(
  bomLockedColumn: typeof items.bomLocked,
  permissions: BomViewPermissions,
) {
  if (permissions.canViewLockedBom) {
    return sql`true`;
  }

  if (permissions.canViewUnlockedBom) {
    return sql`${bomLockedColumn} = false`;
  }

  return sql`false`;
}
