import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrderLines,
  salesOrders,
  stockMovements,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  getCurrentActiveBomIngredientsInTx,
  getCurrentBomCoverageInTx,
} from "@/lib/bom/revisions";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { recomputeExpectedQty } from "@/lib/inventory/expected";
import {
  applyStockDeltaInTx,
  createPositiveLotAndMovementInTx,
  getCurrentStockInTx,
  lockItemsInTx,
} from "@/lib/inventory/stock";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import type {
  CompleteManufacturingOrder,
  CreateManufacturingOrdersFromSalesOrder,
  InsertManufacturingOrder,
  UpdateManufacturingOrder,
} from "@/lib/schemas/manufacturing-orders";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderEditData,
  ManufacturingOrdersFromSalesOrderResult,
  ManufacturingOrderListRow,
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
};

function normalizeQuantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function normalizeQuantityNumber(value: number) {
  return Number(normalizeQuantityString(value));
}

function multiplyQuantity(quantityPerUnit: string, quantity: number) {
  return normalizeQuantityNumber(parseFloat(quantityPerUnit) * quantity);
}

/**
 * Compute batch-aware planning values from a product and desired quantity.
 * For batch products: rounds up to full batches.
 * For discrete products: passes through unchanged.
 */
function computeBatchPlanning(
  product: ProductSnapshot,
  desiredQuantity: number
): {
  plannedQuantity: number;
  numberOfBatches: number | null;
  ingredientMultiplier: number;
} {
  if (product.manufacturingMode === "batch" && product.expectedBatchYield != null) {
    const yield_ = parseFloat(product.expectedBatchYield);
    if (yield_ > 0) {
      const numberOfBatches = Math.ceil(desiredQuantity / yield_);
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
      status: manufacturingOrders.status,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      numberOfBatches: manufacturingOrders.numberOfBatches,
      expectedBatchYield: manufacturingOrders.expectedBatchYield,
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      salesOrderNumber: manufacturingOrders.salesOrderNumber,
      salesCustomerName: manufacturingOrders.salesCustomerName,
    })
    .from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)))
    .for("update");

  return order ?? null;
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
      expectedBatchYield: items.expectedBatchYield,
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
    ["draft", "confirmed"].includes(line.orderStatus) &&
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
          inArray(salesOrders.status, ["draft", "confirmed"]),
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
    throw new ManufacturingError("Products need a BOM before creating a manufacturing order", 400);
  }

  const bomIds = new Set(bomRows.map((row) => row.itemId));
  const submittedIds = new Set(submittedIngredients.map((row) => row.itemId));

  if (
    bomRows.length !== submittedIngredients.length ||
    bomRows.some((row) => !submittedIds.has(row.itemId)) ||
    submittedIngredients.some((row) => !bomIds.has(row.itemId))
  ) {
    throw new ManufacturingError("The product BOM changed. Reload and try again.", 409);
  }

  const submittedById = new Map(
    submittedIngredients.map((row) => [row.itemId, row.quantityPerUnit])
  );

  return {
    bomRevisionId: bomRows[0].bomRevisionId,
    ingredients: bomRows.map((row, index) => {
    const quantityPerUnit = Number(submittedById.get(row.itemId));

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      itemType: row.itemType,
      unitName: row.unitName,
      quantityPerUnit: normalizeQuantityString(quantityPerUnit),
      plannedQuantity: normalizeQuantityString(quantityPerUnit * ingredientMultiplier),
      sortOrder: index,
    };
    }),
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
    const quantityPerUnit = Number(row.quantityPerUnit);

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      itemType: row.itemType,
      unitName: row.unitName,
      quantityPerUnit: normalizeQuantityString(quantityPerUnit),
      plannedQuantity: normalizeQuantityString(quantityPerUnit * ingredientMultiplier),
      sortOrder: index,
    };
    }),
  };
}

async function insertManufacturingOrderInTx(
  tx: Tx,
  orgId: string,
  values: {
    product: ProductSnapshot;
    bomRevisionId: string | null;
    salesLink: SalesLineSnapshot | null;
    plannedQuantity: number;
    numberOfBatches: number | null;
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
      salesOrderNumber: values.salesLink?.salesOrderNumber ?? null,
      salesCustomerName: values.salesLink?.customerName ?? null,
      status: "draft",
      plannedQuantity: normalizeQuantityString(values.plannedQuantity),
      plannedDate: values.plannedDate,
      notes: values.notes,
    })
    .returning({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
    });

  await tx.insert(manufacturingOrderIngredients).values(
    values.ingredients.map((ingredient) => ({
      manufacturingOrderId: order.id,
      itemId: ingredient.itemId,
      itemName: ingredient.itemName,
      itemSku: ingredient.itemSku,
      itemType: ingredient.itemType,
      unitName: ingredient.unitName,
      quantityPerUnit: ingredient.quantityPerUnit,
      plannedQuantity: ingredient.plannedQuantity,
      sortOrder: ingredient.sortOrder,
    }))
  );

  return order;
}

