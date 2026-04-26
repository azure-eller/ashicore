import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  items,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { DomainError } from "@/lib/errors/domain-error";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { createManufacturingOrderInTx } from "@/app/(dashboard)/manufacturing/queries";
import { createPurchaseOrderInTx } from "@/app/(dashboard)/purchasing/queries";
import type {
  CreatePlanningPurchaseOrderDrafts,
  CreatePlanningManufacturingOrderDraft,
  CreatePlanningPurchaseOrderDraft,
} from "@/lib/schemas/planning";
import { buildPlanningSnapshotInTx, getPlanningSnapshot } from "./service";
import type { PlanningRecommendation, PlanningSnapshot } from "./types";

export class PlanningError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "PlanningError" });
  }
}

function planningRecommendationMarker(recommendationId: string) {
  return `[planning-recommendation:${recommendationId}]`;
}

function planningNotes(recommendationId: string, explanation: string) {
  return `${explanation}\n${planningRecommendationMarker(recommendationId)}`;
}

function planningNotesForRecommendations(
  recommendations: PlanningRecommendation[]
) {
  const explanationLines = recommendations.map(
    (recommendation) => `- ${recommendation.explanation}`
  );
  const markers = recommendations.map((recommendation) =>
    planningRecommendationMarker(recommendation.id)
  );

  return [
    `Planning created this draft from ${recommendations.length} recommendations.`,
    ...explanationLines,
    ...markers,
  ].join("\n");
}

function earliestDate(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length > 0 ? dates.sort()[0] : null;
}

function assertCurrentRecommendation(
  snapshot: PlanningSnapshot,
  payload: CreatePlanningPurchaseOrderDraft | CreatePlanningManufacturingOrderDraft,
  recommendationType: "create_purchase_order" | "create_manufacturing_order"
) {
  const recommendation = snapshot.recommendations.find(
    (entry) => entry.id === payload.recommendationId
  );

  if (
    !recommendation ||
    recommendation.recommendationType !== recommendationType ||
    recommendation.itemId !== payload.itemId ||
    recommendation.quantity !== payload.quantity ||
    recommendation.requiredDate !== payload.requiredDate ||
    recommendation.actionPayload == null
  ) {
    throw new PlanningError(
      snapshot.inputHash === payload.inputHash
        ? "Planning recommendation is no longer available."
        : "Planning recommendation is stale. Refresh planning and try again.",
      409
    );
  }

  if (recommendation.actionPayload.actionType !== payload.actionType) {
    throw new PlanningError("Planning recommendation action changed. Refresh planning and try again.", 409);
  }

  if (payload.actionType === "create_purchase_order") {
    if (
      recommendation.actionPayload.actionType !== "create_purchase_order" ||
      recommendation.actionPayload.supplierId !== payload.supplierId ||
      recommendation.actionPayload.unitCost !== payload.unitCost ||
      recommendation.actionPayload.purchaseUnitDefinitionId !==
        payload.purchaseUnitDefinitionId ||
      recommendation.actionPayload.purchaseToStockFactor !==
        payload.purchaseToStockFactor
    ) {
      throw new PlanningError("Planning purchase recommendation changed. Refresh planning and try again.", 409);
    }
  }

  if (payload.actionType === "create_manufacturing_order") {
    if (
      recommendation.actionPayload.actionType !== "create_manufacturing_order" ||
      recommendation.actionPayload.bomRevisionId !== payload.bomRevisionId ||
      recommendation.actionPayload.latestStartDate !== payload.latestStartDate
    ) {
      throw new PlanningError("Planning manufacturing recommendation changed. Refresh planning and try again.", 409);
    }

    const expectedIngredients = [...recommendation.actionPayload.ingredients]
      .map((ingredient) => `${ingredient.itemId}:${ingredient.quantityPerUnit}`)
      .sort();
    const submittedIngredients = [...payload.ingredients]
      .map((ingredient) => `${ingredient.itemId}:${ingredient.quantityPerUnit}`)
      .sort();

    if (expectedIngredients.join("|") !== submittedIngredients.join("|")) {
      throw new PlanningError("Planning manufacturing ingredients changed. Refresh planning and try again.", 409);
    }
  }

  return recommendation;
}

