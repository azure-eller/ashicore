import "server-only";

// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  type InventoryEventType,
  type InventoryDisposition,
  inventoryEvents,
  inventoryLotBalances,
  inventoryReservationsSummary,
  itemFamilies,
  itemVariantValues,
  items,
  accountingClassifications,
  integrationExternalRecords,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  manufacturingResources,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  stocktakeItems,
  stocktakes,
  supplierItems,
  suppliers,
  unitDefinitions,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeNumeric, normalizeNumericScale } from "@/lib/format";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import {
  getBomRevisionComponentsInTx,
  getBomRevisionComponentsByRevisionIdInTx,
  getBomRevisionHistoryInTx,
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import {
  createLotAgeMinDaysConstraint,
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  changeLotDispositionInTx,
  appendPositiveStockToExistingLotInTx,
  consumeSpecificLotInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getDefaultInventoryLocationInTx,
  getCurrentOnHandQtyInTx,
  ledgerLotUnitCostByOrigin,
  lockItemsInTx,
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  resolvePositiveStockUnitCostInTx,
  defaultLocationIdSubquery,
  projectedAvailableQty,
  projectedCommittedQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedLotUnitCost,
  projectedOnHandQty,
  projectedPotentialQty,
  projectedReservableOnHandQty,
  projectedShortageQty,
  recordCostBasisChangeInTx,
  scrapLotDispositionInTx,
} from "@/lib/inventory/kernel";
import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import { getEstimatedRecipeCostSummariesByItemIdInTx } from "@/lib/inventory/estimated-cost";
import { getCurrentBomOperationCostsInTx } from "@/lib/bom/operation-costs";
import { calculatePlannedOperationCost } from "@/lib/manufacturing/operation-costs";
import { calculateMarginMetrics } from "@/lib/margin";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import type { InsertItem, UpdateItem } from "@/lib/schemas/items";
import type { QualityDispositionAction } from "@/lib/schemas/inventory-disposition";
import type { LotQuantityAdjustment } from "@/lib/schemas/lot-adjustment";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import { DomainError } from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  DuplicateCombinationWarning,
  ItemRow,
  ItemType,
  VariantOptionValueDisplay,
} from "../types";
import {
  buildItemCommitmentSummary,
  type ItemCommitmentSummary,
} from "../commitment-summary";
import {
  applyMarginTiers,
  calculateMarginPercent,
} from "./metrics";
import {
  hasBomChanged,
  hasBomOperationCostsChanged,
  type BomInputRow,
  type BomOperationCostInputRow,
} from "./bom-write";

export class InventoryError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "InventoryError" });
  }
}

const MATERIAL_USAGE_CONSUMPTION_EVENT_TYPES = [
  "sales_consumption",
  "manufacturing_ingredient_consumption",
] as const satisfies readonly InventoryEventType[];
const MATERIAL_USAGE_REVERSAL_EVENT_TYPES = [
  "unpick_restock",
] as const satisfies readonly InventoryEventType[];
const MATERIAL_USAGE_EVENT_TYPES = [
  ...MATERIAL_USAGE_CONSUMPTION_EVENT_TYPES,
  ...MATERIAL_USAGE_REVERSAL_EVENT_TYPES,
] as const satisfies readonly InventoryEventType[];
const PRODUCT_PRODUCTION_EVENT_TYPES = [
  "manufacturing_output",
] as const satisfies readonly InventoryEventType[];

export type ItemHistoryMode = "usage" | "production";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type ItemUsageHistoryBucket = {
  periodStart: string;
  periodEnd: string;
  quantity: string;
};

export type ItemUsageHistory = {
  itemId: string;
  itemName: string;
  itemType: ItemType;
  mode: ItemHistoryMode;
  unitName: string | null;
  days: number;
  bucket: "week";
  totals: {
    last30Days: string;
    last90Days: string;
    last180Days: string;
    averageWeekly90Days: string;
  };
  buckets: ItemUsageHistoryBucket[];
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addUtcDays(startOfUtcDay(date), mondayOffset);
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function usageEventSign(eventType: InventoryEventType) {
  return MATERIAL_USAGE_REVERSAL_EVENT_TYPES.includes(
    eventType as (typeof MATERIAL_USAGE_REVERSAL_EVENT_TYPES)[number]
  )
    ? -1
    : 1;
}

function historyEventTypes(mode: ItemHistoryMode) {
  return mode === "production"
    ? PRODUCT_PRODUCTION_EVENT_TYPES
    : MATERIAL_USAGE_EVENT_TYPES;
}

function historyEventSign(mode: ItemHistoryMode, eventType: InventoryEventType) {
  return mode === "usage" ? usageEventSign(eventType) : 1;
}

function normalizeUsageQuantity(value: number) {
  return normalizeNumericScale(Math.max(0, value), 4);
}

const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
const committedQtySubquery = projectedCommittedQty(
  items.organizationId,
  items.id
).as("committedQty");
const demandQtySubquery = projectedDemandQty(
  items.organizationId,
  items.id
).as("demandQty");
const shortageQtySubquery = projectedShortageQty(
  items.organizationId,
  items.id
).as("shortageQty");
const availableQtySubquery = projectedAvailableQty(
  items.organizationId,
  items.id
).as("availableQty");
const reservableOnHandQtySubquery = projectedReservableOnHandQty(
  items.organizationId,
  items.id
).as("reservableOnHandQty");
const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");
const potentialSubquery = projectedPotentialQty(
  items.organizationId,
  items.id,
  items.itemType
).as("potential");

async function getVariantOptionValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, VariantOptionValueDisplay[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionId: variantOptions.id,
      optionName: variantOptions.name,
      optionCode: variantOptions.code,
      valueId: variantOptionValues.id,
      valueLabel: variantOptionValues.label,
      valueCode: variantOptionValues.code,
      optionDisabledAt: variantOptions.disabledAt,
      valueDisabledAt: variantOptionValues.disabledAt,
      sortOrder: variantOptions.sortOrder,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id),
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, VariantOptionValueDisplay[]>();
  for (const row of rows) {
    const values = byItemId.get(row.itemId) ?? [];
    values.push({
      optionId: row.optionId,
      optionName: row.optionName,
      optionCode: row.optionCode,
      valueId: row.valueId,
      valueLabel: row.valueLabel,
      valueCode: row.valueCode,
      optionDisabledAt: row.optionDisabledAt,
      valueDisabledAt: row.valueDisabledAt,
    });
    byItemId.set(row.itemId, values);
  }

  return byItemId;
}

function formatNormalizedVariantDisplay(
  familyName: string | null,
  itemName: string,
  optionValues: VariantOptionValueDisplay[],
  deletedAt?: Date | null,
) {
  const baseName = familyName ?? itemName;
  const display =
    optionValues.length === 0
      ? baseName
      : `${baseName} / ${optionValues.map((value) => value.valueLabel).join(" / ")}`;
  return deletedAt ? `${display} (deleted)` : display;
}

function buildDuplicateCombinationWarnings(
  rows: Array<{
    id: string;
    optionCombinationKey: string;
  }>,
) {
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.optionCombinationKey) continue;
    idsByKey.set(row.optionCombinationKey, [
      ...(idsByKey.get(row.optionCombinationKey) ?? []),
      row.id,
    ]);
  }

  const warningsByVariantId = new Map<string, DuplicateCombinationWarning[]>();
  for (const [optionCombinationKey, variantIds] of idsByKey.entries()) {
    if (variantIds.length < 2) continue;

    for (const variantId of variantIds) {
      warningsByVariantId.set(variantId, [
        ...(warningsByVariantId.get(variantId) ?? []),
        {
          variantId,
          duplicateOfVariantIds: variantIds.filter((id) => id !== variantId),
          optionCombinationKey,
          message: "Another variant uses the same option values.",
        },
      ]);
    }
  }

  return warningsByVariantId;
}

type BomViewPermissions = {
  canViewUnlockedBom: boolean;
  canViewLockedBom: boolean;
};

function normalizeCurrentStockUnitCost(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InventoryError(
      "Current stock unit cost must be a non-negative number."
    );
  }

  return normalizeStockUnitCost(parsed);
}

function getBomViewPermissions(assignedRoles: string[]): BomViewPermissions {
  return {
    canViewUnlockedBom: canViewUnlockedBom(assignedRoles),
    canViewLockedBom: canViewLockedBom(assignedRoles),
  };
}

function hasBomViewAccess(permissions: BomViewPermissions) {
  return permissions.canViewUnlockedBom || permissions.canViewLockedBom;
}

function getBomParentVisibilityCondition(
  bomLockedColumn: typeof items.bomLocked,
  permissions: BomViewPermissions,
) {
  if (permissions.canViewLockedBom) {
    return sql`true`;
  }

  if (permissions.canViewUnlockedBom) {
    return sql`${bomLockedColumn} = false`;
  }

  return sql`false`;
}