async function prepareUpdatedIngredientsInTx(
  tx: Tx,
  orderId: string,
  ingredientMultiplier: number,
  submittedIngredients: UpdateManufacturingOrder["ingredients"]
): Promise<ValidatedIngredient[]> {
  const existingRows = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      itemSku: manufacturingOrderIngredients.itemSku,
      itemType: manufacturingOrderIngredients.itemType,
      unitName: manufacturingOrderIngredients.unitName,
      sortOrder: manufacturingOrderIngredients.sortOrder,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const existingIds = new Set(existingRows.map((row) => row.itemId));
  const submittedIds = new Set(submittedIngredients.map((row) => row.itemId));

  if (
    existingRows.length !== submittedIngredients.length ||
    existingRows.some((row) => !submittedIds.has(row.itemId)) ||
    submittedIngredients.some((row) => !existingIds.has(row.itemId))
  ) {
    throw new ManufacturingError(
      "Ingredient rows cannot be added or removed after the order is created",
      400
    );
  }

  const submittedById = new Map(
    submittedIngredients.map((row) => [row.itemId, row.quantityPerUnit])
  );

  return existingRows.map((row) => {
    const quantityPerUnit = Number(submittedById.get(row.itemId));

    return {
      itemId: row.itemId,
      itemName: row.itemName,
      itemSku: row.itemSku,
      itemType: row.itemType,
      unitName: row.unitName,
      quantityPerUnit: normalizeQuantityString(quantityPerUnit),
      plannedQuantity: normalizeQuantityString(quantityPerUnit * ingredientMultiplier),
      sortOrder: row.sortOrder,
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
  orderId: string
): Promise<ManufacturingReleaseWarningPayload["ingredients"]> {
  const ingredients = await tx
    .select({
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      unitName: manufacturingOrderIngredients.unitName,
      plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
    })
    .from(manufacturingOrderIngredients)
    .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
    .orderBy(asc(manufacturingOrderIngredients.sortOrder));

  const shortages: ManufacturingReleaseWarningPayload["ingredients"] = [];

  for (const ingredient of ingredients) {
    const needed = normalizeQuantityNumber(parseFloat(ingredient.plannedQuantity));
    const available = normalizeQuantityNumber(
      await getCurrentStockInTx(tx, ingredient.itemId)
    );

    if (available < needed) {
      shortages.push({
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        unitName: ingredient.unitName,
        needed,
        available,
        shortage: normalizeQuantityNumber(needed - available),
      });
    }
  }

  return shortages;
}

async function getCompletionShortagesInTx(
  tx: Tx,
  ingredients: Array<{
    itemId: string;
    itemName: string;
    unitName: string;
    quantityPerUnit: string;
  }>,
  consumptionMultiplier: number
): Promise<ManufacturingReleaseWarningPayload["ingredients"]> {
  const shortages: ManufacturingReleaseWarningPayload["ingredients"] = [];

  for (const ingredient of ingredients) {
    const needed = multiplyQuantity(ingredient.quantityPerUnit, consumptionMultiplier);
    const available = normalizeQuantityNumber(
      await getCurrentStockInTx(tx, ingredient.itemId)
    );

    if (available < needed) {
      shortages.push({
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        unitName: ingredient.unitName,
        needed,
        available,
        shortage: normalizeQuantityNumber(needed - available),
      });
    }
  }

  return shortages;
}

export async function getManufacturingOrders(): Promise<ManufacturingOrderListRow[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        plannedQuantity: manufacturingOrders.plannedQuantity,
        actualQuantity: manufacturingOrders.actualQuantity,
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
      .where(isNull(manufacturingOrders.deletedAt))
      .orderBy(desc(manufacturingOrders.createdAt)) as Promise<
        ManufacturingOrderListRow[]
      >;
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
        expectedBatchYield: items.expectedBatchYield,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.itemType, "product"), isNull(items.deletedAt)))
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
        requestedDate: salesOrders.requestedDate,
        createdAt: salesOrders.createdAt,
      })
      .from(salesOrders)
      .where(
        and(
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "confirmed")
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
        requestedDate: salesOrders.requestedDate,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "confirmed")
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
      inArray(salesOrders.status, ["draft", "confirmed"]),
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
        quantity: salesOrderLines.quantity,
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
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
        plannedQuantity: manufacturingOrders.plannedQuantity,
        actualQuantity: manufacturingOrders.actualQuantity,
        plannedDate: manufacturingOrders.plannedDate,
        actualMaterialCost: manufacturingOrders.actualMaterialCost,
        actualCostPerUnit: manufacturingOrders.actualCostPerUnit,
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

    const ingredients = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
        itemSku: manufacturingOrderIngredients.itemSku,
        itemType: manufacturingOrderIngredients.itemType,
        unitName: manufacturingOrderIngredients.unitName,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
        actualQuantity: manufacturingOrderIngredients.actualQuantity,
        actualCostTotal: manufacturingOrderIngredients.actualCostTotal,
        sortOrder: manufacturingOrderIngredients.sortOrder,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
      .orderBy(asc(manufacturingOrderIngredients.sortOrder));

    const [producedLot] = await tx
      .select({
        lotId: lots.id,
        lotNumber: lots.lotNumber,
        quantity: stockMovements.quantity,
        costPerUnit: lots.costPerUnit,
      })
      .from(stockMovements)
      .innerJoin(lots, eq(stockMovements.lotId, lots.id))
      .where(
        and(
          eq(stockMovements.itemId, order.productId),
          eq(stockMovements.movementType, "manufacturing_produced"),
          eq(stockMovements.referenceType, "manufacturing_order"),
          eq(stockMovements.referenceId, id)
        )
      )
      .orderBy(desc(stockMovements.createdAt));

    return {
      ...order,
      status: order.status as ManufacturingOrderDetail["status"],
      ingredients,
      producedLot: producedLot ?? null,
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
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        unitName: manufacturingOrders.unitName,
        manufacturingMode: manufacturingOrders.manufacturingMode,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        plannedQuantity: manufacturingOrders.plannedQuantity,
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
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
      .orderBy(asc(manufacturingOrderIngredients.sortOrder));

    return {
      ...order,
      ingredients,
    };
  });
}

