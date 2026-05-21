import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryReservationsSummary,
  salesOrderLines,
  salesOrders,
  salesShipmentCosts,
  salesShipmentLines,
  salesShipments,
} from "../../../lib/db/schema";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createSalesOrder,
  getUnitId,
  testFetch,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function createMaterial(name: string, stock: string) {
  const result = await createItem({
    name,
    itemType: "material",
    unitDefinitionId: getUnitId(),
    sku: name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48),
    category: "Partial sales shipments",
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

async function createCustomerFixture(name: string) {
  const result = await createCustomer({ name });
  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function createDraftSalesOrder(params: {
  customerId: string;
  itemId: string;
  quantity: string;
}) {
  const result = await createSalesOrder({
    customerId: params.customerId,
    status: "open",
    shipDate: "2026-04-15",
    lines: [
      {
        itemId: params.itemId,
        quantity: params.quantity,
        unitPrice: "9.00",
      },
    ],
    shipments: [
      {
        fulfillmentType: "delivery",
        scheduledDate: "2026-04-15",
        deliveryDate: "2026-04-15",
        notes: null,
        lines: [{ itemId: params.itemId, quantity: params.quantity }],
      },
    ],
  });

  expect(result.status).toBe(201);
  return result.body.id as string;
}

async function getItemBalance(db: TestDb, itemId: string) {
  const [balance] = await db
    .select({
      onHandQty: inventoryItemBalances.onHandQty,
      committedQty: inventoryItemBalances.committedQty,
      demandQty: inventoryItemBalances.demandQty,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  if (!balance) {
    throw new Error(`Missing inventory balance for item ${itemId}`);
  }

  return balance;
}

async function getReservationTotal(db: TestDb, itemId: string) {
  const [row] = await db
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryReservationsSummary.quantity}), 0)`,
    })
    .from(inventoryReservationsSummary)
    .where(eq(inventoryReservationsSummary.itemId, itemId));

  return row?.quantity ?? "0";
}

async function getDemandTotal(db: TestDb, itemId: string) {
  const [row] = await db
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)`,
    })
    .from(inventoryDemandSummary)
    .where(eq(inventoryDemandSummary.itemId, itemId));

  return row?.quantity ?? "0";
}

