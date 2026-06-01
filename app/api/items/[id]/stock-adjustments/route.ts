import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { jsonError, jsonNotFound } from "@/lib/api/responses";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { inventoryLotBalances, items, lots } from "@/lib/db/schema";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel/operations/common";
import {
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  seedOpeningBalanceInTx,
} from "@/lib/inventory/kernel/operations/inventory";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import {
  appendPositiveStockToExistingLotInTx,
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  decrementExistingLotStockInTx,
  resolvePositiveStockUnitCostInTx,
} from "@/lib/inventory/kernel/operations/stock-core";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type { Tx } from "@/lib/db/with-org-context";
import { roundQuantity } from "@/lib/format";
import {
  isNonNegativeNumberString,
  nonNegativeDecimalString,
  nullableString,
  positiveDecimalString,
} from "@/lib/schemas/shared";

const adjustLotSchema = z.object({
  lotId: z.string().uuid().optional(),
  lotNumber: z.string().trim().min(1).max(20).optional(),
  newQuantity: z.string().regex(/^\d+(\.\d+)?$/),
});

const stockAdjustmentSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required."),
  note: z.string().trim().max(500).optional(),
  newQuantity: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  lots: z.array(adjustLotSchema).optional(),
});

const addInitialStockSchema = z.object({
  quantity: positiveDecimalString("Quantity"),
  costPerUnit: nullableString.refine(
    (value) => value == null || isNonNegativeNumberString(value),
    "Cost per unit must be zero or greater",
  ),
  occurredAt: z.string().datetime(),
  note: nullableString,
});

const setItemStockSchema = z.object({
  quantity: nonNegativeDecimalString("Quantity"),
  note: nullableString,
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const raw = await request.json();

  // Discriminate on the presence of the `reason` KEY (not its non-emptiness):
  // - reason present -> NEW adjustment-with-reason flow; the schema enforces a
  //   non-empty reason so a blank/whitespace reason still 400s here.
  // - reason absent  -> LEGACY add-initial-stock flow (production web caller
  //   `addInitialStock` in lib/api/clients/item-cards.ts), behavior unchanged.
  if (raw && typeof raw === "object" && "reason" in raw) {
    return adjustStockWithReason(request, id, raw);
  }
  return addInitialStock(request, id, raw);
});

