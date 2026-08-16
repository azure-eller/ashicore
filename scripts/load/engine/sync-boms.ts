import { and, desc, eq, inArray } from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import { normalizeNumeric } from "@/lib/format";
import { createLotAgeMinDaysConstraint } from "@/lib/bom/constraints";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  BomSeedRow,
  ExistingBomRow,
  ExistingItem,
  ItemSeed,
  Report,
} from "./types";
import {
  requireLoaderDerivedPositiveQuantity,
  requireLoaderPositiveQuantity,
} from "./quantity-validation";

function validateSeedBomQuantities(seed: ItemSeed) {
  requireLoaderPositiveQuantity(
    resolveSeedBomOutputQuantity(seed),
    `BOM output quantity for product "${seed.name}" (${seed.key})`,
  );
  for (const row of seed.bom ?? []) {
    requireLoaderPositiveQuantity(
      row.quantity,
      `BOM component "${row.componentKey}" for product "${seed.name}" (${seed.key})`,
    );
  }
}

export function getManagedProductSeedsWithBom(seeds: ItemSeed[]): ItemSeed[] {
  return seeds.filter((seed) => seed.bom && seed.bom.length > 0);
}

export function resolveSeedBomOutputQuantity(seed: ItemSeed) {
  return seed.manufacturingMode === "batch"
    ? (seed.expectedBatchYield ?? seed.typicalBatchSize ?? "1")
    : "1";
}

export function resolveSeedRecipeBasis(seed: ItemSeed) {
  return seed.manufacturingMode === "batch" ? "batch" : "unit";
}

export function buildBomSignature(
  rows: Array<{
    componentId: string;
    quantity: string;
    minimumLotAgeDays?: number | null;
    alternateItemIds?: string[];
  }>
) {
  return rows
    .map(
      (row) =>
        `${row.componentId}:${normalizeNumeric(Number(row.quantity))}:${
          row.minimumLotAgeDays ?? ""
        }:${[...(row.alternateItemIds ?? [])].sort().join(",")}`
    )
    .sort()
    .join("|");
}

export async function loadCurrentBomRowsInTx(tx: Tx, productIds: string[]) {
  if (productIds.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      itemId: bomRevisions.productId,
      bomRevisionComponentId: bomRevisionComponents.id,
      componentId: bomRevisionComponents.componentId,
      quantity: bomRevisionComponents.quantity,
    })
    .from(bomRevisionComponents)
    .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
    .where(
      and(inArray(bomRevisions.productId, productIds), eq(bomRevisions.isCurrent, true))
    );

  if (rows.length === 0) {
    return [];
  }

  const constraints = await tx
    .select({
      bomRevisionComponentId:
        bomRevisionComponentConstraints.bomRevisionComponentId,
      config: bomRevisionComponentConstraints.config,
    })
    .from(bomRevisionComponentConstraints)
    .where(
      and(
        inArray(
          bomRevisionComponentConstraints.bomRevisionComponentId,
          rows.map((row) => row.bomRevisionComponentId)
        ),
        eq(bomRevisionComponentConstraints.constraintType, "lot_age_min_days")
      )
    );
  const minimumLotAgeDaysByComponentId = new Map(
    constraints.map((constraint) => [
      constraint.bomRevisionComponentId,
      Number(constraint.config.days),
    ])
  );
  const alternates = await tx
    .select({
      bomRevisionComponentId:
        bomRevisionComponentAlternates.bomRevisionComponentId,
      alternateItemId: bomRevisionComponentAlternates.alternateItemId,
    })
    .from(bomRevisionComponentAlternates)
    .where(
      inArray(
        bomRevisionComponentAlternates.bomRevisionComponentId,
        rows.map((row) => row.bomRevisionComponentId)
      )
    );
  const alternateItemIdsByComponentId = new Map<string, string[]>();
  for (const alternate of alternates) {
    const bucket =
      alternateItemIdsByComponentId.get(alternate.bomRevisionComponentId) ?? [];
    bucket.push(alternate.alternateItemId);
    alternateItemIdsByComponentId.set(alternate.bomRevisionComponentId, bucket);
  }

  return rows.map((row) => ({
    itemId: row.itemId,
    componentId: row.componentId,
    quantity: row.quantity,
    minimumLotAgeDays:
      minimumLotAgeDaysByComponentId.get(row.bomRevisionComponentId) ?? null,
    alternateItemIds:
      alternateItemIdsByComponentId.get(row.bomRevisionComponentId) ?? [],
  }));
}

