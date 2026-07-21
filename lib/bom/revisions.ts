import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  user,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import type { BomComponentConstraint } from "./constraints";
export { getCurrentActiveBomIngredientsInTx } from "./active-ingredients";

/** Stored component fields, without constraints or alternates. */
export type BomRevisionComponentRowSnapshot = {
  id: string;
  bomRevisionId: string;
  componentId: string;
  componentName: string;
  componentSku: string | null;
  componentItemType: string;
  unitName: string;
  quantity: string;
  sortOrder: number;
};

/** A component row enriched with its constraint and alternate snapshots. */
export type BomRevisionComponentSnapshot = BomRevisionComponentRowSnapshot & {
  constraints: BomComponentConstraint[];
  alternates: BomRevisionComponentAlternateSnapshot[];
};

export type BomRevisionComponentAlternateSnapshot = {
  id: string;
  alternateItemId: string;
  alternateItemName: string;
  alternateItemSku: string | null;
  alternateItemType: string;
  unitName: string;
  quantityFactor: string;
  sortOrder: number;
};

export type BomRevisionWithMeta = {
  id: string;
  productId: string;
  revisionNumber: number;
  outputQuantity: string;
  recipeBasis: string;
  isCurrent: boolean;
  note: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The current-revision fields returned by the batched product reader. */
export type CurrentBomRevisionSnapshot = {
  id: string;
  productId: string;
  revisionNumber: number;
  outputQuantity: string;
  recipeBasis: string;
  updatedAt: Date;
};

export async function getCurrentBomRevisionInTx(tx: Tx, productId: string) {
  const [revision] = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
      recipeBasis: bomRevisions.recipeBasis,
      isCurrent: bomRevisions.isCurrent,
      note: bomRevisions.note,
      createdBy: bomRevisions.createdBy,
      createdByName: user.name,
      createdAt: bomRevisions.createdAt,
      updatedAt: bomRevisions.updatedAt,
    })
    .from(bomRevisions)
    .leftJoin(user, eq(bomRevisions.createdBy, user.id))
    .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));

  return revision ?? null;
}

/**
 * Batch-load current BOM revisions, keyed by product ID.
 * Products without a current revision are omitted from the returned map.
 */
export async function getCurrentBomRevisionsByProductIdInTx(
  tx: Tx,
  productIds: string[]
) {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) {
    return new Map<string, CurrentBomRevisionSnapshot>();
  }

  const revisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
      recipeBasis: bomRevisions.recipeBasis,
      updatedAt: bomRevisions.updatedAt,
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true)
      )
    );

  return new Map(revisions.map((revision) => [revision.productId, revision]));
}

export async function getBomRevisionHistoryInTx(tx: Tx, productId: string) {
  return tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
      recipeBasis: bomRevisions.recipeBasis,
      isCurrent: bomRevisions.isCurrent,
      note: bomRevisions.note,
      createdBy: bomRevisions.createdBy,
      createdByName: user.name,
      createdAt: bomRevisions.createdAt,
      updatedAt: bomRevisions.updatedAt,
    })
    .from(bomRevisions)
    .leftJoin(user, eq(bomRevisions.createdBy, user.id))
    .where(eq(bomRevisions.productId, productId))
    .orderBy(desc(bomRevisions.revisionNumber));
}

export async function getBomRevisionComponentsInTx(tx: Tx, bomRevisionId: string) {
  return (await getBomRevisionComponentsByRevisionIdInTx(tx, [bomRevisionId])).get(
    bomRevisionId
  ) ?? [];
}

/**
 * Batch-load component rows with constraints and alternates, keyed by revision ID.
 * Revisions without components are omitted from the returned map.
 */
