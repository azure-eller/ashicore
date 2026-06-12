import { and, eq, inArray, sql } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { jsonError, jsonNotFound } from "@/lib/api/responses";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  inventoryLotBalances,
  items,
  lots,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { roundQuantity } from "@/lib/format";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  getDefaultInventoryLocationInTx,
  getExistingDefaultInventoryLocationInTx,
  resolveInventoryLocationInTx,
} from "@/lib/inventory/kernel/locations";
import { readInventoryIdempotencyReplayInTx } from "@/lib/inventory/kernel/idempotency";
import { reconcilePhysicalInventoryCountInTx } from "@/lib/inventory/kernel/operations/stocktakes";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type {
  StockAdjustmentInput,
  StockAdjustmentLotInput,
} from "@/lib/schemas/stock-adjustments";

export async function adjustItemStock(
  itemId: string,
  input: StockAdjustmentInput,
  options: { idempotencyKey: string; allowDefaultLocationCreate?: boolean }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const idempotencyPayload = buildAdjustmentIdempotencyPayload(itemId, input);
    const replay = await readInventoryIdempotencyReplayInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options.idempotencyKey,
      operationName: "reconcilePhysicalInventoryCount",
      payload: idempotencyPayload,
    });
    if (replay) {
      return { ok: true } as const;
    }

    await lockItemsInTx(tx, [itemId]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, itemId));

    if (!item || item.deletedAt != null) {
      return jsonNotFound("Item not found");
    }

    const location = input.locationId
      ? await resolveInventoryLocationInTx(tx, orgId, input.locationId)
      : options.allowDefaultLocationCreate === false
        ? await getExistingDefaultInventoryLocationInTx(tx, orgId)
        : await getDefaultInventoryLocationInTx(tx, orgId);
    if (!location) {
      return jsonError("Default inventory location not found.", 400);
    }
    const lotTrackingMode = await getItemLotTrackingModeInTx(tx, itemId);

    if (lotTrackingMode === "tracked") {
      return adjustLotTrackedStock(tx, {
        itemId,
        orgId,
        userId,
        locationId: location.id,
        idempotencyKey: options.idempotencyKey,
        idempotencyPayload,
        input,
      });
    }

    if (input.newQuantity == null) {
      return jsonError("A new quantity is required.", 400);
    }

    const [current] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.locationId, location.id),
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.disposition, "available")
        )
      );

    const delta = roundQuantity(Number(input.newQuantity) - Number(current?.quantity ?? "0"));
    await reconcilePhysicalInventoryCountInTx(tx, {
      organizationId: orgId,
      locationId: location.id,
      source: { kind: "manual_adjustment" },
      reason: input.reason,
      note: input.note ?? null,
      actorUserId: userId,
      idempotencyKey: options.idempotencyKey,
      idempotencyPayload,
      lines: [
        {
          referenceId: itemId,
          itemId,
          variance: delta,
        },
      ],
    });

    return { ok: true } as const;
  });
}

async function adjustLotTrackedStock(
  tx: Tx,
  params: {
    itemId: string;
    orgId: string;
    userId: string;
    locationId: string;
    idempotencyKey: string;
    idempotencyPayload: Record<string, unknown>;
    input: StockAdjustmentInput;
  }
) {
  const validationError = await validateStockAdjustmentLotsInTx(tx, {
    orgId: params.orgId,
    itemId: params.itemId,
    lots: params.input.lots,
  });
  if (validationError) {
    return validationError;
  }
  const adjustLots = params.input.lots!;

  const balanceRows = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.orgId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .groupBy(inventoryLotBalances.lotId);

  const balanceMap = new Map<string, number>();
  for (const row of balanceRows) {
    if (row.lotId) {
      balanceMap.set(row.lotId, Number(row.quantity));
    }
  }

  const unmappedLotIds = adjustLots
    .map((lot) => lot.lotId)
    .filter((lotId): lotId is string => !!lotId && !balanceMap.has(lotId));
  if (unmappedLotIds.length > 0) {
    const knownLots = await tx
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, params.orgId),
          eq(lots.itemId, params.itemId),
          inArray(lots.id, unmappedLotIds)
        )
      );
    const knownLotIds = new Set(knownLots.map((row) => row.id));
    const missing = unmappedLotIds.find((lotId) => !knownLotIds.has(lotId));
    if (missing) {
      return jsonNotFound("Lot not found for this item");
    }
  }

  const lines = adjustLots
    .map((lot) => toAdjustmentLine(params.itemId, balanceMap, lot))
    .filter((line) => line.variance !== 0);

  // Counting existing lots is free; recording a newly discovered lot is a
  // lot-tracking workflow (same boundary as stocktake found lots).
  if (lines.some((line) => line.lotId == null)) {
    await assertFeatureAccessInTx(tx, params.orgId, "lot_tracking", {
      route: "POST /api/items/[id]/stock-adjustments",
    });
  }

  await reconcilePhysicalInventoryCountInTx(tx, {
    organizationId: params.orgId,
    locationId: params.locationId,
    source: { kind: "manual_adjustment" },
    reason: params.input.reason,
    note: params.input.note ?? null,
    actorUserId: params.userId,
    idempotencyKey: params.idempotencyKey,
    idempotencyPayload: params.idempotencyPayload,
    lines,
  });

  return { ok: true } as const;
}

