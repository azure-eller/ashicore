import { and, desc, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { normalizeNumericScale } from "../../../lib/format";
import {
  inventoryEvents,
  inventoryEventAdjustmentReasons,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  lots,
} from "../../../lib/db/schema";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  resolvePositiveStockUnitCostInTx,
} from "../../../lib/inventory/kernel";
import { getDefaultInventoryLocationInTx } from "../../../lib/inventory/kernel/locations";
import { createItem, getOrgId, getUnitId, testFetch } from "../../helpers/api";

async function getAdjustmentReason(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  eventId: string
) {
  const [row] = await db
    .select({
      reason: inventoryEventAdjustmentReasons.reason,
      note: inventoryEventAdjustmentReasons.note,
    })
    .from(inventoryEventAdjustmentReasons)
    .where(eq(inventoryEventAdjustmentReasons.inventoryEventId, eventId));
  return row;
}

test.describe("non-lot stock adjustment route", () => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  async function createUntrackedMaterialWithStock(
    db: Parameters<Parameters<typeof test>[2]>[0]["db"],
    {
      name,
      sku,
      category,
      stock,
    }: { name: string; sku: string; category: string; stock: number }
  ) {
    const item = await createItem({
      itemType: "material",
      name,
      unitDefinitionId: unitId,
      sku,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        family: {
          name,
          category,
          description: null,
          unitDefinitionId: unitId,
          lotTrackingMode: "untracked",
        },
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    if (stock > 0) {
      const location = await db.transaction((tx) =>
        getDefaultInventoryLocationInTx(tx, orgId)
      );

      await db.transaction(async (tx) => {
        await createPositiveStockEventInTx(tx, {
          organizationId: orgId,
          locationId: location.id,
          itemId,
          quantity: stock,
          unitCost: "2.00",
          eventType: "manual_adjustment_increase",
          eventSubtype: "stock_adjustment_route_seed",
          referenceType: "item",
          referenceId: itemId,
        });
      });
    }

    return itemId;
  }

  test("non-lot adjustment sets new on-hand and records reason", async ({
    db,
  }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Reason ${ts}`,
      sku: `STOCK-ADJ-REASON-${ts}`,
      category: `Stock Adjust ${ts}`,
      stock: 5,
    });
    const itemListResponse = await testFetch("/api/items?itemType=material");
    expect(itemListResponse.status, await itemListResponse.text()).toBe(200);
    const itemList = (await itemListResponse.json()) as Array<{
      id: string;
      lotTrackingMode?: string;
    }>;
    expect(itemList.find((item) => item.id === itemId)?.lotTrackingMode).toBe(
      "untracked"
    );

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "damaged_spoiled",
        note: "spill",
        newQuantity: "2",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));

    expect(event).toBeTruthy();
    expect(event.eventType).toBe("manual_adjustment_decrease");
    await expect(getAdjustmentReason(db, event.id)).resolves.toMatchObject({
      reason: "damaged_spoiled",
      note: "spill",
    });

    const [itemBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.onHandQty).toBe("2.0000");
  });

  test("adjustment increases on-hand and records reason", async ({ db }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Increase ${ts}`,
      sku: `STOCK-ADJ-INCREASE-${ts}`,
      category: `Stock Adjust Increase ${ts}`,
      stock: 5,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "found_stock",
        newQuantity: "9",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));

    expect(event).toBeTruthy();
    expect(event.quantity).toBe("4.0000");
    await expect(getAdjustmentReason(db, event.id)).resolves.toMatchObject({
      reason: "found_stock",
    });

    // The non-lot increase branch must cost like a stocktake gain too: resolve
    // the item's unit cost instead of writing a zero-cost event. Normalize to
    // the scale-6 unit_cost column the event is stored against.
    const resolvedCost = normalizeNumericScale(
      Number.parseFloat(
        await db.transaction((tx) =>
          resolvePositiveStockUnitCostInTx(tx, {
            itemId,
            reason: "stocktake_cost_policy",
          })
        )
      ),
      6
    );
    expect(resolvedCost).not.toBe("0.000000");
    expect(event.unitCost).not.toBe("0.000000");
    expect(event.unitCost).toBe("2.000000");
    expect(Number.parseFloat(event.unitCost!)).toBe(
      Number.parseFloat(resolvedCost)
    );

    const [itemBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.onHandQty).toBe("9.0000");
  });

  test("generic reconciliation preview reports current counted and variance", async ({
    db,
  }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Reconcile Preview ${ts}`,
      sku: `STOCK-RECONCILE-PREVIEW-${ts}`,
      category: `Stock Reconcile ${ts}`,
      stock: 5,
    });

    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          {
            itemId,
            reason: "cycle_count",
            newQuantity: "8",
          },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      source: { kind: "manual_adjustment" },
      lines: [
        {
          itemId,
          currentQty: "5",
          countedQty: "8",
          varianceQty: "3",
          lots: [],
        },
      ],
    });
  });

  test("generic reconciliation apply routes through stock adjustment kernel", async ({
    db,
  }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Reconcile Apply ${ts}`,
      sku: `STOCK-RECONCILE-APPLY-${ts}`,
      category: `Stock Reconcile ${ts}`,
      stock: 5,
    });

    const response = await testFetch("/api/inventory/reconciliations", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          {
            itemId,
            reason: "found_stock",
            note: "mobile review",
            newQuantity: "8",
          },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));
    expect(event).toMatchObject({
      eventType: "manual_adjustment_increase",
      quantity: "3.0000",
    });
    await expect(getAdjustmentReason(db, event.id)).resolves.toMatchObject({
      reason: "found_stock",
      note: "mobile review",
    });
  });

  test("generic reconciliation rejects multi-line manual adjustments", async ({
    db,
  }) => {
    const firstItemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Reconcile Multi A ${ts}`,
      sku: `STOCK-RECONCILE-MULTI-A-${ts}`,
      category: `Stock Reconcile ${ts}`,
      stock: 5,
    });
    const secondItemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Reconcile Multi B ${ts}`,
      sku: `STOCK-RECONCILE-MULTI-B-${ts}`,
      category: `Stock Reconcile ${ts}`,
      stock: 6,
    });

    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          { itemId: firstItemId, reason: "cycle_count", newQuantity: "8" },
          { itemId: secondItemId, reason: "cycle_count", newQuantity: "7" },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(400);
  });

  test("adjustment sets absolute on-hand even from negative stock", async ({
    db,
  }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Negative ${ts}`,
      sku: `STOCK-ADJ-NEGATIVE-${ts}`,
      category: `Stock Adjust Negative ${ts}`,
      stock: 0,
    });

    const location = await db.transaction((tx) =>
      getDefaultInventoryLocationInTx(tx, orgId)
    );

    // Drive the item into stock debt (-3) via a negative-allowed consume.
    await db.transaction(async (tx) => {
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 3,
        eventType: "manual_adjustment_decrease",
        actorUserId: null,
        allowNegativeStock: true,
      });
    });

    const [debtBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(debtBalance.onHandQty).toBe("-3.0000");

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        newQuantity: "5",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));

    expect(event).toBeTruthy();
    expect(event.quantity).toBe("8.0000");
    await expect(getAdjustmentReason(db, event.id)).resolves.toMatchObject({
      reason: "data_correction",
    });

    const [itemBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.onHandQty).toBe("5.0000");
  });

  test("adjustment with no change writes no event", async ({ db }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Noop ${ts}`,
      sku: `STOCK-ADJ-NOOP-${ts}`,
      category: `Stock Adjust Noop ${ts}`,
      stock: 5,
    });

    const beforeCount = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      );

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        newQuantity: "5",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const afterIncrease = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      );
    const afterDecrease = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      );

    // The seed used a manual_adjustment_increase event; assert no NEW adjustment
    // events landed for the no-op (count unchanged, none of either direction).
    expect(afterIncrease.length).toBe(beforeCount.length);
    expect(afterDecrease.length).toBe(0);
  });

  test("adjustment is idempotent on a retried key", async ({ db }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Idempotent ${ts}`,
      sku: `STOCK-ADJ-IDEMPOTENT-${ts}`,
      category: `Stock Adjust Idempotent ${ts}`,
      stock: 5,
    });

    // Use an INCREASE so the positive stock event persists the request
    // Idempotency-Key on inventory_events. Without the begin/finish envelope the
    // new flow has no idempotency claim/replay, so any second mutation that
    // reuses the key trips inventory_events_idempotency_key_uidx and surfaces as
    // a 500 instead of replaying / cleanly conflicting.
    const idempotencyKey = `stock-adjust-retry-${ts}`;
    const body = JSON.stringify({
      reason: "data_correction",
      newQuantity: "9",
    });

    const first = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(first.status, await first.text()).toBe(200);

    // A true retry (identical body, same key) replays cleanly as 200.
    const replay = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(replay.status, await replay.text()).toBe(200);

    // Reusing the same key with a DIFFERENT payload must not crash with a raw
    // unique-constraint 500. The shared begin/finish envelope claims the key and
    // rejects the divergent reuse as an idempotency conflict (409) instead.
    const conflicting = await testFetch(
      `/api/items/${itemId}/stock-adjustments`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ reason: "data_correction", newQuantity: "12" }),
      }
    );
    expect(conflicting.status, await conflicting.text()).not.toBe(500);

    // Exactly one keyed adjustment event was ever written for this key.
    const events = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase"),
          eq(inventoryEvents.idempotencyKey, idempotencyKey)
        )
      );
    expect(events.length).toBe(1);

    const [itemBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.onHandQty).toBe("9.0000");
  });

  test("adjustment rejects a blank reason", async ({ db }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Blank ${ts}`,
      sku: `STOCK-ADJ-BLANK-${ts}`,
      category: `Stock Adjust Blank ${ts}`,
      stock: 5,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "  ",
        newQuantity: "3",
      }),
    });
    expect(response.status).toBe(400);
  });

  test("legacy mobile Stock count reason is accepted without verifying the item", async ({
    db,
  }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Stock Adjust Mobile Alias ${ts}`,
      sku: `STOCK-ADJ-MOBILE-ALIAS-${ts}`,
      category: `Stock Adjust Mobile Alias ${ts}`,
      stock: 5,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "Stock count",
        newQuantity: "6",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));
    expect(event).toBeTruthy();
    await expect(getAdjustmentReason(db, event.id)).resolves.toMatchObject({
      reason: "cycle_count",
    });

    const [itemBalance] = await db
      .select({ lastVerifiedAt: inventoryItemBalances.lastVerifiedAt })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.lastVerifiedAt).toBeNull();
  });

  test("initial-stock route seeds opening stock", async ({ db }) => {
    const itemId = await createUntrackedMaterialWithStock(db, {
      name: `Initial Stock ${ts}`,
      sku: `INITIAL-STOCK-${ts}`,
      category: `Initial Stock ${ts}`,
      stock: 0,
    });

    const response = await testFetch(`/api/items/${itemId}/initial-stock`, {
      method: "POST",
      body: JSON.stringify({
        quantity: "3",
        costPerUnit: "2.00",
        occurredAt: new Date().toISOString(),
        note: "opening stock",
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [itemBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance.onHandQty).toBe("3.0000");
  });
});

test.describe("lot-tracked stock adjustment route", () => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  async function getDefaultLocationId(
    db: Parameters<Parameters<typeof test>[2]>[0]["db"]
  ) {
    const location = await db.transaction((tx) =>
      getDefaultInventoryLocationInTx(tx, orgId)
    );
    return location.id;
  }

  // Seed a lot-tracked item, optionally with one existing lot at a known qty.
  // Mirrors the kernel spec: create the item, flip it to `tracked`, then post a
  // positive stock event with an explicit lotNumber so the kernel creates the
  // lot (the same path stocktake "found lots" use).
  async function createTrackedMaterialWithLot(
    db: Parameters<Parameters<typeof test>[2]>[0]["db"],
    {
      name,
      sku,
      category,
      lotNumber,
      stock,
    }: {
      name: string;
      sku: string;
      category: string;
      lotNumber?: string;
      stock?: number;
    }
  ) {
    const item = await createItem({
      itemType: "material",
      name,
      unitDefinitionId: unitId,
      sku,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        family: {
          name,
          category,
          description: null,
          unitDefinitionId: unitId,
          lotTrackingMode: "tracked",
        },
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    let lotId: string | null = null;
    if (lotNumber && (stock ?? 0) > 0) {
      const locationId = await getDefaultLocationId(db);
      await db.transaction(async (tx) => {
        const created = await createPositiveStockEventInTx(tx, {
          organizationId: orgId,
          locationId,
          itemId,
          quantity: stock!,
          unitCost: "2.00",
          eventType: "manual_adjustment_increase",
          eventSubtype: "lot_stock_adjustment_route_seed",
          referenceType: "item",
          referenceId: itemId,
          lotNumber,
        });
        lotId = created.lotId;
      });
    }

    return { itemId, lotId };
  }

  test("lot adjustment edits an existing lot, creates a new lot, records reason", async ({
    db,
  }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Edit ${ts}`,
      sku: `LOT-ADJ-EDIT-${ts}`,
      category: `Lot Adjust ${ts}`,
      lotNumber: `LOT-A-${ts}`,
      stock: 10,
    });
    expect(lotId).toBeTruthy();
    const newLotNumber = `LOT-B-${ts}`;
    const itemListResponse = await testFetch("/api/items?itemType=material");
    expect(itemListResponse.status, await itemListResponse.text()).toBe(200);
    const itemList = (await itemListResponse.json()) as Array<{
      id: string;
      lotTrackingMode?: string;
    }>;
    expect(itemList.find((item) => item.id === itemId)?.lotTrackingMode).toBe(
      "tracked"
    );

    // Resolve the item's unit cost the same way the kernel does for a stocktake
    // gain, normalized to the scale-6 unit_cost column. The new lot the
    // adjustment creates must land at exactly this cost.
    const resolvedCost = normalizeNumericScale(
      Number.parseFloat(
        await db.transaction((tx) =>
          resolvePositiveStockUnitCostInTx(tx, {
            itemId,
            reason: "stocktake_cost_policy",
          })
        )
      ),
      6
    );
    expect(resolvedCost).not.toBe("0.000000");

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "cycle_count",
        lots: [
          { lotId, newQuantity: "7" },
          { lotNumber: newLotNumber, newQuantity: "4" },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    // The -3 on LOT-A is a manual_adjustment_decrease carrying the reason.
    const [decrease] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));
    expect(decrease).toBeTruthy();
    expect(decrease.quantity).toBe("3.0000");
    await expect(getAdjustmentReason(db, decrease.id)).resolves.toMatchObject({
      reason: "cycle_count",
    });
    expect(decrease.lotId).toBe(lotId);

    // The +4 new lot is a manual_adjustment_increase carrying the reason.
    const [increase] = await db
      .select({
        id: inventoryEvents.id,
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));
    expect(increase).toBeTruthy();
    expect(increase.quantity).toBe("4.0000");
    await expect(getAdjustmentReason(db, increase.id)).resolves.toMatchObject({
      reason: "cycle_count",
    });

    // A new lot row + balance for LOT-B exists at qty 4.
    const [newLot] = await db
      .select({ id: lots.id, quantity: lots.quantity })
      .from(lots)
      .where(
        and(eq(lots.itemId, itemId), eq(lots.lotNumber, newLotNumber))
      );
    expect(newLot).toBeTruthy();
    expect(newLot.quantity).toBe("4.0000");

    const [newLotBalance] = await db
      .select({
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, newLot.id),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    expect(newLotBalance?.quantity).toBe("4.0000");
    // The new lot must carry the item's RESOLVED unit cost, exactly like a
    // stocktake found-gain. A manual positive adjustment is economically the
    // same event and must not write a zero-cost lot that later understates COGS.
    // The unit_cost column is numeric(18,6), so it reads back scale-6.
    expect(newLotBalance?.unitCost).not.toBe("0.000000");
    expect(newLotBalance?.unitCost).toBe("2.000000");
    expect(Number.parseFloat(newLotBalance!.unitCost!)).toBe(
      Number.parseFloat(resolvedCost)
    );

    // LOT-A balance is now 7.
    const [lotABalance] = await db
      .select({
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotId as unknown as string),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    expect(lotABalance?.quantity).toBe("7.0000");
    // The existing lot was seeded at unit cost 2.00. "I miscounted this lot,
    // add the missing units" must NOT dilute its cost toward zero: the append
    // must reuse the lot's own cost so the weighted average is a no-op.
    expect(lotABalance?.unitCost).toBe("2.000000");
  });

  test("existing lot gain preserves the lot cost basis", async ({ db }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Gain Cost ${ts}`,
      sku: `LOT-ADJ-GAIN-COST-${ts}`,
      category: `Lot Adjust ${ts}`,
      lotNumber: `LGC-${ts}`,
      stock: 10,
    });
    expect(lotId).toBeTruthy();
    if (!lotId) throw new Error("Expected seeded lot id.");

    await db
      .update(items)
      .set({ currentStockUnitCost: "5.00" })
      .where(eq(items.id, itemId));

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [{ lotId, newQuantity: "14" }],
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const [event] = await db
      .select({
        unitCost: inventoryEvents.unitCost,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.lotId, lotId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));
    expect(event).toMatchObject({
      quantity: "4.0000",
      unitCost: "2.000000",
    });

    const [lotBalance] = await db
      .select({ quantity: inventoryLotBalances.quantity, unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotId),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    expect(lotBalance).toMatchObject({
      quantity: "14.0000",
      unitCost: "2.000000",
    });
  });

  test("lot adjustment replays cleanly on a retried key", async ({ db }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Idempotent ${ts}`,
      sku: `LOT-ADJ-IDEMPOTENT-${ts}`,
      category: `Lot Adjust Idempotent ${ts}`,
      lotNumber: `LIA-${ts}`,
      stock: 10,
    });
    expect(lotId).toBeTruthy();
    const newLotNumber = `LIB-${ts}`;
    const idempotencyKey = `lot-stock-adjust-retry-${ts}`;
    const body = JSON.stringify({
      reason: "cycle_count",
      lots: [
        { lotId, newQuantity: "7" },
        { lotNumber: newLotNumber, newQuantity: "4" },
      ],
    });

    const first = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(first.status, await first.text()).toBe(200);

    // A true retry (identical multi-lot body, same key) replays via the shared
    // begin/finish envelope as a clean 200 with no duplicate events.
    const replay = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(replay.status, await replay.text()).toBe(200);

    // Exactly one event ever claimed this request key. The shared begin/finish
    // envelope hands the key to only the FIRST firing kernel call (here the -3
    // decrease on LOT-A); the retry replays the envelope rather than re-keying.
    const keyedEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.idempotencyKey, idempotencyKey)
        )
      );
    expect(keyedEvents.length).toBe(1);

    // No duplicate adjustment events of either direction overall.
    const allIncreases = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      );
    const allDecreases = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      );
    // One seed increase + one new-lot increase from the adjustment; the -3 on
    // LOT-A is a single decrease. The replay must add none of these.
    expect(allIncreases.length).toBe(2);
    expect(allDecreases.length).toBe(1);

    // LOT-A balance settled at 7 (the replay did not re-apply the -3).
    const [lotABalance] = await db
      .select({ quantity: inventoryLotBalances.quantity })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotId as unknown as string),
          eq(inventoryLotBalances.disposition, "available")
        )
      );
    expect(lotABalance?.quantity).toBe("7.0000");
  });

  test("new lot without a lot number is rejected", async ({ db }) => {
    const { itemId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust NoNumber ${ts}`,
      sku: `LOT-ADJ-NONUMBER-${ts}`,
      category: `Lot Adjust NoNumber ${ts}`,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "found_stock",
        lots: [{ newQuantity: "3" }],
      }),
    });
    expect(response.status).toBe(400);
  });

  test("new lot number that already exists for the item is rejected", async ({ db }) => {
    const existingLotNumber = `LOT-EXISTS-${ts}`;
    const { itemId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Existing ${ts}`,
      sku: `LOT-ADJ-EXISTS-${ts}`,
      category: `Lot Adjust Existing ${ts}`,
      lotNumber: existingLotNumber,
      stock: 5,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "found_stock",
        lots: [{ lotNumber: existingLotNumber, newQuantity: "3" }],
      }),
    });
    expect(response.status, await response.text()).toBe(400);
  });

  test("lot adjustment rejects payloads with both lot id and lot number", async ({ db }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Ambiguous ${ts}`,
      sku: `LOT-ADJ-AMBIGUOUS-${ts}`,
      category: `Lot Adjust Ambiguous ${ts}`,
      lotNumber: `LOT-AMBIGUOUS-${ts}`,
      stock: 5,
    });

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [{ lotId, lotNumber: `NEW-LOT-${ts}`, newQuantity: "3" }],
      }),
    });
    expect(response.status, await response.text()).toBe(400);
  });

  test("lot adjustment rejects duplicate existing lot ids", async ({ db }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Duplicate ${ts}`,
      sku: `LOT-ADJ-DUPLICATE-${ts}`,
      category: `Lot Adjust Duplicate ${ts}`,
      lotNumber: `LOT-DUPLICATE-${ts}`,
      stock: 5,
    });
    expect(lotId).toBeTruthy();

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [
          { lotId, newQuantity: "3" },
          { lotId, newQuantity: "2" },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(400);

    const adjustmentEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      );
    expect(adjustmentEvents).toHaveLength(0);
  });

  test("generic reconciliation preview rejects duplicate existing lot ids", async ({
    db,
  }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Reconcile Duplicate ${ts}`,
      sku: `LOT-RECONCILE-DUPLICATE-${ts}`,
      category: `Lot Reconcile Duplicate ${ts}`,
      lotNumber: `LOT-RECONCILE-DUPLICATE-${ts}`,
      stock: 5,
    });
    expect(lotId).toBeTruthy();

    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          {
            itemId,
            reason: "data_correction",
            lots: [
              { lotId, newQuantity: "3" },
              { lotId, newQuantity: "2" },
            ],
          },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(400);
  });

  test("generic reconciliation preview names known zero-balance lots", async ({
    db,
  }) => {
    const lotNumber = `LOT-RECONCILE-KNOWN-${ts}`;
    const { itemId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Reconcile Known ${ts}`,
      sku: `LOT-RECONCILE-KNOWN-${ts}`,
      category: `Lot Reconcile Known ${ts}`,
    });
    const [createdLot] = await db
      .insert(lots)
      .values({ organizationId: orgId, itemId, lotNumber })
      .returning({ id: lots.id });

    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          {
            itemId,
            reason: "data_correction",
            lots: [{ lotId: createdLot.id, newQuantity: "3" }],
          },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(200);
    const body = await response.json();
    expect(body.lines[0].lots[0]).toMatchObject({
      lotId: createdLot.id,
      lotNumber,
      currentQty: "0",
      countedQty: "3",
      varianceQty: "3",
      isFound: false,
    });
  });

  test("generic reconciliation preview rolls up unsubmitted tracked lots", async ({
    db,
  }) => {
    const { itemId, lotId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Reconcile Partial ${ts}`,
      sku: `LOT-RECONCILE-PARTIAL-${ts}`,
      category: `Lot Reconcile Partial ${ts}`,
      lotNumber: `LOT-RECONCILE-PARTIAL-A-${ts}`,
      stock: 5,
    });
    expect(lotId).toBeTruthy();
    const locationId = await getDefaultLocationId(db);
    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 7,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "lot_reconciliation_partial_seed",
        referenceType: "item",
        referenceId: itemId,
        lotNumber: `LOT-RECONCILE-PARTIAL-B-${ts}`,
      });
    });

    const response = await testFetch("/api/inventory/reconciliations/preview", {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "manual_adjustment" },
        lines: [
          {
            itemId,
            reason: "cycle_count",
            lots: [{ lotId, newQuantity: "3" }],
          },
        ],
      }),
    });
    expect(response.status, await response.text()).toBe(200);
    const body = await response.json();
    expect(body.lines[0]).toMatchObject({
      currentQty: "5",
      countedQty: "3",
      varianceQty: "-2",
    });
    expect(body.lines[0].lots[0]).toMatchObject({
      lotId,
      currentQty: "5",
      countedQty: "3",
      varianceQty: "-2",
    });
  });

  test("unknown lotId for this item is rejected with 404", async ({ db }) => {
    const { itemId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust Unknown ${ts}`,
      sku: `LOT-ADJ-UNKNOWN-${ts}`,
      category: `Lot Adjust Unknown ${ts}`,
      lotNumber: `LU-${ts}`,
      stock: 5,
    });

    // A random UUID that is not a real lot for this item must resolve to a clean
    // 404, not crash the kernel's FOR UPDATE select with a bare 500.
    const foreignLotId = "00000000-0000-4000-8000-000000000000";
    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [{ lotId: foreignLotId, newQuantity: "3" }],
      }),
    });
    expect(response.status, await response.text()).toBe(404);
  });

  test("zeroed new lot is dropped", async ({ db }) => {
    const { itemId } = await createTrackedMaterialWithLot(db, {
      name: `Lot Adjust ZeroNew ${ts}`,
      sku: `LOT-ADJ-ZERONEW-${ts}`,
      category: `Lot Adjust ZeroNew ${ts}`,
    });
    const zeroedLotNumber = `LOT-Z-${ts}`;

    const response = await testFetch(`/api/items/${itemId}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [{ lotNumber: zeroedLotNumber, newQuantity: "0" }],
      }),
    });
    expect(response.status, await response.text()).toBe(200);

    const zeroedLots = await db
      .select({ id: lots.id })
      .from(lots)
      .where(
        and(eq(lots.itemId, itemId), eq(lots.lotNumber, zeroedLotNumber))
      );
    expect(zeroedLots).toHaveLength(0);

    const events = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      );
    expect(events).toHaveLength(0);
  });
});
