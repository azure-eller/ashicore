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
  or,
  sql,
} from "drizzle-orm";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  type InventoryDisposition,
  inventoryReservationsSummary,
  bomRevisions,
  itemFamilies,
  itemVariantValues,
  items,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderOperationCosts,
  manufacturingOrderOutputConsumptions,
  manufacturingOrderOutputs,
  manufacturingOrderIngredientConstraints,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingPickAllocations,
  organization,
  stockAllocations,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import {
  normalizeNumeric,
  normalizeNumericScale,
  roundQuantity,
  todayInTimeZone,
} from "@/lib/format";
import { inferItemVisual } from "@/components/inventory-visuals/infer-item-visual";
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
  addIngredientDemandForManufacturingInTx,
  editExpectedFromManufacturingInTx,
  applyDemandReferenceDeltasInTx,
  applyExpectedReferenceDeltasInTx,
  applyReservationReferenceDeltasInTx,
  beginInventoryOperationInTx,
  cancelActiveStockAllocationsInTx,
  cancelReleasedManufacturingOrderInTx,
  consumeStockFifoInTx,
  consumeLotAllocationsForDemandInTx,
  decrementExistingLotStockInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getDefaultInventoryLocationInTx,
  getUnavailableLotAllocationQtyByLotIdInTx,
  getManufacturingIngredientReservationRowsInTx,
  lockItemsInTx,
  materializeManufacturingOrderSourceAllocationsFromExistingOutputInTx,
  pickManufacturingIngredientInTx,
  produceManufacturedStockInTx,
  projectedLotUnitCost,
  reconcileIngredientActualsInTx,
  releaseIngredientReservationForManufacturingInTx,
  restockExistingLotInTx,
} from "@/lib/inventory/kernel";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import {
  evaluateLotAgeMinDaysRequirement,
  formatMinimumLotAgeRequirementViolation,
  getMinimumLotAgeDays,
  LOT_AGE_MIN_DAYS_CONSTRAINT,
  type BomComponentConstraint,
} from "@/lib/bom/constraints";
import {
  calculateIngredientPlannedQuantity,
  normalizeRecipeBasis,
  type RecipeBasis,
} from "@/lib/manufacturing/consumption";
import { getBomRevisionOperationCostsInTx } from "@/lib/bom/operation-costs";
import { calculatePlannedOperationCost } from "@/lib/manufacturing/operation-costs";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import { InsufficientStockError } from "@/lib/inventory/kernel/errors";
import { loadAllocationSourcesForItemInTx } from "@/lib/inventory/allocation/sources";
import {
  buildFifoLotPickPlanInTx,
  type LotPickPlanEntry,
} from "@/lib/inventory/lot-pick-plan";
import {
  demandQueueCoverageKey,
  getDemandQueueCoverageByDemandKeyForItemsInTx,
} from "@/lib/inventory/allocation/demand-queue";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  CompleteManufacturingBatch,
  CompleteManufacturingOrder,
  CreateManufacturingOrdersFromSalesOrder,
  InsertManufacturingOrder,
  ManufacturingBatchStatus,
  ManufacturingLotStrategy,
  ManufacturingOrderStatus,
  ManufacturingPickStatus,
  PatchManufacturingOrder,
  PatchManufacturingOrderIngredient,
  RecordManufacturingOutput,
  ReorderManufacturingOrderPriorityRanks,
  ReorderManufacturingIngredients,
  SaveManufacturingOutputAllocation,
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
  ManufacturingIngredientReadiness,
  ManufacturingPickProgressStatus,
  ManufacturingProductOption,
  ManufacturingReleaseWarningPayload,
  ManufacturingSalesOrderOption,
  ManufacturingSalesOrderPreview,
  ManufacturingSalesLineOption,
} from "./types";

async function getManufacturingOptionLabelsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, string[]>();
  for (const row of rows) {
    const labels = byItemId.get(row.itemId) ?? [];
    labels.push(row.label);
    byItemId.set(row.itemId, labels);
  }
  return byItemId;
}

function shippedSalesOrderLineQuantitySql() {
  return sql<string>`COALESCE((
    SELECT SUM(shipment_lines."quantity")
    FROM "sales"."sales_shipment_lines" shipment_lines
    INNER JOIN "sales"."sales_shipments" shipments
      ON shipments."id" = shipment_lines."sales_shipment_id"
    WHERE shipment_lines."sales_order_line_id" = "sales"."sales_order_lines"."id"
      AND shipments."status" = 'shipped'
  ), 0)`;
}

function plannedSalesOrderLineQuantitySql() {
  return sql<string>`COALESCE((
    SELECT SUM(shipment_lines."quantity")
    FROM "sales"."sales_shipment_lines" shipment_lines
    INNER JOIN "sales"."sales_shipments" shipments
      ON shipments."id" = shipment_lines."sales_shipment_id"
    WHERE shipment_lines."sales_order_line_id" = "sales"."sales_order_lines"."id"
      AND shipments."status" = 'planned'
  ), 0)`;
}

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

type LockedManufacturingOrder = {
  id: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  status: (typeof manufacturingOrders.$inferSelect)["status"];
  manufacturingMode: string;
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  plannedQuantity: string;
  plannedDate: string | null;
  priorityRank: number | null;
  bomRevisionId: string | null;
  startedAt: Date | null;
};

function isOpenManufacturingOrder(
  order: Pick<LockedManufacturingOrder, "status">
) {
  return order.status === "open";
}

type ValidatedIngredient = {
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
  lotStrategy: ManufacturingLotStrategy;
  pickedQuantity: string;
  pickStatus: ManufacturingPickStatus;
  actualQuantity: string | null;
  actualCostTotal: string | null;
  sortOrder: number;
  constraints: BomComponentConstraint[];
};

type ExecutionIngredientLotAllocation = NonNullable<
  ManufacturingOrderIngredientDetail["lotAllocations"]
>[number];

type EditableManufacturingIngredientSnapshotRow = {
  id: string;
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

async function getOrganizationTodayInTx(tx: Tx, organizationId: string) {
  const [row] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return todayInTimeZone(row?.timeZone ?? "America/Denver");
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

function deriveScalingPlan(
  outputQuantity: number,
  ingredients: ValidatedIngredient[]
): ManufacturingScalingPlan {
  const batchIngredient = ingredients.find((ingredient) => ingredient.recipeBasis === "batch");
  const expectedBatchYield = batchIngredient?.recipeOutputQuantity ?? null;
  const batchYield = expectedBatchYield == null ? NaN : Number(expectedBatchYield);

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
}) {
  return calculateIngredientPlannedQuantity({
    recipeBasis: params.recipeBasis,
    quantityPerRecipeBasis: params.quantityPerUnit,
    outputQuantity: params.outputQuantity,
    numberOfBatches: deriveBatchCount({
      recipeBasis: params.recipeBasis,
      recipeOutputQuantity: params.recipeOutputQuantity,
      outputQuantity: params.outputQuantity,
    }),
  });
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
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      unitName: manufacturingOrders.unitName,
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
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      startedAt: manufacturingOrders.startedAt,
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

function mergeSubmittedOrderIds(
  currentIds: string[],
  submittedIds: string[]
) {
  const submittedIdSet = new Set(submittedIds);
  let submittedIndex = 0;

  const mergedIds = currentIds.map((id) => {
    if (!submittedIdSet.has(id)) {
      return id;
    }

    return submittedIds[submittedIndex++] ?? id;
  });

  if (submittedIndex !== submittedIds.length) {
    throw new ManufacturingError(
      "Manufacturing order ranking does not match active orders.",
      400
    );
  }

  return mergedIds;
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
    eq(manufacturingOrders.status, "open"),
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

async function rerankOpenManufacturingOrdersInTx(tx: Tx, orgId: string) {
  const rows = await tx
    .select({
      id: manufacturingOrders.id,
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .orderBy(
      sql`${manufacturingOrders.priorityRank} IS NULL`,
      asc(manufacturingOrders.priorityRank),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrders.id)
    )
    .for("update");

  if (rows.length === 0) {
    return;
  }

  const now = new Date();
  await tx
    .update(manufacturingOrders)
    .set({
      priorityRank: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    );

  for (const [index, row] of rows.entries()) {
    await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: index + 1,
        updatedAt: now,
      })
      .where(eq(manufacturingOrders.id, row.id));
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

async function prepareCreateIngredientsInTx(
  tx: Tx,
  productId: string,
  outputQuantity: number,
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

      const quantityPerUnit = normalizeNumeric(Number(selected.quantityPerUnit));
      const recipeBasis = normalizeRecipeBasis(row.recipeBasis);

      return {
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
        }),
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

function tryGetApprovedBomMaterialOption(
  row: BomRevisionComponentSnapshot,
  itemId: string
) {
  try {
    return getApprovedBomMaterialOption(row, itemId);
  } catch {
    return null;
  }
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

  return new Map(rows.map((row) => [row.id, row]));
}

async function prepareCreateIngredientsFromBomInTx(
  tx: Tx,
  productId: string,
  outputQuantity: number
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
      const recipeBasis = normalizeRecipeBasis(row.recipeBasis);

      return {
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
          outputQuantity,
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

async function getAbsorbedOperationCostForQuantityInTx(
  tx: Tx,
  manufacturingOrderId: string,
  outputQuantity: number,
  options?: { absorbFullFixedCost?: boolean }
) {
  const [order] = await tx
    .select({
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
    })
    .from(manufacturingOrders)
    .where(eq(manufacturingOrders.id, manufacturingOrderId));
  const plannedQuantity = Number.parseFloat(order?.plannedQuantity ?? "0");
  const rows = await tx
    .select({
      costScalingMode: manufacturingOrderOperationCosts.costScalingMode,
      crewSize: trimScale(manufacturingOrderOperationCosts.crewSize).as("crewSize"),
      plannedMinutes: trimScale(manufacturingOrderOperationCosts.plannedMinutes).as(
        "plannedMinutes"
      ),
      loadedCostPerHour: trimScale(
        manufacturingOrderOperationCosts.loadedCostPerHour
      ).as("loadedCostPerHour"),
      plannedCostTotal: trimScale(
        manufacturingOrderOperationCosts.plannedCostTotal
      ).as("plannedCostTotal"),
    })
    .from(manufacturingOrderOperationCosts)
    .where(eq(manufacturingOrderOperationCosts.manufacturingOrderId, manufacturingOrderId));

  return rows.reduce((sum, row) => {
    if (row.costScalingMode === "per_output_unit") {
      return (
        sum +
        Number.parseFloat(
          calculatePlannedOperationCost({
            costScalingMode: "per_output_unit",
            crewSize: row.crewSize,
            plannedMinutes: row.plannedMinutes,
            loadedCostPerHour: row.loadedCostPerHour,
            outputQuantity,
          })
        )
      );
    }

    const plannedCost = Number.parseFloat(row.plannedCostTotal);
    if (options?.absorbFullFixedCost) {
      return sum + plannedCost;
    }

    if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
      return sum + plannedCost;
    }

    return sum + plannedCost * Math.min(outputQuantity / plannedQuantity, 1);
  }, 0);
}

async function getIncrementalAbsorbedOperationCostForQuantityInTx(
  tx: Tx,
  manufacturingOrderId: string,
  previousOutputQuantity: number,
  outputQuantity: number,
  options?: { absorbFullFixedCost?: boolean }
) {
  const normalizedPreviousOutputQuantity = Math.max(previousOutputQuantity, 0);
  const normalizedOutputQuantity = Math.max(outputQuantity, 0);
  const previousCost =
    normalizedPreviousOutputQuantity > 0
      ? await getAbsorbedOperationCostForQuantityInTx(
          tx,
          manufacturingOrderId,
          normalizedPreviousOutputQuantity
        )
      : 0;
  const nextCost = await getAbsorbedOperationCostForQuantityInTx(
    tx,
    manufacturingOrderId,
    normalizedPreviousOutputQuantity + normalizedOutputQuantity,
    options
  );

  return Math.max(nextCost - previousCost, 0);
}

async function getTotalOutputQuantityForOrderInTx(
  tx: Tx,
  manufacturingOrderId: string
) {
  const [row] = await tx
    .select({
      quantity: trimScale(sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(manufacturingOrderOutputs)
    .where(eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId));

  return parseFloat(row?.quantity ?? "0");
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
    manufacturingMode: "discrete" | "batch";
    numberOfBatches: number | null;
    expectedBatchYield: string | null;
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
    lotAllocations?: InsertManufacturingOrder["lotAllocations"];
    autoAllocateIngredientLots?: boolean;
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

  const reservationIngredientRows =
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
    ingredients: reservationIngredientRows.map((line) => ({
      ingredientId: line.ingredientId,
      itemId: line.itemId,
      quantity: parseFloat(line.plannedQuantity),
    })),
  });

  if (params.autoAllocateIngredientLots === true) {
    await saveManufacturingIngredientLotAllocationsInTx(tx, {
      organizationId: orgId,
      actorUserId: params.actorUserId ?? null,
      ingredients: reservationIngredientRows.map((ingredient) => ({
        ...ingredient,
        lotStrategy: ingredient.lotStrategy as ManufacturingLotStrategy,
      })),
      lotAllocations: params.lotAllocations ?? [],
    });
  }

  return orderRow;
}

type ManufacturingIngredientLotAllocationPlan = NonNullable<
  InsertManufacturingOrder["lotAllocations"]
>;

async function insertManufacturingIngredientLotAllocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    ingredientId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    sourceLabelSnapshot?: string | null;
  }
) {
  if (params.quantity <= 0) return;

  const [existing] = await tx
    .select({
      id: stockAllocations.id,
      quantity: stockAllocations.quantity,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, params.organizationId),
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        eq(stockAllocations.demandId, params.ingredientId),
        eq(stockAllocations.itemId, params.itemId),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.sourceId, params.lotId),
        eq(stockAllocations.status, "active")
      )
    )
    .for("update");

  const now = new Date();
  if (existing) {
    await tx
      .update(stockAllocations)
      .set({
        quantity: normalizeNumeric(parseFloat(existing.quantity) + params.quantity),
        sourceLabelSnapshot: params.sourceLabelSnapshot ?? null,
        updatedBy: params.actorUserId ?? null,
        updatedAt: now,
      })
      .where(eq(stockAllocations.id, existing.id));
    return;
  }

  await tx.insert(stockAllocations).values({
    organizationId: params.organizationId,
    demandType: "manufacturing_order_ingredient",
    demandId: params.ingredientId,
    itemId: params.itemId,
    sourceType: "inventory_lot",
    sourceId: params.lotId,
    quantity: normalizeNumeric(params.quantity),
    status: "active",
    sourceLabelSnapshot: params.sourceLabelSnapshot ?? null,
    createdBy: params.actorUserId ?? null,
    updatedBy: params.actorUserId ?? null,
  });
}

async function saveManufacturingIngredientLotAllocationsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    ingredients: Array<{
      ingredientId: string;
      itemId: string;
      plannedQuantity: string;
      lotStrategy?: ManufacturingLotStrategy;
    }>;
    lotAllocations: ManufacturingIngredientLotAllocationPlan;
  }
) {
  const allocationItemIds = [
    ...new Set([
      ...params.ingredients.map((ingredient) => ingredient.itemId),
      ...params.lotAllocations.map((allocation) => allocation.itemId),
    ]),
  ];
  await lockItemsInTx(tx, allocationItemIds);
  if (allocationItemIds.length > 0) {
    await tx
      .select({ id: stockAllocations.id })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, params.organizationId),
          inArray(stockAllocations.itemId, allocationItemIds),
          eq(stockAllocations.status, "active")
        )
      )
      .orderBy(asc(stockAllocations.itemId), asc(stockAllocations.id))
      .for("update");
  }

  const manualByItemId = new Map<
    string,
    Array<{ sourceId: string; quantity: number }>
  >();
  const sourcesByItemId = new Map<
    string,
    Awaited<ReturnType<typeof loadAllocationSourcesForItemInTx>>
  >();
  const freeQtyBySourceKey = new Map<string, number>();

  const loadSourcesForItem = async (itemId: string) => {
    const existing = sourcesByItemId.get(itemId);
    if (existing) return existing;

    const sources = await loadAllocationSourcesForItemInTx(tx, {
      organizationId: params.organizationId,
      itemId,
    });
    sourcesByItemId.set(itemId, sources);
    sources.forEach((source) => {
      freeQtyBySourceKey.set(
        source.sourceKey,
        normalizeQuantityNumber(Number(source.maxQtyForPrimaryDemand))
      );
    });
    return sources;
  };

  const consumeFreeQty = (sourceKey: string, quantity: number) => {
    freeQtyBySourceKey.set(
      sourceKey,
      normalizeQuantityNumber((freeQtyBySourceKey.get(sourceKey) ?? 0) - quantity)
    );
  };

  for (const row of params.lotAllocations) {
    const bySourceId = new Map<string, number>();
    for (const allocation of row.allocations ?? []) {
      const quantity = Number(allocation.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      bySourceId.set(
        allocation.sourceId,
        normalizeQuantityNumber((bySourceId.get(allocation.sourceId) ?? 0) + quantity)
      );
    }

    if (bySourceId.size > 0) {
      manualByItemId.set(
        row.itemId,
        [...bySourceId.entries()].map(([sourceId, quantity]) => ({
          sourceId,
          quantity,
        }))
      );
    }
  }

  for (const ingredient of params.ingredients) {
    let remainingNeed = normalizeQuantityNumber(Number(ingredient.plannedQuantity));
    if (remainingNeed <= 0) continue;

    const manualAllocations = manualByItemId.get(ingredient.itemId) ?? [];
    for (const allocation of manualAllocations) {
      if (remainingNeed <= 0) break;
      if (allocation.quantity <= 0) continue;

      const quantity = normalizeQuantityNumber(Math.min(remainingNeed, allocation.quantity));
      const sources = await loadSourcesForItem(ingredient.itemId);
      const source = sources.find(
        (candidate) =>
          candidate.sourceType === "inventory_lot" &&
          candidate.sourceId === allocation.sourceId
      );

      if (!source) {
        throw new ManufacturingError("Selected ingredient lot is no longer available.", 409);
      }

      const freeQty = freeQtyBySourceKey.get(source.sourceKey) ?? 0;
      if (quantity > freeQty) {
        throw new ManufacturingError(
          `${source.label} only has ${normalizeNumeric(freeQty)} available.`,
          409
        );
      }

      await insertManufacturingIngredientLotAllocationInTx(tx, {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId ?? null,
        ingredientId: ingredient.ingredientId,
        itemId: ingredient.itemId,
        lotId: allocation.sourceId,
        quantity,
        sourceLabelSnapshot: source.label,
      });
      consumeFreeQty(source.sourceKey, quantity);
      allocation.quantity = normalizeQuantityNumber(allocation.quantity - quantity);
      remainingNeed = normalizeQuantityNumber(remainingNeed - quantity);
    }

    if (remainingNeed <= 0) continue;

    const autoSources = orderLotSourcesForStrategy(
      await loadSourcesForItem(ingredient.itemId),
      ingredient.lotStrategy ?? "fifo"
    );

    for (const source of autoSources) {
      if (remainingNeed <= 0) break;
      if (source.sourceType !== "inventory_lot") continue;

      const freeQty = freeQtyBySourceKey.get(source.sourceKey) ?? 0;
      const quantity = normalizeQuantityNumber(Math.min(remainingNeed, freeQty));
      if (quantity <= 0) continue;

      await insertManufacturingIngredientLotAllocationInTx(tx, {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId ?? null,
        ingredientId: ingredient.ingredientId,
        itemId: ingredient.itemId,
        lotId: source.sourceId,
        quantity,
        sourceLabelSnapshot: source.label,
      });
      consumeFreeQty(source.sourceKey, quantity);
      remainingNeed = normalizeQuantityNumber(remainingNeed - quantity);
    }

    // Lot holds are opportunistic. Short ingredients should warn in planning and
    // picking, but they must not block creating/releasing the MO.
  }

  const overAllocatedItem = [...manualByItemId.entries()].find(([, allocations]) =>
    allocations.some((allocation) => allocation.quantity > 0.0001)
  );
  if (overAllocatedItem) {
    throw new ManufacturingError(
      "Ingredient lot allocations cannot exceed planned ingredient demand.",
      400
    );
  }
}

