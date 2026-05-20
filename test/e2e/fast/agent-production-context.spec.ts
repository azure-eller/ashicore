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

  test("returns full read-only context with the planning input hash", async ({ db }) => {
    const before = await readMutationSensitiveCounts(db);

    const planningResponse = await testFetch("/api/planning");
    expect(planningResponse.status).toBe(200);
    const planning = await planningResponse.json();

    const markdownResponse = await testFetch("/api/agent/production-planning/context");
    expect(markdownResponse.status).toBe(200);
    expect(markdownResponse.headers.get("content-type")).toContain("text/markdown");
    const markdown = await markdownResponse.text();
    expect(markdown).toContain("# Production Planning Brief");
    expect(markdown).toContain("## Allocate Now");
    expect(markdown).toContain("## Make Next");
    expect(markdown.length).toBeLessThan(20_000);

    const response = await testFetch(
      "/api/agent/production-planning/context?format=json"
    );
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
    expect(context.summary.allocationNeedCount).toBe(
      context.decisionSupport.allocationNeeds.length
    );
    expect(context.summary.supplyRecommendationCount).toBe(
      context.decisionSupport.supplyRecommendations.length
    );
    expect(Array.isArray(context.salesOrders)).toBe(true);
    expect(Array.isArray(context.manufacturingOrders)).toBe(true);
    expect(Array.isArray(context.purchaseOrders)).toBe(true);
    expect(Array.isArray(context.inventory)).toBe(true);
    expect(Array.isArray(context.allocations)).toBe(true);
    expect(Array.isArray(context.decisionSupport.decisionQueue)).toBe(true);
    expect(Array.isArray(context.decisionSupport.allocationNeeds)).toBe(true);
    expect(Array.isArray(context.decisionSupport.supplyRecommendations)).toBe(true);
    expect(Array.isArray(context.planning.rows)).toBe(true);
    expect(Array.isArray(context.planning.demandFacts)).toBe(true);
    expect(Array.isArray(context.planning.supplyFacts)).toBe(true);
    expect(Array.isArray(context.planning.bomRequirements)).toBe(true);
    expect(Array.isArray(context.planning.productionBlockers)).toBe(true);
    expect(Array.isArray(context.planning.salesOrderProductionDemandPaths)).toBe(true);
    expect(Array.isArray(context.attentionQueue)).toBe(true);
    expect(JSON.stringify(context.planning.rows)).not.toContain("unitCost");
    expect(JSON.stringify(context.planning.recommendations)).not.toContain(
      "actionPayload"
    );
    expect(JSON.stringify(context.planning.bomRequirements)).not.toContain(
      "quantityPerParent"
    );
    for (const recommendation of context.planning.recommendations as Array<{
      sourceRefs: unknown[];
    }>) {
      expect(recommendation.sourceRefs.length).toBeLessThanOrEqual(24);
    }
    for (const blocker of context.planning.productionBlockers as Array<{
      sourceRefs: unknown[];
    }>) {
      expect(blocker.sourceRefs.length).toBeLessThanOrEqual(24);
    }
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
    for (const need of context.decisionSupport.allocationNeeds as Array<{
      demandType: string;
      demandId: string;
      itemId: string;
      unallocatedQty: string;
      allocationRankForItem: number;
      availableQty: string;
      availableQtyBeforeThisNeed: string;
      availableQtyAfterThisNeed: string;
      projectedQty: string;
      projectedQtyAfterThisNeed: string;
      readiness: string;
      sourceRefs: Array<{ sourceType?: string; sourceId?: string }>;
    }>) {
      expect(["sales_order_line", "manufacturing_order_ingredient"]).toContain(
        need.demandType
      );
      expect(need.demandId).toBeTruthy();
      expect(need.itemId).toBeTruthy();
      expect(Number(need.unallocatedQty)).toBeGreaterThan(0);
      expect(need.allocationRankForItem).toBeGreaterThanOrEqual(1);
      expect(typeof need.availableQty).toBe("string");
      expect(typeof need.availableQtyBeforeThisNeed).toBe("string");
      expect(typeof need.availableQtyAfterThisNeed).toBe("string");
      expect(typeof need.projectedQty).toBe("string");
      expect(typeof need.projectedQtyAfterThisNeed).toBe("string");
      expect([
        "allocate_available_inventory",
        "available_after_open_supply",
        "create_supply",
        "blocked",
        "review",
      ]).toContain(need.readiness);
      for (const ref of need.sourceRefs) {
        expect(ref.sourceType).toBeTruthy();
        expect(ref.sourceId).toBeTruthy();
      }
    }
    for (const decision of context.decisionSupport.decisionQueue as Array<{
      decisionType: string;
      severity: string;
      label: string;
      sourceRefs: Array<{ sourceType?: string; sourceId?: string }>;
    }>) {
      expect([
        "allocate_inventory",
        "create_manufacturing_order",
        "create_purchase_order",
        "review_item_setup",
        "resolve_blocker",
      ]).toContain(decision.decisionType);
      expect(["info", "warning", "urgent"]).toContain(decision.severity);
      expect(decision.label).toBeTruthy();
      for (const ref of decision.sourceRefs) {
        expect(ref.sourceType).toBeTruthy();
        expect(ref.sourceId).toBeTruthy();
      }
    }
    for (const recommendation of context.decisionSupport
      .supplyRecommendations as Array<{
      recommendationId: string;
      itemId: string;
      itemName: string;
      quantity: string;
      sourceRefs: Array<{ sourceType?: string; sourceId?: string }>;
    }>) {
      expect(recommendation.recommendationId).toBeTruthy();
      expect(recommendation.itemId).toBeTruthy();
      expect(recommendation.itemName).toBeTruthy();
      expect(Number(recommendation.quantity)).toBeGreaterThan(0);
      for (const ref of recommendation.sourceRefs) {
        expect(ref.sourceType).toBeTruthy();
        expect(ref.sourceId).toBeTruthy();
      }
    }

    const withoutLotsResponse = await testFetch(
      "/api/agent/production-planning/context?format=json&includeLots=false"
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

  test("allows external bearer token access and token revocation", async () => {
    const planningResponse = await testFetch("/api/planning");
    expect(planningResponse.status).toBe(200);
    const planning = await planningResponse.json();

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
      `${getBaseUrl()}/api/agent/production-planning/context?format=json&includeLots=false`,
      {
        headers: {
          Authorization: `Bearer ${created.token}`,
          Origin: getBaseUrl(),
        },
      }
    );
    expect(bearerResponse.status).toBe(200);
    const context = await bearerResponse.json();
    expect(context.inputHash).toBe(planning.inputHash);
    expect(context.planning.inputHash).toBe(planning.inputHash);
    expect(
      context.inventory.every(
        (item: { lots: unknown[] }) => Array.isArray(item.lots) && item.lots.length === 0
      )
    ).toBe(true);

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
