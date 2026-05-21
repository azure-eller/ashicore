import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { test, expect, type TestDb } from "../fixtures";
import {
  inventoryEvents,
  manufacturingOrders,
  purchaseOrders,
  stockAllocations,
} from "../../../lib/db/schema";
import { getBaseUrl, getSessionCookie, testFetch } from "../../helpers/api";

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

async function readMcpJsonResponse(response: Response) {
  const text = await response.text();

  if (!text.startsWith("event:")) {
    return JSON.parse(text);
  }

  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`MCP SSE response did not include a data line: ${text}`);
  }

  return JSON.parse(dataLine.slice("data: ".length));
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
    expect(Array.isArray(context.productBoms)).toBe(true);
    expect(context).not.toHaveProperty("productRequirements");
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
      lotCounts: Array<{
        lotId: string;
        receivedDate: string | null;
        ageDays: number | null;
      }>;
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
      expect(Array.isArray(item.lotCounts)).toBe(true);
      for (const lot of item.lotCounts) {
        expect(lot.lotId).toBeTruthy();
        expect(lot.receivedDate == null || /^\d{4}-\d{2}-\d{2}$/.test(lot.receivedDate)).toBe(true);
        expect(lot.ageDays == null || typeof lot.ageDays === "number").toBe(true);
      }
    }

    for (const bom of context.productBoms as Array<{
      productItemId: string;
      productName: string;
      components: Array<{
        bomRevisionComponentId: string;
        componentItemId: string;
        componentName: string;
        componentItemType: string;
        quantityMeaning: string;
        requirements: Array<{ type: string; days?: number }>;
      }>;
    }>) {
      expect(bom.productItemId).toBeTruthy();
      expect(bom.productName).toBeTruthy();
      expect(Array.isArray(bom.components)).toBe(true);
      for (const component of bom.components) {
        expect(component.bomRevisionComponentId).toBeTruthy();
        expect(component.componentItemId).toBeTruthy();
        expect(component.componentItemType).toBe("product");
        expect(component.quantityMeaning).toContain(component.componentName);
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

  test("supports Claude remote MCP OAuth and tool calls", async () => {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const clientId = "https://claude.ai/.well-known/oauth-client";
    const authorizeUrl = new URL(
      `${getBaseUrl()}/api/agent/mcp/oauth/authorize`
    );

    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "production_planning:read");
    authorizeUrl.searchParams.set("state", "test-state");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const authorizeResponse = await fetch(authorizeUrl, {
      headers: {
        Cookie: getSessionCookie(),
        Origin: getBaseUrl(),
      },
      redirect: "manual",
    });
    expect(authorizeResponse.status).toBe(307);

    const location = authorizeResponse.headers.get("location");
    expect(location).toBeTruthy();
    const callbackUrl = new URL(location!);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get("state")).toBe("test-state");
    const code = callbackUrl.searchParams.get("code");
    expect(code).toMatch(/^ash_mcp_code\./);

    const tokenResponse = await fetch(
      `${getBaseUrl()}/api/agent/mcp/oauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: getBaseUrl(),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code!,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      }
    );
    expect(tokenResponse.status).toBe(200);
    const tokenBody = await tokenResponse.json();
    expect(tokenBody.access_token).toMatch(/^ash_mcp_access\./);
    expect(tokenBody.refresh_token).toMatch(/^ash_mcp_refresh\./);
    expect(tokenBody.scope).toBe("production_planning:read");

    const unauthenticatedMcpResponse = await fetch(
      `${getBaseUrl()}/api/agent/mcp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Origin: getBaseUrl(),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_production_planning_context",
            arguments: {},
          },
        }),
      }
    );
    expect(unauthenticatedMcpResponse.status).toBe(401);
    expect(unauthenticatedMcpResponse.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/api/agent/mcp"
    );

    const toolResponse = await fetch(
      `${getBaseUrl()}/api/agent/mcp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${tokenBody.access_token}`,
          Origin: getBaseUrl(),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "get_production_planning_context",
            arguments: {},
          },
        }),
      }
    );
    expect(toolResponse.status).toBe(200);
    const toolBody = await readMcpJsonResponse(toolResponse);
    const toolText = toolBody.result.content[0].text;
    const context = JSON.parse(toolText);

    expect(Array.isArray(context.openSalesOrders)).toBe(true);
    expect(Array.isArray(context.openManufacturingOrders)).toBe(true);
    expect(Array.isArray(context.productCounts)).toBe(true);
    expect(Array.isArray(context.productBoms)).toBe(true);
    expect(context).not.toHaveProperty("orgId");
    expect(context).not.toHaveProperty("today");
  });
});