function orderLotSourcesForStrategy(
  sources: Awaited<ReturnType<typeof loadAllocationSourcesForItemInTx>>,
  strategy: ManufacturingLotStrategy
) {
  const inventoryLots = sources.filter((source) => source.sourceType === "inventory_lot");
  if (strategy === "lifo") {
    return [...inventoryLots].reverse();
  }
  return inventoryLots;
}

async function prepareUpdatedIngredientsInTx(
  tx: Tx,
  manufacturingOrderId: string,
  bomRevisionId: string | null,
  outputQuantity: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"]
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
  const bomBySortOrder = new Map(bomRows.map((row) => [row.sortOrder, row]));
  const recipeBasis = normalizeRecipeBasis(bomRevision?.recipeBasis);
  const recipeOutputQuantity = bomRevision?.outputQuantity ?? "1";
  const activeItemById = await getActiveIngredientItemMapInTx(
    tx,
    submittedIngredients.map((row) => row.itemId)
  );

  return submittedIngredients.map((submitted, index) => {
    const row = bomBySortOrder.get(index);
    const activeItem = activeItemById.get(submitted.itemId);
    if (!activeItem) {
      throw new ManufacturingError(
        "One or more ingredients are no longer active. Update the order before releasing it.",
        400
      );
    }
    const selected = row
      ? tryGetApprovedBomMaterialOption(row, submitted.itemId) ?? {
          itemId: activeItem.id,
          itemName: activeItem.name,
          itemSku: activeItem.sku,
          itemType: activeItem.itemType,
          unitName: activeItem.unitName,
          quantityPerUnit: submitted.quantityPerUnit,
        }
      : {
          itemId: activeItem.id,
          itemName: activeItem.name,
          itemSku: activeItem.sku,
          itemType: activeItem.itemType,
          unitName: activeItem.unitName,
          quantityPerUnit: submitted.quantityPerUnit,
        };
    const quantityPerUnit = normalizeNumeric(Number(submitted.quantityPerUnit));

    return {
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
      }),
      sortOrder: index,
      constraints: row?.constraints ?? [],
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

async function validateActiveIngredientItemsInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) return;

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
      id: manufacturingOrderIngredientConstraints.id,
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
      id: row.id,
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

async function getEditableManufacturingIngredientSnapshotInTx(
  tx: Tx,
  manufacturingOrderId: string
): Promise<EditableManufacturingIngredientSnapshotRow[]> {
  const templateRows = await tx
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
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(
        manufacturingOrderIngredients.actualCostTotal
      ).as("actualCostTotal"),
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

  if (templateRows.length > 0) {
    return templateRows.map((row) => ({
      ...row,
      pickStatus: row.pickStatus as ManufacturingPickStatus,
      lotStrategy: row.lotStrategy as ManufacturingLotStrategy,
    }));
  }

  const batchRows = await tx
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
      plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
        "plannedQuantity"
      ),
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
      pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
        "pickedQuantity"
      ),
      pickStatus: manufacturingOrderIngredients.pickStatus,
      actualQuantity: trimScaleNullable(manufacturingOrderIngredients.actualQuantity).as(
        "actualQuantity"
      ),
      actualCostTotal: trimScaleNullable(
        manufacturingOrderIngredients.actualCostTotal
      ).as("actualCostTotal"),
      sortOrder: manufacturingOrderIngredients.sortOrder,
      batchNumber: manufacturingOrderBatches.batchNumber,
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrderBatches,
      eq(
        manufacturingOrderIngredients.manufacturingOrderBatchId,
        manufacturingOrderBatches.id
      )
    )
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId))
    .orderBy(
      asc(manufacturingOrderIngredients.sortOrder),
      asc(manufacturingOrderBatches.batchNumber)
    );

  const rows: EditableManufacturingIngredientSnapshotRow[] = [];

  for (const row of batchRows) {
    if (rows.some((ingredient) => ingredient.sortOrder === row.sortOrder)) {
      continue;
    }

    rows.push({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      itemType: row.itemType,
      unitName: row.unitName,
      quantityPerUnit: row.quantityPerUnit,
      plannedQuantity: row.plannedQuantity,
      pickedQuantity: row.pickedQuantity,
      pickStatus: row.pickStatus as ManufacturingPickStatus,
      actualQuantity: row.actualQuantity,
      actualCostTotal: row.actualCostTotal,
      sortOrder: row.sortOrder,
    });
  }

  return rows;
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
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
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
    lotStrategy: row.lotStrategy as ManufacturingLotStrategy,
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
      lotStrategy: manufacturingOrderIngredients.lotStrategy,
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
    lotStrategy: row.lotStrategy as ManufacturingLotStrategy,
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
  if (
    order.manufacturingMode !== "batch" ||
    order.status !== "open"
  ) {
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

  const expectedBatchYield = parseFloat(order.expectedBatchYield);
  const plannedOutputQuantity = parseFloat(order.plannedQuantity);
  let remainingOutputQuantity = plannedOutputQuantity;

  const batchRows = Array.from({ length: order.numberOfBatches }, (_, index) => {
    const plannedQuantity =
      index === order.numberOfBatches! - 1
        ? remainingOutputQuantity
        : Math.min(expectedBatchYield, remainingOutputQuantity);
    remainingOutputQuantity = normalizeQuantityNumber(
      remainingOutputQuantity - plannedQuantity
    );

    return {
      manufacturingOrderId: order.id,
      batchNumber: index + 1,
      plannedQuantity: normalizeNumeric(plannedQuantity),
    };
  });

  const insertedBatches = await tx
    .insert(manufacturingOrderBatches)
    .values(batchRows)
    .returning({
      id: manufacturingOrderBatches.id,
      batchNumber: manufacturingOrderBatches.batchNumber,
      plannedQuantity: trimScale(manufacturingOrderBatches.plannedQuantity).as(
        "plannedQuantity"
      ),
    });

  const batchIngredientInputs = insertedBatches.flatMap((batch) =>
    templateIngredients.map((ingredient) => {
      return {
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
      };
    })
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

type ManufacturingOutputConsumptionInput = {
  manufacturingOrderIngredientId: string;
  lotId: string;
  quantityUsed: string;
  costPerUnit: string;
};

async function insertManufacturingOrderOutputInTx(
  tx: Tx,
  params: {
    manufacturingOrderId: string;
    manufacturingOrderBatchId: string | null;
    lotId: string;
    quantity: number;
    disposition: Extract<InventoryDisposition, "available" | "blocked">;
    materialCostTotal: number;
    notes?: string | null;
    actorUserId: string | null;
    consumptions: ManufacturingOutputConsumptionInput[];
  }
) {
  const [output] = await tx
    .insert(manufacturingOrderOutputs)
    .values({
      manufacturingOrderId: params.manufacturingOrderId,
      manufacturingOrderBatchId: params.manufacturingOrderBatchId,
      lotId: params.lotId,
      outputNumber: await nextOutputNumberInTx(tx, params.manufacturingOrderId),
      quantity: normalizeNumeric(params.quantity),
      disposition: params.disposition,
      unitCost:
        params.quantity > 0
          ? normalizeNumericScale(params.materialCostTotal / params.quantity, 6)
          : normalizeNumericScale(0, 6),
      materialCostTotal: normalizeNumericScale(params.materialCostTotal, 6),
      notes: params.notes ?? null,
      createdBy: params.actorUserId ?? "system",
    })
    .returning({ id: manufacturingOrderOutputs.id });

  if (params.consumptions.length > 0) {
    await tx.insert(manufacturingOrderOutputConsumptions).values(
      params.consumptions.map((row) => ({
        manufacturingOrderOutputId: output.id,
        ...row,
      }))
    );
  }

  return output;
}

function buildOutputConsumptionsFromPickedAllocations(
  ingredients: Array<{ ingredientId: string; actualQuantity: number }>,
  allocationsByIngredient: Map<
    string,
    Array<{ lotId: string; quantityUsed: string; costPerUnit: string | null }>
  >
) {
  const rows: ManufacturingOutputConsumptionInput[] = [];

  for (const ingredient of ingredients) {
    let remainingQuantity = normalizeQuantityNumber(ingredient.actualQuantity);
    if (remainingQuantity <= 0) {
      continue;
    }

    const allocations = allocationsByIngredient.get(ingredient.ingredientId) ?? [];
    for (const allocation of allocations) {
      if (remainingQuantity <= 0) {
        break;
      }

      const allocationQuantity = parseFloat(allocation.quantityUsed);
      const quantityUsed = normalizeQuantityNumber(
        Math.min(remainingQuantity, allocationQuantity)
      );
      if (quantityUsed <= 0) {
        continue;
      }

      const costPerUnit = allocation.costPerUnit != null ? parseFloat(allocation.costPerUnit) : 0;
      rows.push({
        manufacturingOrderIngredientId: ingredient.ingredientId,
        lotId: allocation.lotId,
        quantityUsed: normalizeNumericScale(quantityUsed, 4),
        costPerUnit: normalizeNumericScale(costPerUnit, 6),
      });
      remainingQuantity = normalizeQuantityNumber(remainingQuantity - quantityUsed);
    }
  }

  return rows;
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

async function getExecutionLotAllocationsByIngredientInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  const allocations = new Map<string, ExecutionIngredientLotAllocation[]>();
  if (uniqueIds.length === 0) {
    return allocations;
  }

  const consumedRows = await tx
    .select({
      ingredientId: manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      lotId: manufacturingOrderOutputConsumptions.lotId,
      lotNumber: lots.lotNumber,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputConsumptions.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingOrderOutputConsumptions)
    .innerJoin(lots, eq(manufacturingOrderOutputConsumptions.lotId, lots.id))
    .where(
      inArray(manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId, uniqueIds)
    )
    .groupBy(
      manufacturingOrderOutputConsumptions.manufacturingOrderIngredientId,
      manufacturingOrderOutputConsumptions.lotId,
      lots.lotNumber
    )
    .orderBy(asc(lots.lotNumber));

  for (const row of consumedRows) {
    const rows = allocations.get(row.ingredientId) ?? [];
    rows.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: row.quantity,
      sourceType: "consumed",
      sourceId: row.lotId,
      sourceLabel: row.lotNumber,
    });
    allocations.set(row.ingredientId, rows);
  }

  const unconsumedIngredientIds = uniqueIds.filter((id) => !allocations.has(id));
  if (unconsumedIngredientIds.length === 0) {
    return allocations;
  }

  const pickedRows = await tx
    .select({
      ingredientId: manufacturingPickAllocations.manufacturingOrderIngredientId,
      lotId: manufacturingPickAllocations.lotId,
      lotNumber: lots.lotNumber,
      quantity: trimScale(
        sql`COALESCE(SUM(${manufacturingPickAllocations.quantityUsed}), 0)`
      ).as("quantity"),
    })
    .from(manufacturingPickAllocations)
    .innerJoin(lots, eq(manufacturingPickAllocations.lotId, lots.id))
    .where(
      inArray(
        manufacturingPickAllocations.manufacturingOrderIngredientId,
        unconsumedIngredientIds
      )
    )
    .groupBy(
      manufacturingPickAllocations.manufacturingOrderIngredientId,
      manufacturingPickAllocations.lotId,
      lots.lotNumber
    )
    .orderBy(asc(lots.lotNumber));

  for (const row of pickedRows) {
    const rows = allocations.get(row.ingredientId) ?? [];
    rows.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: row.quantity,
      sourceType: "picked",
      sourceId: row.lotId,
      sourceLabel: row.lotNumber,
    });
    allocations.set(row.ingredientId, rows);
  }

  const unpickedIngredientIds = unconsumedIngredientIds.filter(
    (id) => !allocations.has(id)
  );
  if (unpickedIngredientIds.length === 0) {
    return allocations;
  }

  const heldRows = await tx
    .select({
      ingredientId: stockAllocations.demandId,
      lotId: stockAllocations.sourceId,
      lotNumber: lots.lotNumber,
      sourceLabel: stockAllocations.sourceLabelSnapshot,
      quantity: trimScale(sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`).as(
        "quantity"
      ),
    })
    .from(stockAllocations)
    .innerJoin(lots, eq(stockAllocations.sourceId, lots.id))
    .where(
      and(
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        inArray(stockAllocations.demandId, unpickedIngredientIds),
        eq(stockAllocations.sourceType, "inventory_lot"),
        eq(stockAllocations.status, "active")
      )
    )
    .groupBy(
      stockAllocations.demandId,
      stockAllocations.sourceId,
      lots.lotNumber,
      stockAllocations.sourceLabelSnapshot
    )
    .orderBy(asc(lots.lotNumber));

  for (const row of heldRows) {
    const rows = allocations.get(row.ingredientId) ?? [];
    rows.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: row.quantity,
      sourceType: "inventory_lot",
      sourceId: row.lotId,
      sourceLabel: row.sourceLabel ?? row.lotNumber,
    });
    allocations.set(row.ingredientId, rows);
  }

  return allocations;
}

async function getExecutionLotPickPlansByIngredientInTx(
  tx: Tx,
  organizationId: string,
  ingredients: ManufacturingOrderIngredientDetail[]
) {
  const plans = new Map<string, LotPickPlanEntry[]>();

  for (const ingredient of ingredients) {
    const existingAllocations = ingredient.lotAllocations ?? [];
    const lotPlan: LotPickPlanEntry[] = existingAllocations.map((allocation) => ({
      lotId: allocation.lotId,
      lotNumber: allocation.lotNumber,
      quantity: allocation.quantity,
      unitName: ingredient.unitName,
      sourceType: allocation.lotId ? ("inventory_lot" as const) : null,
      sourceId: allocation.sourceId,
      sourceLabel: allocation.sourceLabel,
      kind:
        allocation.sourceType === "picked" || allocation.sourceType === "consumed"
          ? ("picked" as const)
          : ("allocated" as const),
      status: "ready" as const,
    }));

    const allocatedQuantity = roundQuantity(
      existingAllocations.reduce(
        (sum, allocation) => sum + Number(allocation.quantity),
        0
      )
    );
    const remainingQuantity = getRemainingQuantityNumber(
      ingredient.plannedQuantity,
      ingredient.pickedQuantity
    );
    const fifoQuantity = roundQuantity(remainingQuantity - allocatedQuantity);
    if (fifoQuantity > 0) {
      const unavailableByLotId = new Map<string, number>();
      for (const allocation of existingAllocations) {
        if (!allocation.lotId) continue;
        unavailableByLotId.set(
          allocation.lotId,
          roundQuantity(
            (unavailableByLotId.get(allocation.lotId) ?? 0) +
              Number(allocation.quantity)
          )
        );
      }
      lotPlan.push(
        ...(await buildFifoLotPickPlanInTx(tx, {
          organizationId,
          itemId: ingredient.itemId,
          quantity: fifoQuantity,
          unitName: ingredient.unitName,
          unavailableByLotId,
        }))
      );
    }

    plans.set(ingredient.id, lotPlan);
  }

  return plans;
}

function getExecutionLotAllocationsByItemId(
  rows: Array<{ id: string; itemId: string }>,
  allocationsByIngredientId: Map<string, ExecutionIngredientLotAllocation[]>
) {
  const itemAllocations = new Map<string, ExecutionIngredientLotAllocation[]>();

  for (const row of rows) {
    const allocations = allocationsByIngredientId.get(row.id) ?? [];
    if (allocations.length === 0) continue;

    const existingAllocations = itemAllocations.get(row.itemId) ?? [];
    for (const allocation of allocations) {
      const existing = existingAllocations.find(
        (candidate) =>
          candidate.sourceType === allocation.sourceType &&
          candidate.sourceId === allocation.sourceId &&
          candidate.lotId === allocation.lotId
      );
      if (existing) {
        existing.quantity = normalizeNumeric(
          Number(existing.quantity) + Number(allocation.quantity)
        );
      } else {
        existingAllocations.push({ ...allocation });
      }
    }
    itemAllocations.set(row.itemId, existingAllocations);
  }

  return itemAllocations;
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
        lotStrategy: row.lotStrategy,
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

function getIngredientReadiness(params: {
  status: ManufacturingOrderStatus;
  pickProgressStatus: ManufacturingPickProgressStatus;
  ingredients: Array<{
    itemId: string;
    plannedQuantity: string;
    inStockQuantity: number;
    expectedQuantity: number;
  }>;
}): ManufacturingIngredientReadiness {
  if (params.status === "done") return "picked";

  if (params.status === "open") {
    if (params.pickProgressStatus === "picked") return "picked";
  }

  if (params.ingredients.length === 0) return "not_available";

  let hasExpectedCoverage = false;

  for (const ingredient of params.ingredients) {
    const needed = Number.parseFloat(ingredient.plannedQuantity);
    if (!Number.isFinite(needed)) return "not_available";

    const available = ingredient.inStockQuantity;
    const expected = ingredient.expectedQuantity;

    if (available >= needed) {
      continue;
    }

    if (available + expected >= needed) {
      hasExpectedCoverage = true;
      continue;
    }

    return "not_available";
  }

  if (hasExpectedCoverage) return "expected";
  return params.pickProgressStatus === "in_progress" ? "picking" : "in_stock";
}

export async function getManufacturingOrders(): Promise<ManufacturingOrderListRow[]> {
  return measureObservedOperation(
    "manufacturing.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx, orgId) => {
        const orders = (await tx
          .select({
            id: manufacturingOrders.id,
            orderNumber: manufacturingOrders.orderNumber,
            productId: manufacturingOrders.productId,
            productName: manufacturingOrders.productName,
            productSku: manufacturingOrders.productSku,
            productCategory: items.category,
            productFamilyName: itemFamilies.name,
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
            isBlocked: manufacturingOrders.isBlocked,
            manufacturingMode: manufacturingOrders.manufacturingMode,
            numberOfBatches: manufacturingOrders.numberOfBatches,
            startedAt: manufacturingOrders.startedAt,
            deletedAt: manufacturingOrders.deletedAt,
            createdAt: manufacturingOrders.createdAt,
            updatedAt: manufacturingOrders.updatedAt,
            completedAt: manufacturingOrders.completedAt,
          })
          .from(manufacturingOrders)
          .leftJoin(items, eq(manufacturingOrders.productId, items.id))
          .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
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
            | "ingredientReadiness"
            | "ingredientShortages"
            | "ingredientCoverage"
            | "operationResources"
            | "completedBatchCount"
            | "actionableBatchCount"
            | "itemSpriteKind"
            | "itemSpriteColor"
          > & {
            productId: string;
            productFamilyName: string | null;
          }
        >;

        if (orders.length === 0) {
          return [];
        }

        const orderIds = orders.map((order) => order.id);
        const optionLabelsByItemId = await getManufacturingOptionLabelsByItemIdInTx(
          tx,
          orders.map((order) => order.productId)
        );
        const ingredientRows = await tx
          .select({
            id: manufacturingOrderIngredients.id,
            manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
            manufacturingOrderBatchId: manufacturingOrderIngredients.manufacturingOrderBatchId,
            itemId: manufacturingOrderIngredients.itemId,
            itemName: manufacturingOrderIngredients.itemName,
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

        const operationResourceRows = await tx
          .select({
            manufacturingOrderId:
              manufacturingOrderOperationCosts.manufacturingOrderId,
            resourceId: manufacturingOrderOperationCosts.resourceId,
            resourceName: manufacturingOrderOperationCosts.resourceName,
            resourceType: manufacturingOrderOperationCosts.resourceType,
            sortOrder: manufacturingOrderOperationCosts.sortOrder,
          })
          .from(manufacturingOrderOperationCosts)
          .where(
            inArray(manufacturingOrderOperationCosts.manufacturingOrderId, orderIds)
          )
          .orderBy(
            asc(manufacturingOrderOperationCosts.manufacturingOrderId),
            asc(manufacturingOrderOperationCosts.sortOrder)
          );

        const operationResourcesByOrder = new Map<
          string,
          ManufacturingOrderListRow["operationResources"]
        >();
        for (const row of operationResourceRows) {
          const existing =
            operationResourcesByOrder.get(row.manufacturingOrderId) ?? [];
          const resourceKey =
            row.resourceId ?? `${row.resourceType}:${row.resourceName}`;
          if (
            existing.some(
              (resource) =>
                (resource.id ?? `${resource.type}:${resource.name}`) ===
                resourceKey
            )
          ) {
            continue;
          }

          existing.push({
            id: row.resourceId,
            name: row.resourceName,
            type: row.resourceType,
          });
          operationResourcesByOrder.set(row.manufacturingOrderId, existing);
        }

        const ingredientsByOrder = new Map<string, IngredientProgressRow[]>();
        const readinessQuantityByOrderItem = new Map<string, Map<string, number>>();
        for (const row of ingredientRows) {
          if (row.manufacturingOrderBatchId == null) {
            const existing = ingredientsByOrder.get(row.manufacturingOrderId) ?? [];
            existing.push({
              plannedQuantity: row.plannedQuantity,
              pickedQuantity: row.pickedQuantity,
            });
            ingredientsByOrder.set(row.manufacturingOrderId, existing);
          }

          const remainingQuantity = getRemainingQuantityNumber(
            row.plannedQuantity,
            row.pickedQuantity
          );
          if (remainingQuantity <= 0) continue;

          const orderReadiness =
            readinessQuantityByOrderItem.get(row.manufacturingOrderId) ??
            new Map<string, number>();
          orderReadiness.set(
            row.itemId,
            normalizeQuantityNumber(
              (orderReadiness.get(row.itemId) ?? 0) + remainingQuantity
            )
          );
          readinessQuantityByOrderItem.set(
            row.manufacturingOrderId,
            orderReadiness
          );
        }
        const readinessIngredientsByOrder = new Map(
          [...readinessQuantityByOrderItem.entries()].map(([orderId, rows]) => [
            orderId,
            [...rows.entries()].map(([itemId, plannedQuantity]) => {
              const matchingIngredient = ingredientRows.find(
                (ingredient) =>
                  ingredient.manufacturingOrderId === orderId &&
                  ingredient.itemId === itemId
              );

              return {
                itemId,
                itemName: matchingIngredient?.itemName ?? "Ingredient",
                plannedQuantity: normalizeNumeric(plannedQuantity),
              };
            }),
          ])
        );

        const batchesByOrder = new Map<string, Array<{ status: ManufacturingBatchStatus }>>();
        for (const row of batchRows) {
          const existing = batchesByOrder.get(row.manufacturingOrderId) ?? [];
          existing.push({ status: row.status as ManufacturingBatchStatus });
          batchesByOrder.set(row.manufacturingOrderId, existing);
        }

        const ingredientItemIds = [
          ...new Set(
            [...readinessIngredientsByOrder.values()]
              .flat()
              .map((ingredient) => ingredient.itemId)
          ),
        ];
        const ingredientCoverageByOrderItem = new Map<
          string,
          { inStockQuantity: number; expectedQuantity: number }
        >();

        if (ingredientItemIds.length > 0) {
          const coverageByDemandKey =
            await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
              organizationId: orgId,
              itemIds: ingredientItemIds,
              includeManufacturingDetail: true,
            });

          for (const ingredient of ingredientRows) {
            const remainingQuantity = getRemainingQuantityNumber(
              ingredient.plannedQuantity,
              ingredient.pickedQuantity
            );
            if (remainingQuantity <= 0) continue;

            const coverage = coverageByDemandKey.get(
              demandQueueCoverageKey({
                demandType: "manufacturing_order_ingredient",
                demandId: ingredient.id,
              })
            );
            if (!coverage) continue;

            const key = `${ingredient.manufacturingOrderId}:${ingredient.itemId}`;
            const existing =
              ingredientCoverageByOrderItem.get(key) ?? {
                inStockQuantity: 0,
                expectedQuantity: 0,
              };
            ingredientCoverageByOrderItem.set(key, {
              inStockQuantity: normalizeQuantityNumber(
                existing.inStockQuantity +
                  (Number.parseFloat(coverage.inStockQty) || 0)
              ),
              expectedQuantity: normalizeQuantityNumber(
                existing.expectedQuantity +
                  (Number.parseFloat(coverage.expectedQty) || 0)
              ),
            });
          }
        }

        return orders.map(({ productFamilyName, ...order }) => {
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
          const optionLabels = optionLabelsByItemId.get(order.productId) ?? [];
          const display = {
            masterName: productFamilyName ?? order.productName,
            attrs: optionLabels,
          };
          const itemVisual = inferItemVisual({
            itemType: "product",
            category: order.productCategory,
            unitName: order.unitName,
            sku: order.productSku,
            name: order.productName,
          });
          const ingredientShortages = (
            readinessIngredientsByOrder.get(order.id) ?? []
          ).flatMap((ingredient) => {
            const coverage = ingredientCoverageByOrderItem.get(
              `${order.id}:${ingredient.itemId}`
            ) ?? { inStockQuantity: 0, expectedQuantity: 0 };
            const needed = Number.parseFloat(ingredient.plannedQuantity);
            const available = coverage.inStockQuantity;

            if (!Number.isFinite(needed) || available >= needed) {
              return [];
            }

            return [
              {
                itemId: ingredient.itemId,
                itemName: ingredient.itemName,
                needed: normalizeNumeric(needed),
                available: normalizeNumeric(available),
              },
            ];
          });
          const ingredientCoverage = (
            readinessIngredientsByOrder.get(order.id) ?? []
          ).map((ingredient) => {
            const coverage = ingredientCoverageByOrderItem.get(
              `${order.id}:${ingredient.itemId}`
            ) ?? { inStockQuantity: 0, expectedQuantity: 0 };

            return {
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              needed: ingredient.plannedQuantity,
              available: normalizeNumeric(coverage.inStockQuantity),
            };
          });

          return {
            ...order,
            productMasterName: display.masterName,
            productAttrs: display.attrs,
            itemSpriteKind: itemVisual.kind,
            itemSpriteColor: itemVisual.color,
            pickProgressStatus,
            pickProgressPercent:
              order.manufacturingMode === "batch" && totalBatchCount > 0
                ? Math.min(100, Math.round((completedBatchCount / totalBatchCount) * 100))
                : getPickProgressPercent(ingredientProgressRows),
            ingredientReadiness: getIngredientReadiness({
              status: order.status,
              pickProgressStatus,
              ingredients: (readinessIngredientsByOrder.get(order.id) ?? []).map(
                (ingredient) => ({
                  ...ingredient,
                  ...(ingredientCoverageByOrderItem.get(
                    `${order.id}:${ingredient.itemId}`
                  ) ?? { inStockQuantity: 0, expectedQuantity: 0 }),
                })
              ),
            }),
            ingredientShortages,
            ingredientCoverage,
            operationResources: operationResourcesByOrder.get(order.id) ?? [],
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
        order.status === "open" &&
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
    .filter((order) => order.status === "open")
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
        productCategory: order.productCategory,
        itemSpriteKind: order.itemSpriteKind,
        itemSpriteColor: order.itemSpriteColor,
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
        familyName: itemFamilies.name,
        sku: items.sku,
        unitName: unitDefinitions.name,
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        typicalBatchSize: trimScaleNullable(items.typicalBatchSize).as(
          "typicalBatchSize"
        ),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(and(eq(items.itemType, "product"), isNull(items.deletedAt), isNotNull(items.familyId)))
      .orderBy(items.name);

    if (products.length === 0) return [];

    const bomByProduct = await getCurrentBomCoverageInTx(
      tx,
      products.map((product) => product.id)
    );
    const optionLabelsByItemId = await getManufacturingOptionLabelsByItemIdInTx(
      tx,
      products.map((product) => product.id)
    );

    return products
      .filter((product) => (bomByProduct.get(product.id) ?? []).length > 0)
      .map((product) => {
        const bomRows = bomByProduct.get(product.id) ?? [];
        const optionLabels = optionLabelsByItemId.get(product.id) ?? [];
        const displayName =
          product.familyName != null && optionLabels.length > 0
            ? `${product.familyName} / ${optionLabels.join(" / ")}`
            : product.familyName ?? product.name;

        return {
          id: product.id,
          name: product.name,
          displayName,
          sku: product.sku,
          unitName: product.unitName,
          typicalBatchSize: product.typicalBatchSize,
          manufacturingMode: product.manufacturingMode,
          expectedBatchYield: product.expectedBatchYield,
          bom: bomRows.map((row) => ({
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
        };
      });
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
          eq(salesOrders.status, "open")
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
          eq(salesOrders.status, "open")
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
      eq(salesOrders.status, "open"),
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
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        unitName: salesOrderLines.unitName,
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        status: salesOrders.status,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .innerJoin(items, eq(salesOrderLines.itemId, items.id))
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
        isBlocked: manufacturingOrders.isBlocked,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        startedAt: manufacturingOrders.startedAt,
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
        actualOperationsCost: trimScaleNullable(manufacturingOrders.actualOperationsCost).as(
          "actualOperationsCost"
        ),
        actualCostPerUnit: trimScaleNullable(manufacturingOrders.actualCostPerUnit).as(
          "actualCostPerUnit"
        ),
        notes: manufacturingOrders.notes,
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
      order.manufacturingMode === "batch"
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
      order.manufacturingMode === "batch"
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
    const operationCosts = await tx
      .select({
        id: manufacturingOrderOperationCosts.id,
        operationName: manufacturingOrderOperationCosts.operationName,
        resourceName: manufacturingOrderOperationCosts.resourceName,
        resourceType: manufacturingOrderOperationCosts.resourceType,
        costScalingMode: manufacturingOrderOperationCosts.costScalingMode,
        crewSize: trimScale(manufacturingOrderOperationCosts.crewSize).as("crewSize"),
        plannedMinutes: trimScale(manufacturingOrderOperationCosts.plannedMinutes).as(
          "plannedMinutes"
        ),
        plannedQuantityBasis: trimScaleNullable(
          manufacturingOrderOperationCosts.plannedQuantityBasis
        ).as("plannedQuantityBasis"),
        loadedCostPerHour: trimScale(
          manufacturingOrderOperationCosts.loadedCostPerHour
        ).as("loadedCostPerHour"),
        plannedCostTotal: trimScale(
          manufacturingOrderOperationCosts.plannedCostTotal
        ).as("plannedCostTotal"),
        actualCostTotal: trimScaleNullable(
          manufacturingOrderOperationCosts.actualCostTotal
        ).as("actualCostTotal"),
        sortOrder: manufacturingOrderOperationCosts.sortOrder,
      })
      .from(manufacturingOrderOperationCosts)
      .where(eq(manufacturingOrderOperationCosts.manufacturingOrderId, id))
      .orderBy(
        asc(manufacturingOrderOperationCosts.sortOrder),
        asc(manufacturingOrderOperationCosts.createdAt)
      );
    const lotAllocationsByIngredientId =
      await getExecutionLotAllocationsByIngredientInTx(
        tx,
        (batchIngredientsWithDetails ?? (rawIngredients as ExecutionIngredientRow[])).map(
          (ingredient) => ingredient.id
        )
      );
    const lotAllocationsByItemId = getExecutionLotAllocationsByItemId(
      batchIngredientsWithDetails ?? (rawIngredients as ExecutionIngredientRow[]),
      lotAllocationsByIngredientId
    );
    const detailIngredients =
      order.bomRevisionId
        ? await (async () => {
            const bomRows = await getBomRevisionComponentsInTx(tx, order.bomRevisionId!);
            return ingredients.map((ingredient) => {
              const bomRow = bomRows.find((row) => row.sortOrder === ingredient.sortOrder);

              if (!bomRow) {
                return {
                  ...ingredient,
                  lotAllocations: lotAllocationsByItemId.get(ingredient.itemId) ?? [],
                };
              }

              return {
                ...ingredient,
                lotAllocations: lotAllocationsByItemId.get(ingredient.itemId) ?? [],
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
        : ingredients.map((ingredient) => ({
            ...ingredient,
            lotAllocations: lotAllocationsByItemId.get(ingredient.itemId) ?? [],
          }));

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
      operationCosts,
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
        organizationId: manufacturingOrders.organizationId,
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
          eq(manufacturingOrders.status, "open")
        )
      );

    if (!order) {
      return null;
    }

    const editableIngredients =
      await getEditableManufacturingIngredientSnapshotInTx(tx, id);
    const allocationIngredientRows = await tx
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));
    const allocationIngredientIds = allocationIngredientRows.map((row) => row.id);
    const lotAllocationRows =
      allocationIngredientIds.length > 0
        ? await tx
            .select({
              itemId: stockAllocations.itemId,
              sourceId: stockAllocations.sourceId,
              quantity: trimScale(
                sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`
              ).as("quantity"),
            })
            .from(stockAllocations)
            .where(
              and(
                eq(stockAllocations.organizationId, order.organizationId),
                eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
                inArray(stockAllocations.demandId, allocationIngredientIds),
                eq(stockAllocations.sourceType, "inventory_lot"),
                eq(stockAllocations.status, "active")
              )
            )
            .groupBy(stockAllocations.itemId, stockAllocations.sourceId)
        : [];
    const lotAllocationsByItemId = new Map<
      string,
      Array<{ sourceId: string; quantity: string }>
    >();
    lotAllocationRows.forEach((row) => {
      const allocations = lotAllocationsByItemId.get(row.itemId) ?? [];
      allocations.push({ sourceId: row.sourceId, quantity: row.quantity });
      lotAllocationsByItemId.set(row.itemId, allocations);
    });

    const bomRows =
      order.bomRevisionId == null
        ? []
        : await getBomRevisionComponentsInTx(tx, order.bomRevisionId);

    const bomBySortOrder = new Map(bomRows.map((row) => [row.sortOrder, row]));

    return {
      ...order,
      ingredients: editableIngredients.map((ingredient) => {
        const bomRow = bomBySortOrder.get(ingredient.sortOrder);
        return {
          id: ingredient.id,
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
      lotAllocations: [...lotAllocationsByItemId.entries()].map(
        ([itemId, allocations]) => ({ itemId, allocations })
      ),
    };
  });
}

