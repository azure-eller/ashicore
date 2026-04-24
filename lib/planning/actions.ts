import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  items,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { DomainError } from "@/lib/errors/domain-error";
import { createManufacturingOrder } from "@/app/(dashboard)/manufacturing/queries";
import { createPurchaseOrder } from "@/app/(dashboard)/purchasing/queries";
import type {
  CreatePlanningManufacturingOrderDraft,
  CreatePlanningPurchaseOrderDraft,
} from "@/lib/schemas/planning";
import { getPlanningSnapshot } from "./service";

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

async function assertCurrentRecommendation(
  payload: CreatePlanningPurchaseOrderDraft | CreatePlanningManufacturingOrderDraft,
  recommendationType: "create_purchase_order" | "create_manufacturing_order"
) {
  const snapshot = await getPlanningSnapshot();

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
      recommendation.actionPayload.unitCost !== payload.unitCost
    ) {
      throw new PlanningError("Planning purchase recommendation changed. Refresh planning and try again.", 409);
    }
  }

  if (payload.actionType === "create_manufacturing_order") {
    if (
      recommendation.actionPayload.actionType !== "create_manufacturing_order" ||
      recommendation.actionPayload.bomRevisionId !== payload.bomRevisionId
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

async function assertNoDuplicatePurchaseDraft(payload: CreatePlanningPurchaseOrderDraft) {
  const marker = planningRecommendationMarker(payload.recommendationId);

  return withAuthedOrgContext(async (tx) => {
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
      .limit(1);

    if (existing) {
      throw new PlanningError(
        `Planning already created ${existing.orderNumber} for this recommendation.`,
        409
      );
    }
  });
}

async function assertNoDuplicateManufacturingDraft(
  payload: CreatePlanningManufacturingOrderDraft
) {
  const marker = planningRecommendationMarker(payload.recommendationId);

  return withAuthedOrgContext(async (tx) => {
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
      .limit(1);

    if (existing) {
      throw new PlanningError(
        `Planning already created ${existing.orderNumber} for this recommendation.`,
        409
      );
    }
  });
}

async function getPurchaseQuantityForStockQuantity(itemId: string, stockQuantity: string) {
  return withAuthedOrgContext(async (tx) => {
    const [item] = await tx
      .select({
        id: items.id,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
      })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.itemType, "material"), isNull(items.deletedAt)))
      .limit(1);

    if (!item) {
      throw new PlanningError("Material not found.", 404);
    }

    const factor = Number.parseFloat(item.purchaseToStockFactor ?? "1");
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new PlanningError("Material purchase conversion is invalid.", 400);
    }

    return normalizeNumeric(roundQuantity(Number.parseFloat(stockQuantity) / factor));
  });
}

export async function createPurchaseOrderDraftFromPlanning(
  payload: CreatePlanningPurchaseOrderDraft
) {
  const recommendation = await assertCurrentRecommendation(
    payload,
    "create_purchase_order"
  );
  await assertNoDuplicatePurchaseDraft(payload);
  const quantityOrdered = await getPurchaseQuantityForStockQuantity(
    payload.itemId,
    payload.quantity
  );

  return createPurchaseOrder({
    supplierId: payload.supplierId,
    expectedDate: payload.requiredDate,
    notes: planningNotes(payload.recommendationId, recommendation.explanation),
    lines: [
      {
        itemId: payload.itemId,
        quantityOrdered,
        unitCost: payload.unitCost,
      },
    ],
  });
}

export async function createManufacturingOrderDraftFromPlanning(
  payload: CreatePlanningManufacturingOrderDraft
) {
  const recommendation = await assertCurrentRecommendation(
    payload,
    "create_manufacturing_order"
  );
  await assertNoDuplicateManufacturingDraft(payload);

  return createManufacturingOrder({
    productId: payload.itemId,
    salesOrderId: null,
    salesOrderLineId: null,
    plannedQuantity: payload.quantity,
    plannedDate: payload.requiredDate,
    notes: planningNotes(payload.recommendationId, recommendation.explanation),
    ingredients: payload.ingredients,
    confirmShortage: false,
  });
}
