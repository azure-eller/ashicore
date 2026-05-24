import { and, eq } from "drizzle-orm";
import { test, expect, filterList } from "../fixtures";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  purchaseOrderLines,
  purchaseOrders,
} from "../../../lib/db/schema";
import {
  createPurchaseOrder,
  createSupplier,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from "../../helpers/api";
import { createMaterialFixture, expectResponse } from "./story-helpers";

test.describe("purchasing receiving operating story", () => {
  test.describe.configure({ mode: "serial" });

  let materialId: string;
  let materialName: string;
  let orderId: string;
  let orderNumber: string;
  let lineId: string;

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

  test("partial receipt converts only received quantity into physical stock", async ({ db, page }) => {
    const receipt = await receivePurchaseOrder(orderId, {
      lines: [{ lineId, quantityReceived: "5" }],
    });
    expect(receipt.status).toBe(200);

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

    await page.goto(`/purchasing/order/${orderId}`);
    await expect(page.locator("main")).toContainText(materialName);
  });

  test("final receipt closes expected supply and leaves lot-backed stock truth", async ({ db }) => {
    const receipt = await receivePurchaseOrder(orderId, {
      lines: [{ lineId, quantityReceived: "7" }],
    });
    expect(receipt.status).toBe(200);

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
