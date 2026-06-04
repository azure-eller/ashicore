import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
} from "../../../lib/db/schema";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  getUnitId,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";

test.describe("purchasing supply and receipt heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  test("purchase order submit creates expected supply", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Expected Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EXPECTED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Supplier ${ts}` });
    expect(supplier.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-05",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "9",
          unitCost: "4.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const submit = await submitPurchaseOrder(order.body.id);
    expect(submit.status).toBe(200);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    const [expected] = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.itemId, material.body.id),
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id)
        )
      );
    expect(expected.quantity).toBe("9.0000");
  });

  test("receipt converts expected supply into physical stock", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Receipt Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-RECEIPT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "5.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast Receipt Supplier ${ts}` });
    expect(supplier.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "7",
          unitCost: "5.00",
        },
      ],
    });
    expect(order.status).toBe(201);
    expect((await submitPurchaseOrder(order.body.id)).status).toBe(200);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    const receipt = await receivePurchaseOrder(order.body.id, {
      lines: [{ lineId: line.id, quantityReceived: "7" }],
    });
    expect(receipt.status).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, material.body.id));
    expect(balance).toMatchObject({
      onHandQty: "7.0000",
      expectedQty: "0.0000",
    });

    const [event] = await db
      .select({ eventType: inventoryEvents.eventType, quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, material.body.id),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(event).toMatchObject({
      eventType: "purchase_receipt",
      quantity: "7.0000",
    });

    const [savedOrder] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(savedOrder.status).toBe("received");
  });

  test("purchase order edit clears additional costs explicitly", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Cost Clear Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-COST-CLEAR-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast Cost Clear Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        notes: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const updateResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        shippingCost: "12.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [],
      }),
    });
    expect(updateResponse.status, await updateResponse.text()).toBe(200);

    const costs = await db
      .select({ id: purchaseOrderAdditionalCosts.id })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, order.id));
    expect(costs).toHaveLength(0);

    const [savedOrder] = await db
      .select({
        shippingCost: purchaseOrders.shippingCost,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(savedOrder).toMatchObject({
      shippingCost: "0.0000",
      totalAmount: "10.0000",
    });
  });
});
