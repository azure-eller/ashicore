import "server-only";
import {
  and,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  items,
  manufacturingResources,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  trimScale,
} from "@/lib/db/numeric";
import {
  normalizeNumeric,
} from "@/lib/format";
import {
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import {
  createLotAgeMinDaysConstraint,
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import {
  getItemLotTrackingModeInTx,
} from "@/lib/inventory/lot-tracking";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import type {
  Tx,
} from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  recordCostBasisChangeInTx,
} from "@/lib/inventory/kernel";
import {
  getCurrentBomOperationCostsInTx,
} from "@/lib/bom/operation-costs";
import {
  calculatePlannedOperationCost,
} from "@/lib/manufacturing/operation-costs";
import { InventoryError } from "./errors";

export type BomInputRow = {
  componentId: string;
  quantity: string;
  minimumLotAgeDays?: number | null;
  alternates?: Array<{ itemId: string; quantity?: string | null }>;
};

export type BomOperationCostInputRow = {
  operationName: string;
  resourceId: string;
  resourceName?: string;
  resourceType?: string;
  costScalingMode: "per_output_unit";
  crewSize: string;
  plannedMinutes: string;
  loadedCostPerHour?: string | null;
};

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: normalizeComparableNumber(row.quantity),
    minimumLotAgeDays: row.minimumLotAgeDays ?? null,
    // Quantity is part of the identity: editing only an alternate's number must still cut a
    // new revision, or the edit is silently discarded as "no change".
    alternates: (row.alternates ?? [])
      .map(
        (alternate) =>
          `${alternate.itemId}:${
            alternate.quantity == null
              ? ""
              : normalizeComparableNumber(alternate.quantity)
          }`
      )
      .sort(),
    sortOrder: index,
  }));
}

export function hasBomChanged(currentBom: BomInputRow[], nextBom: BomInputRow[]) {
  const normalizedCurrent = normalizeBomRows(currentBom);
  const normalizedNext = normalizeBomRows(nextBom);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.componentId !== nextRow.componentId ||
      row.quantity !== nextRow.quantity ||
      row.minimumLotAgeDays !== nextRow.minimumLotAgeDays ||
      row.alternates.join(",") !== nextRow.alternates.join(",") ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}

function normalizeOperationCostRows(operationCosts: BomOperationCostInputRow[]) {
  return operationCosts.map((row, index) => ({
    operationName: row.operationName.trim(),
    resourceId: row.resourceId,
    costScalingMode: row.costScalingMode,
    crewSize: normalizeComparableNumber(row.crewSize),
    plannedMinutes: normalizeComparableNumber(row.plannedMinutes),
    loadedCostPerHour:
      row.loadedCostPerHour == null
        ? null
        : normalizeComparableNumber(row.loadedCostPerHour),
    sortOrder: index,
  }));
}

export function hasBomOperationCostsChanged(
  currentRows: BomOperationCostInputRow[],
  nextRows: BomOperationCostInputRow[]
) {
  const normalizedCurrent = normalizeOperationCostRows(currentRows);
  const normalizedNext = normalizeOperationCostRows(nextRows);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.operationName !== nextRow.operationName ||
      row.resourceId !== nextRow.resourceId ||
      row.crewSize !== nextRow.crewSize ||
      row.plannedMinutes !== nextRow.plannedMinutes ||
      row.loadedCostPerHour !== nextRow.loadedCostPerHour ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}

function normalizeComparableNumber(value: string) {
  return Number(value).toString();
}

