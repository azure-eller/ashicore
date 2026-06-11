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
import { normalizeRecipeBasis } from "@/lib/manufacturing/consumption";
import {
  toPlanningComponentRequirement,
  type BomComponentConstraint,
  type PlanningComponentRequirement,
} from "./constraints";

export type BomComponentRecord = {
  id: string;
  componentId: string;
  componentName: string;
  componentSku: string | null;
  componentItemType: string;
  unitName: string;
  quantity: string;
  sortOrder: number;
  requirements: PlanningComponentRequirement[];
};

export type CurrentBomRecord = {
  revisionId: string;
  revisionNumber: number;
  recipeBasis: "unit" | "batch";
  outputQuantity: string;
  components: BomComponentRecord[];
};

// Canonical batch reader for current BOM revisions with live item data.
// Deleted component items are excluded, matching the single-product reader
// in active-ingredients.ts that manufacturing-order creation uses.
export async function getCurrentBomsByProductIdInTx(
  tx: Tx,
  productIds: string[]
): Promise<Map<string, CurrentBomRecord>> {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) {
    return new Map();
  }

  const revisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      recipeBasis: bomRevisions.recipeBasis,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true)
      )
    )
    .orderBy(asc(bomRevisions.productId), asc(bomRevisions.revisionNumber));

  if (revisions.length === 0) {
    return new Map();
  }

  const components = await tx
    .select({
      id: bomRevisionComponents.id,
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentId: bomRevisionComponents.componentId,
      componentName: items.name,
      componentSku: items.sku,
      componentItemType: items.itemType,
      unitName: unitDefinitions.name,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .innerJoin(items, eq(bomRevisionComponents.componentId, items.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(
          bomRevisionComponents.bomRevisionId,
          revisions.map((revision) => revision.id)
        ),
        isNull(items.deletedAt)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.bomRevisionId),
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );

  const constraints =
    components.length === 0
      ? []
      : await tx
          .select({
            bomRevisionComponentId:
              bomRevisionComponentConstraints.bomRevisionComponentId,
            constraintType: bomRevisionComponentConstraints.constraintType,
            config: bomRevisionComponentConstraints.config,
            sortOrder: bomRevisionComponentConstraints.sortOrder,
          })
          .from(bomRevisionComponentConstraints)
          .where(
            inArray(
              bomRevisionComponentConstraints.bomRevisionComponentId,
              components.map((component) => component.id)
            )
          );
  const requirementsByComponentId = new Map<string, PlanningComponentRequirement[]>();
  for (const constraint of constraints) {
    const componentConstraint: BomComponentConstraint = {
      constraintType: constraint.constraintType as BomComponentConstraint["constraintType"],
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    };
    const planningRequirement = toPlanningComponentRequirement(componentConstraint);
    if (!planningRequirement) continue;
    const bucket = requirementsByComponentId.get(constraint.bomRevisionComponentId) ?? [];
    bucket.push(planningRequirement);
    requirementsByComponentId.set(constraint.bomRevisionComponentId, bucket);
  }

  const componentsByRevision = new Map<string, BomComponentRecord[]>();
  for (const component of components) {
    const bucket = componentsByRevision.get(component.bomRevisionId) ?? [];
    bucket.push({
      id: component.id,
      componentId: component.componentId,
      componentName: component.componentName,
      componentSku: component.componentSku,
      componentItemType: component.componentItemType,
      unitName: component.unitName,
      quantity: component.quantity,
      sortOrder: component.sortOrder,
      requirements: requirementsByComponentId.get(component.id) ?? [],
    });
    componentsByRevision.set(component.bomRevisionId, bucket);
  }

  return new Map(
    revisions.map((revision) => [
      revision.productId,
      {
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        recipeBasis: normalizeRecipeBasis(revision.recipeBasis),
        outputQuantity: revision.outputQuantity,
        components: componentsByRevision.get(revision.id) ?? [],
      },
    ])
  );
}