export async function createLoaderBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    productId: string;
    recipeBasis: "unit" | "batch";
    outputQuantity: string;
    bom: BomSeedRow[];
    createdBy: string;
    note: string;
  }
) {
  requireLoaderPositiveQuantity(
    params.outputQuantity,
    `BOM output quantity for product ${params.productId}`,
  );
  for (const row of params.bom) {
    requireLoaderPositiveQuantity(
      row.quantity,
      `BOM component ${row.componentId} for product ${params.productId}`,
    );
  }

  const [currentRevision] = await tx
    .select({
      id: bomRevisions.id,
      revisionNumber: bomRevisions.revisionNumber,
    })
    .from(bomRevisions)
    .where(eq(bomRevisions.productId, params.productId))
    .orderBy(desc(bomRevisions.revisionNumber))
    .limit(1);

  await tx
    .update(bomRevisions)
    .set({
      isCurrent: false,
      updatedAt: new Date(),
    })
    .where(eq(bomRevisions.productId, params.productId));

  const [revision] = await tx
    .insert(bomRevisions)
    .values({
      organizationId: params.orgId,
      productId: params.productId,
      revisionNumber: (currentRevision?.revisionNumber ?? 0) + 1,
      recipeBasis: params.recipeBasis,
      outputQuantity: params.outputQuantity,
      isCurrent: true,
      note: params.note,
      createdBy: params.createdBy,
    })
    .returning({ id: bomRevisions.id });

  const componentIds = [...new Set(params.bom.map((row) => row.componentId))];
  const componentRows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      unitSize: unitDefinitions.size,
      unitUom: unitDefinitions.uom,
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(items.id, componentIds));
  const componentById = new Map(componentRows.map((row) => [row.id, row]));

  const insertedComponents = await tx
    .insert(bomRevisionComponents)
    .values(params.bom.map((row, index) => {
      const component = componentById.get(row.componentId);

      if (!component) {
        throw new Error(`BOM component not found for revision sync: ${row.componentId}`);
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
    }))
    .returning({
      id: bomRevisionComponents.id,
      componentId: bomRevisionComponents.componentId,
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
            unitSize: unitDefinitions.size,
            unitUom: unitDefinitions.uom,
          })
          .from(items)
          .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
          .where(inArray(items.id, alternateItemIds));
  const alternateById = new Map(alternateRows.map((row) => [row.id, row]));

  const constraintRows = insertedComponents.flatMap((component, index) => {
    const constraint = createLotAgeMinDaysConstraint(
      params.bom[index].minimumLotAgeDays ?? null
    );
    if (!constraint) return [];
    return [{
      bomRevisionComponentId: component.id,
      constraintType: constraint.constraintType,
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    }];
  });

  if (constraintRows.length > 0) {
    await tx.insert(bomRevisionComponentConstraints).values(constraintRows);
  }

  const alternateValues = insertedComponents.flatMap((component, index) => {
    const input = params.bom[index];
    const defaultComponent = componentById.get(component.componentId);

    return (input.alternates ?? []).map((alternate, alternateIndex) => {
      const alternateItem = alternateById.get(alternate.itemId);

      if (!defaultComponent || !alternateItem) {
        throw new Error("BOM alternate component not found for revision sync.");
      }

      const quantityFactor = derivePurchaseToStockFactor(
        { size: defaultComponent.unitSize, uom: defaultComponent.unitUom },
        { size: alternateItem.unitSize, uom: alternateItem.unitUom }
      );

      if (quantityFactor == null) {
        throw new Error(
          `${alternateItem.name} is not unit-compatible with ${defaultComponent.name}.`
        );
      }

      return {
        bomRevisionComponentId: component.id,
        alternateItemId: alternateItem.id,
        alternateItemName: alternateItem.name,
        alternateItemSku: alternateItem.sku,
        alternateItemType: alternateItem.itemType,
        unitName: alternateItem.unitName,
        quantityFactor: requireLoaderDerivedPositiveQuantity(
          quantityFactor,
          `BOM alternate conversion from "${alternateItem.name}" to "${defaultComponent.name}"`,
        ),
        sortOrder: alternateIndex,
      };
    });
  });

  if (alternateValues.length > 0) {
    await tx.insert(bomRevisionComponentAlternates).values(alternateValues);
  }

  if (currentRevision) {
    const operationRows = await tx
      .select({
        resourceId: bomRevisionOperationCosts.resourceId,
        operationName: bomRevisionOperationCosts.operationName,
        resourceName: bomRevisionOperationCosts.resourceName,
        resourceType: bomRevisionOperationCosts.resourceType,
        costScalingMode: bomRevisionOperationCosts.costScalingMode,
        crewSize: bomRevisionOperationCosts.crewSize,
        plannedMinutes: bomRevisionOperationCosts.plannedMinutes,
        loadedCostPerHour: bomRevisionOperationCosts.loadedCostPerHour,
        plannedCostTotal: bomRevisionOperationCosts.plannedCostTotal,
        sortOrder: bomRevisionOperationCosts.sortOrder,
      })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, currentRevision.id))
      .orderBy(bomRevisionOperationCosts.sortOrder);

    if (operationRows.length > 0) {
      await tx.insert(bomRevisionOperationCosts).values(
        operationRows.map((row) => ({
          bomRevisionId: revision.id,
          ...row,
        }))
      );
    }
  }
}

