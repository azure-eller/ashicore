import "server-only";

import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";

import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { bomRevisions, items, manufacturingOrderBatches, manufacturingOrderOperationCosts, manufacturingOrderOutputs, manufacturingOrderIngredientConstraints, manufacturingOrderIngredients, manufacturingOrders, salesOrderLines, salesOrders, unitDefinitions } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeQuantityNumber, roundQuantity } from "@/lib/format";
import { getBomRevisionComponentsInTx, getCurrentActiveBomIngredientsInTx, type BomRevisionComponentSnapshot } from "@/lib/bom/revisions";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { generateShortDocumentNumberInTx } from "@/lib/document-numbers";
import { addExpectedFromManufacturingInTx, addIngredientDemandForManufacturingInTx, editExpectedFromManufacturingInTx, lockItemsInTx, releaseIngredientDemandForManufacturingInTx, runIdempotentInventoryOperationInTx } from "@/lib/inventory/kernel";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import type { BomComponentConstraint } from "@/lib/bom/constraints";
import { calculateIngredientPlannedQuantity, normalizeRecipeBasis, type RecipeBasis } from "@/lib/manufacturing/consumption";
import { getBomRevisionOperationCostsInTx } from "@/lib/bom/operation-costs";
import { calculatePlannedOperationCost } from "@/lib/manufacturing/operation-costs";
import { notifyManufacturingOrderCreated } from "@/lib/notifications/manufacturing";
import type { CreateManufacturingOrdersFromSalesOrder, InsertManufacturingOrder, PatchManufacturingOrder, PatchManufacturingOrderIngredient, UpdateManufacturingOrder } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingOrdersFromSalesOrderResult } from "../types";
import { ManufacturingError } from "./errors";
import { ensureBatchExecutionRowsInTx } from "./execution-state";
import { type LockedManufacturingOrder, canonicalItemName, getActiveSiblingVariantsByItemIdInTx, getLockedManufacturingOrderInTx, getManufacturingItemDisplayMetadataInTx, isOpenManufacturingOrder, rerankOpenManufacturingOrdersInTx, validateActiveIngredientItemsInTx } from "./shared";

type ProductSnapshot = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
};

type SalesLineSnapshot = {
  salesOrderId: string;
  salesOrderLineId: string;
  salesOrderNumber: string;
  customerName: string;
};

function hasManufacturingQuantityChanged(current: string, next: string) {
  return (
    normalizeQuantityNumber(Number(current)) !==
    normalizeQuantityNumber(Number(next))
  );
}

async function assertManufacturingPlanningUpdateAllowedInTx(
  tx: Tx,
  order: LockedManufacturingOrder,
  ingredientIds: string[]
) {
  if (order.startedAt != null) {
    throw new ManufacturingError(
      "Manufacturing work has started, so planning fields are locked to preserve execution history.",
      400
    );
  }

  if (Number(order.actualQuantity ?? 0) > 0) {
    throw new ManufacturingError(
      "Output has already been recorded, so planning fields are locked to preserve inventory history.",
      400
    );
  }

  const outputRows = await tx
    .select({ id: manufacturingOrderOutputs.id })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, order.id))
    .limit(1);

  if (outputRows.length > 0) {
    throw new ManufacturingError(
      "Output has already been recorded, so planning fields are locked to preserve inventory history.",
      400
    );
  }

  const pickedIngredientRows =
    ingredientIds.length > 0
      ? await tx
          .select({ id: manufacturingOrderIngredients.id })
          .from(manufacturingOrderIngredients)
          .where(
            and(
              inArray(manufacturingOrderIngredients.id, ingredientIds),
              or(
                ne(manufacturingOrderIngredients.pickStatus, "not_picked"),
                sql`${manufacturingOrderIngredients.pickedQuantity} > 0`,
                isNotNull(manufacturingOrderIngredients.actualQuantity)
              )
            )
          )
          .limit(1)
      : [];

  if (pickedIngredientRows.length > 0) {
    throw new ManufacturingError(
      "Ingredients have already been picked, so planning fields are locked to preserve inventory history.",
      400
    );
  }

  const activeBatchRows =
    order.manufacturingMode === "batch"
      ? await tx
          .select({ id: manufacturingOrderBatches.id })
          .from(manufacturingOrderBatches)
          .where(
            and(
              eq(manufacturingOrderBatches.manufacturingOrderId, order.id),
              or(
                ne(manufacturingOrderBatches.status, "pending"),
                isNotNull(manufacturingOrderBatches.startedAt),
                isNotNull(manufacturingOrderBatches.pickedAt),
                isNotNull(manufacturingOrderBatches.completedAt)
              )
            )
          )
          .limit(1)
      : [];

  if (activeBatchRows.length > 0) {
    throw new ManufacturingError(
      "Batch work has started, so planning fields are locked to preserve execution history.",
      400
    );
  }
}

type ValidatedIngredient = {
  bomRevisionComponentId: string | null;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  recipeBasis: RecipeBasis;
  recipeOutputQuantity: string;
  plannedQuantity: string;
  sortOrder: number;
  constraints: BomComponentConstraint[];
};

type ManufacturingScalingPlan = {
  manufacturingMode: "discrete" | "batch";
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
};

function deriveScalingPlan(
  outputQuantity: number,
  ingredients: ValidatedIngredient[],
  batchCountInput?: string | null
): ManufacturingScalingPlan {
  const batchIngredient = ingredients.find((ingredient) => ingredient.recipeBasis === "batch");
  const expectedBatchYield = batchIngredient?.recipeOutputQuantity ?? null;
  const batchYield = expectedBatchYield == null ? NaN : Number(expectedBatchYield);

  if (batchIngredient && batchCountInput != null) {
    const batchCount = parsePositiveWholeBatchCount(batchCountInput);
    if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
      throw new ManufacturingError("Batch products need an expected batch output.", 400);
    }
    return {
      manufacturingMode: "batch",
      numberOfBatches: batchCount,
      expectedBatchYield: normalizeNumeric(outputQuantity / batchCount),
    };
  }

  if (
    batchIngredient &&
    Number.isFinite(batchYield) &&
    batchYield > 0 &&
    Number.isFinite(outputQuantity) &&
    outputQuantity > 0
  ) {
    const numberOfBatches = deriveBatchCount({
      recipeBasis: "batch",
      recipeOutputQuantity: batchYield,
      outputQuantity,
    });

    return {
      manufacturingMode: "batch",
      numberOfBatches,
      expectedBatchYield: normalizeNumeric(batchYield),
    };
  }

  return {
    manufacturingMode: "discrete",
    numberOfBatches: null,
    expectedBatchYield: null,
  };
}

function parsePositiveWholeBatchCount(value: string | number) {
  const quantity = Number(value);
  const batchCount = Math.round(quantity);
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    Math.abs(quantity - batchCount) > 0.0001
  ) {
    throw new ManufacturingError("Enter a whole number of batches.", 400);
  }
  return batchCount;
}

function deriveBatchCount(params: {
  recipeBasis: RecipeBasis;
  recipeOutputQuantity: string | number;
  outputQuantity: string | number;
}) {
  if (params.recipeBasis !== "batch") return null;
  const outputQuantity = Number(params.outputQuantity);
  const recipeOutputQuantity = Number(params.recipeOutputQuantity);
  if (
    !Number.isFinite(outputQuantity) ||
    !Number.isFinite(recipeOutputQuantity) ||
    outputQuantity <= 0 ||
    recipeOutputQuantity <= 0
  ) {
    throw new ManufacturingError("Batch products need an expected batch output.", 400);
  }
  const rawBatchCount = outputQuantity / recipeOutputQuantity;
  const batchCount = Math.round(rawBatchCount);
  if (batchCount <= 0 || Math.abs(rawBatchCount - batchCount) > 0.0001) {
    throw new ManufacturingError("Enter a whole number of batches.", 400);
  }
  return batchCount;
}

function calculatePlannedIngredientQuantity(params: {
  recipeBasis: RecipeBasis;
  quantityPerUnit: string;
  outputQuantity: number;
  recipeOutputQuantity: string | number;
  batchCount?: number | null;
}) {
  return calculateIngredientPlannedQuantity({
    recipeBasis: params.recipeBasis,
    quantityPerRecipeBasis: params.quantityPerUnit,
    outputQuantity: params.outputQuantity,
    numberOfBatches:
      params.recipeBasis === "batch" && params.batchCount != null
        ? params.batchCount
        : deriveBatchCount({
            recipeBasis: params.recipeBasis,
            recipeOutputQuantity: params.recipeOutputQuantity,
            outputQuantity: params.outputQuantity,
      }),
  });
}

