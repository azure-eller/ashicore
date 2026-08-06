import "server-only";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  itemFamilies,
  items,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  trimScale,
  trimScaleNullable,
} from "@/lib/db/numeric";
import {
  getAuthedMemberContext,
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import type {
  Tx,
} from "@/lib/db/with-org-context";
import {
  getEstimatedRecipeCostSummariesByItemIdInTx,
} from "@/lib/inventory/estimated-cost";
import {
  measureObservedOperation,
} from "@/lib/observability/request-log";
import type {
  ItemRow,
  ItemType,
} from "../types";
import {
  applyMarginTiers,
  calculateMarginPercent,
} from "./metrics";
import { sellingUnitPriceToStockUnitPrice } from "@/lib/sales/quantity-basis";
import {
  projectedAvailableQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedOnHandQty,
} from "@/lib/inventory/kernel";
import { stockSubquery, lastCountedAtSubquery, demandQtySubquery, availableQtySubquery, expectedQtySubquery, potentialSubquery, getVariantOptionValuesByItemIdInTx, formatNormalizedVariantDisplay, buildDuplicateCombinationWarnings, type BomViewPermissions, getBomViewPermissions, hasBomViewAccess, getBomParentVisibilityCondition } from "./shared";
import { getDispositionBalancesByItemIdInTx } from "./item-disposition-balances";

function buildItemSearchText({
  displayName,
  name,
  familyName,
  sku,
  category,
  unit,
  optionValues,
}: {
  displayName: string;
  name: string;
  familyName: string | null;
  sku: string | null;
  category: string | null;
  unit: string | null;
  optionValues: Array<{
    optionName: string;
    optionCode: string;
    valueLabel: string;
    valueCode: string;
  }>;
}) {
  return [
    displayName,
    name,
    familyName,
    sku,
    category,
    unit,
    ...optionValues.flatMap((value) => [
      value.optionName,
      value.optionCode,
      value.valueLabel,
      value.valueCode,
    ]),
  ]
    .filter((part): part is string => part != null && part.trim() !== "")
    .join(" ");
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
      revenue30d: trimScaleNullable(sql`SUM(${salesOrderLines.lineSubtotal})`).as("revenue30d"),
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

export async function getItems(filters?: {
  itemType?: ItemType;
  // Scope projected quantities to one location; omitted = the default
  // location (the historical behavior every existing client gets).
  locationId?: string | null;
}): Promise<ItemRow[]> {
  return measureObservedOperation(
    "inventory.get_items",
    async () => {
      const context = await getAuthedMemberContext();
      const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

      return withAuthedOrgContext<ItemRow[]>(async (tx) => {
        const locationId = filters?.locationId ?? null;
        const stockCol = locationId
          ? projectedOnHandQty(items.organizationId, items.id, locationId).as("stock")
          : stockSubquery;
        const demandCol = locationId
          ? projectedDemandQty(items.organizationId, items.id, locationId).as("demandQty")
          : demandQtySubquery;
        const availableCol = locationId
          ? projectedAvailableQty(items.organizationId, items.id, locationId).as(
              "availableQty"
            )
          : availableQtySubquery;
        const expectedCol = locationId
          ? projectedExpectedQty(items.organizationId, items.id, locationId).as(
              "expectedQty"
            )
          : expectedQtySubquery;
        // Potential derives from planning-pinned ingredient availability, so
        // there is no truthful per-location figure; blank it under a filter.
        const potentialCol = locationId
          ? sql<string | null>`NULL`.as("potential")
          : potentialSubquery;
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
                lotTrackingMode: itemFamilies.lotTrackingMode,
                optionCombinationKey: items.optionCombinationKey,
                stock: stockCol,
                lastCountedAt: lastCountedAtSubquery,
                demandQty: demandCol,
                availableQty: availableCol,
                expectedQty: expectedCol,
                safetyStock: trimScale(items.safetyStock).as("safetyStock"),
                defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
                salesToStockFactor: trimScaleNullable(items.salesToStockFactor).as(
                  "salesToStockFactor"
                ),
                currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
                  "currentStockUnitCost"
                ),
                unit: unitDefinitions.name,
                unitSize: unitDefinitions.size,
                unitUom: unitDefinitions.uom,
                category: items.category,
                familyCategory: itemFamilies.category,
                potential: potentialCol,
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
        const [
          hasBomSet,
          usedInCounts,
          revenueByItemId,
          estimatedCostSummariesByItemId,
          dispositionBalancesByItemId,
        ] = await Promise.all([
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
          measureObservedOperation(
            "inventory.get_items.disposition_balances",
            () => getDispositionBalancesByItemIdInTx(tx, leafIds, locationId),
            {
              extra: { rowCount: leafIds.length },
              successData: (balances) => ({ resultCount: balances.size }),
            },
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
                  searchText: buildItemSearchText({
                    displayName,
                    name: row.name,
                    familyName: row.familyName,
                    sku: row.sku,
                    category: row.familyCategory ?? row.category,
                    unit: row.unit ?? null,
                    optionValues,
                  }),
                  sku: row.sku,
                  itemType: row.itemType as ItemType,
                  lotTrackingMode:
                    row.lotTrackingMode === "untracked" ? "untracked" : "tracked",
                  dispositionBalances: dispositionBalancesByItemId.get(row.id) ?? [],
                  stock: row.stock,
                  demandQty: row.demandQty,
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
                    row.defaultSellingPrice == null
                      ? null
                      : sellingUnitPriceToStockUnitPrice(
                          row.defaultSellingPrice,
                          row.salesToStockFactor ?? "1"
                        ),
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
                  lastCountedAt: row.lastCountedAt ?? null,
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