export function planBomsSync(
  seeds: ItemSeed[],
  seedByKey: Map<string, ItemSeed>,
  matchedItemByKey: Map<string, ExistingItem>,
  bomRowsByItemId: Map<string, ExistingBomRow[]>,
  report: Report
) {
  for (const product of getManagedProductSeedsWithBom(seeds)) {
    validateSeedBomQuantities(product);
    const existingTarget = matchedItemByKey.get(product.key);
    if (!existingTarget || !product.bom) {
      report.syncedBoms.push(product.name);
      continue;
    }

    const canResolveAllComponents = product.bom.every(
      (row) =>
        seedByKey.has(row.componentKey) &&
        (row.alternates ?? []).every((alternate) => seedByKey.has(alternate.itemKey))
    );
    if (!canResolveAllComponents) {
      report.syncedBoms.push(product.name);
      continue;
    }

    const nextRows = product.bom.map((row) => {
      const componentSeed = seedByKey.get(row.componentKey)!;
      const existingComponent = matchedItemByKey.get(componentSeed.key);
      return existingComponent
        ? {
            componentId: existingComponent.id,
            quantity: normalizeNumeric(Number(row.quantity)),
            minimumLotAgeDays: row.minimumLotAgeDays ?? null,
            alternateItemIds: (row.alternates ?? [])
              .map((alternate) => {
                const alternateSeed = seedByKey.get(alternate.itemKey);
                return alternateSeed
                  ? matchedItemByKey.get(alternateSeed.key)?.id
                  : null;
              })
              .filter((id): id is string => id != null),
          }
        : null;
    });

    if (nextRows.some((row) => row == null)) {
      report.syncedBoms.push(product.name);
      continue;
    }

    const nextSignature = buildBomSignature(
      nextRows as Array<{
        componentId: string;
        quantity: string;
        minimumLotAgeDays: number | null;
        alternateItemIds: string[];
      }>
    );
    const existingSignature = buildBomSignature(
      bomRowsByItemId.get(existingTarget.id) ?? []
    );

    if (nextSignature === existingSignature) {
      report.unchangedBoms.push(product.name);
    } else {
      report.syncedBoms.push(product.name);
    }
  }
}

export async function applyBomsSyncInTx(
  tx: Tx,
  seeds: ItemSeed[],
  orgId: string,
  itemIdByKey: Map<string, string>,
  report: Report,
  createdBy: string,
  revisionNote: string
) {
  const managedBomSeeds = getManagedProductSeedsWithBom(seeds);
  const managedBomItemIds = managedBomSeeds
    .map((seed) => itemIdByKey.get(seed.key))
    .filter((id): id is string => id != null);

  const existingBomRows: ExistingBomRow[] =
    managedBomItemIds.length === 0
      ? []
      : await loadCurrentBomRowsInTx(tx, managedBomItemIds);

  const bomRowsByItemId = new Map<string, ExistingBomRow[]>();
  for (const row of existingBomRows) {
    const bucket = bomRowsByItemId.get(row.itemId) ?? [];
    bucket.push(row);
    bomRowsByItemId.set(row.itemId, bucket);
  }

  for (const seed of managedBomSeeds) {
    validateSeedBomQuantities(seed);
    const itemId = itemIdByKey.get(seed.key);
    if (!itemId || !seed.bom) {
      throw new Error(`Missing managed BOM target for ${seed.name}.`);
    }

    const nextRows = seed.bom.map((row) => {
      const componentId = itemIdByKey.get(row.componentKey);
      if (!componentId) {
        throw new Error(
          `Missing BOM component "${row.componentKey}" for ${seed.name}.`
        );
      }

      return {
        componentId,
        quantity: normalizeNumeric(Number(row.quantity)),
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternateItemIds: (row.alternates ?? []).map((alternate) => {
          const alternateItemId = itemIdByKey.get(alternate.itemKey);
          if (!alternateItemId) {
            throw new Error(
              `Missing BOM alternate "${alternate.itemKey}" for ${seed.name}.`
            );
          }
          return alternateItemId;
        }),
        alternates: (row.alternates ?? []).map((alternate) => {
          const alternateItemId = itemIdByKey.get(alternate.itemKey);
          if (!alternateItemId) {
            throw new Error(
              `Missing BOM alternate "${alternate.itemKey}" for ${seed.name}.`
            );
          }
          return { itemId: alternateItemId };
        }),
      };
    });

    const existingRows = bomRowsByItemId.get(itemId) ?? [];
    const nextSignature = buildBomSignature(nextRows);
    const existingSignature = buildBomSignature(existingRows);

    if (nextSignature === existingSignature) {
      report.unchangedBoms.push(seed.name);
      continue;
    }

    await createLoaderBomRevisionInTx(tx, {
      orgId,
      productId: itemId,
      recipeBasis: resolveSeedRecipeBasis(seed),
      outputQuantity: resolveSeedBomOutputQuantity(seed),
      bom: nextRows,
      createdBy,
      note: revisionNote,
    });
    report.syncedBoms.push(seed.name);
  }

  for (const seed of seeds) {
    if (seed.bom && seed.bom.length > 0) continue;
    const itemId = itemIdByKey.get(seed.key);
    if (!itemId) continue;
    const existingRows = await loadCurrentBomRowsInTx(tx, [itemId]);

    if (existingRows.length > 0) {
      report.unresolvedFormulae.push(
        `${seed.name}: existing BOM left untouched because this loader does not manage formula rows for that item yet.`
      );
    }
  }
}