export async function createManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  payload: InsertManufacturingOrder,
  actorUserId?: string | null
): Promise<{ id: string }> {
  const product = await getValidatedProductInTx(tx, payload.productId);
  const plannedQuantity = Number(payload.plannedQuantity);

  const salesLink = await validateSalesLineLinkInTx(tx, {
    salesOrderId: payload.salesOrderId,
    salesOrderLineId: payload.salesOrderLineId,
    productId: payload.productId,
  });
  const { bomRevisionId, ingredients } = await prepareCreateIngredientsInTx(
    tx,
    payload.productId,
    plannedQuantity,
    payload.ingredients
  );
  const scalingPlan = deriveScalingPlan(plannedQuantity, ingredients);
  const order = await insertManufacturingOrderInTx(tx, orgId, {
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
    ingredients,
  });

  const lockedOrder = await getLockedManufacturingOrderInTx(tx, order.id);
  if (!lockedOrder) {
    throw new ManufacturingError("Order not found", 404);
  }
  await activateManufacturingOrderInTx(tx, orgId, lockedOrder, {
    actorUserId,
    lotAllocations: payload.lotAllocations,
    autoAllocateIngredientLots: payload.autoAllocateIngredientLots,
  });

  return { id: order.id };
}

export async function createManufacturingOrder(
  payload: InsertManufacturingOrder
): Promise<{ id: string }> {
  return withAuthedOrgContext((tx, orgId, userId) =>
    createManufacturingOrderInTx(tx, orgId, payload, userId)
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
  payload: CreateManufacturingOrdersFromSalesOrder,
  actorUserId?: string | null
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

  const plannedDate = payload.plannedDate ?? order.shipDate ?? null;
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
    const plannedQuantity = Number(requestedQuantity);
    const { bomRevisionId, ingredients } = await prepareCreateIngredientsFromBomInTx(
      tx,
      line.itemId,
      plannedQuantity
    );
    const scalingPlan = deriveScalingPlan(plannedQuantity, ingredients);
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
      manufacturingMode: scalingPlan.manufacturingMode,
      numberOfBatches: scalingPlan.numberOfBatches,
      expectedBatchYield: scalingPlan.expectedBatchYield,
      priorityRank: null,
      plannedDate,
      notes: payload.notes ?? null,
      ingredients,
    });
    const lockedOrder = await getLockedManufacturingOrderInTx(tx, createdOrder.id);
    if (!lockedOrder) {
      throw new ManufacturingError("Order not found", 404);
    }
    await activateManufacturingOrderInTx(tx, orgId, lockedOrder, {
      actorUserId,
      lotAllocations: [],
      autoAllocateIngredientLots: false,
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
  return withAuthedOrgContext(async (tx, orgId, userId) =>
    createManufacturingOrdersFromSalesOrderInTx(
      tx,
      orgId,
      salesOrderId,
      payload,
      userId
    )
  );
}

export async function updateManufacturingOrder(
  id: string,
  payload: UpdateManufacturingOrder
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const existing = await getLockedManufacturingOrderInTx(tx, id);

    if (!existing) {
      return null;
    }

    if (existing.status !== "open") {
      throw new ManufacturingError("Only open orders can be edited", 400);
    }

    if (isOpenManufacturingOrder(existing)) {
      const existingIngredientIds = await tx
        .select({ id: manufacturingOrderIngredients.id })
        .from(manufacturingOrderIngredients)
        .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));
      const ingredientIds = existingIngredientIds.map((ingredient) => ingredient.id);
      const pickedRows =
        ingredientIds.length > 0
          ? await tx
              .select({ id: manufacturingPickAllocations.id })
              .from(manufacturingPickAllocations)
              .where(
                inArray(
                  manufacturingPickAllocations.manufacturingOrderIngredientId,
                  ingredientIds
                )
              )
              .limit(1)
          : [];
      const activeBatchRows =
        existing.manufacturingMode === "batch"
          ? await tx
              .select({ id: manufacturingOrderBatches.id })
              .from(manufacturingOrderBatches)
              .where(
                and(
                  eq(manufacturingOrderBatches.manufacturingOrderId, id),
                  ne(manufacturingOrderBatches.status, "pending")
                )
              )
              .limit(1)
          : [];

      if (pickedRows.length > 0 || activeBatchRows.length > 0) {
        throw new ManufacturingError(
          "Orders cannot be edited after picking or batch work starts.",
          400
        );
      }
    }

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
          payload.ingredients
        )
      : await prepareUpdatedIngredientsInTx(
          tx,
          id,
          existing.bomRevisionId,
          plannedQuantity,
          payload.ingredients
        ).then((result) => ({
          bomRevisionId: existing.bomRevisionId,
          ingredients: result,
        }));
    const scalingPlan = deriveScalingPlan(plannedQuantity, ingredients);
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

    await cancelActiveStockAllocationsInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      demandType: "manufacturing_order_ingredient",
      demandIds: existingIngredientRows.map((row) => row.id),
    });

    if (isOpenManufacturingOrder(existing)) {
      await releaseIngredientReservationForManufacturingInTx(tx, {
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
      ingredients
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

      if (payload.autoAllocateIngredientLots) {
        await saveManufacturingIngredientLotAllocationsInTx(tx, {
          organizationId: orgId,
          actorUserId: userId,
          ingredients: demandIngredientRows.map((ingredient) => ({
            ingredientId: ingredient.id,
            itemId: ingredient.itemId,
            plannedQuantity: ingredient.plannedQuantity,
          })),
          lotAllocations: payload.lotAllocations,
        });
      }
    }

    await rerankOpenManufacturingOrdersInTx(tx, orgId);

    return order;
  });
}