async function adjustStockWithReason(request: Request, id: string, raw: unknown) {
  const idempotencyKey = requireIdempotencyKey(request, "adjustStock");
  const input = stockAdjustmentSchema.parse(raw);

  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [id]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id));

    if (!item || item.deletedAt != null) {
      return jsonNotFound("Item not found");
    }

    const lotTrackingMode = await getItemLotTrackingModeInTx(tx, id);

    const reason = input.reason;
    const note = input.note;
    const metadata: Record<string, unknown> = {
      reason,
      ...(note ? { note } : {}),
    };

    const location = await getDefaultInventoryLocationInTx(tx, orgId);

    if (lotTrackingMode === "tracked") {
      return adjustLotTrackedStock(tx, {
        itemId: id,
        orgId,
        userId,
        locationId: location.id,
        idempotencyKey,
        reason,
        note: note ?? null,
        metadata,
        lots: input.lots,
      });
    }

    if (input.newQuantity == null) {
      return jsonError("A new quantity is required.", 400);
    }

    // Mirror the PUT (set-item-stock) handler's current-quantity read: sum the
    // raw available lot balances, which is SIGNED and can be negative when the
    // item is in stock debt. The "set new on-hand" contract requires diffing
    // against the signed current, not the clamped available-on-hand projection.
    const [current] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.locationId, location.id),
          eq(inventoryLotBalances.itemId, id),
          eq(inventoryLotBalances.disposition, "available"),
        ),
      );

    const currentQuantity = Number(current?.quantity ?? "0");
    const nextQuantity = Number(input.newQuantity);
    const delta = roundQuantity(nextQuantity - currentQuantity);

    if (delta === 0) {
      return { ok: true };
    }

    // Wrap the mutation in the same idempotency envelope the other branches in
    // this file use (addInitialStock / PUT). Without it, a retried or reused
    // Idempotency-Key trips inventory_events_idempotency_key_uidx and 500s
    // instead of replaying the original result.
    const replay = await beginInventoryOperationInTx<{ ok: true }>(tx, {
      organizationId: orgId,
      operationName: "adjustStock",
      idempotencyKey,
      payload: {
        itemId: id,
        newQuantity: input.newQuantity,
        delta,
        reason,
        note: note ?? null,
      },
    });

    if (replay.replayed) {
      return replay.result;
    }

    let firstEventId: string | null = null;

    if (delta > 0) {
      // A manual positive adjustment is economically the same as a stocktake
      // found-gain, so it must cost identically: resolve the item's unit cost
      // via the shared policy instead of writing a zero-cost event that would
      // understate downstream FIFO COGS.
      const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
        itemId: id,
        reason: "stocktake_cost_policy",
      });
      const created = await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId: id,
        quantity: delta,
        unitCost,
        eventType: "manual_adjustment_increase",
        actorUserId: userId,
        idempotencyKey,
        metadata,
      });
      firstEventId = created.eventId;
    } else {
      const consumed = await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId: id,
        quantity: -delta,
        eventType: "manual_adjustment_decrease",
        actorUserId: userId,
        idempotencyKey,
        allowNegativeStock: true,
        metadata,
      });
      // Untracked consume returns a single `eventId`; lot-tracked/FIFO returns
      // `eventIds`. This route only reaches here for untracked items, but accept
      // either shape so the idempotency claim always records a first event id.
      const consumedResult = consumed as {
        eventId?: string;
        eventIds?: string[];
      };
      firstEventId =
        consumedResult.eventIds?.[0] ?? consumedResult.eventId ?? null;
    }

    const result = { ok: true } as const;

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey,
      firstEventId,
      result,
    });

    return result;
  });

  if (result instanceof NextResponse) return result;
  return NextResponse.json(result);
}

type AdjustLot = z.infer<typeof adjustLotSchema>;

