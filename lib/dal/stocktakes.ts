import "server-only";

import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";

import { normalizeNumeric } from "@/lib/format";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
  itemFamilies,
  items,
  lots,
  stocktakeLotItems,
  stocktakeItems,
  stocktakes,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  beginInventoryOperationInTx,
  locationIdOrDefaultSubquery,
  resolveInventoryLocationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  lockItemsInTx,
  projectedOnHandQty,
  projectedOnHandQtyExpr,
  projectedReservableOnHandQtyExpr,
  reconcileStocktakeCountInTx,
} from "@/lib/inventory/kernel";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  CompleteStocktake,
  CloneStocktake,
  InsertStocktake,
  StocktakeCreationMode,
  StocktakeScope,
  StocktakeScopeItemType,
  UpdateStocktakeCounts,
} from "@/lib/schemas/stocktakes";
import {
  buildStocktakeCategoryScope,
  parseStocktakeScope,
} from "@/lib/schemas/stocktakes";
import { defaultStocktakeCopyName } from "@/lib/stocktake-names";
import type {
  StocktakeDetail,
  StocktakeDetailLine,
  StocktakeCompletionPreview,
  CloneStocktakeResult,
  StocktakeListRow,
  StocktakePreviewItem,
  StocktakeScopeOption,
  StocktakeScopeOptionGroup,
  StocktakeStaleWarningPayload,
} from "@/lib/dal/stocktake-types";

type LockedStocktake = {
  id: string;
  status: string;
  reason: string | null;
  locationId: string | null;
};

type SnapshotItem = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  lotTrackingMode: string;
  category: string | null;
  unitName: string;
  currentQty: string;
};

type CountedStocktakeCompletionLine = {
  stocktakeLineId: string;
  stocktakeItemId: string;
  itemId: string;
  lotId: string | null;
  foundLotNumber?: string | null;
  expectedQty: string;
  countedQty: string;
};

export class StocktakeError extends DomainError<{
  stale: StocktakeStaleWarningPayload;
}> {
  errors?: Record<string, string[]>;
  stale?: StocktakeStaleWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      stale?: StocktakeStaleWarningPayload;
    }
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "StocktakeError",
      errors,
      extra: options?.stale ? { stale: options.stale } : undefined,
    });

    this.errors = options?.errors;
    this.stale = options?.stale;
  }
}


function getVariance(expectedQty: string, countedQty: string | null) {
  if (countedQty == null) {
    return null;
  }

  return normalizeNumeric(Number(countedQty) - parseFloat(expectedQty));
}

function sumQuantities(values: Array<string | null | undefined>) {
  return normalizeNumeric(values.reduce((sum, value) => sum + Number(value ?? 0), 0));
}

function findCanonicalLotByNumber(
  lotsForLine: StocktakeDetailLine["lots"],
  lotNumber: string
) {
  return lotsForLine.find(
    (lot) => !lot.isFound && lot.lotNumber.trim() === lotNumber
  );
}

function stocktakeEligibleItemConditions() {
  return [
    isNull(items.deletedAt),
    isNotNull(items.familyId),
    inArray(items.itemType, ["material", "product"]),
  ];
}

function modeScope(mode: StocktakeCreationMode | undefined, fallback: StocktakeScope) {
  return mode ?? fallback;
}

async function getLockedStocktakeInTx(tx: Tx, id: string): Promise<LockedStocktake | null> {
  const [stocktake] = await tx
    .select({
      id: stocktakes.id,
      status: stocktakes.status,
      reason: stocktakes.reason,
      locationId: stocktakes.locationId,
    })
    .from(stocktakes)
    .where(eq(stocktakes.id, id))
    .for("update");

  return stocktake ?? null;
}

async function findActiveLotByNumberInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotNumber: string;
  }
): Promise<string | null> {
  const [existing] = await tx
    .select({ id: lots.id })
    .from(lots)
    .innerJoin(
      inventoryLotBalances,
      and(
        eq(inventoryLotBalances.organizationId, lots.organizationId),
        eq(inventoryLotBalances.itemId, lots.itemId),
        eq(inventoryLotBalances.lotId, lots.id),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.lotNumber, params.lotNumber)
      )
    );

  return existing?.id ?? null;
}

