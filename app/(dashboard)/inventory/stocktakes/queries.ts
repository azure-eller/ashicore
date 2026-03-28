import { NextResponse } from "next/server";
import { normalizeNumeric } from "@/lib/format";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  items,
  lots,
  stocktakeItems,
  stocktakes,
  unitDefinitions,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyStockDeltaInTx,
  getCurrentStockInTx,
  lockItemsInTx,
  MissingStockCostError,
} from "@/lib/inventory/stock";
import type {
  CompleteStocktake,
  InsertStocktake,
  StocktakeScope,
  UpdateStocktakeCounts,
} from "@/lib/schemas/stocktakes";
import type {
  StocktakeDetail,
  StocktakeDetailLine,
  StocktakeListRow,
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

export class StocktakeError extends Error {
  status: number;
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
    super(message);
    this.name = "StocktakeError";
    this.status = status;
    this.errors = options?.errors;
    this.stale = options?.stale;
  }

  toResponse() {
    const body = this.stale
      ? { error: this.message, stale: this.stale }
      : this.errors
        ? { errors: this.errors }
        : { error: this.message };

    return NextResponse.json(body, { status: this.status });
  }
}


function getVariance(expectedQty: string, countedQty: string | null) {
  if (countedQty == null) {
    return null;
  }

  return normalizeNumeric(Number(countedQty) - parseFloat(expectedQty));
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
      expectedQty: stocktakeItems.expectedQty,
      countedQty: stocktakeItems.countedQty,
      varianceQty: stocktakeItems.varianceQty,
      appliedDeltaQty: stocktakeItems.appliedDeltaQty,
      sortOrder: stocktakeItems.sortOrder,
      createdAt: stocktakeItems.createdAt,
      updatedAt: stocktakeItems.updatedAt,
    })
    .from(stocktakeItems)
    .where(eq(stocktakeItems.stocktakeId, stocktakeId))
    .orderBy(asc(stocktakeItems.sortOrder), asc(stocktakeItems.createdAt));

  return rows as StocktakeDetailLine[];
}

async function getSnapshotItemsForScopeInTx(tx: Tx, scope: StocktakeScope) {
  const conditions = [isNull(items.deletedAt)];

  if (scope !== "all") {
    conditions.push(eq(items.itemType, scope));
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
      currentQty: sql<string>`(
        SELECT COALESCE(SUM(${lots.quantity}), 0)
        FROM ${lots}
        WHERE ${lots.itemId} = ${items.id}
      )`,
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
      .orderBy(desc(stocktakes.createdAt));

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

export async function createStocktake(data: InsertStocktake) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const snapshotItems = (await getSnapshotItemsForScopeInTx(
      tx,
      data.scope
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

    await tx.insert(stocktakeItems).values(
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
    );

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
          countedQty,
          varianceQty,
          updatedAt: new Date(),
        })
        .where(eq(stocktakeItems.id, existingLine.id));
    }

    await tx
      .update(stocktakes)
      .set({ updatedAt: new Date() })
      .where(eq(stocktakes.id, id));

    return { id };
  });
}

export async function completeStocktake(id: string, confirmStale: CompleteStocktake["confirmStale"]) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const stocktake = await getLockedStocktakeInTx(tx, id);

    if (!stocktake) {
      return null;
    }

    if (stocktake.status !== "draft") {
      throw new StocktakeError("Only draft stocktakes can be completed.", 400);
    }

    const existingLines = await getStocktakeLinesInTx(tx, id);
    const countedLines = existingLines.filter((line) => line.countedQty != null);

    if (countedLines.length === 0) {
      throw new StocktakeError("Enter at least one count before completing.", 400);
    }

    await lockItemsInTx(
      tx,
      countedLines.map((line) => line.itemId)
    );

    const staleItems: StocktakeStaleWarningPayload["items"] = [];
    const currentQtyByItemId = new Map<string, string>();

    for (const line of countedLines) {
      const currentQty = normalizeNumeric(
        await getCurrentStockInTx(tx, line.itemId)
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

    if (staleItems.length > 0 && !confirmStale) {
      throw new StocktakeError("Stock changed since this stocktake started.", 409, {
        stale: { items: staleItems },
      });
    }

    try {
      for (const line of countedLines) {
        const currentQty = currentQtyByItemId.get(line.itemId) ?? "0";
        const delta = Number(line.countedQty) - Number(currentQty);
        const normalizedVariance = getVariance(line.expectedQty, line.countedQty);
        const normalizedDelta = normalizeNumeric(delta);

        if (delta !== 0) {
          await applyStockDeltaInTx(tx, {
            orgId,
            userId,
            itemId: line.itemId,
            delta,
            movementType: "stocktake_adjustment",
            referenceType: "stocktake",
            referenceId: id,
          });
        }

        await tx
          .update(stocktakeItems)
          .set({
            varianceQty: normalizedVariance,
            appliedDeltaQty: normalizedDelta,
            updatedAt: new Date(),
          })
          .where(eq(stocktakeItems.id, line.id));
      }
    } catch (error) {
      if (error instanceof MissingStockCostError) {
        throw new StocktakeError(error.message, 400);
      }

      throw error;
    }

    await tx
      .update(stocktakes)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stocktakes.id, id));

    return { id };
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