// Per-lot adjustment for lot-tracked items. Runs inside the same idempotency
// envelope the non-lot branch uses (begin -> kernel events -> finish). The
// caller has already read the lot-tracking mode, resolved the default location,
// and built the shared reason/note metadata. Mirrors stocktake reconcile: each
// `lots` entry sets a per-lot target on-hand by diffing against the current
// per-lot balance; existing lots increment/decrement, new lots are created from
// an operator-supplied lot number.
async function adjustLotTrackedStock(
  tx: Tx,
  params: {
    itemId: string;
    orgId: string;
    userId: string;
    locationId: string;
    idempotencyKey: string;
    reason: string;
    note: string | null;
    metadata: Record<string, unknown>;
    lots: AdjustLot[] | undefined;
  }
) {
  const {
    itemId,
    orgId,
    userId,
    locationId,
    idempotencyKey,
    reason,
    note,
    metadata,
  } = params;

  const adjustLots = params.lots;
  if (!adjustLots || adjustLots.length === 0) {
    return jsonError("At least one lot is required.", 400);
  }

  // New lots with no lot number cannot be created; reject before any mutation.
  for (const lot of adjustLots) {
    if (!lot.lotId && !lot.lotNumber) {
      return jsonError("New lots require a lot number.", 400);
    }
  }

  // Read every existing per-lot available balance once for this org+item at the
  // default location, grouped by lotId (mirrors the PUT SUM read, grouped).
  const balanceRows = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      // Capture the lot's stored unit cost so an existing-lot increase can
      // preserve it (weighted-average no-op) rather than diluting toward zero.
      unitCost: sql<
        string | null
      >`MAX(${inventoryLotBalances.unitCost})`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        eq(inventoryLotBalances.locationId, locationId),
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, "available"),
      ),
    )
    .groupBy(inventoryLotBalances.lotId);

  const balanceMap = new Map<string, number>();
  const lotUnitCostMap = new Map<string, string | null>();
  for (const row of balanceRows) {
    if (row.lotId) {
      balanceMap.set(row.lotId, Number(row.quantity));
      lotUnitCostMap.set(row.lotId, row.unitCost ?? null);
    }
  }

  // Existence pre-check: a supplied lotId might reference a real lot for this
  // item that simply has no available balance row yet (so it is absent from the
  // balanceMap). Verify any such lotId really belongs to this item before the
  // kernel runs; an unknown/foreign lotId otherwise reaches the kernel's
  // FOR UPDATE select and throws a bare 500. Resolve those to a clean 404.
  const unmappedLotIds = adjustLots
    .map((lot) => lot.lotId)
    .filter((lotId): lotId is string => !!lotId && !balanceMap.has(lotId));
  if (unmappedLotIds.length > 0) {
    const knownLots = await tx
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, orgId),
          eq(lots.itemId, itemId),
          inArray(lots.id, unmappedLotIds),
        ),
      );
    const knownLotIds = new Set(knownLots.map((row) => row.id));
    const missing = unmappedLotIds.find((lotId) => !knownLotIds.has(lotId));
    if (missing) {
      return jsonNotFound("Lot not found for this item");
    }
  }

  const replay = await beginInventoryOperationInTx<{ ok: true }>(tx, {
    organizationId: orgId,
    operationName: "adjustStock",
    idempotencyKey,
    payload: {
      itemId,
      reason,
      note,
      lots: adjustLots,
    },
  });

  if (replay.replayed) {
    return replay.result;
  }

  // Mirror stocktake reconcile: the request idempotency key may be claimed by
  // exactly one inventory event. Pass it only to the FIRST kernel call that
  // actually fires; omit on the rest so retried multi-event ops don't collide
  // on inventory_events_idempotency_key_uidx.
  let firstEventId: string | null = null;
  const keyForNextEvent = () => (firstEventId === null ? idempotencyKey : null);

  for (const lot of adjustLots) {
    const nextQuantity = Number(lot.newQuantity);

    if (lot.lotId) {
      const current = balanceMap.get(lot.lotId) ?? 0;
      const delta = roundQuantity(nextQuantity - current);
      if (delta === 0) continue;

      if (delta > 0) {
        // "I miscounted this lot, add the missing units": reuse the lot's own
        // stored unit cost so the weighted-average append is a no-op and the
        // lot's cost is not diluted toward zero. If the lot has no stored cost,
        // fall back to the shared positive-stock cost policy.
        const existingLotUnitCost = lotUnitCostMap.get(lot.lotId) ?? null;
        const unitCost =
          existingLotUnitCost ??
          (await resolvePositiveStockUnitCostInTx(tx, {
            itemId,
            reason: "stocktake_cost_policy",
          }));
        const created = await appendPositiveStockToExistingLotInTx(tx, {
          organizationId: orgId,
          locationId,
          itemId,
          lotId: lot.lotId,
          quantity: delta,
          unitCost,
          eventType: "manual_adjustment_increase",
          actorUserId: userId,
          idempotencyKey: keyForNextEvent(),
          metadata,
        });
        firstEventId = firstEventId ?? created.eventId;
      } else {
        const consumed = await decrementExistingLotStockInTx(tx, {
          organizationId: orgId,
          locationId,
          itemId,
          lotId: lot.lotId,
          quantity: -delta,
          eventType: "manual_adjustment_decrease",
          actorUserId: userId,
          idempotencyKey: keyForNextEvent(),
          metadata,
        });
        firstEventId = firstEventId ?? consumed.eventId;
      }
      continue;
    }

    // New lot: a zeroed new lot is dropped (nothing to create).
    if (nextQuantity <= 0) continue;

    // A found/new lot is the same economic event as a stocktake new-lot gain:
    // resolve the item's unit cost via the shared policy rather than zero.
    const newLotUnitCost = await resolvePositiveStockUnitCostInTx(tx, {
      itemId,
      reason: "stocktake_cost_policy",
    });
    const created = await createPositiveStockEventInTx(tx, {
      organizationId: orgId,
      locationId,
      itemId,
      quantity: nextQuantity,
      unitCost: newLotUnitCost,
      eventType: "manual_adjustment_increase",
      actorUserId: userId,
      idempotencyKey: keyForNextEvent(),
      lotNumber: lot.lotNumber,
      metadata,
    });
    firstEventId = firstEventId ?? created.eventId;
  }

  const result = { ok: true } as const;

  await finishInventoryOperationInTx(tx, {
    organizationId: orgId,
    idempotencyKey,
    firstEventId,
    result,
  });

  return result;
}

