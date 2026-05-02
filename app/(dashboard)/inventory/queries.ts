import "server-only";

// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  bomRevisionComponentAlternates,
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  type InventoryEventType,
  type InventoryDisposition,
  inventoryEvents,
  inventoryLotBalances,
  inventoryReservationsSummary,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeItems,
  stocktakes,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { formatVariantDisplay, normalizeNumeric, normalizeNumericScale } from "@/lib/format";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import {
  getBomRevisionComponentsInTx,
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
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getCurrentOnHandQtyInTx,
  ledgerLotUnitCostByOrigin,
  lockItemsInTx,
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  defaultLocationIdSubquery,
  projectedAvailableQty,
  projectedAvailableQtyExpr,
  projectedCommittedQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedLotUnitCost,
  projectedOnHandQty,
  projectedReservableOnHandQty,
  projectedShortageQty,
  recordCostBasisChangeInTx,
  scrapLotDispositionInTx,
} from "@/lib/inventory/kernel";
import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import { getEstimatedUnitCostsByItemIdInTx } from "@/lib/inventory/estimated-cost";
import { calculateMarginMetrics } from "@/lib/margin";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import type { InsertItem, InsertMasterItem, InsertVariant, UpdateItem } from "@/lib/schemas/items";
import type { QualityDispositionAction } from "@/lib/schemas/inventory-disposition";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import { DomainError } from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  InventoryProductView,
  InventoryTabCounts,
  ItemRow,
  ItemType,
} from "./types";
import {
  buildItemCommitmentSummary,
  type ItemCommitmentSummary,
} from "./commitment-summary";

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
// Potential: how many finished units could be produced from current available ingredient stock.
// For discrete products: floor(min(component_available / bom_qty))
// For batch products: floor(min(component_available / bom_qty)) * expected_batch_yield
// Available = reservable lot stock - hard reservations.
const potentialSubquery = sql<string | null>`(
  CASE WHEN ${items.itemType} = 'product' AND EXISTS (
    SELECT 1
    FROM inventory.bom_revisions br
    INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
    WHERE br.product_id = ${items.id}
      AND br.is_current = true
  ) THEN
    GREATEST(
      0,
      FLOOR(
      (
        SELECT MIN(
          (
            ${projectedAvailableQtyExpr(items.organizationId, sql`brc.component_id`)}
          )
          / NULLIF(brc.quantity, 0)
        )
        FROM inventory.bom_revisions br
        INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
        WHERE br.product_id = ${items.id}
          AND br.is_current = true
      )
      * CASE WHEN ${items.manufacturingMode} = 'batch' AND ${items.expectedBatchYield} IS NOT NULL
          THEN ${items.expectedBatchYield}
          ELSE 1
        END
      )
    )
  ELSE NULL END
)`.as("potential");

type BomInputRow = {
  componentId: string;
  quantity: string;
  minimumLotAgeDays?: number | null;
  alternates?: Array<{ itemId: string }>;
};
type BomViewPermissions = {
  canViewUnlockedBom: boolean;
  canViewLockedBom: boolean;
};

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: row.quantity,
    minimumLotAgeDays: row.minimumLotAgeDays ?? null,
    alternates: (row.alternates ?? []).map((alternate) => alternate.itemId).sort(),
    sortOrder: index,
  }));
}

function hasBomChanged(currentBom: BomInputRow[], nextBom: BomInputRow[]) {
  const normalizedCurrent = normalizeBomRows(currentBom);
  const normalizedNext = normalizeBomRows(nextBom);

  if (normalizedCurrent.length !== normalizedNext.length) {
    return true;
  }

  return normalizedCurrent.some((row, index) => {
    const nextRow = normalizedNext[index];
    return (
      row.componentId !== nextRow.componentId ||
      row.quantity !== nextRow.quantity ||
      row.minimumLotAgeDays !== nextRow.minimumLotAgeDays ||
      row.alternates.join(",") !== nextRow.alternates.join(",") ||
      row.sortOrder !== nextRow.sortOrder
    );
  });
}

