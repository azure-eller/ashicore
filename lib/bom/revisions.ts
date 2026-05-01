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

export type BomRevisionComponentSnapshot = {
  id: string;
  bomRevisionId: string;
  componentId: string;
  componentName: string;
  componentSku: string | null;
  componentItemType: string;
  unitName: string;
  quantity: string;
  sortOrder: number;
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
  isCurrent: boolean;
  note: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getCurrentBomRevisionInTx(tx: Tx, productId: string) {
  const [revision] = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
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

export async function getBomRevisionHistoryInTx(tx: Tx, productId: string) {
  return tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
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
    .where(eq(bomRevisionComponents.bomRevisionId, bomRevisionId))
    .orderBy(asc(bomRevisionComponents.sortOrder), asc(bomRevisionComponents.createdAt));

  if (components.length === 0) {
    return [];
  }

  const componentIds = components.map((component) => component.id);
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

  return components.map((component) => ({
    ...component,
    constraints: constraintsByComponentId.get(component.id) ?? [],
    alternates: alternatesByComponentId.get(component.id) ?? [],
  }));
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

  const currentRevisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true)
      )
    );

  if (currentRevisions.length === 0) {
    return new Map<string, BomRevisionComponentSnapshot[]>();
  }

  const revisionByProduct = new Map(
    currentRevisions.map((revision) => [revision.productId, revision.id])
  );

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
    .where(
      inArray(
        bomRevisionComponents.bomRevisionId,
        currentRevisions.map((revision) => revision.id)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );

  const componentIds = components.map((component) => component.id);
  const [constraints, alternates] =
    components.length === 0
      ? [[], []]
      : await Promise.all([
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

  const componentsByRevision = new Map<string, BomRevisionComponentSnapshot[]>();
  for (const component of components) {
    const bucket = componentsByRevision.get(component.bomRevisionId) ?? [];
    bucket.push({
      ...component,
      constraints: constraintsByComponentId.get(component.id) ?? [],
      alternates: alternatesByComponentId.get(component.id) ?? [],
    });
    componentsByRevision.set(component.bomRevisionId, bucket);
  }

  const result = new Map<string, BomRevisionComponentSnapshot[]>();
  for (const productId of uniqueProductIds) {
    const revisionId = revisionByProduct.get(productId);
    result.set(productId, revisionId ? (componentsByRevision.get(revisionId) ?? []) : []);
  }

  return result;
}