function applyScalingPlanToIngredients(
  ingredients: ValidatedIngredient[],
  outputQuantity: number,
  scalingPlan: ManufacturingScalingPlan
): ValidatedIngredient[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    plannedQuantity: calculatePlannedIngredientQuantity({
      recipeBasis: ingredient.recipeBasis,
      quantityPerUnit: ingredient.quantityPerUnit,
      outputQuantity,
      recipeOutputQuantity: ingredient.recipeOutputQuantity,
      batchCount: scalingPlan.numberOfBatches,
    }),
  }));
}

async function generateMONumber(tx: Tx, orgId: string) {
  return generateShortDocumentNumberInTx(tx, "manufacturing_order", orgId);
}

export async function getValidatedProductInTx(
  tx: Tx,
  productId: string
): Promise<ProductSnapshot> {
  const [product] = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      unitName: unitDefinitions.name,
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        eq(items.id, productId),
        eq(items.itemType, "product"),
        isNull(items.deletedAt)
      )
    );

  if (!product) {
    throw new ManufacturingError("Product not found", 404);
  }

  const displayByItemId = await getManufacturingItemDisplayMetadataInTx(tx, [product.id]);

  return {
    ...product,
    name: canonicalItemName(displayByItemId, product.id, product.name),
  };
}

async function getCurrentBomIngredientsInTx(tx: Tx, productId: string) {
  return getCurrentActiveBomIngredientsInTx(tx, productId);
}

/**
 * Swaps the material on a single released-order ingredient, and nothing else.
 *
 * Kept separate from the planning update on purpose. The planning lock exists to protect
 * execution history, and relaxing it wholesale would also reopen quantity, product and batch
 * edits mid-run. This path only moves an ingredient row to a sibling variant, and only while
 * that row is untouched: once anything is picked the material is fixed, because unwinding it
 * would mean reversing consumed stock by lot, location and cost layer. Callers change a picked
 * order by deleting and recreating it.
 */
export async function swapManufacturingIngredientMaterial(
  orderId: string,
  ingredientId: string,
  data: { itemId: string }
): Promise<{ id: string; itemId: string; quantityPerUnit: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);
    if (!order) {
      throw new ManufacturingError("Manufacturing order not found", 404);
    }
    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError(
        "Completed manufacturing orders cannot change materials.",
        400
      );
    }

    const orderIngredients = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        manufacturingOrderBatchId:
          manufacturingOrderIngredients.manufacturingOrderBatchId,
        bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
        pickStatus: manufacturingOrderIngredients.pickStatus,
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
        actualQuantity: manufacturingOrderIngredients.actualQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));

    const ingredient = orderIngredients.find((row) => row.id === ingredientId);

    if (!ingredient) {
      throw new ManufacturingError("Ingredient not found", 404);
    }

    if (!ingredient.bomRevisionComponentId) {
      throw new ManufacturingError(
        "This order predates recipe-line tracking, so its materials cannot be swapped. Delete and recreate the order to use a different one.",
        409
      );
    }

    // A batch order fans one recipe line out into a row per batch, and the screen shows those
    // rows collapsed into one. Swapping only the row behind the aggregate would leave the other
    // batches on the old material while the UI reported the whole line as swapped, so the swap
    // moves every row that came from this recipe line.
    const lineIngredients = orderIngredients.filter(
      (row) => row.bomRevisionComponentId === ingredient.bomRevisionComponentId
    );

    const pickedLineIngredient = lineIngredients.find(
      (row) =>
        row.pickStatus !== "not_picked" ||
        Number(row.pickedQuantity ?? 0) > 0 ||
        row.actualQuantity != null
    );
    if (pickedLineIngredient) {
      throw new ManufacturingError(
        "This ingredient has already been picked, so its material is locked. Delete and recreate the order to use a different one.",
        400
      );
    }

    if (!order.bomRevisionId) {
      throw new ManufacturingError("This order has no recipe to check against.", 409);
    }

    const components = await getBomRevisionComponentsInTx(tx, order.bomRevisionId);
    const component = components.find(
      (row) => row.id === ingredient.bomRevisionComponentId
    );
    if (!component) {
      throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
    }

    // Basis comes from the revision the order was snapshotted against, not the current BOM.
    const [revision] = await tx
      .select({
        recipeBasis: bomRevisions.recipeBasis,
        outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
      })
      .from(bomRevisions)
      .where(eq(bomRevisions.id, order.bomRevisionId));
    if (!revision) {
      throw new ManufacturingError("This order has no recipe to check against.", 409);
    }

    const siblingVariantsByItemId = await getActiveSiblingVariantsByItemIdInTx(tx, [
      component.componentId,
    ]);
    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(tx, [
      component.componentId,
    ]);
    const selected = getAllowedSiblingBomMaterialOption(
      {
        componentId: component.componentId,
        componentName: canonicalItemName(
          itemDisplayById,
          component.componentId,
          component.componentName
        ),
        componentSku: component.componentSku,
        componentItemType: component.componentItemType,
        unitName: component.unitName,
      },
      siblingVariantsByItemId.get(component.componentId) ?? [],
      component.alternates.map((alternate) => alternate.alternateItemId),
      data.itemId
    );

    if (!selected) {
      throw new ManufacturingError(
        "Select the recipe default or a configured alternate for this ingredient.",
        400
      );
    }

    const quantityPerUnit = resolveIngredientQuantityPerUnit(
      component.componentId,
      component.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
        quantity: alternate.quantity,
      })),
      selected.itemId,
      component.quantity,
      component.quantity
    );
    const recipeBasis = normalizeRecipeBasis(revision.recipeBasis);
    const orderPlannedQuantity = calculatePlannedIngredientQuantity({
      recipeBasis,
      quantityPerUnit,
      outputQuantity: Number(order.plannedQuantity),
      recipeOutputQuantity: revision.outputQuantity,
      batchCount: order.numberOfBatches,
    });
    // A batch row holds one batch's worth, the way the fan-out wrote it; only the pre-execution
    // template row holds the whole order's. Writing the order total into a batch row would book
    // every batch's material against a single batch.
    const plannedQuantityFor = (batchId: string | null) =>
      batchId == null ? orderPlannedQuantity : quantityPerUnit;

    await releaseIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      actorUserId: userId,
      reason: "edited",
      ingredientIds: lineIngredients.map((row) => row.id),
    });

    for (const lineIngredient of lineIngredients) {
      await tx
        .update(manufacturingOrderIngredients)
        .set({
          itemId: selected.itemId,
          itemName: selected.itemName,
          itemSku: selected.itemSku,
          itemType: selected.itemType,
          unitName: selected.unitName,
          quantityPerUnit,
          plannedQuantity: plannedQuantityFor(
            lineIngredient.manufacturingOrderBatchId
          ),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, lineIngredient.id));
    }

    await addIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      actorUserId: userId,
      ingredients: lineIngredients.map((lineIngredient) => ({
        ingredientId: lineIngredient.id,
        itemId: selected.itemId,
        quantity: parseFloat(
          plannedQuantityFor(lineIngredient.manufacturingOrderBatchId)
        ),
      })),
    });

    return {
      id: ingredient.id,
      itemId: selected.itemId,
      quantityPerUnit,
    };
  });
}

/**
 * The recipe owns an ingredient's quantity.
 *
 * When an operator selects a variant the BOM lists with its own number, that number wins over
 * whatever the client submitted. A larger package is a different amount, not the same count of
 * a different thing — carrying the base line's number across a swap is what books far more
 * material than physically goes in and drifts stock every batch. Legacy alternates without a
 * stored quantity keep the client's number as before.
 */
