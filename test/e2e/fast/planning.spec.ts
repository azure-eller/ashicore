import { asc, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createPlanningManufacturingOrderDraft,
  createPlanningPurchaseOrderDraft,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  getBaseUrl,
  getPlanningSnapshot,
  getUnitId,
  releaseManufacturingOrder,
  submitPurchaseOrder,
} from "../../helpers/api";
import type {
  DemandFact,
  PlanningSnapshot,
} from "../../../lib/planning/types";

function extractCookies(res: Response): string {
  const cookies: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value.split(";")[0]);
    }
  });
  return cookies.join("; ");
}

async function fetchWithCookies(
  cookies: string,
  path: string,
  options: RequestInit = {}
) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);

  if (method !== "GET" && method !== "HEAD" && !headers.has("Idempotency-Key")) {
    headers.set(
      "Idempotency-Key",
      `planning-cross-org:${method}:${path}:${crypto.randomUUID()}`
    );
  }

  return fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Origin: getBaseUrl(),
      Cookie: cookies,
      ...Object.fromEntries(headers.entries()),
    },
    redirect: "manual",
  });
}

test.describe("Planning workspace", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const suffix = String(ts).slice(-8);
  const unitId = getUnitId();
  const category = `Fast Planning ${ts}`;
  let customerId = "";
  let supplierId = "";

  async function snapshot(): Promise<PlanningSnapshot> {
    const result = await getPlanningSnapshot();
    expect(result.status).toBe(200);
    return result.body as PlanningSnapshot;
  }

  function rowFor(snapshot: PlanningSnapshot, itemId: string) {
    const row = snapshot.rows.find((entry) => entry.item.id === itemId);
    expect(row).toBeDefined();
    if (!row) throw new Error(`Missing planning row for ${itemId}`);
    return row;
  }

  function recommendationFor(snapshot: PlanningSnapshot, itemId: string) {
    const recommendation = snapshot.recommendations.find(
      (entry) => entry.itemId === itemId
    );
    expect(recommendation).toBeDefined();
    if (!recommendation) throw new Error(`Missing recommendation for ${itemId}`);
    return recommendation;
  }

  async function createMaterial(name: string, options?: {
    stock?: string;
    safetyStock?: string;
    defaultPurchasePrice?: string | null;
  }) {
    const result = await createItem({
      name,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `PLAN-M-${name.replaceAll(" ", "-").slice(0, 24)}-${suffix}`,
      category,
      description: null,
      defaultPurchasePrice: options?.defaultPurchasePrice ?? "1.00",
      defaultSellingPrice: "1.00",
      stock: options?.stock ?? "0",
      safetyStock: options?.safetyStock ?? "0",
      bom: [],
    });
    expect(result.status).toBe(201);
    return result.body.id as string;
  }

  async function createProduct(name: string, bom: Array<{ componentId: string; quantity: string }>) {
    const result = await createItem({
      name,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PLAN-P-${name.replaceAll(" ", "-").slice(0, 24)}-${suffix}`,
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom,
    });
    expect(result.status).toBe(201);
    return result.body.id as string;
  }

  async function createConfirmedDemand(itemId: string, quantity: string) {
    const result = await createSalesOrder({
      customerId,
      status: "confirmed",
      requestedDate: "2026-05-15",
      notes: null,
      lines: [{ itemId, quantity, unitPrice: "1.00" }],
      confirmOversell: true,
    });
    expect(result.status).toBe(201);
    return result.body.id as string;
  }

  async function establishSupplierHistory(itemId: string) {
    const result = await createPurchaseOrder({
      supplierId,
      expectedDate: null,
      notes: `Planning supplier history ${ts}`,
      lines: [{ itemId, quantityOrdered: "1", unitCost: "1.00" }],
    });
    expect(result.status).toBe(201);
    return result.body.id as string;
  }

  async function createOtherOrgPlanningRecommendation() {
    const email = `planning-other-${ts}@example.com`;
    const signup = await fetch(`${getBaseUrl()}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: getBaseUrl(),
      },
      body: JSON.stringify({
        name: "Planning Other Org",
        email,
        password: "TestPassword123!",
      }),
      redirect: "manual",
    });
    let cookies = extractCookies(signup);
    expect(cookies).toBeTruthy();

    const org = await fetchWithCookies(cookies, "/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({
        name: `Planning Other Org ${ts}`,
        slug: `planning-other-${ts}`,
      }),
    });
    expect(org.status).toBe(200);
    const orgCookies = extractCookies(org);
    if (orgCookies) cookies = orgCookies;
    const orgBody = await org.json();

    const setOrg = await fetchWithCookies(
      cookies,
      "/api/auth/organization/set-active",
      {
        method: "POST",
        body: JSON.stringify({ organizationId: orgBody.id }),
      }
    );
    expect(setOrg.status).toBe(200);
    const setOrgCookies = extractCookies(setOrg);
    if (setOrgCookies) cookies = setOrgCookies;

    const unit = await fetchWithCookies(cookies, "/api/units", {
      method: "POST",
      body: JSON.stringify({
        name: `planning-other-unit-${ts}`,
        size: "1",
        uom: "kg",
      }),
    });
    expect(unit.status).toBe(201);
    const unitBody = await unit.json();

    const supplier = await fetchWithCookies(cookies, "/api/suppliers", {
      method: "POST",
      body: JSON.stringify({
        name: `Planning Other Supplier ${ts}`,
        code: `PLAN-OTHER-SUP-${ts}`,
      }),
    });
    expect(supplier.status).toBe(201);

    const item = await fetchWithCookies(cookies, "/api/items", {
      method: "POST",
      body: JSON.stringify({
        name: `Planning Other Org Material ${ts}`,
        itemType: "material",
        unitDefinitionId: unitBody.id,
        sku: `PLAN-OTHER-M-${suffix}`,
        category,
        description: null,
        defaultPurchasePrice: "1.00",
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "5",
        bom: [],
      }),
    });
    expect(item.status).toBe(201);
    const itemBody = await item.json();

    const planning = await fetchWithCookies(cookies, "/api/planning");
    expect(planning.status).toBe(200);
    const planningBody = (await planning.json()) as PlanningSnapshot;
    const recommendation = recommendationFor(planningBody, itemBody.id);
    expect(recommendation.actionPayload).toBeTruthy();

    return {
      itemId: itemBody.id as string,
      actionPayload: recommendation.actionPayload!,
    };
  }

  test("sets up customer and supplier", async () => {
    const customer = await createCustomer({
      name: `Planning Customer ${ts}`,
      email: `planning-${ts}@example.com`,
    });
    expect(customer.status).toBe(201);
    customerId = customer.body.id as string;

    const supplier = await createSupplier({
      name: `Planning Supplier ${ts}`,
      code: `PLAN-SUP-${ts}`,
    });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id as string;
  });

  test("confirmed sales order creates demand and shortage", async () => {
    const itemId = await createMaterial(`Planning Sales Short ${ts}`);
    await createConfirmedDemand(itemId, "5");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("5");
    expect(row.shortageQuantity).toBe("5");
    expect(row.reasonCodes).toContain("sales_order_demand");
    expect(row.reasonCodes).toContain("projected_shortage");
  });

  test("safety stock creates demand and shortage", async () => {
    const itemId = await createMaterial(`Planning Safety Short ${ts}`, {
      safetyStock: "4",
    });

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("4");
    expect(row.shortageQuantity).toBe("4");
    expect(row.reasonCodes).toContain("safety_stock_demand");
  });

  test("available inventory reduces shortage", async () => {
    const itemId = await createMaterial(`Planning Stock Nets ${ts}`, { stock: "4" });
    await createConfirmedDemand(itemId, "10");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("10");
    expect(row.shortageQuantity).toBe("6");
    expect(row.reasonCodes).toContain("inventory_available");
  });

  test("reserved inventory is not double-counted as available", async () => {
    const itemId = await createMaterial(`Planning Reserved Nets ${ts}`, { stock: "10" });
    await createConfirmedDemand(itemId, "8");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("8");
    expect(row.reservedQuantity).toBe("8");
    expect(row.availableStock).toBe("2");
    expect(row.projectedQuantity).toBe("2");
    expect(row.shortageQuantity).toBe("0");
  });

  test("open purchase order supply nets down purchased item shortage", async () => {
    const itemId = await createMaterial(`Planning PO Nets ${ts}`);
    await createConfirmedDemand(itemId, "10");
    const purchaseOrder = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-05-01",
      notes: null,
      lines: [{ itemId, quantityOrdered: "4", unitCost: "1.00" }],
    });
    expect(purchaseOrder.status).toBe(201);
    const submit = await submitPurchaseOrder(purchaseOrder.body.id as string);
    expect(submit.status).toBe(200);

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.incomingPurchaseOrderQuantity).toBe("4");
    expect(row.shortageQuantity).toBe("6");
    expect(row.reasonCodes).toContain("open_purchase_supply");
  });

  test("open manufacturing order supply nets down manufactured item shortage", async () => {
    const componentId = await createMaterial(`Planning MO Component ${ts}`, {
      stock: "100",
    });
    const productId = await createProduct(`Planning MO Product ${ts}`, [
      { componentId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "10");
    const order = await createManufacturingOrder({
      productId,
      plannedQuantity: "4",
      plannedDate: "2026-05-01",
      notes: null,
      ingredients: [{ itemId: componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);
    const release = await releaseManufacturingOrder(order.body.id as string, {
      confirmShortage: false,
    });
    expect(release.status).toBe(200);

    const planning = await snapshot();
    const row = rowFor(planning, productId);

    expect(row.incomingManufacturingOrderQuantity).toBe("4");
    expect(row.shortageQuantity).toBe("6");
    expect(row.reasonCodes).toContain("open_manufacturing_supply");
  });

  test("BOM explosion creates component demand for a manufactured finished good", async () => {
    const componentId = await createMaterial(`Planning BOM Component ${ts}`);
    const productId = await createProduct(`Planning BOM Product ${ts}`, [
      { componentId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "5");

    const planning = await snapshot();
    const componentRow = rowFor(planning, componentId);
    const componentDemand = planning.demandFacts.find(
      (fact) => fact.itemId === componentId && fact.demandType === "bom_explosion"
    );

    expect(componentRow.demandQuantity).toBe("10");
    expect(componentDemand?.quantity).toBe("10");
    expect(componentDemand?.reasonCodes).toContain("bom_component_demand");
  });

  test("multi-level BOM explosion works", async () => {
    const componentId = await createMaterial(`Planning Multi Component ${ts}`);
    const subassemblyId = await createProduct(`Planning Multi Sub ${ts}`, [
      { componentId, quantity: "3" },
    ]);
    const productId = await createProduct(`Planning Multi Product ${ts}`, [
      { componentId: subassemblyId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "4");

    const planning = await snapshot();
    const subassemblyRow = rowFor(planning, subassemblyId);
    const componentRow = rowFor(planning, componentId);

    expect(subassemblyRow.demandQuantity).toBe("8");
    expect(componentRow.demandQuantity).toBe("24");
  });

  test("suggested action is buy for purchased items and make for manufactured items", async () => {
    const materialId = await createMaterial(`Planning Buy Action ${ts}`);
    await establishSupplierHistory(materialId);
    await createConfirmedDemand(materialId, "3");
    const componentId = await createMaterial(`Planning Make Action Component ${ts}`);
    const productId = await createProduct(`Planning Make Action Product ${ts}`, [
      { componentId, quantity: "1" },
    ]);
    await createConfirmedDemand(productId, "2");

    const planning = await snapshot();
    const buyRecommendation = recommendationFor(planning, materialId);
    const makeRecommendation = recommendationFor(planning, productId);

    expect(buyRecommendation.recommendationType).toBe("create_purchase_order");
    expect(makeRecommendation.recommendationType).toBe("create_manufacturing_order");
    expect(rowFor(planning, materialId).suggestedAction).toBe("buy");
    expect(rowFor(planning, productId).suggestedAction).toBe("make");
  });

  test("missing supplier or missing BOM produces review recommendation", async () => {
    const alternateSupplier = await createSupplier({
      name: `Planning Alternate Supplier ${ts}`,
      code: `PLAN-ALT-${ts}`,
    });
    expect(alternateSupplier.status).toBe(201);

    const materialId = await createMaterial(`Planning Missing Supplier ${ts}`);
    await createConfirmedDemand(materialId, "3");
    const productId = await createProduct(`Planning Missing BOM ${ts}`, []);
    await createConfirmedDemand(productId, "2");

    const planning = await snapshot();
    const materialRecommendation = recommendationFor(planning, materialId);
    const productRecommendation = recommendationFor(planning, productId);

    expect(materialRecommendation.recommendationType).toBe("review_item_setup");
    expect(materialRecommendation.reasonCodes).toEqual(
      expect.arrayContaining(["ambiguous_supplier"])
    );
    expect(productRecommendation.recommendationType).toBe("review_item_setup");
    expect(productRecommendation.reasonCodes).toContain("missing_bom");
  });

  test("existing supply prevents duplicate recommendations", async () => {
    const itemId = await createMaterial(`Planning Covered Supply ${ts}`);
    await createConfirmedDemand(itemId, "3");
    const purchaseOrder = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-05-01",
      notes: null,
      lines: [{ itemId, quantityOrdered: "3", unitCost: "1.00" }],
    });
    expect(purchaseOrder.status).toBe(201);
    const submit = await submitPurchaseOrder(purchaseOrder.body.id as string);
    expect(submit.status).toBe(200);

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.shortageQuantity).toBe("0");
    expect(planning.recommendations.some((entry) => entry.itemId === itemId)).toBe(false);
  });

  test("planner output is deterministic for the same input data", async () => {
    const itemId = await createMaterial(`Planning Deterministic ${ts}`);
    await createConfirmedDemand(itemId, "2");

    const first = await snapshot();
    const second = await snapshot();

    expect(first.inputHash).toBe(second.inputHash);
    expect(rowFor(first, itemId)).toEqual(rowFor(second, itemId));
  });

  test("recommendations include source refs and reason codes", async () => {
    const itemId = await createMaterial(`Planning Explainable ${ts}`);
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "2");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);

    expect(recommendation.sourceRefs.length).toBeGreaterThan(0);
    expect(recommendation.reasonCodes).toEqual(
      expect.arrayContaining(["sales_order_demand", "projected_shortage", "buy_item"])
    );
  });

  test("component shortage references parent demand and BOM revision", async () => {
    const componentId = await createMaterial(`Planning Explain Component ${ts}`);
    const productId = await createProduct(`Planning Explain Parent ${ts}`, [
      { componentId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "3");

    const planning = await snapshot();
    const componentDemand = planning.demandFacts.find(
      (fact): fact is DemandFact =>
        fact.itemId === componentId && fact.demandType === "bom_explosion"
    );

    expect(componentDemand).toBeDefined();
    expect(componentDemand?.parentItemId).toBe(productId);
    expect(componentDemand?.bomRevisionId).toBeTruthy();
    expect(componentDemand?.sourceRefs.some((ref) => ref.sourceType === "bom_revision")).toBe(true);
  });

  test("create PO draft from recommendation validates payload and creates a draft", async ({
    db,
  }) => {
    const itemId = await createMaterial(`Planning PO Action ${ts}`);
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "6");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);
    expect(recommendation.actionPayload?.actionType).toBe("create_purchase_order");

    const created = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(created.status).toBe(201);

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, created.body.id as string));
    expect(order.status).toBe("draft");
    expect(order.supplierId).toBe(supplierId);
    expect(order.notes).toContain("[planning-recommendation:");

    const [line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, created.body.id as string));
    expect(line.itemId).toBe(itemId);
    expect(line.quantityOrdered).toBe("6.0000");
  });

  test("create WO draft from recommendation validates payload and creates a draft", async ({
    db,
  }) => {
    const componentId = await createMaterial(`Planning WO Action Component ${ts}`);
    const productId = await createProduct(`Planning WO Action Product ${ts}`, [
      { componentId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "5");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, productId);
    expect(recommendation.actionPayload?.actionType).toBe("create_manufacturing_order");

    const created = await createPlanningManufacturingOrderDraft(
      recommendation.actionPayload!
    );
    expect(created.status).toBe(201);

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, created.body.id as string));
    expect(order.status).toBe("draft");
    expect(order.productId).toBe(productId);
    expect(order.bomRevisionId).toBe(recommendation.suggestedBomRevisionId);
    expect(order.notes).toContain("[planning-recommendation:");

    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, created.body.id as string));
    expect(ingredients).toHaveLength(1);
    expect(ingredients[0].itemId).toBe(componentId);
    expect(ingredients[0].plannedQuantity).toBe("10.0000");
  });

  test("duplicate recommendation action is rejected", async () => {
    const itemId = await createMaterial(`Planning Duplicate Action ${ts}`);
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "4");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);
    expect(recommendation.actionPayload).toBeTruthy();

    const first = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(first.status).toBe(201);
    const duplicate = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(duplicate.status).toBe(409);
  });

  test("authorization keeps another org planning data and actions isolated", async () => {
    const otherOrg = await createOtherOrgPlanningRecommendation();

    const planning = await snapshot();
    expect(planning.rows.some((row) => row.item.id === otherOrg.itemId)).toBe(false);
    expect(
      planning.recommendations.some((entry) => entry.itemId === otherOrg.itemId)
    ).toBe(false);

    const crossOrgAction = await createPlanningPurchaseOrderDraft(
      otherOrg.actionPayload
    );
    expect(crossOrgAction.status).toBe(409);
  });

  test("planning page shows drilldown and creates a suggested PO draft", async ({
    page,
    db,
  }) => {
    const itemName = `Planning UI Action ${ts}`;
    const itemId = await createMaterial(itemName);
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "7");

    await page.goto("/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await page.getByLabel("Search planning").fill(itemName);
    await expect(page.getByRole("cell", { name: itemName })).toBeVisible();
    await expect(page.getByText("sales_order_demand")).toBeVisible();
    await expect(page.getByText("projected_shortage")).toBeVisible();

    await page.getByRole("button", { name: "Drilldown" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Demand Sources");
    await expect(page.getByRole("dialog")).toContainText("Supply Sources");
    await expect(page.getByRole("dialog")).toContainText("Source References");

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith("/api/planning/actions/purchase-order")
      ),
      page.getByRole("button", { name: "Create PO Draft" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await page.waitForURL(/\/purchasing\/orders\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/PO-/);

    const createdId = page.url().split("/").at(-1) ?? "";
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, createdId));
    expect(order.status).toBe("draft");
    expect(order.supplierId).toBe(supplierId);
    expect(order.notes).toContain("[planning-recommendation:");

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, createdId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe(itemId);
    expect(lines[0].quantityOrdered).toBe("7.0000");
  });
});