async function assertNoDuplicatePurchaseDraftInTx(
  tx: Tx,
  payload: CreatePlanningPurchaseOrderDraft
) {
  const marker = planningRecommendationMarker(payload.recommendationId);

  const [existing] = await tx
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
    })
    .from(purchaseOrders)
    .innerJoin(
      purchaseOrderLines,
      eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
    )
    .where(
      and(
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        eq(purchaseOrderLines.itemId, payload.itemId),
        sql`${purchaseOrders.notes} LIKE ${`%${marker}%`}`
      )
    )
    .orderBy(asc(purchaseOrders.id))
    .limit(1)
    .for("update");

  if (existing) {
    throw new PlanningError(
      `Planning already created ${existing.orderNumber} for this recommendation.`,
      409
    );
  }
}

async function assertNoDuplicateManufacturingDraftInTx(
  tx: Tx,
  payload: CreatePlanningManufacturingOrderDraft
) {
  const marker = planningRecommendationMarker(payload.recommendationId);

  const [existing] = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.status, ["draft", "released"]),
        isNull(manufacturingOrders.deletedAt),
        eq(manufacturingOrders.productId, payload.itemId),
        sql`${manufacturingOrders.notes} LIKE ${`%${marker}%`}`
      )
    )
    .orderBy(asc(manufacturingOrders.id))
    .limit(1)
    .for("update");

  if (existing) {
    throw new PlanningError(
      `Planning already created ${existing.orderNumber} for this recommendation.`,
      409
    );
  }
}

async function getPurchaseQuantityForStockQuantityInTx(
  tx: Tx,
  itemId: string,
  stockQuantity: string,
  purchaseToStockFactor: string
) {
  const [item] = await tx
    .select({
      id: items.id,
    })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.itemType, "material"), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    throw new PlanningError("Material not found.", 404);
  }

  const factor = Number.parseFloat(purchaseToStockFactor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new PlanningError("Material purchase conversion is invalid.", 400);
  }

  return normalizeNumeric(roundQuantity(Number.parseFloat(stockQuantity) / factor));
}

export async function createPurchaseOrderDraftFromPlanning(
  payload: CreatePlanningPurchaseOrderDraft
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await lockItemsInTx(tx, [payload.itemId]);

    const snapshot = await buildPlanningSnapshotInTx(tx, orgId);
    const recommendation = assertCurrentRecommendation(
      snapshot,
      payload,
      "create_purchase_order"
    );
    await assertNoDuplicatePurchaseDraftInTx(tx, payload);
    const quantityOrdered = await getPurchaseQuantityForStockQuantityInTx(
      tx,
      payload.itemId,
      payload.quantity,
      payload.purchaseToStockFactor
    );

    return createPurchaseOrderInTx(tx, orgId, {
      supplierId: payload.supplierId,
      expectedDate: payload.requiredDate,
      notes: planningNotes(payload.recommendationId, recommendation.explanation),
      lines: [
        {
          itemId: payload.itemId,
          quantityOrdered,
          unitCost: payload.unitCost,
          purchaseUnitDefinitionId: payload.purchaseUnitDefinitionId,
          purchaseToStockFactor: payload.purchaseToStockFactor,
        },
      ],
    });
  });
}