function resolveIngredientQuantityPerUnit(
  componentItemId: string,
  alternates: Array<{ itemId: string; quantity: string | null }> | undefined,
  selectedItemId: string,
  componentQuantityPerUnit: string,
  submittedQuantityPerUnit: string
) {
  if (selectedItemId === componentItemId) {
    return normalizeNumeric(Number(componentQuantityPerUnit));
  }
  if (selectedItemId !== componentItemId) {
    const alternate = alternates?.find((entry) => entry.itemId === selectedItemId);
    if (alternate?.quantity != null) {
      return normalizeNumeric(Number(alternate.quantity));
    }
  }
  return normalizeNumeric(Number(submittedQuantityPerUnit));
}

async function assertNoOtherActiveMoClaimsLineInTx(
  tx: Tx,
  salesOrderLineId: string,
  currentManufacturingOrderId?: string | null
) {
  const conditions = [
    eq(manufacturingOrders.salesOrderLineId, salesOrderLineId),
    isNull(manufacturingOrders.deletedAt),
  ];
  if (currentManufacturingOrderId) {
    conditions.push(ne(manufacturingOrders.id, currentManufacturingOrderId));
  }
  const [claimingMo] = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(manufacturingOrders)
    .where(and(...conditions))
    .limit(1);

  if (claimingMo) {
    throw new ManufacturingError(
      `Sales order line is already linked to manufacturing order ${claimingMo.orderNumber}. Cancel that order before linking another.`,
      409,
      {
        errors: {
          salesOrderLineId: [
            "This sales line already has an active manufacturing order",
          ],
        },
      }
    );
  }
}

async function validateSalesLineLinkInTx(
  tx: Tx,
  values: {
    salesOrderId: string | null | undefined;
    salesOrderLineId: string | null | undefined;
    productId: string;
  },
  existingSnapshot?: SalesLineSnapshot | null,
  currentManufacturingOrderId?: string | null
): Promise<SalesLineSnapshot | null> {
  if (values.salesOrderId == null && values.salesOrderLineId == null) {
    return null;
  }

  if (!values.salesOrderId || !values.salesOrderLineId) {
    throw new ManufacturingError("Sales order link is incomplete", 400, {
      errors: {
        salesOrderLineId: ["Select a valid sales order line"],
      },
    });
  }

  const isUnchangedSnapshot =
    existingSnapshot != null &&
    values.salesOrderId === existingSnapshot.salesOrderId &&
    values.salesOrderLineId === existingSnapshot.salesOrderLineId;

  const [line] = await tx
    .select({
      salesOrderId: salesOrders.id,
      salesOrderLineId: salesOrderLines.id,
      salesOrderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      itemId: salesOrderLines.itemId,
      orderStatus: salesOrders.status,
      deletedAt: salesOrders.deletedAt,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        eq(salesOrders.id, values.salesOrderId),
        eq(salesOrderLines.id, values.salesOrderLineId)
      )
    )
    .for("update");

  if (
    line &&
    line.deletedAt == null &&
    line.orderStatus === "open" &&
    line.itemId === values.productId
  ) {
    await assertNoOtherActiveMoClaimsLineInTx(
      tx,
      line.salesOrderLineId,
      currentManufacturingOrderId
    );
    return {
      salesOrderId: line.salesOrderId,
      salesOrderLineId: line.salesOrderLineId,
      salesOrderNumber: line.salesOrderNumber,
      customerName: line.customerName,
    };
  }

  if (isUnchangedSnapshot && values.salesOrderId) {
    const [replacementLine] = await tx
      .select({
        salesOrderId: salesOrders.id,
        salesOrderLineId: salesOrderLines.id,
        salesOrderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrders.id, values.salesOrderId),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open"),
          eq(salesOrderLines.itemId, values.productId)
        )
      )
      .for("update");

    if (replacementLine) {
      await assertNoOtherActiveMoClaimsLineInTx(
        tx,
        replacementLine.salesOrderLineId,
        currentManufacturingOrderId
      );
      return replacementLine;
    }

    return existingSnapshot;
  }

  throw new ManufacturingError("Sales order line not found", 404, {
    errors: {
      salesOrderLineId: ["Select an active sales order line for this product"],
    },
  });
}

function assertLinkedMtoIdentityUnchanged(
  existing: {
    productId: string;
    salesOrderId: string | null;
    salesOrderLineId: string | null;
    plannedQuantity: string;
    requestedQuantity: string;
  },
  values: {
    productId?: string | null;
    salesOrderId?: string | null;
    salesOrderLineId?: string | null;
    plannedQuantity?: string | null;
  }
) {
  if (!existing.salesOrderId || !existing.salesOrderLineId) {
    if (values.salesOrderId != null || values.salesOrderLineId != null) {
      throw new ManufacturingError(
        "Make-to-stock manufacturing orders cannot be linked to sales orders after creation.",
        400,
        {
          errors: {
            salesOrderLineId: [
              "Create make-to-order manufacturing from the sales order instead.",
            ],
          },
        }
      );
    }
    return;
  }

  const nextProductId = values.productId ?? existing.productId;
  const nextSalesOrderId = values.salesOrderId ?? existing.salesOrderId;
  const nextSalesOrderLineId =
    values.salesOrderLineId ?? existing.salesOrderLineId;
  const nextPlannedQuantity =
    values.plannedQuantity == null
      ? Number(existing.plannedQuantity)
      : Number(values.plannedQuantity);

  if (
    nextProductId !== existing.productId ||
    nextSalesOrderId !== existing.salesOrderId ||
    nextSalesOrderLineId !== existing.salesOrderLineId ||
    hasManufacturingQuantityChanged(
      existing.plannedQuantity,
      String(nextPlannedQuantity)
    ) ||
    hasManufacturingQuantityChanged(
      existing.requestedQuantity,
      String(nextPlannedQuantity)
    )
  ) {
    throw new ManufacturingError(
      "Linked make-to-order manufacturing orders must keep the sales line product, quantity, and link.",
      400,
      {
        errors: {
          salesOrderLineId: [
            "Linked make-to-order manufacturing orders cannot change product, quantity, or sales order link.",
          ],
          plannedQuantity: [
            "Linked make-to-order manufacturing orders must match the sales line quantity.",
          ],
        },
      }
    );
  }
}

async function prepareCreateIngredientsInTx(
  tx: Tx,
  productId: string,
  outputQuantity: number,
  submittedIngredients: InsertManufacturingOrder["ingredients"],
  batchCount?: number | null
): Promise<{ bomRevisionId: string; ingredients: ValidatedIngredient[] }> {
  const bomRows = await getCurrentBomIngredientsInTx(tx, productId);

  if (bomRows.length === 0) {
    throw new ManufacturingError(
      "Products need a BOM before creating a manufacturing order",
      400
    );
  }

  if (bomRows.length !== submittedIngredients.length) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }

  const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(
    tx,
    bomRows.map((row) => row.itemId)
  );
  const siblingVariantsByItemId = await getActiveSiblingVariantsByItemIdInTx(
    tx,
    bomRows.map((row) => row.itemId)
  );
  const bomByComponentId = new Map(bomRows.map((row) => [row.itemId, row]));
  const submittedComponentIds = submittedIngredients.map(
    (row, index) => row.defaultItemId ?? bomRows[index]?.itemId
  );
  if (submittedComponentIds.some((componentId) => !componentId)) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }
  if (new Set(submittedComponentIds).size !== bomRows.length) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }
  const sortedSubmittedIngredients = submittedIngredients
    .map((submitted, index) => {
      const componentId = submitted.defaultItemId ?? bomRows[index]?.itemId;
      const row = componentId ? bomByComponentId.get(componentId) : undefined;
      if (!row) {
        throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
      }
      return { submitted, row };
    })
    .sort((left, right) => left.row.sortOrder - right.row.sortOrder);

  return {
    bomRevisionId: bomRows[0].bomRevisionId,
    ingredients: sortedSubmittedIngredients.map(({ submitted, row }, index) => {
      const submittedItemId = submitted?.itemId;
      const submittedQuantityPerUnit = submitted?.quantityPerUnit;
      if (!submittedItemId || !submittedQuantityPerUnit) {
        throw new ManufacturingError("Ingredient is required", 400);
      }
      const selected = getAllowedSiblingBomMaterialOption(
        {
          componentId: row.itemId,
          componentName: canonicalItemName(itemDisplayById, row.itemId, row.itemName),
          componentSku: row.itemSku,
          componentItemType: row.itemType,
          unitName: row.unitName,
        },
        siblingVariantsByItemId.get(row.itemId) ?? [],
        row.alternates.map((alternate) => alternate.itemId),
        submittedItemId
      );

      if (!selected) {
        throw new ManufacturingError(
          "Select the recipe default or a configured alternate for this ingredient.",
          400
        );
      }

      const quantityPerUnit = resolveIngredientQuantityPerUnit(
        row.itemId,
        row.alternates,
        selected.itemId,
        row.quantity,
        submittedQuantityPerUnit
      );
      const recipeBasis = normalizeRecipeBasis(row.recipeBasis);

      return {
        bomRevisionComponentId: row.bomRevisionComponentId,
        itemId: selected.itemId,
        itemName: selected.itemName,
        itemSku: selected.itemSku,
        itemType: selected.itemType,
        unitName: selected.unitName,
        quantityPerUnit,
        recipeBasis,
        recipeOutputQuantity: row.bomOutputQuantity,
        plannedQuantity: calculatePlannedIngredientQuantity({
          recipeBasis,
          quantityPerUnit,
          outputQuantity,
          recipeOutputQuantity: row.bomOutputQuantity,
          batchCount,
        }),
        sortOrder: index,
        constraints: row.constraints,
      };
    }),
  };
}