export async function createBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    productId: string;
    note?: string | null;
    outputQuantity?: string | null;
    recipeBasis?: "unit" | "batch";
    bom: BomInputRow[];
    operationCosts?: BomOperationCostInputRow[];
  }
) {
  const [currentRevision] = await tx
    .select({ revisionNumber: bomRevisions.revisionNumber })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)))
    .for("update");

  await tx
    .update(bomRevisions)
    .set({
      isCurrent: false,
      updatedAt: new Date(),
    })
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)));

  const [revision] = await tx
    .insert(bomRevisions)
    .values({
      organizationId: params.orgId,
      productId: params.productId,
      revisionNumber: (currentRevision?.revisionNumber ?? 0) + 1,
      outputQuantity: params.outputQuantity ?? "1",
      recipeBasis: params.recipeBasis ?? "unit",
      isCurrent: true,
      note: params.note ?? null,
      createdBy: params.userId,
    })
    .returning({
      id: bomRevisions.id,
      revisionNumber: bomRevisions.revisionNumber,
    });

  if (params.bom.length > 0) {
    const componentIds = [...new Set(params.bom.map((row) => row.componentId))];
    if (componentIds.includes(params.productId)) {
      throw new InventoryError("A BOM cannot include its own product", 400);
    }

    const componentRows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(inArray(items.id, componentIds), isNull(items.deletedAt)));

    const componentById = new Map(componentRows.map((row) => [row.id, row]));

    const componentValues = params.bom.map((row, index) => {
      const component = componentById.get(row.componentId);

      if (!component) {
        throw new InventoryError("BOM component not found", 400);
      }

      return {
        bomRevisionId: revision.id,
        componentId: row.componentId,
        componentName: component.name,
        componentSku: component.sku,
        componentItemType: component.itemType,
        unitName: component.unitName,
        quantity: row.quantity,
        sortOrder: index,
      };
    });

    const insertedComponents = await tx
      .insert(bomRevisionComponents)
      .values(componentValues)
      .returning({
        id: bomRevisionComponents.id,
        componentId: bomRevisionComponents.componentId,
        sortOrder: bomRevisionComponents.sortOrder,
      });

    const alternateItemIds = [
      ...new Set(
        params.bom.flatMap((row) =>
          (row.alternates ?? []).map((alternate) => alternate.itemId)
        )
      ),
    ];
    const alternateRows =
      alternateItemIds.length === 0
        ? []
        : await tx
            .select({
              id: items.id,
              name: items.name,
              sku: items.sku,
              itemType: items.itemType,
              unitName: unitDefinitions.name,
              unitSize: trimScale(unitDefinitions.size).as("unitSize"),
              unitUom: unitDefinitions.uom,
            })
            .from(items)
            .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
            .where(and(inArray(items.id, alternateItemIds), isNull(items.deletedAt)));
    const alternateById = new Map(alternateRows.map((row) => [row.id, row]));

    const inputBySortOrder = new Map(
      params.bom.map((input, sortOrder) => [sortOrder, input])
    );

    for (const component of insertedComponents) {
      const input = inputBySortOrder.get(component.sortOrder);
      if (
        input?.minimumLotAgeDays != null &&
        (await getItemLotTrackingModeInTx(tx, component.componentId)) === "untracked"
      ) {
        throw new InventoryError(
          "Minimum lot age requirements are only available for lot-tracked components.",
          400
        );
      }
    }

    const constraintRows = insertedComponents.flatMap((component) => {
      const input = inputBySortOrder.get(component.sortOrder);
      const constraint = createLotAgeMinDaysConstraint(
        input?.minimumLotAgeDays ?? null
      );
      if (!constraint) return [];

      return [
        {
          bomRevisionComponentId: component.id,
          constraintType: constraint.constraintType,
          config: constraint.config,
          sortOrder: constraint.sortOrder,
        },
      ];
    });

    if (constraintRows.length > 0) {
      await tx.insert(bomRevisionComponentConstraints).values(constraintRows);
    }

    const alternateValues = insertedComponents.flatMap((component) => {
      const input = inputBySortOrder.get(component.sortOrder);
      const defaultComponent = componentById.get(component.componentId);

      return (input?.alternates ?? []).map((alternate, alternateIndex) => {
        const alternateItem = alternateById.get(alternate.itemId);

        if (!defaultComponent || !alternateItem) {
          throw new InventoryError("BOM alternate component not found", 400);
        }

        // The recipe author types the alternate's quantity in its own unit, so nothing is
        // derived from unit sizes and unit-incompatible alternates are no longer rejected —
        // substituting a differently-shaped package is the whole point. Older rows that
        // carry only a factor are left alone; this path always writes an explicit quantity.
        const typedQuantity =
          alternate.quantity == null ? null : normalizeNumeric(Number(alternate.quantity));

        if (typedQuantity == null) {
          throw new InventoryError(
            `Enter how much ${alternateItem.name} replaces ${defaultComponent.name}.`,
            400
          );
        }

        return {
          bomRevisionComponentId: component.id,
          alternateItemId: alternateItem.id,
          alternateItemName: alternateItem.name,
          alternateItemSku: alternateItem.sku,
          alternateItemType: alternateItem.itemType,
          unitName: alternateItem.unitName,
          quantity: typedQuantity,
          quantityFactor: null,
          sortOrder: alternateIndex,
        };
      });
    });

    if (alternateValues.length > 0) {
      await tx.insert(bomRevisionComponentAlternates).values(alternateValues);
    }
  }

  if (params.operationCosts && params.operationCosts.length > 0) {
    const resourceIds = [...new Set(params.operationCosts.map((row) => row.resourceId))];
    const resourceRows = await tx
      .select({
        id: manufacturingResources.id,
        name: manufacturingResources.name,
        resourceType: manufacturingResources.resourceType,
        loadedCostPerHour: trimScale(manufacturingResources.loadedCostPerHour).as(
          "loadedCostPerHour"
        ),
      })
      .from(manufacturingResources)
      .where(and(inArray(manufacturingResources.id, resourceIds), isNull(manufacturingResources.deletedAt)));
    const resourceById = new Map(resourceRows.map((row) => [row.id, row]));

    await tx.insert(bomRevisionOperationCosts).values(
      params.operationCosts.map((row, index) => {
        const resource = resourceById.get(row.resourceId);
        const snapshot =
          resource ??
          (row.resourceName && row.resourceType && row.loadedCostPerHour != null
            ? {
                id: row.resourceId,
                name: row.resourceName,
                resourceType: row.resourceType,
                loadedCostPerHour: row.loadedCostPerHour,
              }
            : null);
        if (!snapshot) {
          throw new InventoryError("Operation resource not found", 400);
        }

        return {
          bomRevisionId: revision.id,
          resourceId: row.resourceId,
          operationName: row.operationName.trim(),
          resourceName: snapshot.name,
          resourceType: snapshot.resourceType,
          costScalingMode: row.costScalingMode,
          crewSize: row.crewSize,
          plannedMinutes: row.plannedMinutes,
          loadedCostPerHour: row.loadedCostPerHour ?? snapshot.loadedCostPerHour,
          plannedCostTotal: calculatePlannedOperationCost({
            costScalingMode: row.costScalingMode,
            crewSize: row.crewSize,
            plannedMinutes: row.plannedMinutes,
            loadedCostPerHour: row.loadedCostPerHour ?? snapshot.loadedCostPerHour,
            outputQuantity: Number(params.outputQuantity ?? "1"),
          }),
          sortOrder: index,
        };
      })
    );
  }

  return revision;
}

