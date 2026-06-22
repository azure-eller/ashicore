import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db as appDb } from "@/lib/db";
import {
  inventoryIdempotencyClaims,
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryEvents,
  inventoryExpectedSummary,
  items,
  lots,
  manufacturingOrderIngredients,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stocktakeLotItems,
  stocktakeItems,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import {
  IdempotencyConflictError,
  IdempotencyInFlightError,
} from "@/lib/inventory/kernel/errors";
import {
  applyExpectedReferenceDeltasInTx,
  getDefaultInventoryLocationInTx,
} from "@/lib/inventory/kernel";
import {
  claimInventoryIdempotencyInTx,
  completeInventoryIdempotencyClaimInTx,
} from "@/lib/inventory/kernel/idempotency";
import { diffProjections } from "@/lib/inventory/kernel/reconcile";
import { repairInventoryStockProjectionsForOrg } from "@/lib/inventory/kernel/repair-projections";
import { test, expect } from "../fixtures";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSupplier,
  createManufacturingOrder,
  getOrgId,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";

async function withTestOrg<T>(orgId: string, callback: (tx: Tx) => Promise<T>) {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return callback(tx as Tx);
  });
}

async function expectProjectionDiffClean(orgId: string, itemIds?: string[]) {
  const diff = await withTestOrg(orgId, (tx) => diffProjections(tx, orgId, itemIds));

  expect(diff.itemDeltas).toHaveLength(0);
  expect(diff.lotDeltas).toHaveLength(0);
  expect(diff.expectedDeltas).toHaveLength(0);
  expect(diff.legacyLotDeltas).toHaveLength(0);
}

async function createMaterialFixture(name: string, category: string, stock: string) {
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: `RECON-${name.replace(/\W+/g, "-").toUpperCase()}`,
    category,
    description: `${name} fixture`,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: null,
    stock,
    safetyStock: "0",
    bom: [],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createCustomerFixture(name: string) {
  const result = await createCustomer({ name });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createConfirmedSalesOrderFixture(params: {
  customerId: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  confirmOversell?: boolean;
}) {
  // shipDate must be >= orderDate; use a future date relative to test
  // execution to avoid stale-date drift (the test suite has burned us on
  // hardcoded past dates after the calendar rolls forward).
  const todayIso = new Date().toISOString().slice(0, 10);
  const shipDateIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const created = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      customerId: params.customerId,
      status: "open",
      orderDate: todayIso,
      shipDate: shipDateIso,
      requestedDate: null,
      notes: null,
      lines: [
        {
          itemId: params.itemId,
          quantity: params.quantity,
          unitPrice: params.unitPrice,
        },
      ],
      confirmOversell: false,
    }),
  });
  expect(created.status).toBe(201);
  const body = await created.json();
  const orderId = body.id as string;

  const confirmed = await confirmSalesOrder(orderId, {
    confirmOversell: params.confirmOversell ?? false,
  });
  expect(confirmed.status).toBe(200);

  const [line] = await withTestOrg(getOrgId(), (tx) =>
    tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId))
  );

  expect(line).toBeTruthy();

  return {
    orderId,
    lineId: line.id,
    itemId: line.itemId,
    quantity: parseFloat(line.quantity),
  };
}

async function createReleasedManufacturingFixture(params: {
  productName: string;
  category: string;
  ingredientItemId: string;
  plannedQuantity: string;
  quantityPerUnit: string;
}) {
  const product = await createItem({
    name: params.productName,
    itemType: "product",
    unitDefinitionId: getUnitId(),
    sku: `RECON-${params.productName.replace(/\W+/g, "-").toUpperCase()}`,
    category: params.category,
    description: `${params.productName} fixture`,
    defaultPurchasePrice: null,
    defaultSellingPrice: "25.00",
    stock: "0",
    safetyStock: "0",
    bom: [
      {
        componentId: params.ingredientItemId,
        quantity: params.quantityPerUnit,
      },
    ],
  });
  expect(product.status).toBe(201);
  const productId = product.body.id as string;

  const created = await createManufacturingOrder({
    productId,
    plannedQuantity: params.plannedQuantity,
    plannedDate: null,
    notes: null,
    ingredients: [
      {
        itemId: params.ingredientItemId,
        quantityPerUnit: params.quantityPerUnit,
      },
    ],
    confirmShortage: false,
  });
  expect(created.status).toBe(201);
  const orderId = created.body.id as string;

  const released = await releaseManufacturingOrder(orderId, { confirmShortage: true });
  expect(released.status).toBe(200);

  const [ingredient] = await withTestOrg(getOrgId(), (tx) =>
    tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
  );

  expect(ingredient).toBeTruthy();

  return {
    orderId,
    ingredientId: ingredient.id,
    itemId: ingredient.itemId,
    quantity: parseFloat(ingredient.plannedQuantity),
  };
}