function getAllowedSiblingBomMaterialOption(
  row: Pick<
    BomRevisionComponentSnapshot,
    "componentId" | "componentName" | "componentSku" | "componentItemType" | "unitName"
  >,
  siblings: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
  }>,
  configuredAlternateItemIds: readonly string[],
  itemId: string
) {
  if (itemId === row.componentId) {
    return {
      itemId: row.componentId,
      itemName: row.componentName,
      itemSku: row.componentSku,
      itemType: row.componentItemType,
      unitName: row.unitName,
    };
  }

  if (!configuredAlternateItemIds.includes(itemId)) return null;

  const sibling = siblings.find((candidate) => candidate.itemId === itemId);
  if (sibling) {
    return {
      itemId: sibling.itemId,
      itemName: sibling.itemName,
      itemSku: sibling.itemSku,
      itemType: sibling.itemType,
      unitName: sibling.unitName,
    };
  }

  return null;
}

async function getActiveIngredientItemMapInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        name: string;
        sku: string | null;
        itemType: string;
        unitName: string;
      }
    >();
  }

  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(and(inArray(items.id, uniqueIds), isNull(items.deletedAt)));

  const displayByItemId = await getManufacturingItemDisplayMetadataInTx(
    tx,
    rows.map((row) => row.id)
  );

  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        name: canonicalItemName(displayByItemId, row.id, row.name),
      },
    ])
  );
}

async function prepareCreateIngredientsFromBomInTx(
  tx: Tx,
  productId: string,
  outputQuantity: number,
  options?: { roundUpBatchOutput?: boolean }
): Promise<{ bomRevisionId: string; outputQuantity: number; ingredients: ValidatedIngredient[] }> {
  const bomRows = await getCurrentBomIngredientsInTx(tx, productId);

  if (bomRows.length === 0) {
    throw new ManufacturingError(
      "Products need a BOM before creating a manufacturing order",
      400
    );
  }
  const batchRow = bomRows.find(
    (row) => normalizeRecipeBasis(row.recipeBasis) === "batch"
  );
  const batchYield = Number(batchRow?.bomOutputQuantity ?? NaN);
  const effectiveOutputQuantity =
    options?.roundUpBatchOutput &&
    batchRow &&
    Number.isFinite(batchYield) &&
    batchYield > 0 &&
    Number.isFinite(outputQuantity) &&
    outputQuantity > 0
      ? roundQuantity(Math.ceil(outputQuantity / batchYield) * batchYield)
      : outputQuantity;

  return {
    bomRevisionId: bomRows[0].bomRevisionId,
    outputQuantity: effectiveOutputQuantity,
    ingredients: bomRows.map((row, index) => {
      const recipeBasis = normalizeRecipeBasis(row.recipeBasis);

      return {
        bomRevisionComponentId: row.bomRevisionComponentId,
        itemId: row.itemId,
        itemName: row.itemName,
        itemSku: row.itemSku,
        itemType: row.itemType,
        unitName: row.unitName,
        quantityPerUnit: row.quantityPerUnit,
        recipeBasis,
        recipeOutputQuantity: row.bomOutputQuantity,
        plannedQuantity: calculatePlannedIngredientQuantity({
          recipeBasis,
          quantityPerUnit: row.quantityPerUnit,
          outputQuantity: effectiveOutputQuantity,
          recipeOutputQuantity: row.bomOutputQuantity,
        }),
        sortOrder: index,
        constraints: row.constraints,
      };
    }),
  };
}

async function insertManufacturingIngredientsInTx(
  tx: Tx,
  manufacturingOrderId: string,
  ingredients: ValidatedIngredient[]
) {
  if (ingredients.length === 0) {
    return [];
  }

  const insertedIngredients = await tx
    .insert(manufacturingOrderIngredients)
    .values(
      ingredients.map((ingredient) => ({
        manufacturingOrderId,
        bomRevisionComponentId: ingredient.bomRevisionComponentId,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        itemSku: ingredient.itemSku,
        itemType: ingredient.itemType,
        unitName: ingredient.unitName,
        quantityPerUnit: ingredient.quantityPerUnit,
        plannedQuantity: ingredient.plannedQuantity,
        sortOrder: ingredient.sortOrder,
      }))
    )
    .returning({
      id: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      sortOrder: manufacturingOrderIngredients.sortOrder,
    });

  const inputByInsertedKey = new Map(
    ingredients.map((input) => [`${input.itemId}:${input.sortOrder}`, input])
  );

  const constraintRows = insertedIngredients.flatMap((ingredient) =>
    (inputByInsertedKey.get(`${ingredient.itemId}:${ingredient.sortOrder}`)
      ?.constraints ?? []).map((constraint) => ({
      manufacturingOrderIngredientId: ingredient.id,
      constraintType: constraint.constraintType,
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    }))
  );

  if (constraintRows.length > 0) {
    await tx.insert(manufacturingOrderIngredientConstraints).values(constraintRows);
  }

  return insertedIngredients.map((ingredient) => {
    const input = inputByInsertedKey.get(`${ingredient.itemId}:${ingredient.sortOrder}`);

    return {
      id: ingredient.id,
      itemId: ingredient.itemId,
      plannedQuantity: input?.plannedQuantity ?? "0",
    };
  });
}

async function insertManufacturingOperationCostsInTx(
  tx: Tx,
  params: {
    manufacturingOrderId: string;
    bomRevisionId: string | null;
    plannedQuantity: number;
  }
) {
  if (!params.bomRevisionId) {
    return [];
  }

  const operationRows = await getBomRevisionOperationCostsInTx(tx, params.bomRevisionId);
  if (operationRows.length === 0) {
    return [];
  }

  return tx
    .insert(manufacturingOrderOperationCosts)
    .values(
      operationRows.map((row) => ({
        manufacturingOrderId: params.manufacturingOrderId,
        sourceBomRevisionOperationCostId: row.id,
        resourceId: row.resourceId,
        operationName: row.operationName,
        resourceName: row.resourceName,
        resourceType: row.resourceType,
        costScalingMode: row.costScalingMode,
        crewSize: row.crewSize,
        plannedMinutes: row.plannedMinutes,
        plannedQuantityBasis:
          row.costScalingMode === "per_output_unit"
            ? normalizeNumeric(params.plannedQuantity)
            : null,
        loadedCostPerHour: row.loadedCostPerHour,
        plannedCostTotal: calculatePlannedOperationCost({
          costScalingMode: row.costScalingMode as never,
          crewSize: row.crewSize,
          plannedMinutes: row.plannedMinutes,
          loadedCostPerHour: row.loadedCostPerHour,
          outputQuantity: params.plannedQuantity,
        }),
        sortOrder: row.sortOrder,
      }))
    )
    .returning({ id: manufacturingOrderOperationCosts.id });
}