async function findLotByNumberInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotNumber: string;
    locationId?: string | null;
  }
): Promise<{ lotId: string; expectedQty: string } | null> {
  const [existing] = await tx
    .select({ id: lots.id })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.lotNumber, params.lotNumber)
      )
    );

  if (!existing) return null;

  const [balance] = await tx
    .select({
      expectedQty: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "expectedQty"
      ),
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, existing.id),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.locationId} = ${locationIdOrDefaultSubquery(
          inventoryLotBalances.organizationId,
          params.locationId
        )}`
      )
    );

  return { lotId: existing.id, expectedQty: balance?.expectedQty ?? "0" };
}

async function getStocktakeLinesInTx(
  tx: Tx,
  stocktakeId: string,
  options?: { liveCurrent?: boolean }
): Promise<StocktakeDetailLine[]> {
  const [stocktakeRow] = await tx
    .select({ locationId: stocktakes.locationId })
    .from(stocktakes)
    .where(eq(stocktakes.id, stocktakeId));
  const locationId = stocktakeRow?.locationId ?? null;
  const expectedQty = options?.liveCurrent
    ? trimScale(
        projectedReservableOnHandQtyExpr(items.organizationId, items.id, locationId)
      ).as("expectedQty")
    : trimScale(stocktakeItems.expectedQty).as("expectedQty");
  const rows = await tx
    .select({
      id: stocktakeItems.id,
      itemId: stocktakeItems.itemId,
      itemName: stocktakeItems.itemName,
      itemSku: stocktakeItems.itemSku,
      itemType: stocktakeItems.itemType,
      lotTrackingMode: itemFamilies.lotTrackingMode,
      category: items.category,
      unitName: stocktakeItems.unitName,
      expectedQty,
      countedQty: trimScaleNullable(stocktakeItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeItems.appliedDeltaQty).as("appliedDeltaQty"),
      notes: stocktakeItems.notes,
      sortOrder: stocktakeItems.sortOrder,
      createdAt: stocktakeItems.createdAt,
      updatedAt: stocktakeItems.updatedAt,
    })
    .from(stocktakeItems)
    .innerJoin(items, eq(stocktakeItems.itemId, items.id))
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(eq(stocktakeItems.stocktakeId, stocktakeId))
    .orderBy(asc(stocktakeItems.sortOrder), asc(stocktakeItems.createdAt));

  const lineRows = rows as StocktakeDetailLine[];
  if (lineRows.length === 0) return [];
  const lotRows = await tx
    .select({
      id: stocktakeLotItems.id,
      stocktakeItemId: stocktakeLotItems.stocktakeItemId,
      lotId: stocktakeLotItems.lotId,
      isFound: stocktakeLotItems.isFound,
      lotNumber: stocktakeLotItems.lotNumber,
      expectedQty: options?.liveCurrent
        ? trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
            "expectedQty"
          )
        : trimScale(stocktakeLotItems.expectedQty).as("expectedQty"),
      countedQty: trimScaleNullable(stocktakeLotItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeLotItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeLotItems.appliedDeltaQty).as("appliedDeltaQty"),
      notes: stocktakeLotItems.notes,
      receivedAt: stocktakeLotItems.receivedAt,
      sortOrder: stocktakeLotItems.sortOrder,
      createdAt: stocktakeLotItems.createdAt,
      updatedAt: stocktakeLotItems.updatedAt,
    })
    .from(stocktakeLotItems)
    .leftJoin(
      inventoryLotBalances,
      and(
        eq(inventoryLotBalances.lotId, stocktakeLotItems.lotId),
        eq(inventoryLotBalances.disposition, "available"),
        // Stocktakes count and reconcile at their stamped location
        // (null = the default location).
        sql`${inventoryLotBalances.locationId} = ${locationIdOrDefaultSubquery(
          inventoryLotBalances.organizationId,
          locationId
        )}`,
        sql`${inventoryLotBalances.quantity} <> 0`
      )
    )
    .where(inArray(stocktakeLotItems.stocktakeItemId, lineRows.map((line) => line.id)))
    .groupBy(
      stocktakeLotItems.id,
      stocktakeLotItems.stocktakeItemId,
      stocktakeLotItems.lotId,
      stocktakeLotItems.isFound,
      stocktakeLotItems.lotNumber,
      stocktakeLotItems.expectedQty,
      stocktakeLotItems.countedQty,
      stocktakeLotItems.varianceQty,
      stocktakeLotItems.appliedDeltaQty,
      stocktakeLotItems.notes,
      stocktakeLotItems.receivedAt,
      stocktakeLotItems.sortOrder,
      stocktakeLotItems.createdAt,
      stocktakeLotItems.updatedAt
    )
    .orderBy(asc(stocktakeLotItems.sortOrder), asc(stocktakeLotItems.receivedAt));
  const lotsByLineId = new Map<string, StocktakeDetailLine["lots"]>();
  for (const lot of lotRows) {
    const current = lotsByLineId.get(lot.stocktakeItemId) ?? [];
    current.push(lot);
    lotsByLineId.set(lot.stocktakeItemId, current);
  }
  return lineRows.map((line) => ({ ...line, lots: lotsByLineId.get(line.id) ?? [] }));
}

async function getAvailableLotRowsForItemIdsInTx(
  tx: Tx,
  itemIds: string[],
  locationId?: string | null
) {
  if (itemIds.length === 0) return [];
  return tx
    .select({
      itemId: lots.itemId,
      lotId: lots.id,
      lotNumber: lots.lotNumber,
      expectedQty: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "expectedQty"
      ),
      receivedAt: lots.receivedAt,
    })
    .from(lots)
    .innerJoin(items, eq(items.id, lots.itemId))
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .leftJoin(
      inventoryLotBalances,
      and(
        eq(inventoryLotBalances.organizationId, lots.organizationId),
        eq(inventoryLotBalances.itemId, lots.itemId),
        eq(inventoryLotBalances.lotId, lots.id),
        // Stocktakes count and reconcile at their stamped location
        // (null = the default location).
        sql`${inventoryLotBalances.locationId} = ${locationIdOrDefaultSubquery(
          lots.organizationId,
          locationId
        )}`,
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .where(
      and(
        inArray(lots.itemId, itemIds),
        eq(itemFamilies.lotTrackingMode, "tracked")
      )
    )
    .groupBy(
      lots.itemId,
      lots.id,
      lots.lotNumber,
      lots.receivedAt
    )
    .orderBy(asc(lots.receivedAt), asc(lots.id));
}

async function getSnapshotItemsForScopeInTx(
  tx: Tx,
  scope: StocktakeScope,
  locationId?: string | null
) {
  const conditions = stocktakeEligibleItemConditions();
  const parsedScope = parseStocktakeScope(scope);

  if (parsedScope.kind === "empty") {
    return [];
  }

  if (parsedScope.kind === "in_stock") {
    conditions.push(
      sql`${projectedOnHandQtyExpr(items.organizationId, items.id, locationId)} > 0`
    );
  }

  if (parsedScope.kind === "type") {
    conditions.push(eq(items.itemType, parsedScope.itemType));
  }

  if (parsedScope.kind === "category") {
    conditions.push(eq(items.itemType, parsedScope.itemType));
    conditions.push(eq(items.category, parsedScope.category));
  }

  const lockedRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(...conditions))
    .orderBy(asc(items.id))
    .for("update");

  if (lockedRows.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      lotTrackingMode: itemFamilies.lotTrackingMode,
      category: items.category,
      unitName: unitDefinitions.name,
      currentQty: projectedOnHandQty(items.organizationId, items.id, locationId).as("currentQty"),
    })
    .from(items)
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(items.id, lockedRows.map((row) => row.id)));

  return rows.sort((left, right) => {
    const typeCompare = left.itemType.localeCompare(right.itemType);
    if (typeCompare !== 0) {
      return typeCompare;
    }

    return left.name.localeCompare(right.name);
  });
}

async function getSnapshotItemsForItemIdsInTx(
  tx: Tx,
  itemIds: string[],
  locationId?: string | null
) {
  const uniqueIds = Array.from(new Set(itemIds));

  if (uniqueIds.length === 0) {
    return [];
  }

  const lockedRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(...stocktakeEligibleItemConditions(), inArray(items.id, uniqueIds)))
    .orderBy(asc(items.id))
    .for("update");

  if (lockedRows.length !== uniqueIds.length) {
    throw new StocktakeError("One or more selected items are no longer active.", 400, {
      errors: {
        itemIds: ["Refresh the preview and choose active items."],
      },
    });
  }

  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      lotTrackingMode: itemFamilies.lotTrackingMode,
      category: items.category,
      unitName: unitDefinitions.name,
      currentQty: projectedOnHandQty(items.organizationId, items.id, locationId).as("currentQty"),
    })
    .from(items)
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(items.id, lockedRows.map((row) => row.id)));

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });
}

async function insertStocktakeSnapshotLinesInTx(
  tx: Tx,
  stocktakeId: string,
  snapshotItems: SnapshotItem[],
  locationId?: string | null,
  sortOrderByItemId?: Map<string, number>
) {
  if (snapshotItems.length === 0) return [];

  const stocktakeLines = await tx.insert(stocktakeItems).values(
    snapshotItems.map((item, index) => ({
      stocktakeId,
      itemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      itemType: item.itemType,
      unitName: item.unitName,
      expectedQty: normalizeNumeric(parseFloat(item.currentQty)),
      countedQty: null,
      varianceQty: null,
      appliedDeltaQty: null,
      notes: null,
      sortOrder: sortOrderByItemId?.get(item.id) ?? index,
    }))
  ).returning({ id: stocktakeItems.id, itemId: stocktakeItems.itemId });

  const lotRows = await getAvailableLotRowsForItemIdsInTx(
    tx,
    stocktakeLines.map((line) => line.itemId),
    locationId
  );
  const snapshotQtyByItemId = new Map(
    snapshotItems.map((item) => [item.id, Number(item.currentQty)])
  );
  const countableLotRows = lotRows.filter(
    (lot) =>
      Number(lot.expectedQty) > 0 &&
      (snapshotQtyByItemId.get(lot.itemId) ?? 0) > 0
  );
  const lineIdByItemId = new Map(stocktakeLines.map((line) => [line.itemId, line.id]));
  if (countableLotRows.length > 0) {
    await tx.insert(stocktakeLotItems).values(
      countableLotRows.flatMap((lot, index) => {
        const stocktakeItemId = lineIdByItemId.get(lot.itemId);
        if (!stocktakeItemId) return [];
        return {
          stocktakeItemId,
          lotId: lot.lotId,
          lotNumber: lot.lotNumber,
          expectedQty: normalizeNumeric(parseFloat(lot.expectedQty)),
          countedQty: null,
          varianceQty: null,
          appliedDeltaQty: null,
          notes: null,
          receivedAt: lot.receivedAt,
          sortOrder: index,
        };
      })
    );
  }

  return stocktakeLines;
}

export async function getStocktakePreviewItems(
  locationId?: string | null
): Promise<StocktakePreviewItem[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        lotTrackingMode: itemFamilies.lotTrackingMode,
        stocktakeType: sql<StocktakeScopeItemType>`${items.itemType}`.as(
          "stocktakeType"
        ),
        category: items.category,
        unitName: unitDefinitions.name,
        currentQty: projectedOnHandQty(items.organizationId, items.id, locationId).as(
          "currentQty"
        ),
      })
      .from(items)
      .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(
        and(
          isNull(items.deletedAt),
          isNotNull(items.familyId),
          inArray(items.itemType, ["material", "product"])
        )
      )
      .orderBy(asc(items.itemType), asc(items.name), asc(items.id));

    return rows.map((row) => ({
      ...row,
      itemType: row.itemType as StocktakePreviewItem["itemType"],
      lotTrackingMode: row.lotTrackingMode as StocktakePreviewItem["lotTrackingMode"],
      stocktakeType: row.stocktakeType as StocktakeScopeItemType,
      displayName: row.name,
      searchText: [
        row.name,
        row.sku,
        row.itemType,
        row.category,
        row.unitName,
      ]
        .filter((part): part is string => part != null && part.trim() !== "")
        .join(" "),
    }));
  });
}

export async function getStocktakeScopeOptions(): Promise<StocktakeScopeOptionGroup[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .selectDistinct({
        itemType: items.itemType,
        category: items.category,
      })
      .from(items)
      .where(
        and(
          isNull(items.deletedAt),
          isNotNull(items.category),
          inArray(items.itemType, ["material", "product"])
        )
      )
      .orderBy(asc(items.itemType), asc(items.category));

    const categoriesByType = new Map<StocktakeScopeItemType, string[]>([
      ["material", []],
      ["product", []],
    ]);

    rows.forEach((row) => {
      const itemType = row.itemType as StocktakeScopeItemType;
      const category = row.category?.trim();

      if (!category) {
        return;
      }

      const bucket = categoriesByType.get(itemType);
      if (!bucket || bucket.includes(category)) {
        return;
      }

      bucket.push(category);
    });

    const quickScopeOptions: StocktakeScopeOption[] = [
      { value: "all", label: "All Items" },
      { value: "material", label: "Materials" },
      { value: "product", label: "Products" },
    ];

    return [
      {
        label: "Quick scopes",
        options: quickScopeOptions,
      },
      {
        label: "Material categories",
        options: categoriesByType
          .get("material")!
          .map((category) => ({
            value: buildStocktakeCategoryScope("material", category),
            label: category,
          })),
      },
      {
        label: "Product categories",
        options: categoriesByType
          .get("product")!
          .map((category) => ({
            value: buildStocktakeCategoryScope("product", category),
            label: category,
          })),
      },
    ].filter((group) => group.options.length > 0);
  });
}

export async function getStocktakes(options?: {
  search?: string | null;
  limit?: number | null;
}): Promise<StocktakeListRow[]> {
  return measureObservedOperation(
    "inventory.get_stocktakes",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const search = options?.search?.trim();
        const limit = options?.limit ?? null;
        const whereConditions = [
          sql`${stocktakes.status} NOT IN ('cancelled', 'deleted')`,
          ...(search ? [ilike(stocktakes.name, `%${search}%`)] : []),
        ];
        const rowsQuery = tx
          .select({
            id: stocktakes.id,
            name: stocktakes.name,
            scope: stocktakes.scope,
            status: stocktakes.status,
            notes: stocktakes.notes,
            completedAt: stocktakes.completedAt,
            cancelledAt: stocktakes.cancelledAt,
            createdAt: stocktakes.createdAt,
            updatedAt: stocktakes.updatedAt,
          })
          .from(stocktakes)
          .where(and(...whereConditions))
          .orderBy(desc(stocktakes.createdAt), asc(stocktakes.name), asc(stocktakes.id))
          .$dynamic();

        const filteredRows = limit == null ? await rowsQuery : await rowsQuery.limit(limit);

        if (filteredRows.length === 0) {
          return [];
        }

        const ids = filteredRows.map((row) => row.id);
        const lineRows = await tx
          .select({
            stocktakeId: stocktakeItems.stocktakeId,
            countedQty: stocktakeItems.countedQty,
            varianceQty: stocktakeItems.varianceQty,
          })
          .from(stocktakeItems)
          .where(inArray(stocktakeItems.stocktakeId, ids));

        const counts = new Map<
          string,
          { itemCount: number; countedCount: number; varianceCount: number }
        >();

        lineRows.forEach((line) => {
          const bucket = counts.get(line.stocktakeId) ?? {
            itemCount: 0,
            countedCount: 0,
            varianceCount: 0,
          };

          bucket.itemCount += 1;

          if (line.countedQty != null) {
            bucket.countedCount += 1;
          }

          if (line.varianceQty != null && parseFloat(line.varianceQty) !== 0) {
            bucket.varianceCount += 1;
          }

          counts.set(line.stocktakeId, bucket);
        });

        return filteredRows.map((row) => {
          const bucket = counts.get(row.id) ?? {
            itemCount: 0,
            countedCount: 0,
            varianceCount: 0,
          };

          return {
            ...row,
            scope: row.scope as StocktakeScope,
            status: row.status as StocktakeListRow["status"],
            ...bucket,
          };
        });
      });
    },
    {
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getStocktake(id: string): Promise<StocktakeDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const [stocktake] = await tx
      .select({
        id: stocktakes.id,
        name: stocktakes.name,
        scope: stocktakes.scope,
        status: stocktakes.status,
        locationId: stocktakes.locationId,
        notes: stocktakes.notes,
        reason: stocktakes.reason,
        completedAt: stocktakes.completedAt,
        cancelledAt: stocktakes.cancelledAt,
        createdAt: stocktakes.createdAt,
        updatedAt: stocktakes.updatedAt,
      })
      .from(stocktakes)
      .where(and(eq(stocktakes.id, id), sql`${stocktakes.status} NOT IN ('cancelled', 'deleted')`));

    if (!stocktake) {
      return null;
    }

    const lines = await getStocktakeLinesInTx(tx, id);

    return {
      ...stocktake,
      scope: stocktake.scope as StocktakeScope,
      status: stocktake.status as StocktakeDetail["status"],
      lines,
    };
  });
}

export async function getStocktakeCompletionPreview(
  id: string
): Promise<StocktakeCompletionPreview | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [stocktake] = await tx
      .select({
        id: stocktakes.id,
        name: stocktakes.name,
        status: stocktakes.status,
        locationId: stocktakes.locationId,
      })
      .from(stocktakes)
      .where(and(eq(stocktakes.id, id), sql`${stocktakes.status} NOT IN ('cancelled', 'deleted')`));

    if (!stocktake) return null;
    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be previewed.", 400);
    }

    const snapshotLines = await getStocktakeLinesInTx(tx, id, { liveCurrent: false });
    const liveLines = await getStocktakeLinesInTx(tx, id, { liveCurrent: true });
    const liveLineById = new Map(liveLines.map((line) => [line.id, line]));
    const countedLines = snapshotLines.filter((line) =>
      line.lots.length > 0
        ? line.lots.some((lot) => lot.countedQty != null)
        : line.countedQty != null
    );

    if (countedLines.length === 0) {
      throw new StocktakeError("Enter at least one count before reviewing.", 400);
    }

    return {
      id: stocktake.id,
      name: stocktake.name,
      status: stocktake.status as StocktakeCompletionPreview["status"],
      lines: await Promise.all(countedLines.map(async (line) => {
        const liveLine = liveLineById.get(line.id);
        if (line.lots.length > 0) {
          const liveLotsById = new Map(
            (liveLine?.lots ?? []).map((lot) => [lot.id, lot])
          );
          const allLots = await Promise.all(line.lots.map(async (lot) => {
            const liveLot = lot.isFound
              ? findCanonicalLotByNumber(liveLine?.lots ?? [], lot.lotNumber)
              : liveLotsById.get(lot.id);
            const canonicalLot = lot.isFound
              ? await findLotByNumberInTx(tx, {
                  organizationId: orgId,
                  itemId: line.itemId,
                  lotNumber: lot.lotNumber,
                  locationId: stocktake.locationId,
                })
              : null;
            const currentQty = liveLot?.expectedQty ?? canonicalLot?.expectedQty ?? "0";
            const countedQty = lot.countedQty ?? currentQty;
            return {
              lotLineId: lot.id,
              lotId: lot.lotId ?? liveLot?.lotId ?? canonicalLot?.lotId ?? null,
              isFound: lot.isFound,
              lotNumber: lot.lotNumber,
              expectedQty: lot.isFound ? "0" : lot.expectedQty,
              currentQty,
              countedQty,
              varianceQty: normalizeNumeric(Number(countedQty) - Number(currentQty)),
              notes: lot.notes,
              wasCounted: lot.countedQty != null,
            };
          }));
          const lots = allLots
            .filter((lot) => lot.wasCounted)
            .map((lot) => ({
              lotLineId: lot.lotLineId,
              lotId: lot.lotId,
              isFound: lot.isFound,
              lotNumber: lot.lotNumber,
              expectedQty: lot.expectedQty,
              currentQty: lot.currentQty,
              countedQty: lot.countedQty,
              varianceQty: lot.varianceQty,
              notes: lot.notes,
            }));
          const currentQty = sumQuantities(allLots.map((lot) => lot.currentQty));
          const countedQty = sumQuantities(allLots.map((lot) => lot.countedQty));
          return {
            lineId: line.id,
            itemId: line.itemId,
            itemName: line.itemName,
            itemSku: line.itemSku,
            category: line.category,
            unitName: line.unitName,
            expectedQty: line.expectedQty,
            currentQty,
            countedQty,
            varianceQty: normalizeNumeric(Number(countedQty) - Number(currentQty)),
            notes: line.notes,
            lots,
          };
        }

        const currentQty = liveLine?.expectedQty ?? "0";
        const countedQty = line.countedQty ?? "0";
        return {
          lineId: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          itemSku: line.itemSku,
          category: line.category,
          unitName: line.unitName,
          expectedQty: line.expectedQty,
          currentQty,
          countedQty,
          varianceQty: normalizeNumeric(Number(countedQty) - Number(currentQty)),
          notes: line.notes,
          lots: [],
        };
      })),
    };
  });
}

export async function createStocktake(data: InsertStocktake) {
  return withAuthedOrgContext(async (tx, orgId) => {
    // Validate and stamp a concrete location up front (org-owned, active) —
    // including the default, so a completed stocktake is a durable record of
    // where it counted even if the org default later changes. Rows predating
    // the column keep null = the current default.
    const stampedLocationId = (
      await resolveInventoryLocationInTx(tx, orgId, data.locationId)
    ).id;
    const scope = modeScope(data.creationMode, data.scope);
    const snapshotItems = (data.itemIds !== undefined
      ? await getSnapshotItemsForItemIdsInTx(tx, data.itemIds, stampedLocationId)
      : await getSnapshotItemsForScopeInTx(tx, scope, stampedLocationId)) as SnapshotItem[];

    if (snapshotItems.length === 0 && scope !== "empty") {
      throw new StocktakeError("No active items are selected.", 400, {
        errors: {
          itemIds: ["Choose at least one active item"],
        },
      });
    }

    const [stocktake] = await tx
      .insert(stocktakes)
      .values({
        organizationId: orgId,
        name: data.name,
        scope,
        locationId: stampedLocationId,
        status: "draft",
        notes: data.notes,
        reason: data.reason?.trim() || null,
      })
      .returning({ id: stocktakes.id });

    await insertStocktakeSnapshotLinesInTx(tx, stocktake.id, snapshotItems, stampedLocationId);

    return stocktake;
  });
}

export async function updateStocktakeCounts(id: string, data: UpdateStocktakeCounts) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const stocktake = await getLockedStocktakeInTx(tx, id);

    if (!stocktake) {
      return null;
    }

    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be updated.", 400);
    }

    const existingLines = await getStocktakeLinesInTx(tx, id);
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));

    // Counting lots (including re-counts of already-recorded found lots) and
    // deleting found lines stay free; only recording a newly discovered lot
    // is a lot-tracking workflow.
    let recordsNewFoundLot = false;
    for (const foundLot of data.foundLotLines) {
      const ownerLine = lineMap.get(foundLot.stocktakeItemId);
      if (!ownerLine || ownerLine.lotTrackingMode !== "tracked") continue;
      const existingFoundLot = ownerLine.lots.some(
        (lot) => lot.isFound && lot.lotNumber.trim() === foundLot.lotNumber
      );
      if (existingFoundLot || findCanonicalLotByNumber(ownerLine.lots, foundLot.lotNumber)) {
        continue;
      }

      const canonicalLot = await findLotByNumberInTx(tx, {
        organizationId: orgId,
        itemId: ownerLine.itemId,
        lotNumber: foundLot.lotNumber,
        locationId: stocktake.locationId,
      });
      if (!canonicalLot) {
        recordsNewFoundLot = true;
        break;
      }
    }
    if (recordsNewFoundLot) {
      await assertFeatureAccessInTx(tx, orgId, "lot_tracking", {
        route: "PUT /api/stocktakes/[id]",
      });
    }

    if (data.itemIds) {
      const uniqueItemIds = Array.from(new Set(data.itemIds));
      const existingByItemId = new Map(existingLines.map((line) => [line.itemId, line]));
      const removedLineIds = existingLines
        .filter((line) => !uniqueItemIds.includes(line.itemId))
        .map((line) => line.id);
      const addedItemIds = uniqueItemIds.filter((itemId) => !existingByItemId.has(itemId));

      if (removedLineIds.length > 0) {
        await tx
          .delete(stocktakeLotItems)
          .where(inArray(stocktakeLotItems.stocktakeItemId, removedLineIds));
        await tx
          .delete(stocktakeItems)
          .where(inArray(stocktakeItems.id, removedLineIds));
      }

      if (addedItemIds.length > 0) {
        const snapshotItems = await getSnapshotItemsForItemIdsInTx(
          tx,
          addedItemIds,
          stocktake.locationId
        );
        if (snapshotItems.length !== addedItemIds.length) {
          throw new StocktakeError("One or more selected items are no longer active.", 400, {
            errors: {
              itemIds: ["Refresh and choose active items."],
            },
          });
        }

        await insertStocktakeSnapshotLinesInTx(
          tx,
          id,
          snapshotItems,
          stocktake.locationId,
          new Map(uniqueItemIds.map((itemId, index) => [itemId, index]))
        );
      }

      for (const [index, itemId] of uniqueItemIds.entries()) {
        const existingLine = existingByItemId.get(itemId);
        if (!existingLine) continue;
        await tx
          .update(stocktakeItems)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(eq(stocktakeItems.id, existingLine.id));
      }
    }

    for (const line of data.lines) {
      const existingLine = lineMap.get(line.lineId);

      if (!existingLine) {
        throw new StocktakeError("Stocktake line not found", 404, {
          errors: {
            lines: ["Refresh and try again."],
          },
        });
      }

      const countedQty = line.countedQty;
      const varianceQty = getVariance(existingLine.expectedQty, countedQty);

      await tx
        .update(stocktakeItems)
        .set({
          expectedQty: existingLine.expectedQty,
          countedQty,
          varianceQty,
          ...(line.notes !== undefined ? { notes: line.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, existingLine.id));
    }

    const currentLines = existingLines.map((line) => ({ ...line, lots: [...line.lots] }));
    const lotLineMap = new Map(
      currentLines.flatMap((line) =>
        line.lots.map((lot) => [lot.id, { line, lot }] as const)
      )
    );
    const stocktakeItemIdsToRollUp = new Set<string>();

    for (const lotLineId of data.deletedLotLineIds) {
      const existing = lotLineMap.get(lotLineId);

      if (!existing) {
        throw new StocktakeError("Stocktake lot line not found", 404, {
          errors: {
            lotLines: ["Refresh and try again."],
          },
        });
      }

      if (!existing.lot.isFound) {
        throw new StocktakeError("Only found lots can be removed.", 400, {
          errors: {
            lotLines: ["Count existing lots as zero instead of removing them."],
          },
        });
      }

      await tx
        .delete(stocktakeLotItems)
        .where(eq(stocktakeLotItems.id, existing.lot.id));

      existing.line.lots = existing.line.lots.filter((lot) => lot.id !== existing.lot.id);
      lotLineMap.delete(lotLineId);
      stocktakeItemIdsToRollUp.add(existing.line.id);
    }

    for (const lotLine of data.lotLines) {
      const existing = lotLineMap.get(lotLine.lotLineId);

      if (!existing) {
        throw new StocktakeError("Stocktake lot line not found", 404, {
          errors: {
            lotLines: ["Refresh and try again."],
          },
        });
      }

      const countedQty = lotLine.countedQty;
      const varianceQty = getVariance(existing.lot.expectedQty, countedQty);

      await tx
        .update(stocktakeLotItems)
        .set({
          expectedQty: existing.lot.expectedQty,
          countedQty,
          varianceQty,
          ...(lotLine.notes !== undefined ? { notes: lotLine.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stocktakeLotItems.id, existing.lot.id));

      const lineLots = existing.line.lots.map((candidate) =>
        candidate.id === existing.lot.id
          ? { ...candidate, countedQty, varianceQty }
          : candidate
      );
      existing.line.lots = lineLots;
      const allLotsCounted = lineLots.every((candidate) => candidate.countedQty != null);
      const lineCountedQty = allLotsCounted
        ? sumQuantities(lineLots.map((candidate) => candidate.countedQty))
        : null;
      const lineVarianceQty = lineCountedQty == null
        ? null
        : getVariance(existing.line.expectedQty, lineCountedQty);

      await tx
        .update(stocktakeItems)
        .set({
          expectedQty: existing.line.expectedQty,
          countedQty: lineCountedQty,
          varianceQty: lineVarianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, existing.line.id));
    }

    for (const foundLot of data.foundLotLines) {
      const ownerLine = lineMap.get(foundLot.stocktakeItemId);

      if (!ownerLine) {
        throw new StocktakeError("Stocktake line not found", 404, {
          errors: {
            lotLines: ["Refresh and try again."],
          },
        });
      }

      const [family] = await tx
        .select({ lotTrackingMode: itemFamilies.lotTrackingMode })
        .from(items)
        .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
        .where(eq(items.id, ownerLine.itemId));

      if (!family || family.lotTrackingMode !== "tracked") {
        throw new StocktakeError(
          "Found lots can only be added to lot-tracked items.",
          400,
          { errors: { lotLines: ["This item does not track lots."] } }
        );
      }

      const snapshotLot = findCanonicalLotByNumber(ownerLine.lots, foundLot.lotNumber);
      if (snapshotLot) {
        const countedQty = foundLot.countedQty;
        await tx
          .update(stocktakeLotItems)
          .set({
            countedQty,
            varianceQty: getVariance(snapshotLot.expectedQty, countedQty),
            ...(foundLot.notes !== undefined ? { notes: foundLot.notes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(stocktakeLotItems.id, snapshotLot.id));

        stocktakeItemIdsToRollUp.add(ownerLine.id);
        continue;
      }

      const countedQty = foundLot.countedQty;
      const varianceQty = getVariance("0", countedQty);

      // Idempotent save: a retried/concurrent PUT must not accumulate duplicate
      // found rows. Atomic upsert on the partial unique index
      // (stocktake_item_id, lot_number) WHERE is_found.
      await tx
        .insert(stocktakeLotItems)
        .values({
          stocktakeItemId: ownerLine.id,
          lotId: null,
          isFound: true,
          lotNumber: foundLot.lotNumber,
          expectedQty: "0",
          countedQty,
          varianceQty,
          ...(foundLot.notes !== undefined ? { notes: foundLot.notes } : {}),
          receivedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [stocktakeLotItems.stocktakeItemId, stocktakeLotItems.lotNumber],
          targetWhere: sql`is_found`,
          set: {
            expectedQty: "0",
            countedQty,
            varianceQty,
            ...(foundLot.notes !== undefined ? { notes: foundLot.notes } : {}),
            updatedAt: new Date(),
          },
        });

      stocktakeItemIdsToRollUp.add(ownerLine.id);
    }

    // Re-aggregate the parent item rollup so found lot adds/removals contribute to the
    // item's counted/variance totals, mirroring the lot-update path above.
    for (const stocktakeItemId of stocktakeItemIdsToRollUp) {
      const [parent] = await tx
        .select({
          id: stocktakeItems.id,
          expectedQty: trimScale(stocktakeItems.expectedQty).as("expectedQty"),
        })
        .from(stocktakeItems)
        .where(eq(stocktakeItems.id, stocktakeItemId));
      if (!parent) continue;

      const lotRows = await tx
        .select({
          countedQty: trimScaleNullable(stocktakeLotItems.countedQty).as("countedQty"),
        })
        .from(stocktakeLotItems)
        .where(eq(stocktakeLotItems.stocktakeItemId, stocktakeItemId));

      const allLotsCounted = lotRows.every((lot) => lot.countedQty != null);
      const lineCountedQty = allLotsCounted
        ? sumQuantities(lotRows.map((lot) => lot.countedQty))
        : null;
      const lineVarianceQty =
        lineCountedQty == null
          ? null
          : getVariance(parent.expectedQty, lineCountedQty);

      await tx
        .update(stocktakeItems)
        .set({
          expectedQty: parent.expectedQty,
          countedQty: lineCountedQty,
          varianceQty: lineVarianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, stocktakeItemId));
    }

    await tx
      .update(stocktakes)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
        updatedAt: new Date(),
      })
      .where(eq(stocktakes.id, id));

    return { id };
  });
}

export async function completeStocktake(
  id: string,
  confirmStale: CompleteStocktake["confirmStale"],
  options?: { idempotencyKey?: string; reason?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "completeStocktake",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, confirmStale },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const stocktake = await getLockedStocktakeInTx(tx, id);

    if (!stocktake) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be completed.", 400);
    }

    const snapshotLines = await getStocktakeLinesInTx(tx, id);
    const liveLines = await getStocktakeLinesInTx(tx, id, { liveCurrent: true });
    const liveLineById = new Map(liveLines.map((line) => [line.id, line]));
    const countedLines: CountedStocktakeCompletionLine[] = [];
    const staleItems: StocktakeStaleWarningPayload["items"] = [];
    let createsUnnumberedTrackedLot = false;
    const lotRollupsByStocktakeItemId = new Map<
      string,
      Array<{ expectedQty: string; countedQty: string }>
    >();

    for (const line of snapshotLines) {
      const liveLine = liveLineById.get(line.id);
      if (line.lots.length > 0) {
        const liveLotsById = new Map(
          (liveLine?.lots ?? []).map((lot) => [lot.id, lot])
        );
        if (!line.lots.some((lot) => lot.countedQty != null)) {
          continue;
        }

        const lotRollupLines: Array<{ expectedQty: string; countedQty: string }> = [];
        for (const lot of line.lots) {
          const liveLot = lot.isFound
            ? findCanonicalLotByNumber(liveLine?.lots ?? [], lot.lotNumber)
            : liveLotsById.get(lot.id);
          const canonicalLot = lot.isFound
            ? await findLotByNumberInTx(tx, {
                organizationId: orgId,
                itemId: line.itemId,
                lotNumber: lot.lotNumber,
                locationId: stocktake.locationId,
              })
            : null;
          const currentQty =
            liveLot?.expectedQty ?? canonicalLot?.expectedQty ?? "0";

          if (lot.countedQty == null) {
            lotRollupLines.push({
              expectedQty: currentQty,
              countedQty: currentQty,
            });
            continue;
          }

          if (lot.isFound) {
            // Found lots are not in the live snapshot. Defer lot creation to
            // the kernel: pass the operator lot number through reconcile, or
            // reuse a zero-balance historical lot with the same number.
            if (
              (liveLot?.lotId ?? canonicalLot?.lotId) != null &&
              Number(currentQty) !== Number(lot.expectedQty)
            ) {
              staleItems.push({
                lineId: line.id,
                lotLineId: lot.id,
                itemId: line.itemId,
                itemName: line.itemName,
                lotNumber: lot.lotNumber,
                unitName: line.unitName,
                expectedQty: lot.expectedQty,
                currentQty,
                countedQty: lot.countedQty,
              });
            }

            countedLines.push({
              stocktakeLineId: lot.id,
              stocktakeItemId: line.id,
              itemId: line.itemId,
              lotId: liveLot?.lotId ?? canonicalLot?.lotId ?? null,
              foundLotNumber: lot.lotNumber,
              expectedQty: currentQty,
              countedQty: lot.countedQty,
            });
            lotRollupLines.push({
              expectedQty: currentQty,
              countedQty: lot.countedQty,
            });
            continue;
          }

          if (Number(currentQty) !== Number(lot.expectedQty)) {
            staleItems.push({
              lineId: line.id,
              lotLineId: lot.id,
              itemId: line.itemId,
              itemName: line.itemName,
              lotNumber: lot.lotNumber,
              unitName: line.unitName,
              expectedQty: lot.expectedQty,
              currentQty,
              countedQty: lot.countedQty,
            });
          }

          countedLines.push({
            stocktakeLineId: lot.id,
            stocktakeItemId: line.id,
            itemId: line.itemId,
            lotId: lot.lotId,
            expectedQty: currentQty,
            countedQty: lot.countedQty,
          });
          lotRollupLines.push({
            expectedQty: currentQty,
            countedQty: lot.countedQty,
          });
        }
        lotRollupsByStocktakeItemId.set(line.id, lotRollupLines);
        continue;
      }

      if (line.countedQty == null) {
        continue;
      }

      const currentQty = liveLine?.expectedQty ?? "0";
      if (
        line.lotTrackingMode === "tracked" &&
        Number(line.countedQty) > Number(currentQty)
      ) {
        createsUnnumberedTrackedLot = true;
      }
      if (Number(currentQty) !== Number(line.expectedQty)) {
        staleItems.push({
          lineId: line.id,
          lotLineId: null,
          itemId: line.itemId,
          itemName: line.itemName,
          lotNumber: null,
          unitName: line.unitName,
          expectedQty: line.expectedQty,
          currentQty,
          countedQty: line.countedQty,
        });
      }

      countedLines.push({
        stocktakeLineId: line.id,
        stocktakeItemId: line.id,
        itemId: line.itemId,
        lotId: null,
        expectedQty: currentQty,
        countedQty: line.countedQty,
      });
    }

    if (countedLines.length === 0) {
      throw new StocktakeError("Enter at least one count before completing.", 400);
    }

    // A positive aggregate count on a tracked item with no lot lines makes the
    // kernel generate a new lot on completion — same boundary as new-lot
    // creation via adjustment.
    if (createsUnnumberedTrackedLot) {
      await assertFeatureAccessInTx(tx, orgId, "lot_tracking", {
        route: "POST /api/stocktakes/[id]/complete",
      });
    }

    if (!confirmStale && staleItems.length > 0) {
      throw new StocktakeError(
        "Stock changed since this stocktake was started. Review updated variances before completing.",
        409,
        { stale: { items: staleItems } }
      );
    }

    await lockItemsInTx(
      tx,
      countedLines.map((line) => line.itemId)
    );

    const reason = options?.reason?.trim() || stocktake.reason?.trim() || null;
    if (!reason) {
      throw new StocktakeError("Reason is required before completing this stocktake.", 400);
    }
    if (options?.reason) {
      await tx
        .update(stocktakes)
        .set({ reason, updatedAt: new Date() })
        .where(eq(stocktakes.id, id));
    }

    await reconcileStocktakeCountInTx(tx, {
      organizationId: orgId,
      stocktakeId: id,
      locationId: stocktake.locationId,
      reason: "cycle_count",
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "complete-stocktake"
      ),
      lines: countedLines.map((line) => ({
        stocktakeLineId: line.stocktakeLineId,
        itemId: line.itemId,
        lotId: line.lotId,
        foundLotNumber: line.foundLotNumber ?? null,
        variance: Number(line.countedQty) - Number(line.expectedQty),
      })),
    });

    // Backfill the lot id for found lines from the lot the kernel just created
    // (or matched) so display/allocation/rollup logic can treat them as lot
    // lines. The kernel resolves found lots by (org, item, lotNumber).
    for (const line of countedLines) {
      if (line.foundLotNumber == null) {
        continue;
      }

      const lotId =
        line.lotId ??
        (await findActiveLotByNumberInTx(tx, {
          organizationId: orgId,
          itemId: line.itemId,
          lotNumber: line.foundLotNumber,
        }));

      if (lotId) {
        line.lotId = lotId;
        await tx
          .update(stocktakeLotItems)
          .set({ lotId, updatedAt: new Date() })
          .where(eq(stocktakeLotItems.id, line.stocktakeLineId));
      }
    }

    for (const line of countedLines) {
      const delta = Number(line.countedQty) - Number(line.expectedQty);
      const normalizedVariance = getVariance(line.expectedQty, line.countedQty);
      const normalizedDelta = normalizeNumeric(delta);

      if (line.lotId) {
        await tx
          .update(stocktakeLotItems)
          .set({
            expectedQty: line.expectedQty,
            varianceQty: normalizedVariance,
            appliedDeltaQty: normalizedDelta,
            updatedAt: new Date(),
          })
          .where(eq(stocktakeLotItems.id, line.stocktakeLineId));
      } else {
        await tx
          .update(stocktakeItems)
          .set({
            expectedQty: line.expectedQty,
            varianceQty: normalizedVariance,
            appliedDeltaQty: normalizedDelta,
            updatedAt: new Date(),
          })
          .where(eq(stocktakeItems.id, line.stocktakeItemId));
      }
    }

    for (const [stocktakeItemId, lines] of lotRollupsByStocktakeItemId) {
      const expectedQty = sumQuantities(lines.map((line) => line.expectedQty));
      const countedQty = sumQuantities(lines.map((line) => line.countedQty));
      const varianceQty = getVariance(expectedQty, countedQty);

      await tx
        .update(stocktakeItems)
        .set({
          expectedQty,
          countedQty,
          varianceQty,
          appliedDeltaQty: varianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, stocktakeItemId));
    }

    await tx
      .update(stocktakes)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stocktakes.id, id));

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deleteStocktake(id: string) {
  const result = await deleteStocktakes([id]);
  return { deleted: result.deletedCount > 0, error: result.error };
}

export async function cloneStocktake(
  id: string,
  data: CloneStocktake
): Promise<CloneStocktakeResult | null> {
  return withAuthedOrgContext(async (tx) => {
    const [source] = await tx
      .select({
        id: stocktakes.id,
        name: stocktakes.name,
        scope: stocktakes.scope,
        locationId: stocktakes.locationId,
      })
      .from(stocktakes)
      .where(eq(stocktakes.id, id));

    if (!source) {
      return null;
    }

    const sourceLines = await tx
      .select({
        itemId: stocktakeItems.itemId,
        itemName: stocktakeItems.itemName,
        itemSku: stocktakeItems.itemSku,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, id))
      .orderBy(asc(stocktakeItems.sortOrder));

    const activeRows = sourceLines.length
      ? await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              ...stocktakeEligibleItemConditions(),
              inArray(items.id, sourceLines.map((line) => line.itemId))
            )
          )
      : [];
    const activeIds = new Set(activeRows.map((row) => row.id));
    const itemIds = sourceLines
      .map((line) => line.itemId)
      .filter((itemId) => activeIds.has(itemId));
    const skippedItems = sourceLines
      .filter((line) => !activeIds.has(line.itemId))
      .map((line) => ({ itemName: line.itemName, itemSku: line.itemSku }));
    const created = await createStocktake({
      name: data.name?.trim() ?? defaultStocktakeCopyName(source.name),
      locationId: source.locationId,
      scope: (itemIds.length === 0 ? "empty" : "all") as StocktakeScope,
      notes: null,
      reason: data.reason.trim(),
      itemIds,
    });

    return { id: created.id, skippedItems };
  });
}

export async function deleteStocktakes(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    const rows = await tx
      .select({ id: stocktakes.id, status: stocktakes.status })
      .from(stocktakes)
      .where(inArray(stocktakes.id, uniqueIds))
      .for("update");

    const nonDraft = rows.find((r) => r.status !== "draft");

    if (nonDraft) {
      return {
        deletedCount: 0,
        error:
          "Cannot delete this stocktake because it has already been completed. Completed inventory history must be preserved.",
      };
    }

    if (rows.length === 0) {
      return { deletedCount: 0 };
    }

    const rowIds = rows.map((r) => r.id);
    const deletedAt = new Date();

    await tx
      .update(stocktakes)
      .set({ status: "deleted", cancelledAt: deletedAt, updatedAt: deletedAt })
      .where(inArray(stocktakes.id, rowIds));

    return { deletedCount: rows.length };
  });
}
