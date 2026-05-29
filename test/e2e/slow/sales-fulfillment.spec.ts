import { and, eq, isNull } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
} from "../../../lib/db/schema";
import {
  createCustomerCategory,
  createPricingSchedule,
  createSalesOrder,
  getOrgId,
  testFetch,
} from "../../helpers/api";
import {
  createConfirmedSalesOrder,
  createCustomerFixture,
  createMaterialFixture,
  createSellableProductFixture,
  readSalesOrder,
  readSalesOrderLine,
  searchOrderList,
} from "./story-helpers";

async function expectSuggestedPrice(params: {
  customerId: string;
  itemId: string;
  quantity: string;
  suggestedUnitPrice: string;
  pricingScheduleName: string;
}) {
  const response = await testFetch("/api/sales-orders/price", {
    method: "POST",
    body: JSON.stringify({
      customerId: params.customerId,
      itemId: params.itemId,
      quantity: params.quantity,
    }),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    pricingSourceType: "schedule_break",
    pricingScheduleName: params.pricingScheduleName,
  });
  expect(Number(body.suggestedUnitPrice)).toBe(Number(params.suggestedUnitPrice));
}

test.describe("sales fulfillment operating story", () => {
  test.describe.configure({ mode: "serial" });

  let productId: string;
  let componentId: string;
  let customerId: string;
  let orderId: string;
  let orderNumber: string;

  test("creates customer context and sales demand without consuming stock", async ({ db, page }) => {
    const component = await createMaterialFixture({
      name: "Sales Story Component",
      stock: "25",
      cost: "3.00",
    });
    const product = await createSellableProductFixture({
      name: "Sales Story Product",
      stock: "10",
      price: "18.00",
      bom: [{ componentId: component.id, quantity: "1" }],
    });
    productId = product.id;
    componentId = component.id;

    const customer = await createCustomerFixture({
      name: "Sales Story Customer",
      email: "fulfillment@example.com",
      shipLine1: "44 Fulfillment Road",
      shipCity: "Crawford",
      shipRegion: "CO",
      shipPostcode: "81415",
    });
    customerId = customer.id;

    orderId = await createConfirmedSalesOrder({
      customerId,
      productId,
      quantity: "6",
      unitPrice: "18.00",
    });
    const order = await readSalesOrder(db, orderId);
    orderNumber = order.orderNumber;

    expect(order).toMatchObject({
      customerId,
      customerName: customer.name,
    });

    const line = await readSalesOrderLine(db, orderId, productId);
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, productId),
          eq(inventoryDemandSummary.referenceType, "sales_order_line"),
          eq(inventoryDemandSummary.referenceId, line.id)
        )
      );
    expect(demand.quantity).toBe("6.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "10.0000",
      demandQty: "6.0000",
      availableToPromise: "4.0000",
    });

    const row = await searchOrderList(page, orderNumber);
    await expect(row).toContainText(customer.name);
  });

  test("partial shipment keeps the order open and consumes only shipped stock", async ({ db, page }) => {
    const line = await readSalesOrderLine(db, orderId, productId);
    const ship = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [order] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(order.status).toBe("open");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "7.0000",
      demandQty: "3.0000",
    });

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events.map((event) => event.quantity)).toEqual(["3.0000"]);

    const [shipment] = await db
      .select({
        id: salesShipments.id,
        status: salesShipments.status,
        shipmentNumber: salesShipments.shipmentNumber,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipment).toMatchObject({
      status: "shipped",
      shipmentNumber: `${orderNumber}-S1`,
    });

    const shipmentLines = await db
      .select({ quantity: salesShipmentLines.quantity })
      .from(salesShipmentLines)
      .where(eq(salesShipmentLines.salesShipmentId, shipment.id));
    expect(shipmentLines.map((shipmentLine) => shipmentLine.quantity)).toEqual([
      "3.0000",
    ]);

    const row = await searchOrderList(page, orderNumber);
    await expect(row).toContainText(orderNumber);
  });

  test("final shipment closes demand and consumes stock once", async ({ db }) => {
    const line = await readSalesOrderLine(db, orderId, productId);
    const ship = await testFetch(`/api/sales-orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "4.0000",
      demandQty: "0.0000",
    });

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events.map((event) => event.quantity).sort()).toEqual(["3.0000", "3.0000"]);

    const shipments = await db
      .select({
        id: salesShipments.id,
        shipmentNumber: salesShipments.shipmentNumber,
        status: salesShipments.status,
      })
      .from(salesShipments)
      .where(eq(salesShipments.salesOrderId, orderId));
    expect(shipments.map((shipment) => shipment.shipmentNumber).sort()).toEqual([
      `${orderNumber}-S1`,
      `${orderNumber}-S2`,
    ]);
    expect(shipments.every((shipment) => shipment.status === "shipped")).toBe(true);

    const [order] = await db
      .select({
        status: salesOrders.status,
        shipLine1: salesOrders.shipLine1,
        shipCity: salesOrders.shipCity,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(order.status).toBe("done");
    expect(order.shipLine1).toBe("44 Fulfillment Road");
    expect(order.shipCity).toBe("Crawford");

    const lines = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(lines[0].cancelledQuantity).toBe("0.0000");
  });

  test("deleting a confirmed order releases committed stock", async ({ db }) => {
    const deleteOrderId = await createConfirmedSalesOrder({
      customerId,
      productId,
      quantity: "2",
      unitPrice: "18.00",
    });

    const [productBefore] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(Number(productBefore.committedQty)).toBeGreaterThan(0);

    const deleteResponse = await testFetch(`/api/sales-orders/${deleteOrderId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: salesOrders.deletedAt })
      .from(salesOrders)
      .where(eq(salesOrders.id, deleteOrderId));
    expect(deletedOrder.deletedAt).toBeTruthy();

    const [productAfter] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    const [componentAfter] = await db
      .select({ committedQty: inventoryItemBalances.committedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, componentId));
    expect(productAfter.committedQty).toBe("0.0000");
    expect(componentAfter.committedQty).toBe("0.0000");
  });

  test("resolves sales pricing schedules by best price and quantity break", async ({ db }) => {
    await db
      .update(pricingSchedules)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(pricingSchedules.organizationId, getOrgId()),
          isNull(pricingSchedules.deletedAt)
        )
      );

    const categoryName = `Pricing Tier ${Date.now()}`;
    const categoryResponse = await createCustomerCategory({
      name: categoryName,
    });
    expect(categoryResponse.status).toBe(201);
    const customerCategoryId = categoryResponse.body.id as string;

    const tierCustomer = await createCustomerFixture({
      name: "Pricing Tier Customer",
      customerCategoryId,
    });
    const openCustomer = await createCustomerFixture({
      name: "Pricing Open Customer",
    });
    const compost = await createSellableProductFixture({
      name: "Pricing Compost Product",
      category: "Pricing Compost",
      price: "100.00",
    });
    const mulch = await createSellableProductFixture({
      name: "Pricing Mulch Product",
      category: "Pricing Mulch",
      price: "100.00",
    });

    const schedules = [
      {
        name: `All Customers All Items ${Date.now()}`,
        customerCategoryId: null,
        itemIds: [],
        discountPercent: "10",
      },
      {
        name: `All Customers Compost ${Date.now()}`,
        customerCategoryId: null,
        itemIds: [compost.id],
        discountPercent: "20",
      },
      {
        name: `Tier All Items ${Date.now()}`,
        customerCategoryId,
        itemIds: [],
        discountPercent: "30",
      },
      {
        name: `Tier Compost ${Date.now()}`,
        customerCategoryId,
        itemIds: [compost.id],
        discountPercent: "40",
      },
    ];

    for (const schedule of schedules) {
      const response = await createPricingSchedule({
        name: schedule.name,
        customerCategoryId: schedule.customerCategoryId,
        itemIds: schedule.itemIds,
        breaks: [
          {
            minQuantity: "1",
            maxQuantity: null,
            discountPercent: schedule.discountPercent,
          },
        ],
      });
      expect(response.status).toBe(201);
    }

    await expectSuggestedPrice({
      customerId: tierCustomer.id,
      itemId: compost.id,
      quantity: "2",
      suggestedUnitPrice: "60.00",
      pricingScheduleName: schedules[3].name,
    });
    await expectSuggestedPrice({
      customerId: tierCustomer.id,
      itemId: mulch.id,
      quantity: "2",
      suggestedUnitPrice: "70.00",
      pricingScheduleName: schedules[2].name,
    });
    await expectSuggestedPrice({
      customerId: openCustomer.id,
      itemId: compost.id,
      quantity: "2",
      suggestedUnitPrice: "80.00",
      pricingScheduleName: schedules[1].name,
    });
    await expectSuggestedPrice({
      customerId: openCustomer.id,
      itemId: mulch.id,
      quantity: "2",
      suggestedUnitPrice: "90.00",
      pricingScheduleName: schedules[0].name,
    });

    const literalAllProduct = await createSellableProductFixture({
      name: "Pricing Literal All Product",
      category: "Pricing Literal",
      price: "100.00",
    });
    const literalAllScheduleName = `Literal Item ${Date.now()}`;
    const literalAllSchedule = await createPricingSchedule({
      name: literalAllScheduleName,
      itemIds: [literalAllProduct.id],
      breaks: [
        { minQuantity: "1", maxQuantity: null, discountPercent: "55" },
      ],
    });
    expect(literalAllSchedule.status).toBe(201);
    await expectSuggestedPrice({
      customerId: openCustomer.id,
      itemId: literalAllProduct.id,
      quantity: "2",
      suggestedUnitPrice: "45.00",
      pricingScheduleName: literalAllScheduleName,
    });

    const favorableProduct = await createSellableProductFixture({
      name: "Pricing Favorable Product",
      category: "Pricing Favorable",
      price: "100.00",
    });
    const specificButWorseSchedule = await createPricingSchedule({
      name: `Specific But Worse ${Date.now()}`,
      itemIds: [favorableProduct.id],
      breaks: [
        { minQuantity: "1", maxQuantity: null, discountPercent: "5" },
      ],
    });
    expect(specificButWorseSchedule.status).toBe(201);
    await expectSuggestedPrice({
      customerId: openCustomer.id,
      itemId: favorableProduct.id,
      quantity: "2",
      suggestedUnitPrice: "90.00",
      pricingScheduleName: schedules[0].name,
    });

    const snapshotProduct = await createSellableProductFixture({
      name: "Pricing Snapshot Product",
      category: "Pricing Snapshot",
      price: "100.00",
    });
    const snapshotScheduleName = `Snapshot Pricing ${Date.now()}`;
    const snapshotSchedule = await createPricingSchedule({
      name: snapshotScheduleName,
      itemIds: [snapshotProduct.id],
      breaks: [
        { minQuantity: "1", maxQuantity: null, discountPercent: "25" },
      ],
    });
    expect(snapshotSchedule.status).toBe(201);
    const snapshotOrder = await createSalesOrder({
      customerId: openCustomer.id,
      status: "open",
      lines: [
        {
          itemId: snapshotProduct.id,
          quantity: "2",
          unitPrice: "75.00",
        },
      ],
    });
    expect(snapshotOrder.status).toBe(201);
    const snapshotLine = await readSalesOrderLine(
      db,
      snapshotOrder.body.id as string,
      snapshotProduct.id
    );
    expect(snapshotLine.listUnitPrice).toBe("100.00");
    expect(snapshotLine.discountPercent).toBe("25.00");

    const updateSnapshotSchedule = await testFetch(
      `/api/pricing-schedules/${snapshotSchedule.body.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: snapshotScheduleName,
          customerCategoryId: null,
          itemScope: "selected",
          itemIds: [snapshotProduct.id],
          notes: null,
          breaks: [
            { minQuantity: "1", maxQuantity: null, discountPercent: "40" },
          ],
        }),
      }
    );
    expect(updateSnapshotSchedule.status).toBe(200);
    const unchangedSnapshotLine = await readSalesOrderLine(
      db,
      snapshotOrder.body.id as string,
      snapshotProduct.id
    );
    expect(unchangedSnapshotLine.unitPrice).toBe("75.00");
    expect(unchangedSnapshotLine.listUnitPrice).toBe("100.00");
    expect(unchangedSnapshotLine.discountPercent).toBe("25.00");

    const boundaryCategory = `Boundary Tier ${Date.now()}`;
    const boundaryCategoryResponse = await createCustomerCategory({
      name: boundaryCategory,
    });
    expect(boundaryCategoryResponse.status).toBe(201);
    const boundaryCustomer = await createCustomerFixture({
      name: "Pricing Boundary Customer",
      customerCategoryId: boundaryCategoryResponse.body.id as string,
    });
    const boundaryProduct = await createSellableProductFixture({
      name: "Pricing Boundary Product",
      category: "Pricing Boundary",
      price: "100.00",
    });
    const boundaryScheduleName = `Boundary Pricing ${Date.now()}`;
    const boundarySchedule = await createPricingSchedule({
      name: boundaryScheduleName,
      customerCategoryId: boundaryCategoryResponse.body.id as string,
      itemIds: [boundaryProduct.id],
      breaks: [
        { minQuantity: "1", maxQuantity: "5", discountPercent: "20" },
        { minQuantity: "6", maxQuantity: null, discountPercent: "25" },
      ],
    });
    expect(boundarySchedule.status).toBe(201);

    for (const quantity of ["1", "5"]) {
      await expectSuggestedPrice({
        customerId: boundaryCustomer.id,
        itemId: boundaryProduct.id,
        quantity,
        suggestedUnitPrice: "80.00",
        pricingScheduleName: boundaryScheduleName,
      });
    }
    for (const quantity of ["6", "100"]) {
      await expectSuggestedPrice({
        customerId: boundaryCustomer.id,
        itemId: boundaryProduct.id,
        quantity,
        suggestedUnitPrice: "75.00",
        pricingScheduleName: boundaryScheduleName,
      });
    }

    const overrideProduct = await createSellableProductFixture({
      name: "Pricing Override Product",
      category: "Pricing Override",
      price: "100.00",
    });
    const overrideSchedule = await createPricingSchedule({
      name: `Override Pricing ${Date.now()}`,
      itemIds: [overrideProduct.id],
      breaks: [
        { minQuantity: "1", maxQuantity: null, discountPercent: "50" },
      ],
    });
    expect(overrideSchedule.status).toBe(201);
    const overrideOrder = await createSalesOrder({
      customerId: openCustomer.id,
      status: "open",
      lines: [
        {
          itemId: overrideProduct.id,
          quantity: "2",
          unitPrice: "70.00",
        },
      ],
    });
    expect(overrideOrder.status).toBe(201);
    const overrideLine = await readSalesOrderLine(
      db,
      overrideOrder.body.id as string,
      overrideProduct.id
    );
    expect(overrideLine.unitPrice).toBe("70.00");
    expect(overrideLine.suggestedUnitPrice).toBe("50.00");
    expect(overrideLine.isPriceOverridden).toBe(true);

    const patch = await testFetch(
      `/api/sales-orders/${overrideOrder.body.id}/lines/${overrideLine.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity: "3" }),
      }
    );
    expect(patch.status).toBe(200);

    const [patchedLine] = await db
      .select({
        quantity: salesOrderLines.quantity,
        unitPrice: salesOrderLines.unitPrice,
        suggestedUnitPrice: salesOrderLines.suggestedUnitPrice,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, overrideLine.id));
    expect(patchedLine).toMatchObject({
      quantity: "3.0000",
      unitPrice: "70.00",
      suggestedUnitPrice: "50.00",
      isPriceOverridden: true,
    });

    await db
      .update(salesOrderLines)
      .set({ listUnitPrice: null, discountPercent: "0" })
      .where(eq(salesOrderLines.id, overrideLine.id));

    const legacyPatch = await testFetch(
      `/api/sales-orders/${overrideOrder.body.id}/lines/${overrideLine.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ unitPrice: "80.00" }),
      }
    );
    expect(legacyPatch.status).toBe(200);

    const [legacyPatchedLine] = await db
      .select({
        listUnitPrice: salesOrderLines.listUnitPrice,
        unitPrice: salesOrderLines.unitPrice,
        discountPercent: salesOrderLines.discountPercent,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, overrideLine.id));
    expect(legacyPatchedLine).toMatchObject({
      listUnitPrice: "100.00",
      unitPrice: "80.00",
      discountPercent: "20.00",
    });
  });
});