export async function createManufacturingOrder(
  payload: InsertManufacturingOrder
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    if (payload.salesOrderId != null || payload.salesOrderLineId != null) {
      throw new ManufacturingError(
        "Create sales-linked manufacturing orders from the sales order Create MOs flow.",
        400
      );
    }

    const product = await getValidatedProductInTx(tx, payload.productId);
    const { plannedQuantity, numberOfBatches, ingredientMultiplier } =
      computeBatchPlanning(product, Number(payload.plannedQuantity));

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
    const order = await insertManufacturingOrderInTx(tx, orgId, {
      product,
      bomRevisionId,
      salesLink,
      plannedQuantity,
      numberOfBatches,
      plannedDate: payload.plannedDate ?? null,
      notes: payload.notes ?? null,
      ingredients,
    });

    return { id: order.id };
  });
}

export async function createManufacturingOrdersFromSalesOrder(
  salesOrderId: string,
  payload: CreateManufacturingOrdersFromSalesOrder
): Promise<ManufacturingOrdersFromSalesOrderResult> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        requestedDate: salesOrders.requestedDate,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, salesOrderId),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (!order) {
      throw new ManufacturingError("Sales order not found", 404);
    }

    if (order.status !== "confirmed") {
      throw new ManufacturingError(
        "Only confirmed sales orders can create manufacturing orders",
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

    const plannedDate = payload.plannedDate ?? order.requestedDate ?? null;
    const created: ManufacturingOrdersFromSalesOrderResult["created"] = [];
    const skipped: ManufacturingOrdersFromSalesOrderResult["skipped"] = [];

    for (const line of summary.lines) {
      if (line.status === "skipped" || line.skipReason != null) {
        skipped.push({
          salesOrderLineId: line.salesOrderLineId,
          reason: line.skipReason ?? "existing_active_mo",
        });
        continue;
      }

      const product = await getValidatedProductInTx(tx, line.itemId);
      const { plannedQuantity, numberOfBatches, ingredientMultiplier } =
        computeBatchPlanning(product, Number(line.quantity));
      const { bomRevisionId, ingredients } = await prepareCreateIngredientsFromBomInTx(
        tx,
        line.itemId,
        ingredientMultiplier
      );
      const createdOrder = await insertManufacturingOrderInTx(tx, orgId, {
        product,
        bomRevisionId,
        salesLink: {
          salesOrderId: order.id,
          salesOrderLineId: line.salesOrderLineId,
          salesOrderNumber: order.orderNumber,
          customerName: order.customerName,
        },
        plannedQuantity,
        numberOfBatches,
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
  });
}

export async function updateManufacturingOrder(
  id: string,
  payload: UpdateManufacturingOrder
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx) => {
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
      ingredientMultiplier,
      payload.ingredients
    );

    const [order] = await tx
      .update(manufacturingOrders)
      .set({
        salesOrderId: salesLink?.salesOrderId ?? null,
        salesOrderLineId: salesLink?.salesOrderLineId ?? null,
        salesOrderNumber: salesLink?.salesOrderNumber ?? null,
        salesCustomerName: salesLink?.customerName ?? null,
        plannedQuantity: normalizeQuantityString(plannedQuantity),
        numberOfBatches,
        plannedDate: payload.plannedDate ?? null,
        notes: payload.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await tx
      .delete(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));

    await tx.insert(manufacturingOrderIngredients).values(
      ingredients.map((ingredient) => ({
        manufacturingOrderId: id,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        itemSku: ingredient.itemSku,
        itemType: ingredient.itemType,
        unitName: ingredient.unitName,
        quantityPerUnit: ingredient.quantityPerUnit,
        plannedQuantity: ingredient.plannedQuantity,
        sortOrder: ingredient.sortOrder,
      }))
    );

    return order;
  });
}