test.describe("Partial sales shipments", () => {
  test.describe.configure({ mode: "serial" });

  test("consume and release only shipped quantities", async ({ page, db }) => {
    const customerName = uniqueName("Partial shipment customer");
    const itemName = uniqueName("Partial shipment material");
    const customerId = await createCustomerFixture(customerName);
    const itemId = await createMaterial(itemName, "10");
    const orderId = await createDraftSalesOrder({
      customerId,
      itemId,
      quantity: "10",
    });

    expect((await confirmSalesOrder(orderId)).status).toBe(200);

    const [orderHeader] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.getByRole("heading", { name: orderHeader.orderNumber })).toBeVisible();
    await expect(page.locator("main")).toContainText(itemName);
    await expect(page.locator("main")).toContainText("10");

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));

    const [autoShipment] = await db
      .select({ id: salesShipments.id })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(autoShipment.id).toBeTruthy();

    const firstShipment = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${autoShipment.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fulfillmentType: "pickup",
          scheduledDate: "2026-04-15",
          notes: "First partial pickup",
          lines: [{ salesOrderLineId: line.id, quantity: "4" }],
        }),
      }
    );
    expect(firstShipment.status).toBe(200);
    const firstShipmentBody = { id: autoShipment.id };

    const overlappingShipment = await testFetch(`/api/sales-orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({
        fulfillmentType: "pickup",
        scheduledDate: "2026-04-15",
        notes: null,
        lines: [{ salesOrderLineId: line.id, quantity: "7" }],
      }),
    });
    expect(overlappingShipment.status).toBe(400);

    const draftBol = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${firstShipmentBody.id}/bol`
    );
    expect(draftBol.status).toBe(200);
    expect(draftBol.headers.get("content-type")).toContain("application/pdf");

    const shipFirst = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${firstShipmentBody.id}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    expect(shipFirst.status).toBe(200);

    const [partialOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(partialOrder.status).toBe("open");
    expect(partialOrder.shippedAt).toBeNull();

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.locator("main")).toContainText("1 of 1 shipped");
    await expect(page.locator("main")).toContainText("SHIPPED");

    let balance = await getItemBalance(db, itemId);
    expect(balance.onHandQty).toBe("6.0000");
    expect(balance.committedQty).toBe("6.0000");
    expect(balance.demandQty).toBe("6.0000");
    expect(await getReservationTotal(db, itemId)).toBe("6.0000");
    expect(await getDemandTotal(db, itemId)).toBe("6.0000");

    const [firstConsumption] = await db
      .select({
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.eventType, "sales_consumption"),
          eq(inventoryEvents.referenceId, firstShipmentBody.id)
        )
      );
    expect(firstConsumption.referenceType).toBe("sales_shipment");
    expect(firstConsumption.quantity).toBe("4.0000");

    const [eventCountBeforeCostEdit] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));

    const costUpdate = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${firstShipmentBody.id}/costs`,
      {
        method: "PUT",
        body: JSON.stringify({
          customerFreightChargeAmount: null,
          costs: [
            {
              costType: "freight",
              costStatus: "estimated",
              amount: "12.50",
              vendorName: "Quoted carrier",
              referenceNumber: null,
              incurredDate: null,
              notes: null,
            },
            {
              costType: "freight",
              costStatus: "actual",
              amount: "15.00",
              vendorName: "Actual carrier",
              referenceNumber: "INV-1",
              incurredDate: "2026-04-16",
              notes: "Carrier invoice",
            },
          ],
        }),
      }
    );
    expect(costUpdate.status).toBe(200);

    const [eventCountAfterCostEdit] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));
    expect(eventCountAfterCostEdit.count).toBe(eventCountBeforeCostEdit.count);

    const costRows = await db
      .select({
        costStatus: salesShipmentCosts.costStatus,
        amount: salesShipmentCosts.amount,
      })
      .from(salesShipmentCosts)
      .where(eq(salesShipmentCosts.salesShipmentId, firstShipmentBody.id));
    expect(costRows).toHaveLength(2);

    const orderDetail = await testFetch(`/api/sales-orders/${orderId}`);
    expect(orderDetail.status).toBe(200);
    const orderDetailBody = await orderDetail.json();
    const firstDetailShipment = orderDetailBody.shipments.find(
      (shipment: { id: string }) => shipment.id === firstShipmentBody.id
    );
    expect(firstDetailShipment.marginSummary).toMatchObject({
      productRevenue: "36",
      freightRecovery: "0",
      productCogs: "4",
      shipmentCosts: "15",
      contributionMargin: "17",
      marginPercent: "47.2",
      costStatus: "actual",
    });

    const secondShipment = await testFetch(`/api/sales-orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({
        fulfillmentType: "pickup",
        scheduledDate: "2026-04-16",
        notes: "Final pickup",
        lines: [{ salesOrderLineId: line.id, quantity: "6" }],
      }),
    });
    const secondShipmentBody =
      secondShipment.status === 201
        ? await secondShipment.json()
        : await db
            .select({ id: salesShipments.id })
            .from(salesShipments)
            .where(
              and(
                eq(salesShipments.salesOrderId, orderId),
                eq(salesShipments.status, "planned")
              )
            )
            .then((rows) => rows[0]);
    expect(secondShipmentBody?.id).toBeTruthy();

    const [secondHeader] = await db
      .select({
        sequence: salesShipments.sequence,
        shipmentNumber: salesShipments.shipmentNumber,
      })
      .from(salesShipments)
      .where(eq(salesShipments.id, secondShipmentBody.id));
    expect(secondHeader.sequence).toBe(2);
    expect(secondHeader.shipmentNumber).toMatch(/-S2$/);

    const [secondLine] = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, secondShipmentBody.id));
    expect(secondLine.quantity).toBe("6.0000");

    const shipSecond = await testFetch(
      `/api/sales-orders/${orderId}/shipments/${secondShipmentBody.id}/ship`,
      {
        method: "POST",
        body: JSON.stringify({ syncAccounting: false, sendEmail: false }),
      }
    );
    expect(shipSecond.status).toBe(200);

    const [shippedOrder] = await db
      .select({ status: salesOrders.status, shippedAt: salesOrders.shippedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(shippedOrder.status).toBe("done");
    expect(shippedOrder.shippedAt).not.toBeNull();

    await page.goto(`/sales/orders/${orderId}`);
    await expect(page.locator("main").getByText("SHIPPED", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main")).toContainText("2 of 2 shipped");
    await expect(page.locator("main")).toContainText("SHIPPED");

    balance = await getItemBalance(db, itemId);
    expect(balance.onHandQty).toBe("0.0000");
    expect(balance.committedQty).toBe("0.0000");
    expect(balance.demandQty).toBe("0.0000");
    expect(await getReservationTotal(db, itemId)).toBe("0");
    expect(await getDemandTotal(db, itemId)).toBe("0");
  });
});