function parseNumeric(value: string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatAggregateNumber(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function calculateMarginPercent(
  defaultSellingPrice: string | null | undefined,
  estimatedUnitCost: string | null | undefined,
) {
  if (defaultSellingPrice == null || estimatedUnitCost == null) {
    return null;
  }

  const sellingPrice = Number.parseFloat(defaultSellingPrice);
  const cost = Number.parseFloat(estimatedUnitCost);

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0 || !Number.isFinite(cost)) {
    return null;
  }

  return normalizeNumericScale(((sellingPrice - cost) / sellingPrice) * 100, 1);
}

function formatAverageMargin(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return normalizeNumericScale(average, 1);
}

function applyMarginTiers(rows: ItemRow[]) {
  const allRows = rows.flatMap((row) => [row, ...(row.subRows ?? [])]);
  const marginValues = allRows
    .filter((row) => !row.isMaster)
    .map((row) => row.marginPercent)
    .filter((value): value is string => value != null)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  const nonNegativeMargins = marginValues
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  const hasRelativeBands = nonNegativeMargins.length >= 3;
  const lowCutoff = hasRelativeBands
    ? nonNegativeMargins[Math.floor((nonNegativeMargins.length - 1) / 3)]
    : 20;
  const highCutoff = hasRelativeBands
    ? nonNegativeMargins[Math.ceil(((nonNegativeMargins.length - 1) * 2) / 3)]
    : 40;

  return rows.map((row) => applyMarginTier(row, lowCutoff, highCutoff));
}

function applyMarginTier(
  row: ItemRow,
  lowCutoff: number,
  highCutoff: number,
): ItemRow {
  const margin = row.marginPercent != null ? Number.parseFloat(row.marginPercent) : Number.NaN;
  const marginTier = !Number.isFinite(margin)
    ? null
    : margin < 0
      ? "negative"
      : margin <= lowCutoff
        ? "low"
        : margin >= highCutoff
          ? "high"
          : "mid";

  return {
    ...row,
    marginTier,
    subRows: row.subRows?.map((subRow) => applyMarginTier(subRow, lowCutoff, highCutoff)),
  };
}

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

function formatPriceRange(values: Array<string | null | undefined>) {
  const prices = values
    .map((value) => (value != null ? Number.parseFloat(value) : Number.NaN))
    .filter((value) => !Number.isNaN(value));

  if (prices.length === 0) {
    return null;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return min === max ? `$${min}` : `$${min} \u2013 $${max}`;
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
        eq(salesOrders.status, "shipped"),
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

async function createBomRevisionInTx(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    productId: string;
    note?: string | null;
    bom: BomInputRow[];
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

  return revision;
}

export async function getItems(filters?: {
  itemType?: ItemType;
  view?: InventoryProductView;
}): Promise<ItemRow[]> {
  return measureObservedOperation(
    "inventory.get_items",
    async () => {
      const context = await getAuthedMemberContext();
      const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

      return withAuthedOrgContext<ItemRow[]>(async (tx) => {
        if (filters?.itemType !== "product") {
          const materialRows = await tx
            .select({
              id: items.id,
              name: items.name,
              sku: items.sku,
              itemType: items.itemType,
              stock: stockSubquery,
              committedQty: committedQtySubquery,
              demandQty: demandQtySubquery,
              shortageQty: shortageQtySubquery,
              availableQty: availableQtySubquery,
              expectedQty: expectedQtySubquery,
              safetyStock: trimScale(items.safetyStock).as("safetyStock"),
              currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
                "currentStockUnitCost"
              ),
              unit: unitDefinitions.name,
              unitSize: unitDefinitions.size,
              unitUom: unitDefinitions.uom,
              category: items.category,
              potential: potentialSubquery,
              createdAt: items.createdAt,
            })
            .from(items)
            .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
            .where(
              and(
                isNull(items.deletedAt),
                isNull(items.parentId),
                ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
              ),
            );

          const results: ItemRow[] = materialRows.map((row) => ({
            id: row.id,
            name: row.name,
            displayName: row.name,
            sku: row.sku,
            itemType: row.itemType as ItemType,
            stock: row.stock,
            committedQty: row.committedQty,
            demandQty: row.demandQty,
            shortageQty: row.shortageQty,
            availableQty: row.availableQty,
            expectedQty: row.expectedQty,
            safetyStock: row.safetyStock,
            currentStockUnitCost: row.currentStockUnitCost,
            unit: row.unit ?? null,
            unitSize: row.unitSize ?? null,
            unitUom: row.unitUom ?? null,
            category: row.category,
            potential: row.potential,
            estimatedUnitCost: null,
            marginPercent: null,
            marginTier: null,
            isMaster: false,
            parentId: null,
            variantCount: 0,
            variantAxes: null,
            variantAttrs: null,
            priceRange: null,
            sellable: null,
            hasBom: false,
            usedInBom: false,
            usedInCount: 0,
            revenue30d: null,
            createdAt: row.createdAt,
          }));

          return results;
        }

        if (filters?.view === "sub-assemblies") {
          const leafRows = await tx
            .select({
              id: items.id,
              name: items.name,
              sku: items.sku,
              itemType: items.itemType,
              stock: stockSubquery,
              committedQty: committedQtySubquery,
              demandQty: demandQtySubquery,
              shortageQty: shortageQtySubquery,
              availableQty: availableQtySubquery,
              expectedQty: expectedQtySubquery,
              safetyStock: trimScale(items.safetyStock).as("safetyStock"),
              unit: unitDefinitions.name,
              unitSize: unitDefinitions.size,
              unitUom: unitDefinitions.uom,
              category: items.category,
              isMaster: items.isMaster,
              parentId: items.parentId,
              variantAttrs: items.variantAttrs,
              sellable: items.sellable,
              createdAt: items.createdAt,
            })
            .from(items)
            .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
            .where(
              and(
                isNull(items.deletedAt),
                eq(items.itemType, "product"),
                eq(items.isMaster, false),
              ),
            );

          const parentIds = [...new Set(
            leafRows
              .map((row) => row.parentId)
              .filter((id): id is string => id != null),
          )];
          const [hasBomSet, usedInCounts, parents] = await Promise.all([
            getCurrentBomProductIdSetInTx(
              tx,
              leafRows.map((row) => row.id),
            ),
            getUsedInCountsInTx(
              tx,
              leafRows.map((row) => row.id),
              bomViewPermissions,
            ),
            parentIds.length > 0
              ? tx
                  .select({
                    id: items.id,
                    name: items.name,
                    variantAxes: items.variantAxes,
                  })
                  .from(items)
                  .where(and(inArray(items.id, parentIds), isNull(items.deletedAt)))
              : Promise.resolve([]),
          ]);

          const parentsById = new Map(
            parents.map((parent) => [
              parent.id,
              {
                name: parent.name,
                variantAxes: (parent.variantAxes as string[] | null) ?? null,
              },
            ]),
          );

          const results: ItemRow[] = leafRows
            .filter((row) => row.sellable === false || (usedInCounts.get(row.id) ?? 0) > 0)
            .map((row) => {
              const parent = row.parentId ? parentsById.get(row.parentId) : null;
              const displayName =
                parent && parent.variantAxes && row.variantAttrs
                  ? formatVariantDisplay(
                      parent.name,
                      (row.variantAttrs as Record<string, string>) ?? {},
                      parent.variantAxes,
                    )
                  : row.name;
              const usedInCount = usedInCounts.get(row.id) ?? 0;

              return {
                id: row.id,
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
                currentStockUnitCost: null,
                unit: row.unit ?? null,
                unitSize: row.unitSize ?? null,
                unitUom: row.unitUom ?? null,
                category: row.category,
                potential: null,
                estimatedUnitCost: null,
                marginPercent: null,
                marginTier: null,
                isMaster: false,
                parentId: row.parentId,
                variantCount: 0,
                variantAxes: null,
                variantAttrs: (row.variantAttrs as Record<string, string> | null) ?? null,
                priceRange: null,
                sellable: row.sellable,
                hasBom: hasBomSet.has(row.id),
                usedInBom: usedInCount > 0,
                usedInCount,
                revenue30d: null,
                createdAt: row.createdAt,
              } satisfies ItemRow;
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

          return results;
        }

        const topLevelRows = await tx
          .select({
            id: items.id,
            name: items.name,
            sku: items.sku,
            itemType: items.itemType,
            isMaster: items.isMaster,
            parentId: items.parentId,
            stock: stockSubquery,
            committedQty: committedQtySubquery,
            demandQty: demandQtySubquery,
            shortageQty: shortageQtySubquery,
            availableQty: availableQtySubquery,
            expectedQty: expectedQtySubquery,
            safetyStock: trimScale(items.safetyStock).as("safetyStock"),
            defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
            unit: unitDefinitions.name,
            unitSize: unitDefinitions.size,
            unitUom: unitDefinitions.uom,
            category: items.category,
            potential: potentialSubquery,
            variantAxes: items.variantAxes,
            sellable: items.sellable,
            createdAt: items.createdAt,
          })
          .from(items)
          .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
          .where(
            and(
              isNull(items.deletedAt),
              isNull(items.parentId),
              eq(items.itemType, "product"),
            ),
          );

        const masterIds = topLevelRows.filter((row) => row.isMaster).map((row) => row.id);
        const variantRows = masterIds.length > 0
          ? await tx
              .select({
                id: items.id,
                name: items.name,
                sku: items.sku,
                itemType: items.itemType,
                isMaster: items.isMaster,
                parentId: items.parentId,
                stock: stockSubquery,
                committedQty: committedQtySubquery,
                demandQty: demandQtySubquery,
                shortageQty: shortageQtySubquery,
                availableQty: availableQtySubquery,
                expectedQty: expectedQtySubquery,
                safetyStock: trimScale(items.safetyStock).as("safetyStock"),
                defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
                unit: unitDefinitions.name,
                unitSize: unitDefinitions.size,
                unitUom: unitDefinitions.uom,
                category: items.category,
                variantAttrs: items.variantAttrs,
                sellable: items.sellable,
                createdAt: items.createdAt,
              })
              .from(items)
              .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
              .where(and(inArray(items.parentId, masterIds), isNull(items.deletedAt)))
          : [];

        const leafIds = [
          ...topLevelRows.filter((row) => !row.isMaster).map((row) => row.id),
          ...variantRows.map((row) => row.id),
        ];
        const [hasBomSet, usedInCounts, revenueByItemId, estimatedUnitCostByItemId] = await Promise.all([
          getCurrentBomProductIdSetInTx(tx, leafIds),
          getUsedInCountsInTx(tx, leafIds, bomViewPermissions),
          getRevenue30dByItemIdInTx(tx, leafIds),
          getEstimatedUnitCostsByItemIdInTx(tx, leafIds),
        ]);

        const variantsByParent = new Map<string, typeof variantRows>();
        for (const variant of variantRows) {
          const parentVariants = variantsByParent.get(variant.parentId!) ?? [];
          parentVariants.push(variant);
          variantsByParent.set(variant.parentId!, parentVariants);
        }

        const results: ItemRow[] = topLevelRows
          .flatMap<ItemRow>((row): ItemRow[] => {
            if (!row.isMaster) {
              if (row.sellable !== true) {
                return [];
              }

              const usedInCount = usedInCounts.get(row.id) ?? 0;
              const estimatedUnitCost = estimatedUnitCostByItemId.get(row.id) ?? null;
              return [{
                id: row.id,
                name: row.name,
                displayName: row.name,
                sku: row.sku,
                itemType: row.itemType as ItemType,
                stock: row.stock,
                committedQty: row.committedQty,
                demandQty: row.demandQty,
                shortageQty: row.shortageQty,
                availableQty: row.availableQty,
                expectedQty: row.expectedQty,
                safetyStock: row.safetyStock,
                currentStockUnitCost: null,
                unit: row.unit ?? null,
                unitSize: row.unitSize ?? null,
                unitUom: row.unitUom ?? null,
                category: row.category,
                potential: row.potential,
                estimatedUnitCost,
                marginPercent: calculateMarginPercent(row.defaultSellingPrice, estimatedUnitCost),
                marginTier: null,
                isMaster: false,
                parentId: null,
                variantCount: 0,
                variantAxes: null,
                variantAttrs: null,
                priceRange: null,
                sellable: row.sellable,
                hasBom: hasBomSet.has(row.id),
                usedInBom: usedInCount > 0,
                usedInCount,
                revenue30d: revenueByItemId.get(row.id) ?? null,
                createdAt: row.createdAt,
              } satisfies ItemRow];
            }

            const visibleVariants = (variantsByParent.get(row.id) ?? []).filter(
              (variant) => variant.sellable === true,
            );

            if (visibleVariants.length === 0) {
              return [];
            }

            const stock = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.stock), 0),
            );
            const committedQty = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.committedQty), 0),
            );
            const demandQty = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.demandQty), 0),
            );
            const shortageQty = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.shortageQty), 0),
            );
            const availableQty = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.availableQty), 0),
            );
            const expectedQty = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.expectedQty), 0),
            );
            const safetyStock = formatAggregateNumber(
              visibleVariants.reduce((sum, variant) => sum + parseNumeric(variant.safetyStock), 0),
            );
            const usedInCount = visibleVariants.reduce(
              (sum, variant) => sum + (usedInCounts.get(variant.id) ?? 0),
              0,
            );
            const revenueTotal = visibleVariants.reduce(
              (sum, variant) => sum + parseNumeric(revenueByItemId.get(variant.id)),
              0,
            );
            const knownVariantMargins = visibleVariants
              .map((variant) => calculateMarginPercent(
                variant.defaultSellingPrice,
                estimatedUnitCostByItemId.get(variant.id),
              ))
              .filter((value): value is string => value != null)
              .map((value) => Number.parseFloat(value))
              .filter((value) => Number.isFinite(value));
            const averageMargin = formatAverageMargin(knownVariantMargins);
            const knownVariantCosts = visibleVariants
              .map((variant) => estimatedUnitCostByItemId.get(variant.id))
              .filter((value): value is string => value != null)
              .map((value) => Number.parseFloat(value))
              .filter((value) => Number.isFinite(value));
            const avgEstimatedUnitCost = knownVariantCosts.length > 0
              ? formatAggregateNumber(
                  knownVariantCosts.reduce((sum, value) => sum + value, 0) /
                    knownVariantCosts.length,
                )
              : null;

            return [{
              id: row.id,
              name: row.name,
              displayName: row.name,
              sku: row.sku,
              itemType: row.itemType as ItemType,
              stock,
              committedQty,
              demandQty,
              shortageQty,
              availableQty,
              expectedQty,
              safetyStock,
              currentStockUnitCost: null,
              unit: null,
              unitSize: null,
              unitUom: null,
              category: "Soil Blend",
              potential: row.potential,
              estimatedUnitCost: avgEstimatedUnitCost,
              marginPercent: averageMargin,
              marginTier: null,
              isMaster: true,
              parentId: null,
              variantCount: visibleVariants.length,
              variantAxes: (row.variantAxes as string[] | null) ?? null,
              variantAttrs: null,
              priceRange: formatPriceRange(
                visibleVariants.map((variant) => variant.defaultSellingPrice),
              ),
              sellable: null,
              hasBom: false,
              usedInBom: usedInCount > 0,
              usedInCount,
              revenue30d: revenueTotal > 0 ? formatAggregateNumber(revenueTotal) : null,
              createdAt: row.createdAt,
              subRows: visibleVariants.map((variant) => {
                const variantUsedInCount = usedInCounts.get(variant.id) ?? 0;
                const estimatedUnitCost = estimatedUnitCostByItemId.get(variant.id) ?? null;
                return {
                  id: variant.id,
                  name: variant.name,
                  displayName: row.variantAxes
                    ? formatVariantDisplay(
                        row.name,
                        (variant.variantAttrs as Record<string, string>) ?? {},
                        row.variantAxes as string[],
                      )
                    : variant.name,
                  sku: variant.sku,
                  itemType: variant.itemType as ItemType,
                  stock: variant.stock,
                  committedQty: variant.committedQty,
                  demandQty: variant.demandQty,
                  shortageQty: variant.shortageQty,
                  availableQty: variant.availableQty,
                  expectedQty: variant.expectedQty,
                  safetyStock: variant.safetyStock,
                  currentStockUnitCost: null,
                  unit: variant.unit ?? null,
                  unitSize: variant.unitSize ?? null,
                  unitUom: variant.unitUom ?? null,
                  category: variant.category,
                  potential: null,
                  estimatedUnitCost,
                  marginPercent: calculateMarginPercent(
                    variant.defaultSellingPrice,
                    estimatedUnitCost,
                  ),
                  marginTier: null,
                  isMaster: false,
                  parentId: variant.parentId,
                  variantCount: 0,
                  variantAxes: null,
                  variantAttrs: (variant.variantAttrs as Record<string, string> | null) ?? null,
                  priceRange: null,
                  sellable: variant.sellable,
                  hasBom: hasBomSet.has(variant.id),
                  usedInBom: variantUsedInCount > 0,
                  usedInCount: variantUsedInCount,
                  revenue30d: revenueByItemId.get(variant.id) ?? null,
                  createdAt: variant.createdAt,
                } satisfies ItemRow;
              }),
            } satisfies ItemRow];
          })
          .sort((a, b) => {
            const revenueDiff = parseNumeric(b.revenue30d) - parseNumeric(a.revenue30d);
            if (revenueDiff !== 0) {
              return revenueDiff;
            }

            const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
            if (createdAtDiff !== 0) {
              return createdAtDiff;
            }

            return a.name.localeCompare(b.name);
          });

        return applyMarginTiers(results);
      });
    },
    {
      extra: {
        itemType: filters?.itemType ?? null,
        view: filters?.view ?? null,
      },
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getInventoryTabCounts(): Promise<InventoryTabCounts> {
  const context = await getAuthedMemberContext();
  const bomViewPermissions = getBomViewPermissions(context.assignedRoles);

  return withAuthedOrgContext(async (tx) => {
    const bomParentVisibilityCondition = bomViewPermissions.canViewLockedBom
      ? sql`true`
      : bomViewPermissions.canViewUnlockedBom
        ? sql`parent_item.bom_locked = false`
        : sql`false`;
    const currentBomUsageExists = sql`
      EXISTS (
        SELECT 1
        FROM inventory.bom_revision_components brc
        INNER JOIN inventory.bom_revisions br ON br.id = brc.bom_revision_id
        INNER JOIN inventory.items parent_item ON parent_item.id = br.product_id
        WHERE brc.component_id = ${items.id}
          AND br.is_current = true
          AND parent_item.deleted_at IS NULL
          AND ${bomParentVisibilityCondition}
      )
    `;
    const masterHasSellableVariant = sql`
      EXISTS (
        SELECT 1
        FROM inventory.items v
        WHERE v.parent_id = ${items.id}
          AND v.deleted_at IS NULL
          AND v.sellable = true
      )
    `;

    const [counts] = await tx
      .select({
        products: sql<number>`COUNT(*) FILTER (
          WHERE ${items.itemType} = 'product'
            AND ${items.parentId} IS NULL
            AND (
              (${items.isMaster} = false AND ${items.sellable} = true)
              OR (${items.isMaster} = true AND ${masterHasSellableVariant})
            )
        )::int`,
        materials: sql<number>`COUNT(*) FILTER (
          WHERE ${items.itemType} = 'material'
        )::int`,
        subAssemblies: sql<number>`COUNT(*) FILTER (
          WHERE ${items.itemType} = 'product'
            AND ${items.isMaster} = false
            AND (${items.sellable} = false OR ${currentBomUsageExists})
        )::int`,
      })
      .from(items)
      .where(isNull(items.deletedAt));

    return {
      products: Number(counts?.products ?? 0),
      materials: Number(counts?.materials ?? 0),
      subAssemblies: Number(counts?.subAssemblies ?? 0),
    };
  });
}

export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: items.category,
        description: items.description,
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
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        sellable: items.sellable,
        manufacturingMode: items.manufacturingMode,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        isMaster: items.isMaster,
        parentId: items.parentId,
        variantAxes: items.variantAxes,
        variantAttrs: items.variantAttrs,
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

    const parentName = row.parentId
      ? await tx
          .select({ name: items.name })
          .from(items)
          .where(eq(items.id, row.parentId))
          .then((rows) => rows[0]?.name ?? null)
      : null;

    const masterAxes = row.parentId
      ? await tx
          .select({ variantAxes: items.variantAxes })
          .from(items)
          .where(eq(items.id, row.parentId))
          .then((rows) => (rows[0]?.variantAxes as string[] | null) ?? [])
      : null;

    return {
      ...row,
      parentName,
      variantAxes: (row.variantAxes as string[] | null) ?? null,
      variantAttrs: (row.variantAttrs as Record<string, string> | null) ?? null,
      displayName:
        row.parentId && parentName && masterAxes && masterAxes.length > 0
          ? formatVariantDisplay(
              parentName,
              (row.variantAttrs as Record<string, string>) ?? {},
              masterAxes,
            )
          : row.name,
      purchaseUnitName: purchaseUnit?.name ?? null,
      purchaseUnitSize: purchaseUnit?.size ?? null,
      purchaseUnitUom: purchaseUnit?.uom ?? null,
      currentBomRevision,
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
          inArray(salesOrders.status, ["confirmed", "partially_shipped"]),
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
  hasActiveVariants?: boolean;
}> {
  return withAuthedOrgContext(async (tx) => {
    await lockItemsInTx(tx, [id]);

    // Check for active variants (masters can't be deleted while variants exist)
    const [activeVariant] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.parentId, id), isNull(items.deletedAt)))
      .limit(1);

    if (activeVariant) {
      return { deleted: false, hasActiveVariants: true };
    }

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
          inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"])
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
          inArray(manufacturingOrders.status, ["draft", "released"]),
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

    // Check for active variants
    const [activeVariantRef] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(inArray(items.parentId, uniqueIds), isNull(items.deletedAt)))
      .limit(1);

    if (activeVariantRef) {
      return {
        deletedCount: 0,
        error: "Cannot delete: one or more products still have active variants.",
      };
    }

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
          inArray(salesOrders.status, ["draft", "confirmed", "partially_shipped"])
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by draft, confirmed, or partially shipped sales orders.",
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
          inArray(manufacturingOrders.status, ["draft", "released"]),
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
          "Cannot delete: one or more items are used by draft or released manufacturing orders.",
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

