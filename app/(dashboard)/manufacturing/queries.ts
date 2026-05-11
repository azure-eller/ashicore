import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  type InventoryDisposition,
  inventoryReservationsSummary,
  items,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderOutputConsumptions,
  manufacturingOrderOutputs,
  manufacturingOrderIngredientConstraints,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingPickAllocations,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeNumericScale, resolveVariantDisplay } from "@/lib/format";
import {
  getBomRevisionComponentsInTx,
  getCurrentActiveBomIngredientsInTx,
  getCurrentBomCoverageInTx,
  type BomRevisionComponentSnapshot,
} from "@/lib/bom/revisions";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  addExpectedFromManufacturingInTx,
  applyDemandReferenceDeltasInTx,
  applyExpectedReferenceDeltasInTx,
  applyReservationReferenceDeltasInTx,
  beginInventoryOperationInTx,
  cancelReleasedManufacturingOrderInTx,
  consumeStockFifoInTx,
  decrementExistingLotStockInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getCurrentAvailableQtyAtLocationInTx,
  getDefaultInventoryLocationInTx,
  getManufacturingIngredientReservationRowsInTx,
  lockItemsInTx,
  pickManufacturingIngredientInTx,
  produceManufacturedStockInTx,
  projectedLotUnitCost,
  reconcileIngredientActualsInTx,
  releaseIngredientReservationForManufacturingInTx,
  reserveIngredientsForManufacturingInTx,
  restockExistingLotInTx,
} from "@/lib/inventory/kernel";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import {
  formatMinimumLotAgeRequirementViolation,
  getMinimumLotAgeDays,
  type BomComponentConstraint,
} from "@/lib/bom/constraints";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  CompleteManufacturingBatch,
  CompleteManufacturingOrder,
  CreateManufacturingOrdersFromSalesOrder,
  InsertManufacturingOrder,
  ManufacturingBatchStatus,
  ManufacturingOrderStatus,
  ManufacturingPickStatus,
  RecordManufacturingOutput,
  ReorderManufacturingOrderPriorityRanks,
  ReorderManufacturingIngredients,
  UpdateManufacturingOrderPriority,
  UpdateManufacturingOrder,
} from "@/lib/schemas/manufacturing-orders";
import type {
  ManufacturingExecutionDetail,
  ManufacturingExecutionQueueRow,
  ManufacturingOrderDetail,
  ManufacturingOrderEditData,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrdersFromSalesOrderResult,
  ManufacturingOrderListRow,
  ManufacturingPickProgressStatus,
  ManufacturingProductOption,
  ManufacturingReleaseWarningPayload,
  ManufacturingSalesOrderOption,
  ManufacturingSalesOrderPreview,
  ManufacturingSalesLineOption,
} from "./types";

type ProductSnapshot = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
  manufacturingMode: string;
  expectedBatchYield: string | null;
};

type SalesLineSnapshot = {
  salesOrderId: string;
  salesOrderLineId: string;
  salesOrderNumber: string;
  customerName: string;
};

type LockedManufacturingOrder = {
  id: string;
  productId: string;
  status: (typeof manufacturingOrders.$inferSelect)["status"];
  manufacturingMode: string;
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  plannedDate: string | null;
  bomRevisionId: string | null;
};

type ValidatedIngredient = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  plannedQuantity: string;
  sortOrder: number;
  constraints: BomComponentConstraint[];
};

type IngredientProgressRow = {
  plannedQuantity: string;
  pickedQuantity: string;
};

type ExecutionIngredientRow = {
  id: string;
  manufacturingOrderBatchId: string | null;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
  quantityPerUnit: string;
  plannedQuantity: string;
  pickedQuantity: string;
  pickStatus: ManufacturingPickStatus;
  actualQuantity: string | null;
  actualCostTotal: string | null;
  sortOrder: number;
  constraints: BomComponentConstraint[];
};

type ExecutionBatchRow = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  plannedQuantity: string;
  actualQuantity: string | null;
  startedAt: Date | null;
  pickedAt: Date | null;
  completedAt: Date | null;
  lotId: string | null;
  lotNumber: string | null;
  costPerUnit: string | null;
};

type LockedBatchStateRow = {
  id: string;
  batchNumber: number;
  status: ManufacturingBatchStatus;
  pickedAt: Date | null;
};

function multiplyQuantityString(quantity: string, multiplier: number) {
  return normalizeNumeric(Number(quantity) * multiplier);
}

function buildIngredientActualsMap(
  submitted: CompleteManufacturingOrder["ingredientActuals"] | undefined,
  ingredientRows: Array<{ id: string; itemName: string }>
) {
  const map = new Map<string, number>();
  if (!submitted || submitted.length === 0) {
    return map;
  }

  const ingredientIds = new Set(ingredientRows.map((row) => row.id));
  for (const entry of submitted) {
    if (!ingredientIds.has(entry.ingredientId)) {
      throw new ManufacturingError(
        "Unknown ingredient in actuals payload.",
        400,
        { errors: { ingredientActuals: ["Unknown ingredient."] } }
      );
    }
    map.set(entry.ingredientId, parseFloat(entry.actualConsumedQuantity));
  }

  const missing = ingredientRows.filter((ingredient) => !map.has(ingredient.id));
  if (missing.length > 0) {
    throw new ManufacturingError(
      `Missing actuals for ${missing.map((ingredient) => ingredient.itemName).join(", ")}.`,
      400,
      {
        errors: {
          ingredientActuals: missing.map((ingredient) => ingredient.itemName),
        },
      }
    );
  }

  return map;
}

function normalizeQuantityNumber(value: number) {
  return Number(normalizeNumeric(value));
}

function sumNumericStrings(values: Array<string | null | undefined>) {
  return values.reduce((sum, value) => sum + parseFloat(value ?? "0"), 0);
}

function getRemainingQuantityNumber(plannedQuantity: string, pickedQuantity: string) {
  return Math.max(
    0,
    normalizeQuantityNumber(parseFloat(plannedQuantity) - parseFloat(pickedQuantity))
  );
}

function getCurrentExecutionBatch<T extends { id: string; batchNumber: number; status: string }>(
  batches: T[]
) {
  return batches.find((batch) => batch.status !== "completed") ?? null;
}

function assertCurrentExecutionBatch<T extends { id: string; batchNumber: number; status: string }>(
  batches: T[],
  batchId: string,
  action: "started" | "picked" | "completed"
) {
  const currentBatch = getCurrentExecutionBatch(batches);

  if (!currentBatch) {
    throw new ManufacturingError("All batches are already completed", 400);
  }

  if (currentBatch.id !== batchId) {
    throw new ManufacturingError(
      `Only batch ${currentBatch.batchNumber} can be ${action} right now.`,
      400
    );
  }

  return currentBatch;
}

function getRemainingQuantityString(plannedQuantity: string, pickedQuantity: string) {
  return normalizeNumeric(getRemainingQuantityNumber(plannedQuantity, pickedQuantity));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function subtractDays(value: string, days: number) {
  return addDays(value, -days);
}

function lotAgeRequirementText(days: number) {
  return formatMinimumLotAgeRequirementViolation(days);
}

function getPickProgressStatus(
  rows: IngredientProgressRow[]
): ManufacturingPickProgressStatus {
  if (rows.length === 0) {
    return "not_started";
  }

  const pickedRows = rows.filter((row) => parseFloat(row.pickedQuantity) > 0);
  if (pickedRows.length === 0) {
    return "not_started";
  }

  const fullyPicked = rows.every(
    (row) => getRemainingQuantityNumber(row.plannedQuantity, row.pickedQuantity) <= 0
  );

  return fullyPicked ? "picked" : "in_progress";
}

function getPickProgressPercent(rows: IngredientProgressRow[]) {
  const plannedTotal = sumNumericStrings(rows.map((row) => row.plannedQuantity));

  if (plannedTotal <= 0) {
    return 0;
  }

  const pickedTotal = rows.reduce((total, row) => {
    const planned = parseFloat(row.plannedQuantity);
    const picked = parseFloat(row.pickedQuantity);
    return total + Math.min(planned, picked);
  }, 0);

  return Math.min(100, Math.round((pickedTotal / plannedTotal) * 100));
}

/**
 * Compute batch-aware planning values from a product and desired quantity.
 * For batch products: rounds up to full batches.
 * For discrete products: passes through unchanged.
 */
function computeBatchPlanning(
  product: ProductSnapshot,
  desiredQuantity: number,
  options: { numberOfBatches?: number | null } = {}
): {
  plannedQuantity: number;
  numberOfBatches: number | null;
  ingredientMultiplier: number;
} {
  if (product.manufacturingMode === "batch" && product.expectedBatchYield != null) {
    const yield_ = parseFloat(product.expectedBatchYield);
    if (yield_ > 0) {
      const submittedBatchCount = options.numberOfBatches;
      if (
        submittedBatchCount != null &&
        (!Number.isInteger(submittedBatchCount) || submittedBatchCount <= 0)
      ) {
        throw new ManufacturingError("Enter a whole number of batches.", 400, {
          errors: { plannedQuantity: ["Enter a whole number of batches."] },
        });
      }
      const numberOfBatches = submittedBatchCount ?? Math.ceil(desiredQuantity / yield_);
      return {
        plannedQuantity: normalizeQuantityNumber(numberOfBatches * yield_),
        numberOfBatches,
        ingredientMultiplier: numberOfBatches,
      };
    }
  }

  return {
    plannedQuantity: desiredQuantity,
    numberOfBatches: null,
    ingredientMultiplier: desiredQuantity,
  };
}


function summarizeShortageItems(
  items: ManufacturingReleaseWarningPayload["ingredients"]
) {
  if (items.length === 0) return "ingredients";
  if (items.length === 1) return items[0].itemName;
  return `${items[0].itemName} + ${items.length - 1} more`;
}

async function generateMONumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('manufacturing.order_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `MO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

async function getLockedManufacturingOrderInTx(
  tx: Tx,
  id: string
): Promise<LockedManufacturingOrder | null> {
  const [order] = await tx
    .select({
      id: manufacturingOrders.id,
      productId: manufacturingOrders.productId,
      bomRevisionId: manufacturingOrders.bomRevisionId,
      status: manufacturingOrders.status,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      numberOfBatches: manufacturingOrders.numberOfBatches,
      expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
        "expectedBatchYield"
      ),
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      salesOrderNumber: manufacturingOrders.salesOrderNumber,
      salesCustomerName: manufacturingOrders.salesCustomerName,
      plannedDate: manufacturingOrders.plannedDate,
    })
    .from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

function assertSameStringSet(
  actual: string[],
  expected: string[],
  message: string
) {
  if (actual.length !== expected.length) {
    throw new ManufacturingError(message, 400);
  }

  const expectedSet = new Set(expected);
  if (actual.some((value) => !expectedSet.has(value))) {
    throw new ManufacturingError(message, 400);
  }
}

async function assertPriorityRankAvailableInTx(
  tx: Tx,
  orgId: string,
  priorityRank: number | null,
  excludeId?: string
) {
  if (priorityRank == null) {
    return;
  }

  const filters = [
    eq(manufacturingOrders.organizationId, orgId),
    eq(manufacturingOrders.priorityRank, priorityRank),
    inArray(manufacturingOrders.status, ["draft", "released"]),
    isNull(manufacturingOrders.deletedAt),
  ];

  if (excludeId) {
    filters.push(ne(manufacturingOrders.id, excludeId));
  }

  const [conflict] = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .where(and(...filters))
    .for("update");

  if (conflict) {
    throw new ManufacturingError(
      `Priority rank ${priorityRank} is already assigned to another active order.`,
      409
    );
  }
}

export class ManufacturingError extends DomainError<{
  shortage: ManufacturingReleaseWarningPayload;
}> {
  errors?: Record<string, string[]>;
  shortage?: ManufacturingReleaseWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      shortage?: ManufacturingReleaseWarningPayload;
    }
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "ManufacturingError",
      errors,
      extra: options?.shortage ? { shortage: options.shortage } : undefined,
    });

    this.errors = options?.errors;
    this.shortage = options?.shortage;
  }
}

async function getValidatedProductInTx(
  tx: Tx,
  productId: string
): Promise<ProductSnapshot> {
  const [product] = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      unitName: unitDefinitions.name,
      manufacturingMode: items.manufacturingMode,
      expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
        "expectedBatchYield"
      ),
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

  return product;
}

async function getCurrentBomIngredientsInTx(tx: Tx, productId: string) {
  return getCurrentActiveBomIngredientsInTx(tx, productId);
}