export async function releaseManufacturingOrder(
  id: string,
  confirmShortage = false
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "draft") {
      throw new ManufacturingError("Only draft orders can be released", 400);
    }

    await getValidatedProductInTx(tx, order.productId);

    const ingredientRows = await tx
      .select({ itemId: manufacturingOrderIngredients.itemId })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id));

    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    const shortages = await getReleaseShortagesInTx(tx, id);

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

    await recomputeExpectedQty(tx, [order.productId]);

    return released;
  });
}

export async function completeManufacturingOrder(
  id: string,
  payload: CompleteManufacturingOrder
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }

    if (order.status !== "released") {
      throw new ManufacturingError("Only released orders can be completed", 400);
    }

    const actualQuantity = Number(payload.actualQuantity);

    const ingredientRows = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        itemName: manufacturingOrderIngredients.itemName,
        unitName: manufacturingOrderIngredients.unitName,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
      .orderBy(asc(manufacturingOrderIngredients.sortOrder));

    await validateActiveIngredientItemsInTx(
      tx,
      ingredientRows.map((row) => row.itemId)
    );

    await lockItemsInTx(tx, [
      order.productId,
      ...ingredientRows.map((row) => row.itemId),
    ]);

    // For batch MOs, ingredient consumption is based on number of batches run,
    // not actual yield. You loaded N batches into the mixer regardless of output.
    const consumptionMultiplier =
      order.manufacturingMode === "batch" && order.numberOfBatches != null
        ? order.numberOfBatches
        : actualQuantity;

    const shortages = await getCompletionShortagesInTx(
      tx,
      ingredientRows,
      consumptionMultiplier
    );

    if (shortages.length > 0) {
      throw new ManufacturingError(
        `Cannot complete order. Short on ${summarizeShortageItems(shortages)}.`,
        400,
        {
          shortage: { ingredients: shortages },
        }
      );
    }

    let totalMaterialCost = 0;

    for (const ingredient of ingredientRows) {
      const actualNeeded = multiplyQuantity(
        ingredient.quantityPerUnit,
        consumptionMultiplier
      );
      const { allocations } = await applyStockDeltaInTx(tx, {
        orgId,
        userId,
        itemId: ingredient.itemId,
        delta: -actualNeeded,
        movementType: "manufacturing_consumed",
        referenceType: "manufacturing_order",
        referenceId: id,
      });

      const actualCostTotal = (allocations ?? []).reduce((sum, allocation) => {
        return sum + allocation.quantity * (allocation.costPerUnit ?? 0);
      }, 0);
      totalMaterialCost += actualCostTotal;

      await tx
        .update(manufacturingOrderIngredients)
        .set({
          actualQuantity: normalizeQuantityString(actualNeeded),
          actualCostTotal: normalizeQuantityString(actualCostTotal),
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderIngredients.id, ingredient.id));
    }

    const actualCostPerUnit = totalMaterialCost / actualQuantity;

    await createPositiveLotAndMovementInTx(tx, {
      orgId,
      itemId: order.productId,
      quantity: actualQuantity,
      userId,
      costPerUnit: normalizeQuantityString(actualCostPerUnit),
      movementType: "manufacturing_produced",
      referenceType: "manufacturing_order",
      referenceId: id,
    });

    const [completed] = await tx
      .update(manufacturingOrders)
      .set({
        status: "completed",
        actualQuantity: normalizeQuantityString(actualQuantity),
        actualMaterialCost: normalizeQuantityString(totalMaterialCost),
        actualCostPerUnit: normalizeQuantityString(actualCostPerUnit),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    await recomputeExpectedQty(tx, [order.productId]);

    return completed;
  });
}

export async function cancelManufacturingOrder(
  id: string
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (!["draft", "released"].includes(order.status)) {
      throw new ManufacturingError("Only draft or released orders can be cancelled", 400);
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
      await recomputeExpectedQty(tx, [order.productId]);
    }

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
