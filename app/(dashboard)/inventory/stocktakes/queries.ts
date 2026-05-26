import "server-only";

import { normalizeNumeric } from "@/lib/format";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  inventoryLotBalances,
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
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  lockItemsInTx,
  projectedOnHandQty,
  reconcileInventoryLotAllocationsForItemsInTx,
  reconcileStocktakeCountInTx,
} from "@/lib/inventory/kernel";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  CompleteStocktake,
  InsertStocktake,
  StocktakeScope,
  StocktakeScopeItemType,
  UpdateStocktakeCounts,
} from "@/lib/schemas/stocktakes";
import {
  buildStocktakeCategoryScope,
  parseStocktakeScope,
} from "@/lib/schemas/stocktakes";
import type {
  StocktakeDetail,
  StocktakeDetailLine,
  StocktakeListRow,
  StocktakePreviewItem,
  StocktakeScopeOption,
  StocktakeScopeOptionGroup,
  StocktakeStaleWarningPayload,
} from "./types";

type LockedStocktake = {
  id: string;
  status: string;
};

type SnapshotItem = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  unitName: string;
  currentQty: string;
};

type CountedStocktakeCompletionLine = {
  stocktakeLineId: string;
  stocktakeItemId: string;
  itemId: string;
  lotId: string | null;
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

async function getLockedStocktakeInTx(tx: Tx, id: string): Promise<LockedStocktake | null> {
  const [stocktake] = await tx
    .select({
      id: stocktakes.id,
      status: stocktakes.status,
    })
    .from(stocktakes)
    .where(eq(stocktakes.id, id))
    .for("update");

  return stocktake ?? null;
}

async function getStocktakeLinesInTx(
  tx: Tx,
  stocktakeId: string,
  options?: { liveCurrent?: boolean }
): Promise<StocktakeDetailLine[]> {
  const expectedQty = options?.liveCurrent
    ? projectedOnHandQty(items.organizationId, items.id).as("expectedQty")
    : trimScale(stocktakeItems.expectedQty).as("expectedQty");
  const rows = await tx
    .select({
      id: stocktakeItems.id,
      itemId: stocktakeItems.itemId,
      itemName: stocktakeItems.itemName,
      itemSku: stocktakeItems.itemSku,
      itemType: stocktakeItems.itemType,
      unitName: stocktakeItems.unitName,
      expectedQty,
      countedQty: trimScaleNullable(stocktakeItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeItems.appliedDeltaQty).as("appliedDeltaQty"),
      sortOrder: stocktakeItems.sortOrder,
      createdAt: stocktakeItems.createdAt,
      updatedAt: stocktakeItems.updatedAt,
    })
    .from(stocktakeItems)
    .innerJoin(items, eq(stocktakeItems.itemId, items.id))
    .where(eq(stocktakeItems.stocktakeId, stocktakeId))
    .orderBy(asc(stocktakeItems.sortOrder), asc(stocktakeItems.createdAt));

  const lineRows = rows as StocktakeDetailLine[];
  if (lineRows.length === 0) return [];
  const lotRows = await tx
    .select({
      id: stocktakeLotItems.id,
      stocktakeItemId: stocktakeLotItems.stocktakeItemId,
      lotId: stocktakeLotItems.lotId,
      lotNumber: stocktakeLotItems.lotNumber,
      expectedQty: options?.liveCurrent
        ? trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
            "expectedQty"
          )
        : trimScale(stocktakeLotItems.expectedQty).as("expectedQty"),
      countedQty: trimScaleNullable(stocktakeLotItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeLotItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeLotItems.appliedDeltaQty).as("appliedDeltaQty"),
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
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .where(inArray(stocktakeLotItems.stocktakeItemId, lineRows.map((line) => line.id)))
    .groupBy(
      stocktakeLotItems.id,
      stocktakeLotItems.stocktakeItemId,
      stocktakeLotItems.lotId,
      stocktakeLotItems.lotNumber,
      stocktakeLotItems.expectedQty,
      stocktakeLotItems.countedQty,
      stocktakeLotItems.varianceQty,
      stocktakeLotItems.appliedDeltaQty,
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

async function getAvailableLotRowsForItemIdsInTx(tx: Tx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return tx
    .select({
      itemId: inventoryLotBalances.itemId,
      lotId: inventoryLotBalances.lotId,
      lotNumber: lots.lotNumber,
      expectedQty: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as(
        "expectedQty"
      ),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`,
        sql`NOT EXISTS (
          SELECT 1
          FROM ${inventoryLotBalances} debt_balances
          WHERE debt_balances.organization_id = ${inventoryLotBalances.organizationId}
            AND debt_balances.location_id = ${inventoryLotBalances.locationId}
            AND debt_balances.item_id = ${inventoryLotBalances.itemId}
            AND debt_balances.disposition = 'available'
            AND debt_balances.quantity < 0
        )`
      )
    )
    .groupBy(
      inventoryLotBalances.itemId,
      inventoryLotBalances.lotId,
      lots.lotNumber,
      inventoryLotBalances.receivedAt
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
}

async function getSnapshotItemsForScopeInTx(tx: Tx, scope: StocktakeScope) {
  const conditions = [isNull(items.deletedAt)];
  const parsedScope = parseStocktakeScope(scope);

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
      unitName: unitDefinitions.name,
      currentQty: projectedOnHandQty(items.organizationId, items.id).as("currentQty"),
    })
    .from(items)
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

async function getSnapshotItemsForItemIdsInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = Array.from(new Set(itemIds));

  if (uniqueIds.length === 0) {
    return [];
  }

  const lockedRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(isNull(items.deletedAt), inArray(items.id, uniqueIds)))
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
      unitName: unitDefinitions.name,
      currentQty: projectedOnHandQty(items.organizationId, items.id).as("currentQty"),
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(inArray(items.id, lockedRows.map((row) => row.id)));

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });
}

export async function getStocktakePreviewItems(): Promise<StocktakePreviewItem[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        stocktakeType: sql<StocktakeScopeItemType>`${items.itemType}`.as(
          "stocktakeType"
        ),
        category: items.category,
        unitName: unitDefinitions.name,
        currentQty: projectedOnHandQty(items.organizationId, items.id).as("currentQty"),
      })
      .from(items)
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
      stocktakeType: row.stocktakeType as StocktakeScopeItemType,
      displayName: row.name,
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

export async function getStocktakes(): Promise<StocktakeListRow[]> {
  return measureObservedOperation(
    "inventory.get_stocktakes",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const rows = await tx
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
          .where(sql`${stocktakes.status} NOT IN ('cancelled', 'deleted')`)
          .orderBy(desc(stocktakes.createdAt), asc(stocktakes.name), asc(stocktakes.id));

        if (rows.length === 0) {
          return [];
        }

        const ids = rows.map((row) => row.id);
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

        return rows.map((row) => {
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
        notes: stocktakes.notes,
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

    const lines = await getStocktakeLinesInTx(tx, id, {
      liveCurrent: stocktake.status === "draft",
    });

    return {
      ...stocktake,
      scope: stocktake.scope as StocktakeScope,
      status: stocktake.status as StocktakeDetail["status"],
      lines,
    };
  });
}

export async function createStocktake(data: InsertStocktake) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const snapshotItems = (data.itemIds?.length
      ? await getSnapshotItemsForItemIdsInTx(tx, data.itemIds)
      : await getSnapshotItemsForScopeInTx(tx, data.scope)) as SnapshotItem[];

    if (snapshotItems.length === 0) {
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
        scope: data.scope,
        status: "draft",
        notes: data.notes,
      })
      .returning({ id: stocktakes.id });

    const stocktakeLines = await tx.insert(stocktakeItems).values(
      snapshotItems.map((item, index) => ({
        stocktakeId: stocktake.id,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        itemType: item.itemType,
        unitName: item.unitName,
        expectedQty: normalizeNumeric(parseFloat(item.currentQty)),
        countedQty: null,
        varianceQty: null,
        appliedDeltaQty: null,
        sortOrder: index,
      }))
    ).returning({ id: stocktakeItems.id, itemId: stocktakeItems.itemId });
    const lotRows = await getAvailableLotRowsForItemIdsInTx(
      tx,
      stocktakeLines.map((line) => line.itemId)
    );
    const lineIdByItemId = new Map(stocktakeLines.map((line) => [line.itemId, line.id]));
    if (lotRows.length > 0) {
      await tx.insert(stocktakeLotItems).values(
        lotRows.flatMap((lot, index) => {
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
            receivedAt: lot.receivedAt,
            sortOrder: index,
          };
        })
      );
    }

    return stocktake;
  });
}

export async function updateStocktakeCounts(id: string, data: UpdateStocktakeCounts) {
  return withAuthedOrgContext(async (tx) => {
    const stocktake = await getLockedStocktakeInTx(tx, id);

    if (!stocktake) {
      return null;
    }

    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be updated.", 400);
    }

    const existingLines = await getStocktakeLinesInTx(tx, id, { liveCurrent: true });
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));

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
        const snapshotItems = await getSnapshotItemsForItemIdsInTx(tx, addedItemIds);
        if (snapshotItems.length !== addedItemIds.length) {
          throw new StocktakeError("One or more selected items are no longer active.", 400, {
            errors: {
              itemIds: ["Refresh and choose active items."],
            },
          });
        }

        const addedLines = await tx.insert(stocktakeItems).values(
          snapshotItems.map((item) => ({
            stocktakeId: id,
            itemId: item.id,
            itemName: item.name,
            itemSku: item.sku,
            itemType: item.itemType,
            unitName: item.unitName,
            expectedQty: normalizeNumeric(parseFloat(item.currentQty)),
            countedQty: null,
            varianceQty: null,
            appliedDeltaQty: null,
            sortOrder: uniqueItemIds.indexOf(item.id),
          }))
        ).returning({ id: stocktakeItems.id, itemId: stocktakeItems.itemId });
        const lotRows = await getAvailableLotRowsForItemIdsInTx(tx, addedItemIds);
        const lineIdByItemId = new Map(addedLines.map((line) => [line.itemId, line.id]));
        if (lotRows.length > 0) {
          await tx.insert(stocktakeLotItems).values(
            lotRows.flatMap((lot, index) => {
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
                receivedAt: lot.receivedAt,
                sortOrder: index,
              };
            })
          );
        }
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

    await tx
      .update(stocktakes)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.scope !== undefined ? { scope: data.scope } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(stocktakes.id, id));

    return { id };
  });
}

export async function completeStocktake(
  id: string,
  confirmStale: CompleteStocktake["confirmStale"],
  options?: { idempotencyKey?: string }
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

    const existingLines = await getStocktakeLinesInTx(tx, id, { liveCurrent: true });
    const countedLines: CountedStocktakeCompletionLine[] = [];
    for (const line of existingLines) {
      if (line.lots.length > 0) {
        for (const lot of line.lots) {
          if (lot.countedQty == null) {
            continue;
          }

          countedLines.push({
            stocktakeLineId: lot.id,
            stocktakeItemId: line.id,
            itemId: line.itemId,
            lotId: lot.lotId,
            expectedQty: lot.expectedQty,
            countedQty: lot.countedQty,
          });
        }
        continue;
      }

      if (line.countedQty == null) {
        continue;
      }

      countedLines.push({
        stocktakeLineId: line.id,
        stocktakeItemId: line.id,
        itemId: line.itemId,
        lotId: null,
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
      });
    }

    if (countedLines.length === 0) {
      throw new StocktakeError("Enter at least one count before completing.", 400);
    }

    await lockItemsInTx(
      tx,
      countedLines.map((line) => line.itemId)
    );

    await reconcileStocktakeCountInTx(tx, {
      organizationId: orgId,
      stocktakeId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "complete-stocktake"
      ),
      lines: countedLines.map((line) => ({
        stocktakeLineId: line.stocktakeLineId,
        itemId: line.itemId,
        lotId: line.lotId,
        variance: Number(line.countedQty) - Number(line.expectedQty),
      })),
    });

    const lotCountedLines = countedLines.filter(
      (line): line is CountedStocktakeCompletionLine & { lotId: string } =>
        line.lotId != null
    );
    if (lotCountedLines.length > 0) {
      await reconcileInventoryLotAllocationsForItemsInTx(tx, {
        organizationId: orgId,
        itemIds: lotCountedLines.map((line) => line.itemId),
        lotIds: lotCountedLines.map((line) => line.lotId),
        actorUserId: userId,
      });
    }

    const itemCountedLines = countedLines.filter((line) => line.lotId == null);
    if (itemCountedLines.length > 0) {
      await reconcileInventoryLotAllocationsForItemsInTx(tx, {
        organizationId: orgId,
        itemIds: itemCountedLines.map((line) => line.itemId),
        actorUserId: userId,
      });
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

    const countedByStocktakeItemId = new Map<string, typeof countedLines>();
    for (const line of countedLines) {
      const bucket = countedByStocktakeItemId.get(line.stocktakeItemId) ?? [];
      bucket.push(line);
      countedByStocktakeItemId.set(line.stocktakeItemId, bucket);
    }

    for (const [stocktakeItemId, lines] of countedByStocktakeItemId) {
      if (lines.some((line) => line.lotId == null)) {
        continue;
      }

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

export async function cloneStocktake(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [source] = await tx
      .select({
        id: stocktakes.id,
        name: stocktakes.name,
        scope: stocktakes.scope,
      })
      .from(stocktakes)
      .where(eq(stocktakes.id, id));

    if (!source) {
      return null;
    }

    const sourceLines = await tx
      .select({ itemId: stocktakeItems.itemId })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, id))
      .orderBy(asc(stocktakeItems.sortOrder));

    return createStocktake({
      name: `${source.name} Copy`,
      scope: source.scope as StocktakeScope,
      notes: null,
      itemIds: sourceLines.map((line) => line.itemId),
    });
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
