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
  test("requires authentication", async () => {
    const response = await fetch(
      `${getBaseUrl()}/api/agent/production-planning/context`,
      {
        headers: { Origin: getBaseUrl() },
        redirect: "manual",
      }
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  test("returns full read-only context with the planning input hash", async ({ db }) => {
    const before = await readMutationSensitiveCounts(db);

    const planningResponse = await testFetch("/api/planning");
    expect(planningResponse.status).toBe(200);
    const planning = await planningResponse.json();

    const response = await testFetch("/api/agent/production-planning/context");
    expect(response.status).toBe(200);
    const context = await response.json();

    expect(context.inputHash).toBe(planning.inputHash);
    expect(context.planning.inputHash).toBe(planning.inputHash);
    expect(context.planning.horizonStart).toBe(planning.horizonStart);
    expect(context.planning.horizonEnd).toBe(planning.horizonEnd);
    expect(context.planning.assumptions).toEqual(planning.assumptions);
    expect(context.planning.assumptions.length).toBeGreaterThan(0);
    expect(context.summary.openSalesOrderCount).toBe(context.salesOrders.length);
    expect(context.summary.openManufacturingOrderCount).toBe(
      context.manufacturingOrders.length
    );
    expect(context.summary.openPurchaseOrderCount).toBe(context.purchaseOrders.length);
    expect(context.summary.activeAllocationCount).toBe(context.allocations.length);
    expect(Array.isArray(context.salesOrders)).toBe(true);
    expect(Array.isArray(context.manufacturingOrders)).toBe(true);
    expect(Array.isArray(context.purchaseOrders)).toBe(true);
    expect(Array.isArray(context.inventory)).toBe(true);
    expect(Array.isArray(context.allocations)).toBe(true);
    expect(Array.isArray(context.planning.rows)).toBe(true);
    expect(Array.isArray(context.planning.demandFacts)).toBe(true);
    expect(Array.isArray(context.planning.supplyFacts)).toBe(true);
    expect(Array.isArray(context.planning.bomRequirements)).toBe(true);
    expect(Array.isArray(context.planning.productionBlockers)).toBe(true);
    expect(Array.isArray(context.planning.salesOrderProductionDemandPaths)).toBe(true);
    expect(Array.isArray(context.attentionQueue)).toBe(true);
    for (const item of context.attentionQueue as Array<{
      sourceRefs: Array<{ sourceType?: string; sourceId?: string }>;
    }>) {
      for (const ref of item.sourceRefs) {
        expect(ref.sourceType).toBeTruthy();
        expect(ref.sourceId).toBeTruthy();
      }
    }
    for (const item of context.inventory as Array<{
      inventoryLotAllocatedQty: unknown;
      manufacturingOutputAllocatedQty: unknown;
      totalActiveAllocationQty: unknown;
    }>) {
      expect(typeof item.inventoryLotAllocatedQty).toBe("string");
      expect(typeof item.manufacturingOutputAllocatedQty).toBe("string");
      expect(typeof item.totalActiveAllocationQty).toBe("string");
    }

    const withoutLotsResponse = await testFetch(
      "/api/agent/production-planning/context?includeLots=false"
    );
    expect(withoutLotsResponse.status).toBe(200);
    const withoutLots = await withoutLotsResponse.json();
    expect(
      withoutLots.inventory.every(
        (item: { lots: unknown[] }) => Array.isArray(item.lots) && item.lots.length === 0
      )
    ).toBe(true);

    const after = await readMutationSensitiveCounts(db);

    expect(after).toEqual(before);
  });
});