async function validateSalesLineLinkInTx(
  tx: Tx,
  values: {
    salesOrderId: string | null | undefined;
    salesOrderLineId: string | null | undefined;
    productId: string;
  },
  existingSnapshot?: SalesLineSnapshot | null
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
    );

  if (
    line &&
    line.deletedAt == null &&
    ["draft", "confirmed", "partially_shipped"].includes(line.orderStatus) &&
    line.itemId === values.productId
  ) {
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
          inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"]),
          eq(salesOrderLines.itemId, values.productId)
        )
      );

    if (replacementLine) {
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

async function prepareCreateIngredientsInTx(
  tx: Tx,
  productId: string,
  ingredientMultiplier: number,
  submittedIngredients: InsertManufacturingOrder["ingredients"]
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

  return {
    bomRevisionId: bomRows[0].bomRevisionId,
    ingredients: bomRows.map((row, index) => {
      const submitted = submittedIngredients[index];
      const alternate = row.alternates.find(
        ({ itemId: alternateItemId }) => alternateItemId === submitted.itemId
      );
      const selected =
        submitted.itemId === row.itemId
          ? {
              itemId: row.itemId,
              itemName: row.itemName,
              itemSku: row.itemSku,
              itemType: row.itemType,
              unitName: row.unitName,
              quantityPerUnit: row.quantityPerUnit,
            }
          : alternate
            ? {
                itemId: alternate.itemId,
                itemName: alternate.itemName,
                itemSku: alternate.itemSku,
                itemType: alternate.itemType,
                unitName: alternate.unitName,
                quantityPerUnit: multiplyQuantityString(
                  row.quantityPerUnit,
                  Number(alternate.quantityFactor)
                ),
              }
            : null;

      if (!selected) {
        throw new ManufacturingError(
          "Select an approved alternate for this ingredient.",
          400
        );
      }

      const quantityPerUnit = normalizeNumeric(Number(submitted.quantityPerUnit));

      return {
        itemId: selected.itemId,
        itemName: selected.itemName,
        itemSku: selected.itemSku,
        itemType: selected.itemType,
        unitName: selected.unitName,
        quantityPerUnit,
        plannedQuantity: multiplyQuantityString(quantityPerUnit, ingredientMultiplier),
        sortOrder: index,
        constraints: row.constraints,
      };
    }),
  };
}

function getApprovedBomMaterialOption(
  row: BomRevisionComponentSnapshot,
  itemId: string
) {
  if (itemId === row.componentId) {
    return {
      itemId: row.componentId,
      itemName: row.componentName,
      itemSku: row.componentSku,
      itemType: row.componentItemType,
      unitName: row.unitName,
      quantityPerUnit: row.quantity,
    };
  }

  const alternate = row.alternates.find(
    (candidate) => candidate.alternateItemId === itemId
  );

  if (!alternate) {
    throw new ManufacturingError("Select an approved alternate for this ingredient.", 400);
  }

  return {
    itemId: alternate.alternateItemId,
    itemName: alternate.alternateItemName,
    itemSku: alternate.alternateItemSku,
    itemType: alternate.alternateItemType,
    unitName: alternate.unitName,
    quantityPerUnit: multiplyQuantityString(
      row.quantity,
      Number(alternate.quantityFactor)
    ),
  };
}

async function prepareCreateIngredientsFromBomInTx(
  tx: Tx,
  productId: string,
  ingredientMultiplier: number
): Promise<{ bomRevisionId: string; ingredients: ValidatedIngredient[] }> {
  const bomRows = await getCurrentBomIngredientsInTx(tx, productId);

  if (bomRows.length === 0) {
    throw new ManufacturingError(
      "Products need a BOM before creating a manufacturing order",
      400
    );
  }

  return {
    bomRevisionId: bomRows[0].bomRevisionId,
    ingredients: bomRows.map((row, index) => {
      return {
        itemId: row.itemId,
        itemName: row.itemName,
        itemSku: row.itemSku,
        itemType: row.itemType,
        unitName: row.unitName,
        quantityPerUnit: row.quantityPerUnit,
        plannedQuantity: multiplyQuantityString(
          row.quantityPerUnit,
          ingredientMultiplier
        ),
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
    return;
  }

  const insertedIngredients = await tx
    .insert(manufacturingOrderIngredients)
    .values(
      ingredients.map((ingredient) => ({
        manufacturingOrderId,
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
}

async function insertManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  values: {
    product: ProductSnapshot;
    bomRevisionId: string | null;
    salesLink: SalesLineSnapshot | null;
    requestedQuantity: string;
    plannedQuantity: number;
    numberOfBatches: number | null;
    priorityRank: number | null;
    plannedDate: string | null;
    notes: string | null;
    ingredients: ValidatedIngredient[];
  }
) {
  const orderNumber = await generateMONumber(tx);
  const [order] = await tx
    .insert(manufacturingOrders)
    .values({
      organizationId: orgId,
      orderNumber,
      productId: values.product.id,
      bomRevisionId: values.bomRevisionId,
      salesOrderId: values.salesLink?.salesOrderId ?? null,
      salesOrderLineId: values.salesLink?.salesOrderLineId ?? null,
      productName: values.product.name,
      productSku: values.product.sku,
      unitName: values.product.unitName,
      manufacturingMode: values.product.manufacturingMode,
      numberOfBatches: values.numberOfBatches,
      expectedBatchYield: values.product.expectedBatchYield,
      requestedQuantity: normalizeNumeric(Number(values.requestedQuantity)),
      salesOrderNumber: values.salesLink?.salesOrderNumber ?? null,
      salesCustomerName: values.salesLink?.customerName ?? null,
      status: "draft",
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

  return order;
}

async function prepareUpdatedIngredientsInTx(
  tx: Tx,
  manufacturingOrderId: string,
  bomRevisionId: string | null,
  ingredientMultiplier: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"]
): Promise<ValidatedIngredient[]> {
  if (!bomRevisionId) {
    return prepareLegacyUpdatedIngredientsInTx(
      tx,
      manufacturingOrderId,
      ingredientMultiplier,
      submittedIngredients
    );
  }

  const bomRows = await getBomRevisionComponentsInTx(tx, bomRevisionId);
  const existingRows = await tx
    .select({
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  if (
    bomRows.length !== submittedIngredients.length ||
    existingRows.length !== submittedIngredients.length
  ) {
    throw new ManufacturingError(
      "Ingredient rows cannot be added or removed after the order is created",
      400
    );
  }

  const bomBySortOrder = new Map(bomRows.map((row) => [row.sortOrder, row]));

  return existingRows.map((existingRow, index) => {
    const row = bomBySortOrder.get(existingRow.sortOrder);
    if (!row) {
      throw new ManufacturingError("The order BOM snapshot is missing.", 400);
    }

    const submitted = submittedIngredients[index];
    const selected = getApprovedBomMaterialOption(row, submitted.itemId);
    const quantityPerUnit = normalizeNumeric(Number(submitted.quantityPerUnit));

    return {
      itemId: selected.itemId,
      itemName: selected.itemName,
      itemSku: selected.itemSku,
      itemType: selected.itemType,
      unitName: selected.unitName,
      quantityPerUnit,
      plannedQuantity: multiplyQuantityString(
        quantityPerUnit,
        ingredientMultiplier
      ),
      sortOrder: existingRow.sortOrder,
      constraints: row.constraints,
    };
  });
}

async function prepareLegacyUpdatedIngredientsInTx(
  tx: Tx,
  manufacturingOrderId: string,
  ingredientMultiplier: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"]
): Promise<ValidatedIngredient[]> {
  const existingRows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
        "quantityPerUnit"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  if (existingRows.length !== submittedIngredients.length) {
    throw new ManufacturingError(
      "Ingredient rows cannot be added or removed after the order is created",
      400
    );
  }

  const constraintsById = await getIngredientConstraintsByIdInTx(
    tx,
    existingRows.map((row) => row.id)
  );

  return existingRows.map((row, index) => {
    const submitted = submittedIngredients[index];
    if (submitted.itemId !== row.itemId) {
      throw new ManufacturingError(
        "This draft order is missing a BOM snapshot. Recreate it before changing ingredients.",
        400
      );
    }

    const quantityPerUnit = normalizeNumeric(Number(submitted.quantityPerUnit));

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      itemType: row.itemType,
      unitName: row.unitName,
      quantityPerUnit,
      plannedQuantity: multiplyQuantityString(quantityPerUnit, ingredientMultiplier),
      sortOrder: row.sortOrder,
      constraints: constraintsById.get(row.id) ?? [],
    };
  });
}

async function validateActiveIngredientItemsInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];

  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(inArray(items.id, uniqueIds), isNull(items.deletedAt)));

  if (rows.length !== uniqueIds.length) {
    throw new ManufacturingError(
      "One or more ingredients are no longer active. Update the order before releasing it.",
      400
    );
  }
}

async function getReleaseShortagesInTx(
  tx: Tx,
  organizationId: string,
  orderId: string,
  plannedDate: string | null
): Promise<ManufacturingReleaseWarningPayload["ingredients"]> {
  const location = await getDefaultInventoryLocationInTx(tx, organizationId);
  const ingredients = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      unitName: manufacturingOrderIngredients.unitName,
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const shortages: ManufacturingReleaseWarningPayload["ingredients"] = [];
  const constraintsByIngredientId = await getIngredientConstraintsByIdInTx(
    tx,
    ingredients.map((ingredient) => ingredient.id)
  );
  const requirementDate = plannedDate ?? isoDate(new Date());

  for (const ingredient of ingredients) {
    const needed = normalizeQuantityNumber(parseFloat(ingredient.plannedQuantity));
    const available = normalizeQuantityNumber(
      await getCurrentAvailableQtyAtLocationInTx(tx, {
        organizationId,
        locationId: location.id,
        itemId: ingredient.itemId,
      })
    );

    if (available < needed) {
      shortages.push({
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        unitName: ingredient.unitName,
        needed,
        available,
        shortage: normalizeQuantityNumber(needed - available),
        warningType: "stock_shortage",
      });
      continue;
    }

    const minimumLotAgeDays = getMinimumLotAgeDays(
      constraintsByIngredientId.get(ingredient.id)
    );
    if (minimumLotAgeDays == null) {
      continue;
    }

    const ageAvailability = await getLotAgeAvailabilityInTx(tx, {
      organizationId,
      locationId: location.id,
      itemId: ingredient.itemId,
      minimumLotAgeDays,
      requiredDate: requirementDate,
    });

    if (ageAvailability.eligible < needed) {
      shortages.push({
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        unitName: ingredient.unitName,
        needed,
        available: ageAvailability.eligible,
        shortage: normalizeQuantityNumber(needed - ageAvailability.eligible),
        warningType: "requirement_violation",
        requirement: lotAgeRequirementText(minimumLotAgeDays),
        nextEligibleDate: ageAvailability.nextEligibleDate,
      });
    }
  }

  return shortages;
}

async function getIngredientConstraintsByIdInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, BomComponentConstraint[]>();
  }

  const rows = await tx
    .select({
      manufacturingOrderIngredientId:
        manufacturingOrderIngredientConstraints.manufacturingOrderIngredientId,
      constraintType: manufacturingOrderIngredientConstraints.constraintType,
      config: manufacturingOrderIngredientConstraints.config,
      sortOrder: manufacturingOrderIngredientConstraints.sortOrder,
    })
    .from(manufacturingOrderIngredientConstraints)
    .where(
      inArray(
        manufacturingOrderIngredientConstraints.manufacturingOrderIngredientId,
        uniqueIds
      )
    )
    .orderBy(
      asc(manufacturingOrderIngredientConstraints.sortOrder),
      asc(manufacturingOrderIngredientConstraints.createdAt)
    );

  const result = new Map<string, BomComponentConstraint[]>();
  for (const row of rows) {
    const bucket = result.get(row.manufacturingOrderIngredientId) ?? [];
    bucket.push({
      constraintType: row.constraintType as BomComponentConstraint["constraintType"],
      config: row.config,
      sortOrder: row.sortOrder,
    });
    result.set(row.manufacturingOrderIngredientId, bucket);
  }

  return result;
}

async function getLotAgeAvailabilityInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    minimumLotAgeDays: number;
    requiredDate: string;
    reservationCredit?: number;
  }
) {
  const cutoffReceivedDate = subtractDays(
    params.requiredDate,
    params.minimumLotAgeDays
  );
  const [balance] = await tx
    .select({
      committedQty: trimScale(inventoryItemBalances.committedQty).as("committedQty"),
    })
    .from(inventoryItemBalances)
    .where(
      and(
        eq(inventoryItemBalances.organizationId, params.organizationId),
        eq(inventoryItemBalances.locationId, params.locationId),
        eq(inventoryItemBalances.itemId, params.itemId)
      )
    );
  const rows = await tx
    .select({
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));

  let eligible = 0;
  let ineligible = 0;
  let nextEligibleDate: string | null = null;

  for (const row of rows) {
    const quantity = parseFloat(row.quantity);
    const receivedDate = isoDate(row.receivedAt);
    const eligibleDate = addDays(receivedDate, params.minimumLotAgeDays);
    if (receivedDate <= cutoffReceivedDate) {
      eligible += quantity;
      continue;
    }

    ineligible += quantity;
    if (nextEligibleDate == null || eligibleDate < nextEligibleDate) {
      nextEligibleDate = eligibleDate;
    }
  }

  const committedQty = Math.max(
    0,
    parseFloat(balance?.committedQty ?? "0") - (params.reservationCredit ?? 0)
  );

  return {
    eligible: normalizeQuantityNumber(Math.max(0, eligible - committedQty)),
    ineligible: normalizeQuantityNumber(ineligible),
    nextEligibleDate,
  };
}

async function getTemplateIngredientsInTx(tx: Tx, orderId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
        "quantityPerUnit"
      ),
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
        "actualCostTotal"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, orderId),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    )
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const constraintsById = await getIngredientConstraintsByIdInTx(
    tx,
    rows.map((row) => row.id)
  );

  return rows.map((row) => ({
    ...row,
    pickStatus: row.pickStatus as ManufacturingPickStatus,
    constraints: constraintsById.get(row.id) ?? [],
  }));
}

async function getBatchIngredientsInTx(tx: Tx, batchId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
        "quantityPerUnit"
      ),
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
        "actualCostTotal"
      ),
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderBatchId, batchId))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const constraintsById = await getIngredientConstraintsByIdInTx(
    tx,
    rows.map((row) => row.id)
  );

  return rows.map((row) => ({
    ...row,
    pickStatus: row.pickStatus as ManufacturingPickStatus,
    constraints: constraintsById.get(row.id) ?? [],
  }));
}

async function getManufacturingIngredientReservationRowsForBatchesInTx(
  tx: Tx,
  manufacturingOrderId: string,
  batchIds: string[]
) {
  if (batchIds.length === 0) {
    return [];
  }

  return tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      pickedQuantity: manufacturingOrderIngredients.pickedQuantity,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId),
        inArray(manufacturingOrderIngredients.manufacturingOrderBatchId, batchIds)
      )
    );
}

async function getBatchRowsInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      status: manufacturingOrderBatches.status,
      plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
        "plannedQuantity"
      ),
      actualQuantity: trimScaleNullable(manufacturingOrderBatches.actualQuantity).as(
        "actualQuantity"
      ),
      startedAt: manufacturingOrderBatches.startedAt,
      pickedAt: manufacturingOrderBatches.pickedAt,
      completedAt: manufacturingOrderBatches.completedAt,
      lotId: manufacturingOrderBatches.lotId,
      lotNumber: lots.lotNumber,
      costPerUnit: projectedLotUnitCost(lots.organizationId, lots.id).as("costPerUnit"),
    })
    .from(manufacturingOrderBatches)
    .leftJoin(lots, eq(manufacturingOrderBatches.lotId, lots.id))
    .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderBatches.batchNumber)) as Promise<ExecutionBatchRow[]>;
}

async function getLockedBatchStateRowsInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      status: manufacturingOrderBatches.status,
      pickedAt: manufacturingOrderBatches.pickedAt,
    })
    .from(manufacturingOrderBatches)
    .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderBatches.batchNumber))
    .for("update") as Promise<LockedBatchStateRow[]>;
}

