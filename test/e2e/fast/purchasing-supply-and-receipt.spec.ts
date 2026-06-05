import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
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
    const updateText = await updateResponse.text();
    expect(updateResponse.status, updateText).toBe(200);
    const updated = JSON.parse(updateText);
    expect(updated.lines).toHaveLength(1);
    expect(updated.additionalCosts).toEqual([]);
    expect(updated.shippingCost).toBe("0");
    expect(updated.totalAmount).toBe("10");

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

  test("freight edit after receipt revalues landed cost via append-only event", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Reval Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-REVAL-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const itemId = material.body.id as string;

    const supplier = await createSupplier({ name: `Fast Reval Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    // Landed unit cost = unit cost + freight/qty = 10 + 20/10 = 12.
    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        notes: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "20.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
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

    const [receipt] = await db
      .select({
        id: inventoryEvents.id,
        lotId: inventoryEvents.lotId,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(receipt.unitCost).toBe("12.000000");

    // Edit freight 20 -> 50: landed unit cost = 10 + 50/10 = 15.
    const editResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(editResponse.status, await editResponse.text()).toBe(200);

    // Append-only revaluation event: zero qty, new cost 15, signed delta 10*(15-12)=30.
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
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      );
    expect(reval).toMatchObject({
      quantity: "0.0000",
      unitCost: "15.000000",
      extendedCost: "30.000000",
      lotId: receipt.lotId,
      referenceType: "purchase_order",
      referenceId: order.id,
    });

    // Lot cost basis and material current cost are rebased to 15.
    const [lot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, receipt.lotId!));
    expect(lot.unitCost).toBe("15.000000");

    const [item] = await db
      .select({ currentStockUnitCost: items.currentStockUnitCost })
      .from(items)
      .where(eq(items.id, itemId));
    expect(item.currentStockUnitCost).toBe("15.000000");

    // The original receipt event is unchanged.
    const [receiptAfter] = await db
      .select({
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.id, receipt.id));
    expect(receiptAfter).toMatchObject({
      unitCost: receipt.unitCost,
      extendedCost: receipt.extendedCost,
    });
  });

  test("freight edit after receipt revalues only remaining available stock", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast Freight Quality Block Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-FREIGHT-QUALITY-BLOCK-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast Freight Quality Supplier ${ts}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-21",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "10",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);
    expect((await submitPurchaseOrder(order.body.id)).status).toBe(200);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    expect(
      (await receivePurchaseOrder(order.body.id, {
        lines: [{ lineId: line.id, quantityReceived: "10" }],
      })).status
    ).toBe(200);

    const [lot] = await db
      .select({ lotId: inventoryLotBalances.lotId })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, material.body.id));

    const block = await testFetch(
      `/api/items/${material.body.id}/lots/${lot.lotId}/disposition`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "block",
          fromDisposition: "available",
          quantity: "2",
          notes: null,
        }),
      }
    );
    expect(block.status, await block.text()).toBe(200);

    const edit = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-21",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "10",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(edit.status, await edit.text()).toBe(200);

    const [reval] = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, material.body.id),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      );
    expect(reval).toMatchObject({
      quantity: "0.0000",
      unitCost: "15.000000",
      extendedCost: "40.000000",
      lotId: lot.lotId,
    });

    const balances = await db
      .select({
        disposition: inventoryLotBalances.disposition,
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, lot.lotId));
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "available",
          quantity: "8.0000",
          unitCost: "15.000000",
        }),
        expect.objectContaining({
          disposition: "blocked",
          quantity: "2.0000",
          unitCost: "10.000000",
        }),
      ])
    );
  });
});
