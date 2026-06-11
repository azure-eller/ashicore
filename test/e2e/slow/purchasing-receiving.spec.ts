import { and, asc, eq } from "drizzle-orm";
import { test, expect, filterList } from "../fixtures";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  purchaseOrderLines,
  purchaseOrders,
} from "../../../lib/db/schema";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
  updateItem,
} from "../../helpers/api";
import { TEST_ACCOUNT_EMAIL } from "../../helpers/test-account";
import { createMaterialFixture, expectResponse, unitId } from "./story-helpers";

test.describe("purchasing receiving operating story", () => {
  test.describe.configure({ mode: "serial" });

  let materialId: string;
  let materialName: string;
  let orderId: string;
  let orderNumber: string;
  let lineId: string;

  test("Ash stages a purchase order and approval commits the draft", async ({ db, page }) => {
    // Real LLM turns (discover → query → stage) precede the staging wait, so this
    // needs a budget beyond the 90s default — same as the sales staging test.
    test.setTimeout(180_000);

    const material = await createMaterialFixture({
      name: "Ash Purchasing Approval Material",
      stock: "0",
      cost: "4.50",
    });
    const supplier = await createSupplier({
      name: `Ash Purchasing Approval Supplier ${Date.now()}`,
    });
    expectResponse(supplier);
    const supplierId = supplier.body.id as string;

    await page.goto("/purchasing/orders");
    await page.getByRole("button", { name: "Open Ash assistant" }).click();

    const composer = page.locator("#dashboard-agent-chat-sheet textarea");
    await composer.fill(
      `Stage a purchase order from the supplier "${supplier.body.name}" for 5 units of "${material.name}" at a unit cost of 4.50. Use the query tool to find their ids first, then stage the order. Do not ask me to confirm.`
    );
    await composer.press("Enter");

    await expect(page.getByText("Staged · not applied")).toBeVisible({ timeout: 120_000 });

    const beforeApprove = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, supplierId));
    expect(beforeApprove).toHaveLength(0);

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByText("Review changes")).toBeVisible();
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByText("Purchase order created")).toBeVisible({ timeout: 30_000 });

    const orders = await db
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, supplierId));
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("draft");

    const lines = await db
      .select({
        itemId: purchaseOrderLines.itemId,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        unitCost: purchaseOrderLines.unitCost,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orders[0].id));
    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe(material.id);
    expect(Number(lines[0].quantityOrdered)).toBe(5);
    expect(Number(lines[0].unitCost)).toBe(4.5);
  });

  test("creates and submits a purchase order as expected supply", async ({ db, page }) => {
    const material = await createMaterialFixture({
      name: "Purchasing Story Material",
      stock: "0",
      cost: "4.00",
    });
    materialId = material.id;
    materialName = material.name;

    const supplier = await createSupplier({
      name: `Receiving Story Supplier ${Date.now()}`,
      contactName: "Pat Receiving",
      email: "receiving@example.com",
    });
    expectResponse(supplier);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-06-07",
      notes: "Partial receiving story",
      lines: [{ itemId: materialId, quantityOrdered: "12", unitCost: "4.00" }],
    });
    expectResponse(order);
    orderId = order.body.id as string;

    const submit = await submitPurchaseOrder(orderId);
    expect(submit.status).toBe(200);

    const [savedOrder] = await db
      .select({ orderNumber: purchaseOrders.orderNumber, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    orderNumber = savedOrder.orderNumber;
    expect(savedOrder.status).toBe("ordered");

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
    lineId = line.id;

    const [expected] = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.itemId, materialId),
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, lineId)
        )
      );
    expect(expected.quantity).toBe("12.0000");

    await page.goto("/purchasing/orders");
    await filterList(page, "Search purchase orders", orderNumber);
    await expect(page.getByRole("row").filter({ hasText: orderNumber })).toContainText(
      supplier.body.name
    );
  });

  test("sends purchase order documents and keeps the email sheet current", async ({
    page,
  }) => {
    await page.goto(`/purchasing/order/${orderId}`);
    await page.getByRole("button", { name: /PO email/ }).click();

    const sheet = page.getByRole("dialog", { name: /Send documents/ });
    await expect(sheet.getByLabel(/Include/)).toBeChecked();
    await expect(sheet.getByLabel("BCC")).toHaveValue(TEST_ACCOUNT_EMAIL);
    await expect(sheet.getByLabel("Subject")).toBeVisible();

    await sheet.getByRole("button", { expanded: true }).click();
    await expect(sheet.getByRole("link", { name: /PO-.*\.pdf/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Add documents/ })).toBeVisible();
    await sheet.locator('button[aria-expanded="false"]').first().click();

    const emailResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/purchase-orders/${orderId}/email`) &&
        response.request().method() === "POST",
    );
    await sheet.getByRole("button", { name: "Send 1 email" }).click();
    expect((await emailResponse).status()).toBe(200);
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: /PO email/ }).click();
    await expect(sheet.getByText(/Already sent/)).toBeVisible();
    await expect(sheet.getByLabel(/Include/)).not.toBeChecked();
    await expect(sheet.getByRole("link", { name: /PO-.*\.pdf/ })).toBeVisible();
  });

  test("partial receipt converts only received quantity into physical stock", async ({ db, page }) => {
    await page.goto(`/purchasing/order/${orderId}`);
    await page.getByLabel("Change status: Ordered").click();
    await page.getByRole("menuitem", { name: "Partially received" }).click();
    await expect(page.getByRole("dialog", { name: "Receive purchase order" })).toBeVisible();
    await page.getByLabel(`Quantity received for ${materialName}`).fill("5");
    const receiveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/purchase-orders/${orderId}/receive`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Receive selected" }).click();
    expect((await receiveResponse).status()).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, materialId));
    expect(balance).toMatchObject({
      onHandQty: "5.0000",
      expectedQty: "7.0000",
    });

    const [order] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    expect(order.status).toBe("partial");

    await expect(page.locator("main")).toContainText(materialName);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete purchase order" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("final receipt closes expected supply and leaves lot-backed stock truth", async ({
    db,
    page,
  }) => {
    await page.goto(`/purchasing/order/${orderId}`);
    await page.getByLabel("Change status: Partially received").click();
    await page.getByRole("menuitem", { name: "Partially received" }).click();
    await expect(page.getByRole("dialog", { name: "Receive purchase order" })).toBeVisible();
    await page.getByLabel(`Quantity received for ${materialName}`).fill("7");
    const receiveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/purchase-orders/${orderId}/receive`) &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Receive selected" }).click();
    expect((await receiveResponse).status()).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, materialId));
    expect(balance).toMatchObject({
      onHandQty: "12.0000",
      expectedQty: "0.0000",
    });

    const lots = await db
      .select({ quantity: inventoryLotBalances.quantity, unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, materialId));
    expect(lots.reduce((sum, lot) => sum + Number(lot.quantity), 0)).toBe(12);
    expect(lots.every((lot) => lot.unitCost === "4.000000")).toBe(true);

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(events.map((event) => event.quantity).sort()).toEqual(["5.0000", "7.0000"]);

    const [order] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    expect(order.status).toBe("received");
  });
});

async function freightedPurchaseOrderBody(opts: {
  supplierId: string;
  itemId: string;
  unitCost: string;
  freight: string;
  expectedDate: string;
}) {
  return JSON.stringify({
    supplierId: opts.supplierId,
    expectedDate: opts.expectedDate,
    shippingCost: opts.freight,
    notes: null,
    accountingPurchaseAccountCode: null,
    lines: [{ itemId: opts.itemId, quantityOrdered: "10", unitCost: opts.unitCost }],
    additionalCosts: [
      {
        costType: "shipping",
        reference: "Freight",
        distributionMethod: "by_value",
        accountingPurchaseAccountCode: null,
        amount: opts.freight,
      },
    ],
  });
}

test.describe("editable freight revaluation after receipt", () => {
  test.describe.configure({ mode: "serial" });

  let materialId: string;
  let supplierId: string;
  let orderId: string;
  let lineId: string;
  let lotId: string;

  test("receives a freighted PO so the lot carries landed cost", async ({ db }) => {
    const material = await createMaterialFixture({
      name: "Freight Reval Material",
      stock: "0",
      cost: "10.00",
    });
    materialId = material.id;

    const supplier = await createSupplier({ name: `Freight Reval Supplier ${Date.now()}` });
    expectResponse(supplier);
    supplierId = supplier.body.id as string;

    // Freight 20 across 10 units => landed unit cost 12.
    const create = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: await freightedPurchaseOrderBody({
        supplierId,
        itemId: materialId,
        unitCost: "10.00",
        freight: "20.00",
        expectedDate: "2026-06-20",
      }),
    });
    const order = await create.json();
    expect(create.status).toBe(201);
    orderId = order.id as string;
    expect((await submitPurchaseOrder(orderId)).status).toBe(200);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
    lineId = line.id;
    expect(
      (await receivePurchaseOrder(orderId, {
        lines: [{ lineId, quantityReceived: "10" }],
      })).status
    ).toBe(200);

    const [lot] = await db
      .select({ lotId: inventoryLotBalances.lotId, unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, materialId));
    lotId = lot.lotId;
    expect(lot.unitCost).toBe("12.000000");
  });

  test("editing freight rebases on-hand cost via append-only revaluation, receipt untouched", async ({
    db,
  }) => {
    const [receiptBefore] = await db
      .select({
        id: inventoryEvents.id,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );

    // Freight 20 -> 50 => landed unit cost 15.
    const edit = await testFetch(`/api/purchase-orders/${orderId}`, {
      method: "PUT",
      body: await freightedPurchaseOrderBody({
        supplierId,
        itemId: materialId,
        unitCost: "10.00",
        freight: "50.00",
        expectedDate: "2026-06-20",
      }),
    });
    expect(edit.status, await edit.text()).toBe(200);

    const [reval] = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
        lotId: inventoryEvents.lotId,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      )
      .orderBy(asc(inventoryEvents.occurredAt));
    expect(reval).toMatchObject({
      quantity: "0.0000",
      unitCost: "15.000000",
      extendedCost: "30.000000",
      lotId,
      referenceType: "purchase_order",
      referenceId: orderId,
    });

    const [lot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, lotId));
    expect(lot.unitCost).toBe("15.000000");

    const [item] = await db
      .select({ currentStockUnitCost: items.currentStockUnitCost })
      .from(items)
      .where(eq(items.id, materialId));
    expect(item.currentStockUnitCost).toBe("15.000000");

    const [receiptAfter] = await db
      .select({
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.id, receiptBefore.id));
    expect(receiptAfter).toMatchObject({
      unitCost: receiptBefore.unitCost,
      extendedCost: receiptBefore.extendedCost,
    });
  });

  test("freight edit after consumption saves and revalues remaining available stock", async ({ db }) => {
    // Draw down 4 of the 10 received units.
    const decrease = await updateItem(materialId, {
      stock: "6",
      defaultPurchasePrice: "10.00",
    });
    expect(decrease.status, JSON.stringify(decrease.body)).toBeLessThan(400);

    const edit = await testFetch(`/api/purchase-orders/${orderId}`, {
      method: "PUT",
      body: await freightedPurchaseOrderBody({
        supplierId,
        itemId: materialId,
        unitCost: "10.00",
        freight: "80.00",
        expectedDate: "2026-06-20",
      }),
    });
    expect(edit.status, await edit.text()).toBe(200);

    const revals = await db
      .select({
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      )
      .orderBy(asc(inventoryEvents.occurredAt));
    expect(revals).toHaveLength(2);
    expect(revals.at(-1)).toMatchObject({
      unitCost: "18.000000",
      extendedCost: "18.000000",
    });

    const [lot] = await db
      .select({ quantity: inventoryLotBalances.quantity, unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, lotId));
    expect(lot).toMatchObject({
      quantity: "6.0000",
      unitCost: "18.000000",
    });
  });

  test("freight edits save for untracked received material but skip v1 revaluation", async ({ db }) => {
    const created = await createItem({
      itemType: "material",
      name: `Freight Untracked Material ${Date.now()}`,
      unitDefinitionId: unitId,
      sku: `SLOW-FREIGHT-UNTRACKED-${Date.now()}`,
      category: "Slow Story",
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expectResponse(created);
    const untrackedId = created.body.id as string;

    const mode = await testFetch(`/api/item-cards/${untrackedId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: created.body.name,
        category: "Slow Story",
        description: null,
        unitDefinitionId: unitId,
        lotTrackingMode: "untracked",
      }),
    });
    expect(mode.status, await mode.text()).toBe(200);

    const supplier = await createSupplier({ name: `Freight Untracked Supplier ${Date.now()}` });
    expectResponse(supplier);
    const create = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: await freightedPurchaseOrderBody({
        supplierId: supplier.body.id as string,
        itemId: untrackedId,
        unitCost: "10.00",
        freight: "20.00",
        expectedDate: "2026-06-21",
      }),
    });
    const order = await create.json();
    expect(create.status).toBe(201);
    expect((await submitPurchaseOrder(order.id)).status).toBe(200);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    expect(
      (await receivePurchaseOrder(order.id, {
        lines: [{ lineId: line.id, quantityReceived: "10" }],
      })).status
    ).toBe(200);

    const edit = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: await freightedPurchaseOrderBody({
        supplierId: supplier.body.id as string,
        itemId: untrackedId,
        unitCost: "10.00",
        freight: "50.00",
        expectedDate: "2026-06-21",
      }),
    });
    expect(edit.status, await edit.text()).toBe(200);

    const revals = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, untrackedId),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      );
    expect(revals).toHaveLength(0);

    const [savedOrder] = await db
      .select({ shippingCost: purchaseOrders.shippingCost })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(savedOrder.shippingCost).toBe("50.0000");
  });
});
