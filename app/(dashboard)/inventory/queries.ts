// Org isolation is enforced by RLS via app.current_org_id.
// Read/update/delete queries omit organizationId filters — RLS handles org scoping.
// Create queries pass orgId explicitly so it's stored on the row.
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  bomRevisionComponents,
  bomRevisions,
  inventoryEvents,
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
import { formatVariantDisplay } from "@/lib/format";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import {
  getBomRevisionComponentsInTx,
  getBomRevisionHistoryInTx,
  getCurrentBomComponentsInTx,
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  getCurrentOnHandQtyInTx,
  lockItemsInTx,
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  projectedCommittedQty,
  projectedCommittedQtyExpr,
  projectedExpectedQty,
  projectedLotQuantity,
  projectedLotUnitCost,
  projectedOnHandQty,
  projectedOnHandQtyExpr,
  recordCostBasisChangeInTx,
} from "@/lib/inventory/kernel";
import type { InsertItem, InsertMasterItem, InsertVariant, UpdateItem } from "@/lib/schemas/items";
import type { InsertUnitDefinition } from "@/lib/schemas/units";
import { DomainError } from "@/lib/errors/domain-error";
import type {
  InventoryProductView,
  InventoryTabCounts,
  ItemRow,
  ItemType,
} from "./types";

export class InventoryError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "InventoryError" });
  }
}

const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
const committedQtySubquery = projectedCommittedQty(
  items.organizationId,
  items.id
).as("committedQty");
const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");

// Potential: how many finished units could be produced from current available ingredient stock.
// For discrete products: floor(min(component_available / bom_qty))
// For batch products: floor(min(component_available / bom_qty)) * expected_batch_yield
// Available = lot stock - committed qty (stock already allocated to open orders)
const potentialSubquery = sql<string | null>`(
  CASE WHEN ${items.itemType} = 'product' AND EXISTS (
    SELECT 1
    FROM inventory.bom_revisions br
    INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
    WHERE br.product_id = ${items.id}
      AND br.is_current = true
  ) THEN
    FLOOR(
      (
        SELECT MIN(
          (
            ${projectedOnHandQtyExpr(items.organizationId, sql`brc.component_id`)}
            - ${projectedCommittedQtyExpr(items.organizationId, sql`brc.component_id`)}
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
  ELSE NULL END
)`.as("potential");

type BomInputRow = { componentId: string; quantity: string };
type BomViewPermissions = {
  canViewUnlockedBom: boolean;
  canViewLockedBom: boolean;
};

function normalizeBomRows(bom: BomInputRow[]) {
  return bom.map((row, index) => ({
    componentId: row.componentId,
    quantity: row.quantity,
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
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(inArray(items.id, componentIds), isNull(items.deletedAt)));

    const componentById = new Map(componentRows.map((row) => [row.id, row]));

    await tx.insert(bomRevisionComponents).values(
      params.bom.map((row, index) => {
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
      })
    );
  }

  return revision;
}

export async function getItems(filters?: {
  itemType?: ItemType;
  view?: InventoryProductView;
}): Promise<ItemRow[]> {
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
          expectedQty: expectedQtySubquery,
          safetyStock: trimScale(items.safetyStock).as("safetyStock"),
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
        expectedQty: row.expectedQty,
        safetyStock: row.safetyStock,
        unit: row.unit ?? null,
        unitSize: row.unitSize ?? null,
        unitUom: row.unitUom ?? null,
        category: row.category,
        potential: row.potential,
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
            expectedQty: row.expectedQty,
            safetyStock: row.safetyStock,
            unit: row.unit ?? null,
            unitSize: row.unitSize ?? null,
            unitUom: row.unitUom ?? null,
            category: row.category,
            potential: null,
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
    const [hasBomSet, usedInCounts, revenueByItemId] = await Promise.all([
      getCurrentBomProductIdSetInTx(tx, leafIds),
      getUsedInCountsInTx(tx, leafIds, bomViewPermissions),
      getRevenue30dByItemIdInTx(tx, leafIds),
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
          return [{
            id: row.id,
            name: row.name,
            displayName: row.name,
            sku: row.sku,
            itemType: row.itemType as ItemType,
            stock: row.stock,
            committedQty: row.committedQty,
            expectedQty: row.expectedQty,
            safetyStock: row.safetyStock,
            unit: row.unit ?? null,
            unitSize: row.unitSize ?? null,
            unitUom: row.unitUom ?? null,
            category: row.category,
            potential: row.potential,
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

        return [{
          id: row.id,
          name: row.name,
          displayName: row.name,
          sku: row.sku,
          itemType: row.itemType as ItemType,
          stock,
          committedQty,
          expectedQty,
          safetyStock,
          unit: row.unit ?? null,
          unitSize: row.unitSize ?? null,
          unitUom: row.unitUom ?? null,
          category: row.category,
          potential: row.potential,
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
              expectedQty: variant.expectedQty,
              safetyStock: variant.safetyStock,
              unit: variant.unit ?? null,
              unitSize: variant.unitSize ?? null,
              unitUom: variant.unitUom ?? null,
              category: variant.category,
              potential: null,
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

    return results;
  });
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
          inArray(salesOrders.status, ["draft", "confirmed"])
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
          inArray(salesOrders.status, ["draft", "confirmed"])
        )
      )
      .limit(1);

    if (activeOrderRef) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete: one or more items are used by draft or confirmed sales orders.",
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
    return tx
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: projectedLotQuantity(lots.organizationId, lots.id).as("quantity"),
        costPerUnit: projectedLotUnitCost(lots.organizationId, lots.id).as("costPerUnit"),
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.receivedAt);
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
          WHEN ${inventoryEvents.eventType} IN ('stocktake_gain', 'stocktake_loss', 'stocktake_verification') THEN 'stocktake_adjustment'
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
            "manual_adjustment_decrease",
            "stocktake_loss",
            "sales_consumption",
            "manufacturing_ingredient_consumption",
            "unpick_restock",
            "stocktake_verification",
          ])
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt));
  });
}

// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom" | "revisionNote">,
  stock?: number,
  bom?: Array<{ componentId: string; quantity: string }>,
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
        purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
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

    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (bom !== undefined) {
      if (
        hasBomChanged(
          currentBom.map((row) => ({
            componentId: row.componentId,
            quantity: row.quantity,
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
      itemData.defaultPurchasePrice !== undefined &&
      itemData.defaultPurchasePrice !== existingItem.defaultPurchasePrice
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
          after: itemData.defaultPurchasePrice,
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
  bom?: Array<{ componentId: string; quantity: string }>,
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

    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
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
      componentName: row.componentName,
      componentItemType: row.componentItemType,
      componentUnit: row.unitName,
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