async function insertManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  values: {
    id?: string;
    product: ProductSnapshot;
    bomRevisionId: string | null;
    salesLink: SalesLineSnapshot | null;
    requestedQuantity: string;
    plannedQuantity: number;
    manufacturingMode: "discrete" | "batch";
    numberOfBatches: number | null;
    expectedBatchYield: string | null;
    priorityRank: number | null;
    plannedDate: string | null;
    notes: string | null;
    ingredients: ValidatedIngredient[];
  }
) {
  // Creating a new batch-mode MO is the batch_production workflow; in-flight
  // Batch MOs always execute and complete; commercial access is unrestricted.
  if (values.manufacturingMode === "batch") {
    await assertFeatureAccessInTx(tx, orgId, "batch_production", {
      route: "POST /api/manufacturing-orders",
    });
  }
  const orderNumber = await generateMONumber(tx, orgId);
  const [order] = await tx
    .insert(manufacturingOrders)
    .values({
      ...(values.id ? { id: values.id } : {}),
      organizationId: orgId,
      orderNumber,
      productId: values.product.id,
      bomRevisionId: values.bomRevisionId,
      salesOrderId: values.salesLink?.salesOrderId ?? null,
      salesOrderLineId: values.salesLink?.salesOrderLineId ?? null,
      productName: values.product.name,
      productSku: values.product.sku,
      unitName: values.product.unitName,
      manufacturingMode: values.manufacturingMode,
      numberOfBatches: values.numberOfBatches,
      expectedBatchYield: values.expectedBatchYield,
      requestedQuantity: normalizeNumeric(Number(values.requestedQuantity)),
      salesOrderNumber: values.salesLink?.salesOrderNumber ?? null,
      salesCustomerName: values.salesLink?.customerName ?? null,
      status: "open",
      priorityRank: values.priorityRank,
      plannedQuantity: normalizeNumeric(values.plannedQuantity),
      plannedDate: values.plannedDate,
      notes: values.notes,
    })
    .returning({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
    });

  await insertManufacturingIngredientsInTx(tx, order.id, values.ingredients);
  await insertManufacturingOperationCostsInTx(tx, {
    manufacturingOrderId: order.id,
    bomRevisionId: values.bomRevisionId,
    plannedQuantity: values.plannedQuantity,
  });

  return order;
}

async function activateManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  order: LockedManufacturingOrder,
  params: {
    actorUserId?: string | null;
  }
) {
  await getValidatedProductInTx(tx, order.productId);

  const ingredientRows = await tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.id));

  await validateActiveIngredientItemsInTx(
    tx,
    ingredientRows.map((row) => row.itemId)
  );
  await lockItemsInTx(
    tx,
    ingredientRows.map((row) => row.itemId)
  );

  const updatedAt = new Date();
  const [orderRow] = await tx
    .update(manufacturingOrders)
    .set({
      status: "open",
      priorityRank: null,
      updatedAt,
    })
    .where(eq(manufacturingOrders.id, order.id))
    .returning({ id: manufacturingOrders.id });

  await rerankOpenManufacturingOrdersInTx(tx, orgId);

  if (order.manufacturingMode === "batch") {
    await ensureBatchExecutionRowsInTx(tx, {
      ...order,
      status: "open",
    });
  }

  const demandIngredientRows =
    order.manufacturingMode === "batch"
      ? await tx
          .select({
            ingredientId: manufacturingOrderIngredients.id,
            itemId: manufacturingOrderIngredients.itemId,
            plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
              "plannedQuantity"
            ),
            lotStrategy: manufacturingOrderIngredients.lotStrategy,
          })
          .from(manufacturingOrderIngredients)
          .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.id))
      : ingredientRows;

  await addExpectedFromManufacturingInTx(tx, {
    organizationId: orgId,
    manufacturingOrderId: order.id,
    productId: order.productId,
    quantity: parseFloat(
      (
        await tx
          .select({
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
              "plannedQuantity"
            ),
          })
          .from(manufacturingOrders)
          .where(eq(manufacturingOrders.id, order.id))
      )[0]?.plannedQuantity ?? order.plannedQuantity
    ),
    actorUserId: params.actorUserId ?? null,
  });

  await addIngredientDemandForManufacturingInTx(tx, {
    organizationId: orgId,
    manufacturingOrderId: order.id,
    actorUserId: params.actorUserId ?? null,
    ingredients: demandIngredientRows.map((line) => ({
      ingredientId: line.ingredientId,
      itemId: line.itemId,
      quantity: parseFloat(line.plannedQuantity),
    })),
  });

  return orderRow;
}

async function prepareUpdatedIngredientsInTx(
  tx: Tx,
  manufacturingOrderId: string,
  bomRevisionId: string | null,
  outputQuantity: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"],
  batchCount?: number | null
): Promise<ValidatedIngredient[]> {
  if (!bomRevisionId) {
    return prepareFreeformUpdatedIngredientsInTx(tx, outputQuantity, submittedIngredients);
  }

  const bomRows = await getBomRevisionComponentsInTx(tx, bomRevisionId);
  const [bomRevision] = await tx
    .select({
      recipeBasis: bomRevisions.recipeBasis,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
    })
    .from(bomRevisions)
    .where(eq(bomRevisions.id, bomRevisionId));
  if (submittedIngredients.length !== bomRows.length) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }

  const recipeBasis = normalizeRecipeBasis(bomRevision?.recipeBasis);
  const recipeOutputQuantity = bomRevision?.outputQuantity ?? "1";
  const bomByComponentId = new Map(bomRows.map((row) => [row.componentId, row]));
  const submittedComponentIds = submittedIngredients.map(
    (row, index) => row.defaultItemId ?? bomRows[index]?.componentId
  );
  if (submittedComponentIds.some((componentId) => !componentId)) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }
  if (new Set(submittedComponentIds).size !== bomRows.length) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }

  const sortedSubmittedIngredients = submittedIngredients
    .map((submitted, index) => {
      const componentId = submitted.defaultItemId ?? bomRows[index]?.componentId;
      const row = componentId ? bomByComponentId.get(componentId) : undefined;
      if (!row) {
        throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
      }
      return { submitted, row };
    })
    .sort((left, right) => left.row.sortOrder - right.row.sortOrder);
  const activeItemById = await getActiveIngredientItemMapInTx(
    tx,
    submittedIngredients.map((row) => row.itemId)
  );
  const siblingVariantsByItemId = await getActiveSiblingVariantsByItemIdInTx(
    tx,
    bomRows.map((row) => row.componentId)
  );

  return sortedSubmittedIngredients.map(({ submitted, row }, index) => {
    const activeItem = activeItemById.get(submitted.itemId);
    if (!activeItem) {
      throw new ManufacturingError(
        "One or more ingredients are no longer active. Update the order before releasing it.",
        400
      );
    }
    const selected = getAllowedSiblingBomMaterialOption(
      row,
      siblingVariantsByItemId.get(row.componentId) ?? [],
      row.alternates.map((alternate) => alternate.alternateItemId),
      submitted.itemId
    );
    if (!selected) {
      throw new ManufacturingError(
        "Select the recipe default or a configured alternate for this ingredient.",
        400
      );
    }
    const quantityPerUnit = resolveIngredientQuantityPerUnit(
      row.componentId,
      row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
        quantity: alternate.quantity,
      })),
      selected.itemId,
      row.quantity,
      submitted.quantityPerUnit
    );

    return {
      bomRevisionComponentId: row.id,
      itemId: selected.itemId,
      itemName: selected.itemName,
      itemSku: selected.itemSku,
      itemType: selected.itemType,
      unitName: selected.unitName,
      quantityPerUnit,
      recipeBasis,
      recipeOutputQuantity,
      plannedQuantity: calculatePlannedIngredientQuantity({
        recipeBasis,
        quantityPerUnit,
        outputQuantity,
        recipeOutputQuantity,
        batchCount,
      }),
      sortOrder: index,
      constraints: row.constraints,
    };
  });
}

async function prepareFreeformUpdatedIngredientsInTx(
  tx: Tx,
  outputQuantity: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"]
): Promise<ValidatedIngredient[]> {
  const activeItemById = await getActiveIngredientItemMapInTx(
    tx,
    submittedIngredients.map((row) => row.itemId)
  );

  return submittedIngredients.map((submitted, index) => {
    const activeItem = activeItemById.get(submitted.itemId);
    if (!activeItem) {
      throw new ManufacturingError(
        "One or more ingredients are no longer active. Update the order before releasing it.",
        400
      );
    }
    const quantityPerUnit = normalizeNumeric(Number(submitted.quantityPerUnit));
    return {
      bomRevisionComponentId: null,
      itemId: activeItem.id,
      itemName: activeItem.name,
      itemSku: activeItem.sku,
      itemType: activeItem.itemType,
      unitName: activeItem.unitName,
      quantityPerUnit,
      recipeBasis: "unit",
      recipeOutputQuantity: "1",
      plannedQuantity: calculatePlannedIngredientQuantity({
        recipeBasis: "unit",
        quantityPerUnit,
        outputQuantity,
        recipeOutputQuantity: "1",
      }),
      sortOrder: index,
      constraints: [],
    };
  });
}

