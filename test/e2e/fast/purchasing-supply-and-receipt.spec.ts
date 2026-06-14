import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  accountingDocumentSyncs,
  attachmentFiles,
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "../../../lib/db/schema";
import { groupPurchaseOrderByResolvedSupplier } from "../../../lib/purchasing/resolved-supplier-groups";
import {
  findOutboxEmails,
  waitForOutboxEmail,
} from "../../helpers/email-outbox";
import { TEST_ACCOUNT_ORG_NAME } from "../../helpers/test-account";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  getOrgId,
  getUnitId,
  receivePurchaseOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";

const ACCOUNTING_DOCUMENT_PURCHASE_ORDER = "purchase_order";
const ACCOUNTING_PROVIDER_XERO = "xero";
const ATTACHMENT_OWNER_PURCHASE_ORDER = "purchase_order";

async function writeFastLocalAttachment(storageKey: string, content: string) {
  const root = process.env.LOCAL_ATTACHMENT_DIR
    ? path.resolve(process.env.LOCAL_ATTACHMENT_DIR)
    : path.join(process.cwd(), ".local-attachments");
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local attachment path.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return `local://${storageKey}`;
}

test.describe("purchasing supply and receipt heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  test("card save with a stale expectedVersion returns 409 with the fresh doc and applies nothing", async ({ db }) => {
    const supplier = await createSupplier({ name: `Fast Version Gate ${ts}` });
    expect(supplier.status).toBe(201);
    const supplierId = (supplier.body as { id: string; version: number }).id;

    const basePayload = {
      name: `Fast Version Gate ${ts}`,
      code: null,
      contactName: null,
      email: null,
      phone: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      paymentTerms: null,
      notes: null,
    };

    const first = await testFetch(`/api/suppliers/${supplierId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first writer", expectedVersion: 1 }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { version: number };
    expect(firstBody.version).toBe(2);

    const stale = await testFetch(`/api/suppliers/${supplierId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale writer", expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      conflict: boolean;
      current: { notes: string | null; version: number };
    };
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first writer");
    expect(staleBody.current.version).toBe(2);

    const [row] = await db
      .select({ notes: suppliers.notes, version: suppliers.version })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    expect(row.notes).toBe("first writer");
    expect(row.version).toBe(2);
  });

  test("purchase order card save replays the committed result for the same idempotency key", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Replay Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-REPLAY-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Replay Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "7.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const payload = {
      orderNumber: order.body.orderNumber,
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      shippingCost: "0",
      notes: "committed once",
      accountingPurchaseAccountCode: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      expectedVersion: order.body.version,
      lines: [
        {
          id: order.body.lines[0].id,
          itemId: material.body.id,
          quantityOrdered: "5",
          unitCost: "7.00",
          taxRateId: null,
          accountingPurchaseAccountCode: null,
          shipAddressEntryId: null,
          shipContactName: null,
          shipContactPhone: null,
          shipLine1: null,
          shipLine2: null,
          shipCity: null,
          shipRegion: null,
          shipPostcode: null,
          shipCountry: null,
          shipDeliveryInstructions: null,
        },
      ],
      additionalCosts: [],
    };
    const body = JSON.stringify(payload);
    const headers = {
      "Idempotency-Key": `test:purchase-order-replay:${order.body.id}`,
    };

    const first = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body,
      headers,
    });
    expect(first.status, await first.text()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.version).toBe(order.body.version + 1);

    const replay = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body,
      headers,
    });
    expect(replay.status, await replay.text()).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.version).toBe(firstBody.version);
    expect(replayBody.notes).toBe("committed once");

    const [row] = await db
      .select({ notes: purchaseOrders.notes, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(row.notes).toBe("committed once");
    expect(row.version).toBe(firstBody.version);
  });

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

    const [editedOrder] = await db
      .select({ status: purchaseOrders.status, receivedAt: purchaseOrders.receivedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(editedOrder.status).toBe("received");
    expect(editedOrder.receivedAt).not.toBeNull();

    const expectedRows = await db
      .select({ referenceId: inventoryExpectedSummary.referenceId })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id),
        ),
      );
    expect(expectedRows).toHaveLength(0);

    const impossibleQuantityEditResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "9", unitCost: "10.00" }],
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
    expect(impossibleQuantityEditResponse.status, await impossibleQuantityEditResponse.text()).toBe(400);

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

    // Base price 10 -> 11 with freight 50 => landed unit cost 16.
    const priceEditResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "11.00" }],
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
    expect(priceEditResponse.status, await priceEditResponse.text()).toBe(200);

    const [lineAfterPriceEdit] = await db
      .select({
        unitCost: purchaseOrderLines.unitCost,
        stockUnitCost: purchaseOrderLines.stockUnitCost,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    expect(Number(lineAfterPriceEdit.unitCost)).toBe(11);
    expect(Number(lineAfterPriceEdit.stockUnitCost)).toBe(16);

    const [lotAfterPriceEdit] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, receipt.lotId!));
    expect(lotAfterPriceEdit.unitCost).toBe("16.000000");

    const [itemAfterPriceEdit] = await db
      .select({ currentStockUnitCost: items.currentStockUnitCost })
      .from(items)
      .where(eq(items.id, itemId));
    expect(itemAfterPriceEdit.currentStockUnitCost).toBe("16.000000");
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

  test("resolved supplier grouping collapses supplier overrides and splits supplier costs", async () => {
    const groups = groupPurchaseOrderByResolvedSupplier({
      purchaseOrderSupplier: {
        id: "supplier-a",
        name: "Supplier A",
      },
      suppliersById: new Map([
        ["carrier-a", { id: "carrier-a", name: "Carrier A" }],
        ["carrier-b", { id: "carrier-b", name: "Carrier B" }],
      ]),
      lines: [{ id: "line-1" }],
      additionalCosts: [
        { id: "cost-supplier", supplierId: "supplier-a" },
        { id: "cost-carrier-a", supplierId: "carrier-a" },
        { id: "cost-carrier-b", supplierId: "carrier-b" },
      ],
    });

    expect(groups).toMatchObject([
      {
        key: "supplier:supplier-a",
        isPurchaseOrderSupplier: true,
        lines: [{ id: "line-1" }],
        additionalCosts: [{ id: "cost-supplier" }],
      },
      {
        key: "additional-cost:carrier-a",
        isPurchaseOrderSupplier: false,
        lines: [],
        additionalCosts: [{ id: "cost-carrier-a" }],
      },
      {
        key: "additional-cost:carrier-b",
        isPurchaseOrderSupplier: false,
        lines: [],
        additionalCosts: [{ id: "cost-carrier-b" }],
      },
    ]);
  });

  test("additional-cost purchase orders reconcile to current supplier cost groups", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const supplier = await createSupplier({ name: `Fast Freight Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Carrier ${ts}` });
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const firstFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const firstFreightBody = await firstFreightResponse.json();
    expect(firstFreightResponse.status).toBe(200);
    expect(firstFreightBody.additionalCostPurchaseOrders).toHaveLength(1);
    const freightOrderId = firstFreightBody.additionalCostPurchaseOrders[0].id;

    const updateResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
        notes: null,
        accountingPurchaseAccountCode: null,
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "18.00",
          },
        ],
      }),
    });
    expect(updateResponse.status, await updateResponse.text()).toBe(200);

    const secondFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const secondFreightBody = await secondFreightResponse.json();
    expect(secondFreightResponse.status).toBe(200);
    expect(secondFreightBody.additionalCostPurchaseOrders[0].id).toBe(freightOrderId);

    const [updatedFreight] = await db
      .select({
        shippingCost: purchaseOrders.shippingCost,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(updatedFreight).toMatchObject({
      shippingCost: "18.0000",
      totalAmount: "18.0000",
    });

    const clearResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
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
    expect(clearResponse.status, await clearResponse.text()).toBe(200);
    const clearedFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const clearedFreightBody = await clearedFreightResponse.json();
    expect(clearedFreightResponse.status).toBe(200);
    expect(clearedFreightBody.additionalCostPurchaseOrders).toHaveLength(0);

    const [deletedFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(deletedFreight.deletedAt).not.toBeNull();
  });

  test("supplier delete is blocked while used as an active supplier override", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Carrier Delete Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-CARRIER-DELETE-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({
      name: `Fast Carrier Delete Supplier ${ts}`,
    });
    const carrier = await createSupplier({
      name: `Fast Carrier Delete Carrier ${ts}`,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-14",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    expect(createResponse.status, await createResponse.text()).toBe(201);

    const deleteResponse = await testFetch(`/api/suppliers/${carrier.body.id}`, {
      method: "DELETE",
    });
    const body = await deleteResponse.json();
    expect(deleteResponse.status).toBe(400);
    expect(body.error).toBe(
      "Cannot delete supplier used as a supplier on active draft, ordered, or partially received purchase orders.",
    );
  });

  test("additional-cost purchase orders are not created from terminal parent orders", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Terminal Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-TERM-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Terminal Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Terminal Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createOrderWithFreight = async () => {
      const response = await testFetch("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.body.id,
          expectedDate: "2026-05-10",
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
              supplierId: carrier.body.id,
              distributionMethod: "by_value",
              accountingPurchaseAccountCode: null,
              amount: "12.00",
            },
          ],
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(201);
      return body;
    };

    const deletedOrder = await createOrderWithFreight();
    const deleteResponse = await testFetch(
      `/api/purchase-orders/${deletedOrder.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    const deletedFreightResponse = await testFetch(
      `/api/purchase-orders/${deletedOrder.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(deletedFreightResponse.status).toBe(404);

    const receivedOrder = await createOrderWithFreight();
    expect((await submitPurchaseOrder(receivedOrder.id)).status).toBe(200);
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, receivedOrder.id));
    const receipt = await receivePurchaseOrder(receivedOrder.id, {
      lines: [{ lineId: line.id, quantityReceived: "1" }],
    });
    expect(receipt.status).toBe(200);
    const receivedFreightResponse = await testFetch(
      `/api/purchase-orders/${receivedOrder.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(receivedFreightResponse.status).toBe(404);
  });

  test("linked additional-cost purchase orders follow parent delete", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Child Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-CHILD-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Child Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Freight Child Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createOrderWithFreight = async () => {
      const createResponse = await testFetch("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.body.id,
          expectedDate: "2026-05-11",
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
              supplierId: carrier.body.id,
              distributionMethod: "by_value",
              accountingPurchaseAccountCode: null,
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await createResponse.json();
      expect(createResponse.status).toBe(201);
      const freightResponse = await testFetch(
        `/api/purchase-orders/${order.id}/additional-cost-pos`,
        { method: "POST" },
      );
      const freightBody = await freightResponse.json();
      expect(freightResponse.status).toBe(200);
      return {
        orderId: order.id as string,
        freightOrderId: freightBody.additionalCostPurchaseOrders[0].id as string,
      };
    };

    const deleted = await createOrderWithFreight();
    const childDeleteResponse = await testFetch(
      `/api/purchase-orders/${deleted.freightOrderId}`,
      { method: "DELETE" },
    );
    expect(childDeleteResponse.status).toBe(404);
    const [activeFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, deleted.freightOrderId));
    expect(activeFreight.deletedAt).toBeNull();

    const deleteResponse = await testFetch(
      `/api/purchase-orders/${deleted.orderId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    const [deletedFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, deleted.freightOrderId));
    expect(deletedFreight.deletedAt).not.toBeNull();
  });

  test("submitted additional-cost purchase orders keep ordered timestamp when reconciled", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Ordered Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-ORDERED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Ordered Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Freight Ordered Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);
    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-12",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect((await submitPurchaseOrder(order.id)).status).toBe(200);
    const firstFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const firstFreightBody = await firstFreightResponse.json();
    expect(firstFreightResponse.status).toBe(200);
    const freightOrderId = firstFreightBody.additionalCostPurchaseOrders[0].id as string;
    const [firstFreight] = await db
      .select({ orderedAt: purchaseOrders.orderedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(firstFreight.orderedAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(secondFreightResponse.status).toBe(200);
    const [secondFreight] = await db
      .select({ orderedAt: purchaseOrders.orderedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(secondFreight.orderedAt?.getTime()).toBe(
      firstFreight.orderedAt?.getTime(),
    );
  });

  test("purchase order email retry skips groups already marked sent", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Retry Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-RETRY-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-${ts}@example.com`;
    const carrierEmail = `carrier-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Retry Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Retry Carrier ${ts}`,
      email: carrierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);
    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-13",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect((await submitPurchaseOrder(order.id)).status).toBe(200);
    const supplierGroupKey = `supplier:${supplier.body.id}`;
    const carrierGroupKey = `additional-cost:${carrier.body.id}`;
    await db.insert(accountingDocumentSyncs).values({
      organizationId: getOrgId(),
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      documentId: order.id,
      groupKey: supplierGroupKey,
      emailStatus: "sent",
      emailedAt: new Date(),
    });

    const retryResponse = await testFetch(
      `/api/purchase-orders/${order.id}/email`,
      {
        method: "POST",
        body: JSON.stringify({
          groups: [
            {
              groupKey: supplierGroupKey,
              include: true,
              to: supplierEmail,
              replyTo: "buyer@example.com",
              bcc: null,
              subject: "Supplier copy",
              message: "Supplier copy",
            },
            {
              groupKey: carrierGroupKey,
              include: true,
              to: carrierEmail,
              replyTo: "buyer@example.com",
              bcc: null,
              subject: "Carrier copy",
              message: "Carrier copy",
            },
          ],
        }),
      },
    );
    const retryBody = await retryResponse.json();
    expect(retryResponse.status, JSON.stringify(retryBody)).toBe(200);
    expect(retryBody.sent).toEqual([
      { groupKey: carrierGroupKey, recipientEmail: carrierEmail },
    ]);
  });

  test("purchase order email allows excluded supplier groups without an email", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Excluded Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-EXCLUDED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-excluded-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Excluded Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Excluded Carrier ${ts}`,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-15",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect((await submitPurchaseOrder(order.id)).status).toBe(200);

    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
          },
          {
            groupKey: `additional-cost:${carrier.body.id}`,
            include: false,
            to: "",
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "",
            message: "",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.sent).toEqual([
      { groupKey: `supplier:${supplier.body.id}`, recipientEmail: supplierEmail },
    ]);
  });

  test("purchase order email keeps same-supplier additional costs on the supplier copy", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Same Supplier Email Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-SAME-SUPPLIER-EMAIL-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `same-supplier-po-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Same Supplier ${ts}`,
      email: supplierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-15",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "other",
            reference: "Handling",
            supplierId: null,
            distributionMethod: "not_distributed",
            accountingPurchaseAccountCode: null,
            amount: "40.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    expect((await submitPurchaseOrder(order.id)).status).toBe(200);

    const since = Date.now();
    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.sent).toEqual([
      { groupKey: `supplier:${supplier.body.id}`, recipientEmail: supplierEmail },
    ]);

    const [savedOrder] = await db
      .select({ totalAmount: purchaseOrders.totalAmount })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(savedOrder.totalAmount).toBe("50.0000");

    const emailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const pdfNames =
      emailEntry.attachments
        ?.filter((file) => file.filename.endsWith(".pdf"))
        .map((file) => file.filename) ?? [];
    expect(pdfNames).toHaveLength(1);
    expect(pdfNames.some((name) => name.includes("Supplier"))).toBe(false);
  });

  test("purchase order email rejects deleted purchase orders", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Deleted Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-DELETE-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `deleted-po-email-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Deleted Supplier ${ts}`,
      email: supplierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-17",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "1",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const deleteResponse = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const response = await testFetch(`/api/purchase-orders/${order.body.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            subject: "Deleted PO",
            message: "Should not send",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Purchase order not found.");
  });

  test("purchase order email sends selected attachments per supplier group", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Attachments Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-ATTACH-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-attachments-${ts}@example.com`;
    const carrierEmail = `carrier-attachments-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Attachments Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Attachments Carrier ${ts}`,
      email: carrierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-16",
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
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const supplierStorageKey = `fast-po-email/${randomUUID()}-supplier-note.txt`;
    const carrierStorageKey = `fast-po-email/${randomUUID()}-carrier-note.txt`;
    const supplierBlobUrl = await writeFastLocalAttachment(
      supplierStorageKey,
      "Supplier note",
    );
    const carrierBlobUrl = await writeFastLocalAttachment(
      carrierStorageKey,
      "Carrier note",
    );
    const [supplierAttachment, carrierAttachment] = await db
      .insert(attachmentFiles)
      .values([
        {
          organizationId: getOrgId(),
          ownerType: ATTACHMENT_OWNER_PURCHASE_ORDER,
          ownerId: order.id,
          storageKey: supplierStorageKey,
          blobUrl: supplierBlobUrl,
          filename: "supplier-note.txt",
          contentType: "text/plain",
          sizeBytes: "Supplier note".length,
          uploadedByUserId: "test-user",
          uploadedByName: "Test User",
        },
        {
          organizationId: getOrgId(),
          ownerType: ATTACHMENT_OWNER_PURCHASE_ORDER,
          ownerId: order.id,
          storageKey: carrierStorageKey,
          blobUrl: carrierBlobUrl,
          filename: "carrier-note.txt",
          contentType: "text/plain",
          sizeBytes: "Carrier note".length,
          uploadedByUserId: "test-user",
          uploadedByName: "Test User",
        },
      ])
      .returning({ id: attachmentFiles.id });

    const since = Date.now();
    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
            attachmentFileIds: [supplierAttachment.id],
          },
          {
            groupKey: `additional-cost:${carrier.body.id}`,
            include: true,
            to: carrierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Carrier copy",
            message: "Carrier copy",
            attachmentFileIds: [carrierAttachment.id],
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);

    const [submittedOrder] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    const [expected] = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.itemId, material.body.id),
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id),
        ),
      );
    expect(submittedOrder.status).toBe("ordered");
    expect(expected.quantity).toBe("1.0000");

    const supplierEmailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const carrierEmailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: carrierEmail,
    });
    const supplierEmailEntries = await findOutboxEmails({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const carrierEmailEntries = await findOutboxEmails({
      since,
      tag: "purchase-order",
      to: carrierEmail,
    });
    const supplierAttachmentNames =
      supplierEmailEntry.attachments?.map((file) => file.filename) ?? [];
    const carrierAttachmentNames =
      carrierEmailEntry.attachments?.map((file) => file.filename) ?? [];

    const escapedOrgName = TEST_ACCOUNT_ORG_NAME.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    expect(supplierEmailEntry.from).toEqual(
      expect.stringMatching(new RegExp(`^"${escapedOrgName}" <[^>]+>$`)),
    );
    expect(carrierEmailEntry.from).toBe(supplierEmailEntry.from);
    expect(supplierEmailEntry.bcc).toBeUndefined();
    expect(carrierEmailEntry.bcc).toBeUndefined();
    expect(supplierEmailEntries).toHaveLength(1);
    expect(carrierEmailEntries).toHaveLength(1);
    expect(supplierAttachmentNames).toContain("supplier-note.txt");
    expect(supplierAttachmentNames).not.toContain("carrier-note.txt");
    expect(supplierAttachmentNames.some((name) => name.includes("Carrier"))).toBe(false);
    expect(carrierAttachmentNames).toContain("carrier-note.txt");
    expect(carrierAttachmentNames).not.toContain("supplier-note.txt");
    expect(carrierAttachmentNames.some((name) => name.includes("Carrier"))).toBe(true);
    expect(supplierAttachmentNames.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
    expect(carrierAttachmentNames.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
  });

  test("additional-cost links and supplier overrides cannot cross organization boundaries", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight RLS Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-RLS-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight RLS Supplier ${ts}` });
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-09",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "1",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const otherOrgId = `${getOrgId()}-other`;
    const otherSupplierId = randomUUID();
    const otherParentId = randomUUID();
    const otherParentNumber = `OTHER-${ts}`.slice(0, 32);
    await db.execute(sql`
      WITH org_context AS (
        SELECT set_config('app.current_org_id', ${otherOrgId}, true)
      )
      INSERT INTO purchasing.suppliers (id, organization_id, name)
      SELECT ${otherSupplierId}, ${otherOrgId}, ${`Other Org Carrier ${ts}`}
      FROM org_context
    `);
    await db.execute(sql`
      WITH org_context AS (
        SELECT set_config('app.current_org_id', ${otherOrgId}, true)
      )
      INSERT INTO purchasing.purchase_orders (
        id,
        organization_id,
        order_number,
        supplier_id,
        supplier_name
      )
      SELECT
        ${otherParentId},
        ${otherOrgId},
        ${otherParentNumber},
        ${otherSupplierId},
        ${`Other Org Carrier ${ts}`}
      FROM org_context
    `);

    await expect(
      (async () => {
        await db.insert(purchaseOrderAdditionalCosts).values({
          organizationId: getOrgId(),
          purchaseOrderId: order.body.id,
          supplierId: otherSupplierId,
          costType: "shipping",
          reference: "Cross-org carrier",
          distributionMethod: "by_value",
          amount: "1.00",
        });
      })(),
    ).rejects.toThrow();

    await expect(
      (async () => {
        await db.insert(purchaseOrders).values({
          organizationId: getOrgId(),
          orderNumber: `BAD-F-${ts}`.slice(0, 32),
          parentPurchaseOrderId: otherParentId,
          type: "additional_cost",
          supplierId: supplier.body.id,
          supplierName: supplier.body.name,
        });
      })(),
    ).rejects.toThrow();

    const currentOrgFreightRows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.parentPurchaseOrderId, otherParentId),
          eq(purchaseOrders.type, "additional_cost"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    expect(currentOrgFreightRows).toHaveLength(0);
  });
});