async function addInitialStock(request: Request, id: string, raw: unknown) {
  const idempotencyKey = requireIdempotencyKey(request, "addInitialStock");
  const input = addInitialStockSchema.parse(raw);

  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [id]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id));

    if (!item || item.deletedAt != null) {
      return jsonNotFound("Item not found");
    }

    const [positiveLot] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.itemId, id),
          sql`${inventoryLotBalances.quantity} > 0`,
        ),
      );

    const occurredAt = new Date(input.occurredAt);

    if ((positiveLot?.count ?? 0) === 0) {
      const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
        itemId: id,
        explicitUnitCost: input.costPerUnit,
        reason: "opening_cost_required",
      });
      return seedOpeningBalanceInTx(tx, {
        organizationId: orgId,
        itemId: id,
        quantity: Number(input.quantity),
        unitCost,
        actorUserId: userId,
        idempotencyKey,
        receivedAt: occurredAt,
      });
    }

    return manualIncreaseStockInTx(tx, {
      organizationId: orgId,
      itemId: id,
      quantity: Number(input.quantity),
      unitCost: input.costPerUnit,
      note: input.note,
      actorUserId: userId,
      idempotencyKey,
      occurredAt,
    });
  });

  if (result instanceof NextResponse) return result;
  return NextResponse.json(result);
}

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "setItemStockQuantity");
  const { id } = await (ctx as RouteContext).params;
  const input = setItemStockSchema.parse(await request.json());

  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [id]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id));

    if (!item || item.deletedAt != null) {
      return jsonNotFound("Item not found");
    }

    const lotTrackingMode = await getItemLotTrackingModeInTx(tx, id);
    if (lotTrackingMode !== "untracked") {
      return NextResponse.json(
        { error: "Set item quantity is only available for untracked items." },
        { status: 409 }
      );
    }

    const location = await getDefaultInventoryLocationInTx(tx, orgId);
    const [current] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.locationId, location.id),
          eq(inventoryLotBalances.itemId, id),
          eq(inventoryLotBalances.disposition, "available"),
        ),
      );

    const currentQuantity = Number(current?.quantity ?? "0");
    const nextQuantity = Number(input.quantity);
    const delta = nextQuantity - currentQuantity;

    if (delta === 0) {
      return { quantity: input.quantity };
    }

    if (delta > 0) {
      return manualIncreaseStockInTx(tx, {
        organizationId: orgId,
        itemId: id,
        quantity: delta,
        note: input.note,
        actorUserId: userId,
        idempotencyKey: `${idempotencyKey}:increase`,
      });
    }

    return manualDecreaseStockInTx(tx, {
      organizationId: orgId,
      itemId: id,
      quantity: Math.abs(delta),
      note: input.note,
      actorUserId: userId,
      idempotencyKey: `${idempotencyKey}:decrease`,
    });
  });

  if (result instanceof NextResponse) return result;
  return NextResponse.json(result);
});
