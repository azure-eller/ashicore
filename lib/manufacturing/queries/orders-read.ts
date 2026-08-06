import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { inventoryEvents, itemFamilies, items, lots, manufacturingOrderBatches, manufacturingOrderOperationCosts, manufacturingOrderIngredients, manufacturingOrders, manufacturingResources, salesOrderLines, salesOrders, unitDefinitions } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeQuantityNumber } from "@/lib/format";
import { inferItemVisual } from "@/components/inventory-visuals/infer-item-visual";
import { getBomRevisionComponentsInTx, getCurrentBomCoverageInTx } from "@/lib/bom/revisions";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getFeatureAccessInTx } from "@/lib/billing/entitlements";
import type { Tx } from "@/lib/db/with-org-context";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { projectedLotUnitCost } from "@/lib/inventory/kernel";
import { getSalesOrderManufacturingSummariesInTx } from "@/lib/manufacturing/sales-order-manufacturability";
import { demandQueueCoverageKey, getDemandQueueCoverageByDemandKeyForItemsInTx } from "@/lib/inventory/allocation/demand-queue";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { ManufacturingBatchStatus, ManufacturingLotStrategy, ManufacturingOrderStatus, ManufacturingPickStatus } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingOrderDetail, ManufacturingOrderEditData, ManufacturingOrderListRow, ManufacturingIngredientReadiness, ManufacturingPickProgressStatus, ManufacturingProductOption, ManufacturingSalesOrderOption, ManufacturingSalesOrderPreview, ManufacturingSalesLineOption } from "../types";
import { type ExecutionIngredientRow, aggregateBatchIngredients, getBatchPickProgressStatus, getBatchRowsInTx, getExecutionIngredientLineKey, getExecutionLotAllocationsByIngredientInTx, getExecutionLotAllocationsByLine, getExecutionLotPickPlansByIngredientInTx, getIngredientConstraintsByIdInTx, getTemplateIngredientsInTx, toIngredientDetail, withIngredientLotTrackingModesInTx } from "./execution-state";
import { type IngredientProgressRow, canonicalItemName, effectiveManufacturingPriorityRankSql, getActiveSiblingVariantsByItemIdInTx, getManufacturingItemDisplayMetadataInTx, getPickProgressStatus, getRemainingQuantityNumber, sumNumericStrings } from "./shared";

type EditableManufacturingIngredientSnapshotRow = {
  id: string;
  bomRevisionComponentId: string | null;
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

type ActiveSiblingVariant = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  itemType: string;
  unitName: string;
};