async function getCurrentBomProductIdSetInTx(tx: Tx, productIds: string[]) {
  const uniqueProductIds = [...new Set(productIds)];

  if (uniqueProductIds.length === 0) {
    return new Set<string>();
  }

  const rows = await tx
    .select({ productId: bomRevisions.productId })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true),
      ),
    );

  return new Set(rows.map((row) => row.productId));
}

async function getUsedInCountsInTx(
  tx: Tx,
  componentIds: string[],
  permissions: BomViewPermissions,
) {
  const uniqueComponentIds = [...new Set(componentIds)];

  if (uniqueComponentIds.length === 0 || !hasBomViewAccess(permissions)) {
    return new Map<string, number>();
  }

  const bomParentVisibilityCondition = getBomParentVisibilityCondition(
    items.bomLocked,
    permissions,
  );
  const rows = await tx
    .select({
      componentId: bomRevisionComponents.componentId,
      usedInCount: sql<number>`COUNT(DISTINCT ${bomRevisions.productId})::int`,
    })
    .from(bomRevisionComponents)
    .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
    .innerJoin(items, eq(bomRevisions.productId, items.id))
    .where(
      and(
        inArray(bomRevisionComponents.componentId, uniqueComponentIds),
        eq(bomRevisions.isCurrent, true),
        isNull(items.deletedAt),
        bomParentVisibilityCondition,
      ),
    )
    .groupBy(bomRevisionComponents.componentId);

  return new Map(rows.map((row) => [row.componentId, Number(row.usedInCount)]));
}

async function getRevenue30dByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];

  if (uniqueItemIds.length === 0) {
    return new Map<string, string>();
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await tx
    .select({
      itemId: salesOrderLines.itemId,
      revenue30d: trimScaleNullable(sql`SUM(${salesOrderLines.lineTotal})`).as("revenue30d"),
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrderLines.itemId, uniqueItemIds),
        eq(salesOrders.status, "done"),
        isNull(salesOrders.deletedAt),
        sql`${salesOrders.shippedAt} >= ${thirtyDaysAgo}`,
      ),
    )
    .groupBy(salesOrderLines.itemId);

  return new Map(
    rows
      .filter((row): row is typeof row & { revenue30d: string } => row.revenue30d != null)
      .map((row) => [row.itemId, row.revenue30d]),
  );
}

export async function createBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    productId: string;
    note?: string | null;
    outputQuantity?: string | null;
    recipeBasis?: "unit" | "batch";
    bom: BomInputRow[];
    operationCosts?: BomOperationCostInputRow[];
  }
) {
  const [currentRevision] = await tx
    .select({ revisionNumber: bomRevisions.revisionNumber })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)))
    .for("update");

  await tx
    .update(bomRevisions)
    .set({
      isCurrent: false,
      updatedAt: new Date(),
    })
    .where(and(eq(bomRevisions.productId, params.productId), eq(bomRevisions.isCurrent, true)));

  const [revision] = await tx
    .insert(bomRevisions)
    .values({
      organizationId: params.orgId,
      productId: params.productId,
      revisionNumber: (currentRevision?.revisionNumber ?? 0) + 1,
      outputQuantity: params.outputQuantity ?? "1",
      recipeBasis: params.recipeBasis ?? "unit",
      isCurrent: true,
      note: params.note ?? null,
      createdBy: params.userId,
    })
    .returning({
      id: bomRevisions.id,
      revisionNumber: bomRevisions.revisionNumber,
    });

  if (params.bom.length > 0) {
    const componentIds = [...new Set(params.bom.map((row) => row.componentId))];
    const componentRows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(inArray(items.id, componentIds), isNull(items.deletedAt)));

    const componentById = new Map(componentRows.map((row) => [row.id, row]));

    const componentValues = params.bom.map((row, index) => {
      const component = componentById.get(row.componentId);

      if (!component) {
        throw new Error("BOM component not found");
      }

      return {
        bomRevisionId: revision.id,
        componentId: row.componentId,
        componentName: component.name,
        componentSku: component.sku,
        componentItemType: component.itemType,
        unitName: component.unitName,
        quantity: row.quantity,
        sortOrder: index,
      };
    });

    const insertedComponents = await tx
      .insert(bomRevisionComponents)
      .values(componentValues)
      .returning({
        id: bomRevisionComponents.id,
        componentId: bomRevisionComponents.componentId,
        sortOrder: bomRevisionComponents.sortOrder,
      });

    const alternateItemIds = [
      ...new Set(
        params.bom.flatMap((row) =>
          (row.alternates ?? []).map((alternate) => alternate.itemId)
        )
      ),
    ];
    const alternateRows =
      alternateItemIds.length === 0
        ? []
        : await tx
            .select({
              id: items.id,
              name: items.name,
              sku: items.sku,
              itemType: items.itemType,
              unitName: unitDefinitions.name,
              unitSize: trimScale(unitDefinitions.size).as("unitSize"),
              unitUom: unitDefinitions.uom,
            })
            .from(items)
            .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
            .where(and(inArray(items.id, alternateItemIds), isNull(items.deletedAt)));
    const alternateById = new Map(alternateRows.map((row) => [row.id, row]));

    const inputBySortOrder = new Map(
      params.bom.map((input, sortOrder) => [sortOrder, input])
    );

    const constraintRows = insertedComponents.flatMap((component) => {
      const input = inputBySortOrder.get(component.sortOrder);
      const constraint = createLotAgeMinDaysConstraint(
        input?.minimumLotAgeDays ?? null
      );
      if (!constraint) return [];

      return [
        {
          bomRevisionComponentId: component.id,
          constraintType: constraint.constraintType,
          config: constraint.config,
          sortOrder: constraint.sortOrder,
        },
      ];
    });

    if (constraintRows.length > 0) {
      await tx.insert(bomRevisionComponentConstraints).values(constraintRows);
    }

    const alternateValues = insertedComponents.flatMap((component) => {
      const input = inputBySortOrder.get(component.sortOrder);
      const defaultComponent = componentById.get(component.componentId);

      return (input?.alternates ?? []).map((alternate, alternateIndex) => {
        const alternateItem = alternateById.get(alternate.itemId);

        if (!defaultComponent || !alternateItem) {
          throw new InventoryError("BOM alternate component not found", 400);
        }

        const quantityFactor = derivePurchaseToStockFactor(
          { size: defaultComponent.unitSize, uom: defaultComponent.unitUom },
          { size: alternateItem.unitSize, uom: alternateItem.unitUom }
        );

        if (quantityFactor == null) {
          throw new InventoryError(
            `${alternateItem.name} is not unit-compatible with ${defaultComponent.name}.`,
            400
          );
        }

        return {
          bomRevisionComponentId: component.id,
          alternateItemId: alternateItem.id,
          alternateItemName: alternateItem.name,
          alternateItemSku: alternateItem.sku,
          alternateItemType: alternateItem.itemType,
          unitName: alternateItem.unitName,
          quantityFactor: normalizeNumeric(quantityFactor),
          sortOrder: alternateIndex,
        };
      });
    });

    if (alternateValues.length > 0) {
      await tx.insert(bomRevisionComponentAlternates).values(alternateValues);
    }
  }

  if (params.operationCosts && params.operationCosts.length > 0) {
    const resourceIds = [...new Set(params.operationCosts.map((row) => row.resourceId))];
    const resourceRows = await tx
      .select({
        id: manufacturingResources.id,
        name: manufacturingResources.name,
        resourceType: manufacturingResources.resourceType,
        loadedCostPerHour: trimScale(manufacturingResources.loadedCostPerHour).as(
          "loadedCostPerHour"
        ),
      })
      .from(manufacturingResources)
      .where(and(inArray(manufacturingResources.id, resourceIds), isNull(manufacturingResources.deletedAt)));
    const resourceById = new Map(resourceRows.map((row) => [row.id, row]));

    await tx.insert(bomRevisionOperationCosts).values(
      params.operationCosts.map((row, index) => {
        const resource = resourceById.get(row.resourceId);
        if (!resource) {
          throw new InventoryError("Operation resource not found", 400);
        }

        return {
          bomRevisionId: revision.id,
          resourceId: row.resourceId,
          operationName: row.operationName.trim(),
          resourceName: resource.name,
          resourceType: resource.resourceType,
          costScalingMode: row.costScalingMode,
          crewSize: row.crewSize,
          plannedMinutes: row.plannedMinutes,
          loadedCostPerHour: row.loadedCostPerHour ?? resource.loadedCostPerHour,
          plannedCostTotal: calculatePlannedOperationCost({
            costScalingMode: row.costScalingMode,
            crewSize: row.crewSize,
            plannedMinutes: row.plannedMinutes,
            loadedCostPerHour: row.loadedCostPerHour ?? resource.loadedCostPerHour,
            outputQuantity: Number(params.outputQuantity ?? "1"),
          }),
          sortOrder: index,
        };
      })
    );
  }

  return revision;
}

