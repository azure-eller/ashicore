import { and, eq, inArray } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryReservationsSummary,
  accountingDocumentSyncs,
  integrationConnections,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createSalesOrder,
  fulfillSalesOrder,
  getUnitId,
  testFetch,
} from "../../helpers/api";

const ACCOUNTING_PROVIDER_XERO = "xero";
const ACCOUNTING_PROVIDER_QUICKBOOKS = "quickbooks";
const ACCOUNTING_DOCUMENT_SALES_ORDER = "sales_order";

async function withOnlyQuickBooksConnection<T>(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  fn: () => Promise<T>,
) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, (await import("../../helpers/api")).getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  const { getOrgId } = await import("../../helpers/api");
  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );
  await db.insert(integrationConnections).values({
    organizationId: getOrgId(),
    provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
    tenantId: "test-qb-tenant",
    tenantName: "Test QuickBooks",
    accessTokenCiphertext: "test-access",
    refreshTokenCiphertext: "test-refresh",
    tokenEncryptionKeyId: "test-key",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    defaultAccountCode: "QB-SALES",
    purchaseOrderDefaultAccountCode: "QB-EXPENSE",
  });

  try {
    return await fn();
  } finally {
    await db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, getOrgId()),
          inArray(integrationConnections.provider, [
            ACCOUNTING_PROVIDER_XERO,
            ACCOUNTING_PROVIDER_QUICKBOOKS,
          ]),
        ),
      );
    if (existing.length > 0) {
      await db.insert(integrationConnections).values(existing);
    }
  }
}

test.describe("sales demand and shipping heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  async function createStockedProduct(label: string, stock: string) {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Sales ${label} Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock,
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    return product.body.id as string;
  }

  test("sales order creates demand without consuming physical stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Demand", "10");

    const customer = await createCustomer({ name: `Fast Sales Customer ${ts}` });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "6", unitPrice: "12.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("6.0000");

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
  });

  test("shipping consumes stock once and closes the order", async ({ db }) => {
    const productId = await createStockedProduct("Ship", "5");

    const customer = await createCustomer({ name: `Fast Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "5", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const ship = await fulfillSalesOrder(order.body.id);
    expect(ship.status).toBe(200);

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe("5.0000");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("5.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "0.0000",
      demandQty: "0.0000",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("partial shipping updates shipped quantity and leaves remaining demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PartialShip", "8");

    const customer = await createCustomer({ name: `Fast Partial Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("open");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("3.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "5.0000",
      demandQty: "5.0000",
    });
  });

  test("shipping warns before taking demand-queue stock from another order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("QueueShip", "50");
    const customer = await createCustomer({ name: `Fast Queue Ship Customer ${ts}` });
    expect(customer.status).toBe(201);

    const reservedOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(reservedOrder.status).toBe(201);
    const shippingOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-06",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(shippingOrder.status).toBe(201);

    const [reservedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, reservedOrder.body.id));
    const [reserved] = await db
      .select({ quantity: inventoryReservationsSummary.quantity })
      .from(inventoryReservationsSummary)
      .where(eq(inventoryReservationsSummary.referenceId, reservedLine.id));
    expect(reserved.quantity).toBe("50.0000");

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === reservedOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === shippingOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const shippingShip = await fulfillSalesOrder(shippingOrder.body.id);
    expect(shippingShip.status).toBe(409);
    expect(shippingShip.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "commitment_conflict",
      committedToOthers: 50,
    });
    expect(shippingShip.body.negativeStock.commitments[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: reservedOrder.body.id,
      quantity: 50,
    });

    const reservedShip = await fulfillSalesOrder(reservedOrder.body.id);
    expect(reservedShip.status).toBe(200);
  });

  test("shipping a managed line can use demand-queue available stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ManagedQueueShip", "20");
    const customer = await createCustomer({
      name: `Fast Managed Queue Ship Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "20", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    await db
      .update(salesOrderLines)
      .set({ allocationManagedAt: new Date() })
      .where(eq(salesOrderLines.id, line.id));

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === order.body.id)?.fulfillmentSummary
        ?.salesItemsState
    ).toBe("available");

    const ship = await fulfillSalesOrder(order.body.id);
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("shipping a lower-priority order warns before taking demand-queue stock", async () => {
    const conflictTs = Date.now().toString(36);
    const productId = await createStockedProduct(`QCS${conflictTs}`, "50");
    const customer = await createCustomer({
      name: `Fast Queue Conflict Ship Customer ${conflictTs}`,
    });
    expect(customer.status).toBe(201);

    const higherPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(higherPriorityOrder.status, JSON.stringify(higherPriorityOrder.body)).toBe(
      201
    );
    const lowerPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(lowerPriorityOrder.status, JSON.stringify(lowerPriorityOrder.body)).toBe(
      201
    );

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === higherPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === lowerPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const lowerPriorityDetailResponse = await testFetch(
      `/api/sales-orders/${lowerPriorityOrder.body.id}`
    );
    expect(lowerPriorityDetailResponse.status).toBe(200);
    const lowerPriorityDetail = (await lowerPriorityDetailResponse.json()) as {
      fulfillmentSummary?: { salesItemsState?: string };
      lines?: Array<{
        fulfillmentSummary?: { salesItemsState?: string };
        demandQueueShortQty?: string;
      }>;
    };
    expect(lowerPriorityDetail.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.demandQueueShortQty).toBe("50");

    const ship = await fulfillSalesOrder(lowerPriorityOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "commitment_conflict",
      committedToOthers: 50,
    });
    expect(ship.body.negativeStock.commitments[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: higherPriorityOrder.body.id,
      quantity: 50,
    });
  });

  test("QuickBooks invoice sync rejects taxable sales orders before external API", async ({
    db,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const unique = Date.now().toString(36);
      const productId = await createStockedProduct(`QBTax${unique}`, "10");
      const customer = await createCustomer({
        name: `Fast QuickBooks Tax Customer ${unique}`,
      });
      expect(customer.status).toBe(201);
      const order = await createSalesOrder({
        customerId: customer.body.id,
        orderDate: "2026-05-09",
        shipDate: "2026-05-10",
        lines: [{ itemId: productId, quantity: "2", unitPrice: "15.00" }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      await db
        .update(salesOrderLines)
        .set({ taxRatePercent: "5" })
        .where(eq(salesOrderLines.salesOrderId, order.body.id));

      const response = await testFetch(
        `/api/sales-orders/${order.body.id}/accounting-push`,
        { method: "POST" },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        "QuickBooks tax mapping is not available yet. Remove tax from this order before sending it to QuickBooks.",
      );

      const rows = await db
        .select()
        .from(accountingDocumentSyncs)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_SALES_ORDER,
            ),
            eq(accountingDocumentSyncs.documentId, order.body.id),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

});