async function postJsonWithKey(
  path: string,
  idempotencyKey: string,
  body?: Record<string, unknown>
) {
  return testFetch(path, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function deleteWithKey(path: string, idempotencyKey: string) {
  return testFetch(path, {
    method: "DELETE",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

function key(label: string, ts: number) {
  return `reconciliation:${label}:${ts}`;
}

test.describe("inventory kernel invariants", () => {
  test.describe.configure({ mode: "serial" });

  const orgId = getOrgId();
  const ts = Date.now();

  test("replays duplicate idempotency claims for the same payload", async ({ db }) => {
    const idempotencyKey = key("claim-replay", ts);
    const operationName = "manualIncreaseStock";
    const payload = { itemId: "replay-item", quantity: 3, unitCost: "2.00" };
    const resultEnvelope = {
      status: "completed",
      lotId: "lot-replay",
      eventId: "event-replay",
    };

    await withTestOrg(orgId, async (tx) => {
      const first = await claimInventoryIdempotencyInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        operationName,
        payload,
      });

      expect(first.claimed).toBe(true);

      await completeInventoryIdempotencyClaimInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        resultEnvelope,
      });
    });

    const replay = await withTestOrg(orgId, (tx) =>
      claimInventoryIdempotencyInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        operationName,
        payload,
      })
    );

    expect(replay.claimed).toBe(false);
    expect(replay.claim.resultEnvelope).toEqual(resultEnvelope);

    const [claimRow] = await db
      .select()
      .from(inventoryIdempotencyClaims)
      .where(
        and(
          eq(inventoryIdempotencyClaims.organizationId, orgId),
          eq(inventoryIdempotencyClaims.idempotencyKey, idempotencyKey)
        )
      );

    expect(claimRow?.firstEventId).toBeNull();
  });

  test("rejects idempotency key reuse when the payload changes", async () => {
    const idempotencyKey = key("manual-increase-conflict", ts);
    const operationName = "manualIncreaseStock";

    await withTestOrg(orgId, async (tx) => {
      const first = await claimInventoryIdempotencyInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        operationName,
        payload: { itemId: "conflict-item", quantity: 1, unitCost: "2.00" },
      });

      expect(first.claimed).toBe(true);

      await completeInventoryIdempotencyClaimInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        resultEnvelope: { status: "completed", eventId: "event-conflict" },
      });
    });

    await expect(
      withTestOrg(orgId, (tx) =>
        claimInventoryIdempotencyInTx(tx, {
          organizationId: orgId,
          idempotencyKey,
          operationName,
          payload: { itemId: "conflict-item", quantity: 2, unitCost: "2.00" },
        })
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test("guards pending idempotency claims instead of replaying a stale envelope", async ({ db }) => {
    const idempotencyKey = key("pending-claim", ts);
    const operationName = "manualIncreaseStock";
    const payload = { itemId: "pending-item", quantity: 1, unitCost: "2.00" };

    await withTestOrg(orgId, async (tx) => {
      const claim = await claimInventoryIdempotencyInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        operationName,
        payload,
      });

      expect(claim.claimed).toBe(true);
      await completeInventoryIdempotencyClaimInTx(tx, {
        organizationId: orgId,
        idempotencyKey,
        resultEnvelope: { status: "pending" },
      });
    });

    await expect(
      withTestOrg(orgId, (tx) =>
        claimInventoryIdempotencyInTx(tx, {
          organizationId: orgId,
          idempotencyKey,
          operationName,
          payload,
        })
      )
    ).rejects.toBeInstanceOf(IdempotencyInFlightError);

    const [claimRow] = await db
      .select()
      .from(inventoryIdempotencyClaims)
      .where(
        and(
          eq(inventoryIdempotencyClaims.organizationId, orgId),
          eq(inventoryIdempotencyClaims.idempotencyKey, idempotencyKey)
        )
      );

    expect(claimRow?.resultEnvelope).toEqual({ status: "pending" });
  });

  test("repairs stale stock projections from the ledger with dry-run by default", async () => {
    const itemId = await createMaterialFixture(
      `Projection Repair ${ts}`,
      `Projection Repair ${ts}`,
      "5"
    );

    const [lotBalance] = await withTestOrg(orgId, (tx) =>
      tx
        .select({
          locationId: inventoryLotBalances.locationId,
          lotId: inventoryLotBalances.lotId,
        })
        .from(inventoryLotBalances)
        .where(eq(inventoryLotBalances.itemId, itemId))
    );
    expect(lotBalance).toBeTruthy();

    await withTestOrg(orgId, async (tx) => {
      await tx
        .update(inventoryItemBalances)
        .set({
          onHandQty: "4",
          availableToPromise: "4",
        })
        .where(eq(inventoryItemBalances.itemId, itemId));
      await tx
        .update(inventoryLotBalances)
        .set({ quantity: "4", stillActive: true })
        .where(
          and(
            eq(inventoryLotBalances.itemId, itemId),
            eq(inventoryLotBalances.lotId, lotBalance.lotId)
          )
        );
      await tx
        .update(lots)
        .set({ quantity: "4" })
        .where(eq(lots.id, lotBalance.lotId));
    });

    const dryRun = await repairInventoryStockProjectionsForOrg(orgId, {
      itemIds: [itemId],
    });

    expect(dryRun.mode).toBe("dry-run");
    expect(dryRun.beforeSummary.itemDeltas).toBe(1);
    expect(dryRun.beforeSummary.lotDeltas).toBe(1);
    expect(dryRun.beforeSummary.legacyLotDeltas).toBe(1);
    expect(dryRun.repaired).toMatchObject({
      itemRows: 0,
      lotRows: 0,
      legacyLotRows: 0,
    });

    const stillDrifted = await withTestOrg(orgId, (tx) =>
      diffProjections(tx, orgId, [itemId])
    );
    expect(stillDrifted.itemDeltas).toHaveLength(1);

    const applied = await repairInventoryStockProjectionsForOrg(orgId, {
      apply: true,
      itemIds: [itemId],
    });

    expect(applied.mode).toBe("apply");
    expect(applied.repaired).toMatchObject({
      itemRows: 1,
      lotRows: 1,
      legacyLotRows: 1,
    });
    expect(applied.afterSummary.itemDeltas).toBe(0);
    expect(applied.afterSummary.lotDeltas).toBe(0);
    expect(applied.afterSummary.legacyLotDeltas).toBe(0);

    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("clamps expected supply releases to the open reference quantity", async ({
    db,
  }) => {
    const itemId = await createMaterialFixture(
      `Recon Expected Clamp ${ts}`,
      `Recon Expected Clamp ${ts}`,
      "0"
    );
    const referenceId = randomUUID();

    await withTestOrg(orgId, async (tx) => {
      const location = await getDefaultInventoryLocationInTx(tx, orgId);
      await applyExpectedReferenceDeltasInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        deltas: [
          {
            itemId,
            referenceType: "manufacturing_order",
            referenceId,
            quantity: 10,
          },
        ],
      });

      await applyExpectedReferenceDeltasInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        deltas: [
          {
            itemId,
            referenceType: "manufacturing_order",
            referenceId,
            quantity: -500,
          },
        ],
      });
    });

    const events = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, referenceId))
      .orderBy(inventoryEvents.occurredAt);

    expect(events).toEqual([
      { eventType: "expected_increase", quantity: "10.0000" },
      { eventType: "expected_release", quantity: "10.0000" },
    ]);

    const summaryRows = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(eq(inventoryExpectedSummary.referenceId, referenceId));
    expect(summaryRows).toHaveLength(0);

    const [balance] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(balance.expectedQty).toBe("0.0000");
  });

  test("replays item creation at the business-operation boundary", async ({ db }) => {
    const sku = `RECON-IDEMP-ITEM-${ts}`;
    const idempotencyKey = key("create-item", ts);
    const payload = {
      name: `Recon Item ${ts}`,
      itemType: "material",
      unitDefinitionId: getUnitId(),
      sku,
      category: `Recon Items ${ts}`,
      description: "request replay fixture",
      defaultPurchasePrice: "1.50",
      defaultSellingPrice: null,
      stock: "3",
      safetyStock: "0",
      bom: [],
    };

    const first = await postJsonWithKey("/api/items", idempotencyKey, payload);
    const second = await postJsonWithKey("/api/items", idempotencyKey, payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);

    const createdItems = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.sku, sku));

    expect(createdItems).toHaveLength(1);
    await expectProjectionDiffClean(orgId, [firstBody.id]);
  });

  test("replays sales-order creation at the business-operation boundary", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Create Order Sand ${ts}`,
      `Recon Create Order ${ts}`,
      "8"
    );
    const customerId = await createCustomerFixture(`Recon Create Order Customer ${ts}`);
    const idempotencyKey = key("create-sales-order", ts);
    // Use a future-relative date so the test doesn't drift stale after
    // the calendar rolls past a hardcoded date.
    const orderDateIso = new Date().toISOString().slice(0, 10);
    const shipDateIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const payload = {
      customerId,
      status: "open",
      orderDate: orderDateIso,
      shipDate: shipDateIso,
      requestedDate: null,
      notes: "request replay fixture",
      lines: [
        {
          itemId,
          quantity: "2",
          unitPrice: "11.00",
        },
      ],
      confirmOversell: false,
    };

    const first = await postJsonWithKey("/api/sales-orders", idempotencyKey, payload);
    const second = await postJsonWithKey("/api/sales-orders", idempotencyKey, payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);

    const orders = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.id, firstBody.id));

    expect(orders).toHaveLength(1);
  });

  test("replays purchase-order submit after the first request changes status", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Submit Sand ${ts}`,
      `Recon Submit ${ts}`,
      "0"
    );
    const supplier = await createSupplier({ name: `Recon Submit Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const created = await createPurchaseOrder({
      supplierId: supplier.body.id as string,
      lines: [
        {
          itemId,
          quantityOrdered: "4",
          unitCost: "3.25",
        },
      ],
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;
    const idempotencyKey = key("submit-po", ts);

    const first = await postJsonWithKey(
      `/api/purchase-orders/${orderId}/submit`,
      idempotencyKey
    );
    const second = await postJsonWithKey(
      `/api/purchase-orders/${orderId}/submit`,
      idempotencyKey
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const [order] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));

    expect(order?.status).toBe("ordered");
    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("replays sales order shipping without tripping the already-shipped guard", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Replay Ship Sand ${ts}`,
      `Recon Replay Ship ${ts}`,
      "5"
    );
    const customerId = await createCustomerFixture(`Recon Replay Ship Customer ${ts}`);
    const order = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "2",
      unitPrice: "10.00",
      confirmOversell: true,
    });
    const idempotencyKey = key("ship-replay", ts);

    const first = await postJsonWithKey(
      `/api/sales-orders/${order.orderId}/ship`,
      idempotencyKey
    );
    const second = await postJsonWithKey(
      `/api/sales-orders/${order.orderId}/ship`,
      idempotencyKey
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const shipEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "sales_order"),
          eq(inventoryEvents.referenceId, order.orderId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );

    expect(shipEvents).toHaveLength(1);
    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("replays manufacturing start after the first request changes status", async () => {
    const ingredientItemId = await createMaterialFixture(
      `Recon Release Sand ${ts}`,
      `Recon Release ${ts}`,
      "10"
    );
    const product = await createItem({
      name: `Recon Release Blend ${ts}`,
      itemType: "product",
      unitDefinitionId: getUnitId(),
      sku: `RECON-RELEASE-${ts}`,
      category: `Recon Release ${ts}`,
      description: "release replay fixture",
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: ingredientItemId,
          quantity: "1",
        },
      ],
    });
    expect(product.status).toBe(201);

    const created = await createManufacturingOrder({
      productId: product.body.id as string,
      plannedQuantity: "3",
      plannedDate: null,
      notes: null,
      ingredients: [
        {
          itemId: ingredientItemId,
          quantityPerUnit: "1",
        },
      ],
      confirmShortage: false,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;
    const idempotencyKey = key("start-mo", ts);

    const first = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/start`,
      idempotencyKey,
      { confirmShortage: false }
    );
    const second = await postJsonWithKey(
      `/api/manufacturing-orders/${orderId}/start`,
      idempotencyKey,
      { confirmShortage: false }
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expectProjectionDiffClean(orgId, [ingredientItemId, product.body.id as string]);
  });

  test("replays confirmed-order delete after the first request soft-deletes it", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Delete Sand ${ts}`,
      `Recon Delete ${ts}`,
      "4"
    );
    const customerId = await createCustomerFixture(`Recon Delete Customer ${ts}`);
    const order = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "2",
      unitPrice: "9.50",
      confirmOversell: true,
    });
    const idempotencyKey = key("delete-sales-order", ts);

    const first = await deleteWithKey(
      `/api/sales-orders/${order.orderId}`,
      idempotencyKey
    );
    const second = await deleteWithKey(
      `/api/sales-orders/${order.orderId}`,
      idempotencyKey
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.orderId));

    expect(deletedOrder?.deletedAt).toBeTruthy();
    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("allows only one concurrent shipment to consume the same stock", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Ship Sand ${ts}`,
      `Recon Ship ${ts}`,
      "5"
    );
    const customerId = await createCustomerFixture(`Recon Ship Customer ${ts}`);

    const orderA = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "4",
      unitPrice: "9.00",
      confirmOversell: true,
    });
    const orderB = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "4",
      unitPrice: "9.00",
      confirmOversell: true,
    });

    const [shipA, shipB] = await Promise.all([
      postJsonWithKey(`/api/sales-orders/${orderA.orderId}/ship`, key("ship-a", ts)),
      postJsonWithKey(`/api/sales-orders/${orderB.orderId}/ship`, key("ship-b", ts)),
    ]);

    expect([shipA.status, shipB.status].filter((status) => status === 200)).toHaveLength(1);
    expect([shipA.status, shipB.status].filter((status) => status !== 200)).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(balance.onHandQty).toBe("1.0000");
    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("allows only one concurrent pick-or-ship path to consume shared stock", async ({ db }) => {
    const itemId = await createMaterialFixture(
      `Recon Shared Sand ${ts}`,
      `Recon Shared ${ts}`,
      "6"
    );
    const customerId = await createCustomerFixture(`Recon Shared Customer ${ts}`);

    const salesOrder = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "4",
      unitPrice: "12.00",
      confirmOversell: true,
    });

    const manufacturing = await createReleasedManufacturingFixture({
      productName: `Recon Shared Blend ${ts}`,
      category: `Recon Shared ${ts}`,
      ingredientItemId: itemId,
      plannedQuantity: "4",
      quantityPerUnit: "1",
    });

    const [shipResponse, pickResponse] = await Promise.all([
      postJsonWithKey(
        `/api/sales-orders/${salesOrder.orderId}/ship`,
        key("shared-ship", ts),
        { confirmNegativeStock: true }
      ),
      postJsonWithKey(
        `/api/manufacturing-orders/${manufacturing.orderId}/ingredients/${manufacturing.ingredientId}/pick`,
        key("shared-pick", ts),
        {}
      ),
    ]);

    expect([shipResponse.status, pickResponse.status].filter((status) => status === 200)).toHaveLength(1);
    expect([shipResponse.status, pickResponse.status].filter((status) => status === 409)).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(balance.onHandQty).toBe("2.0000");
    await expectProjectionDiffClean(orgId, [itemId]);
  });

  test("stocktake complete racing shipment never leaves projection drift and surfaces stale stock", async ({ db }) => {
    const category = `Recon Stocktake ${ts}`;
    const itemId = await createMaterialFixture(
      `Recon Stocktake Sand ${ts}`,
      category,
      "5"
    );
    const customerId = await createCustomerFixture(`Recon Stocktake Customer ${ts}`);
    const salesOrder = await createConfirmedSalesOrderFixture({
      customerId,
      itemId,
      quantity: "2",
      unitPrice: "8.00",
      confirmOversell: true,
    });

    const createdStocktake = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Recon Stocktake ${ts}`,
        scope: `material:category:${category}`,
        reason: "cycle_count",
        notes: null,
      }),
    });
    expect(createdStocktake.status).toBe(201);
    const stocktakeBody = await createdStocktake.json();
    const stocktakeId = stocktakeBody.id as string;

    const [line] = await db
      .select({
        id: stocktakeItems.id,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId));

    expect(line).toBeTruthy();

    const [lotLine] = await db
      .select({
        id: stocktakeLotItems.id,
      })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));

    expect(lotLine).toBeTruthy();

    const savedCounts = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lotLines: [{ lotLineId: lotLine.id, countedQty: "5" }],
      }),
    });
    expect(savedCounts.status).toBe(200);

    const shipPromise = postJsonWithKey(
      `/api/sales-orders/${salesOrder.orderId}/ship`,
      key("race-ship", ts)
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const completePromise = postJsonWithKey(
      `/api/stocktakes/${stocktakeId}/complete`,
      key("race-stocktake", ts),
      { confirmStale: false, reason: "cycle_count" }
    );

    const [shipResponse, completeResponse] = await Promise.all([
      shipPromise,
      completePromise,
    ]);

    expect(shipResponse.status).toBe(200);
    expect([200, 409]).toContain(completeResponse.status);

    if (completeResponse.status === 409) {
      const completeBody = await completeResponse.json();
      expect(completeBody.stale?.items?.[0]?.itemId).toBe(itemId);
    }

    await expectProjectionDiffClean(orgId, [itemId]);
  });


});