async function ensureBatchExecutionRowsInTx(
  tx: Tx,
  order: LockedManufacturingOrder
): Promise<ExecutionBatchRow[]> {
  if (order.manufacturingMode !== "batch" || order.status === "draft") {
    return [];
  }

  const existingBatches = await getBatchRowsInTx(tx, order.id);
  if (existingBatches.length > 0) {
    return existingBatches;
  }

  if (order.numberOfBatches == null || order.expectedBatchYield == null) {
    throw new ManufacturingError("Batch orders require batch planning metadata", 400);
  }

  const templateIngredients = await getTemplateIngredientsInTx(tx, order.id);
  if (templateIngredients.length === 0) {
    return [];
  }

  const insertedBatches = await tx
    .insert(manufacturingOrderBatches)
    .values(
      Array.from({ length: order.numberOfBatches }, (_, index) => ({
        manufacturingOrderId: order.id,
        batchNumber: index + 1,
        plannedQuantity: order.expectedBatchYield!,
      }))
    )
    .returning({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
        "plannedQuantity"
      ),
    });

  const batchIngredientInputs = insertedBatches.flatMap((batch) =>
    templateIngredients.map((ingredient) => ({
      constraints: ingredient.constraints,
      values: {
        manufacturingOrderId: order.id,
        manufacturingOrderBatchId: batch.id,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        itemSku: ingredient.itemSku,
        itemType: ingredient.itemType,
        unitName: ingredient.unitName,
        quantityPerUnit: ingredient.quantityPerUnit,
        plannedQuantity: ingredient.quantityPerUnit,
        sortOrder: ingredient.sortOrder,
      },
    }))
  );

  const insertedIngredients = await tx
    .insert(manufacturingOrderIngredients)
    .values(batchIngredientInputs.map((entry) => entry.values))
    .returning({
      id: manufacturingOrderIngredients.id,
      manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
      itemId: manufacturingOrderIngredients.itemId,
      sortOrder: manufacturingOrderIngredients.sortOrder,
    });

  const constraintRows = insertedIngredients.flatMap((ingredient) =>
    (batchIngredientInputs.find(
      (input) =>
        input.values.manufacturingOrderBatchId ===
          ingredient.manufacturingOrderBatchId &&
        input.values.itemId === ingredient.itemId &&
        input.values.sortOrder === ingredient.sortOrder
    )?.constraints ?? []).map((constraint) => ({
      manufacturingOrderIngredientId: ingredient.id,
      constraintType: constraint.constraintType,
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    }))
  );

  if (constraintRows.length > 0) {
    await tx.insert(manufacturingOrderIngredientConstraints).values(constraintRows);
  }

  await tx
    .delete(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, order.id),
        sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
      )
    );

  return getBatchRowsInTx(tx, order.id);
}

async function getPickAllocationTotalsInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, { quantity: number; cost: number }>();
  }

  const rows = await tx
    .select({
      manufacturingOrderIngredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      quantityUsed: trimScale(manufacturingPickAllocations.quantityUsed).as("quantityUsed"),
      costPerUnit: trimScaleNullable(manufacturingPickAllocations.costPerUnit).as(
        "costPerUnit"
      ),
    })
    .from(manufacturingPickAllocations)
    .where(
      inArray(manufacturingPickAllocations.manufacturingOrderIngredientId, uniqueIds)
    );

  const totals = new Map<string, { quantity: number; cost: number }>();

  for (const row of rows) {
    const current = totals.get(row.manufacturingOrderIngredientId) ?? {
      quantity: 0,
      cost: 0,
    };
    const quantity = parseFloat(row.quantityUsed);
    const costPerUnit = row.costPerUnit != null ? parseFloat(row.costPerUnit) : 0;
    current.quantity += quantity;
    current.cost += quantity * costPerUnit;
    totals.set(row.manufacturingOrderIngredientId, current);
  }

  return totals;
}