export async function getLots(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
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
      .leftJoin(
        inventoryLotBalances,
        and(
          eq(inventoryLotBalances.organizationId, lots.organizationId),
          eq(inventoryLotBalances.itemId, lots.itemId),
          eq(inventoryLotBalances.lotId, lots.id),
          sql`${inventoryLotBalances.quantity} > 0`
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
  options: { days?: number; bucket?: "week" } = {}
): Promise<ItemUsageHistory | null> {
  const days = options.days ?? 180;
  const bucket = options.bucket ?? "week";

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
          inArray(inventoryEvents.eventType, MATERIAL_USAGE_EVENT_TYPES),
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

      const signedQuantity = usageEventSign(eventType) * quantity;
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
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateItem",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, itemData, stock, bom, revisionNote },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [existingItem] = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
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

    if (bom !== undefined) {
      if (
        hasBomChanged(
          currentBom.map((row) => ({
            componentId: row.componentId,
            quantity: row.quantity,
            minimumLotAgeDays: getMinimumLotAgeDays(row.constraints),
            alternates: row.alternates.map((alternate) => ({
              itemId: alternate.alternateItemId,
            })),
          })),
          bom
        )
      ) {
        await createBomRevisionInTx(tx, {
          orgId,
          userId,
          productId: id,
          note: revisionNote,
          bom,
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
            componentCount: bom.length,
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
  data: Omit<InsertItem, "stock" | "bom" | "revisionNote">,
  stock: string,
  bom?: BomInputRow[],
  revisionNote?: string | null,
  options?: { idempotencyKey?: string },
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createItemWithLot",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { data, stock, bom, revisionNote },
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

    const [item] = await tx
      .insert(items)
      .values({
        ...data,
        currentStockUnitCost: initialCurrentStockUnitCost,
        organizationId: orgId,
      })
      .returning({ id: items.id });

    if (bom && bom.length > 0) {
      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: item.id,
        note: revisionNote,
        bom,
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

export async function getBomRevisionHistory(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const revisions = await getBomRevisionHistoryInTx(tx, itemId);

    return Promise.all(
      revisions.map(async (revision) => ({
        ...revision,
        components: await getBomRevisionComponentsInTx(tx, revision.id),
      }))
    );
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
        parentId: items.parentId,
        variantAttrs: items.variantAttrs,
      })
      .from(bomRevisionComponents)
      .innerJoin(bomRevisions, eq(bomRevisionComponents.bomRevisionId, bomRevisions.id))
      .innerJoin(items, eq(bomRevisions.productId, items.id))
      .where(
        and(
          eq(bomRevisionComponents.componentId, itemId),
          eq(bomRevisions.isCurrent, true),
          isNull(items.deletedAt),
          bomParentVisibilityCondition,
        ),
      )
      .orderBy(asc(items.name));

    const parentIds = [...new Set(
      rows
        .map((row) => row.parentId)
        .filter((id): id is string => id != null),
    )];
    const parents = parentIds.length > 0
      ? await tx
          .select({
            id: items.id,
            name: items.name,
            variantAxes: items.variantAxes,
          })
          .from(items)
          .where(and(inArray(items.id, parentIds), isNull(items.deletedAt)))
      : [];
    const parentsById = new Map(
      parents.map((parent) => [
        parent.id,
        {
          name: parent.name,
          variantAxes: (parent.variantAxes as string[] | null) ?? [],
        },
      ]),
    );

    return rows.map((row) => {
      const parent = row.parentId ? parentsById.get(row.parentId) : null;
      const displayName =
        parent && parent.variantAxes.length > 0
          ? formatVariantDisplay(
              parent.name,
              (row.variantAttrs as Record<string, string>) ?? {},
              parent.variantAxes,
            )
          : row.name;

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
    const conditions = [isNull(items.deletedAt), eq(items.isMaster, false)];
    if (excludeItemId) {
      conditions.push(sql`${items.id} != ${excludeItemId}`);
    }
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        parentId: items.parentId,
        variantAttrs: items.variantAttrs,
        displayName: items.name,
        itemType: items.itemType,
        unit: unitDefinitions.name,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));

    const parentIds = [...new Set(
      rows
        .map((row) => row.parentId)
        .filter((id): id is string => id != null),
    )];
    const parents = parentIds.length > 0
      ? await tx
          .select({
            id: items.id,
            name: items.name,
            variantAxes: items.variantAxes,
          })
          .from(items)
          .where(and(inArray(items.id, parentIds), isNull(items.deletedAt)))
      : [];
    const parentsById = new Map(
      parents.map((parent) => [
        parent.id,
        {
          name: parent.name,
          variantAxes: (parent.variantAxes as string[] | null) ?? [],
        },
      ]),
    );

    return rows.map((row) => {
      const parent = row.parentId ? parentsById.get(row.parentId) : null;
      return {
        id: row.id,
        name: row.name,
        displayName:
          parent && parent.variantAxes.length > 0
            ? formatVariantDisplay(
                parent.name,
                (row.variantAttrs as Record<string, string>) ?? {},
                parent.variantAxes,
              )
            : row.name,
        itemType: row.itemType,
        unit: row.unit,
      };
    });
  });
}

export async function createMasterProduct(
  data: InsertMasterItem,
  options?: { idempotencyKey?: string },
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createMasterProduct",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: data,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [item] = await tx
      .insert(items)
      .values({
        ...data,
        organizationId: orgId,
        itemType: "product",
        sku: null,
        unitDefinitionId: null,
        isMaster: true,
      })
      .returning({ id: items.id });

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: item,
    });

    return item;
  });
}