export async function setBomLock(
  id: string,
  locked: boolean,
  options?: { idempotencyKey?: string }
): Promise<{ id: string; bomLocked: boolean } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      { id: string; bomLocked: boolean } | null
    >(tx, {
      organizationId: orgId,
      operationName: "setBomLock",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, locked },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        bomLocked: items.bomLocked,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem || existingItem.itemType !== "product") {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const [item] = await tx
      .update(items)
      .set({
        bomLocked: locked,
        bomLockedAt: locked ? new Date() : null,
        bomLockedByUserId: locked ? userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({
        id: items.id,
        bomLocked: items.bomLocked,
      });

    if (item && item.bomLocked !== existingItem.bomLocked) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: locked ? "bom_locked" : "bom_unlocked",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          locked ? "bom-lock" : "bom-unlock"
        ),
        metadata: {
          before: existingItem.bomLocked,
          after: item.bomLocked,
        },
      });
    }

    const result = item ?? null;

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function copyCurrentBomToVariants(
  sourceItemId: string,
  targetVariantIds?: string[],
  note?: string | null,
  options?: { idempotencyKey?: string | null }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ copied: Array<{ id: string; revisionId: string }> }>(tx, {
      organizationId: orgId,
      operationName: "copyItemCardBom",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId, targetVariantIds: targetVariantIds ?? null, note: note ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [source] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
      })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId || source.itemType !== "product") {
      throw new InventoryError("Source product variant not found", 404);
    }

    const targets = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
      })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      );

    const targetIds = targets
      .filter((target) => target.id !== sourceItemId && target.itemType === "product")
      .map((target) => target.id);

    if (targetVariantIds && targetIds.length !== new Set(targetVariantIds).size) {
      throw new InventoryError("One or more target variants were not found on this card", 400);
    }

    const sourceBom = await getCurrentBomComponentsInTx(tx, sourceItemId);
    const sourceRevision = await getCurrentBomRevisionInTx(tx, sourceItemId);
    const sourceOperationCosts = await getCurrentBomOperationCostsInTx(tx, sourceItemId);
    const bom: BomInputRow[] = sourceBom.map((row) => ({
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
        // Carry the typed quantity through the copy, or the alternate silently reverts to
        // the base line's number on the copied recipe.
        quantity: alternate.quantity,
      })),
    }));
    const operationCosts: BomOperationCostInputRow[] = sourceOperationCosts.map((row) => ({
      operationName: row.operationName,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      resourceType: row.resourceType,
      costScalingMode: "per_output_unit" as const,
      crewSize: row.crewSize,
      plannedMinutes: row.plannedMinutes,
      loadedCostPerHour: row.loadedCostPerHour,
    }));

    const copied: Array<{ id: string; revisionId: string }> = [];
    for (const productId of targetIds) {
      const revision = await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId,
        note: note ?? `Copied from ${sourceItemId}`,
        outputQuantity: sourceRevision?.outputQuantity ?? null,
        recipeBasis: sourceRevision?.recipeBasis === "batch" ? "batch" : "unit",
        bom,
        operationCosts,
      });
      copied.push({ id: productId, revisionId: revision.id });
    }

    const result = { copied };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function copyCurrentOperationsToVariants(
  sourceItemId: string,
  targetVariantIds?: string[],
  note?: string | null,
  options?: { idempotencyKey?: string | null }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ copied: Array<{ id: string; revisionId: string }> }>(tx, {
      organizationId: orgId,
      operationName: "copyItemCardOperations",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId, targetVariantIds: targetVariantIds ?? null, note: note ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [source] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
      })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId || source.itemType !== "product") {
      throw new InventoryError("Source product variant not found", 404);
    }

    const targets = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
      })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      );

    const targetIds = targets
      .filter((target) => target.id !== sourceItemId && target.itemType === "product")
      .map((target) => target.id);

    if (targetVariantIds && targetIds.length !== new Set(targetVariantIds).size) {
      throw new InventoryError("One or more target variants were not found on this card", 400);
    }

    const sourceOperationCosts = await getCurrentBomOperationCostsInTx(tx, sourceItemId);
    const operationCosts: BomOperationCostInputRow[] = sourceOperationCosts.map((row) => ({
      operationName: row.operationName,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      resourceType: row.resourceType,
      costScalingMode: "per_output_unit" as const,
      crewSize: row.crewSize,
      plannedMinutes: row.plannedMinutes,
      loadedCostPerHour: row.loadedCostPerHour,
    }));

    const copied: Array<{ id: string; revisionId: string }> = [];
    for (const productId of targetIds) {
      const targetBom = await getCurrentBomComponentsInTx(tx, productId);
      const targetRevision = await getCurrentBomRevisionInTx(tx, productId);
      const bom: BomInputRow[] = targetBom.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.alternateItemId,
        })),
      }));

      const revision = await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId,
        note: note ?? `Copied operations from ${sourceItemId}`,
        outputQuantity: targetRevision?.outputQuantity ?? null,
        recipeBasis: targetRevision?.recipeBasis === "batch" ? "batch" : "unit",
        bom,
        operationCosts,
      });
      copied.push({ id: productId, revisionId: revision.id });
    }

    const result = { copied };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function hasLockedBomCopyTarget(
  sourceItemId: string,
  targetVariantIds?: string[]
) {
  return withAuthedOrgContext(async (tx) => {
    const [source] = await tx
      .select({ familyId: items.familyId })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId) {
      throw new InventoryError("Source product variant not found", 404);
    }

    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          eq(items.itemType, "product"),
          eq(items.bomLocked, true),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      )
      .limit(1);

    return rows.length > 0;
  });
}