async function getOutputQuantityInTx(
  tx: Tx,
  params: {
    manufacturingOrderId: string;
    manufacturingOrderBatchId?: string | null;
  }
) {
  const [row] = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, params.manufacturingOrderId),
        params.manufacturingOrderBatchId
          ? eq(manufacturingOrderOutputs.manufacturingOrderBatchId, params.manufacturingOrderBatchId)
          : sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NULL`
      )
    );

  return parseFloat(row?.quantity ?? "0");
}

async function getProducedLotIdInTx(tx: Tx, manufacturingOrderId: string) {
  const [row] = await tx
    .select({ lotId: manufacturingOrderOutputs.lotId })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId))
    .orderBy(asc(manufacturingOrderOutputs.outputNumber))
    .limit(1)
    .for("update");

  return row?.lotId ?? null;
}

async function getConsumedQuantityByIngredientInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await tx
    .select({
      ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputConsumptions.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderOutputConsumptions)
    .where(
      inArray(manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId, uniqueIds)
    )
    .groupBy(manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId);

  return new Map(rows.map((row) => [row.ingredientId, parseFloat(row.quantity)]));
}

async function getPickAllocationsByIngredientInTx(tx: Tx, ingredientIds: string[]) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) {
    return new Map<
      string,
      Array<{ lotId: string; quantityUsed: string; costPerUnit: string | null }>
    >();
  }

  const rows = await tx
    .select({
      manufacturingOrderIngredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      lotId: manufacturingPickAllocations.lotId,
      quantityUsed: trimScale(manufacturingPickAllocations.quantityUsed).as("quantityUsed"),
      costPerUnit: trimScaleNullable(manufacturingPickAllocations.costPerUnit).as(
        "costPerUnit"
      ),
    })
    .from(manufacturingPickAllocations)
    .where(
      inArray(manufacturingPickAllocations.manufacturingOrderIngredientId, uniqueIds)
    )
    .orderBy(asc(manufacturingPickAllocations.createdAt), asc(manufacturingPickAllocations.id));

  const allocations = new Map<
    string,
    Array<{ lotId: string; quantityUsed: string; costPerUnit: string | null }>
  >();

  for (const row of rows) {
    const ingredientAllocations = allocations.get(row.manufacturingOrderIngredientId) ?? [];
    ingredientAllocations.push({
      lotId: row.lotId,
      quantityUsed: row.quantityUsed,
      costPerUnit: row.costPerUnit,
    });
    allocations.set(row.manufacturingOrderIngredientId, ingredientAllocations);
  }

  return allocations;
}

async function nextOutputNumberInTx(tx: Tx, manufacturingOrderId: string) {
  const [row] = await tx
    .select({
      value: sql<number>`COALESCE(MAX(${manufacturingOrderOutputs.outputNumber}), 0)::int`,
    })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId));

  return Number(row?.value ?? 0) + 1;
}

async function reverseManufacturingOutputInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    manufacturingOrderBatchId: string | null;
    productId: string;
    quantity: number;
    actorUserId: string | null;
    idempotencyKey?: string | null;
    notes?: string | null;
  }
) {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const existingOutputQuantity = await getOutputQuantityInTx(tx, {
    manufacturingOrderId: params.manufacturingOrderId,
    manufacturingOrderBatchId: params.manufacturingOrderBatchId,
  });

  if (params.quantity > existingOutputQuantity) {
    throw new ManufacturingError("Output cannot be reduced below zero.", 400);
  }

  const outputRows = await tx
    .select({
      id: manufacturingOrderOutputs.id,
      lotId: manufacturingOrderOutputs.lotId,
      quantity: trimScale(manufacturingOrderOutputs.quantity).as("quantity"),
      disposition: manufacturingOrderOutputs.disposition,
      unitCost: trimScale(manufacturingOrderOutputs.unitCost).as("unitCost"),
      materialCostTotal: trimScale(manufacturingOrderOutputs.materialCostTotal).as(
        "materialCostTotal"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, params.manufacturingOrderId),
        params.manufacturingOrderBatchId
          ? eq(manufacturingOrderOutputs.manufacturingOrderBatchId, params.manufacturingOrderBatchId)
          : sql`${manufacturingOrderOutputs.manufacturingOrderBatchId} IS NULL`,
        sql`${manufacturingOrderOutputs.quantity} > 0`
      )
    )
    .orderBy(desc(manufacturingOrderOutputs.outputNumber))
    .for("update");

  let remaining = params.quantity;
  let reversedMaterialCostTotal = 0;
  let reversalDisposition: Extract<InventoryDisposition, "available" | "blocked"> = "available";
  const reversedConsumptions = new Map<
    string,
    { quantity: number; cost: number; rows: Array<{ outputId: string; lotId: string; quantity: number; costPerUnit: number }> }
  >();
  const outputConsumptionRows: Array<{
    manufacturingOrderIngredientId: string;
    lotId: string;
    quantityUsed: string;
    costPerUnit: string;
  }> = [];

  for (const output of outputRows) {
    if (remaining <= 0) break;

    const outputQuantity = parseFloat(output.quantity);
    const reversedQuantity = normalizeQuantityNumber(Math.min(remaining, outputQuantity));
    if (reversedQuantity <= 0) continue;

    reversalDisposition = output.disposition as Extract<
      InventoryDisposition,
      "available" | "blocked"
    >;
    const ratio = reversedQuantity / outputQuantity;
    const outputUnitCost = parseFloat(output.unitCost);
    reversedMaterialCostTotal += reversedQuantity * outputUnitCost;

    await decrementExistingLotStockInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      itemId: params.productId,
      lotId: output.lotId,
      quantity: reversedQuantity,
      unitCost: output.unitCost,
      eventType: "manual_adjustment_decrease",
      eventSubtype: "manufacturing_output_reversal",
      referenceType: "manufacturing_order",
      referenceId: params.manufacturingOrderId,
      actorUserId: params.actorUserId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        params.idempotencyKey,
        `reverse-output:${output.id}`
      ),
      disposition: output.disposition as Extract<InventoryDisposition, "available" | "blocked">,
      metadata: { manufacturingOrderOutputId: output.id },
    });

    const consumptions = await tx
      .select({
        ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
        lotId: manufacturingOrderOutputConsumptions.lotId,
        quantityUsed: trimScale(manufacturingOrderOutputConsumptions.quantityUsed).as(
          "quantityUsed"
        ),
        costPerUnit: trimScale(manufacturingOrderOutputConsumptions.costPerUnit).as(
          "costPerUnit"
        ),
      })
      .from(manufacturingOrderOutputConsumptions)
      .where(eq(manufacturingOrderOutputConsumptions.manufacturingOrderOutputId, output.id));

    for (const consumption of consumptions) {
      const quantity = normalizeQuantityNumber(parseFloat(consumption.quantityUsed) * ratio);
      if (quantity <= 0) continue;
      const costPerUnit = parseFloat(consumption.costPerUnit);
      const current = reversedConsumptions.get(consumption.ingredientId) ?? {
        quantity: 0,
        cost: 0,
        rows: [],
      };
      current.quantity = normalizeQuantityNumber(current.quantity + quantity);
      current.cost += quantity * costPerUnit;
      current.rows.push({ outputId: output.id, lotId: consumption.lotId, quantity, costPerUnit });
      reversedConsumptions.set(consumption.ingredientId, current);
      outputConsumptionRows.push({
        manufacturingOrderIngredientId: consumption.ingredientId,
        lotId: consumption.lotId,
        quantityUsed: normalizeNumeric(-quantity),
        costPerUnit: normalizeNumericScale(costPerUnit, 6),
      });
    }

    remaining = normalizeQuantityNumber(remaining - reversedQuantity);
  }

  if (remaining > 0) {
    throw new ManufacturingError("Output cannot be reduced below zero.", 400);
  }

  for (const [ingredientId, reversed] of reversedConsumptions) {
    const [ingredient] = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
        actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
          "actualQuantity"
        ),
        actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
          "actualCostTotal"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, ingredientId))
      .for("update");

    if (!ingredient) continue;

    for (const row of reversed.rows) {
      await restockExistingLotInTx(tx, {
        organizationId: params.organizationId,
        locationId: location.id,
        itemId: ingredient.itemId,
        lotId: row.lotId,
        quantity: row.quantity,
        unitCost: normalizeNumericScale(row.costPerUnit, 6),
        eventType: "manufacturing_variance_gain",
        eventSubtype: "manufacturing_output_reversal",
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        actorUserId: params.actorUserId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          params.idempotencyKey,
          `reverse-consume:${row.outputId}:${ingredientId}:${row.lotId}`
        ),
        metadata: { manufacturingOrderIngredientId: ingredientId },
      });
    }

    const nextActualQuantity = Math.max(
      0,
      parseFloat(ingredient.actualQuantity ?? "0") - reversed.quantity
    );
    const nextPickedQuantity = Math.max(
      0,
      parseFloat(ingredient.pickedQuantity) - reversed.quantity
    );
    const plannedQuantity = parseFloat(ingredient.plannedQuantity);
    await tx
      .update(manufacturingOrderIngredients)
      .set({
        actualQuantity: normalizeNumeric(nextActualQuantity),
        actualCostTotal: normalizeNumeric(
          Math.max(0, parseFloat(ingredient.actualCostTotal ?? "0") - reversed.cost)
        ),
        pickedQuantity: normalizeNumeric(nextPickedQuantity),
        pickStatus:
          nextPickedQuantity <= 0
            ? "not_started"
            : nextPickedQuantity >= plannedQuantity
              ? "picked"
              : "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderIngredients.id, ingredientId));

    await applyDemandReferenceDeltasInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      actorUserId: params.actorUserId,
      eventSubtype: "manufacturing_output_reversal",
      deltas: [
        {
          itemId: ingredient.itemId,
          referenceType: "manufacturing_order_ingredient",
          referenceId: ingredientId,
          quantity: reversed.quantity,
        },
      ],
    });
    await applyReservationReferenceDeltasInTx(tx, {
      organizationId: params.organizationId,
      locationId: location.id,
      actorUserId: params.actorUserId,
      eventSubtype: "manufacturing_output_reversal",
      deltas: [
        {
          itemId: ingredient.itemId,
          referenceType: "manufacturing_order_ingredient",
          referenceId: ingredientId,
          quantity: reversed.quantity,
        },
      ],
    });
  }

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId,
    eventSubtype: "manufacturing_output_reversal",
    deltas: [
      {
        itemId: params.productId,
        referenceType: "manufacturing_order",
        referenceId: params.manufacturingOrderId,
        quantity: params.quantity,
      },
    ],
  });

  const lotId = await getProducedLotIdInTx(tx, params.manufacturingOrderId);
  if (!lotId) {
    throw new ManufacturingError("Produced lot not found.", 400);
  }

  const [output] = await tx
    .insert(manufacturingOrderOutputs)
    .values({
      manufacturingOrderId: params.manufacturingOrderId,
      manufacturingOrderBatchId: params.manufacturingOrderBatchId,
      lotId,
      outputNumber: await nextOutputNumberInTx(tx, params.manufacturingOrderId),
      quantity: normalizeNumeric(-params.quantity),
      disposition: reversalDisposition,
      unitCost:
        params.quantity > 0
          ? normalizeNumericScale(reversedMaterialCostTotal / params.quantity, 6)
          : "0",
      materialCostTotal: normalizeNumericScale(-reversedMaterialCostTotal, 6),
      notes: params.notes,
      createdBy: params.actorUserId ?? "system",
    })
    .returning({ id: manufacturingOrderOutputs.id });

  if (outputConsumptionRows.length > 0) {
    await tx.insert(manufacturingOrderOutputConsumptions).values(
      outputConsumptionRows.map((row) => ({
        manufacturingOrderOutputId: output.id,
        ...row,
      }))
    );
  }
}

async function releaseRemainingExpectedOutputInTx(
  tx: Tx,
  params: {
    organizationId: string;
    manufacturingOrderId: string;
    actorUserId?: string | null;
    quantity?: number | null;
  }
) {
  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  const expectedRows = await tx
    .select({
      itemId: inventoryExpectedSummary.itemId,
      quantity: inventoryExpectedSummary.quantity,
    })
    .from(inventoryExpectedSummary)
    .where(
      and(
        eq(inventoryExpectedSummary.organizationId, params.organizationId),
        eq(inventoryExpectedSummary.locationId, location.id),
        eq(inventoryExpectedSummary.referenceType, "manufacturing_order"),
        eq(inventoryExpectedSummary.referenceId, params.manufacturingOrderId)
      )
    );

  await applyExpectedReferenceDeltasInTx(tx, {
    organizationId: params.organizationId,
    locationId: location.id,
    actorUserId: params.actorUserId ?? null,
    eventSubtype: "completed",
    deltas: expectedRows
      .map((row) => {
        const currentOpenQty = parseFloat(row.quantity);
        const releaseQty =
          params.quantity == null ? currentOpenQty : Math.min(currentOpenQty, params.quantity);
        return releaseQty > 0
          ? {
              itemId: row.itemId,
              referenceType: "manufacturing_order",
              referenceId: params.manufacturingOrderId,
              quantity: -releaseQty,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row != null),
  });
}

function toIngredientDetail(ingredient: ExecutionIngredientRow): ManufacturingOrderIngredientDetail {
  return {
    ...ingredient,
    remainingQuantity: getRemainingQuantityString(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    ),
    defaultItemId: null,
    defaultItemName: null,
    defaultItemSku: null,
    defaultUnitName: null,
    defaultQuantityPerUnit: null,
    alternates: [],
  };
}

function aggregateBatchIngredients(
  rows: ExecutionIngredientRow[]
): ManufacturingOrderIngredientDetail[] {
  const ingredientMap = new Map<string, ManufacturingOrderIngredientDetail>();

  for (const row of rows) {
    const existing = ingredientMap.get(row.itemId);
    if (!existing) {
      ingredientMap.set(row.itemId, {
        id: row.id,
        itemId: row.itemId,
        itemName: row.itemName,
        itemSku: row.itemSku,
        itemType: row.itemType,
        unitName: row.unitName,
        quantityPerUnit: row.quantityPerUnit,
        plannedQuantity: row.plannedQuantity,
        pickedQuantity: row.pickedQuantity,
        remainingQuantity: getRemainingQuantityString(
          row.plannedQuantity,
          row.pickedQuantity
        ),
        pickStatus: row.pickStatus,
        actualQuantity: row.actualQuantity,
        actualCostTotal: row.actualCostTotal,
        sortOrder: row.sortOrder,
        constraints: row.constraints,
        defaultItemId: null,
        defaultItemName: null,
        defaultItemSku: null,
        defaultUnitName: null,
        defaultQuantityPerUnit: null,
        alternates: [],
      });
      continue;
    }

    const plannedQuantity = sumNumericStrings([existing.plannedQuantity, row.plannedQuantity]);
    const pickedQuantity = sumNumericStrings([existing.pickedQuantity, row.pickedQuantity]);
    const actualQuantity = sumNumericStrings([existing.actualQuantity, row.actualQuantity]);
    const actualCostTotal = sumNumericStrings([existing.actualCostTotal, row.actualCostTotal]);

    existing.plannedQuantity = normalizeNumeric(plannedQuantity);
    existing.pickedQuantity = normalizeNumeric(pickedQuantity);
    existing.remainingQuantity = getRemainingQuantityString(
      existing.plannedQuantity,
      existing.pickedQuantity
    );
    existing.pickStatus = getPickProgressStatus([
      {
        plannedQuantity: existing.plannedQuantity,
        pickedQuantity: existing.pickedQuantity,
      },
    ]) === "picked"
      ? "picked"
      : pickedQuantity > 0
        ? "in_progress"
        : "not_picked";
    existing.actualQuantity = actualQuantity > 0 ? normalizeNumeric(actualQuantity) : null;
    existing.actualCostTotal =
      actualCostTotal > 0 ? normalizeNumeric(actualCostTotal) : null;
    existing.sortOrder = Math.min(existing.sortOrder, row.sortOrder);
  }

  return [...ingredientMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function getBatchPickProgressStatus(
  batches: Array<Pick<ExecutionBatchRow, "status">>
): ManufacturingPickProgressStatus {
  if (batches.length === 0) {
    return "not_started";
  }

  const completedCount = batches.filter((batch) => batch.status === "completed").length;
  if (completedCount === batches.length) {
    return "picked";
  }

  if (completedCount > 0 || batches.some((batch) => batch.status === "in_progress")) {
    return "in_progress";
  }

  return "not_started";
}

export async function getManufacturingOrders(): Promise<ManufacturingOrderListRow[]> {
  return measureObservedOperation(
    "manufacturing.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const masterItems = alias(items, "master_items");
        const orders = (await tx
          .select({
            id: manufacturingOrders.id,
            orderNumber: manufacturingOrders.orderNumber,
            productName: manufacturingOrders.productName,
            productSku: manufacturingOrders.productSku,
            variantAttrs: items.variantAttrs,
            masterName: masterItems.name,
            masterVariantAxes: masterItems.variantAxes,
            salesOrderNumber: manufacturingOrders.salesOrderNumber,
            salesCustomerName: manufacturingOrders.salesCustomerName,
            priorityRank: manufacturingOrders.priorityRank,
            requestedQuantity: trimScale(manufacturingOrders.requestedQuantity).as(
              "requestedQuantity"
            ),
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
              "plannedQuantity"
            ),
            actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
              "actualQuantity"
            ),
            unitName: manufacturingOrders.unitName,
            plannedDate: manufacturingOrders.plannedDate,
            status: manufacturingOrders.status,
            manufacturingMode: manufacturingOrders.manufacturingMode,
            numberOfBatches: manufacturingOrders.numberOfBatches,
            deletedAt: manufacturingOrders.deletedAt,
            createdAt: manufacturingOrders.createdAt,
            updatedAt: manufacturingOrders.updatedAt,
            completedAt: manufacturingOrders.completedAt,
          })
          .from(manufacturingOrders)
          .leftJoin(items, eq(manufacturingOrders.productId, items.id))
          .leftJoin(masterItems, eq(items.parentId, masterItems.id))
          .where(isNull(manufacturingOrders.deletedAt))
          .orderBy(
            sql`${manufacturingOrders.priorityRank} IS NULL`,
            asc(manufacturingOrders.priorityRank),
            asc(manufacturingOrders.plannedDate),
            asc(manufacturingOrders.orderNumber),
            asc(manufacturingOrders.id)
          )) as Array<
          Omit<
            ManufacturingOrderListRow,
            | "productMasterName"
            | "productAttrs"
            | "pickProgressStatus"
            | "pickProgressPercent"
            | "completedBatchCount"
            | "actionableBatchCount"
          > & {
            variantAttrs: Record<string, string> | null;
            masterName: string | null;
            masterVariantAxes: string[] | null;
          }
        >;

        if (orders.length === 0) {
          return [];
        }

        const orderIds = orders.map((order) => order.id);
        const ingredientRows = await tx
          .select({
            manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
            manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
            plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
              "plannedQuantity"
            ),
            pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
              "pickedQuantity"
            ),
          })
          .from(manufacturingOrderIngredients)
          .where(inArray(manufacturingOrderIngredients.manufacturingOrderId, orderIds));

        const batchRows = await tx
          .select({
            manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
            status: manufacturingOrderBatches.status,
          })
          .from(manufacturingOrderBatches)
          .where(inArray(manufacturingOrderBatches.manufacturingOrderId, orderIds));

        const ingredientsByOrder = new Map<string, IngredientProgressRow[]>();
        for (const row of ingredientRows) {
          if (row.manufacturingOrderBatchId != null) {
            continue;
          }
          const existing = ingredientsByOrder.get(row.manufacturingOrderId) ?? [];
          existing.push({
            plannedQuantity: row.plannedQuantity,
            pickedQuantity: row.pickedQuantity,
          });
          ingredientsByOrder.set(row.manufacturingOrderId, existing);
        }

        const batchesByOrder = new Map<string, Array<{ status: ManufacturingBatchStatus }>>();
        for (const row of batchRows) {
          const existing = batchesByOrder.get(row.manufacturingOrderId) ?? [];
          existing.push({ status: row.status as ManufacturingBatchStatus });
          batchesByOrder.set(row.manufacturingOrderId, existing);
        }

        return orders.map(({ variantAttrs, masterName, masterVariantAxes, ...order }) => {
          const batches = batchesByOrder.get(order.id) ?? [];
          const ingredientProgressRows = ingredientsByOrder.get(order.id) ?? [];
          const pickProgressStatus =
            order.manufacturingMode === "batch" && batches.length > 0
              ? getBatchPickProgressStatus(batches)
              : getPickProgressStatus(ingredientProgressRows);
          const completedBatchCount = batches.filter(
            (batch) => batch.status === "completed"
          ).length;
          const totalBatchCount = order.numberOfBatches ?? batches.length;
          const display = resolveVariantDisplay(
            order.productName,
            masterName == null ? null : { name: masterName, variantAxes: masterVariantAxes },
            variantAttrs
          );

          return {
            ...order,
            productMasterName: display.masterName,
            productAttrs: display.attrs,
            pickProgressStatus,
            pickProgressPercent:
              order.manufacturingMode === "batch" && totalBatchCount > 0
                ? Math.min(100, Math.round((completedBatchCount / totalBatchCount) * 100))
                : getPickProgressPercent(ingredientProgressRows),
            completedBatchCount,
            actionableBatchCount: batches.filter((batch) => batch.status !== "completed").length,
          };
        });
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    }
  );
}

export async function getManufacturingExecutionQueue(): Promise<
  ManufacturingExecutionQueueRow[]
> {
  const orders = await getManufacturingOrders();
  const batchOrderIds = orders
    .filter(
      (order) =>
        order.status === "released" &&
        order.manufacturingMode === "batch" &&
        (order.numberOfBatches ?? 0) > 0
    )
    .map((order) => order.id);
  const nextBatchIdByOrderId = new Map<string, string>();

  if (batchOrderIds.length > 0) {
    const batchRows = await withAuthedOrgContext((tx) =>
      tx
        .select({
          id: manufacturingOrderBatches.id,
          manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
          status: manufacturingOrderBatches.status,
          batchNumber: manufacturingOrderBatches.batchNumber,
        })
        .from(manufacturingOrderBatches)
        .where(inArray(manufacturingOrderBatches.manufacturingOrderId, batchOrderIds))
        .orderBy(
          asc(manufacturingOrderBatches.manufacturingOrderId),
          asc(manufacturingOrderBatches.batchNumber)
        )
    );

    for (const batch of batchRows) {
      if (batch.status === "completed" || nextBatchIdByOrderId.has(batch.manufacturingOrderId)) {
        continue;
      }

      nextBatchIdByOrderId.set(batch.manufacturingOrderId, batch.id);
    }
  }

  return orders
    .filter((order) => order.status === "released")
    .map((order) => {
      const totalBatchCount = order.numberOfBatches ?? 0;
      const nextBatchNumber =
        order.manufacturingMode === "batch" && totalBatchCount > 0
          ? Math.min(order.completedBatchCount + 1, totalBatchCount)
          : null;
      const nextBatchId =
        order.manufacturingMode === "batch"
          ? nextBatchIdByOrderId.get(order.id) ?? null
          : null;

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        productName: order.productName,
        productSku: order.productSku,
        priorityRank: order.priorityRank,
        plannedQuantity: order.plannedQuantity,
        actualQuantity: order.actualQuantity,
        unitName: order.unitName,
        plannedDate: order.plannedDate,
        manufacturingMode: order.manufacturingMode,
        pickProgressStatus: order.pickProgressStatus,
        nextBatchId,
        nextBatchNumber,
        completedBatchCount: order.completedBatchCount,
        totalBatchCount,
        actionLabel:
          order.manufacturingMode === "batch"
            ? nextBatchNumber == null
              ? "Continue"
              : `Batch ${nextBatchNumber}`
            : order.pickProgressStatus === "picked"
              ? "Complete"
              : "Pick",
      };
    });
}

export async function getManufacturingProductTemplates(): Promise<
  Array<
    ManufacturingProductOption & {
      bom: Array<{
        itemId: string;
        itemName: string;
        itemSku: string | null;
        itemType: string;
        unitName: string;
        quantityPerUnit: string;
        defaultQuantityPerUnit: string;
        alternates: Array<{
          itemId: string;
          itemName: string;
          itemSku: string | null;
          itemType: string;
          unitName: string;
          quantityFactor: string;
          sortOrder: number;
        }>;
      }>;
    }
  >
> {
  return withAuthedOrgContext(async (tx) => {
    const products = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        unitName: unitDefinitions.name,
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.itemType, "product"), isNull(items.deletedAt), eq(items.isMaster, false)))
      .orderBy(items.name);

    if (products.length === 0) return [];

    const bomByProduct = await getCurrentBomCoverageInTx(
      tx,
      products.map((product) => product.id)
    );

    return products
      .filter((product) => (bomByProduct.get(product.id) ?? []).length > 0)
      .map((product) => ({
        ...product,
        bom: (bomByProduct.get(product.id) ?? []).map((row) => ({
          itemId: row.componentId,
          itemName: row.componentName,
          itemSku: row.componentSku,
          itemType: row.componentItemType,
          unitName: row.unitName,
          quantityPerUnit: row.quantity ?? "0",
          defaultQuantityPerUnit: row.quantity ?? "0",
          alternates: row.alternates.map((alternate) => ({
            itemId: alternate.alternateItemId,
            itemName: alternate.alternateItemName,
            itemSku: alternate.alternateItemSku,
            itemType: alternate.alternateItemType,
            unitName: alternate.unitName,
            quantityFactor: alternate.quantityFactor,
            sortOrder: alternate.sortOrder,
          })),
        })),
      }));
  });
}

export async function getManufacturingSalesOrderOptions(): Promise<
  ManufacturingSalesOrderOption[]
> {
  return withAuthedOrgContext(async (tx) => {
    const orders = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        createdAt: salesOrders.createdAt,
      })
      .from(salesOrders)
      .where(
        and(
          isNull(salesOrders.deletedAt),
          inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"])
        )
      )
      .orderBy(desc(salesOrders.createdAt));

    if (orders.length === 0) {
      return [];
    }

    const summaries = await getSalesOrderManufacturingSummariesInTx(
      tx,
      orders.map((order) => order.id)
    );

    return orders.map((order) => {
      const summary = summaries.get(order.id);

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        shipDate: order.shipDate,
        requestedDate: order.requestedDate,
        manufacturableLineCount: summary?.manufacturableLineCount ?? 0,
        hasManufacturableLines: summary?.hasManufacturableLines ?? false,
        disabledReason:
          summary?.disabledReason ?? "No manufacturable lines remain on this order.",
      };
    });
  });
}

export async function getManufacturingSalesOrderPreview(
  id: string
): Promise<ManufacturingSalesOrderPreview | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"])
        )
      );

    if (!order) {
      return null;
    }

    const summary = (
      await getSalesOrderManufacturingSummariesInTx(tx, [id])
    ).get(id);

    return {
      salesOrderId: order.id,
      salesOrderNumber: order.orderNumber,
      customerName: order.customerName,
      shipDate: order.shipDate,
      requestedDate: order.requestedDate,
      manufacturableLineCount: summary?.manufacturableLineCount ?? 0,
      hasManufacturableLines: summary?.hasManufacturableLines ?? false,
      disabledReason:
        summary?.disabledReason ?? "No manufacturable lines remain on this order.",
      lines: summary?.lines ?? [],
    };
  });
}

export async function getManufacturingSalesLineOptions(
  productId?: string
): Promise<ManufacturingSalesLineOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [
      isNull(salesOrders.deletedAt),
      inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"]),
    ];

    if (productId) {
      conditions.push(eq(salesOrderLines.itemId, productId));
    }

    return tx
      .select({
        salesOrderId: salesOrders.id,
        salesOrderLineId: salesOrderLines.id,
        salesOrderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        unitName: salesOrderLines.unitName,
        status: salesOrders.status,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(and(...conditions))
      .orderBy(desc(salesOrders.createdAt), asc(salesOrderLines.sortOrder)) as Promise<
        ManufacturingSalesLineOption[]
      >;
  });
}

export async function getManufacturingOrder(
  id: string
): Promise<ManufacturingOrderDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productId: manufacturingOrders.productId,
        bomRevisionId: manufacturingOrders.bomRevisionId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        unitName: manufacturingOrders.unitName,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        status: manufacturingOrders.status,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        requestedQuantity: trimScale(manufacturingOrders.requestedQuantity).as(
          "requestedQuantity"
        ),
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
          "actualQuantity"
        ),
        priorityRank: manufacturingOrders.priorityRank,
        plannedDate: manufacturingOrders.plannedDate,
        actualMaterialCost: trimScaleNullable(manufacturingOrders.actualMaterialCost).as(
          "actualMaterialCost"
        ),
        actualCostPerUnit: trimScaleNullable(manufacturingOrders.actualCostPerUnit).as(
          "actualCostPerUnit"
        ),
        notes: manufacturingOrders.notes,
        releasedAt: manufacturingOrders.releasedAt,
        completedAt: manufacturingOrders.completedAt,
        cancelledAt: manufacturingOrders.cancelledAt,
        deletedAt: manufacturingOrders.deletedAt,
        createdAt: manufacturingOrders.createdAt,
        updatedAt: manufacturingOrders.updatedAt,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)));

    if (!order) {
      return null;
    }

    const batches = await getBatchRowsInTx(tx, id);

    const rawIngredients =
      order.manufacturingMode === "batch" && order.status !== "draft"
        ? await tx
            .select({
              id: manufacturingOrderIngredients.id,
              manufacturingOrderBatchId:
                manufacturingOrderIngredients.manufacturingOrderBatchId,
              itemId: manufacturingOrderIngredients.itemId,
              itemName: manufacturingOrderIngredients.itemName,
              itemSku: manufacturingOrderIngredients.itemSku,
              itemType: manufacturingOrderIngredients.itemType,
              unitName: manufacturingOrderIngredients.unitName,
              quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
                "quantityPerUnit"
              ),
              plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
                "plannedQuantity"
              ),
              pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
                "pickedQuantity"
              ),
              pickStatus: manufacturingOrderIngredients.pickStatus,
              actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
                "actualQuantity"
              ),
              actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
                "actualCostTotal"
              ),
              sortOrder: manufacturingOrderIngredients.sortOrder,
            })
            .from(manufacturingOrderIngredients)
            .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
            .orderBy(asc(manufacturingOrderIngredients.sortOrder))
        : await getTemplateIngredientsInTx(tx, id);

    const batchRawIngredients =
      order.manufacturingMode === "batch" && order.status !== "draft"
        ? (rawIngredients as Omit<ExecutionIngredientRow, "constraints">[])
        : null;
    const batchIngredientsWithDetails =
      batchRawIngredients == null
        ? null
        : await (async () => {
            const ingredientIds = batchRawIngredients.map((ingredient) => ingredient.id);
            const constraintsById = await getIngredientConstraintsByIdInTx(
              tx,
              ingredientIds
            );

            return batchRawIngredients.map((ingredient) => ({
              ...ingredient,
              pickStatus: ingredient.pickStatus as ManufacturingPickStatus,
              constraints: constraintsById.get(ingredient.id) ?? [],
            }));
          })();

    const ingredients =
      batchIngredientsWithDetails != null
        ? aggregateBatchIngredients(batchIngredientsWithDetails)
        : (rawIngredients as ExecutionIngredientRow[]).map(toIngredientDetail);
    const detailIngredients =
      order.status === "draft" && order.bomRevisionId != null
        ? await (async () => {
            const bomRows = await getBomRevisionComponentsInTx(tx, order.bomRevisionId!);
            return ingredients.map((ingredient) => {
              const bomRow = bomRows.find((row) => row.sortOrder === ingredient.sortOrder);

              if (!bomRow) return ingredient;

              return {
                ...ingredient,
                defaultItemId: bomRow.componentId,
                defaultItemName: bomRow.componentName,
                defaultItemSku: bomRow.componentSku,
                defaultUnitName: bomRow.unitName,
                defaultQuantityPerUnit: bomRow.quantity,
                alternates: bomRow.alternates.map((alternate) => ({
                  itemId: alternate.alternateItemId,
                  itemName: alternate.alternateItemName,
                  itemSku: alternate.alternateItemSku,
                  itemType: alternate.alternateItemType,
                  unitName: alternate.unitName,
                  quantityFactor: alternate.quantityFactor,
                  sortOrder: alternate.sortOrder,
                })),
              };
            });
          })()
        : ingredients;

    const producedLots =
      batches.length > 0
        ? batches
            .filter((batch) => batch.lotId != null && batch.actualQuantity != null)
            .map((batch) => ({
              lotId: batch.lotId!,
              lotNumber: batch.lotNumber!,
              quantity: batch.actualQuantity!,
              costPerUnit: batch.costPerUnit,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
            }))
        : await tx
            .select({
              lotId: inventoryEvents.lotId,
              lotNumber: lots.lotNumber,
              quantity: trimScale(inventoryEvents.quantity).as("quantity"),
              costPerUnit: projectedLotUnitCost(lots.organizationId, lots.id).as("costPerUnit"),
            })
            .from(inventoryEvents)
            .innerJoin(lots, eq(inventoryEvents.lotId, lots.id))
            .where(
              and(
                eq(inventoryEvents.itemId, order.productId),
                eq(inventoryEvents.eventType, "manufacturing_output"),
                eq(inventoryEvents.referenceType, "manufacturing_order"),
                eq(inventoryEvents.referenceId, id)
              )
            )
            .orderBy(desc(inventoryEvents.occurredAt))
            .then((rows) =>
              rows.map((row) => ({
                lotId: row.lotId!,
                lotNumber: row.lotNumber,
                quantity: row.quantity,
                costPerUnit: row.costPerUnit,
                batchId: null,
                batchNumber: null,
              }))
            );

    return {
      ...order,
      status: order.status as ManufacturingOrderDetail["status"],
      pickProgressStatus:
        order.manufacturingMode === "batch" && batches.length > 0
          ? getBatchPickProgressStatus(batches)
          : getPickProgressStatus(
              ingredients.map((ingredient) => ({
                plannedQuantity: ingredient.plannedQuantity,
                pickedQuantity: ingredient.pickedQuantity,
              }))
            ),
      ingredients: detailIngredients,
      batches,
      producedLots,
    };
  });
}

export async function getManufacturingOrderEditData(
  id: string
): Promise<ManufacturingOrderEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        productId: manufacturingOrders.productId,
        bomRevisionId: manufacturingOrders.bomRevisionId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        unitName: manufacturingOrders.unitName,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        requestedQuantity: trimScale(manufacturingOrders.requestedQuantity).as(
          "requestedQuantity"
        ),
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        priorityRank: manufacturingOrders.priorityRank,
        plannedDate: manufacturingOrders.plannedDate,
        notes: manufacturingOrders.notes,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.id, id),
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "draft")
        )
      );

    if (!order) {
      return null;
    }

    const ingredients = await tx
      .select({
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
        itemSku: manufacturingOrderIngredients.itemSku,
        itemType: manufacturingOrderIngredients.itemType,
        unitName: manufacturingOrderIngredients.unitName,
        quantityPerUnit: trimScale(manufacturingOrderIngredients.quantityPerUnit).as(
          "quantityPerUnit"
        ),
        sortOrder: manufacturingOrderIngredients.sortOrder,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, id),
          sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
        )
      )
      .orderBy(asc(manufacturingOrderIngredients.sortOrder));

    const bomRows =
      order.bomRevisionId == null
        ? []
        : await getBomRevisionComponentsInTx(tx, order.bomRevisionId);

    const bomBySortOrder = new Map(bomRows.map((row) => [row.sortOrder, row]));

    return {
      ...order,
      ingredients: ingredients.map((ingredient) => {
        const bomRow = bomBySortOrder.get(ingredient.sortOrder);
        return {
          itemId: ingredient.itemId,
          itemName: ingredient.itemName,
          itemSku: ingredient.itemSku,
          itemType: ingredient.itemType,
          unitName: ingredient.unitName,
          quantityPerUnit: ingredient.quantityPerUnit,
          defaultItemId: bomRow?.componentId ?? ingredient.itemId,
          defaultItemName: bomRow?.componentName ?? ingredient.itemName,
          defaultItemSku: bomRow?.componentSku ?? ingredient.itemSku,
          defaultUnitName: bomRow?.unitName ?? ingredient.unitName,
          defaultQuantityPerUnit: bomRow?.quantity ?? ingredient.quantityPerUnit,
          alternates: (bomRow?.alternates ?? []).map((alternate) => ({
            itemId: alternate.alternateItemId,
            itemName: alternate.alternateItemName,
            itemSku: alternate.alternateItemSku,
            itemType: alternate.alternateItemType,
            unitName: alternate.unitName,
            quantityFactor: alternate.quantityFactor,
            sortOrder: alternate.sortOrder,
          })),
        };
      }),
    };
  });
}

export async function createManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  payload: InsertManufacturingOrder
): Promise<{ id: string }> {
  if (payload.salesOrderId != null || payload.salesOrderLineId != null) {
    throw new ManufacturingError(
      "Create sales-linked manufacturing orders from the sales order Create MOs flow.",
      400
    );
  }

  const product = await getValidatedProductInTx(tx, payload.productId);
  const { plannedQuantity, numberOfBatches, ingredientMultiplier } =
    computeBatchPlanning(product, Number(payload.plannedQuantity), {
      numberOfBatches: payload.numberOfBatches,
    });

  const salesLink = await validateSalesLineLinkInTx(tx, {
    salesOrderId: payload.salesOrderId,
    salesOrderLineId: payload.salesOrderLineId,
    productId: payload.productId,
  });
  const { bomRevisionId, ingredients } = await prepareCreateIngredientsInTx(
    tx,
    payload.productId,
    ingredientMultiplier,
    payload.ingredients
  );
  await assertPriorityRankAvailableInTx(tx, orgId, payload.priorityRank);

  const order = await insertManufacturingOrderInTx(tx, orgId, {
    product,
    bomRevisionId,
    salesLink,
    requestedQuantity: payload.plannedQuantity,
    plannedQuantity,
    numberOfBatches,
    priorityRank: payload.priorityRank,
    plannedDate: payload.plannedDate ?? null,
    notes: payload.notes ?? null,
    ingredients,
  });

  return { id: order.id };
}

export async function createManufacturingOrder(
  payload: InsertManufacturingOrder
): Promise<{ id: string }> {
  return withAuthedOrgContext((tx, orgId) =>
    createManufacturingOrderInTx(tx, orgId, payload)
  );
}

export async function duplicateManufacturingOrder(
  id: string
): Promise<{ id: string } | null> {
  const order = await getManufacturingOrder(id);

  if (!order) {
    return null;
  }

  return createManufacturingOrder({
    productId: order.productId,
    salesOrderId: null,
    salesOrderLineId: null,
    plannedQuantity: order.requestedQuantity,
    priorityRank: null,
    plannedDate: order.plannedDate,
    notes: order.notes,
    ingredients: order.ingredients.map((ingredient) => ({
      itemId: ingredient.itemId,
      quantityPerUnit: ingredient.quantityPerUnit,
    })),
    confirmShortage: false,
  });
}

export async function createManufacturingOrdersFromSalesOrderInTx(
  tx: Tx,
  orgId: string,
  salesOrderId: string,
  payload: CreateManufacturingOrdersFromSalesOrder
): Promise<ManufacturingOrdersFromSalesOrderResult> {
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

  if (!["draft", "confirmed", "partially_shipped"].includes(order.status)) {
    throw new ManufacturingError(
      "Only draft, confirmed, or partially shipped sales orders can create manufacturing orders",
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

  const plannedDate = payload.plannedDate ?? order.shipDate ?? order.requestedDate ?? null;
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
    const requestedQuantity = quantityByLineId.get(line.salesOrderLineId) ?? line.quantity;
    const { plannedQuantity, numberOfBatches, ingredientMultiplier } =
      computeBatchPlanning(product, Number(requestedQuantity));
    const { bomRevisionId, ingredients } = await prepareCreateIngredientsFromBomInTx(
      tx,
      line.itemId,
      ingredientMultiplier
    );
    const priorityRank =
      payload.priorityRank != null ? payload.priorityRank + created.length : null;
    await assertPriorityRankAvailableInTx(tx, orgId, priorityRank);

    const createdOrder = await insertManufacturingOrderInTx(tx, orgId, {
      product,
      bomRevisionId,
      salesLink: {
        salesOrderId: order.id,
        salesOrderLineId: line.salesOrderLineId,
        salesOrderNumber: order.orderNumber,
        customerName: order.customerName,
      },
      requestedQuantity,
      plannedQuantity,
      numberOfBatches,
      priorityRank,
      plannedDate,
      notes: payload.notes ?? null,
      ingredients,
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
  payload: CreateManufacturingOrdersFromSalesOrder
): Promise<ManufacturingOrdersFromSalesOrderResult> {
  return withAuthedOrgContext(async (tx, orgId) =>
    createManufacturingOrdersFromSalesOrderInTx(tx, orgId, salesOrderId, payload)
  );
}

export async function updateManufacturingOrder(
  id: string,
  payload: UpdateManufacturingOrder
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const existing = await getLockedManufacturingOrderInTx(tx, id);

    if (!existing) {
      return null;
    }

    if (existing.status !== "draft") {
      throw new ManufacturingError("Only draft orders can be edited", 400);
    }

    // For batch MOs, recalculate batch planning from the snapshotted yield
    const batchProduct: ProductSnapshot = {
      id: existing.productId,
      name: "",
      sku: null,
      unitName: "",
      manufacturingMode: existing.manufacturingMode,
      expectedBatchYield: existing.expectedBatchYield,
    };
    const { plannedQuantity, numberOfBatches, ingredientMultiplier } =
      computeBatchPlanning(batchProduct, Number(payload.plannedQuantity));

    const salesLink = await validateSalesLineLinkInTx(tx, {
      salesOrderId: payload.salesOrderId,
      salesOrderLineId: payload.salesOrderLineId,
      productId: existing.productId,
    },
    existing.salesOrderId && existing.salesOrderLineId
      ? {
          salesOrderId: existing.salesOrderId,
          salesOrderLineId: existing.salesOrderLineId,
          salesOrderNumber: existing.salesOrderNumber ?? "",
          customerName: existing.salesCustomerName ?? "",
        }
      : null);
    const ingredients = await prepareUpdatedIngredientsInTx(
      tx,
      id,
      existing.bomRevisionId,
      ingredientMultiplier,
      payload.ingredients
    );
    await assertPriorityRankAvailableInTx(tx, orgId, payload.priorityRank, id);

    const [order] = await tx
      .update(manufacturingOrders)
      .set({
        salesOrderId: salesLink?.salesOrderId ?? null,
        salesOrderLineId: salesLink?.salesOrderLineId ?? null,
        salesOrderNumber: salesLink?.salesOrderNumber ?? null,
        salesCustomerName: salesLink?.customerName ?? null,
        requestedQuantity: normalizeNumeric(Number(payload.plannedQuantity)),
        plannedQuantity: normalizeNumeric(plannedQuantity),
        numberOfBatches,
        priorityRank: payload.priorityRank,
        plannedDate: payload.plannedDate ?? null,
        notes: payload.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await tx
      .delete(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));

    await insertManufacturingIngredientsInTx(tx, id, ingredients);

    return order;
  });
}

export async function updateManufacturingOrderPriority(
  id: string,
  payload: UpdateManufacturingOrderPriority
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status !== "draft" && order.status !== "released") {
      throw new ManufacturingError(
        "Only draft or released manufacturing orders can be ranked.",
        400
      );
    }

    await assertPriorityRankAvailableInTx(tx, orgId, payload.priorityRank, id);

    const [updated] = await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: payload.priorityRank,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    return updated;
  });
}

export async function reorderManufacturingOrderPriorityRanks(
  payload: ReorderManufacturingOrderPriorityRanks
): Promise<{ updated: number }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const orders = await tx
      .select({
        id: manufacturingOrders.id,
        status: manufacturingOrders.status,
        priorityRank: manufacturingOrders.priorityRank,
      })
      .from(manufacturingOrders)
      .where(
        and(
          inArray(manufacturingOrders.id, payload.orderIds),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .for("update");

    const allRankedOrders = await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          isNotNull(manufacturingOrders.priorityRank),
          inArray(manufacturingOrders.status, ["draft", "released"]),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .for("update");

    assertSameStringSet(
      allRankedOrders.map((order) => order.id),
      payload.orderIds,
      "Payload must include all currently ranked manufacturing orders."
    );

    assertSameStringSet(
      orders.map((order) => order.id),
      payload.orderIds,
      "Manufacturing order ranking does not match active orders."
    );

    const invalidOrder = orders.find(
      (order) =>
        (order.status !== "draft" && order.status !== "released") ||
        order.priorityRank == null
    );

    if (invalidOrder) {
      throw new ManufacturingError(
        "Only ranked draft or released manufacturing orders can be reordered.",
        400
      );
    }

    const now = new Date();
    for (const [index, id] of payload.orderIds.entries()) {
      await tx
        .update(manufacturingOrders)
        .set({
          priorityRank: index + 1,
          updatedAt: now,
        })
        .where(eq(manufacturingOrders.id, id));
    }

    return { updated: payload.orderIds.length };
  });
}

export async function reorderManufacturingOrderIngredients(
  id: string,
  payload: ReorderManufacturingIngredients
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status !== "draft" && order.status !== "released") {
      throw new ManufacturingError(
        "Only draft or released manufacturing orders can be reordered.",
        400
      );
    }

    const submittedRows = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        manufacturingOrderBatchId:
          manufacturingOrderIngredients.manufacturingOrderBatchId,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, id),
          inArray(manufacturingOrderIngredients.id, payload.ingredientIds)
        )
      )
      .for("update");

    assertSameStringSet(
      submittedRows.map((row) => row.id),
      payload.ingredientIds,
      "Ingredient order does not match this manufacturing order."
    );

    const now = new Date();

    if (order.manufacturingMode === "batch" && order.status === "released") {
      if (submittedRows.some((row) => row.manufacturingOrderBatchId == null)) {
        throw new ManufacturingError(
          "Batch execution order must use batch ingredient rows.",
          400
        );
      }

      const itemIdByIngredientId = new Map(
        submittedRows.map((row) => [row.id, row.itemId])
      );
      const orderedItemIds = payload.ingredientIds.map(
        (ingredientId) => itemIdByIngredientId.get(ingredientId)!
      );
      const allBatchRows = await tx
        .select({
          id: manufacturingOrderIngredients.id,
          itemId: manufacturingOrderIngredients.itemId,
        })
        .from(manufacturingOrderIngredients)
        .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
        .for("update");
      const allItemIds = [...new Set(allBatchRows.map((row) => row.itemId))];

      assertSameStringSet(
        orderedItemIds,
        allItemIds,
        "Ingredient order must include every batch ingredient."
      );

      for (const [sortOrder, itemId] of orderedItemIds.entries()) {
        await tx
          .update(manufacturingOrderIngredients)
          .set({ sortOrder, updatedAt: now })
          .where(
            and(
              eq(manufacturingOrderIngredients.manufacturingOrderId, id),
              eq(manufacturingOrderIngredients.itemId, itemId)
            )
          );
      }

      return { id };
    }

    const templateRows = await tx
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, id),
          sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
        )
      )
      .for("update");

    assertSameStringSet(
      payload.ingredientIds,
      templateRows.map((row) => row.id),
      "Ingredient order must include every ingredient."
    );

    for (const [sortOrder, ingredientId] of payload.ingredientIds.entries()) {
      await tx
        .update(manufacturingOrderIngredients)
        .set({ sortOrder, updatedAt: now })
        .where(eq(manufacturingOrderIngredients.id, ingredientId));
    }

    return { id };
  });
}

export async function releaseManufacturingOrder(
  id: string,
  confirmShortage = false,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "releaseManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, confirmShortage },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "draft") {
      throw new ManufacturingError("Only draft orders can be released", 400);
    }

    await getValidatedProductInTx(tx, order.productId);

    const ingredientRows = await tx
      .select({
        ingredientId: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));

    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );
    await lockItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    const shortages = await getReleaseShortagesInTx(
      tx,
      orgId,
      id,
      order.plannedDate
    );

    if (shortages.length > 0 && !confirmShortage) {
      throw new ManufacturingError(
        `Short on ${summarizeShortageItems(shortages)}`,
        409,
        {
          shortage: { ingredients: shortages },
        }
      );
    }

    const [released] = await tx
      .update(manufacturingOrders)
      .set({
        status: "released",
        releasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, {
        ...order,
        status: "released",
      });
    }

    const reservationIngredientRows =
      order.manufacturingMode === "batch"
        ? await tx
            .select({
              ingredientId: manufacturingOrderIngredients.id,
              itemId: manufacturingOrderIngredients.itemId,
              plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
                "plannedQuantity"
              ),
            })
            .from(manufacturingOrderIngredients)
            .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
        : ingredientRows;

    await addExpectedFromManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      productId: order.productId,
      quantity: parseFloat(
        (
          await tx
            .select({
              plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
            })
            .from(manufacturingOrders)
            .where(eq(manufacturingOrders.id, id))
        )[0]?.plannedQuantity ?? "0"
      ),
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "release-expected-output"
      ),
    });

    await reserveIngredientsForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "release-ingredient-reservations"
      ),
      ingredients: reservationIngredientRows.map((row) => ({
        ingredientId: row.ingredientId,
        itemId: row.itemId,
        quantity: parseFloat(row.plannedQuantity),
      })),
    });

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: released,
    });

    return released;
  });
}

export async function recordManufacturingOutput(
  orderId: string,
  payload: RecordManufacturingOutput,
  options?: { idempotencyKey?: string; batchId?: string | null }
): Promise<{ id: string; lotId: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string; lotId: string }>(tx, {
      organizationId: orgId,
      operationName: "recordManufacturingOutput",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, payload, batchId: options?.batchId ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);
    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released") {
      throw new ManufacturingError("Only released orders can record output", 400);
    }

    const outputQuantity = Number(payload.quantity);
    if (outputQuantity < 0) {
      await reverseManufacturingOutputInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: orderId,
        manufacturingOrderBatchId: options?.batchId ?? null,
        productId: order.productId,
        quantity: Math.abs(outputQuantity),
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey,
        notes: payload.notes,
      });

      const allOutputs = await tx
        .select({
          quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
            "quantity"
          ),
          materialCostTotal: trimScale(
            sql`COALESCE(SUM(${manufacturingOrderOutputs.materialCostTotal}), 0)`
          ).as("materialCostTotal"),
        })
        .from(manufacturingOrderOutputs)
        .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
      const totalActualQuantity = parseFloat(allOutputs[0]?.quantity ?? "0");
      const totalMaterialCost = parseFloat(allOutputs[0]?.materialCostTotal ?? "0");
      if (options?.batchId) {
        const batchOutputQuantity = await getOutputQuantityInTx(tx, {
          manufacturingOrderId: orderId,
          manufacturingOrderBatchId: options.batchId,
        });
        await tx
          .update(manufacturingOrderBatches)
          .set({
            actualQuantity: normalizeNumeric(batchOutputQuantity),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, options.batchId));
      }
      await tx
        .update(manufacturingOrders)
        .set({
          actualQuantity: normalizeNumeric(totalActualQuantity),
          actualMaterialCost: normalizeNumeric(totalMaterialCost),
          actualCostPerUnit:
            totalActualQuantity > 0
              ? normalizeNumeric(totalMaterialCost / totalActualQuantity)
              : null,
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, orderId));

      const result = { id: orderId, lotId: (await getProducedLotIdInTx(tx, orderId)) ?? "" };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });

      return result;
    }

    let batch: LockedBatchStateRow | null = null;
    let plannedOutputQuantity = parseFloat(
      (
        await tx
          .select({
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
          })
          .from(manufacturingOrders)
          .where(eq(manufacturingOrders.id, orderId))
      )[0]?.plannedQuantity ?? "0"
    );

    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      const batches = await getLockedBatchStateRowsInTx(tx, orderId);
      batch = options?.batchId
        ? batches.find((row) => row.id === options.batchId) ?? null
        : getCurrentExecutionBatch(batches);
      if (!batch) {
        throw new ManufacturingError("Batch not found", 404);
      }
      assertCurrentExecutionBatch(batches, batch.id, "started");
      const [batchQuantity] = await tx
        .select({
          plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
            "plannedQuantity"
          ),
        })
        .from(manufacturingOrderBatches)
        .where(eq(manufacturingOrderBatches.id, batch.id));
      plannedOutputQuantity = parseFloat(batchQuantity?.plannedQuantity ?? "0");

      if (batch.status === "pending") {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            status: "in_progress",
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, batch.id));
      }
    } else if (options?.batchId) {
      throw new ManufacturingError("Discrete orders cannot record batch output.", 400);
    }

    if (plannedOutputQuantity <= 0) {
      throw new ManufacturingError("Planned output quantity is invalid.", 400);
    }

    const existingOutputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batch?.id ?? null,
    });
    if (normalizeQuantityNumber(existingOutputQuantity + outputQuantity) > plannedOutputQuantity) {
      throw new ManufacturingError("Output above planned quantity is blocked in v1.", 400);
    }

    const ingredientRows =
      batch != null
        ? await getBatchIngredientsInTx(tx, batch.id)
        : await getTemplateIngredientsInTx(tx, orderId);
    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    const outputConsumedByIngredient = await getConsumedQuantityByIngredientInTx(
      tx,
      ingredientRows.map((row) => row.id)
    );
    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      ingredientRows.map((row) => row.id)
    );
    const ratio = outputQuantity / plannedOutputQuantity;
    const location = await getDefaultInventoryLocationInTx(tx, orgId);
    const outputConsumptionRows: Array<{
      manufacturingOrderIngredientId: string;
      lotId: string;
      quantityUsed: string;
      costPerUnit: string;
    }> = [];
    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const plannedIngredientQuantity = parseFloat(ingredient.plannedQuantity);
      const alreadyOutputConsumed = outputConsumedByIngredient.get(ingredient.id) ?? 0;
      const remainingPlanned = Math.max(
        0,
        plannedIngredientQuantity - alreadyOutputConsumed
      );
      const requiredQuantity = normalizeQuantityNumber(
        Math.min(remainingPlanned, plannedIngredientQuantity * ratio)
      );
      if (requiredQuantity <= 0) {
        continue;
      }

      let actualCostTotal = 0;
      let remainingRequiredQuantity = requiredQuantity;
      let skippedPickedQuantity = alreadyOutputConsumed;
      const pickedAllocations = pickAllocationsByIngredient.get(ingredient.id) ?? [];

      for (const allocation of pickedAllocations) {
        if (remainingRequiredQuantity <= 0) {
          break;
        }

        const allocationQuantity = parseFloat(allocation.quantityUsed);
        if (skippedPickedQuantity >= allocationQuantity) {
          skippedPickedQuantity = normalizeQuantityNumber(
            skippedPickedQuantity - allocationQuantity
          );
          continue;
        }

        const availablePickedQuantity = normalizeQuantityNumber(
          allocationQuantity - skippedPickedQuantity
        );
        skippedPickedQuantity = 0;
        const quantityUsed = normalizeQuantityNumber(
          Math.min(remainingRequiredQuantity, availablePickedQuantity)
        );
        if (quantityUsed <= 0) {
          continue;
        }

        const costPerUnit = allocation.costPerUnit != null ? parseFloat(allocation.costPerUnit) : 0;
        actualCostTotal += quantityUsed * costPerUnit;
        remainingRequiredQuantity = normalizeQuantityNumber(
          remainingRequiredQuantity - quantityUsed
        );
        outputConsumptionRows.push({
          manufacturingOrderIngredientId: ingredient.id,
          lotId: allocation.lotId,
          quantityUsed: normalizeNumericScale(quantityUsed, 4),
          costPerUnit: normalizeNumericScale(costPerUnit, 6),
        });
      }

      if (remainingRequiredQuantity > 0) {
        const consumed = await consumeStockFifoInTx(tx, {
          organizationId: orgId,
          locationId: location.id,
          itemId: ingredient.itemId,
          quantity: remainingRequiredQuantity,
          eventType: "manufacturing_ingredient_consumption",
          eventSubtype: "manufacturing_output",
          referenceType: batch != null ? "manufacturing_batch" : "manufacturing_order",
          referenceId: batch?.id ?? orderId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            `consume:${ingredient.id}`
          ),
          metadata: { manufacturingOrderIngredientId: ingredient.id },
        });

        for (const allocation of consumed.allocations) {
          actualCostTotal += allocation.quantity * allocation.unitCost;
          outputConsumptionRows.push({
            manufacturingOrderIngredientId: ingredient.id,
            lotId: allocation.lotId,
            quantityUsed: normalizeNumericScale(allocation.quantity, 4),
            costPerUnit: normalizeNumericScale(allocation.unitCost, 6),
          });
        }
      }

      const autoConsumedQuantity = normalizeQuantityNumber(
        remainingRequiredQuantity > 0 ? remainingRequiredQuantity : 0
      );
      const nextActualQuantity = alreadyOutputConsumed + requiredQuantity;
      const nextPickedQuantity = Math.max(
        parseFloat(ingredient.pickedQuantity),
        nextActualQuantity
      );
      const nextActualCostTotal =
        parseFloat(ingredient.actualCostTotal ?? "0") + actualCostTotal;
      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeNumeric(nextActualQuantity),
          actualCostTotal: normalizeNumeric(nextActualCostTotal),
          pickedQuantity: normalizeNumeric(nextPickedQuantity),
          pickStatus:
            nextPickedQuantity >= plannedIngredientQuantity ? "picked" : "in_progress",
          pickedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));

      produceIngredientRows.push({
        ingredientId: ingredient.id,
        actualQuantity: requiredQuantity,
        actualCostTotal,
      });

      if (autoConsumedQuantity <= 0) {
        continue;
      }

      await applyDemandReferenceDeltasInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        actorUserId: userId,
        eventSubtype: "manufacturing_output",
        deltas: [
          {
            itemId: ingredient.itemId,
            referenceType: "manufacturing_order_ingredient",
            referenceId: ingredient.id,
            quantity: -autoConsumedQuantity,
          },
        ],
      });
      await applyReservationReferenceDeltasInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        actorUserId: userId,
        eventSubtype: "manufacturing_output",
        deltas: [
          {
            itemId: ingredient.itemId,
            referenceType: "manufacturing_order_ingredient",
            referenceId: ingredient.id,
            quantity: -autoConsumedQuantity,
          },
        ],
      });
    }

    const materialCostTotal = produceIngredientRows.reduce(
      (sum, ingredient) => sum + ingredient.actualCostTotal,
      0
    );
    const producedLotId = await getProducedLotIdInTx(tx, orderId);
    const produced = await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      productId: order.productId,
      quantity: outputQuantity,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      lotId: producedLotId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "output-lot"
      ),
      expectedReleaseQuantity: outputQuantity,
      ingredientRows: produceIngredientRows,
    });

    const [output] = await tx
      .insert(manufacturingOrderOutputs)
      .values({
        manufacturingOrderId: orderId,
        manufacturingOrderBatchId: batch?.id ?? null,
        lotId: produced.lotId,
        outputNumber: await nextOutputNumberInTx(tx, orderId),
        quantity: normalizeNumeric(outputQuantity),
        disposition: payload.outputDisposition,
        unitCost: normalizeNumericScale(materialCostTotal / outputQuantity, 6),
        materialCostTotal: normalizeNumericScale(materialCostTotal, 6),
        notes: payload.notes,
        createdBy: userId,
      })
      .returning({ id: manufacturingOrderOutputs.id });

    if (outputConsumptionRows.length > 0) {
      await tx.insert(manufacturingOrderOutputConsumptions).values(
        outputConsumptionRows.map((row) => ({
          manufacturingOrderOutputId: output.id,
          ...row,
        }))
      );
    }

    const updatedActualQuantity = normalizeQuantityNumber(
      existingOutputQuantity + outputQuantity
    );
    if (batch != null) {
      await tx
        .update(manufacturingOrderBatches)
        .set({
          actualQuantity: normalizeNumeric(updatedActualQuantity),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batch.id));
    }

    const allOutputs = await tx
      .select({
        quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
          "quantity"
        ),
        materialCostTotal: trimScale(
          sql`COALESCE(SUM(${manufacturingOrderOutputs.materialCostTotal}), 0)`
        ).as("materialCostTotal"),
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    const totalActualQuantity = parseFloat(allOutputs[0]?.quantity ?? "0");
    const totalMaterialCost = parseFloat(allOutputs[0]?.materialCostTotal ?? "0");
    await tx
      .update(manufacturingOrders)
      .set({
        actualQuantity: normalizeNumeric(totalActualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualCostPerUnit:
          totalActualQuantity > 0
            ? normalizeNumeric(totalMaterialCost / totalActualQuantity)
            : null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, orderId));

    const result = { id: output.id, lotId: produced.lotId };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function completeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "completeManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, payload },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released") {
      throw new ManufacturingError("Only released orders can be completed", 400);
    }

    if (order.manufacturingMode === "batch") {
      throw new ManufacturingError(
        "Batch-mode orders must be completed one batch at a time.",
        400
      );
    }

    const outputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: id,
    });
    if (outputQuantity > 0) {
      if (payload.actualQuantity != null) {
        throw new ManufacturingError(
          "Output is already recorded for this order.",
          400
        );
      }

      const reservationRows = await getManufacturingIngredientReservationRowsInTx(tx, id);
      await releaseIngredientReservationForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
        reason: "completed",
        ingredientIds: reservationRows.map((row) => row.ingredientId),
      });
      await releaseRemainingExpectedOutputInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        actorUserId: userId,
      });

      const [completed] = await tx
        .update(manufacturingOrders)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, id))
        .returning({ id: manufacturingOrders.id });

      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: completed,
      });

      return completed;
    }

    if (payload.actualQuantity == null) {
      throw new ManufacturingError("Actual quantity is required.", 400);
    }

    const actualQuantity = Number(payload.actualQuantity);
    const ingredientRows = await getTemplateIngredientsInTx(tx, id);

    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    const unpickedIngredients = ingredientRows.filter(
      (ingredient) => getRemainingQuantityNumber(ingredient.plannedQuantity, ingredient.pickedQuantity) > 0
    );

    if (unpickedIngredients.length > 0) {
      throw new ManufacturingError(
        `Cannot complete order. Pick ${summarizeShortageItems(
          unpickedIngredients.map((ingredient) => ({
            itemId: ingredient.itemId,
            itemName: ingredient.itemName,
            unitName: ingredient.unitName,
            needed: parseFloat(ingredient.plannedQuantity),
            available: parseFloat(ingredient.pickedQuantity),
            shortage: getRemainingQuantityNumber(
              ingredient.plannedQuantity,
              ingredient.pickedQuantity
            ),
          }))
        )} first.`,
        400,
        {
          shortage: {
            ingredients: unpickedIngredients.map((ingredient) => ({
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              unitName: ingredient.unitName,
              needed: parseFloat(ingredient.plannedQuantity),
              available: parseFloat(ingredient.pickedQuantity),
              shortage: getRemainingQuantityNumber(
                ingredient.plannedQuantity,
                ingredient.pickedQuantity
              ),
            })),
          },
        }
      );
    }

    const allocationTotals = await getPickAllocationTotalsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.id)
    );

    const actualsMap = buildIngredientActualsMap(
      payload.ingredientActuals,
      ingredientRows
    );

    let totalMaterialCost = 0;
    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const pickedQty = parseFloat(ingredient.pickedQuantity);
      const suppliedActual = actualsMap.get(ingredient.id);
      let effectiveQuantity: number;
      let effectiveCost: number;

      if (suppliedActual != null) {
        const reconciled = await reconcileIngredientActualsInTx(tx, {
          organizationId: orgId,
          ingredient: {
            id: ingredient.id,
            itemId: ingredient.itemId,
            pickedQuantity: pickedQty,
          },
          actualConsumedQuantity: suppliedActual,
          referenceType: "manufacturing_order",
          referenceId: id,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            `variance:${ingredient.id}`
          ),
        });
        effectiveQuantity = reconciled.newTotalQuantity;
        effectiveCost = reconciled.newTotalCost;
      } else {
        const totals = allocationTotals.get(ingredient.id) ?? { quantity: 0, cost: 0 };
        effectiveQuantity = pickedQty;
        effectiveCost = totals.cost;
      }

      totalMaterialCost += effectiveCost;

      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeNumeric(effectiveQuantity),
          actualCostTotal: normalizeNumeric(effectiveCost),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));

      produceIngredientRows.push({
        ingredientId: ingredient.id,
        actualQuantity: effectiveQuantity,
        actualCostTotal: effectiveCost,
      });
    }

    const actualCostPerUnit = totalMaterialCost / actualQuantity;

    await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      productId: order.productId,
      quantity: actualQuantity,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "complete-output"
      ),
      expectedReleaseQuantity: null,
      ingredientRows: produceIngredientRows,
    });

    const [completed] = await tx
      .update(manufacturingOrders)
      .set({
        status: "completed",
        actualQuantity: normalizeNumeric(actualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualCostPerUnit: normalizeNumeric(actualCostPerUnit),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: completed,
    });

    return completed;
  });
}

export async function startManufacturingBatch(
  orderId: string,
  batchId: string
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released" || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only released batch-mode orders can start batches", 400);
    }

    await ensureBatchExecutionRowsInTx(tx, order);
    const batches = await getLockedBatchStateRowsInTx(tx, orderId);
    const batch = batches.find((row) => row.id === batchId);

    if (!batch) {
      throw new ManufacturingError("Batch not found", 404);
    }

    assertCurrentExecutionBatch(batches, batchId, "started");

    if (batch.status === "pending") {
      await tx
        .update(manufacturingOrderBatches)
        .set({
          status: "in_progress",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batchId));
    }

    return { id: batchId };
  });
}

export async function completeManufacturingBatch(
  orderId: string,
  batchId: string,
  payload: CompleteManufacturingBatch,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "completeManufacturingBatch",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, batchId, payload },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released" || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only released batch-mode orders can complete batches", 400);
    }

    await ensureBatchExecutionRowsInTx(tx, order);
    const batches = await getLockedBatchStateRowsInTx(tx, orderId);
    const batch = batches.find((row) => row.id === batchId);

    if (!batch) {
      throw new ManufacturingError("Batch not found", 404);
    }

    assertCurrentExecutionBatch(batches, batchId, "completed");
    const completesOrder = batches.every(
      (currentBatch) => currentBatch.id === batchId || currentBatch.status === "completed"
    );

    const outputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batchId,
    });
    if (outputQuantity > 0) {
      if (payload.actualQuantity != null) {
        throw new ManufacturingError(
          "Output is already recorded for this batch.",
          400
        );
      }

      const plannedBatchQuantity = parseFloat(
        (
          await tx
            .select({
              plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
                "plannedQuantity"
              ),
            })
            .from(manufacturingOrderBatches)
            .where(eq(manufacturingOrderBatches.id, batchId))
        )[0]?.plannedQuantity ?? "0"
      );
      const ingredientRows = await getBatchIngredientsInTx(tx, batchId);
      await releaseIngredientReservationForManufacturingInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: orderId,
        actorUserId: userId,
        reason: "completed",
        ingredientIds: ingredientRows.map((row) => row.id),
      });
      if (!completesOrder) {
        await releaseRemainingExpectedOutputInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: orderId,
          actorUserId: userId,
          quantity: Math.max(0, plannedBatchQuantity - outputQuantity),
        });
      } else {
        await releaseRemainingExpectedOutputInTx(tx, {
          organizationId: orgId,
          manufacturingOrderId: orderId,
          actorUserId: userId,
        });
      }

      const producedLotId = await getProducedLotIdInTx(tx, orderId);
      await tx
        .update(manufacturingOrderBatches)
        .set({
          status: "completed",
          actualQuantity: normalizeNumeric(outputQuantity),
          lotId: producedLotId,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.id, batchId));

      const updatedBatches = await getBatchRowsInTx(tx, orderId);
      const completedBatchCount = updatedBatches.filter(
        (currentBatch) => currentBatch.status === "completed"
      ).length;
      const allCompleted =
        updatedBatches.length > 0 && completedBatchCount === updatedBatches.length;
      await tx
        .update(manufacturingOrders)
        .set({
          status: allCompleted ? "completed" : "released",
          completedAt: allCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, orderId));

      const result = { id: batchId };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });

      return result;
    }

    const ingredientRows = await getBatchIngredientsInTx(tx, batchId);
    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.itemId)
    );

    const unpickedIngredients = ingredientRows.filter(
      (ingredient) => getRemainingQuantityNumber(ingredient.plannedQuantity, ingredient.pickedQuantity) > 0
    );

    if (unpickedIngredients.length > 0) {
      throw new ManufacturingError(
        "Pick all batch ingredients before completing the batch.",
        400,
        {
          shortage: {
            ingredients: unpickedIngredients.map((ingredient) => ({
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              unitName: ingredient.unitName,
              needed: parseFloat(ingredient.plannedQuantity),
              available: parseFloat(ingredient.pickedQuantity),
              shortage: getRemainingQuantityNumber(
                ingredient.plannedQuantity,
                ingredient.pickedQuantity
              ),
            })),
          },
        }
      );
    }

    if (payload.actualQuantity == null) {
      throw new ManufacturingError("Actual quantity is required.", 400);
    }

    const actualQuantity = Number(payload.actualQuantity);
    const allocationTotals = await getPickAllocationTotalsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.id)
    );

    const actualsMap = buildIngredientActualsMap(
      payload.ingredientActuals,
      ingredientRows
    );

    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const pickedQty = parseFloat(ingredient.pickedQuantity);
      const suppliedActual = actualsMap.get(ingredient.id);
      let effectiveQuantity: number;
      let effectiveCost: number;

      if (suppliedActual != null) {
        const reconciled = await reconcileIngredientActualsInTx(tx, {
          organizationId: orgId,
          ingredient: {
            id: ingredient.id,
            itemId: ingredient.itemId,
            pickedQuantity: pickedQty,
          },
          actualConsumedQuantity: suppliedActual,
          referenceType: "manufacturing_batch",
          referenceId: batchId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            `batch-variance:${batchId}:${ingredient.id}`
          ),
        });
        effectiveQuantity = reconciled.newTotalQuantity;
        effectiveCost = reconciled.newTotalCost;
      } else {
        const totals = allocationTotals.get(ingredient.id) ?? { quantity: 0, cost: 0 };
        effectiveQuantity = pickedQty;
        effectiveCost = totals.cost;
      }

      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeNumeric(effectiveQuantity),
          actualCostTotal: normalizeNumeric(effectiveCost),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));

      produceIngredientRows.push({
        ingredientId: ingredient.id,
        actualQuantity: effectiveQuantity,
        actualCostTotal: effectiveCost,
      });
    }

    const produced = await produceManufacturedStockInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      productId: order.productId,
      quantity: actualQuantity,
      actorUserId: userId,
      outputDisposition: payload.outputDisposition,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        `complete-batch:${batchId}`
      ),
      expectedReleaseQuantity: completesOrder ? null : actualQuantity,
      ingredientRows: produceIngredientRows,
    });

    await tx
      .update(manufacturingOrderBatches)
      .set({
        status: "completed",
        actualQuantity: normalizeNumeric(actualQuantity),
        pickedAt: batch.pickedAt ?? new Date(),
        completedAt: new Date(),
        lotId: produced.lotId,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderBatches.id, batchId));

    const updatedBatches = await getBatchRowsInTx(tx, orderId);
    const totalActualQuantity = sumNumericStrings(
      updatedBatches.map((currentBatch) => currentBatch.actualQuantity)
    );
    const completedBatchCount = updatedBatches.filter(
      (currentBatch) => currentBatch.status === "completed"
    ).length;
    const allCompleted = updatedBatches.length > 0 && completedBatchCount === updatedBatches.length;

    const batchIngredientRows = await tx
      .select({
        actualCostTotal: trimScaleNullable(manufacturingOrderIngredients.actualCostTotal).as(
          "actualCostTotal"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));

    const totalMaterialCost = sumNumericStrings(
      batchIngredientRows.map((row) => row.actualCostTotal)
    );

    await tx
      .update(manufacturingOrders)
      .set({
        actualQuantity: normalizeNumeric(totalActualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualCostPerUnit:
          totalActualQuantity > 0
            ? normalizeNumeric(totalMaterialCost / totalActualQuantity)
            : normalizeNumeric(0),
        status: allCompleted ? "completed" : "released",
        completedAt: allCompleted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, orderId));

    const result = { id: batchId };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function pickManufacturingIngredient(
  orderId: string,
  ingredientId: string,
  options?: {
    idempotencyKey?: string;
    confirmRequirementOverride?: boolean;
  }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "pickManufacturingIngredient",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        orderId,
        ingredientId,
        confirmRequirementOverride: options?.confirmRequirementOverride ?? false,
      },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released") {
      throw new ManufacturingError("Only released orders can be picked", 400);
    }

    let lockedBatches: LockedBatchStateRow[] = [];
    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      lockedBatches = await getLockedBatchStateRowsInTx(tx, orderId);
    }

    const [ingredient] = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
        unitName: manufacturingOrderIngredients.unitName,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.id, ingredientId),
          eq(manufacturingOrderIngredients.manufacturingOrderId, orderId)
        )
      )
      .for("update");

    if (!ingredient) {
      throw new ManufacturingError("Ingredient not found", 404);
    }

    const remainingQuantity = getRemainingQuantityNumber(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    );

    if (remainingQuantity <= 0) {
      throw new ManufacturingError(`"${ingredient.itemName}" is already picked.`, 400);
    }

    await validateActiveIngredientItemsInTx(tx, [ingredient.itemId]);

    const constraintsByIngredientId = await getIngredientConstraintsByIdInTx(tx, [
      ingredient.id,
    ]);
    const minimumLotAgeDays = getMinimumLotAgeDays(
      constraintsByIngredientId.get(ingredient.id)
    );
    const pickDate = isoDate(new Date());
    const minimumReceivedDate =
      minimumLotAgeDays == null ? null : subtractDays(pickDate, minimumLotAgeDays);

    if (minimumLotAgeDays != null) {
      const location = await getDefaultInventoryLocationInTx(tx, orgId);
      const [ownReservation] = await tx
        .select({
          quantity: trimScale(inventoryReservationsSummary.quantity).as("quantity"),
        })
        .from(inventoryReservationsSummary)
        .where(
          and(
            eq(inventoryReservationsSummary.organizationId, orgId),
            eq(inventoryReservationsSummary.locationId, location.id),
            eq(inventoryReservationsSummary.itemId, ingredient.itemId),
            eq(
              inventoryReservationsSummary.referenceType,
              "manufacturing_order_ingredient"
            ),
            eq(inventoryReservationsSummary.referenceId, ingredient.id)
          )
        );
      const ageAvailability = await getLotAgeAvailabilityInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId: ingredient.itemId,
        minimumLotAgeDays,
        requiredDate: pickDate,
        reservationCredit: parseFloat(ownReservation?.quantity ?? "0"),
      });

      if (
        ageAvailability.eligible < remainingQuantity &&
        !options?.confirmRequirementOverride
      ) {
        throw new ManufacturingError(
          `Not enough eligible ${ingredient.itemName}.`,
          409,
          {
            shortage: {
              ingredients: [
                {
                  itemId: ingredient.itemId,
                  itemName: ingredient.itemName,
                  unitName: ingredient.unitName,
                  needed: remainingQuantity,
                  available: ageAvailability.eligible,
                  shortage: normalizeQuantityNumber(
                    remainingQuantity - ageAvailability.eligible
                  ),
                  warningType: "requirement_violation",
                  requirement: lotAgeRequirementText(minimumLotAgeDays),
                  nextEligibleDate: ageAvailability.nextEligibleDate,
                },
              ],
            },
          }
        );
      }
    }

    if (ingredient.manufacturingOrderBatchId != null) {
      const batch = assertCurrentExecutionBatch(
        lockedBatches,
        ingredient.manufacturingOrderBatchId,
        "picked"
      );

      if (batch.status === "pending") {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            status: "in_progress",
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, batch.id));
      }
    }

    await pickManufacturingIngredientInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: orderId,
      ingredientId,
      itemId: ingredient.itemId,
      quantity: remainingQuantity,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        `pick-ingredient:${ingredientId}`
      ),
      minimumReceivedDate,
      confirmRequirementOverride: options?.confirmRequirementOverride,
    });

    await tx
      .update(manufacturingOrderIngredients)
      .set({
        pickedQuantity: ingredient.plannedQuantity,
        pickStatus: "picked",
        pickedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrderIngredients.id, ingredient.id));

    if (ingredient.manufacturingOrderBatchId != null) {
      const batchIngredients = await getBatchIngredientsInTx(
        tx,
        ingredient.manufacturingOrderBatchId
      );
      const fullyPicked = batchIngredients.every(
        (row) => getRemainingQuantityNumber(row.plannedQuantity, row.pickedQuantity) <= 0
      );

      if (fullyPicked) {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            pickedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(manufacturingOrderBatches.id, ingredient.manufacturingOrderBatchId));
      }
    }

    const result = { id: ingredient.id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function getManufacturingExecutionDetail(
  orderId: string
): Promise<ManufacturingExecutionDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productId: manufacturingOrders.productId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        unitName: manufacturingOrders.unitName,
        status: manufacturingOrders.status,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
          "actualQuantity"
        ),
        expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        numberOfBatches: manufacturingOrders.numberOfBatches,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        priorityRank: manufacturingOrders.priorityRank,
        plannedDate: manufacturingOrders.plannedDate,
        notes: manufacturingOrders.notes,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, orderId), isNull(manufacturingOrders.deletedAt)));

    if (!order) {
      return null;
    }

    let batches: ExecutionBatchRow[] = [];
    if (order.manufacturingMode === "batch" && order.status !== "draft") {
      batches = await getBatchRowsInTx(tx, orderId);
    }

    const currentBatch =
      order.manufacturingMode === "batch" ? getCurrentExecutionBatch(batches) : null;

    const ingredients =
      order.manufacturingMode === "batch" && currentBatch != null
        ? (await getBatchIngredientsInTx(tx, currentBatch.id)).map(toIngredientDetail)
        : (await getTemplateIngredientsInTx(tx, orderId)).map(toIngredientDetail);
    const recordedOutputQuantity = await getOutputQuantityInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: currentBatch?.id ?? null,
    });

    return {
      ...order,
      status: order.status as ManufacturingOrderStatus,
      pickProgressStatus:
        order.manufacturingMode === "batch"
          ? getBatchPickProgressStatus(batches)
          : getPickProgressStatus(
              ingredients.map((ingredient) => ({
                plannedQuantity: ingredient.plannedQuantity,
                pickedQuantity: ingredient.pickedQuantity,
              }))
            ),
      canComplete:
        recordedOutputQuantity > 0
          ? true
          : order.manufacturingMode === "batch"
          ? currentBatch != null &&
            ingredients.every(
              (ingredient) =>
                getRemainingQuantityNumber(
                  ingredient.plannedQuantity,
                  ingredient.pickedQuantity
                ) <= 0
            )
          : ingredients.every(
              (ingredient) =>
                getRemainingQuantityNumber(
                  ingredient.plannedQuantity,
                  ingredient.pickedQuantity
                ) <= 0
            ),
      currentBatchId: currentBatch?.id ?? null,
      currentBatch: currentBatch,
      batches,
      ingredients,
      recordedOutputQuantity: normalizeNumeric(recordedOutputQuantity),
    };
  });
}

export async function cancelManufacturingOrder(
  id: string,
  options?: { idempotencyKey?: string }
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "cancelManufacturingOrderRequest",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (!["draft", "released"].includes(order.status)) {
      throw new ManufacturingError("Only draft or released orders can be cancelled", 400);
    }

    let reservationRows: Awaited<
      ReturnType<typeof getManufacturingIngredientReservationRowsInTx>
    > = [];

    if (order.status === "released") {
      if (order.manufacturingMode === "batch") {
        const batches = await getLockedBatchStateRowsInTx(tx, order.id);
        const cancellableBatchIds = batches
          .filter((batch) => batch.status !== "completed")
          .map((batch) => batch.id);
        reservationRows = await getManufacturingIngredientReservationRowsForBatchesInTx(
          tx,
          id,
          cancellableBatchIds
        );
      } else {
        reservationRows = await getManufacturingIngredientReservationRowsInTx(tx, id);
      }
    }

    const [cancelled] = await tx
      .update(manufacturingOrders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    if (order.status === "released") {
      await cancelReleasedManufacturingOrderInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        productId: order.productId,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "cancel-released-order"
        ),
        ingredientRows: reservationRows.map((row) => ({
          ingredientId: row.ingredientId,
          itemId: row.itemId,
          pickedQuantity: parseFloat(row.pickedQuantity),
        })),
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: cancelled,
    });

    return cancelled;
  });
}

export async function deleteManufacturingOrder(
  id: string
): Promise<{ deleted: boolean; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return { deleted: false };
    }

    if (order.status === "released") {
      return {
        deleted: false,
        error: "Released manufacturing orders must be cancelled before deleting.",
      };
    }

    await tx
      .update(manufacturingOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(manufacturingOrders.id, id));

    return { deleted: true };
  });
}

export async function deleteManufacturingOrders(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    const orders = await tx
      .select({
        id: manufacturingOrders.id,
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(
        and(
          inArray(manufacturingOrders.id, uniqueIds),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .for("update");

    const releasedOrder = orders.find((order) => order.status === "released");

    if (releasedOrder) {
      return {
        deletedCount: 0,
        error: "Released manufacturing orders must be cancelled before deleting.",
      };
    }

    const deleted = await tx
      .update(manufacturingOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(inArray(manufacturingOrders.id, uniqueIds), isNull(manufacturingOrders.deletedAt))
      )
      .returning({ id: manufacturingOrders.id });

    return { deletedCount: deleted.length };
  });
}
