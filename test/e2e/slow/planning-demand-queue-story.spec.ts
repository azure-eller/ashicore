import { eq, inArray, sql } from "drizzle-orm";
import { test, expect, filterList } from "../fixtures";
import type { PlanningSnapshot } from "../../../lib/planning/types";
import {
  inventoryItemBalances,
  inventoryDemandSummary,
  manufacturingOrders,
  purchaseOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createPurchaseOrder,
  createSupplier,
  getPlanningSnapshot,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";
import {
  createConfirmedSalesOrder,
  createCustomerFixture,
  createMaterialFixture,
  createReleasedManufacturingOrder,
  createSellableProductFixture,
  expectResponse,
} from "./story-helpers";

test.describe("planning demand queue operating story", () => {
  test.describe.configure({ mode: "serial" });

  let finishedId: string;
  let componentId: string;
  let highOrderId: string;
  let lowOrderId: string;

  test("ranked demand covers scarce stock to the higher-priority order first", async ({
    db,
    page,
  }) => {
    const component = await createMaterialFixture({
      name: "Planning Shared Component",
      stock: "6",
      cost: "1.00",
    });
    componentId = component.id;
    const finished = await createSellableProductFixture({
      name: "Planning Finished Good",
      stock: "10",
      price: "12.00",
      bom: [{ componentId, quantity: "1" }],
    });
    finishedId = finished.id;
    const customer = await createCustomerFixture({ name: "Planning Customer" });

    highOrderId = await createConfirmedSalesOrder({
      customerId: customer.id,
      productId: finishedId,
      quantity: "8",
    });
    lowOrderId = await createConfirmedSalesOrder({
      customerId: customer.id,
      productId: finishedId,
      quantity: "8",
    });

    const reorder = await testFetch("/api/sales-orders/priority-ranks", {
      method: "PATCH",
      body: JSON.stringify({
        orderIds: [highOrderId, lowOrderId],
      }),
    });
    expect(reorder.status).toBe(200);

    const rankedOrders = await db
      .select({
        id: salesOrders.id,
        priorityRank: salesOrders.priorityRank,
      })
      .from(salesOrders)
      .where(inArray(salesOrders.id, [highOrderId, lowOrderId]));
    const rankById = new Map(rankedOrders.map((row) => [row.id, row.priorityRank]));
    expect(rankById.get(highOrderId)!).toBeLessThan(rankById.get(lowOrderId)!);

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((order) => order.id === highOrderId)?.fulfillmentSummary
        ?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((order) => order.id === lowOrderId)?.fulfillmentSummary
        ?.salesItemsState
    ).toBe("not_available");

    const [demand] = await db
      .select({ total: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)` })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.itemId, finishedId));
    expect(Number(demand.total)).toBe(16);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
        shortageQty: inventoryItemBalances.shortageQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, finishedId));
    expect(balance).toMatchObject({
      onHandQty: "10.0000",
      demandQty: "16.0000",
      shortageQty: "6.0000",
    });

    const [highOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, highOrderId));
    await page.goto("/sales/orders");
    await filterList(page, "Search orders", highOrder.orderNumber);
    await expect(page.getByRole("row").filter({ hasText: highOrder.orderNumber })).toBeVisible();

    await page.goto(`/sales/allocation?itemId=${finishedId}`);
    await expect(page.getByRole("heading", { name: "Allocation · Demand queue" })).toBeVisible();
    await expect(page.locator("table").first().locator("tr").nth(1)).toContainText(
      finished.name
    );
    await expect(page.getByText("Save allocation")).toHaveCount(0);
  });

  test("late expected manufacturing supply does not cover earlier sales demand", async () => {
    const component = await createMaterialFixture({
      name: "Planning Late Expected Component",
      stock: "10",
      cost: "1.00",
    });
    const product = await createSellableProductFixture({
      name: "Planning Late Expected Product",
      stock: "0",
      price: "14.00",
      bom: [{ componentId: component.id, quantity: "1" }],
    });
    const customer = await createCustomerFixture({
      name: "Planning Late Expected Customer",
    });
    const orderId = await createConfirmedSalesOrder({
      customerId: customer.id,
      productId: product.id,
      quantity: "5",
      shipDate: "2026-06-01",
    });
    await createReleasedManufacturingOrder({
      productId: product.id,
      componentId: component.id,
      plannedQuantity: "5",
      quantityPerUnit: "1",
    });

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      lines?: Array<{
        demandQueueExpectedQty?: string;
        demandQueueShortQty?: string;
        demandQueueSegments?: Array<{ kind: string; qty: string }>;
      }>;
    }>;
    const line = salesOrderRows.find((order) => order.id === orderId)?.lines?.[0];

    expect(Number(line?.demandQueueExpectedQty ?? 0)).toBe(0);
    expect(Number(line?.demandQueueShortQty ?? 0)).toBe(5);
    expect(line?.demandQueueSegments?.some((segment) => segment.kind === "short")).toBe(true);
  });

  test("expected purchase and manufacturing supply are visible to the planning read model", async ({
    db,
  }) => {
    const supplier = await createSupplier({ name: `Planning Supplier ${Date.now()}` });
    expectResponse(supplier);
    const po = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-06-09",
      lines: [{ itemId: componentId, quantityOrdered: "12", unitCost: "1.25" }],
    });
    expectResponse(po);
    expect((await submitPurchaseOrder(po.body.id)).status).toBe(200);

    const [poLine] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po.body.id));
    expect(poLine.id).toBeTruthy();

    const makeOrderId = await createReleasedManufacturingOrder({
      productId: finishedId,
      componentId,
      plannedQuantity: "6",
      quantityPerUnit: "1",
      confirmShortage: true,
    });
    const [mo] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, makeOrderId));
    expect(["open", "released"]).toContain(mo.status);

    const snapshot = await getPlanningSnapshot();
    expect(snapshot.status).toBe(200);
    const planning = snapshot.body as PlanningSnapshot;
    expect(
      planning.supplyFacts.some(
        (fact) =>
          fact.itemId === componentId &&
          fact.supplyType === "purchase_order" &&
          Number(fact.quantity) === 12
      )
    ).toBe(true);
    expect(
      planning.supplyFacts.some(
        (fact) =>
          fact.itemId === finishedId &&
          fact.supplyType === "manufacturing_order" &&
          Number(fact.quantity) === 6
      )
    ).toBe(true);
    expect(
      planning.rows.some(
        (row) =>
          row.item.id === componentId &&
          Number(row.incomingPurchaseOrderQuantity) >= 12 &&
          Number(row.demandQuantity) > 0 &&
          row.planningType === "buy"
      )
    ).toBe(true);
    expect(
      planning.rows.some(
        (row) =>
          row.item.id === finishedId &&
          Number(row.incomingManufacturingOrderQuantity) >= 6 &&
          row.planningType === "make"
      )
    ).toBe(true);
  });

  test("shared component shortage remains visible as the blocker", async () => {
    const blockerComponent = await createMaterialFixture({
      name: "Planning Blocker Component",
      stock: "2",
      cost: "1.00",
    });
    const secondFinished = await createSellableProductFixture({
      name: "Planning Blocked Product",
      stock: "0",
      price: "14.00",
      bom: [{ componentId: blockerComponent.id, quantity: "2" }],
    });
    const blockerCustomer = await createCustomerFixture({
      name: "Planning Blocker Customer",
    });
    await createConfirmedSalesOrder({
      customerId: blockerCustomer.id,
      productId: secondFinished.id,
      quantity: "3",
    });

    const snapshot = await getPlanningSnapshot();
    expect(snapshot.status).toBe(200);
    const planning = snapshot.body as PlanningSnapshot;
    expect(
      planning.rows.some(
        (row) =>
          row.item.id === blockerComponent.id &&
          Number(row.demandQuantity) === 6 &&
          Number(row.availableStock) === 2 &&
          Number(row.shortageQuantity) === 4 &&
          row.suggestedAction === "buy"
      )
    ).toBe(true);
    expect(
      planning.rows.some(
        (row) =>
          row.item.id === secondFinished.id &&
          Number(row.shortageQuantity) === 3 &&
          row.suggestedAction === "make"
      )
    ).toBe(true);
    expect(
      planning.productionBlockerFacts.some(
        (fact) =>
          fact.parentItemId === secondFinished.id &&
          fact.componentItemId === blockerComponent.id &&
          fact.blockerType === "material_shortage" &&
          Number(fact.shortageQuantity ?? "0") > 0
      )
    ).toBe(true);
    expect(
      planning.bomRequirementFacts.some(
        (fact) =>
          fact.componentItemId === blockerComponent.id &&
          Number(fact.requiredQuantity) === 6
      )
    ).toBe(true);

  });
});