export async function getItems(filters?: {
  itemType?: ItemType;
}): Promise<ItemRow[]> {
  return measureObservedOperation(
    "inventory.get_items",
    async () => {
      const context = await getAuthedMemberContext();
      const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

      return withAuthedOrgContext<ItemRow[]>(async (tx) => {
        const rows = await measureObservedOperation(
          "inventory.get_items.base_query",
          () =>
            tx
              .select({
                id: items.id,
                familyId: items.familyId,
                familyName: itemFamilies.name,
                name: items.name,
                sku: items.sku,
                itemType: items.itemType,
                optionCombinationKey: items.optionCombinationKey,
                stock: stockSubquery,
                committedQty: committedQtySubquery,
                demandQty: demandQtySubquery,
                shortageQty: shortageQtySubquery,
                availableQty: availableQtySubquery,
                expectedQty: expectedQtySubquery,
                safetyStock: trimScale(items.safetyStock).as("safetyStock"),
                defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
                currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
                  "currentStockUnitCost"
                ),
                unit: unitDefinitions.name,
                unitSize: unitDefinitions.size,
                unitUom: unitDefinitions.uom,
                category: items.category,
                familyCategory: itemFamilies.category,
                potential: potentialSubquery,
                sellable: items.sellable,
                createdAt: items.createdAt,
              })
              .from(items)
              .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
              .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
              .where(
                and(
                  isNull(items.deletedAt),
                  isNotNull(items.familyId),
                  ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
                ),
              ),
          {
            extra: {
              itemType: filters?.itemType ?? "all",
            },
            successData: (baseRows) => ({
              rowCount: baseRows.length,
            }),
          }
        );

        const leafIds = rows.map((row) => row.id);
        const [hasBomSet, usedInCounts, revenueByItemId, estimatedCostSummariesByItemId] = await Promise.all([
          measureObservedOperation(
            "inventory.get_items.current_bom_set",
            () => getCurrentBomProductIdSetInTx(tx, leafIds),
            {
              extra: { rowCount: leafIds.length },
              successData: (set) => ({ resultCount: set.size }),
            }
          ),
          measureObservedOperation(
            "inventory.get_items.used_in_counts",
            () => getUsedInCountsInTx(tx, leafIds, bomViewPermissions),
            {
              extra: { rowCount: leafIds.length },
              successData: (counts) => ({ resultCount: counts.size }),
            }
          ),
          measureObservedOperation(
            "inventory.get_items.revenue_30d",
            () => getRevenue30dByItemIdInTx(tx, leafIds),
            {
              extra: { rowCount: leafIds.length },
              successData: (revenueRows) => ({ resultCount: revenueRows.size }),
            }
          ),
          measureObservedOperation(
            "inventory.get_items.estimated_recipe_costs",
            () => getEstimatedRecipeCostSummariesByItemIdInTx(tx, leafIds),
            {
              extra: { rowCount: leafIds.length },
              successData: (summaries) => ({ resultCount: summaries.size }),
            }
          ),
        ]);
        const optionValuesByItemId = await measureObservedOperation(
          "inventory.get_items.variant_option_values",
          () => getVariantOptionValuesByItemIdInTx(tx, leafIds),
          {
            extra: { rowCount: leafIds.length },
            successData: (optionRows) => ({ resultCount: optionRows.size }),
          }
        );

        const results = await measureObservedOperation(
          "inventory.get_items.map_sort",
          async () => {
            const duplicateWarningsByItemId = buildDuplicateCombinationWarnings(rows);
            const mappedRows: ItemRow[] = rows
              .map<ItemRow>((row) => {
                const usedInCount = usedInCounts.get(row.id) ?? 0;
                const estimatedUnitCost =
                  estimatedCostSummariesByItemId.get(row.id)?.totalCost ?? null;
                const optionValues = optionValuesByItemId.get(row.id) ?? [];
                const displayName =
                  optionValues.length > 0
                    ? formatNormalizedVariantDisplay(row.familyName, row.name, optionValues)
                    : row.familyName ?? row.name;

                return {
                  id: row.id,
                  familyId: row.familyId,
                  familyName: row.familyName,
                  name: row.name,
                  displayName,
                  sku: row.sku,
                  itemType: row.itemType as ItemType,
                  stock: row.stock,
                  committedQty: row.committedQty,
                  demandQty: row.demandQty,
                  shortageQty: row.shortageQty,
                  availableQty: row.availableQty,
                  expectedQty: row.expectedQty,
                  safetyStock: row.safetyStock,
                  currentStockUnitCost:
                    row.itemType === "material" ? row.currentStockUnitCost : null,
                  unit: row.unit ?? null,
                  unitSize: row.unitSize ?? null,
                  unitUom: row.unitUom ?? null,
                  category: row.familyCategory ?? row.category,
                  optionCombinationKey: row.optionCombinationKey,
                  optionValues,
                  duplicateCombinationWarnings:
                    duplicateWarningsByItemId.get(row.id) ?? [],
                  potential: row.potential,
                  estimatedUnitCost,
                  marginPercent: calculateMarginPercent(
                    row.defaultSellingPrice,
                    estimatedUnitCost,
                  ),
                  marginTier: null,
                  variantCount: 0,
                  priceRange: null,
                  sellable: row.sellable,
                  hasBom: hasBomSet.has(row.id),
                  usedInBom: usedInCount > 0,
                  usedInCount,
                  revenue30d: revenueByItemId.get(row.id) ?? null,
                  createdAt: row.createdAt,
                };
              })
              .sort((a, b) => {
                if (a.sellable !== b.sellable) {
                  return a.sellable === true ? -1 : 1;
                }

                const displayNameDiff = a.displayName.localeCompare(
                  b.displayName,
                  undefined,
                  { numeric: true, sensitivity: "base" },
                );
                if (displayNameDiff !== 0) return displayNameDiff;

                const skuDiff = (a.sku ?? "").localeCompare(b.sku ?? "", undefined, {
                  numeric: true,
                  sensitivity: "base",
                });
                if (skuDiff !== 0) return skuDiff;

                return a.id.localeCompare(b.id);
              });

            return applyMarginTiers(mappedRows);
          },
          {
            extra: { rowCount: rows.length },
            successData: (mappedRows) => ({ resultCount: mappedRows.length }),
          }
        );

        return results;
      });
    },
    {
      extra: {
        itemType: filters?.itemType ?? null,
      },
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        familyName: itemFamilies.name,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
        description: sql<string | null>`COALESCE(${itemFamilies.description}, ${items.description})`,
        unitDefinitionId: sql<string | null>`COALESCE(${items.unitDefinitionId}, ${itemFamilies.unitDefinitionId})`,
        purchaseUnitDefinitionId: sql<string | null>`COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})`,
        purchaseToStockFactor: trimScaleNullable(
          sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`
        ).as("purchaseToStockFactor"),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        sellable: items.sellable,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        typicalBatchSize: trimScaleNullable(items.typicalBatchSize).as(
          "typicalBatchSize"
        ),
        standardCostQuantity: trimScaleNullable(items.standardCostQuantity).as(
          "standardCostQuantity"
        ),
        optionCombinationKey: items.optionCombinationKey,
        registeredBarcode: items.registeredBarcode,
        internalBarcode: items.internalBarcode,
        supplierItemCode: items.supplierItemCode,
        defaultLeadTimeDays: items.defaultLeadTimeDays,
        minimumOrderQuantity: trimScaleNullable(items.minimumOrderQuantity).as(
          "minimumOrderQuantity"
        ),
        bomLocked: items.bomLocked,
        bomLockedAt: items.bomLockedAt,
        bomLockedByUserId: items.bomLockedByUserId,
        stock: stockSubquery,
        committedQty: committedQtySubquery,
        demandQty: demandQtySubquery,
        shortageQty: shortageQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, id), isNull(items.deletedAt)));

    if (!row) {
      return null;
    }

    const purchaseUnit = row.purchaseUnitDefinitionId
      ? await tx
          .select({
            id: unitDefinitions.id,
            name: unitDefinitions.name,
            size: trimScale(unitDefinitions.size).as("size"),
            uom: unitDefinitions.uom,
          })
          .from(unitDefinitions)
          .where(eq(unitDefinitions.id, row.purchaseUnitDefinitionId))
          .then((rows) => rows[0] ?? null)
      : null;
    const currentBomRevision = await getCurrentBomRevisionInTx(tx, id);

    const [externalItemRecord] = await tx
      .select({
        externalCode: integrationExternalRecords.externalCode,
        externalName: integrationExternalRecords.externalName,
        externalDescription: integrationExternalRecords.externalDescription,
        externalUpdatedAt: integrationExternalRecords.externalUpdatedAt,
      })
      .from(integrationExternalRecords)
      .where(
        and(
          eq(integrationExternalRecords.provider, "xero"),
          eq(integrationExternalRecords.entityType, "item"),
          eq(integrationExternalRecords.localRecordId, id)
        )
      );

    const [accountingClassification] = await tx
      .select({
        accountCode: accountingClassifications.accountCode,
        taxType: accountingClassifications.taxType,
      })
      .from(accountingClassifications)
      .where(
        and(
          eq(accountingClassifications.provider, "xero"),
          eq(accountingClassifications.entityType, "item"),
          eq(accountingClassifications.localRecordId, id)
        )
      );

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(tx, [id]);
    const optionValues = optionValuesByItemId.get(id) ?? [];
    const familyVariants = row.familyId
      ? await tx
          .select({
            id: items.id,
            optionCombinationKey: items.optionCombinationKey,
          })
          .from(items)
          .where(and(eq(items.familyId, row.familyId), isNull(items.deletedAt)))
      : [{ id: row.id, optionCombinationKey: row.optionCombinationKey }];
    const duplicateWarningsByItemId =
      buildDuplicateCombinationWarnings(familyVariants);

    const supplierSources = await tx
      .select({
        id: supplierItems.id,
        supplierName: suppliers.name,
        supplierSku: supplierItems.supplierSku,
        unitCost: trimScaleNullable(supplierItems.unitCost).as("unitCost"),
        isPreferred: supplierItems.isPreferred,
      })
      .from(supplierItems)
      .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
      .where(
        and(
          eq(supplierItems.itemId, id),
          isNull(supplierItems.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(desc(supplierItems.isPreferred), asc(suppliers.name));

    return {
      ...row,
      xeroItemCode: externalItemRecord?.externalCode ?? null,
      xeroItemName: externalItemRecord?.externalName ?? null,
      xeroPurchaseDescription: externalItemRecord?.externalDescription ?? null,
      accountingPurchaseAccountCode: accountingClassification?.accountCode ?? null,
      xeroPurchaseTaxType: accountingClassification?.taxType ?? null,
      xeroUpdatedAt: externalItemRecord?.externalUpdatedAt ?? null,
      parentName: null,
      optionValues,
      duplicateCombinationWarnings:
        duplicateWarningsByItemId.get(row.id) ?? [],
      displayName: optionValues.length > 0
        ? formatNormalizedVariantDisplay(row.familyName, row.name, optionValues)
        : row.familyName ?? row.name,
      purchaseUnitName: purchaseUnit?.name ?? null,
      purchaseUnitSize: purchaseUnit?.size ?? null,
      purchaseUnitUom: purchaseUnit?.uom ?? null,
      currentBomRevision,
      supplierSources,
    };
  });
}

export async function getItemCommitmentSummary(
  itemId: string
): Promise<ItemCommitmentSummary> {
  return withAuthedOrgContext(async (tx) => {
    const [itemRow] = await tx
      .select({
        itemId: items.id,
        onHandQty: stockSubquery,
        reservableOnHandQty: reservableOnHandQtySubquery,
        availableQty: availableQtySubquery,
        committedQty: committedQtySubquery,
        demandQty: demandQtySubquery,
        shortageQty: shortageQtySubquery,
        unitName: unitDefinitions.name,
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)));

    if (!itemRow) {
      throw new InventoryError("Item not found", 404);
    }

    const customerReservations = await tx
      .select({
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        quantity: trimScale(sql`SUM(${inventoryReservationsSummary.quantity})`).as(
          "quantity"
        ),
      })
      .from(inventoryReservationsSummary)
      .innerJoin(
        salesOrderLines,
        eq(inventoryReservationsSummary.referenceId, salesOrderLines.id)
      )
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(inventoryReservationsSummary.itemId, itemId),
          eq(
            inventoryReservationsSummary.locationId,
            defaultLocationIdSubquery(inventoryReservationsSummary.organizationId)
          ),
          eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
          eq(salesOrders.status, "open"),
          isNull(salesOrders.deletedAt),
          sql`${inventoryReservationsSummary.quantity} > 0`
        )
      )
      .groupBy(salesOrders.customerId, salesOrders.customerName)
      .orderBy(desc(sql`SUM(${inventoryReservationsSummary.quantity})`));

    return buildItemCommitmentSummary({
      ...itemRow,
      customerReservations,
    });
  });
}

export async function deleteItem(
  id: string
): Promise<{
  deleted: boolean;
  usedInBom?: boolean;
  usedInActiveOrders?: boolean;
  usedInActiveManufacturing?: boolean;
  usedInActivePurchasing?: boolean;
  usedInDraftStocktakes?: boolean;
}> {
  return withAuthedOrgContext(async (tx) => {
    await lockItemsInTx(tx, [id]);

    // Check BOM usage inside the same transaction to avoid race conditions
    const [bomRef] = await tx
      .select({ id: bomRevisionComponents.id })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .where(
        and(
          eq(bomRevisionComponents.componentId, id),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt)
        )
      )
      .limit(1);

    if (bomRef) {
      return { deleted: false, usedInBom: true };
    }

    const [activeOrderRef] = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrderLines.itemId, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return { deleted: false, usedInActiveOrders: true };
    }

    const [activeManufacturingRef] = await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderIngredients,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "open"),
          or(
            eq(manufacturingOrders.productId, id),
            eq(manufacturingOrderIngredients.itemId, id)
          )
        )
      )
      .limit(1);

    if (activeManufacturingRef) {
      return { deleted: false, usedInActiveManufacturing: true };
    }

    const [activePurchasingRef] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
      )
      .where(
        and(
          eq(purchaseOrderLines.itemId, id),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["draft", "ordered", "partial"])
        )
      )
      .limit(1);

    if (activePurchasingRef) {
      return { deleted: false, usedInActivePurchasing: true };
    }

    const [draftStocktakeRef] = await tx
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .innerJoin(stocktakeItems, eq(stocktakeItems.stocktakeId, stocktakes.id))
      .where(
        and(
          eq(stocktakeItems.itemId, id),
          eq(stocktakes.status, "draft")
        )
      )
      .limit(1);

    if (draftStocktakeRef) {
      return { deleted: false, usedInDraftStocktakes: true };
    }

    const [row] = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });
    return { deleted: row != null };
  });
}

export async function deleteItems(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    await lockItemsInTx(tx, uniqueIds);

    const [bomRef] = await tx
      .select({ componentId: bomRevisionComponents.componentId })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .where(
        and(
          inArray(bomRevisionComponents.componentId, uniqueIds),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt)
        )
      )
      .limit(1);

    if (bomRef) {
      return {
        deletedCount: 0,
        error: "Cannot delete: one or more items are used as a component in other products.",
      };
    }

    const [activeOrderRef] = await tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          inArray(salesOrderLines.itemId, uniqueIds),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by active sales orders.",
      };
    }

    const [activeManufacturingRef] = await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderIngredients,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          isNull(manufacturingOrders.deletedAt),
          eq(manufacturingOrders.status, "open"),
          or(
            inArray(manufacturingOrders.productId, uniqueIds),
            inArray(manufacturingOrderIngredients.itemId, uniqueIds)
          )
        )
      )
      .limit(1);

    if (activeManufacturingRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by open manufacturing orders.",
      };
    }

    const [activePurchasingRef] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
      )
      .where(
        and(
          inArray(purchaseOrderLines.itemId, uniqueIds),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["draft", "ordered", "partial"])
        )
      )
      .limit(1);

    if (activePurchasingRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by draft, ordered, or partially received purchase orders.",
      };
    }

    const [draftStocktakeRef] = await tx
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .innerJoin(stocktakeItems, eq(stocktakeItems.stocktakeId, stocktakes.id))
      .where(
        and(
          inArray(stocktakeItems.itemId, uniqueIds),
          eq(stocktakes.status, "draft")
        )
      )
      .limit(1);

    if (draftStocktakeRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by a draft stocktake.",
      };
    }

    const deleted = await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(inArray(items.id, uniqueIds), isNull(items.deletedAt))
      )
      .returning({ id: items.id });

    return { deletedCount: deleted.length };
  });
}

export async function getUnitDefinitions() {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      })
      .from(unitDefinitions)
      .where(isNull(unitDefinitions.deletedAt));
  });
}

export async function getCategories(): Promise<string[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .selectDistinct({ category: items.category })
      .from(items)
      .where(and(isNotNull(items.category), isNull(items.deletedAt)));

    // isNotNull(items.category) in the WHERE clause guarantees no nulls
    return rows.map((r) => r.category as string);
  });
}

export async function getLots(
  itemId: string,
  options: { includeNegativeBalances?: boolean } = {}
) {
  return withAuthedOrgContext(async (tx) => {
    const allocationRows = await tx
      .select({
        lotId: stockAllocations.sourceId,
        salesOrderId: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        quantity: trimScale(stockAllocations.quantity).as("quantity"),
      })
      .from(stockAllocations)
      .innerJoin(salesOrderLines, eq(stockAllocations.demandId, salesOrderLines.id))
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(stockAllocations.demandType, "sales_order_line"),
          eq(stockAllocations.sourceType, "inventory_lot"),
          eq(stockAllocations.status, "active"),
          eq(stockAllocations.itemId, itemId),
          isNull(salesOrders.deletedAt)
        )
      )
      .orderBy(asc(salesOrders.orderNumber));
    const manufacturingAllocationRows = await tx
      .select({
        lotId: stockAllocations.sourceId,
        manufacturingOrderId: manufacturingOrders.id,
        orderNumber: manufacturingOrders.orderNumber,
        productName: manufacturingOrders.productName,
        quantity: trimScale(stockAllocations.quantity).as("quantity"),
      })
      .from(stockAllocations)
      .innerJoin(
        manufacturingOrderIngredients,
        eq(stockAllocations.demandId, manufacturingOrderIngredients.id)
      )
      .innerJoin(
        manufacturingOrders,
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
          eq(stockAllocations.sourceType, "inventory_lot"),
          eq(stockAllocations.status, "active"),
          eq(stockAllocations.itemId, itemId),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .orderBy(asc(manufacturingOrders.orderNumber));
    const allocationsByLotId = new Map<
      string,
      Array<{
        type: "sales_order" | "manufacturing_order";
        label: string;
        contextLabel: string | null;
        href: string;
        quantity: string;
      }>
    >();
    for (const row of allocationRows) {
      if (!row.lotId) continue;
      const current = allocationsByLotId.get(row.lotId) ?? [];
      current.push({
        type: "sales_order",
        label: row.orderNumber,
        contextLabel: row.customerName,
        href: `/sales/order/${row.salesOrderId}`,
        quantity: row.quantity,
      });
      allocationsByLotId.set(row.lotId, current);
    }
    for (const row of manufacturingAllocationRows) {
      if (!row.lotId) continue;
      const current = allocationsByLotId.get(row.lotId) ?? [];
      current.push({
        type: "manufacturing_order",
        label: row.orderNumber,
        contextLabel: row.productName,
        href: `/manufacturing/order/${row.manufacturingOrderId}`,
        quantity: row.quantity,
      });
      allocationsByLotId.set(row.lotId, current);
    }

    const realizedRows = await tx
      .select({
        lotId: inventoryEvents.lotId,
        soldQuantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
          "soldQuantity"
        ),
        revenue: trimScale(sql`
          COALESCE(SUM(${inventoryEvents.quantity} * ${salesOrderLines.unitPrice}), 0)
        `).as("revenue"),
        cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
          "cogs"
        ),
      })
      .from(inventoryEvents)
      .innerJoin(
        salesOrderLines,
        sql`${salesOrderLines.id}::text = ${inventoryEvents.metadata}->>'salesOrderLineId'`
      )
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "sales_consumption"),
          isNotNull(inventoryEvents.lotId),
          sql`${inventoryEvents.metadata}->>'salesOrderLineId' IS NOT NULL`
        )
      )
      .groupBy(inventoryEvents.lotId);
    const realizedByLotId = new Map(
      realizedRows
        .filter((row): row is typeof row & { lotId: string } => row.lotId != null)
        .map((row) => {
          const margin = calculateMarginMetrics({
            revenue: row.revenue,
            cogs: row.cogs,
          });

          return [
            row.lotId,
            {
              soldQuantity: row.soldQuantity,
              realizedRevenue: margin?.revenue ?? null,
              realizedCogs: margin?.cogs ?? null,
              realizedGrossProfit: margin?.grossProfit ?? null,
              realizedMarginPercent: margin?.marginPercent ?? null,
            },
          ];
        })
    );

    const rows = await tx
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        balanceQuantity: trimScaleNullable(inventoryLotBalances.quantity).as(
          "balanceQuantity"
        ),
        disposition: inventoryLotBalances.disposition,
        costPerUnit: trimScaleNullable(sql`
          COALESCE(
            ${projectedLotUnitCost(lots.organizationId, lots.id)}::numeric,
            ${ledgerLotUnitCostByOrigin(lots.organizationId, lots.id)}::numeric
          )
        `).as("costPerUnit"),
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .innerJoin(
        inventoryLotBalances,
        and(
          eq(inventoryLotBalances.organizationId, lots.organizationId),
          eq(inventoryLotBalances.itemId, lots.itemId),
          eq(inventoryLotBalances.lotId, lots.id),
          options.includeNegativeBalances
            ? sql`${inventoryLotBalances.quantity} <> 0`
            : sql`${inventoryLotBalances.quantity} > 0`
        )
      )
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.receivedAt);

    const byLot = new Map<
      string,
      {
        id: string;
        lotNumber: string;
        quantity: string;
        costPerUnit: string | null;
        soldQuantity: string | null;
        realizedRevenue: string | null;
        realizedCogs: string | null;
        realizedGrossProfit: string | null;
        realizedMarginPercent: string | null;
        receivedAt: Date;
        allocations: Array<{
          type: "sales_order" | "manufacturing_order";
          label: string;
          contextLabel: string | null;
          href: string;
          quantity: string;
        }>;
        dispositionBalances: Array<{
          disposition: InventoryDisposition;
          quantity: string;
        }>;
      }
    >();

    for (const row of rows) {
      const current = byLot.get(row.id) ?? {
        ...(realizedByLotId.get(row.id) ?? {
          soldQuantity: null,
          realizedRevenue: null,
          realizedCogs: null,
          realizedGrossProfit: null,
          realizedMarginPercent: null,
        }),
        id: row.id,
        lotNumber: row.lotNumber,
        quantity: "0",
        costPerUnit: row.costPerUnit,
        receivedAt: row.receivedAt,
        allocations: allocationsByLotId.get(row.id) ?? [],
        dispositionBalances: [],
      };

      if (row.disposition && row.balanceQuantity != null) {
        current.dispositionBalances.push({
          disposition: row.disposition as InventoryDisposition,
          quantity: row.balanceQuantity,
        });
        current.quantity = normalizeNumeric(
          parseFloat(current.quantity) + parseFloat(row.balanceQuantity)
        );
      }

      byLot.set(row.id, current);
    }

    return [...byLot.values()];
  });
}

function dispositionForAction(
  action: QualityDispositionAction["action"]
): InventoryDisposition | null {
  if (action === "release") return "available";
  if (action === "block") return "blocked";
  if (action === "reject") return "rejected";
  return null;
}

export async function applyLotDispositionAction(
  itemId: string,
  lotId: string,
  action: QualityDispositionAction,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const quantity = Number(action.quantity);
    const toDisposition = dispositionForAction(action.action);

    if (toDisposition == null) {
      return scrapLotDispositionInTx(tx, {
        organizationId: orgId,
        itemId,
        lotId,
        fromDisposition: action.fromDisposition,
        quantity,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey ?? null,
        notes: action.notes,
      });
    }

    return changeLotDispositionInTx(tx, {
      organizationId: orgId,
      itemId,
      lotId,
      fromDisposition: action.fromDisposition,
      toDisposition,
      quantity,
      actorUserId: userId,
      idempotencyKey: options?.idempotencyKey ?? null,
      notes: action.notes,
    });
  });
}

export async function adjustLotQuantity(
  itemId: string,
  lotId: string,
  data: LotQuantityAdjustment,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [itemId]);

    const [lockedLot] = await tx
      .select({
        id: lots.id,
      })
      .from(lots)
      .where(and(eq(lots.itemId, itemId), eq(lots.id, lotId)))
      .for("update");

    if (!lockedLot) {
      throw new InventoryError("Lot not found");
    }

    const [lotBalance] = await tx
      .select({
        quantity: trimScale(
          sql`COALESCE(${inventoryLotBalances.quantity}, 0)`
        ).as("quantity"),
        unitCost: trimScaleNullable(inventoryLotBalances.unitCost).as("unitCost"),
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotId),
          eq(inventoryLotBalances.disposition, "available")
        )
      )

    const currentQuantity = Number(lotBalance?.quantity ?? "0");
    const nextQuantity = Number(data.quantity);
    const delta = nextQuantity - currentQuantity;

    if (delta === 0) {
      return { lotId, quantity: data.quantity };
    }

    const location = await getDefaultInventoryLocationInTx(tx, orgId);
    const metadata = data.note ? { note: data.note } : null;

    if (delta > 0) {
      const unitCost =
        lotBalance?.unitCost ??
        (await resolvePositiveStockUnitCostInTx(tx, {
          itemId,
          reason: "material_default_price",
        }));
      await appendPositiveStockToExistingLotInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        lotId,
        quantity: delta,
        unitCost,
        eventType: "manual_adjustment_increase",
        eventSubtype: "manual_adjustment",
        referenceType: "lot",
        referenceId: lotId,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey ?? null,
        metadata,
      });
    } else {
      await consumeSpecificLotInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        lotId,
        quantity: Math.abs(delta),
        eventType: "manual_adjustment_decrease",
        eventSubtype: "manual_adjustment",
        referenceType: "lot",
        referenceId: lotId,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey ?? null,
        metadata,
      });
    }

    return { lotId, quantity: data.quantity };
  });
}

export async function getStockMovements(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: inventoryEvents.id,
        quantity: trimScale(inventoryEvents.quantity).as("quantity"),
        movementType: sql<string>`CASE
          WHEN ${inventoryEvents.eventType} = 'purchase_receipt' THEN 'purchase_received'
          WHEN ${inventoryEvents.eventType} = 'manufacturing_output' THEN 'manufacturing_produced'
          WHEN ${inventoryEvents.eventType} = 'sales_consumption' THEN 'sales_shipped'
          WHEN ${inventoryEvents.eventType} = 'manufacturing_ingredient_consumption' THEN 'manufacturing_picked'
          WHEN ${inventoryEvents.eventType} IN ('manufacturing_variance_loss', 'manufacturing_variance_gain') THEN 'manufacturing_variance'
          WHEN ${inventoryEvents.eventType} IN ('stocktake_gain', 'stocktake_loss', 'stocktake_verification') THEN 'stocktake_adjustment'
          WHEN ${inventoryEvents.eventType} = 'quality_disposition_change' THEN 'quality_disposition'
          WHEN ${inventoryEvents.eventType} = 'quality_scrap' THEN 'quality_scrap'
          ELSE 'manual_adjustment'
        END`.as("movementType"),
        referenceType: sql<string | null>`CASE
          WHEN ${inventoryEvents.referenceType} = 'stocktake_line'
            THEN 'stocktake'
          ELSE ${inventoryEvents.referenceType}
        END`.as("referenceType"),
        referenceId: sql<string | null>`CASE
          WHEN ${inventoryEvents.referenceType} = 'stocktake_line'
            THEN COALESCE(${inventoryEvents.metadata}->>'stocktakeId', ${inventoryEvents.referenceId}::text)
          ELSE ${inventoryEvents.referenceId}::text
        END`.as("referenceId"),
        createdBy: inventoryEvents.actorUserId,
        createdAt: inventoryEvents.occurredAt,
        lotNumber: lots.lotNumber,
      })
      .from(inventoryEvents)
      .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          inArray(inventoryEvents.eventType, [
            "opening_balance",
            "purchase_receipt",
            "manufacturing_output",
            "manual_adjustment_increase",
            "stocktake_gain",
            "manufacturing_variance_gain",
            "manual_adjustment_decrease",
            "stocktake_loss",
            "sales_consumption",
            "manufacturing_ingredient_consumption",
            "manufacturing_variance_loss",
            "unpick_restock",
            "stocktake_verification",
            "quality_disposition_change",
            "quality_scrap",
          ])
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt));
  });
}

export async function getItemUsageHistory(
  itemId: string,
  options: { days?: number; bucket?: "week"; mode?: ItemHistoryMode } = {}
): Promise<ItemUsageHistory | null> {
  const days = options.days ?? 180;
  const bucket = options.bucket ?? "week";
  const mode = options.mode ?? "usage";
  const eventTypes = historyEventTypes(mode);

  return withAuthedOrgContext(async (tx) => {
    const [item] = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        unitName: unitDefinitions.name,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .limit(1);

    if (!item) return null;

    const today = startOfUtcDay(new Date());
    const currentWeekStart = startOfUtcWeek(today);
    const bucketCount = Math.ceil(days / 7);
    const firstBucketStart = addUtcDays(currentWeekStart, -(bucketCount - 1) * 7);
    const historyStart = addUtcDays(today, -(days - 1));
    const queryStart =
      firstBucketStart.getTime() < historyStart.getTime()
        ? firstBucketStart
        : historyStart;
    const last30Start = addUtcDays(today, -29);
    const last90Start = addUtcDays(today, -89);
    const last180Start = addUtcDays(today, -179);

    const events = await tx
      .select({
        eventType: inventoryEvents.eventType,
        quantity: trimScale(inventoryEvents.quantity).as("quantity"),
        occurredAt: inventoryEvents.occurredAt,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          inArray(inventoryEvents.eventType, eventTypes),
          gte(inventoryEvents.occurredAt, queryStart)
        )
      )
      .orderBy(asc(inventoryEvents.occurredAt));

    const bucketTotals = Array.from({ length: bucketCount }, () => 0);
    let last30Days = 0;
    let last90Days = 0;
    let last180Days = 0;

    for (const event of events) {
      const eventType = event.eventType as InventoryEventType;
      const quantity = Number.parseFloat(event.quantity);
      if (!Number.isFinite(quantity)) continue;

      const signedQuantity = historyEventSign(mode, eventType) * quantity;
      const occurredAt = event.occurredAt;

      if (occurredAt >= last30Start) last30Days += signedQuantity;
      if (occurredAt >= last90Start) last90Days += signedQuantity;
      if (occurredAt >= last180Start) last180Days += signedQuantity;

      if (occurredAt >= firstBucketStart) {
        const bucketIndex = Math.floor(
          (startOfUtcDay(occurredAt).getTime() - firstBucketStart.getTime()) /
            WEEK_MS
        );
        if (bucketIndex >= 0 && bucketIndex < bucketTotals.length) {
          bucketTotals[bucketIndex] += signedQuantity;
        }
      }
    }

    return {
      itemId: item.id,
      itemName: item.name,
      itemType: item.itemType as ItemType,
      mode,
      unitName: item.unitName,
      days,
      bucket,
      totals: {
        last30Days: normalizeUsageQuantity(last30Days),
        last90Days: normalizeUsageQuantity(last90Days),
        last180Days: normalizeUsageQuantity(last180Days),
        averageWeekly90Days: normalizeUsageQuantity((last90Days / 90) * 7),
      },
      buckets: bucketTotals.map((quantity, index) => {
        const periodStart = addUtcDays(firstBucketStart, index * 7);
        const periodEnd = addUtcDays(periodStart, 6);
        return {
          periodStart: isoDate(periodStart),
          periodEnd: isoDate(periodEnd > today ? today : periodEnd),
          quantity: normalizeUsageQuantity(quantity),
        };
      }),
    };
  });
}

// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom" | "revisionNote">,
  stock?: number,
  bom?: BomInputRow[],
  operationCosts?: BomOperationCostInputRow[],
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateItem",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, itemData, stock, bom, operationCosts, revisionNote },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
        unitDefinitionId: items.unitDefinitionId,
        purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
        bomLocked: items.bomLocked,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const delta =
      stock != null ? stock - (await getCurrentOnHandQtyInTx(tx, id)) : null;
    const currentBom = bom !== undefined ? await getCurrentBomComponentsInTx(tx, id) : [];
    const currentOperationCosts =
      operationCosts !== undefined ? await getCurrentBomOperationCostsInTx(tx, id) : [];
    const normalizedCurrentStockUnitCost =
      existingItem.itemType === "material"
        ? normalizeCurrentStockUnitCost(itemData.currentStockUnitCost)
        : undefined;
    const normalizedItemData = {
      ...itemData,
      currentStockUnitCost: normalizedCurrentStockUnitCost,
    };

    const [item] = await tx
      .update(items)
      .set({ ...normalizedItemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (existingItem.familyId) {
      const activeFamilyRows = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.familyId, existingItem.familyId), isNull(items.deletedAt)))
        .for("update");

      if (activeFamilyRows.length <= 1) {
        await tx
          .update(itemFamilies)
          .set({
            name: normalizedItemData.name,
            category: normalizedItemData.category,
            description: normalizedItemData.description,
            unitDefinitionId: existingItem.unitDefinitionId ?? undefined,
            purchaseUnitDefinitionId: normalizedItemData.purchaseUnitDefinitionId,
            purchaseToStockFactor: normalizedItemData.purchaseToStockFactor,
            updatedAt: new Date(),
          })
          .where(eq(itemFamilies.id, existingItem.familyId));
      }
    }

    if (bom !== undefined || operationCosts !== undefined) {
      const [currentRevisionMeta] = await tx
        .select({
          outputQuantity: bomRevisions.outputQuantity,
          recipeBasis: bomRevisions.recipeBasis,
        })
        .from(bomRevisions)
        .where(and(eq(bomRevisions.productId, id), eq(bomRevisions.isCurrent, true)))
        .limit(1);
      const nextBom = bom ?? currentBom.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.alternateItemId,
        })),
      }));
      const nextOperationCosts = operationCosts ?? currentOperationCosts.map((row) => ({
        operationName: row.operationName,
        resourceId: row.resourceId,
        costScalingMode: row.costScalingMode as BomOperationCostInputRow["costScalingMode"],
        crewSize: row.crewSize,
        plannedMinutes: row.plannedMinutes,
        loadedCostPerHour: row.loadedCostPerHour,
      }));
      if (
        (bom !== undefined && hasBomChanged(
          currentBom.map((row) => ({
            componentId: row.componentId,
            quantity: row.quantity,
            minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
            alternates: row.alternates.map((alternate) => ({
              itemId: alternate.alternateItemId,
            })),
          })),
          nextBom
        )) ||
        (operationCosts !== undefined &&
          hasBomOperationCostsChanged(
            currentOperationCosts.map((row) => ({
              operationName: row.operationName,
              resourceId: row.resourceId,
              costScalingMode:
                row.costScalingMode as BomOperationCostInputRow["costScalingMode"],
              crewSize: row.crewSize,
              plannedMinutes: row.plannedMinutes,
              loadedCostPerHour: row.loadedCostPerHour,
            })),
            nextOperationCosts
          ))
      ) {
        await createBomRevisionInTx(tx, {
          orgId,
          userId,
          productId: id,
          note: revisionNote,
          outputQuantity: currentRevisionMeta?.outputQuantity ?? "1",
          recipeBasis: currentRevisionMeta?.recipeBasis === "batch" ? "batch" : "unit",
          bom: nextBom,
          operationCosts: nextOperationCosts,
        });

        await recordCostBasisChangeInTx(tx, {
          organizationId: orgId,
          itemId: id,
          actorUserId: userId,
          eventSubtype: "bom_edited",
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "bom-edited"
          ),
          metadata: {
            revisionNote: revisionNote ?? null,
            componentCount: nextBom.length,
            operationCostCount: nextOperationCosts.length,
          },
        });
      }
    }

    if (delta != null && delta !== 0) {
      if (delta > 0) {
        await manualIncreaseStockInTx(tx, {
          organizationId: orgId,
          itemId: id,
          quantity: delta,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "stock-increase"
          ),
        });
      } else {
        await manualDecreaseStockInTx(tx, {
          organizationId: orgId,
          itemId: id,
          quantity: Math.abs(delta),
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "stock-decrease"
          ),
        });
      }
    }

    if (
      (itemData.purchaseUnitDefinitionId !== undefined &&
        itemData.purchaseUnitDefinitionId !== existingItem.purchaseUnitDefinitionId) ||
      (itemData.purchaseToStockFactor !== undefined &&
        itemData.purchaseToStockFactor !== existingItem.purchaseToStockFactor)
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "purchase_unit_config",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "purchase-unit-config"
        ),
        metadata: {
          before: {
            purchaseUnitDefinitionId: existingItem.purchaseUnitDefinitionId,
            purchaseToStockFactor: existingItem.purchaseToStockFactor,
          },
          after: {
            purchaseUnitDefinitionId:
              itemData.purchaseUnitDefinitionId ?? existingItem.purchaseUnitDefinitionId,
            purchaseToStockFactor:
              itemData.purchaseToStockFactor ?? existingItem.purchaseToStockFactor,
          },
        },
      });
    }

    if (
      normalizedItemData.defaultPurchasePrice !== undefined &&
      normalizedItemData.defaultPurchasePrice !== existingItem.defaultPurchasePrice
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "default_purchase_price",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "default-purchase-price"
        ),
        metadata: {
          before: existingItem.defaultPurchasePrice,
          after: normalizedItemData.defaultPurchasePrice,
        },
      });
    }

    if (
      normalizedCurrentStockUnitCost !== undefined &&
      normalizedCurrentStockUnitCost !== existingItem.currentStockUnitCost
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "current_stock_unit_cost_override",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "current-stock-unit-cost-override"
        ),
        metadata: {
          before: existingItem.currentStockUnitCost,
          after: normalizedCurrentStockUnitCost,
        },
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: item,
    });

    return item;
  });
}

export async function createItemWithLot(
  data: Omit<InsertItem, "stock" | "outputQuantity" | "bom" | "revisionNote">,
  stock: string,
  outputQuantity?: string | null,
  bom?: BomInputRow[],
  operationCosts?: BomOperationCostInputRow[],
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createItemWithLot",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { data, stock, outputQuantity, bom, operationCosts, revisionNote },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const normalizedCurrentStockUnitCost =
      data.itemType === "material"
        ? normalizeCurrentStockUnitCost(data.currentStockUnitCost)
        : null;
    const initialCurrentStockUnitCost =
      data.itemType === "material"
        ? normalizedCurrentStockUnitCost ??
          (parseFloat(stock) > 0
            ? resolveStockUnitCostFromDefaultPurchasePrice({
                defaultPurchasePrice: data.defaultPurchasePrice,
                purchaseToStockFactor: data.purchaseToStockFactor,
              })
            : null)
        : null;

    const [family] = await tx
      .insert(itemFamilies)
      .values({
        organizationId: orgId,
        itemType: data.itemType,
        name: data.name,
        category: data.category ?? null,
        description: data.description ?? null,
        unitDefinitionId: data.unitDefinitionId,
        purchaseUnitDefinitionId:
          data.itemType === "material" ? data.purchaseUnitDefinitionId ?? null : null,
        purchaseToStockFactor:
          data.itemType === "material" ? data.purchaseToStockFactor ?? null : null,
      })
      .returning({ id: itemFamilies.id });

    const [item] = await tx
      .insert(items)
      .values({
        ...data,
        familyId: family.id,
        optionCombinationKey: "",
        currentStockUnitCost: initialCurrentStockUnitCost,
        organizationId: orgId,
      })
      .returning({ id: items.id });

    if ((bom && bom.length > 0) || (operationCosts && operationCosts.length > 0)) {
      const recipeBasis = data.manufacturingMode === "batch" ? "batch" : "unit";
      const recipeOutputQuantity =
        recipeBasis === "batch"
          ? data.expectedBatchYield ?? data.typicalBatchSize ?? outputQuantity ?? "1"
          : "1";

      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: item.id,
        note: revisionNote,
        outputQuantity: recipeOutputQuantity,
        recipeBasis,
        bom: bom ?? [],
        operationCosts: operationCosts ?? [],
      });
    }

    if (parseFloat(stock) > 0) {
      await manualIncreaseStockInTx(tx, {
        organizationId: orgId,
        itemId: item.id,
        quantity: parseFloat(stock),
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "opening-stock"
        ),
      });
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: item,
    });

    return item;
  });
}

export async function overrideMaterialCurrentStockUnitCost(
  id: string,
  currentStockUnitCost: string,
  options?: { idempotencyKey?: string },
): Promise<{ id: string; currentStockUnitCost: string | null } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      { id: string; currentStockUnitCost: string | null } | null
    >(tx, {
      organizationId: orgId,
      operationName: "overrideMaterialCurrentStockUnitCost",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, currentStockUnitCost },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const normalizedCurrentStockUnitCost = normalizeCurrentStockUnitCost(
      currentStockUnitCost
    );

    if (normalizedCurrentStockUnitCost == null) {
      throw new InventoryError("Current stock unit cost is required.");
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (existingItem.itemType !== "material") {
      throw new InventoryError("Only materials have a current stock unit cost.");
    }

    const [item] = await tx
      .update(items)
      .set({
        currentStockUnitCost: normalizedCurrentStockUnitCost,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), isNull(items.deletedAt), eq(items.itemType, "material")))
      .returning({
        id: items.id,
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      });

    if (
      item &&
      item.currentStockUnitCost !== existingItem.currentStockUnitCost
    ) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: "current_stock_unit_cost_override",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "current-stock-unit-cost-override"
        ),
        metadata: {
          before: existingItem.currentStockUnitCost,
          after: item.currentStockUnitCost,
        },
      });
    }

    const result = item ?? null;

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function setBomLock(
  id: string,
  locked: boolean,
  options?: { idempotencyKey?: string }
): Promise<{ id: string; bomLocked: boolean } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      { id: string; bomLocked: boolean } | null
    >(tx, {
      organizationId: orgId,
      operationName: "setBomLock",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, locked },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        bomLocked: items.bomLocked,
      })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("update");

    if (!existingItem || existingItem.itemType !== "product") {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const [item] = await tx
      .update(items)
      .set({
        bomLocked: locked,
        bomLockedAt: locked ? new Date() : null,
        bomLockedByUserId: locked ? userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({
        id: items.id,
        bomLocked: items.bomLocked,
      });

    if (item && item.bomLocked !== existingItem.bomLocked) {
      await recordCostBasisChangeInTx(tx, {
        organizationId: orgId,
        itemId: id,
        actorUserId: userId,
        eventSubtype: locked ? "bom_locked" : "bom_unlocked",
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          locked ? "bom-lock" : "bom-unlock"
        ),
        metadata: {
          before: existingItem.bomLocked,
          after: item.bomLocked,
        },
      });
    }

    const result = item ?? null;

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function createUnitDefinition(
  data: InsertUnitDefinition
): Promise<{ id: string; name: string; size: string; uom: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [row] = await tx
      .insert(unitDefinitions)
      .values({ ...data, organizationId: orgId })
      .returning({
        id: unitDefinitions.id,
        name: unitDefinitions.name,
        size: trimScale(unitDefinitions.size).as("size"),
        uom: unitDefinitions.uom,
      });
    return row;
  });
}

export async function getBomComponents(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await getCurrentBomComponentsInTx(tx, itemId);

    return rows.map((row) => ({
      id: row.id,
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
      constraints: row.constraints,
      componentName: row.componentName,
      componentItemType: row.componentItemType,
      componentUnit: row.unitName,
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
        itemName: alternate.alternateItemName,
        itemSku: alternate.alternateItemSku,
        itemType: alternate.alternateItemType,
        unitName: alternate.unitName,
        quantityFactor: alternate.quantityFactor,
      })),
    }));
  });
}

export async function getBomOperationCosts(itemId: string) {
  return withAuthedOrgContext(async (tx) =>
    getCurrentBomOperationCostsInTx(tx, itemId)
  );
}

export async function copyCurrentBomToVariants(
  sourceItemId: string,
  targetVariantIds?: string[],
  note?: string | null,
  options?: { idempotencyKey?: string | null }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ copied: Array<{ id: string; revisionId: string }> }>(tx, {
      organizationId: orgId,
      operationName: "copyItemCardBom",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId, targetVariantIds: targetVariantIds ?? null, note: note ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [source] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
      })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId || source.itemType !== "product") {
      throw new InventoryError("Source product variant not found", 404);
    }

    const targets = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
      })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      );

    const targetIds = targets
      .filter((target) => target.id !== sourceItemId && target.itemType === "product")
      .map((target) => target.id);

    if (targetVariantIds && targetIds.length !== new Set(targetVariantIds).size) {
      throw new InventoryError("One or more target variants were not found on this card", 400);
    }

    const sourceBom = await getCurrentBomComponentsInTx(tx, sourceItemId);
    const sourceRevision = await getCurrentBomRevisionInTx(tx, sourceItemId);
    const sourceOperationCosts = await getCurrentBomOperationCostsInTx(tx, sourceItemId);
    const bom: BomInputRow[] = sourceBom.map((row) => ({
      componentId: row.componentId,
      quantity: row.quantity,
      minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
      alternates: row.alternates.map((alternate) => ({
        itemId: alternate.alternateItemId,
      })),
    }));
    const operationCosts: BomOperationCostInputRow[] = sourceOperationCosts.map((row) => ({
      operationName: row.operationName,
      resourceId: row.resourceId,
      costScalingMode: row.costScalingMode as BomOperationCostInputRow["costScalingMode"],
      crewSize: row.crewSize,
      plannedMinutes: row.plannedMinutes,
      loadedCostPerHour: row.loadedCostPerHour,
    }));

    const copied: Array<{ id: string; revisionId: string }> = [];
    for (const productId of targetIds) {
      const revision = await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId,
        note: note ?? `Copied from ${sourceItemId}`,
        outputQuantity: sourceRevision?.outputQuantity ?? null,
        recipeBasis: sourceRevision?.recipeBasis === "batch" ? "batch" : "unit",
        bom,
        operationCosts,
      });
      copied.push({ id: productId, revisionId: revision.id });
    }

    const result = { copied };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function copyCurrentOperationsToVariants(
  sourceItemId: string,
  targetVariantIds?: string[],
  note?: string | null,
  options?: { idempotencyKey?: string | null }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ copied: Array<{ id: string; revisionId: string }> }>(tx, {
      organizationId: orgId,
      operationName: "copyItemCardOperations",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { sourceItemId, targetVariantIds: targetVariantIds ?? null, note: note ?? null },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [source] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        itemType: items.itemType,
      })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId || source.itemType !== "product") {
      throw new InventoryError("Source product variant not found", 404);
    }

    const targets = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
      })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      );

    const targetIds = targets
      .filter((target) => target.id !== sourceItemId && target.itemType === "product")
      .map((target) => target.id);

    if (targetVariantIds && targetIds.length !== new Set(targetVariantIds).size) {
      throw new InventoryError("One or more target variants were not found on this card", 400);
    }

    const sourceOperationCosts = await getCurrentBomOperationCostsInTx(tx, sourceItemId);
    const operationCosts: BomOperationCostInputRow[] = sourceOperationCosts.map((row) => ({
      operationName: row.operationName,
      resourceId: row.resourceId,
      costScalingMode: row.costScalingMode as BomOperationCostInputRow["costScalingMode"],
      crewSize: row.crewSize,
      plannedMinutes: row.plannedMinutes,
      loadedCostPerHour: row.loadedCostPerHour,
    }));

    const copied: Array<{ id: string; revisionId: string }> = [];
    for (const productId of targetIds) {
      const targetBom = await getCurrentBomComponentsInTx(tx, productId);
      const targetRevision = await getCurrentBomRevisionInTx(tx, productId);
      const bom: BomInputRow[] = targetBom.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.alternateItemId,
        })),
      }));

      const revision = await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId,
        note: note ?? `Copied operations from ${sourceItemId}`,
        outputQuantity: targetRevision?.outputQuantity ?? null,
        recipeBasis: targetRevision?.recipeBasis === "batch" ? "batch" : "unit",
        bom,
        operationCosts,
      });
      copied.push({ id: productId, revisionId: revision.id });
    }

    const result = { copied };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function hasLockedBomCopyTarget(
  sourceItemId: string,
  targetVariantIds?: string[]
) {
  return withAuthedOrgContext(async (tx) => {
    const [source] = await tx
      .select({ familyId: items.familyId })
      .from(items)
      .where(and(eq(items.id, sourceItemId), isNull(items.deletedAt)));

    if (!source?.familyId) {
      throw new InventoryError("Source product variant not found", 404);
    }

    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.familyId, source.familyId),
          eq(items.itemType, "product"),
          eq(items.bomLocked, true),
          isNull(items.deletedAt),
          targetVariantIds && targetVariantIds.length > 0
            ? inArray(items.id, [...new Set(targetVariantIds)])
            : sql`${items.id} <> ${sourceItemId}`
        )
      )
      .limit(1);

    return rows.length > 0;
  });
}

export async function getBomRevisionHistory(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);
    const componentsByRevisionId = await getBomRevisionComponentsByRevisionIdInTx(
      tx,
      revisions.map((revision) => revision.id)
    );

    return revisions.map((revision) => ({
      ...revision,
      components: componentsByRevisionId.get(revision.id) ?? [],
    }));
  });
}

export async function getBomRevision(itemId: string, revisionId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);
    const revision = revisions.find((entry) => entry.id === revisionId);

    if (!revision) {
      return null;
    }

    return {
      ...revision,
      components: await getBomRevisionComponentsInTx(tx, revision.id),
    };
  });
}

export async function getUsedInParents(itemId: string) {
  const context = await getAuthedMemberContext();
  const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

  return withAuthedOrgContext(async (tx) => {
    if (!hasBomViewAccess(bomViewPermissions)) {
      return [];
    }

    const bomParentVisibilityCondition = getBomParentVisibilityCondition(
      items.bomLocked,
      bomViewPermissions,
    );
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
      })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(
        and(
          eq(bomRevisionComponents.componentId, itemId),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt),
          bomParentVisibilityCondition,
        ),
      )
      .orderBy(asc(items.name));

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(
      tx,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const optionValues = optionValuesByItemId.get(row.id) ?? [];
      const displayName = formatNormalizedVariantDisplay(
        row.familyName,
        row.name,
        optionValues,
      );

      return {
        id: row.id,
        name: row.name,
        displayName,
      };
    });
  });
}

export async function getAvailableComponents(excludeItemId?: string) {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [isNull(items.deletedAt), isNotNull(items.familyId)];
    if (excludeItemId) {
      conditions.push(sql`${items.id} != ${excludeItemId}`);
    }
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
        itemType: items.itemType,
        unit: unitDefinitions.name,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(
      tx,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const optionValues = optionValuesByItemId.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        displayName: formatNormalizedVariantDisplay(
          row.familyName,
          row.name,
          optionValues,
        ),
        itemType: row.itemType,
        unit: row.unit,
      };
    });
  });
}