export async function updateMasterProduct(
  id: string,
  data: InsertMasterItem,
  options?: { idempotencyKey?: string },
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateMasterProduct",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, data },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const [item] = await tx
      .update(items)
      .set({
        name: data.name,
        description: data.description,
        category: data.category,
        variantAxes: data.variantAxes,
        sku: null,
        unitDefinitionId: null,
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
        defaultPurchasePrice: null,
        currentStockUnitCost: null,
        defaultSellingPrice: null,
        sellable: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(items.id, id),
          eq(items.isMaster, true),
          isNull(items.deletedAt)
        )
      )
      .returning({ id: items.id });

    const result = item ?? null;
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function createVariant(
  parentId: string,
  data: InsertVariant,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [master] = await tx
      .select({
        id: items.id,
        isMaster: items.isMaster,
        parentId: items.parentId,
        category: items.category,
        name: items.name,
        variantAxes: items.variantAxes,
      })
      .from(items)
      .where(and(eq(items.id, parentId), isNull(items.deletedAt)))
      .for("update");

    if (!master) throw new InventoryError("Master product not found", 404);
    if (!master.isMaster) throw new InventoryError("Parent is not a master product");
    if (master.parentId != null) throw new InventoryError("Cannot create variant under a variant");

    // Validate that all master axes have a value in variantAttrs
    const axes = (master.variantAxes as string[] | null) ?? [];
    for (const axis of axes) {
      if (!data.variantAttrs[axis]) {
        throw new InventoryError(`Missing value for variant axis: ${axis}`);
      }
    }

    // Guard against duplicate variants with identical attribute combinations
    const [duplicate] = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.parentId, parentId),
          isNull(items.deletedAt),
          sql`variant_attrs = ${JSON.stringify(data.variantAttrs)}::jsonb`,
        ),
      )
      .limit(1);

    if (duplicate) {
      throw new InventoryError("A variant with these attribute values already exists");
    }

    const [variant] = await tx
      .insert(items)
      .values({
        organizationId: orgId,
        name: master.name,           // variant name = master name
        sku: data.sku ?? null,
        description: data.description ?? null,
        itemType: "product",
        category: master.category,
        unitDefinitionId: data.unitDefinitionId,
        manufacturingMode: data.manufacturingMode,
        expectedBatchYield: data.expectedBatchYield ?? null,
        defaultSellingPrice: data.defaultSellingPrice ?? null,
        defaultPurchasePrice: data.defaultPurchasePrice ?? null,
        safetyStock: data.safetyStock,
        sellable: data.sellable,
        isMaster: false,
        parentId: parentId,
        variantAttrs: data.variantAttrs,
      })
      .returning({ id: items.id });

    // Create initial BOM only if provided by caller (not copied from master)
    if (data.bom && data.bom.length > 0) {
      await createBomRevisionInTx(tx, {
        orgId,
        userId,
        productId: variant.id,
        note: data.revisionNote,
        bom: data.bom,
      });
    }

    return variant;
  });
}

export async function getVariants(parentId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        stock: stockSubquery,
        committedQty: committedQtySubquery,
        demandQty: demandQtySubquery,
        shortageQty: shortageQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as("defaultSellingPrice"),
        unit: unitDefinitions.name,
        variantAttrs: items.variantAttrs,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.parentId, parentId), isNull(items.deletedAt)));

    return rows.map((r) => ({
      ...r,
      unit: r.unit ?? null,
      variantAttrs: (r.variantAttrs as Record<string, string> | null) ?? null,
    }));
  });
}