function defaultManufacturingPlannedDate(shipDate: string | null) {
  if (!shipDate) return null;
  const date = new Date(`${shipDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function createManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  payload: InsertManufacturingOrder,
  actorUserId?: string | null,
  options?: { idempotencyKey?: string }
): Promise<{ id: string; replayed: boolean }> {
  let createdNew = false;
  const { result, replayed } = await runIdempotentInventoryOperationInTx<{ id: string }>(
    tx,
    {
      organizationId: orgId,
      operationName: "createManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload,
    },
    async () => {
      await lockManufacturingPriorityQueueInTx(tx, orgId);

      if (payload.id) {
        // Idempotent under client-generated ids: a retried create with the same
        // id no-ops the insert.
        const [existing] = await tx
          .select({ id: manufacturingOrders.id })
          .from(manufacturingOrders)
          .where(eq(manufacturingOrders.id, payload.id));
        if (existing) {
          return { id: existing.id };
        }
      }

      const product = await getValidatedProductInTx(tx, payload.productId);
      const plannedQuantity = Number(payload.plannedQuantity);
      const batchCount =
        payload.batchCount != null ? parsePositiveWholeBatchCount(payload.batchCount) : null;

      const salesLink = await validateSalesLineLinkInTx(tx, {
        salesOrderId: payload.salesOrderId,
        salesOrderLineId: payload.salesOrderLineId,
        productId: payload.productId,
      });
      const { bomRevisionId, ingredients } = await prepareCreateIngredientsInTx(
        tx,
        payload.productId,
        plannedQuantity,
        payload.ingredients,
        batchCount
      );
      const scalingPlan = deriveScalingPlan(
        plannedQuantity,
        ingredients,
        payload.batchCount ?? null
      );
      const scaledIngredients = applyScalingPlanToIngredients(
        ingredients,
        plannedQuantity,
        scalingPlan
      );
      const order = await insertManufacturingOrderInTx(tx, orgId, {
        id: payload.id,
        product,
        bomRevisionId,
        salesLink,
        requestedQuantity: payload.plannedQuantity,
        plannedQuantity,
        manufacturingMode: scalingPlan.manufacturingMode,
        numberOfBatches: scalingPlan.numberOfBatches,
        expectedBatchYield: scalingPlan.expectedBatchYield,
        priorityRank: null,
        plannedDate: payload.plannedDate ?? null,
        notes: payload.notes ?? null,
        ingredients: scaledIngredients,
      });

      const lockedOrder = await getLockedManufacturingOrderInTx(tx, order.id);
      if (!lockedOrder) {
        throw new ManufacturingError("Order not found", 404);
      }
      await activateManufacturingOrderInTx(tx, orgId, lockedOrder, {
        actorUserId,
      });
      createdNew = true;

      return { id: order.id };
    },
  );

  return { id: result.id, replayed: replayed || !createdNew };
}

export async function createManufacturingOrder(
  payload: InsertManufacturingOrder,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  let notifyOrgId = "";
  const created = await withAuthedOrgContext((tx, orgId, userId) => {
    notifyOrgId = orgId;
    return createManufacturingOrderInTx(tx, orgId, payload, userId, options);
  });
  if (!created.replayed) {
    await notifyManufacturingOrderCreated(notifyOrgId, created.id);
  }
  return { id: created.id };
}

export async function duplicateManufacturingOrder(
  id: string,
  options?: { idempotencyKey?: string }
): Promise<{ id: string } | null> {
  let notifyOrgId = "";
  const outcome = await withAuthedOrgContext(async (tx, orgId, userId) => {
    notifyOrgId = orgId;

    const { result, replayed } = await runIdempotentInventoryOperationInTx<
      { id: string } | null
    >(
      tx,
      {
        organizationId: orgId,
        operationName: "duplicateManufacturingOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id },
      },
      async () => {
        const source = await getManufacturingOrderForDuplicateInTx(tx, id);

        if (!source) {
          return null;
        }

        const created = await createManufacturingOrderInTx(tx, orgId, {
          productId: source.productId,
          salesOrderId: null,
          salesOrderLineId: null,
          plannedQuantity: source.plannedQuantity,
          batchCount:
            source.numberOfBatches == null ? undefined : String(source.numberOfBatches),
          priorityRank: null,
          plannedDate: source.plannedDate,
          notes: source.notes,
          ingredients: source.ingredients,
          confirmShortage: false,
        }, userId);

        return { id: created.id };
      },
    );

    return { result, created: !replayed && result != null };
  });

  if (outcome.created && outcome.result) {
    await notifyManufacturingOrderCreated(notifyOrgId, outcome.result.id);
  }

  return outcome.result;
}

async function getManufacturingOrderForDuplicateInTx(
  tx: Tx,
  id: string
): Promise<{
  productId: string;
  plannedQuantity: string;
  numberOfBatches: number | null;
  plannedDate: string | null;
  notes: string | null;
  ingredients: { itemId: string; quantityPerUnit: string }[];
} | null> {
  const [order] = await tx
    .select({
      productId: manufacturingOrders.productId,
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
      numberOfBatches: manufacturingOrders.numberOfBatches,
      plannedDate: manufacturingOrders.plannedDate,
      notes: manufacturingOrders.notes,
    })
    .from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)));

  if (!order) {
    return null;
  }

  const ingredientRows = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      quantityPerUnit: trimScale(
        manufacturingOrderIngredients.quantityPerUnit
      ).as("quantityPerUnit"),
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const seenItemIds = new Set<string>();
  const ingredients: { itemId: string; quantityPerUnit: string }[] = [];
  for (const row of ingredientRows) {
    if (seenItemIds.has(row.itemId)) continue;
    seenItemIds.add(row.itemId);
    ingredients.push({ itemId: row.itemId, quantityPerUnit: row.quantityPerUnit });
  }

  return {
    productId: order.productId,
    plannedQuantity: order.plannedQuantity,
    numberOfBatches: order.numberOfBatches,
    plannedDate: order.plannedDate,
    notes: order.notes,
    ingredients,
  };
}

export async function createManufacturingOrdersFromSalesOrderInTx(
  tx: Tx,
  orgId: string,
  salesOrderId: string,
  payload: CreateManufacturingOrdersFromSalesOrder,
  actorUserId?: string | null
): Promise<ManufacturingOrdersFromSalesOrderResult> {
  await lockManufacturingPriorityQueueInTx(tx, orgId);

  const [order] = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), isNull(salesOrders.deletedAt)))
    .for("update");

  if (!order) {
    throw new ManufacturingError("Sales order not found", 404);
  }

  if (order.status !== "open") {
    throw new ManufacturingError(
      "Only open sales orders can create manufacturing orders",
      400
    );
  }

  const summary = (
    await getSalesOrderManufacturingSummariesInTx(tx, [salesOrderId])
  ).get(salesOrderId);

  if (!summary || !summary.hasManufacturableLines) {
    throw new ManufacturingError(
      summary?.disabledReason ?? "No manufacturable lines remain on this order.",
      400
    );
  }

  const plannedDate =
    payload.plannedDate ?? defaultManufacturingPlannedDate(order.shipDate);
  const selectedLineIds = new Set(payload.salesOrderLineIds);
  const quantityByLineId = new Map(
    payload.lineQuantities?.map((lineQuantity) => [
      lineQuantity.salesOrderLineId,
      lineQuantity.quantity,
    ]) ?? []
  );
  const created: ManufacturingOrdersFromSalesOrderResult["created"] = [];
  const skipped: ManufacturingOrdersFromSalesOrderResult["skipped"] = [];
  const summaryLineById = new Map(
    summary.lines.map((line) => [line.salesOrderLineId, line])
  );
  const invalidLine = payload.salesOrderLineIds.find((lineId) => {
    const line = summaryLineById.get(lineId);
    return !line || line.status !== "will_create" || line.skipReason != null;
  });

  if (invalidLine) {
    throw new ManufacturingError(
      "Selected manufacturing orders changed. Refresh and try again.",
      409
    );
  }

  const invalidQuantityLine = [...quantityByLineId.keys()].find(
    (lineId) => !selectedLineIds.has(lineId)
  );

  if (invalidQuantityLine) {
    throw new ManufacturingError(
      "Manufacturing quantity changed. Refresh and try again.",
      409
    );
  }

  for (const line of summary.lines) {
    if (line.status === "skipped" || line.skipReason != null) {
      skipped.push({
        salesOrderLineId: line.salesOrderLineId,
        reason: line.skipReason ?? "existing_active_mo",
      });
      continue;
    }

    if (!selectedLineIds.has(line.salesOrderLineId)) {
      continue;
    }

    const product = await getValidatedProductInTx(tx, line.itemId);
    let requestedQuantity =
      payload.manufacturingStrategy === "make_to_stock"
        ? quantityByLineId.get(line.salesOrderLineId) ?? line.quantity
        : line.quantity;
    let plannedQuantity = Number(requestedQuantity);
    const { bomRevisionId, outputQuantity, ingredients } = await prepareCreateIngredientsFromBomInTx(
      tx,
      line.itemId,
      plannedQuantity,
      { roundUpBatchOutput: payload.manufacturingStrategy === "make_to_order" }
    );
    plannedQuantity = outputQuantity;
    requestedQuantity = normalizeNumeric(outputQuantity);
    const scalingPlan = deriveScalingPlan(plannedQuantity, ingredients);
    const scaledIngredients = applyScalingPlanToIngredients(
      ingredients,
      plannedQuantity,
      scalingPlan
    );
    const createdOrder = await insertManufacturingOrderInTx(tx, orgId, {
      product,
      bomRevisionId,
      salesLink:
        payload.manufacturingStrategy === "make_to_stock"
          ? null
          : {
              salesOrderId: order.id,
              salesOrderLineId: line.salesOrderLineId,
              salesOrderNumber: order.orderNumber,
              customerName: order.customerName,
            },
      requestedQuantity,
      plannedQuantity,
      manufacturingMode: scalingPlan.manufacturingMode,
      numberOfBatches: scalingPlan.numberOfBatches,
      expectedBatchYield: scalingPlan.expectedBatchYield,
      priorityRank: null,
      plannedDate,
      notes: payload.notes ?? null,
      ingredients: scaledIngredients,
    });
    const lockedOrder = await getLockedManufacturingOrderInTx(tx, createdOrder.id);
    if (!lockedOrder) {
      throw new ManufacturingError("Order not found", 404);
    }
    await activateManufacturingOrderInTx(tx, orgId, lockedOrder, {
      actorUserId,
    });

    created.push({
      salesOrderLineId: line.salesOrderLineId,
      manufacturingOrderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
    });
  }

  return { created, skipped };
}

export async function createManufacturingOrdersFromSalesOrder(
  salesOrderId: string,
  payload: CreateManufacturingOrdersFromSalesOrder,
  options?: { idempotencyKey?: string | null }
): Promise<ManufacturingOrdersFromSalesOrderResult> {
  let notifyOrgId = "";
  const { result, replayed } = await withAuthedOrgContext((tx, orgId, userId) => {
    notifyOrgId = orgId;
    return runIdempotentInventoryOperationInTx<ManufacturingOrdersFromSalesOrderResult>(
      tx,
      {
        organizationId: orgId,
        operationName: "createManufacturingOrdersFromSalesOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { salesOrderId, ...payload },
      },
      () =>
        createManufacturingOrdersFromSalesOrderInTx(
          tx,
          orgId,
          salesOrderId,
          payload,
          userId
        )
    );
  });
  if (!replayed) {
    for (const order of result.created) {
      await notifyManufacturingOrderCreated(notifyOrgId, order.manufacturingOrderId);
    }
  }
  return result;
}

async function isManufacturingMetadataOnlyEditInTx(
  tx: Tx,
  id: string,
  existing: LockedManufacturingOrder,
  payload: UpdateManufacturingOrder
): Promise<boolean> {
  const nextProductId = payload.productId ?? existing.productId;
  if (nextProductId !== existing.productId) return false;

  if (
    hasManufacturingQuantityChanged(existing.plannedQuantity, payload.plannedQuantity)
  ) {
    return false;
  }
  if (
    payload.batchCount != null &&
    existing.numberOfBatches !== parsePositiveWholeBatchCount(payload.batchCount)
  ) {
    return false;
  }

  const nextSalesOrderId = payload.salesOrderId ?? existing.salesOrderId;
  const nextSalesOrderLineId = payload.salesOrderLineId ?? existing.salesOrderLineId;
  if (
    nextSalesOrderId !== existing.salesOrderId ||
    nextSalesOrderLineId !== existing.salesOrderLineId
  ) {
    return false;
  }

  const existingIngredients = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  if (payload.ingredients.length !== existingIngredients.length) return false;

  return payload.ingredients.every((ingredient, index) => {
    const current = existingIngredients[index];
    return (
      current.itemId === ingredient.itemId &&
      !hasManufacturingQuantityChanged(
        current.quantityPerUnit,
        ingredient.quantityPerUnit
      )
    );
  });
}

export async function updateManufacturingOrder(
  id: string,
  payload: UpdateManufacturingOrder
): Promise<{ id: string } | { conflict: true } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const existing = await getLockedManufacturingOrderInTx(tx, id);

    if (!existing) {
      return null;
    }

    if (
      payload.expectedVersion != null &&
      existing.version !== payload.expectedVersion
    ) {
      return { conflict: true } as const;
    }

    if (existing.status !== "open") {
      throw new ManufacturingError("Only open orders can be edited", 400);
    }

    if (await isManufacturingMetadataOnlyEditInTx(tx, id, existing, payload)) {
      const [order] = await tx
        .update(manufacturingOrders)
        .set({
          plannedDate: payload.plannedDate ?? null,
          notes: payload.notes ?? null,
          version: sql`${manufacturingOrders.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, id))
        .returning({ id: manufacturingOrders.id });

      return order ?? null;
    }

    if (isOpenManufacturingOrder(existing)) {
      const existingIngredientIds = await tx
        .select({ id: manufacturingOrderIngredients.id })
        .from(manufacturingOrderIngredients)
        .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));
      const ingredientIds = existingIngredientIds.map((ingredient) => ingredient.id);
      await assertManufacturingPlanningUpdateAllowedInTx(
        tx,
        existing,
        ingredientIds
      );
    }

    assertLinkedMtoIdentityUnchanged(existing, payload);

    const nextProductId = payload.productId ?? existing.productId;
    const productChanged = nextProductId !== existing.productId;
    const product = productChanged
      ? await getValidatedProductInTx(tx, nextProductId)
      : {
          id: existing.productId,
          name: existing.productName,
          sku: existing.productSku,
          unitName: existing.unitName,
        };
    const plannedQuantity = Number(payload.plannedQuantity);
    const batchCount =
      payload.batchCount != null
        ? parsePositiveWholeBatchCount(payload.batchCount)
        : productChanged
          ? null
          : existing.numberOfBatches;
    const salesOrderId = payload.salesOrderId ?? (productChanged ? null : existing.salesOrderId);
    const salesOrderLineId =
      payload.salesOrderLineId ?? (productChanged ? null : existing.salesOrderLineId);

    const salesLink = await validateSalesLineLinkInTx(
      tx,
      {
        salesOrderId,
        salesOrderLineId,
        productId: nextProductId,
      },
      !productChanged && existing.salesOrderId && existing.salesOrderLineId
        ? {
            salesOrderId: existing.salesOrderId,
            salesOrderLineId: existing.salesOrderLineId,
            salesOrderNumber: existing.salesOrderNumber ?? "",
            customerName: existing.salesCustomerName ?? "",
          }
        : null,
      id
    );
    const { bomRevisionId, ingredients } = productChanged
      ? await prepareCreateIngredientsInTx(
          tx,
          nextProductId,
          plannedQuantity,
          payload.ingredients,
          batchCount
        )
      : await prepareUpdatedIngredientsInTx(
          tx,
          id,
          existing.bomRevisionId,
          plannedQuantity,
          payload.ingredients,
          batchCount
        ).then((result) => ({
          bomRevisionId: existing.bomRevisionId,
          ingredients: result,
        }));
    const scalingPlan = deriveScalingPlan(
      plannedQuantity,
      ingredients,
      batchCount == null ? null : String(batchCount)
    );
    const scaledIngredients = applyScalingPlanToIngredients(
      ingredients,
      plannedQuantity,
      scalingPlan
    );
    // Editing re-derives the mode from the BOM; entering batch is the
    // batch_production workflow. Already-batch MOs stay editable (in-flight rule).
    if (
      existing.manufacturingMode !== "batch" &&
      scalingPlan.manufacturingMode === "batch"
    ) {
      await assertFeatureAccessInTx(tx, orgId, "batch_production", {
        route: "PUT /api/manufacturing-orders/[id]",
      });
    }
    const existingIngredientRows = await tx
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
      .for("update");

    const [order] = await tx
      .update(manufacturingOrders)
      .set({
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        unitName: product.unitName,
        bomRevisionId,
        salesOrderId: salesLink?.salesOrderId ?? null,
        salesOrderLineId: salesLink?.salesOrderLineId ?? null,
        salesOrderNumber: salesLink?.salesOrderNumber ?? null,
        salesCustomerName: salesLink?.customerName ?? null,
        requestedQuantity: normalizeNumeric(Number(payload.plannedQuantity)),
        plannedQuantity: normalizeNumeric(plannedQuantity),
        manufacturingMode: scalingPlan.manufacturingMode,
        numberOfBatches: scalingPlan.numberOfBatches,
        expectedBatchYield: scalingPlan.expectedBatchYield,
        priorityRank: null,
        plannedDate: payload.plannedDate ?? null,
        notes: payload.notes ?? null,
        version: sql`${manufacturingOrders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await tx
      .delete(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));
    await tx
      .delete(manufacturingOrderOperationCosts)
      .where(eq(manufacturingOrderOperationCosts.manufacturingOrderId, id));

    if (isOpenManufacturingOrder(existing)) {
      await releaseIngredientDemandForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
        reason: "edited",
        ingredientIds: existingIngredientRows.map((row) => row.id),
      });
    }

    const insertedIngredients = await insertManufacturingIngredientsInTx(
      tx,
      id,
      scaledIngredients
    );
    await insertManufacturingOperationCostsInTx(tx, {
      manufacturingOrderId: id,
      bomRevisionId,
      plannedQuantity,
    });

    if (isOpenManufacturingOrder(existing)) {
      if (productChanged) {
        await editExpectedFromManufacturingInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: id,
          productId: existing.productId,
          nextQuantity: 0,
          actorUserId: userId,
        });
        await addExpectedFromManufacturingInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: id,
          productId: nextProductId,
          quantity: plannedQuantity,
          actorUserId: userId,
        });
      } else {
        await editExpectedFromManufacturingInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: id,
          productId: existing.productId,
          nextQuantity: plannedQuantity,
          actorUserId: userId,
        });
      }

      if (existing.manufacturingMode === "batch") {
        await tx
          .delete(manufacturingOrderBatches)
          .where(eq(manufacturingOrderBatches.manufacturingOrderId, id));
      }

      if (scalingPlan.manufacturingMode === "batch") {
        const refreshedOrder = await getLockedManufacturingOrderInTx(tx, id);
        if (refreshedOrder) {
          await ensureBatchExecutionRowsInTx(tx, refreshedOrder);
        }
      }

      const demandIngredientRows =
        scalingPlan.manufacturingMode === "batch"
          ? await tx
              .select({
                id: manufacturingOrderIngredients.id,
                itemId: manufacturingOrderIngredients.itemId,
                plannedQuantity: trimScale(
                  manufacturingOrderIngredients.plannedQuantity
                ).as("plannedQuantity"),
              })
              .from(manufacturingOrderIngredients)
              .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
          : insertedIngredients;

      await addIngredientDemandForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
        ingredients: demandIngredientRows.map((ingredient) => ({
          ingredientId: ingredient.id,
          itemId: ingredient.itemId,
          quantity: parseFloat(ingredient.plannedQuantity),
        })),
      });

    }

    await rerankOpenManufacturingOrdersInTx(tx, orgId);

    return order;
  });
}

/**
 * Inline-edit PATCH for the redesigned MO sheet. This is intentionally limited
 * to metadata that does not affect inventory truth. Quantity and ingredient
 * changes must continue through updateManufacturingOrder so expected supply,
 * ingredient demand and batches stay in sync.
 */
export async function patchManufacturingOrder(
  id: string,
  payload: PatchManufacturingOrder
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx) => {
    const existing = await getLockedManufacturingOrderInTx(tx, id);
    if (!existing) return null;

    if (existing.status !== "open") {
      throw new ManufacturingError("Only open orders can be edited.", 400);
    }

    const updates: Record<string, unknown> = {
      version: sql`${manufacturingOrders.version} + 1`,
      updatedAt: new Date(),
    };

    if (payload.plannedDate !== undefined) {
      updates.plannedDate = payload.plannedDate ?? null;
    }
    if (payload.notes !== undefined) {
      updates.notes = payload.notes ?? null;
    }
    if (payload.salesOrderId !== undefined || payload.salesOrderLineId !== undefined) {
      assertLinkedMtoIdentityUnchanged(existing, {
        salesOrderId: payload.salesOrderId,
        salesOrderLineId: payload.salesOrderLineId,
      });
      const salesLink = await validateSalesLineLinkInTx(
        tx,
        {
          salesOrderId: payload.salesOrderId ?? existing.salesOrderId,
          salesOrderLineId: payload.salesOrderLineId ?? existing.salesOrderLineId,
          productId: existing.productId,
        },
        existing.salesOrderId && existing.salesOrderLineId
          ? {
              salesOrderId: existing.salesOrderId,
              salesOrderLineId: existing.salesOrderLineId,
              salesOrderNumber: existing.salesOrderNumber ?? "",
              customerName: existing.salesCustomerName ?? "",
            }
          : null,
        id,
      );
      updates.salesOrderId = salesLink?.salesOrderId ?? null;
      updates.salesOrderLineId = salesLink?.salesOrderLineId ?? null;
      updates.salesOrderNumber = salesLink?.salesOrderNumber ?? null;
      updates.salesCustomerName = salesLink?.customerName ?? null;
    }
    if (payload.isBlocked !== undefined) {
      updates.isBlocked = payload.isBlocked;
    }

    const [order] = await tx
      .update(manufacturingOrders)
      .set(updates)
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    return order ?? null;
  });
}

export async function patchManufacturingOrderIngredient(
  orderId: string,
  ingredientId: string,
  payload: PatchManufacturingOrderIngredient
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);
    if (!order) return null;

    const [existing] = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
        pickStatus: manufacturingOrderIngredients.pickStatus,
        lotStrategy: manufacturingOrderIngredients.lotStrategy,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.id, ingredientId),
          eq(manufacturingOrderIngredients.manufacturingOrderId, orderId)
        )
      )
      .for("update");
    if (!existing) return null;

    if (order.status !== "open") {
      throw new ManufacturingError(
        "Only open orders can change ingredient lot strategy.",
        400
      );
    }

    if (
      existing.pickStatus !== "not_picked" ||
      Number(existing.pickedQuantity) > 0
    ) {
      throw new ManufacturingError(
        "Ingredient lot strategy cannot be changed after picking starts.",
        400
      );
    }

    // FIFO is the free default; explicit lot-pick policies are a
    // lot-tracking workflow.
    if (payload.lotStrategy !== undefined && payload.lotStrategy !== "fifo") {
      await assertFeatureAccessInTx(tx, orgId, "lot_tracking", {
        route: "PATCH /api/manufacturing-orders/[id]/ingredients/[ingredientId]",
      });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (payload.lotStrategy !== undefined) {
      updates.lotStrategy = payload.lotStrategy;
    }

    await tx
      .update(manufacturingOrderIngredients)
      .set(updates)
      .where(eq(manufacturingOrderIngredients.id, ingredientId));

    return { id: existing.id };
  });
}
