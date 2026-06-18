import "server-only";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  itemFamilies,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  trimScale,
} from "@/lib/db/numeric";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import { InventoryError } from "./errors";

export async function getValidatedUnitDefinitionInTx(tx: Tx, unitDefinitionId: string) {
  const [unit] = await tx
    .select({ id: unitDefinitions.id, name: unitDefinitions.name })
    .from(unitDefinitions)
    .where(and(eq(unitDefinitions.id, unitDefinitionId), isNull(unitDefinitions.deletedAt)));

  if (!unit) {
    throw new InventoryError("Unit not found", 404);
  }

  return unit;
}

export async function getUnitDefinitions() {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
        isInUse: sql<boolean>`exists (
          select 1
          from ${itemFamilies}
          where ${itemFamilies.deletedAt} is null
            and (
              ${itemFamilies.unitDefinitionId} = ${unitDefinitions.id}
              or ${itemFamilies.purchaseUnitDefinitionId} = ${unitDefinitions.id}
            )
        ) or exists (
          select 1
          from ${items}
          where ${items.deletedAt} is null
            and (
              ${items.unitDefinitionId} = ${unitDefinitions.id}
              or ${items.purchaseUnitDefinitionId} = ${unitDefinitions.id}
            )
        )`.as("isInUse"),
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
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      });
    return row;
  });
}

export async function updateUnitDefinition(
  unitId: string,
  data: InsertUnitDefinition,
): Promise<{ id: string; name: string; size: string; uom: string }> {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .update(unitDefinitions)
      .set(data)
      .where(and(eq(unitDefinitions.id, unitId), isNull(unitDefinitions.deletedAt)))
      .returning({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      });
    if (!row) {
      throw new InventoryError("Unit not found.", 404);
    }
    return row;
  });
}

export async function deleteUnitDefinition(unitId: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx) => {
    const activeUnits = await tx
      .select({ id: unitDefinitions.id })
      .from(unitDefinitions)
      .where(isNull(unitDefinitions.deletedAt))
      .orderBy(asc(unitDefinitions.id))
      .for("update");
    const deletingActiveUnit = activeUnits.some((unit) => unit.id === unitId);

    if (deletingActiveUnit && activeUnits.length === 1) {
      throw new InventoryError("At least one unit is required.", 409);
    }

    const [referencedFamily] = await tx
      .select({ id: itemFamilies.id })
      .from(itemFamilies)
      .where(
        and(
          isNull(itemFamilies.deletedAt),
          or(
            eq(itemFamilies.unitDefinitionId, unitId),
            eq(itemFamilies.purchaseUnitDefinitionId, unitId),
          ),
        ),
      )
      .limit(1);
    const [referencedItem] = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          isNull(items.deletedAt),
          or(
            eq(items.unitDefinitionId, unitId),
            eq(items.purchaseUnitDefinitionId, unitId),
          ),
        ),
      )
      .limit(1);

    if (referencedFamily || referencedItem) {
      throw new InventoryError("Unit is in use and cannot be deleted.", 409);
    }

    const [row] = await tx
      .update(unitDefinitions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(unitDefinitions.id, unitId), isNull(unitDefinitions.deletedAt)))
      .returning({ id: unitDefinitions.id });

    return Boolean(row);
  });
}