export async function validateStockAdjustmentLotsInTx(
  tx: Tx,
  params: {
    orgId: string;
    itemId: string;
    lots: StockAdjustmentLotInput[] | undefined;
  }
): Promise<NextResponse | null> {
  const adjustLots = params.lots;
  if (!adjustLots || adjustLots.length === 0) {
    return jsonError("At least one lot is required.", 400);
  }

  for (const lot of adjustLots) {
    if (!lot.lotId && !lot.lotNumber) {
      return jsonError("New lots require a lot number.", 400);
    }
  }

  const newLotNumbers = adjustLots
    .filter((lot) => !lot.lotId && lot.lotNumber)
    .map((lot) => lot.lotNumber as string);
  const duplicateRequestLotNumber = newLotNumbers.find(
    (lotNumber, index) => newLotNumbers.indexOf(lotNumber) !== index
  );
  if (duplicateRequestLotNumber) {
    return jsonError(
      `Lot ${duplicateRequestLotNumber} was submitted more than once.`,
      400
    );
  }

  const existingLotIds = adjustLots
    .map((lot) => lot.lotId)
    .filter((lotId): lotId is string => Boolean(lotId));
  const duplicateRequestLotId = existingLotIds.find(
    (lotId, index) => existingLotIds.indexOf(lotId) !== index
  );
  if (duplicateRequestLotId) {
    return jsonError("A lot was submitted more than once.", 400);
  }

  if (newLotNumbers.length > 0) {
    const existingNumberRows = await tx
      .select({ lotNumber: lots.lotNumber })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, params.orgId),
          eq(lots.itemId, params.itemId),
          inArray(lots.lotNumber, newLotNumbers)
        )
      );
    if (existingNumberRows.length > 0) {
      return jsonError(
        `Lot ${existingNumberRows[0].lotNumber} already exists for this item — count it as the listed lot.`,
        400
      );
    }
  }

  return null;
}

function buildAdjustmentIdempotencyPayload(
  itemId: string,
  input: StockAdjustmentInput
) {
  return {
    source: { kind: "manual_adjustment" },
    itemId,
    locationId: input.locationId ?? null,
    reason: input.reason,
    note: input.note ?? null,
    newQuantity: input.newQuantity ?? null,
    lots:
      input.lots?.map((lot) => ({
        lotId: lot.lotId ?? null,
        lotNumber: lot.lotNumber ?? null,
        newQuantity: lot.newQuantity,
      })) ?? null,
  };
}

function toAdjustmentLine(
  itemId: string,
  balanceMap: Map<string, number>,
  lot: StockAdjustmentLotInput
) {
  const nextQuantity = Number(lot.newQuantity);
  const currentQuantity = lot.lotId ? balanceMap.get(lot.lotId) ?? 0 : 0;

  return {
    referenceId: itemId,
    itemId,
    lotId: lot.lotId ?? null,
    foundLotNumber: lot.lotNumber ?? null,
    variance: roundQuantity(nextQuantity - currentQuantity),
  };
}