function markCurrentSiblingVariants(
  siblings: ActiveSiblingVariant[] | undefined,
  currentItemId: string
) {
  return (siblings ?? []).map((sibling) => ({
    ...sibling,
    isCurrent: sibling.itemId === currentItemId,
  }));
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

async function getEditableManufacturingIngredientSnapshotInTx(
  tx: Tx,
  manufacturingOrderId: string
): Promise<EditableManufacturingIngredientSnapshotRow[]> {
  const templateRows = await tx
    .select({
      id: manufacturingOrderIngredients.id,
      bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
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
      bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
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
      bomRevisionComponentId: row.bomRevisionComponentId,
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

  if (params.ingredients.length === 0) return "in_stock";

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

function latestExpectedDate(
  current: string | null,
  next: string | null | undefined
) {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
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
            priorityRank: effectiveManufacturingPriorityRankSql().as("priorityRank"),
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
          .leftJoin(salesOrders, eq(manufacturingOrders.salesOrderId, salesOrders.id))
          .leftJoin(items, eq(manufacturingOrders.productId, items.id))
          .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
          .where(isNull(manufacturingOrders.deletedAt))
          .orderBy(
            sql`${effectiveManufacturingPriorityRankSql()} IS NULL`,
            asc(effectiveManufacturingPriorityRankSql()),
            asc(manufacturingOrders.plannedDate),
            asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
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
            | "ingredientExpectedDate"
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
            resourceId: manufacturingResources.id,
            resourceName: manufacturingResources.name,
            resourceType: manufacturingResources.resourceType,
            sortOrder: manufacturingOrderOperationCosts.sortOrder,
          })
          .from(manufacturingOrderOperationCosts)
          .innerJoin(
            manufacturingResources,
            and(
              eq(manufacturingOrderOperationCosts.resourceId, manufacturingResources.id),
              isNull(manufacturingResources.deletedAt)
            )
          )
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

        const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(tx, [
          ...orders.map((order) => order.productId),
          ...ingredientRows.map((ingredient) => ingredient.itemId),
        ]);
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
                itemName: canonicalItemName(
                  itemDisplayById,
                  itemId,
                  matchingIngredient?.itemName ?? "Ingredient"
                ),
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
          {
            inStockQuantity: number;
            expectedQuantity: number;
            expectedDate: string | null;
          }
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
                expectedDate: null,
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
              expectedDate: latestExpectedDate(
                existing.expectedDate,
                coverage.latestExpectedDate ?? coverage.earliestExpectedDate
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
          const display = itemDisplayById.get(order.productId);
          const productName = display?.displayName ?? order.productName;
          const itemVisual = inferItemVisual({
            itemType: "product",
            category: order.productCategory,
            unitName: order.unitName,
            sku: order.productSku,
            name: productName,
          });
          const ingredientShortages = (
            readinessIngredientsByOrder.get(order.id) ?? []
          ).flatMap((ingredient) => {
            const coverage = ingredientCoverageByOrderItem.get(
              `${order.id}:${ingredient.itemId}`
            ) ?? {
              inStockQuantity: 0,
              expectedQuantity: 0,
              expectedDate: null,
            };
            const needed = Number.parseFloat(ingredient.plannedQuantity);
            const available = coverage.inStockQuantity;
            const expected = coverage.expectedQuantity;

            if (!Number.isFinite(needed) || available + expected >= needed) {
              return [];
            }

            return [
              {
                itemId: ingredient.itemId,
                itemName: ingredient.itemName,
                needed: normalizeNumeric(needed),
                available: normalizeNumeric(available),
                expected: normalizeNumeric(expected),
              },
            ];
          });
          const ingredientExpectedDate = (
            readinessIngredientsByOrder.get(order.id) ?? []
          ).reduce<string | null>((latest, ingredient) => {
            const coverage = ingredientCoverageByOrderItem.get(
              `${order.id}:${ingredient.itemId}`
            );
            if (!coverage || coverage.expectedQuantity <= 0) return latest;
            return latestExpectedDate(latest, coverage.expectedDate);
          }, null);
          const ingredientCoverage = (
            readinessIngredientsByOrder.get(order.id) ?? []
          ).map((ingredient) => {
            const coverage = ingredientCoverageByOrderItem.get(
              `${order.id}:${ingredient.itemId}`
            ) ?? {
              inStockQuantity: 0,
              expectedQuantity: 0,
              expectedDate: null,
            };

            return {
              itemId: ingredient.itemId,
              itemName: ingredient.itemName,
              needed: ingredient.plannedQuantity,
              available: normalizeNumeric(coverage.inStockQuantity),
              expected: normalizeNumeric(coverage.expectedQuantity),
              expectedDate: coverage.expectedDate,
            };
          });

          return {
            ...order,
            productName,
            productMasterName: display?.masterName ?? productFamilyName ?? productName,
            productAttrs: display?.optionLabels ?? [],
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
                  ) ?? {
                    inStockQuantity: 0,
                    expectedQuantity: 0,
                    expectedDate: null,
                  }),
                })
              ),
            }),
            ingredientExpectedDate,
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
        siblingVariants: Array<{
          itemId: string;
          itemName: string;
          itemSku: string | null;
          itemType: string;
          unitName: string;
          isCurrent: boolean;
        }>;
        alternates: Array<{
          itemId: string;
          itemName: string;
          itemSku: string | null;
          itemType: string;
          unitName: string;
          quantity: string | null;
          quantityFactor: string | null;
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
    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(
      tx,
      [
        ...products.map((product) => product.id),
        ...[...bomByProduct.values()].flatMap((bomRows) =>
          bomRows.flatMap((row) => [
            row.componentId,
            ...row.alternates.map((alternate) => alternate.alternateItemId),
          ])
        ),
      ]
    );
    const siblingVariantsByItemId = await getActiveSiblingVariantsByItemIdInTx(
      tx,
      [...bomByProduct.values()].flatMap((bomRows) =>
        bomRows.map((row) => row.componentId)
      )
    );

    return products
      .filter((product) => (bomByProduct.get(product.id) ?? []).length > 0)
      .map((product) => {
        const bomRows = bomByProduct.get(product.id) ?? [];
        const displayName =
          itemDisplayById.get(product.id)?.displayName ?? product.familyName ?? product.name;

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
            itemName: canonicalItemName(
              itemDisplayById,
              row.componentId,
              row.componentName
            ),
            itemSku: row.componentSku,
            itemType: row.componentItemType,
            unitName: row.unitName,
            quantityPerUnit: row.quantity ?? "0",
            defaultQuantityPerUnit: row.quantity ?? "0",
            siblingVariants: markCurrentSiblingVariants(
              siblingVariantsByItemId.get(row.componentId),
              row.componentId
            ),
            alternates: row.alternates.map((alternate) => ({
              itemId: alternate.alternateItemId,
              itemName: canonicalItemName(
                itemDisplayById,
                alternate.alternateItemId,
                alternate.alternateItemName
              ),
              itemSku: alternate.alternateItemSku,
              itemType: alternate.alternateItemType,
              unitName: alternate.unitName,
              quantity: alternate.quantity,
              quantityFactor: alternate.quantityFactor ?? "1",
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

    const rows = (await tx
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
        quantity: trimScale(salesOrderLines.stockQuantity).as("quantity"),
        unitName: salesOrderLines.stockingUnitName,
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
      .orderBy(desc(salesOrders.createdAt), asc(salesOrderLines.sortOrder))) as ManufacturingSalesLineOption[];

    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(
      tx,
      rows.map((row) => row.itemId)
    );

    return rows.map((row) => ({
      ...row,
      itemName: canonicalItemName(itemDisplayById, row.itemId, row.itemName),
    }));
  });
}

export async function getManufacturingOrder(
  id: string
): Promise<ManufacturingOrderDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productId: manufacturingOrders.productId,
        bomRevisionId: manufacturingOrders.bomRevisionId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        productLotTrackingMode: itemFamilies.lotTrackingMode,
        unitName: manufacturingOrders.unitName,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
        salesOrderNumber: manufacturingOrders.salesOrderNumber,
        salesCustomerName: manufacturingOrders.salesCustomerName,
        status: manufacturingOrders.status,
        version: manufacturingOrders.version,
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
      .leftJoin(salesOrders, eq(manufacturingOrders.salesOrderId, salesOrders.id))
      .leftJoin(items, eq(manufacturingOrders.productId, items.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
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
              bomRevisionComponentId: manufacturingOrderIngredients.bomRevisionComponentId,
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
    const lotAllocationsByLine = getExecutionLotAllocationsByLine(
      batchIngredientsWithDetails ?? (rawIngredients as ExecutionIngredientRow[]),
      lotAllocationsByIngredientId
    );
    const detailIngredients =
      order.bomRevisionId
        ? await (async () => {
            const bomRows = await getBomRevisionComponentsInTx(tx, order.bomRevisionId!);
            const siblingVariantsByItemId =
              await getActiveSiblingVariantsByItemIdInTx(
                tx,
                bomRows.map((row) => row.componentId)
              );
            return ingredients.map((ingredient) => {
              const bomRow = bomRows.find(
                (row) => row.id === ingredient.bomRevisionComponentId
              );

              if (!bomRow) {
                return {
                  ...ingredient,
                  lotAllocations:
                    lotAllocationsByLine.get(
                      getExecutionIngredientLineKey(ingredient)
                    ) ?? [],
                  siblingVariants: [],
                };
              }

              return {
                ...ingredient,
                lotAllocations:
                    lotAllocationsByLine.get(
                      getExecutionIngredientLineKey(ingredient)
                    ) ?? [],
                defaultItemId: bomRow.componentId,
                defaultItemName: bomRow.componentName,
                defaultItemSku: bomRow.componentSku,
                defaultUnitName: bomRow.unitName,
                defaultQuantityPerUnit: bomRow.quantity,
                siblingVariants: markCurrentSiblingVariants(
                  siblingVariantsByItemId.get(bomRow.componentId),
                  ingredient.itemId
                ),
                alternates: bomRow.alternates.map((alternate) => ({
                  itemId: alternate.alternateItemId,
                  itemName: alternate.alternateItemName,
                  itemSku: alternate.alternateItemSku,
                  itemType: alternate.alternateItemType,
                  unitName: alternate.unitName,
                  quantity: alternate.quantity,
                  quantityFactor: alternate.quantityFactor ?? "1",
                  sortOrder: alternate.sortOrder,
                })),
              };
            });
          })()
        : ingredients.map((ingredient) => ({
            ...ingredient,
            lotAllocations:
                    lotAllocationsByLine.get(
                      getExecutionIngredientLineKey(ingredient)
                    ) ?? [],
            siblingVariants: [],
          }));
    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(tx, [
      order.productId,
      ...detailIngredients.flatMap((ingredient) => [
        ingredient.itemId,
        ingredient.defaultItemId,
        ...ingredient.alternates.map((alternate) => alternate.itemId),
      ]),
    ]);
    const displayedDetailIngredients = await withIngredientLotTrackingModesInTx(
      tx,
      detailIngredients.map((ingredient) => ({
        ...ingredient,
        itemName: canonicalItemName(itemDisplayById, ingredient.itemId, ingredient.itemName),
        defaultItemName: ingredient.defaultItemId
          ? canonicalItemName(
              itemDisplayById,
              ingredient.defaultItemId,
              ingredient.defaultItemName ?? ingredient.itemName
            )
          : ingredient.defaultItemName,
        alternates: ingredient.alternates.map((alternate) => ({
          ...alternate,
          itemName: canonicalItemName(
            itemDisplayById,
            alternate.itemId,
            alternate.itemName
          ),
        })),
      }))
    );
    const lotPickPlansByIngredientId =
      await getExecutionLotPickPlansByIngredientInTx(
        tx,
        orgId,
        displayedDetailIngredients
      );
    const displayedDetailIngredientsWithLotGuidance =
      displayedDetailIngredients.map((ingredient) => ({
        ...ingredient,
        lotPickPlan: lotPickPlansByIngredientId.get(ingredient.id) ?? [],
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

    const lotTrackingAccess = await getFeatureAccessInTx(tx, orgId, "lot_tracking");

    return {
      ...order,
      productName: canonicalItemName(itemDisplayById, order.productId, order.productName),
      productLotTrackingMode:
        order.productLotTrackingMode === "untracked" ? "untracked" : "tracked",
      // Producing into a non-available disposition is gated under lot_tracking;
      // clients (web dialog, app) hide the disposition choice off this flag.
      outputDispositionLocked: lotTrackingAccess.locked,
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
      ingredients: displayedDetailIngredientsWithLotGuidance,
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
        priorityRank: effectiveManufacturingPriorityRankSql().as("priorityRank"),
        plannedDate: manufacturingOrders.plannedDate,
        notes: manufacturingOrders.notes,
      })
      .from(manufacturingOrders)
      .leftJoin(salesOrders, eq(manufacturingOrders.salesOrderId, salesOrders.id))
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
    const lotAllocationsByItemId = new Map<
      string,
      Array<{ sourceId: string; quantity: string }>
    >();

    const bomRows =
      order.bomRevisionId == null
        ? []
        : await getBomRevisionComponentsInTx(tx, order.bomRevisionId);

    const bomById = new Map(bomRows.map((row) => [row.id, row]));
    const itemDisplayById = await getManufacturingItemDisplayMetadataInTx(tx, [
      order.productId,
      ...editableIngredients.flatMap((ingredient) => [ingredient.itemId]),
      ...bomRows.flatMap((row) => [
        row.componentId,
        ...row.alternates.map((alternate) => alternate.alternateItemId),
      ]),
    ]);
    const siblingVariantsByItemId = await getActiveSiblingVariantsByItemIdInTx(
      tx,
      bomRows.map((row) => row.componentId)
    );

    return {
      ...order,
      productName: canonicalItemName(itemDisplayById, order.productId, order.productName),
      ingredients: editableIngredients.map((ingredient) => {
        const bomRow = ingredient.bomRevisionComponentId
          ? bomById.get(ingredient.bomRevisionComponentId)
          : undefined;
        return {
          id: ingredient.id,
          itemId: ingredient.itemId,
          itemName: canonicalItemName(
            itemDisplayById,
            ingredient.itemId,
            ingredient.itemName
          ),
          itemSku: ingredient.itemSku,
          itemType: ingredient.itemType,
          unitName: ingredient.unitName,
          quantityPerUnit: ingredient.quantityPerUnit,
          defaultItemId: bomRow?.componentId ?? ingredient.itemId,
          defaultItemName: bomRow
            ? canonicalItemName(itemDisplayById, bomRow.componentId, bomRow.componentName)
            : canonicalItemName(itemDisplayById, ingredient.itemId, ingredient.itemName),
          defaultItemSku: bomRow?.componentSku ?? ingredient.itemSku,
          defaultUnitName: bomRow?.unitName ?? ingredient.unitName,
          defaultQuantityPerUnit: bomRow?.quantity ?? ingredient.quantityPerUnit,
          siblingVariants: bomRow
            ? markCurrentSiblingVariants(
                siblingVariantsByItemId.get(bomRow.componentId),
                ingredient.itemId
              )
            : [],
          alternates: (bomRow?.alternates ?? []).map((alternate) => ({
            itemId: alternate.alternateItemId,
            itemName: canonicalItemName(
              itemDisplayById,
              alternate.alternateItemId,
              alternate.alternateItemName
            ),
            itemSku: alternate.alternateItemSku,
            itemType: alternate.alternateItemType,
            unitName: alternate.unitName,
            quantity: alternate.quantity,
            quantityFactor: alternate.quantityFactor ?? "1",
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