export async function getBomRevisionComponentsByRevisionIdInTx(
  tx: Tx,
  bomRevisionIds: string[]
) {
  const componentRowsByRevisionId =
    await getBomRevisionComponentRowsByRevisionIdInTx(tx, bomRevisionIds);
  if (componentRowsByRevisionId.size === 0) {
    return new Map<string, BomRevisionComponentSnapshot[]>();
  }

  const componentIds = [...componentRowsByRevisionId.values()].flatMap(
    (components) => components.map((component) => component.id)
  );
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
      .where(inArray(bomRevisionComponentConstraints.bomRevisionComponentId, componentIds))
      .orderBy(
        asc(bomRevisionComponentConstraints.sortOrder),
        asc(bomRevisionComponentConstraints.createdAt)
      ),
    tx
      .select({
        id: bomRevisionComponentAlternates.id,
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
      .where(inArray(bomRevisionComponentAlternates.bomRevisionComponentId, componentIds))
      .orderBy(
        asc(bomRevisionComponentAlternates.sortOrder),
        asc(bomRevisionComponentAlternates.createdAt)
      ),
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
    BomRevisionComponentAlternateSnapshot[]
  >();
  for (const alternate of alternates) {
    const bucket = alternatesByComponentId.get(alternate.bomRevisionComponentId) ?? [];
    bucket.push({
      id: alternate.id,
      alternateItemId: alternate.alternateItemId,
      alternateItemName: alternate.alternateItemName,
      alternateItemSku: alternate.alternateItemSku,
      alternateItemType: alternate.alternateItemType,
      unitName: alternate.unitName,
      quantityFactor: alternate.quantityFactor,
      sortOrder: alternate.sortOrder,
    });
    alternatesByComponentId.set(alternate.bomRevisionComponentId, bucket);
  }

  const componentsByRevisionId = new Map<
    string,
    BomRevisionComponentSnapshot[]
  >();
  for (const [revisionId, components] of componentRowsByRevisionId) {
    componentsByRevisionId.set(
      revisionId,
      components.map((component) => ({
        ...component,
        constraints: constraintsByComponentId.get(component.id) ?? [],
        alternates: alternatesByComponentId.get(component.id) ?? [],
      }))
    );
  }

  return componentsByRevisionId;
}

/**
 * Batch-load stored component rows without constraints or alternates, keyed by
 * revision ID. Revisions without components are omitted from the returned map.
 */
export async function getBomRevisionComponentRowsByRevisionIdInTx(
  tx: Tx,
  bomRevisionIds: string[]
) {
  const uniqueRevisionIds = [...new Set(bomRevisionIds)];
  const empty = new Map<string, BomRevisionComponentRowSnapshot[]>();
  if (uniqueRevisionIds.length === 0) {
    return empty;
  }

  const components = await tx
    .select({
      id: bomRevisionComponents.id,
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentId: bomRevisionComponents.componentId,
      componentName: bomRevisionComponents.componentName,
      componentSku: bomRevisionComponents.componentSku,
      componentItemType: bomRevisionComponents.componentItemType,
      unitName: bomRevisionComponents.unitName,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .where(inArray(bomRevisionComponents.bomRevisionId, uniqueRevisionIds))
    .orderBy(asc(bomRevisionComponents.sortOrder), asc(bomRevisionComponents.createdAt));

  if (components.length === 0) {
    return empty;
  }

  const componentsByRevisionId = new Map<
    string,
    BomRevisionComponentRowSnapshot[]
  >();
  for (const component of components) {
    const bucket = componentsByRevisionId.get(component.bomRevisionId) ?? [];
    bucket.push(component);
    componentsByRevisionId.set(component.bomRevisionId, bucket);
  }

  return componentsByRevisionId;
}

export async function getCurrentBomComponentsInTx(tx: Tx, productId: string) {
  const revision = await getCurrentBomRevisionInTx(tx, productId);

  if (!revision) {
    return [];
  }

  return getBomRevisionComponentsInTx(tx, revision.id);
}

export async function getCurrentBomCoverageInTx(tx: Tx, productIds: string[]) {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) {
    return new Map<string, BomRevisionComponentSnapshot[]>();
  }

  const revisionsByProduct = await getCurrentBomRevisionsByProductIdInTx(
    tx,
    uniqueProductIds
  );
  if (revisionsByProduct.size === 0) {
    return new Map<string, BomRevisionComponentSnapshot[]>();
  }
  const componentsByRevision = await getBomRevisionComponentsByRevisionIdInTx(
    tx,
    [...revisionsByProduct.values()].map((revision) => revision.id)
  );

  const result = new Map<string, BomRevisionComponentSnapshot[]>();
  for (const productId of uniqueProductIds) {
    const revision = revisionsByProduct.get(productId);
    result.set(
      productId,
      revision ? (componentsByRevision.get(revision.id) ?? []) : []
    );
  }

  return result;
}