export async function createPurchaseOrderDraftsFromPlanning(
  data: CreatePlanningPurchaseOrderDrafts
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const uniqueRecommendationIds = new Set(
      data.actions.map((payload) => payload.recommendationId)
    );
    if (uniqueRecommendationIds.size !== data.actions.length) {
      throw new PlanningError("Planning recommendations must be unique.", 400);
    }

    const uniqueItemIds = [...new Set(data.actions.map((payload) => payload.itemId))];
    await lockItemsInTx(tx, uniqueItemIds);

    const snapshot = await buildPlanningSnapshotInTx(tx, orgId);
    const groups = new Map<
      string,
      Array<{
        payload: CreatePlanningPurchaseOrderDraft;
        recommendation: PlanningRecommendation;
        quantityOrdered: string;
      }>
    >();

    for (const payload of data.actions) {
      const recommendation = assertCurrentRecommendation(
        snapshot,
        payload,
        "create_purchase_order"
      );
      await assertNoDuplicatePurchaseDraftInTx(tx, payload);
      const quantityOrdered = await getPurchaseQuantityForStockQuantityInTx(
        tx,
        payload.itemId,
        payload.quantity,
        payload.purchaseToStockFactor
      );
      const group = groups.get(payload.supplierId) ?? [];
      group.push({ payload, recommendation, quantityOrdered });
      groups.set(payload.supplierId, group);
    }

    const orders = [];
    for (const [supplierId, group] of groups) {
      const order = await createPurchaseOrderInTx(tx, orgId, {
        supplierId,
        expectedDate: earliestDate(group.map((entry) => entry.payload.requiredDate)),
        notes: planningNotesForRecommendations(
          group.map((entry) => entry.recommendation)
        ),
        lines: group.map((entry) => ({
          itemId: entry.payload.itemId,
          quantityOrdered: entry.quantityOrdered,
          unitCost: entry.payload.unitCost,
          purchaseUnitDefinitionId: entry.payload.purchaseUnitDefinitionId,
          purchaseToStockFactor: entry.payload.purchaseToStockFactor,
        })),
      });
      orders.push(order);
    }

    return { orders };
  });
}

export async function createManufacturingOrderDraftFromPlanning(
  payload: CreatePlanningManufacturingOrderDraft
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await lockItemsInTx(tx, [payload.itemId]);

    const snapshot = await buildPlanningSnapshotInTx(tx, orgId);
    const recommendation = assertCurrentRecommendation(
      snapshot,
      payload,
      "create_manufacturing_order"
    );
    await assertNoDuplicateManufacturingDraftInTx(tx, payload);

    return createManufacturingOrderInTx(tx, orgId, {
      productId: payload.itemId,
      salesOrderId: null,
      salesOrderLineId: null,
      plannedQuantity: payload.quantity,
      plannedDate: payload.requiredDate,
      notes: planningNotes(payload.recommendationId, recommendation.explanation),
      ingredients: payload.ingredients,
      confirmShortage: false,
    });
  });
}

export async function autoPlanDraftsFromPlanning() {
  const snapshot = await getPlanningSnapshot();
  const blockedParentItemIds = new Set(
    snapshot.productionBlockerFacts.map((fact) => fact.parentItemId)
  );
  const created: Array<{
    recommendationId: string;
    actionType: "create_purchase_order" | "create_manufacturing_order";
    id: string;
  }> = [];
  const skipped: Array<{
    recommendationId: string;
    itemId: string;
    reason: string;
  }> = [];

  for (const recommendation of snapshot.recommendations) {
    if (!recommendation.actionPayload) {
      skipped.push({
        recommendationId: recommendation.id,
        itemId: recommendation.itemId,
        reason: "No safe draft action is available.",
      });
      continue;
    }

    if (
      recommendation.warnings.length > 0 ||
      blockedParentItemIds.has(recommendation.itemId)
    ) {
      skipped.push({
        recommendationId: recommendation.id,
        itemId: recommendation.itemId,
        reason: "Review blockers before auto-planning this item.",
      });
      continue;
    }

    try {
      if (recommendation.actionPayload.actionType === "create_purchase_order") {
        const order = await createPurchaseOrderDraftFromPlanning(
          recommendation.actionPayload
        );
        created.push({
          recommendationId: recommendation.id,
          actionType: "create_purchase_order",
          id: order.id,
        });
        continue;
      }

      const order = await createManufacturingOrderDraftFromPlanning(
        recommendation.actionPayload
      );
      created.push({
        recommendationId: recommendation.id,
        actionType: "create_manufacturing_order",
        id: order.id,
      });
    } catch (error) {
      skipped.push({
        recommendationId: recommendation.id,
        itemId: recommendation.itemId,
        reason:
          error instanceof Error
            ? error.message
            : "Planning recommendation could not be drafted.",
      });
    }
  }

  return { created, skipped };
}
