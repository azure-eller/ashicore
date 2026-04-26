import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  manufacturingOrderIngredients,
  purchaseOrderLines,
  qualityDispositionEvents,
} from "../../../lib/db/schema";
import {
  completeManufacturingOrder,
  confirmSalesOrder,
  createCustomer,
  createItem,
  createManufacturingOrder,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  fulfillSalesOrder,
  getOrgId,
  getUnitId,
  receivePurchaseOrder,
  releaseManufacturingOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

type Disposition = "available" | "blocked" | "rejected";
type DispositionAction = "release" | "block" | "reject" | "scrap";

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function createMaterial(name: string, stock = "0") {
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48),
    category: "Disposition QA",
    description: null,
    defaultPurchasePrice: "1.00",
    defaultSellingPrice: "9.00",
    stock,
    safetyStock: "0",
    bom: [],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createProduct(name: string, componentId: string) {
  const result = await createItem({
    name,
    itemType: "product",
    unitDefinitionId: getUnitId(),
    sku: name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48),
    category: "Disposition QA",
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "20.00",
    stock: "0",
    safetyStock: "0",
    bom: [{ componentId, quantity: "1" }],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function getItemBalance(db: TestDb, itemId: string) {
  const [balance] = await db
    .select({
      organizationId: inventoryItemBalances.organizationId,
      onHandQty: inventoryItemBalances.onHandQty,
      committedQty: inventoryItemBalances.committedQty,
      demandQty: inventoryItemBalances.demandQty,
      expectedQty: inventoryItemBalances.expectedQty,
      availableToPromise: inventoryItemBalances.availableToPromise,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  if (!balance) {
    throw new Error(`Missing item balance for ${itemId}`);
  }

  return balance;
}

async function getLotBalances(db: TestDb, itemId: string) {
  return db
    .select({
      organizationId: inventoryLotBalances.organizationId,
      lotId: inventoryLotBalances.lotId,
      disposition: inventoryLotBalances.disposition,
      quantity: inventoryLotBalances.quantity,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );
}

function dispositionQuantity(
  rows: Array<{ disposition: string; quantity: string }>,
  disposition: Disposition
) {
  return rows.find((row) => row.disposition === disposition)?.quantity ?? "0.0000";
}

async function getFirstLotId(db: TestDb, itemId: string, disposition: Disposition) {
  const [row] = await db
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, disposition),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );

  if (!row) {
    throw new Error(`Missing ${disposition} lot for ${itemId}`);
  }

  return row.lotId;
}

async function applyDisposition(params: {
  itemId: string;
  lotId: string;
  action: DispositionAction;
  fromDisposition: Disposition;
  quantity: string;
  notes?: string | null;
  idempotencyKey?: string;
}) {
  const response = await testFetch(
    `/api/items/${params.itemId}/lots/${params.lotId}/disposition`,
    {
      method: "POST",
      headers: params.idempotencyKey
        ? { "Idempotency-Key": params.idempotencyKey }
        : undefined,
      body: JSON.stringify({
        action: params.action,
        fromDisposition: params.fromDisposition,
        quantity: params.quantity,
        notes: params.notes ?? null,
      }),
    }
  );
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function createSubmittedPurchaseOrder(itemId: string, quantity: string) {
  const supplier = await createSupplier({ name: uniqueName("Disposition supplier") });
  expect(supplier.status).toBe(201);

  const order = await createPurchaseOrder({
    supplierId: supplier.body.id,
    lines: [{ itemId, quantityOrdered: quantity, unitCost: "1.00" }],
  });
  expect(order.status).toBe(201);

  const submitted = await submitPurchaseOrder(order.body.id);
  expect(submitted.status).toBe(200);
  return order.body.id as string;
}

test.describe("Inventory disposition", () => {
  test.describe.configure({ mode: "serial" });

  let blockedItemId = "";
  let blockedLotId = "";

  test("receives PO stock into blocked and excludes it from available stock", async ({
    db,
  }) => {
    blockedItemId = await createMaterial(uniqueName("Blocked receipt"));
    const purchaseOrderId = await createSubmittedPurchaseOrder(blockedItemId, "10");
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));

    const received = await receivePurchaseOrder(purchaseOrderId, {
      lines: [
        {
          lineId: line.id,
          quantityReceived: "10",
          disposition: "blocked",
        },
      ],
    });
    expect(received.status).toBe(200);

    const balance = await getItemBalance(db, blockedItemId);
    expect(balance.organizationId).toBe(getOrgId());
    expect(balance.onHandQty).toBe("10.0000");
    expect(balance.expectedQty).toBe("0.0000");
    expect(balance.availableToPromise).toBe("0.0000");

    const lotBalances = await getLotBalances(db, blockedItemId);
    expect(dispositionQuantity(lotBalances, "blocked")).toBe("10.0000");
    expect(dispositionQuantity(lotBalances, "available")).toBe("0.0000");
    blockedLotId = await getFirstLotId(db, blockedItemId, "blocked");
  });

  test("blocked dispositions cannot be shipped or picked", async ({ db }) => {
    const customer = await createCustomer({ name: uniqueName("Blocked customer") });
    expect(customer.status).toBe(201);

    for (const [action, disposition] of [
      ["block", "blocked"],
      ["reject", "rejected"],
    ] as const) {
      const itemId = await createMaterial(uniqueName(`${disposition} shipment`), "2");
      const lotId = await getFirstLotId(db, itemId, "available");
      const changed = await applyDisposition({
        itemId,
        lotId,
        action,
        fromDisposition: "available",
        quantity: "2",
      });
      expect(changed.status).toBe(200);

      const order = await createSalesOrder({
        customerId: customer.body.id,
        status: "draft",
        lines: [{ itemId, quantity: "1", unitPrice: "9.00" }],
      });
      expect(order.status).toBe(201);
      expect(
        (await confirmSalesOrder(order.body.id, { confirmOversell: true })).status
      ).toBe(200);
      const shipped = await fulfillSalesOrder(order.body.id);
      expect(shipped.status).toBe(409);
    }

    const blockedComponentId = await createMaterial(uniqueName("Blocked component"), "1");
    const blockedLotId = await getFirstLotId(db, blockedComponentId, "available");
    expect(
      (
        await applyDisposition({
          itemId: blockedComponentId,
          lotId: blockedLotId,
          action: "block",
          fromDisposition: "available",
          quantity: "1",
        })
      ).status
    ).toBe(200);

    const productId = await createProduct(uniqueName("Blocked component product"), blockedComponentId);
    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "1",
      ingredients: [{ itemId: blockedComponentId, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    expect(
      (await releaseManufacturingOrder(order.body.id, { confirmShortage: true })).status
    ).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.body.id));
    const picked = await testFetch(
      `/api/manufacturing-orders/${order.body.id}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(picked.status).toBe(409);
  });

  test("releases blocked stock from the item detail UI and FIFO consumes only released stock", async ({
    page,
    db,
  }) => {
    await page.goto(`/inventory/materials/${blockedItemId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Blocked", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Release" }).first().click();
    await page.locator("#disposition-quantity").fill("4");
    await page.locator("#disposition-notes").fill("Release for production use");
    const releaseResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(
          `/api/items/${blockedItemId}/lots/${blockedLotId}/disposition`
        )
    );
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await releaseResponse).status()).toBe(200);

    const afterRelease = await getLotBalances(db, blockedItemId);
    expect(dispositionQuantity(afterRelease, "available")).toBe("4.0000");
    expect(dispositionQuantity(afterRelease, "blocked")).toBe("6.0000");

    const [qualityEvent] = await db
      .select({
        organizationId: qualityDispositionEvents.organizationId,
        decision: qualityDispositionEvents.decision,
        fromDisposition: qualityDispositionEvents.fromDisposition,
        toDisposition: qualityDispositionEvents.toDisposition,
        inventoryEventId: qualityDispositionEvents.inventoryEventId,
      })
      .from(qualityDispositionEvents)
      .where(eq(qualityDispositionEvents.lotId, blockedLotId));
    expect(qualityEvent.organizationId).toBe(getOrgId());
    expect(qualityEvent.decision).toBe("release");
    expect(qualityEvent.fromDisposition).toBe("blocked");
    expect(qualityEvent.toDisposition).toBe("available");

    const [stockEvent] = await db
      .select({
        eventType: inventoryEvents.eventType,
        fromDisposition: inventoryEvents.fromDisposition,
        toDisposition: inventoryEvents.toDisposition,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.id, qualityEvent.inventoryEventId));
    expect(stockEvent).toMatchObject({
      eventType: "quality_disposition_change",
      fromDisposition: "blocked",
      toDisposition: "available",
    });

    const customer = await createCustomer({ name: uniqueName("Release customer") });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      status: "draft",
      lines: [{ itemId: blockedItemId, quantity: "4", unitPrice: "9.00" }],
    });
    expect(order.status).toBe(201);
    expect((await confirmSalesOrder(order.body.id)).status).toBe(200);
    expect((await fulfillSalesOrder(order.body.id)).status).toBe(200);

    const afterShip = await getLotBalances(db, blockedItemId);
    expect(dispositionQuantity(afterShip, "available")).toBe("0.0000");
    expect(dispositionQuantity(afterShip, "blocked")).toBe("6.0000");
    expect((await getItemBalance(db, blockedItemId)).onHandQty).toBe("6.0000");
  });

  test("reject and scrap decisions stay audited and remove physical quantity", async ({
    db,
  }) => {
    const rejected = await applyDisposition({
      itemId: blockedItemId,
      lotId: blockedLotId,
      action: "reject",
      fromDisposition: "blocked",
      quantity: "2",
      idempotencyKey: `disposition-test:reject:${blockedLotId}`,
    });
    expect(rejected.status).toBe(200);

    const replay = await applyDisposition({
      itemId: blockedItemId,
      lotId: blockedLotId,
      action: "reject",
      fromDisposition: "blocked",
      quantity: "2",
      idempotencyKey: `disposition-test:reject:${blockedLotId}`,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.eventId).toBe(rejected.body.eventId);

    let balances = await getLotBalances(db, blockedItemId);
    expect(dispositionQuantity(balances, "blocked")).toBe("4.0000");
    expect(dispositionQuantity(balances, "rejected")).toBe("2.0000");

    const scrap = await applyDisposition({
      itemId: blockedItemId,
      lotId: blockedLotId,
      action: "scrap",
      fromDisposition: "rejected",
      quantity: "1",
      notes: "Damaged package",
    });
    expect(scrap.status).toBe(200);

    balances = await getLotBalances(db, blockedItemId);
    expect(dispositionQuantity(balances, "rejected")).toBe("1.0000");
    expect((await getItemBalance(db, blockedItemId)).onHandQty).toBe("5.0000");

    const [scrapDecision] = await db
      .select({
        decision: qualityDispositionEvents.decision,
        fromDisposition: qualityDispositionEvents.fromDisposition,
        toDisposition: qualityDispositionEvents.toDisposition,
        notes: qualityDispositionEvents.notes,
      })
      .from(qualityDispositionEvents)
      .where(eq(qualityDispositionEvents.inventoryEventId, scrap.body.eventId));
    expect(scrapDecision).toMatchObject({
      decision: "scrap",
      fromDisposition: "rejected",
      toDisposition: null,
      notes: "Damaged package",
    });
  });

  test("manufacturing output can complete into blocked without becoming available", async ({
    db,
  }) => {
    const componentId = await createMaterial(uniqueName("Output component"), "1");
    const productId = await createProduct(uniqueName("Blocked output product"), componentId);
    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "1",
      ingredients: [{ itemId: componentId, quantityPerUnit: "1" }],
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.body.id));
    const picked = await testFetch(
      `/api/manufacturing-orders/${order.body.id}/ingredients/${ingredient.id}/pick`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(picked.status).toBe(200);

    expect(
      (
        await completeManufacturingOrder(order.body.id, "1", {
          outputDisposition: "blocked",
        })
      ).status
    ).toBe(200);

    const productBalances = await getLotBalances(db, productId);
    expect(dispositionQuantity(productBalances, "blocked")).toBe("1.0000");
    expect(dispositionQuantity(productBalances, "available")).toBe("0.0000");
    const productBalance = await getItemBalance(db, productId);
    expect(productBalance.onHandQty).toBe("1.0000");
    expect(productBalance.availableToPromise).toBe("0.0000");
  });
});