/**
 * Inline-edit PATCH for the redesigned MO sheet. This is intentionally limited
 * to metadata that does not affect inventory truth. Quantity and ingredient
 * changes must continue through updateManufacturingOrder so expected supply,
 * ingredient demand, batches, and active allocations stay in sync.
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

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (payload.plannedDate !== undefined) {
      updates.plannedDate = payload.plannedDate ?? null;
    }
    if (payload.notes !== undefined) {
      updates.notes = payload.notes ?? null;
    }
    if (payload.salesOrderId !== undefined || payload.salesOrderLineId !== undefined) {
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
  return withAuthedOrgContext(async (tx, orgId, userId) => {
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
        "Only open orders can change ingredient lot allocations.",
        400
      );
    }

    if (
      existing.pickStatus !== "not_picked" ||
      Number(existing.pickedQuantity) > 0
    ) {
      throw new ManufacturingError(
        "Ingredient lot allocations cannot be changed after picking starts.",
        400
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (payload.lotStrategy !== undefined) {
      updates.lotStrategy = payload.lotStrategy;
    }

    await tx
      .update(manufacturingOrderIngredients)
      .set(updates)
      .where(eq(manufacturingOrderIngredients.id, ingredientId));

    if (
      payload.allocations !== undefined ||
      payload.lotStrategy === "fifo" ||
      payload.lotStrategy === "lifo"
    ) {
      await cancelActiveStockAllocationsInTx(tx, {
        organizationId: orgId,
        actorUserId: userId,
        demandType: "manufacturing_order_ingredient",
        demandIds: [ingredientId],
      });

      await saveManufacturingIngredientLotAllocationsInTx(tx, {
        organizationId: orgId,
        actorUserId: userId,
        ingredients: [
          {
            ingredientId: existing.id,
            itemId: existing.itemId,
            plannedQuantity: existing.plannedQuantity,
            lotStrategy:
              payload.lotStrategy === "fifo" || payload.lotStrategy === "lifo"
                ? payload.lotStrategy
                : (existing.lotStrategy as ManufacturingLotStrategy),
          },
        ],
        lotAllocations: [
          {
            itemId: existing.itemId,
            allocations: payload.allocations ?? [],
          },
        ],
      });
    }

    return { id: existing.id };
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

    if (order.status !== "open") {
      return { id: order.id };
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
          eq(manufacturingOrders.organizationId, orgId),
          inArray(manufacturingOrders.id, payload.orderIds),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .for("update");

    const rankedOpenOrders = await tx
      .select({
        id: manufacturingOrders.id,
        priorityRank: manufacturingOrders.priorityRank,
        orderNumber: manufacturingOrders.orderNumber,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .orderBy(
        asc(sql`COALESCE(${manufacturingOrders.priorityRank}, 2147483647)`),
        asc(manufacturingOrders.orderNumber)
      )
      .for("update");

    assertSameStringSet(
      orders.map((order) => order.id),
      payload.orderIds,
      "Manufacturing order ranking does not match active orders."
    );

    const submittedOpenIds = payload.orderIds.filter((id) => {
      const order = orders.find((candidate) => candidate.id === id);
      return order?.status === "open";
    });

    const orderedIds = mergeSubmittedOrderIds(
      rankedOpenOrders.map((order) => order.id),
      submittedOpenIds
    );

    const now = new Date();
    await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      );

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(manufacturingOrders)
        .set({
          priorityRank: index + 1,
          updatedAt: now,
        })
        .where(eq(manufacturingOrders.id, id));
    }

    return { updated: orderedIds.length };
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

    if (order.status !== "open") {
      throw new ManufacturingError(
        "Only open manufacturing orders can be reordered.",
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

    if (order.manufacturingMode === "batch" && isOpenManufacturingOrder(order)) {
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

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can record output", 400);
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
      const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
        tx,
        orderId,
        totalActualQuantity
      );
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
          actualOperationsCost: normalizeNumericScale(totalOperationsCost, 6),
          actualCostPerUnit:
            totalActualQuantity > 0
              ? normalizeNumeric((totalMaterialCost + totalOperationsCost) / totalActualQuantity)
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
      const requiredQuantity = normalizeQuantityNumber(
        plannedIngredientQuantity * ratio
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
        const consumeIdempotencyKey = deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `consume:${ingredient.id}`
        );
        const heldConsumed = await consumeLotAllocationsForDemandInTx(tx, {
          organizationId: orgId,
          locationId: location.id,
          demandType: "manufacturing_order_ingredient",
          demandId: ingredient.id,
          itemId: ingredient.itemId,
          quantity: remainingRequiredQuantity,
          eventType: "manufacturing_ingredient_consumption",
          eventSubtype: "manufacturing_output",
          referenceType: batch != null ? "manufacturing_batch" : "manufacturing_order",
          referenceId: batch?.id ?? orderId,
          actorUserId: userId,
          idempotencyKey: consumeIdempotencyKey,
          metadata: { manufacturingOrderIngredientId: ingredient.id },
        });
        const unavailableByLotId = await getUnavailableLotAllocationQtyByLotIdInTx(
          tx,
          {
            organizationId: orgId,
            itemId: ingredient.itemId,
            excludeDemand: {
              demandType: "manufacturing_order_ingredient",
              demandId: ingredient.id,
            },
          }
        );
        let fifoConsumed: Awaited<ReturnType<typeof consumeStockFifoInTx>> | {
          allocations: [];
          eventIds: [];
        };
        try {
          fifoConsumed =
            heldConsumed.remainingQuantity > 0
              ? await consumeStockFifoInTx(tx, {
                  organizationId: orgId,
                  locationId: location.id,
                  itemId: ingredient.itemId,
                  quantity: heldConsumed.remainingQuantity,
                  eventType: "manufacturing_ingredient_consumption",
                  eventSubtype: "manufacturing_output",
                  referenceType: batch != null ? "manufacturing_batch" : "manufacturing_order",
                  referenceId: batch?.id ?? orderId,
                  actorUserId: userId,
                  idempotencyKey: heldConsumed.idempotencyUsed ? null : consumeIdempotencyKey,
                  metadata: { manufacturingOrderIngredientId: ingredient.id },
                  unavailableByLotId,
                  allowNegativeStock: payload.confirmNegativeStock === true,
                })
              : { allocations: [], eventIds: [] };
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
              shortage: {
                ingredients: [
                  {
                    itemId: ingredient.itemId,
                    itemName: ingredient.itemName,
                    unitName: ingredient.unitName,
                    needed: error.requested,
                    available: error.available,
                    shortage: normalizeQuantityNumber(error.requested - error.available),
                    warningType: "stock_shortage",
                  },
                ],
              },
            });
          }
          throw error;
        }
        const consumed = {
          allocations: [...heldConsumed.allocations, ...fifoConsumed.allocations],
          eventIds: [...heldConsumed.eventIds, ...fifoConsumed.eventIds],
        };

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
    const existingOrderOutputQuantity = await getTotalOutputQuantityForOrderInTx(
      tx,
      orderId
    );
    const absorbedOperationCost = await getIncrementalAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      existingOrderOutputQuantity,
      outputQuantity
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
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });

    const output = await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batch?.id ?? null,
      lotId: produced.lotId,
      quantity: outputQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal,
      notes: payload.notes,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
    });

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
    const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      totalActualQuantity
    );
    await tx
      .update(manufacturingOrders)
      .set({
        actualQuantity: normalizeNumeric(totalActualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualOperationsCost: normalizeNumericScale(totalOperationsCost, 6),
        actualCostPerUnit:
          totalActualQuantity > 0
            ? normalizeNumeric((totalMaterialCost + totalOperationsCost) / totalActualQuantity)
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

function allocationQuantity(value: string | number) {
  return normalizeNumeric(normalizeQuantityNumber(Number(value)));
}

type SalesOutputDemandRef = {
  demandType: "sales_order_line";
  demandId: string;
  salesOrderLineId: string;
  quantity: number;
  demandLabelSnapshot: string | null;
};

async function getSourceOutputLotIdsInTx(tx: Tx, manufacturingOrderId: string) {
  const rows = await tx
    .select({ lotId: manufacturingOrderOutputs.lotId })
    .from(manufacturingOrderOutputs)
    .where(
      and(
        eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrderId),
        eq(manufacturingOrderOutputs.disposition, "available"),
        sql`${manufacturingOrderOutputs.quantity} > 0`
      )
    )
    .groupBy(manufacturingOrderOutputs.lotId);

  return rows.map((row) => row.lotId);
}

async function getManufacturingOutputAllocationInTx(
  tx: Tx,
  orgId: string,
  orderId: string
) {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productId: manufacturingOrders.productId,
        productName: items.name,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
        actualQuantity: trimScale(manufacturingOrders.actualQuantity).as("actualQuantity"),
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .innerJoin(items, eq(manufacturingOrders.productId, items.id))
      .where(
        and(
          eq(manufacturingOrders.id, orderId),
          eq(manufacturingOrders.organizationId, orgId),
          isNull(manufacturingOrders.deletedAt)
        )
      );

    if (!order) return null;

    const sourceLotIds = await getSourceOutputLotIdsInTx(tx, orderId);
    const activeProductionAllocations = await tx
      .select({
        id: stockAllocations.id,
        ingredientId: stockAllocations.demandId,
        sourceType: stockAllocations.sourceType,
        sourceId: stockAllocations.sourceId,
        quantity: trimScale(stockAllocations.quantity).as("quantity"),
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
          eq(stockAllocations.itemId, order.productId),
          eq(stockAllocations.status, "active"),
          or(
            and(
              eq(stockAllocations.sourceType, "manufacturing_order"),
              eq(stockAllocations.sourceId, orderId)
            ),
            sourceLotIds.length > 0
              ? and(
                  eq(stockAllocations.sourceType, "inventory_lot"),
                  inArray(stockAllocations.sourceId, sourceLotIds)
                )
              : sql`FALSE`
          )
        )
      );

    const candidates = await tx
      .select({
        ingredientId: manufacturingOrderIngredients.id,
        manufacturingOrderId: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productName: items.name,
        outputProductName: items.name,
        outputPlannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "outputPlannedQuantity"
        ),
        outputUnitName: manufacturingOrders.unitName,
        plannedDate: manufacturingOrders.plannedDate,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
          "plannedQuantity"
        ),
        pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
          "pickedQuantity"
        ),
        actualQuantity: trimScale(manufacturingOrderIngredients.actualQuantity).as(
          "actualQuantity"
        ),
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrderIngredients)
      .innerJoin(
        manufacturingOrders,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .innerJoin(items, eq(manufacturingOrders.productId, items.id))
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrderIngredients.itemId, order.productId),
          ne(manufacturingOrders.id, orderId),
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "open")
        )
      )
      .orderBy(asc(manufacturingOrders.plannedDate), asc(manufacturingOrders.orderNumber));

    const allocationQtyByIngredientId = new Map<string, number>();
    for (const allocation of activeProductionAllocations) {
      allocationQtyByIngredientId.set(
        allocation.ingredientId,
        normalizeQuantityNumber(
          (allocationQtyByIngredientId.get(allocation.ingredientId) ?? 0) +
            Number(allocation.quantity)
        )
      );
    }

    const productionDestinations = candidates
      .map((candidate) => {
        const consumedQty = Math.max(
          Number(candidate.pickedQuantity),
          Number(candidate.actualQuantity)
        );
        const remainingNeed = Math.max(
          0,
          normalizeQuantityNumber(Number(candidate.plannedQuantity) - consumedQty)
        );
        const assignedQty = allocationQtyByIngredientId.get(candidate.ingredientId) ?? 0;

        return {
          ingredientId: candidate.ingredientId,
          manufacturingOrderId: candidate.manufacturingOrderId,
          orderNumber: candidate.orderNumber,
          productName: candidate.productName,
          outputProductName: candidate.outputProductName,
          outputPlannedQuantity: candidate.outputPlannedQuantity,
          outputUnitName: candidate.outputUnitName,
          plannedDate: candidate.plannedDate,
          salesOrderNumber: candidate.salesOrderNumber,
          salesCustomerName: candidate.salesCustomerName,
          status: candidate.status,
          remainingNeed: normalizeNumeric(remainingNeed),
          assignedQty: normalizeNumeric(assignedQty),
          shortQty: normalizeNumeric(Math.max(0, remainingNeed - assignedQty)),
        };
      })
      .filter(
        (destination) =>
          Number(destination.remainingNeed) > 0 || Number(destination.assignedQty) > 0
      );

    const assignedProductionQty = activeProductionAllocations.reduce(
      (sum, allocation) => normalizeQuantityNumber(sum + Number(allocation.quantity)),
      0
    );
    const activeSourceAllocations = await tx
      .select({
        demandType: stockAllocations.demandType,
        demandId: stockAllocations.demandId,
        quantity: trimScale(stockAllocations.quantity).as("quantity"),
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          eq(stockAllocations.itemId, order.productId),
          eq(stockAllocations.status, "active"),
          or(
            and(
              eq(stockAllocations.sourceType, "manufacturing_order"),
              eq(stockAllocations.sourceId, orderId)
            ),
            sourceLotIds.length > 0
              ? and(
                  eq(stockAllocations.sourceType, "inventory_lot"),
                  inArray(stockAllocations.sourceId, sourceLotIds)
                )
              : sql`FALSE`
          )
        )
      );
    const assignedTotalQty = activeSourceAllocations.reduce(
      (sum, allocation) => normalizeQuantityNumber(sum + Number(allocation.quantity)),
      0
    );
    const salesSourceAllocations = activeSourceAllocations.flatMap((allocation) =>
      allocation.demandType === "sales_order_line"
        ? [{ ...allocation, salesOrderLineId: allocation.demandId }]
        : []
    );
    const assignedSalesQty = salesSourceAllocations.reduce(
      (sum, allocation) => normalizeQuantityNumber(sum + Number(allocation.quantity)),
      0
    );
    const salesAllocationQtyByLineId = new Map<string, number>();
    salesSourceAllocations.forEach((allocation) => {
      salesAllocationQtyByLineId.set(
        allocation.salesOrderLineId,
        normalizeQuantityNumber(
          (salesAllocationQtyByLineId.get(allocation.salesOrderLineId) ?? 0) +
            Number(allocation.quantity)
        )
      );
    });
    const salesCandidates = await tx
      .select({
        salesOrderLineId: salesOrderLines.id,
        salesOrderId: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        shipDate: salesOrders.shipDate,
        orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
        cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
        shippedQty: shippedSalesOrderLineQuantitySql(),
        plannedQty: plannedSalesOrderLineQuantitySql(),
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          eq(salesOrderLines.itemId, order.productId),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      )
      .orderBy(asc(salesOrders.shipDate), asc(salesOrders.orderNumber));
    const salesDestinations = salesCandidates
      .map((candidate) => {
        const remainingQty = Math.max(
          0,
          normalizeQuantityNumber(
            Number(candidate.orderedQty) -
              Number(candidate.cancelledQty) -
              Number(candidate.shippedQty)
          )
        );
        const unplannedQty = Math.max(
          0,
          normalizeQuantityNumber(remainingQty - Number(candidate.plannedQty))
        );
        const assignedQty =
          salesAllocationQtyByLineId.get(candidate.salesOrderLineId) ?? 0;

        return {
          salesOrderLineId: candidate.salesOrderLineId,
          salesOrderId: candidate.salesOrderId,
          orderNumber: candidate.orderNumber,
          customerName: candidate.customerName,
          shipDate: candidate.shipDate,
          remainingQty: normalizeNumeric(remainingQty),
          assignedQty: normalizeNumeric(assignedQty),
          shortQty: normalizeNumeric(Math.max(0, remainingQty - assignedQty)),
          unplannedQty: normalizeNumeric(unplannedQty),
        };
      })
      .filter(
        (destination) =>
          Number(destination.remainingQty) > 0 || Number(destination.assignedQty) > 0
      );
    const unassignedQty = Math.max(
      0,
      normalizeQuantityNumber(Number(order.plannedQuantity) - assignedTotalQty)
    );

    return {
      sourceMo: order,
      productionDestinations,
      salesDestinations,
      assignedSalesQty: normalizeNumeric(assignedSalesQty),
      assignedProductionQty: normalizeNumeric(assignedProductionQty),
      unassignedQty: normalizeNumeric(unassignedQty),
    };
}

export async function getManufacturingOutputAllocation(orderId: string) {
  return withAuthedOrgContext(async (tx, orgId) =>
    getManufacturingOutputAllocationInTx(tx, orgId, orderId)
  );
}

export async function saveManufacturingOutputAllocation(
  orderId: string,
  payload: SaveManufacturingOutputAllocation
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    const sourceLotIds = await getSourceOutputLotIdsInTx(tx, orderId);
    const normalizedSales = payload.salesAllocations
      .map((allocation) => ({
        salesOrderLineId: allocation.salesOrderLineId,
        quantity: normalizeQuantityNumber(Number(allocation.quantity)),
      }))
      .filter((allocation) => allocation.quantity > 0);
    const normalizedProduction = payload.productionAllocations
      .map((allocation) => ({
        ingredientId: allocation.ingredientId,
        quantity: normalizeQuantityNumber(Number(allocation.quantity)),
      }))
      .filter((allocation) => allocation.quantity > 0);
    const seenSalesLineIds = new Set<string>();
    for (const allocation of normalizedSales) {
      if (seenSalesLineIds.has(allocation.salesOrderLineId)) {
        throw new ManufacturingError("Each sales destination can only appear once.", 400);
      }
      seenSalesLineIds.add(allocation.salesOrderLineId);
    }
    const seenIngredientIds = new Set<string>();
    for (const allocation of normalizedProduction) {
      if (seenIngredientIds.has(allocation.ingredientId)) {
        throw new ManufacturingError("Each production destination can only appear once.", 400);
      }
      seenIngredientIds.add(allocation.ingredientId);
    }

    await tx
      .update(stockAllocations)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: userId,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          inArray(stockAllocations.demandType, [
            "manufacturing_order_ingredient",
            "sales_order_line",
          ]),
          eq(stockAllocations.itemId, order.productId),
          eq(stockAllocations.status, "active"),
          or(
            and(
              eq(stockAllocations.sourceType, "manufacturing_order"),
              eq(stockAllocations.sourceId, orderId)
            ),
            sourceLotIds.length > 0
              ? and(
                  eq(stockAllocations.sourceType, "inventory_lot"),
                  inArray(stockAllocations.sourceId, sourceLotIds)
                )
              : sql`FALSE`
          )
        )
      );

    const salesDestinationRows =
      normalizedSales.length > 0
        ? await tx
            .select({
              salesOrderLineId: salesOrderLines.id,
              itemId: salesOrderLines.itemId,
              orderedQty: trimScale(salesOrderLines.quantity).as("orderedQty"),
              cancelledQty: trimScale(salesOrderLines.cancelledQuantity).as("cancelledQty"),
              shippedQty: shippedSalesOrderLineQuantitySql(),
              plannedQty: plannedSalesOrderLineQuantitySql(),
              status: salesOrders.status,
              deletedAt: salesOrders.deletedAt,
            })
            .from(salesOrderLines)
            .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
            .where(
              and(
                eq(salesOrders.organizationId, orgId),
                inArray(
                  salesOrderLines.id,
                  normalizedSales.map((allocation) => allocation.salesOrderLineId)
                )
              )
            )
            .for("update")
        : [];
    const salesDestinationById = new Map(
      salesDestinationRows.map((destination) => [
        destination.salesOrderLineId,
        destination,
      ])
    );
    const demandRefsForCapacity = [
      ...normalizedSales.map((allocation) => ({
        demandType: "sales_order_line" as const,
        demandId: allocation.salesOrderLineId,
      })),
    ];
    const activeDemandAllocationRows =
      demandRefsForCapacity.length > 0
        ? await tx
            .select({
              demandType: stockAllocations.demandType,
              demandId: stockAllocations.demandId,
              quantity: trimScale(stockAllocations.quantity).as("quantity"),
            })
            .from(stockAllocations)
            .where(
              and(
                eq(stockAllocations.organizationId, orgId),
                eq(stockAllocations.itemId, order.productId),
                eq(stockAllocations.status, "active"),
                or(
                  ...demandRefsForCapacity.map((ref) =>
                    and(
                      eq(stockAllocations.demandType, ref.demandType),
                      eq(stockAllocations.demandId, ref.demandId)
                    )
                  )
                )
              )
            )
        : [];
    const activeQtyByDemandKey = new Map<string, number>();
    for (const allocation of activeDemandAllocationRows) {
      const key = `${allocation.demandType}:${allocation.demandId}`;
      activeQtyByDemandKey.set(
        key,
        normalizeQuantityNumber(
          (activeQtyByDemandKey.get(key) ?? 0) + Number(allocation.quantity)
        )
      );
    }
    const salesDemandRefs: SalesOutputDemandRef[] = [];

    for (const allocation of normalizedSales) {
      const destination = salesDestinationById.get(allocation.salesOrderLineId);
      if (
        !destination ||
        destination.deletedAt != null ||
        destination.status !== "open"
      ) {
        throw new ManufacturingError("Sales destination is no longer open.", 409);
      }
      if (destination.itemId !== order.productId) {
        throw new ManufacturingError("Sales destination does not need this output item.", 409);
      }
      const remainingNeed = Math.max(
        0,
        normalizeQuantityNumber(
          Number(destination.orderedQty) -
            Number(destination.cancelledQty) -
            Number(destination.shippedQty)
        )
      );
      const availableCapacity = Math.max(
        0,
        normalizeQuantityNumber(
          remainingNeed -
            (activeQtyByDemandKey.get(
              `sales_order_line:${allocation.salesOrderLineId}`
            ) ?? 0)
        )
      );
      if (allocation.quantity > availableCapacity) {
        throw new ManufacturingError(
          "Assigned output cannot exceed destination remaining need.",
          409
        );
      }

      salesDemandRefs.push({
        demandType: "sales_order_line",
        demandId: allocation.salesOrderLineId,
        salesOrderLineId: allocation.salesOrderLineId,
        quantity: allocation.quantity,
        demandLabelSnapshot: null,
      });
    }

    const destinationRows =
      normalizedProduction.length > 0
        ? await tx
            .select({
              ingredientId: manufacturingOrderIngredients.id,
              itemId: manufacturingOrderIngredients.itemId,
              plannedQuantity: trimScale(manufacturingOrderIngredients.plannedQuantity).as(
                "plannedQuantity"
              ),
              pickedQuantity: trimScale(manufacturingOrderIngredients.pickedQuantity).as(
                "pickedQuantity"
              ),
              actualQuantity: trimScale(manufacturingOrderIngredients.actualQuantity).as(
                "actualQuantity"
              ),
              manufacturingOrderId: manufacturingOrders.id,
              status: manufacturingOrders.status,
              deletedAt: manufacturingOrders.deletedAt,
            })
            .from(manufacturingOrderIngredients)
            .innerJoin(
              manufacturingOrders,
              eq(
                manufacturingOrderIngredients.manufacturingOrderId,
                manufacturingOrders.id
              )
            )
            .where(
              inArray(
                manufacturingOrderIngredients.id,
                normalizedProduction.map((allocation) => allocation.ingredientId)
              )
            )
            .for("update")
        : [];
    const destinationById = new Map(
      destinationRows.map((destination) => [destination.ingredientId, destination])
    );

    for (const allocation of normalizedProduction) {
      const destination = destinationById.get(allocation.ingredientId);
      if (
        !destination ||
        destination.deletedAt != null ||
        destination.status !== "open"
      ) {
        throw new ManufacturingError("Production destination is no longer open.", 409);
      }
      if (destination.manufacturingOrderId === orderId) {
        throw new ManufacturingError("A manufacturing order cannot allocate output to itself.", 400);
      }
      if (destination.itemId !== order.productId) {
        throw new ManufacturingError("Production destination does not need this output item.", 409);
      }
      const remainingNeed = Math.max(
        0,
        normalizeQuantityNumber(
          Number(destination.plannedQuantity) -
            Math.max(Number(destination.pickedQuantity), Number(destination.actualQuantity))
        )
      );
      if (allocation.quantity > remainingNeed) {
        throw new ManufacturingError(
          "Assigned output cannot exceed destination remaining need.",
          409
        );
      }
    }

    const otherActiveAssignedRows = await tx
      .select({
        quantity: trimScale(stockAllocations.quantity).as("quantity"),
      })
      .from(stockAllocations)
      .where(
        and(
          eq(stockAllocations.organizationId, orgId),
          eq(stockAllocations.itemId, order.productId),
          eq(stockAllocations.status, "active"),
          or(
            and(
              eq(stockAllocations.sourceType, "manufacturing_order"),
              eq(stockAllocations.sourceId, orderId)
            ),
            sourceLotIds.length > 0
              ? and(
                  eq(stockAllocations.sourceType, "inventory_lot"),
                  inArray(stockAllocations.sourceId, sourceLotIds)
                )
              : sql`FALSE`
          )
        )
      );
    const otherAssignedQty = otherActiveAssignedRows.reduce(
      (sum, row) => normalizeQuantityNumber(sum + Number(row.quantity)),
      0
    );
    const requestedProductionQty = normalizedProduction.reduce(
      (sum, allocation) => normalizeQuantityNumber(sum + allocation.quantity),
      0
    );
    const requestedSalesQty = normalizedSales.reduce(
      (sum, allocation) => normalizeQuantityNumber(sum + allocation.quantity),
      0
    );

    if (
      normalizeQuantityNumber(otherAssignedQty + requestedSalesQty + requestedProductionQty) >
      Number(order.plannedQuantity)
    ) {
      throw new ManufacturingError(
        "Assigned output cannot exceed source planned output.",
        409
      );
    }

    if (normalizedSales.length > 0) {
      await tx.insert(stockAllocations).values(
        salesDemandRefs.map((allocation) => ({
          organizationId: orgId,
          demandType: allocation.demandType,
          demandId: allocation.demandId,
          itemId: order.productId,
          sourceType: "manufacturing_order" as const,
          sourceId: orderId,
          quantity: allocationQuantity(allocation.quantity),
          status: "active" as const,
          demandLabelSnapshot: allocation.demandLabelSnapshot,
          createdBy: userId,
          updatedBy: userId,
        }))
      );
    }

    if (normalizedProduction.length > 0) {
      await tx.insert(stockAllocations).values(
        normalizedProduction.map((allocation) => ({
          organizationId: orgId,
          demandType: "manufacturing_order_ingredient" as const,
          demandId: allocation.ingredientId,
          itemId: order.productId,
          sourceType: "manufacturing_order" as const,
          sourceId: orderId,
          quantity: allocationQuantity(allocation.quantity),
          status: "active" as const,
          createdBy: userId,
          updatedBy: userId,
        }))
      );
    }

    if (normalizedSales.length > 0 || normalizedProduction.length > 0) {
      await materializeManufacturingOrderSourceAllocationsFromExistingOutputInTx(tx, {
        organizationId: orgId,
        sourceManufacturingOrderId: orderId,
        itemId: order.productId,
        actorUserId: userId,
      });
    }

    return getManufacturingOutputAllocationInTx(tx, orgId, orderId);
  });
}

async function getManufacturingOrderCompletionTarget(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        manufacturingMode: manufacturingOrders.manufacturingMode,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)));

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    return order;
  });
}

async function completeBatchModeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  if (payload.actualQuantity != null) {
    throw new ManufacturingError(
      "Batch-mode order completion uses each remaining batch's planned quantity.",
      400
    );
  }

  const requestedBatchCount = payload.batchCount ?? null;
  let completedBatchCount = 0;

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    if (requestedBatchCount != null && completedBatchCount >= requestedBatchCount) {
      return { id };
    }

    const execution = await getManufacturingExecutionDetail(id);

    if (!execution) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (execution.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only batch-mode orders can be batch completed.", 400);
    }

    if (execution.status === "done") {
      if (requestedBatchCount != null && completedBatchCount < requestedBatchCount) {
        throw new ManufacturingError("There are fewer remaining batches than requested.", 400);
      }
      return { id };
    }

    if (execution.status !== "open") {
      throw new ManufacturingError("Only open orders can be completed", 400);
    }

    const batch =
      execution.currentBatch ??
      execution.batches.find((currentBatch) => currentBatch.status !== "completed");

    if (!batch) {
      if (requestedBatchCount != null && completedBatchCount < requestedBatchCount) {
        throw new ManufacturingError("There are fewer remaining batches than requested.", 400);
      }
      return { id };
    }

    const plannedQuantity = Number(batch.plannedQuantity);
    if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
      throw new ManufacturingError("Planned batch quantity is invalid.", 400);
    }

    const existingOutputQuantity = Number(batch.actualQuantity ?? "0");
    const remainingOutputQuantity = normalizeQuantityNumber(
      plannedQuantity - existingOutputQuantity
    );

    if (remainingOutputQuantity > 0) {
      await recordManufacturingOutput(
        id,
        {
          quantity: normalizeNumeric(remainingOutputQuantity),
          outputDisposition: payload.outputDisposition,
          notes: null,
          confirmNegativeStock: payload.confirmNegativeStock,
        },
        {
          batchId: batch.id,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            `batch-output:${batch.id}`
          ) ?? undefined,
        }
      );
    }

    await completeManufacturingBatch(
      id,
      batch.id,
      {
        actualQuantity: undefined,
        outputDisposition: payload.outputDisposition,
        ingredientActuals: [],
        confirmNegativeStock: payload.confirmNegativeStock,
      },
      {
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          `batch-complete:${batch.id}`
        ) ?? undefined,
      }
    );
    completedBatchCount += 1;
  }

  throw new ManufacturingError("Too many batches to complete in one request.", 400);
}

async function completeDiscreteManufacturingOrder(
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

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can be completed", 400);
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
          status: "done",
          priorityRank: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, id))
        .returning({ id: manufacturingOrders.id });

      await rerankOpenManufacturingOrdersInTx(tx, orgId);

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

    const allocationTotals = await getPickAllocationTotalsInTx(
      tx,
      ingredientRows.map((ingredient) => ingredient.id)
    );

    const actualsMap = buildIngredientActualsMap(
      payload.ingredientActuals,
      ingredientRows
    );
    const plannedOutputQuantity = Number(order.plannedQuantity);
    const actualToPlannedRatio =
      Number.isFinite(plannedOutputQuantity) && plannedOutputQuantity > 0
        ? actualQuantity / plannedOutputQuantity
        : 1;

    let totalMaterialCost = 0;
    const produceIngredientRows: Array<{
      ingredientId: string;
      actualQuantity: number;
      actualCostTotal: number;
    }> = [];

    for (const ingredient of ingredientRows) {
      const pickedQty = parseFloat(ingredient.pickedQuantity);
      const plannedActualQty = normalizeQuantityNumber(
        parseFloat(ingredient.plannedQuantity) * actualToPlannedRatio
      );
      const suppliedActual =
        actualsMap.get(ingredient.id) ??
        (pickedQty < plannedActualQty ? plannedActualQty : null);
      let effectiveQuantity: number;
      let effectiveCost: number;

      if (suppliedActual != null) {
        let reconciled: Awaited<ReturnType<typeof reconcileIngredientActualsInTx>>;
        try {
          reconciled = await reconcileIngredientActualsInTx(tx, {
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
            allowNegativeStock: payload.confirmNegativeStock === true,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
              shortage: {
                ingredients: [
                  {
                    itemId: ingredient.itemId,
                    itemName: ingredient.itemName,
                    unitName: ingredient.unitName,
                    needed: error.requested,
                    available: error.available,
                    shortage: normalizeQuantityNumber(error.requested - error.available),
                    warningType: "stock_shortage",
                  },
                ],
              },
            });
          }
          throw error;
        }
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

    const absorbedOperationCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      id,
      actualQuantity,
      { absorbFullFixedCost: true }
    );
    const actualCostPerUnit = (totalMaterialCost + absorbedOperationCost) / actualQuantity;

    const produced = await produceManufacturedStockInTx(tx, {
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
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });

    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      produceIngredientRows.map((ingredient) => ingredient.ingredientId)
    );
    const outputConsumptionRows = buildOutputConsumptionsFromPickedAllocations(
      produceIngredientRows,
      pickAllocationsByIngredient
    );

    await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: id,
      manufacturingOrderBatchId: null,
      lotId: produced.lotId,
      quantity: actualQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal: totalMaterialCost,
      notes: null,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
    });

    const [completed] = await tx
      .update(manufacturingOrders)
      .set({
        status: "done",
        priorityRank: null,
        actualQuantity: normalizeNumeric(actualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualOperationsCost: normalizeNumericScale(absorbedOperationCost, 6),
        actualCostPerUnit: normalizeNumeric(actualCostPerUnit),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await rerankOpenManufacturingOrdersInTx(tx, orgId);

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: completed,
    });

    return completed;
  });
}

export async function completeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  const order = await getManufacturingOrderCompletionTarget(id);

  if (order.manufacturingMode === "batch") {
    return completeBatchModeManufacturingOrder(id, payload, options);
  }

  return completeDiscreteManufacturingOrder(id, payload, options);
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

    if (!isOpenManufacturingOrder(order) || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only open batch-mode orders can start batches", 400);
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

export async function startManufacturingOrderWork(
  orderId: string
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can start work", 400);
    }

    const now = new Date();
    await tx
      .update(manufacturingOrders)
      .set({
        isBlocked: false,
        startedAt: order.startedAt ?? now,
        updatedAt: now,
      })
      .where(eq(manufacturingOrders.id, orderId));

    if (order.manufacturingMode === "batch") {
      await ensureBatchExecutionRowsInTx(tx, order);
      const batches = await getLockedBatchStateRowsInTx(tx, orderId);
      const batch = getCurrentExecutionBatch(batches);

      if (!batch) {
        throw new ManufacturingError("All batches are already completed", 400);
      }

      if (batch.status === "pending") {
        await tx
          .update(manufacturingOrderBatches)
          .set({
            status: "in_progress",
            startedAt: now,
            updatedAt: now,
          })
          .where(eq(manufacturingOrderBatches.id, batch.id));
      }
    }

    return { id: orderId };
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

    if (!isOpenManufacturingOrder(order) || order.manufacturingMode !== "batch") {
      throw new ManufacturingError("Only open batch-mode orders can complete batches", 400);
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
          status: allCompleted ? "done" : "open",
          priorityRank: allCompleted ? null : order.priorityRank,
          completedAt: allCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrders.id, orderId));

      if (allCompleted) {
        await rerankOpenManufacturingOrdersInTx(tx, orgId);
      }

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
        let reconciled: Awaited<ReturnType<typeof reconcileIngredientActualsInTx>>;
        try {
          reconciled = await reconcileIngredientActualsInTx(tx, {
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
            allowNegativeStock: payload.confirmNegativeStock === true,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
              shortage: {
                ingredients: [
                  {
                    itemId: ingredient.itemId,
                    itemName: ingredient.itemName,
                    unitName: ingredient.unitName,
                    needed: error.requested,
                    available: error.available,
                    shortage: normalizeQuantityNumber(error.requested - error.available),
                    warningType: "stock_shortage",
                  },
                ],
              },
            });
          }
          throw error;
        }
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

    const existingOrderOutputQuantity = await getTotalOutputQuantityForOrderInTx(
      tx,
      orderId
    );
    const absorbedOperationCost = await getIncrementalAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      existingOrderOutputQuantity,
      actualQuantity,
      { absorbFullFixedCost: completesOrder }
    );
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
      overheadCostTotal: absorbedOperationCost,
      ingredientRows: produceIngredientRows,
    });

    const pickAllocationsByIngredient = await getPickAllocationsByIngredientInTx(
      tx,
      produceIngredientRows.map((ingredient) => ingredient.ingredientId)
    );
    const outputConsumptionRows = buildOutputConsumptionsFromPickedAllocations(
      produceIngredientRows,
      pickAllocationsByIngredient
    );
    const materialCostTotal = produceIngredientRows.reduce(
      (sum, ingredient) => sum + ingredient.actualCostTotal,
      0
    );

    await insertManufacturingOrderOutputInTx(tx, {
      manufacturingOrderId: orderId,
      manufacturingOrderBatchId: batchId,
      lotId: produced.lotId,
      quantity: actualQuantity,
      disposition: payload.outputDisposition,
      materialCostTotal,
      notes: null,
      actorUserId: userId,
      consumptions: outputConsumptionRows,
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
    const totalOperationsCost = await getAbsorbedOperationCostForQuantityInTx(
      tx,
      orderId,
      totalActualQuantity,
      { absorbFullFixedCost: allCompleted }
    );

    await tx
      .update(manufacturingOrders)
      .set({
        actualQuantity: normalizeNumeric(totalActualQuantity),
        actualMaterialCost: normalizeNumeric(totalMaterialCost),
        actualOperationsCost: normalizeNumericScale(totalOperationsCost, 6),
        actualCostPerUnit:
          totalActualQuantity > 0
            ? normalizeNumeric((totalMaterialCost + totalOperationsCost) / totalActualQuantity)
            : normalizeNumeric(0),
        status: allCompleted ? "done" : "open",
        priorityRank: allCompleted ? null : order.priorityRank,
        completedAt: allCompleted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, orderId));

    if (allCompleted) {
      await rerankOpenManufacturingOrdersInTx(tx, orgId);
    }

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
    confirmNegativeStock?: boolean;
  }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const confirmRequirementOverride = options?.confirmRequirementOverride === true;
    const confirmNegativeStock =
      options?.confirmNegativeStock === true || confirmRequirementOverride;
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "pickManufacturingIngredient",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        orderId,
        ingredientId,
        confirmRequirementOverride,
        confirmNegativeStock,
      },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, orderId);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (!isOpenManufacturingOrder(order)) {
      throw new ManufacturingError("Only open orders can be picked", 400);
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
    const ingredientConstraints = constraintsByIngredientId.get(ingredient.id) ?? [];
    const lotAgeConstraint = ingredientConstraints.find(
      (constraint) => constraint.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT
    );
    const minimumLotAgeDays = getMinimumLotAgeDays(ingredientConstraints);
    const pickDate = await getOrganizationTodayInTx(tx, orgId);
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
        !confirmRequirementOverride
      ) {
        const requirementViolation = lotAgeConstraint
          ? evaluateLotAgeMinDaysRequirement({
              requirementId: lotAgeConstraint.id,
              requirement: {
                id: lotAgeConstraint.id,
                requirementType: lotAgeConstraint.constraintType,
                config: lotAgeConstraint.config,
                sortOrder: lotAgeConstraint.sortOrder,
              },
              requiredQuantity: remainingQuantity,
              eligibleQuantity: ageAvailability.eligible,
              nextEligibleDate: ageAvailability.nextEligibleDate,
            })
          : null;

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
                  requirementViolations: requirementViolation
                    ? [requirementViolation]
                    : [],
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

    try {
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
        confirmRequirementOverride,
        allowNegativeStock: confirmNegativeStock,
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw new ManufacturingError(`Not enough ${ingredient.itemName}.`, 409, {
          shortage: {
            ingredients: [
              {
                itemId: ingredient.itemId,
                itemName: ingredient.itemName,
                unitName: ingredient.unitName,
                needed: error.requested,
                available: error.available,
                shortage: normalizeQuantityNumber(error.requested - error.available),
                warningType: "stock_shortage",
              },
            ],
          },
        });
      }
      throw error;
    }

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

export async function pickRemainingManufacturingIngredients(
  orderId: string,
  options?: {
    idempotencyKey?: string;
    confirmRequirementOverride?: boolean;
    confirmNegativeStock?: boolean;
  }
): Promise<{ ids: string[] }> {
  const execution = await getManufacturingExecutionDetail(orderId);

  if (!execution) {
    throw new ManufacturingError("Order not found", 404);
  }

  if (execution.status !== "open") {
    throw new ManufacturingError("Only open orders can be picked", 400);
  }

  if (
    execution.manufacturingMode === "batch" &&
    execution.currentBatch?.status === "pending"
  ) {
    throw new ManufacturingError(
      `Start batch ${execution.currentBatch.batchNumber} before marking ingredients done.`,
      400
    );
  }

  const remainingIngredients = execution.ingredients.filter(
    (ingredient) =>
      getRemainingQuantityNumber(
        ingredient.plannedQuantity,
        ingredient.pickedQuantity
      ) > 0
  );
  const pickedIds: string[] = [];

  for (const ingredient of remainingIngredients) {
    await pickManufacturingIngredient(orderId, ingredient.id, {
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        `pick-remaining:${ingredient.id}`
      ) ?? undefined,
      confirmRequirementOverride: options?.confirmRequirementOverride,
      confirmNegativeStock: options?.confirmNegativeStock,
    });
    pickedIds.push(ingredient.id);
  }

  return { ids: pickedIds };
}

export async function getManufacturingExecutionDetail(
  orderId: string
): Promise<ManufacturingExecutionDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
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
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        priorityRank: manufacturingOrders.priorityRank,
        plannedDate: manufacturingOrders.plannedDate,
        notes: manufacturingOrders.notes,
        bomRevisionId: manufacturingOrders.bomRevisionId,
      })
      .from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, orderId), isNull(manufacturingOrders.deletedAt)))
      .for("update");

    if (!order) {
      return null;
    }

    let batches: ExecutionBatchRow[] = [];
    if (order.manufacturingMode === "batch") {
      batches = await getBatchRowsInTx(tx, orderId);
    }

    const currentBatch =
      order.manufacturingMode === "batch" ? getCurrentExecutionBatch(batches) : null;

    const ingredients =
      order.manufacturingMode === "batch" && currentBatch != null
        ? (await getBatchIngredientsInTx(tx, currentBatch.id)).map(toIngredientDetail)
        : (await getTemplateIngredientsInTx(tx, orderId)).map(toIngredientDetail);
    const lotAllocationsByIngredientId =
      await getExecutionLotAllocationsByIngredientInTx(
        tx,
        ingredients.map((ingredient) => ingredient.id)
      );
    const ingredientsWithLotAllocations = ingredients.map((ingredient) => ({
      ...ingredient,
      lotAllocations: lotAllocationsByIngredientId.get(ingredient.id) ?? [],
    }));
    const lotPickPlansByIngredientId =
      await getExecutionLotPickPlansByIngredientInTx(
        tx,
        orgId,
        ingredientsWithLotAllocations
      );
    const ingredientsWithLotGuidance = ingredientsWithLotAllocations.map(
      (ingredient) => ({
        ...ingredient,
        lotPickPlan: lotPickPlansByIngredientId.get(ingredient.id) ?? [],
      })
    );
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
              ingredientsWithLotGuidance.map((ingredient) => ({
                plannedQuantity: ingredient.plannedQuantity,
                pickedQuantity: ingredient.pickedQuantity,
              }))
            ),
      canComplete:
        order.status === "open" &&
        (recordedOutputQuantity > 0
          ? true
          : order.manufacturingMode === "batch"
            ? currentBatch != null &&
              ingredientsWithLotGuidance.every(
                (ingredient) =>
                  getRemainingQuantityNumber(
                    ingredient.plannedQuantity,
                    ingredient.pickedQuantity
                  ) <= 0
              )
            : ingredientsWithLotGuidance.every(
                (ingredient) =>
                  getRemainingQuantityNumber(
                    ingredient.plannedQuantity,
                    ingredient.pickedQuantity
                  ) <= 0
              )),
      currentBatchId: currentBatch?.id ?? null,
      currentBatch: currentBatch,
      batches,
      ingredients: ingredientsWithLotGuidance,
      recordedOutputQuantity: normalizeNumeric(recordedOutputQuantity),
    };
  });
}

export async function deleteManufacturingOrder(
  id: string
): Promise<{ deleted: boolean; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const deleted = await deleteManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      ids: [id],
    });

    return { deleted: deleted.deletedIds.length > 0, error: deleted.error };
  });
}

export async function deleteManufacturingOrders(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const deleted = await deleteManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      ids,
    });

    return { deletedCount: deleted.deletedIds.length, error: deleted.error };
  });
}

export async function deleteManufacturingOrdersInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    ids: string[];
  }
): Promise<{ deletedIds: string[]; error?: string }> {
  const uniqueIds = [...new Set(params.ids)];

  if (uniqueIds.length === 0) {
    return { deletedIds: [] };
  }

  const orders = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      productId: manufacturingOrders.productId,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
      completedAt: manufacturingOrders.completedAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.id, uniqueIds),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .for("update");

  if (orders.length === 0) {
    return { deletedIds: [] };
  }

  const orderIds = orders.map((order) => order.id);
  const finalizedOrder = orders.find(
    (order) =>
      order.status !== "open" ||
      order.completedAt != null ||
      (order.manufacturingMode !== "batch" && parseFloat(order.actualQuantity ?? "0") > 0)
  );

  if (finalizedOrder) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${finalizedOrder.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  const [completedDiscreteBatch] = await tx
    .select({
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(manufacturingOrderBatches)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderBatches.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrderBatches.manufacturingOrderId, orderIds),
        ne(manufacturingOrders.manufacturingMode, "batch"),
        or(
          eq(manufacturingOrderBatches.status, "completed"),
          isNotNull(manufacturingOrderBatches.completedAt),
          isNotNull(manufacturingOrderBatches.lotId),
          sql`${manufacturingOrderBatches.actualQuantity} IS NOT NULL AND ${manufacturingOrderBatches.actualQuantity} > 0`
        )
      )
    )
    .limit(1);

  if (completedDiscreteBatch) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${completedDiscreteBatch.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  const [finalizedDiscreteEvent] = await tx
    .select({
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      manufacturingOrders,
      or(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, manufacturingOrders.id)
        ),
        and(
          eq(inventoryEvents.referenceType, "manufacturing_batch"),
          inArray(
            inventoryEvents.referenceId,
            tx
              .select({ id: manufacturingOrderBatches.id })
              .from(manufacturingOrderBatches)
              .where(
                eq(manufacturingOrderBatches.manufacturingOrderId, manufacturingOrders.id)
              )
          )
        )
      )
    )
    .where(
      and(
        inArray(manufacturingOrders.id, orderIds),
        ne(manufacturingOrders.manufacturingMode, "batch"),
        eq(inventoryEvents.eventType, "manufacturing_output")
      )
    )
    .limit(1);

  if (finalizedDiscreteEvent) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${finalizedDiscreteEvent.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  const ingredientRows = await tx
    .select({ id: manufacturingOrderIngredients.id })
    .from(manufacturingOrderIngredients)
    .where(inArray(manufacturingOrderIngredients.manufacturingOrderId, orderIds))
    .for("update");

  for (const order of orders) {
    if (!isOpenManufacturingOrder(order)) continue;

    let reservationRows: Awaited<
      ReturnType<typeof getManufacturingIngredientReservationRowsInTx>
    > = [];

    if (order.manufacturingMode === "batch") {
      const batches = await getLockedBatchStateRowsInTx(tx, order.id);
      const deletableBatchIds = batches
        .filter((batch) => batch.status !== "completed")
        .map((batch) => batch.id);
      reservationRows =
        deletableBatchIds.length > 0
          ? await getManufacturingIngredientReservationRowsForBatchesInTx(
              tx,
              order.id,
              deletableBatchIds
            )
          : [];
    } else {
      reservationRows = await getManufacturingIngredientReservationRowsInTx(tx, order.id);
    }

    await cancelReleasedManufacturingOrderInTx(tx, {
      organizationId: params.organizationId,
      manufacturingOrderId: order.id,
      productId: order.productId,
      actorUserId: params.actorUserId,
      idempotencyKey: `delete-manufacturing-order:${order.id}`,
      ingredientRows: reservationRows.map((row) => ({
        ingredientId: row.ingredientId,
        itemId: row.itemId,
        pickedQuantity: parseFloat(row.pickedQuantity),
      })),
    });
  }

  const deletedAt = new Date();
  const deleted = await tx
    .update(manufacturingOrders)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(inArray(manufacturingOrders.id, orderIds), isNull(manufacturingOrders.deletedAt))
    )
    .returning({ id: manufacturingOrders.id });

  for (const order of deleted) {
    await cancelActiveStockAllocationsInTx(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      sourceType: "manufacturing_order",
      sourceId: order.id,
    });
  }

  await cancelActiveStockAllocationsInTx(tx, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    demandType: "manufacturing_order_ingredient",
    demandIds: ingredientRows.map((row) => row.id),
  });

  if (orders.some(isOpenManufacturingOrder)) {
    await rerankOpenManufacturingOrdersInTx(tx, params.organizationId);
  }

  return { deletedIds: deleted.map((order) => order.id) };
}
