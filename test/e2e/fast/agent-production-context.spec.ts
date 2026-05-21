import { sql } from "drizzle-orm";
import { test, expect, type TestDb } from "../fixtures";
import {
  inventoryEvents,
  manufacturingOrders,
  purchaseOrders,
  stockAllocations,
} from "../../../lib/db/schema";
import { getBaseUrl, testFetch } from "../../helpers/api";

async function readMutationSensitiveCounts(db: TestDb) {
  const [allocationCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAllocations);
  const [eventCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryEvents);
  const [manufacturingOrderCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(manufacturingOrders);
  const [purchaseOrderCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseOrders);

  return {
    allocations: allocationCount?.count ?? 0,
    events: eventCount?.count ?? 0,
    manufacturingOrders: manufacturingOrderCount?.count ?? 0,
    purchaseOrders: purchaseOrderCount?.count ?? 0,
  };
}

test.describe("Agent production planning context API", () => {
  test("requires session or bearer authentication", async () => {
    const response = await fetch(
      `${getBaseUrl()}/api/agent/production-planning/context`,
      {
        headers: { Origin: getBaseUrl() },
        redirect: "manual",
      }
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Authentication required.");
  });

  test("returns compact read-only production data", async ({ db }) => {
    const before = await readMutationSensitiveCounts(db);

    const response = await testFetch("/api/agent/production-planning/context");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const context = await response.json();

    expect(context).not.toHaveProperty("orgId");
    expect(context).not.toHaveProperty("inputHash");
    expect(context).not.toHaveProperty("allowedNextActions");
    expect(context).not.toHaveProperty("today");
    expect(context).not.toHaveProperty("horizon");
    expect(Array.isArray(context.openSalesOrders)).toBe(true);
    expect(Array.isArray(context.openManufacturingOrders)).toBe(true);
    expect(Array.isArray(context.productCounts)).toBe(true);
    expect(Array.isArray(context.productRequirements)).toBe(true);
    expect(JSON.stringify(context)).not.toContain("unitCost");
    expect(JSON.stringify(context)).not.toContain("defaultSellingPrice");
    expect(JSON.stringify(context)).not.toContain("defaultPurchasePrice");

    for (const order of context.openSalesOrders as Array<{
      salesOrderId: string;
      orderNumber: string;
      orderDate: string | null;
      shipDate: string | null;
      shipments: Array<{ lines: unknown[] }>;
      unplannedDemand: Array<{ salesOrderLineId: string; itemId: string }>;
    }>) {
      expect(order.salesOrderId).toBeTruthy();
      expect(order.orderNumber).toBeTruthy();
      expect(order).toHaveProperty("orderDate");
      expect(order).toHaveProperty("shipDate");
      expect(order).not.toHaveProperty("priorityRank");
      expect(order).not.toHaveProperty("lines");
      expect(Array.isArray(order.shipments)).toBe(true);
      expect(Array.isArray(order.unplannedDemand)).toBe(true);
    }

    for (const order of context.openManufacturingOrders as Array<{
      manufacturingOrderId: string;
      orderNumber: string;
      itemId: string;
      itemName: string;
      plannedQty: string;
      remainingQty: string;
      outputAllocations: unknown[];
    }>) {
      expect(order.manufacturingOrderId).toBeTruthy();
      expect(order.orderNumber).toBeTruthy();
      expect(order.itemId).toBeTruthy();
      expect(order.itemName).toBeTruthy();
      expect(typeof order.plannedQty).toBe("string");
      expect(typeof order.remainingQty).toBe("string");
      expect(Array.isArray(order.outputAllocations)).toBe(true);
      expect(order).not.toHaveProperty("priorityRank");
    }

    for (const item of context.productCounts as Array<{
      itemId: string;
      itemName: string;
      onHandQty: unknown;
      availableQty: unknown;
      reservedQty: unknown;
      expectedQty: unknown;
      inventoryLotAllocatedQty: unknown;
      manufacturingOutputAllocatedQty: unknown;
      totalActiveAllocationQty: unknown;
      openSalesDemandQty: unknown;
      openSalesAllocatedQty: unknown;
      openSalesUnallocatedQty: unknown;
      openManufacturingSupplyQty: unknown;
    }>) {
      expect(item.itemId).toBeTruthy();
      expect(item.itemName).toBeTruthy();
      expect(typeof item.onHandQty).toBe("string");
      expect(typeof item.availableQty).toBe("string");
      expect(typeof item.reservedQty).toBe("string");
      expect(typeof item.expectedQty).toBe("string");
      expect(typeof item.inventoryLotAllocatedQty).toBe("string");
      expect(typeof item.manufacturingOutputAllocatedQty).toBe("string");
      expect(typeof item.totalActiveAllocationQty).toBe("string");
      expect(typeof item.openSalesDemandQty).toBe("string");
      expect(typeof item.openSalesAllocatedQty).toBe("string");
      expect(typeof item.openSalesUnallocatedQty).toBe("string");
      expect(typeof item.openManufacturingSupplyQty).toBe("string");
    }

    for (const bom of context.productRequirements as Array<{
      productItemId: string;
      productName: string;
      components: Array<{
        bomRevisionComponentId: string;
        componentItemId: string;
        minimumLotAgeDays: number | null;
        requirements: string[];
      }>;
    }>) {
      expect(bom.productItemId).toBeTruthy();
      expect(bom.productName).toBeTruthy();
      expect(Array.isArray(bom.components)).toBe(true);
      for (const component of bom.components) {
        expect(component.bomRevisionComponentId).toBeTruthy();
        expect(component.componentItemId).toBeTruthy();
        expect(
          component.minimumLotAgeDays == null ||
            typeof component.minimumLotAgeDays === "number"
        ).toBe(true);
        expect(Array.isArray(component.requirements)).toBe(true);
      }
    }

    const withoutLotsResponse = await testFetch(
      "/api/agent/production-planning/context?includeLots=false"
    );
    expect(withoutLotsResponse.status).toBe(200);
    const withoutLots = await withoutLotsResponse.json();
    expect(Array.isArray(withoutLots.productCounts)).toBe(true);

    const after = await readMutationSensitiveCounts(db);

    expect(after).toEqual(before);
  });

  test("allows external bearer token access and token revocation", async () => {
    const createResponse = await testFetch("/api/agent/api-tokens", {
      method: "POST",
      body: JSON.stringify({ name: "Playwright external agent token" }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.token).toMatch(/^ash_agent\./);
    expect(created.tokenRecord.name).toBe("Playwright external agent token");
    expect(created.tokenRecord.scopes).toContain("production_planning:read");

    const listResponse = await testFetch("/api/agent/api-tokens");
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json();
    expect(
      listed.tokens.some((token: { id: string }) => token.id === created.tokenRecord.id)
    ).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(created.token);

    const bearerResponse = await fetch(
      `${getBaseUrl()}/api/agent/production-planning/context?includeLots=false`,
      {
        headers: {
          Authorization: `Bearer ${created.token}`,
          Origin: getBaseUrl(),
        },
      }
    );
    expect(bearerResponse.status).toBe(200);
    const context = await bearerResponse.json();
    expect(context).not.toHaveProperty("orgId");
    expect(context).not.toHaveProperty("inputHash");
    expect(context).not.toHaveProperty("today");
    expect(context).not.toHaveProperty("horizon");
    expect(Array.isArray(context.productCounts)).toBe(true);

    const revokeResponse = await testFetch(
      `/api/agent/api-tokens/${created.tokenRecord.id}`,
      { method: "DELETE" }
    );
    expect(revokeResponse.status).toBe(200);

    const revokedResponse = await fetch(
      `${getBaseUrl()}/api/agent/production-planning/context`,
      {
        headers: {
          Authorization: `Bearer ${created.token}`,
          Origin: getBaseUrl(),
        },
      }
    );
    expect(revokedResponse.status).toBe(401);
  });
});
