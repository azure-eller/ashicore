import "server-only";

import { normalizeNumeric } from "@/lib/format";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  inventoryEvents,
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
  getCurrentAvailableOnHandQtyInTx,
  lockItemsInTx,
  projectedReservableOnHandQtyExpr,
  reconcileStocktakeCountInTx,
} from "@/lib/inventory/kernel";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  consumeSpecificLotInTx,
  appendPositiveStockToExistingLotInTx,
  resolvePositiveStockUnitCostInTx,
} from "@/lib/inventory/kernel/operations/stock-core";
import { applyItemBalanceDeltasInTx } from "@/lib/inventory/kernel/projections";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import type {
  CompleteStocktake,
  CreateStocktake,
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
  stocktakeType: StocktakeScopeItemType;
  category: string | null;
  unitName: string;
  currentQty: string;
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

function stocktakeTypeExpr() {
  return sql<StocktakeScopeItemType>`CASE
    WHEN ${items.itemType} = 'material' THEN 'material'
    WHEN ${items.itemType} = 'product' AND ${items.sellable} = true THEN 'product'
    ELSE 'subassembly'
  END`;
}

function scopeConditions(scope: StocktakeScope) {
  const parsedScope = parseStocktakeScope(scope);
  const conditions = [isNull(items.deletedAt), eq(items.isMaster, false)];

  if (parsedScope.kind === "type") {
    if (parsedScope.itemType === "material") {
      conditions.push(eq(items.itemType, "material"));
    } else if (parsedScope.itemType === "product") {
      conditions.push(eq(items.itemType, "product"), eq(items.sellable, true));
    } else {
      conditions.push(eq(items.itemType, "product"), eq(items.sellable, false));
    }
  }

  if (parsedScope.kind === "category") {
    conditions.push(eq(items.category, parsedScope.category));
    if (parsedScope.itemType === "material") {
      conditions.push(eq(items.itemType, "material"));
    } else if (parsedScope.itemType === "product") {
      conditions.push(eq(items.itemType, "product"), eq(items.sellable, true));
    } else {
      conditions.push(eq(items.itemType, "product"), eq(items.sellable, false));
    }
  }

  return conditions;
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
  stocktakeId: string
): Promise<StocktakeDetailLine[]> {
  const rows = await tx
    .select({
      id: stocktakeItems.id,
      itemId: stocktakeItems.itemId,
      itemName: stocktakeItems.itemName,
      itemSku: stocktakeItems.itemSku,
      itemType: stocktakeItems.itemType,
      unitName: stocktakeItems.unitName,
      expectedQty: trimScale(stocktakeItems.expectedQty).as("expectedQty"),
      countedQty: trimScaleNullable(stocktakeItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeItems.appliedDeltaQty).as("appliedDeltaQty"),
      sortOrder: stocktakeItems.sortOrder,
      createdAt: stocktakeItems.createdAt,
      updatedAt: stocktakeItems.updatedAt,
    })
    .from(stocktakeItems)
    .where(eq(stocktakeItems.stocktakeId, stocktakeId))
    .orderBy(asc(stocktakeItems.sortOrder), asc(stocktakeItems.createdAt));

  if (rows.length === 0) {
    return [];
  }

  const lotRows = await tx
    .select({
      id: stocktakeLotItems.id,
      stocktakeItemId: stocktakeLotItems.stocktakeItemId,
      lotId: stocktakeLotItems.lotId,
      lotNumber: stocktakeLotItems.lotNumber,
      expectedQty: trimScale(stocktakeLotItems.expectedQty).as("expectedQty"),
      countedQty: trimScaleNullable(stocktakeLotItems.countedQty).as("countedQty"),
      varianceQty: trimScaleNullable(stocktakeLotItems.varianceQty).as("varianceQty"),
      appliedDeltaQty: trimScaleNullable(stocktakeLotItems.appliedDeltaQty).as("appliedDeltaQty"),
      receivedAt: stocktakeLotItems.receivedAt,
      sortOrder: stocktakeLotItems.sortOrder,
      createdAt: stocktakeLotItems.createdAt,
      updatedAt: stocktakeLotItems.updatedAt,
    })
    .from(stocktakeLotItems)
    .where(inArray(stocktakeLotItems.stocktakeItemId, rows.map((row) => row.id)))
    .orderBy(asc(stocktakeLotItems.sortOrder), asc(stocktakeLotItems.receivedAt));

  const lotsByLineId = new Map<string, typeof lotRows>();
  lotRows.forEach((lotLine) => {
    const bucket = lotsByLineId.get(lotLine.stocktakeItemId) ?? [];
    bucket.push(lotLine);
    lotsByLineId.set(lotLine.stocktakeItemId, bucket);
  });

  return rows.map((row) => ({
    ...row,
    lots: (lotsByLineId.get(row.id) ?? []).map((lotLine) => ({
      id: lotLine.id,
      lotId: lotLine.lotId,
      lotNumber: lotLine.lotNumber,
      expectedQty: lotLine.expectedQty,
      countedQty: lotLine.countedQty,
      varianceQty: lotLine.varianceQty,
      appliedDeltaQty: lotLine.appliedDeltaQty,
      receivedAt: lotLine.receivedAt,
      sortOrder: lotLine.sortOrder,
      createdAt: lotLine.createdAt,
      updatedAt: lotLine.updatedAt,
    })),
  })) as StocktakeDetailLine[];
}

async function getSnapshotItemsForScopeInTx(
  tx: Tx,
  scope: StocktakeScope,
  itemIds?: string[]
) {
  if (itemIds && itemIds.length === 0) {
    return [];
  }

  const conditions = scopeConditions(scope);

  if (itemIds && itemIds.length > 0) {
    conditions.push(inArray(items.id, itemIds));
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
      stocktakeType: stocktakeTypeExpr().as("stocktakeType"),
      category: items.category,
      unitName: unitDefinitions.name,
      currentQty: trimScale(
        projectedReservableOnHandQtyExpr(items.organizationId, items.id)
      ).as("currentQty"),
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

export async function getStocktakeScopeOptions(): Promise<StocktakeScopeOptionGroup[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .selectDistinct({
        itemType: stocktakeTypeExpr().as("itemType"),
        category: items.category,
      })
      .from(items)
      .where(
        and(
          isNull(items.deletedAt),
          eq(items.isMaster, false),
          isNotNull(items.category),
          inArray(items.itemType, ["material", "product"])
        )
      )
      .orderBy(asc(stocktakeTypeExpr()), asc(items.category));

    const categoriesByType = new Map<StocktakeScopeItemType, string[]>([
      ["material", []],
      ["product", []],
      ["subassembly", []],
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
      { value: "subassembly", label: "Sub Assemblies" },
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
      {
        label: "Sub assembly categories",
        options: categoriesByType
          .get("subassembly")!
          .map((category) => ({
            value: buildStocktakeCategoryScope("subassembly", category),
            label: category,
          })),
      },
    ].filter((group) => group.options.length > 0);
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
        stocktakeType: stocktakeTypeExpr().as("stocktakeType"),
        category: items.category,
        unitName: unitDefinitions.name,
        currentQty: trimScale(
          projectedReservableOnHandQtyExpr(items.organizationId, items.id)
        ).as("currentQty"),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(
        and(
          isNull(items.deletedAt),
          eq(items.isMaster, false),
          inArray(items.itemType, ["material", "product"])
        )
      )
      .orderBy(asc(items.itemType), asc(items.name), asc(items.id));

    return rows as StocktakePreviewItem[];
  });
}

export async function getStocktakes(): Promise<StocktakeListRow[]> {
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
      .where(sql`${stocktakes.status} != 'cancelled'`)
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
      .where(eq(stocktakes.id, id));

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

async function getSnapshotLotRowsInTx(tx: Tx, itemIds: string[]) {
  if (itemIds.length === 0) {
    return [];
  }

  return tx
    .select({
      itemId: lots.itemId,
      lotId: lots.id,
      lotNumber: lots.lotNumber,
      expectedQty: trimScale(inventoryLotBalances.quantity).as("expectedQty"),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
    .where(
      and(
        inArray(inventoryLotBalances.itemId, itemIds),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
}

export async function createStocktake(data: CreateStocktake) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const snapshotItems = (await getSnapshotItemsForScopeInTx(
      tx,
      data.scope,
      data.itemIds
    )) as SnapshotItem[];

    if (snapshotItems.length === 0) {
      throw new StocktakeError("No active items match this scope.", 400, {
        errors: {
          scope: ["Choose a scope that includes at least one active item"],
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

    const insertedLines = await tx.insert(stocktakeItems).values(
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

    const lotRows = await getSnapshotLotRowsInTx(
      tx,
      snapshotItems.map((item) => item.id)
    );
    const lineIdByItemId = new Map(
      insertedLines.map((line) => [line.itemId, line.id])
    );

    if (lotRows.length > 0) {
      await tx.insert(stocktakeLotItems).values(
        lotRows.flatMap((lotLine, index) => {
          const stocktakeItemId = lineIdByItemId.get(lotLine.itemId);
          if (!stocktakeItemId) {
            return [];
          }

          return {
            stocktakeItemId,
            lotId: lotLine.lotId,
            lotNumber: lotLine.lotNumber,
            expectedQty: normalizeNumeric(parseFloat(lotLine.expectedQty)),
            countedQty: null,
            varianceQty: null,
            appliedDeltaQty: null,
            receivedAt: lotLine.receivedAt,
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

    const existingLines = await getStocktakeLinesInTx(tx, id);
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));
    const lotLineMap = new Map(
      existingLines.flatMap((line) =>
        line.lots.map((lotLine) => [lotLine.id, { ...lotLine, parent: line }] as const)
      )
    );
    const affectedParentLineIds = new Set<string>();

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

      if (existingLine.lots.length > 1) {
        throw new StocktakeError("Count individual lots for this item.", 400, {
          errors: {
            lines: ["Count individual lots for this item."],
          },
        });
      }

      await tx
        .update(stocktakeItems)
        .set({
          countedQty,
          varianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, existingLine.id));

      if (existingLine.lots.length === 1) {
        const lotLine = existingLine.lots[0];
        await tx
          .update(stocktakeLotItems)
          .set({
            countedQty,
            varianceQty: getVariance(lotLine.expectedQty, countedQty),
            updatedAt: new Date(),
          })
          .where(eq(stocktakeLotItems.id, lotLine.id));
      }
    }

    for (const line of data.lotLines) {
      const existingLine = lotLineMap.get(line.lotLineId);

      if (!existingLine) {
        throw new StocktakeError("Stocktake lot line not found", 404, {
          errors: {
            lotLines: ["Refresh and try again."],
          },
        });
      }

      const countedQty = line.countedQty;
      const varianceQty = getVariance(existingLine.expectedQty, countedQty);

      await tx
        .update(stocktakeLotItems)
        .set({
          countedQty,
          varianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeLotItems.id, existingLine.id));

      affectedParentLineIds.add(existingLine.parent.id);
    }

    for (const parentLineId of affectedParentLineIds) {
      const parentLine = lineMap.get(parentLineId);
      if (!parentLine) continue;

      const countedLots = await tx
        .select({
          countedQty: trimScaleNullable(stocktakeLotItems.countedQty).as("countedQty"),
        })
        .from(stocktakeLotItems)
        .where(eq(stocktakeLotItems.stocktakeItemId, parentLineId));
      const countedValues = countedLots.flatMap((lotLine) =>
        lotLine.countedQty == null ? [] : [Number(lotLine.countedQty)]
      );
      const parentCountedQty =
        countedValues.length === 0
          ? null
          : normalizeNumeric(countedValues.reduce((sum, value) => sum + value, 0));

      await tx
        .update(stocktakeItems)
        .set({
          countedQty: parentCountedQty,
          varianceQty: getVariance(parentLine.expectedQty, parentCountedQty),
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, parentLineId));
    }

    await tx
      .update(stocktakes)
      .set({ updatedAt: new Date() })
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

    const existingLines = await getStocktakeLinesInTx(tx, id);
    const countedLotLines = existingLines.flatMap((line) =>
      line.lots
        .filter((lotLine) => lotLine.countedQty != null)
        .map((lotLine) => ({ ...lotLine, parent: line }))
    );
    const countedLotParentIds = new Set(
      countedLotLines.map((line) => line.parent.id)
    );
    const fullyCountedLotParentIds = new Set(
      existingLines
        .filter(
          (line) =>
            line.lots.length > 0 &&
            line.lots.every((lotLine) => lotLine.countedQty != null)
        )
        .map((line) => line.id)
    );
    const countedLines = existingLines.filter(
      (line) => line.countedQty != null && !countedLotParentIds.has(line.id)
    );

    if (countedLines.length === 0 && countedLotLines.length === 0) {
      throw new StocktakeError("Enter at least one count before completing.", 400);
    }

    await lockItemsInTx(
      tx,
      [...countedLines.map((line) => line.itemId), ...countedLotLines.map((line) => line.parent.itemId)]
    );

    const staleItems: StocktakeStaleWarningPayload["items"] = [];
    const currentQtyByItemId = new Map<string, string>();
    const location = await getDefaultInventoryLocationInTx(tx, orgId);
    const currentLotQtyByLotLineId = new Map<string, string>();
    const currentLotCostByLotLineId = new Map<string, string | null>();
    const totalDeltaByParentLineId = new Map<string, number>();

    for (const line of countedLines) {
      const currentQty = normalizeNumeric(
        await getCurrentAvailableOnHandQtyInTx(tx, line.itemId)
      );
      currentQtyByItemId.set(line.itemId, currentQty);

      if (currentQty !== normalizeNumeric(parseFloat(line.expectedQty))) {
        staleItems.push({
          lineId: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          unitName: line.unitName,
          expectedQty: normalizeNumeric(parseFloat(line.expectedQty)),
          currentQty,
          countedQty: line.countedQty ?? "0",
        });
      }
    }

    for (const line of existingLines.filter((line) =>
      fullyCountedLotParentIds.has(line.id)
    )) {
      const currentQty = normalizeNumeric(
        await getCurrentAvailableOnHandQtyInTx(tx, line.itemId)
      );
      currentQtyByItemId.set(line.itemId, currentQty);
      totalDeltaByParentLineId.set(
        line.id,
        Number(line.countedQty) - Number(currentQty)
      );

      if (currentQty !== normalizeNumeric(parseFloat(line.expectedQty))) {
        staleItems.push({
          lineId: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          unitName: line.unitName,
          expectedQty: normalizeNumeric(parseFloat(line.expectedQty)),
          currentQty,
          countedQty: line.countedQty ?? "0",
        });
      }
    }

    for (const line of countedLotLines) {
      const [currentLot] = await tx
        .select({
          quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
          unitCost: trimScaleNullable(inventoryLotBalances.unitCost).as("unitCost"),
        })
        .from(inventoryLotBalances)
        .where(
          and(
            eq(inventoryLotBalances.organizationId, orgId),
            eq(inventoryLotBalances.locationId, location.id),
            eq(inventoryLotBalances.itemId, line.parent.itemId),
            eq(inventoryLotBalances.lotId, line.lotId),
            eq(inventoryLotBalances.disposition, "available")
          )
        )
        .for("update");
      const currentQty = normalizeNumeric(parseFloat(currentLot?.quantity ?? "0"));
      currentLotQtyByLotLineId.set(line.id, currentQty);
      currentLotCostByLotLineId.set(line.id, currentLot?.unitCost ?? null);

      if (currentQty !== normalizeNumeric(parseFloat(line.expectedQty))) {
        staleItems.push({
          lineId: line.parent.id,
          lotLineId: line.id,
          itemId: line.parent.itemId,
          itemName: line.parent.itemName,
          lotNumber: line.lotNumber,
          unitName: line.parent.unitName,
          expectedQty: normalizeNumeric(parseFloat(line.expectedQty)),
          currentQty,
          countedQty: line.countedQty ?? "0",
        });
      }
    }

    if (staleItems.length > 0 && !confirmStale) {
      throw new StocktakeError("Stock changed since this stocktake started.", 409, {
        stale: { items: staleItems },
      });
    }

    if (countedLines.length > 0) {
      await reconcileStocktakeCountInTx(tx, {
        organizationId: orgId,
        stocktakeId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "complete-stocktake"
        ),
        lines: countedLines.map((line) => {
          const currentQty = currentQtyByItemId.get(line.itemId) ?? "0";
          return {
            stocktakeLineId: line.id,
            itemId: line.itemId,
            variance: Number(line.countedQty) - Number(currentQty),
          };
        }),
      });
    }

    const lotEventIds: string[] = [];
    const lotDeltaByParentLineId = new Map<string, number>();
    const now = new Date();
    for (const [index, line] of countedLotLines.entries()) {
      const currentQty = currentLotQtyByLotLineId.get(line.id) ?? "0";
      const delta = Number(line.countedQty) - Number(currentQty);
      lotDeltaByParentLineId.set(
        line.parent.id,
        (lotDeltaByParentLineId.get(line.parent.id) ?? 0) + delta
      );
      const idempotencyKey =
        index === 0
          ? deriveInventoryIdempotencyKey(options?.idempotencyKey, "complete-stocktake-lots")
          : null;

      if (delta > 0) {
        const unitCost =
          currentLotCostByLotLineId.get(line.id) ??
          (await resolvePositiveStockUnitCostInTx(tx, {
            itemId: line.parent.itemId,
            reason: "stocktake_cost_policy",
          }));
        const event = await appendPositiveStockToExistingLotInTx(tx, {
          organizationId: orgId,
          locationId: location.id,
          itemId: line.parent.itemId,
          lotId: line.lotId,
          quantity: delta,
          unitCost,
          eventType: "stocktake_gain",
          eventSubtype: "stocktake_complete",
          referenceType: "stocktake_line",
          referenceId: line.parent.id,
          actorUserId: userId,
          idempotencyKey,
          metadata: {
            stocktakeId: id,
            stocktakeLineId: line.parent.id,
            stocktakeLotLineId: line.id,
            lotId: line.lotId,
          },
        });
        lotEventIds.push(event.eventId);
      } else if (delta < 0) {
        const consumed = await consumeSpecificLotInTx(tx, {
          organizationId: orgId,
          locationId: location.id,
          itemId: line.parent.itemId,
          lotId: line.lotId,
          quantity: Math.abs(delta),
          eventType: "stocktake_loss",
          eventSubtype: "stocktake_complete",
          referenceType: "stocktake_line",
          referenceId: line.parent.id,
          actorUserId: userId,
          idempotencyKey,
          metadata: {
            stocktakeId: id,
            stocktakeLineId: line.parent.id,
            stocktakeLotLineId: line.id,
            lotId: line.lotId,
          },
        });
        lotEventIds.push(...consumed.eventIds);
      } else {
        const [event] = await tx
          .insert(inventoryEvents)
          .values({
            organizationId: orgId,
            locationId: location.id,
            eventType: "stocktake_verification",
            itemId: line.parent.itemId,
            quantity: "0",
            referenceType: "stocktake_line",
            referenceId: line.parent.id,
            actorUserId: userId,
            idempotencyKey,
            occurredAt: now,
            metadata: {
              stocktakeId: id,
              stocktakeLineId: line.parent.id,
              stocktakeLotLineId: line.id,
              lotId: line.lotId,
            },
          })
          .returning({ id: inventoryEvents.id });
        lotEventIds.push(event.id);
      }

      await applyItemBalanceDeltasInTx(tx, [
        {
          organizationId: orgId,
          locationId: location.id,
          itemId: line.parent.itemId,
          lastVerifiedAt: now,
        },
      ]);
    }

    const residualLines = Array.from(totalDeltaByParentLineId.entries()).flatMap(
      ([parentLineId, totalDelta]) => {
        const parentLine = existingLines.find((line) => line.id === parentLineId);
        if (!parentLine) {
          return [];
        }

        const lotDelta = lotDeltaByParentLineId.get(parentLineId) ?? 0;
        const residualDelta = Number(normalizeNumeric(totalDelta - lotDelta));

        if (residualDelta === 0) {
          return [];
        }

        return {
          stocktakeLineId: parentLine.id,
          itemId: parentLine.itemId,
          variance: residualDelta,
        };
      }
    );

    if (residualLines.length > 0) {
      await reconcileStocktakeCountInTx(tx, {
        organizationId: orgId,
        stocktakeId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "complete-stocktake-lot-residual"
        ),
        lines: residualLines,
      });
    }

    for (const line of countedLines) {
      const currentQty = currentQtyByItemId.get(line.itemId) ?? "0";
      const delta = Number(line.countedQty) - Number(currentQty);
      const normalizedVariance = getVariance(line.expectedQty, line.countedQty);
      const normalizedDelta = normalizeNumeric(delta);

      await tx
        .update(stocktakeItems)
        .set({
          varianceQty: normalizedVariance,
          appliedDeltaQty: normalizedDelta,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, line.id));
    }

    for (const line of countedLotLines) {
      const currentQty = currentLotQtyByLotLineId.get(line.id) ?? "0";
      const delta = Number(line.countedQty) - Number(currentQty);
      const normalizedVariance = getVariance(line.expectedQty, line.countedQty);
      const normalizedDelta = normalizeNumeric(delta);

      await tx
        .update(stocktakeLotItems)
        .set({
          varianceQty: normalizedVariance,
          appliedDeltaQty: normalizedDelta,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeLotItems.id, line.id));
    }

    const countedLotParents = new Map<string, typeof countedLotLines>();
    for (const line of countedLotLines) {
      const bucket = countedLotParents.get(line.parent.id) ?? [];
      bucket.push(line);
      countedLotParents.set(line.parent.id, bucket);
    }

    for (const [parentLineId, lotLines] of countedLotParents) {
      const appliedDeltaQty = normalizeNumeric(
        totalDeltaByParentLineId.get(parentLineId) ??
          lotLines.reduce((sum, line) => {
            const currentQty = currentLotQtyByLotLineId.get(line.id) ?? "0";
            return sum + Number(line.countedQty) - Number(currentQty);
          }, 0)
      );

      await tx
        .update(stocktakeItems)
        .set({
          appliedDeltaQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, parentLineId));
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

export async function cancelStocktake(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const stocktake = await getLockedStocktakeInTx(tx, id);

    if (!stocktake) {
      return null;
    }

    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be cancelled.", 400);
    }

    await tx
      .update(stocktakes)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stocktakes.id, id));

    return { id };
  });
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

    const cloned = await createStocktake({
      name: `${source.name} Copy`,
      scope: source.scope as StocktakeScope,
      notes: null,
      itemIds: sourceLines.map((line) => line.itemId),
    });

    return cloned;
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
        error: "Only draft stocktakes can be deleted.",
      };
    }

    if (rows.length === 0) {
      return { deletedCount: 0 };
    }

    const rowIds = rows.map((r) => r.id);
    const cancelledAt = new Date();

    await tx
      .update(stocktakes)
      .set({ status: "cancelled", cancelledAt, updatedAt: cancelledAt })
      .where(inArray(stocktakes.id, rowIds));

    return { deletedCount: rows.length };
  });
}
