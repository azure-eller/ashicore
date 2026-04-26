import { and, desc, eq, inArray } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import { normalizeNumeric } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  BomSeedRow,
  ExistingBomRow,
  ExistingItem,
  ItemSeed,
  Report,
} from "./types";

export function getManagedProductSeedsWithBom(seeds: ItemSeed[]): ItemSeed[] {
  return seeds.filter((seed) => seed.bom && seed.bom.length > 0);
}

export function buildBomSignature(
  rows: Array<{ componentId: string; quantity: string }>
) {
  return rows
    .map((row) => `${row.componentId}:${normalizeNumeric(Number(row.quantity))}`)
    .sort()
    .join("|");
}

export async function loadCurrentBomRowsInTx(tx: Tx, productIds: string[]) {
  if (productIds.length === 0) {
    return [];
  }

  return tx
    .select({
      itemId: bomRevisions.productId,
      componentId: bomRevisionComponents.componentId,
      quantity: bomRevisionComponents.quantity,
    })
    .from(bomRevisionComponents)
    .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
    .where(
      and(inArray(bomRevisions.productId, productIds), eq(bomRevisions.isCurrent, true))
    );
}

export async function createLoaderBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    productId: string;
    bom: BomSeedRow[];
  }
) {
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
      isCurrent: true,
      note: "Managed by Paonia loader",
      createdBy: "paonia-loader",
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
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(items.id, componentIds));
  const componentById = new Map(componentRows.map((row) => [row.id, row]));

  await tx.insert(bomRevisionComponents).values(
    params.bom.map((row, index) => {
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
    })
  );
}

export function planBomsSync(
  seeds: ItemSeed[],
  seedByKey: Map<string, ItemSeed>,
  matchedItemByKey: Map<string, ExistingItem>,
  bomRowsByItemId: Map<string, ExistingBomRow[]>,
  report: Report
) {
  for (const product of getManagedProductSeedsWithBom(seeds)) {
    const existingTarget = matchedItemByKey.get(product.key);
    if (!existingTarget || !product.bom) {
      report.syncedBoms.push(product.name);
      continue;
    }

    const canResolveAllComponents = product.bom.every((row) =>
      seedByKey.has(row.componentKey)
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
          }
        : null;
    });

    if (nextRows.some((row) => row == null)) {
      report.syncedBoms.push(product.name);
      continue;
    }

    const nextSignature = buildBomSignature(
      nextRows as Array<{ componentId: string; quantity: string }>
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
  report: Report
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
      bom: nextRows,
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
