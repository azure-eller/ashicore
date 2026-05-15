import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryLotBalances,
  lots,
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
  fulfillSalesOrder,
  getBaseUrl,
  getPlanningSnapshot,
  getUnitId,
  releaseManufacturingOrder,
  submitPurchaseOrder,
  testFetch,
} from "../../helpers/api";
import type {
  DemandFact,
  PlanningSnapshot,
  ProductionDemandPath,
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
  const runToken = String(ts).slice(-8);
  const unitId = getUnitId();
  const category = "Paonia planning fixtures";
  const customerName = "North Fork Farmstead";
  const supplierName = "Western Slope Organics";
  const alternateSupplierName = "Mesa Packaging";
  let itemSequence = 0;
  let customerId = "";
  let supplierId = "";

  type CreatedPlanningItem = {
    id: string;
    name: string;
    sku: string;
  };

  function skuSegment(value: string) {
    return value
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toUpperCase()
      .slice(0, 24);
  }

  function buildItemSku(prefix: "PLAN-M" | "PLAN-P", key: string) {
    const index = String(++itemSequence).padStart(2, "0");
    return `${prefix}-${index}-${skuSegment(key)}-${runToken}`.slice(0, 50);
  }

  function isoDateDaysFromToday(days: number) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function utcDateDaysFromToday(days: number) {
    return new Date(`${isoDateDaysFromToday(days)}T00:00:00.000Z`);
  }

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

  function productionDemandPathsFor(
    snapshot: PlanningSnapshot,
    itemId: string
  ): ProductionDemandPath[] {
    return snapshot.salesOrderProductionDemandPaths.filter(
      (entry) => entry.itemId === itemId
    );
  }

  async function ensureCustomerId() {
    if (customerId) return customerId;

    const customer = await createCustomer({
      name: `${customerName} ${runToken}`,
      email: `planning-fallback-${runToken}@example.com`,
    });
    expect(customer.status).toBe(201);
    customerId = customer.body.id as string;
    return customerId;
  }

  function deterministicRecommendationShape(
    snapshot: PlanningSnapshot,
    itemId: string
  ) {
    const recommendation = recommendationFor(snapshot, itemId);
    const actionPayload = recommendation.actionPayload
      ? {
          ...recommendation.actionPayload,
          inputHash: "<snapshot-scoped>",
          recommendationId: "<recommendation-scoped>",
        }
      : null;

    return {
      ...recommendation,
      id: "<recommendation-scoped>",
      actionPayload,
    };
  }

  async function createMaterialRecord(name: string, options?: {
    stock?: string;
    safetyStock?: string;
    defaultPurchasePrice?: string | null;
    skuKey?: string;
  }): Promise<CreatedPlanningItem> {
    const sku = buildItemSku("PLAN-M", options?.skuKey ?? name);
    const result = await createItem({
      name,
      itemType: "material",
      unitDefinitionId: unitId,
      sku,
      category,
      description: null,
      defaultPurchasePrice: options?.defaultPurchasePrice ?? "1.00",
      defaultSellingPrice: "1.00",
      stock: options?.stock ?? "0",
      safetyStock: options?.safetyStock ?? "0",
      bom: [],
    });
    expect(result.status).toBe(201);
    return { id: result.body.id as string, name, sku };
  }

  async function createMaterial(name: string, options?: {
    stock?: string;
    safetyStock?: string;
    defaultPurchasePrice?: string | null;
    skuKey?: string;
  }) {
    return (await createMaterialRecord(name, options)).id;
  }

  async function createProduct(
    name: string,
    bom: Array<{
      componentId: string;
      quantity: string;
      minimumLotAgeDays?: number | null;
    }>
  ) {
    const result = await createItem({
      name,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", name),
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
    const demandCustomerId = await ensureCustomerId();
    const result = await createSalesOrder({
      customerId: demandCustomerId,
      status: "open",
      requestedDate: isoDateDaysFromToday(13),
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
      notes: "Supplier history for planning fixture",
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
        name: "Parallel Test Planner",
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
        name: "Parallel Test Org",
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
        name: "Each",
        size: "1",
        uom: "ea",
      }),
    });
    expect(unit.status).toBe(201);
    const unitBody = await unit.json();

    const supplier = await fetchWithCookies(cookies, "/api/suppliers", {
      method: "POST",
      body: JSON.stringify({
        name: "Delta Packaging",
        code: `PLAN-OTHER-SUP-${ts}`,
      }),
    });
    expect(supplier.status).toBe(201);

    const item = await fetchWithCookies(cookies, "/api/items", {
      method: "POST",
      body: JSON.stringify({
        name: "Coco Coir Brick",
        itemType: "material",
        unitDefinitionId: unitBody.id,
        sku: `PLAN-OTHER-M-${runToken}`,
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
      name: customerName,
      email: `planning-${ts}@example.com`,
    });
    expect(customer.status).toBe(201);
    customerId = customer.body.id as string;

    const supplier = await createSupplier({
      name: supplierName,
      code: `PLAN-SUP-${ts}`,
    });
    expect(supplier.status).toBe(201);
    supplierId = supplier.body.id as string;
  });

  test("confirmed sales order creates demand and shortage", async () => {
    const itemId = await createMaterial("Paonia Living Soil Mix");
    await createConfirmedDemand(itemId, "5");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("5");
    expect(row.shortageQuantity).toBe("5");
    expect(row.reasonCodes).toContain("sales_order_demand");
    expect(row.reasonCodes).toContain("projected_shortage");
  });

  test("safety stock creates demand and shortage", async () => {
    const itemId = await createMaterial("Screened Compost", {
      safetyStock: "4",
    });

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("4");
    expect(row.shortageQuantity).toBe("4");
    expect(row.reasonCodes).toContain("safety_stock_demand");
  });

  test("available inventory reduces shortage", async () => {
    const itemId = await createMaterial("Basalt Rock Dust", { stock: "4" });
    await createConfirmedDemand(itemId, "10");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("10");
    expect(row.shortageQuantity).toBe("6");
    expect(row.reasonCodes).toContain("inventory_available");
  });

  test("reserved inventory is not double-counted as available", async () => {
    const itemId = await createMaterial("Amber Bottle 250ml", { stock: "10" });
    await createConfirmedDemand(itemId, "8");

    const planning = await snapshot();
    const row = rowFor(planning, itemId);

    expect(row.demandQuantity).toBe("8");
    expect(row.reservedQuantity).toBe("8");
    expect(row.availableStock).toBe("2");
    expect(row.projectedQuantity).toBe("2");
    expect(row.shortageQuantity).toBe("0");
    expect(row.suggestedOrderQuantity).toBeNull();
    expect(
      planning.recommendations.some((entry) => entry.itemId === itemId)
    ).toBe(false);
  });

  test("open purchase order supply nets down purchased item shortage", async () => {
    const itemId = await createMaterial("Kelp Meal");
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
    const componentId = await createMaterial("Pumice", {
      stock: "100",
    });
    const productId = await createProduct("Raised Bed Blend", [
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
    const componentId = await createMaterial("Worm Castings");
    const productId = await createProduct("Seed Starter Blend", [
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
    const componentId = await createMaterial("Coco Coir");
    const subassemblyId = await createProduct("Mineral Amendment Pack", [
      { componentId, quantity: "3" },
    ]);
    const productId = await createProduct("Houseplant Soil Kit", [
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
    const materialId = await createMaterial("Alfalfa Meal");
    await establishSupplierHistory(materialId);
    await createConfirmedDemand(materialId, "3");
    const componentId = await createMaterial("Printed Carton Label");
    const productId = await createProduct("Compost Tea Kit", [
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
      name: alternateSupplierName,
      code: `PLAN-ALT-${ts}`,
    });
    expect(alternateSupplier.status).toBe(201);

    const materialId = await createMaterial("Feather Meal");
    await createConfirmedDemand(materialId, "3");
    const productId = await createProduct("Garden Gift Box", []);
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
    const itemId = await createMaterial("Peat Moss Bale");
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
    const itemId = await createMaterial("Dolomite Lime");
    await createConfirmedDemand(itemId, "2");

    const first = await snapshot();
    const second = await snapshot();

    expect(rowFor(first, itemId)).toEqual(rowFor(second, itemId));
    expect(deterministicRecommendationShape(first, itemId)).toEqual(
      deterministicRecommendationShape(second, itemId)
    );
  });

  test("recommendations include source refs and reason codes", async () => {
    const itemId = await createMaterial("Fish Bone Meal");
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "2");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);

    expect(recommendation.sourceRefs.length).toBeGreaterThan(0);
    expect(recommendation.reasonCodes).toEqual(
      expect.arrayContaining(["sales_order_demand", "projected_shortage", "buy_item"])
    );
  });

  test("supplier history drives supplier and deterministic shortage quantity", async ({
    db,
  }) => {
    const item = await createMaterialRecord("Planning Supplier Kelp", {
      stock: "2",
      defaultPurchasePrice: "2.5",
      skuKey: "SUPPLIER-KELP",
    });
    await establishSupplierHistory(item.id);
    await createConfirmedDemand(item.id, "6");

    const planning = await snapshot();
    const row = rowFor(planning, item.id);
    const recommendation = recommendationFor(planning, item.id);

    expect(row.daysOfCoverStatus).toBe("order_now");
    expect(row.suggestedOrderQuantity).toBe("4");
    expect(row.preferredSupplierId).toBe(supplierId);
    expect(row.preferredSupplierSource).toBe("history");
    expect(recommendation.quantity).toBe("4");
    expect(recommendation.actionPayload).toMatchObject({
      actionType: "create_purchase_order",
      quantity: "4",
      supplierId,
      unitCost: "2.5",
      purchaseToStockFactor: "1",
    });

    const created = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(created.status).toBe(201);

    const [line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, created.body.id as string));
    expect(line.itemId).toBe(item.id);
    expect(line.quantityOrdered).toBe("4.0000");
    expect(line.unitCost).toBe("2.5000");
  });

  test("production planning backend exposes start bucket and batch count without direct-demand downstream noise", async () => {
    const productName = `Production Batch Blend ${runToken}`;
    const componentId = await createMaterial("Production Batch Component", {
      stock: "100",
      skuKey: "PROD-BATCH-COMP",
    });
    const productSku = buildItemSku("PLAN-P", "PROD-BATCH-BLEND");
    const product = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: productSku,
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      manufacturingMode: "batch",
      expectedBatchYield: "4",
      bom: [{ componentId, quantity: "2" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;
    await createConfirmedDemand(productId, "9");

    const planning = await snapshot();
    const row = rowFor(planning, productId);

    expect(row.latestStartDate).toBeNull();
    expect(row.productionBucket).toBe("next-week");
    expect(row.manufacturingMode).toBe("batch");
    expect(row.expectedBatchYield).toBe("4");
    expect(row.plannedBatchCount).toBe(3);
    expect(
      planning.productionBlockerFacts.some(
        (fact) => fact.parentItemId === productId
      )
    ).toBe(false);
  });

  test("component shortage references parent demand and BOM revision", async () => {
    const componentId = await createMaterial("Biochar");
    const productId = await createProduct("Paonia Potting Mix", [
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

  test("sales-order production demand paths exclude direct finished-good demand", async () => {
    const componentId = await createMaterial("Direct Path Component", {
      stock: "100",
      skuKey: "DIRECT-PATH-COMP",
    });
    const productId = await createProduct("Direct Path Finished Good", [
      { componentId, quantity: "1" },
    ]);
    await createConfirmedDemand(productId, "5");

    const planning = await snapshot();
    const productPaths = productionDemandPathsFor(planning, productId);

    expect(productPaths).toHaveLength(0);
  });

  test("sales-order production demand paths preserve multi-level sub-assembly chains", async () => {
    const rawId = await createMaterial("Path Chain Raw Input", {
      stock: "0",
      skuKey: "PATH-CHAIN-RAW",
    });
    const nutrientPackId = await createProduct("Path Chain Nutrient Pack", [
      { componentId: rawId, quantity: "1" },
    ]);
    const toteId = await createProduct("Path Chain 1yd Tote", [
      { componentId: nutrientPackId, quantity: "3" },
    ]);
    const bagId = await createProduct("Path Chain 2cf Bag", [
      { componentId: toteId, quantity: "4" },
    ]);
    await createConfirmedDemand(bagId, "2");

    const planning = await snapshot();
    const paths = productionDemandPathsFor(planning, nutrientPackId);

    expect(paths).toHaveLength(1);
    expect(paths[0].uncoveredQuantity).toBe("24");
    expect(paths[0].terminal.itemId).toBe(bagId);
    expect(paths[0].terminal.salesOrderId).toBeTruthy();
    expect(paths[0].terminal.salesOrderLineId).toBeTruthy();
    expect(paths[0].steps.map((step) => step.itemId)).toEqual([
      nutrientPackId,
      toteId,
      bagId,
    ]);
    expect(paths[0].steps.map((step) => step.quantityRequired)).toEqual([
      "24",
      "8",
      "2",
    ]);
    expect(paths[0]).not.toHaveProperty("sourceRefs");
    expect(paths[0]).not.toHaveProperty("bomRevisionId");
    expect(paths[0]).not.toHaveProperty("manufacturingOrderId");
  });

  test("backend keeps production paths while planning page is removed", async () => {
    const prefix = `First Build ${runToken}`;
    const rawId = await createMaterial(`${prefix} Raw Input`, {
      stock: "100",
      skuKey: "FIRST-BUILD-RAW",
    });
    const nutrientPackId = await createProduct(`${prefix} Nutrient Pack`, [
      { componentId: rawId, quantity: "1" },
    ]);
    const toteId = await createProduct(`${prefix} 1yd Tote`, [
      { componentId: nutrientPackId, quantity: "3" },
    ]);
    const bagId = await createProduct(`${prefix} 2cf Bag`, [
      { componentId: toteId, quantity: "4" },
    ]);
    await createConfirmedDemand(bagId, "2");

    const planning = await snapshot();
    const paths = productionDemandPathsFor(planning, nutrientPackId);
    const recommendation = recommendationFor(planning, nutrientPackId);

    expect(paths).toHaveLength(1);
    expect(paths[0].steps.map((step) => step.itemId)).toEqual([
      nutrientPackId,
      toteId,
      bagId,
    ]);
    expect(recommendation.actionPayload?.actionType).toBe(
      "create_manufacturing_order"
    );
  });

  test("dual-role items keep direct demand flat and downstream paths separate", async () => {
    const rawId = await createMaterial("Dual Role Raw Input", {
      stock: "0",
      skuKey: "DUAL-ROLE-RAW",
    });
    const subassemblyId = await createProduct("Dual Role Sold Subassembly", [
      { componentId: rawId, quantity: "1" },
    ]);
    const parentId = await createProduct("Dual Role Parent Product", [
      { componentId: subassemblyId, quantity: "3" },
    ]);
    await createConfirmedDemand(subassemblyId, "2");
    await createConfirmedDemand(parentId, "1");

    const planning = await snapshot();
    const paths = productionDemandPathsFor(planning, subassemblyId);

    expect(paths).toHaveLength(1);
    expect(paths[0].uncoveredQuantity).toBe("3");
    expect(paths[0].terminal.itemId).toBe(parentId);
    expect(paths[0].steps.map((step) => step.itemId)).toEqual([
      subassemblyId,
      parentId,
    ]);
  });

  test("late and undated open manufacturing supply do not hide dated downstream paths", async () => {
    const rawId = await createMaterial("Late Supply Raw Input", {
      stock: "100",
      skuKey: "LATE-SUPPLY-RAW",
    });
    const subassemblyId = await createProduct("Late Supply Subassembly", [
      { componentId: rawId, quantity: "1" },
    ]);
    const parentId = await createProduct("Late Supply Parent Product", [
      { componentId: subassemblyId, quantity: "1" },
    ]);
    const lateDemandCustomerId = await ensureCustomerId();
    const lateDemand = await createSalesOrder({
      customerId: lateDemandCustomerId,
      status: "open",
      requestedDate: "2026-05-10",
      shipDate: "2026-05-10",
      notes: null,
      lines: [{ itemId: parentId, quantity: "1", unitPrice: "1.00" }],
      confirmOversell: true,
    });
    expect(lateDemand.status).toBe(201);

    const lateMo = await createManufacturingOrder({
      productId: subassemblyId,
      plannedQuantity: "1",
      plannedDate: "2026-05-20",
      ingredients: [{ itemId: rawId, quantityPerUnit: "1" }],
      confirmShortage: true,
    });
    expect(lateMo.status).toBe(201);
    const lateRelease = await releaseManufacturingOrder(lateMo.body.id as string, {
      confirmShortage: true,
    });
    expect(lateRelease.status).toBe(200);

    const undatedMo = await createManufacturingOrder({
      productId: subassemblyId,
      plannedQuantity: "1",
      plannedDate: null,
      ingredients: [{ itemId: rawId, quantityPerUnit: "1" }],
      confirmShortage: true,
    });
    expect(undatedMo.status).toBe(201);
    const undatedRelease = await releaseManufacturingOrder(undatedMo.body.id as string, {
      confirmShortage: true,
    });
    expect(undatedRelease.status).toBe(200);

    const planning = await snapshot();
    const paths = productionDemandPathsFor(planning, subassemblyId);

    expect(paths).toHaveLength(1);
    expect(paths[0].uncoveredQuantity).toBe("1");
    expect(paths[0].terminal.itemId).toBe(parentId);
  });

  test("lot age requirements allocate eligible lots once across BOM demand", async ({
    db,
  }) => {
    const componentId = await createMaterial("Aged Soil Allocation Tote", {
      stock: "15",
      skuKey: "AGED-ALLOC-TOTE",
    });
    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(-1) })
      .where(eq(lots.itemId, componentId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(-1) })
      .where(eq(inventoryLotBalances.itemId, componentId));

    const firstProductId = await createProduct("Aged Soil Allocation Bag A", [
      { componentId, quantity: "1", minimumLotAgeDays: 7 },
    ]);
    const secondProductId = await createProduct("Aged Soil Allocation Bag B", [
      { componentId, quantity: "1", minimumLotAgeDays: 7 },
    ]);
    await createConfirmedDemand(firstProductId, "10");
    await createConfirmedDemand(secondProductId, "10");

    const planning = await snapshot();
    const blockers = planning.productionBlockerFacts.filter(
      (fact) =>
        fact.componentItemId === componentId &&
        fact.blockerType === "component_requirement"
    );

    expect(blockers).toHaveLength(1);
    expect(blockers[0].availableQuantity).toBe("5");
    expect(blockers[0].shortageQuantity).toBe("5");
  });

  test("lot-level and aggregate inventory do not double-count mixed age demand", async ({
    db,
  }) => {
    const rawId = await createMaterial("Mixed Age Allocation Raw", {
      stock: "100",
      skuKey: "MIXED-AGE-RAW",
    });
    const componentResult = await createItem({
      name: "Mixed Age Allocation Tote",
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", "MIXED-AGE-ALLOC"),
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "10",
      safetyStock: "0",
      bom: [{ componentId: rawId, quantity: "1" }],
    });
    expect(componentResult.status).toBe(201);
    const componentId = componentResult.body.id as string;
    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(-30) })
      .where(eq(lots.itemId, componentId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(-30) })
      .where(eq(inventoryLotBalances.itemId, componentId));

    const standardProductId = await createProduct("Mixed Age Standard Bag", [
      { componentId, quantity: "1" },
    ]);
    const agedProductId = await createProduct("Mixed Age Aged Bag", [
      { componentId, quantity: "1", minimumLotAgeDays: 7 },
    ]);
    await createConfirmedDemand(standardProductId, "10");
    await createConfirmedDemand(agedProductId, "10");

    const planning = await snapshot();
    const paths = productionDemandPathsFor(planning, componentId);
    const uncovered = paths.reduce(
      (total, path) => total + Number.parseFloat(path.uncoveredQuantity),
      0
    );

    expect(uncovered).toBe(10);
  });

  test("lot-age blocked make components become first-build recommendations", async ({
    db,
  }) => {
    const rawId = await createMaterial("Aged Make Raw Input", {
      stock: "100",
      skuKey: "AGED-MAKE-RAW",
    });
    const componentResult = await createItem({
      name: "Aged Make 1yd Tote",
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", "AGED-MAKE-TOTE"),
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "10",
      safetyStock: "0",
      bom: [{ componentId: rawId, quantity: "1" }],
    });
    expect(componentResult.status).toBe(201);
    const componentId = componentResult.body.id as string;
    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(12) })
      .where(eq(lots.itemId, componentId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(12) })
      .where(eq(inventoryLotBalances.itemId, componentId));

    const parentId = await createProduct("Aged Make 2cf Bag", [
      { componentId, quantity: "1", minimumLotAgeDays: 7 },
    ]);
    await createConfirmedDemand(parentId, "5");

    const planning = await snapshot();
    const componentRow = rowFor(planning, componentId);
    const recommendation = recommendationFor(planning, componentId);
    const paths = productionDemandPathsFor(planning, componentId);

    expect(componentRow.shortageQuantity).toBe("0");
    expect(recommendation.recommendationType).toBe("create_manufacturing_order");
    expect(recommendation.quantity).toBe("5");
    expect(recommendation.actionPayload?.actionType).toBe(
      "create_manufacturing_order"
    );
    expect(paths).toHaveLength(1);
    expect(paths[0].uncoveredQuantity).toBe("5");
    expect(paths[0].steps.map((step) => step.itemId)).toEqual([
      componentId,
      parentId,
    ]);
  });

  test("lot-age blocked parents queue deeper make prerequisites first", async ({
    db,
  }) => {
    const rawId = await createMaterial("Aged Nested Raw Input", {
      stock: "100",
      skuKey: "AGED-NESTED-RAW",
    });
    const subassemblyId = await createProduct("Aged Nested Nutrient Pack", [
      { componentId: rawId, quantity: "1" },
    ]);
    const toteResult = await createItem({
      name: "Aged Nested 1yd Tote",
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", "AGED-NESTED-TOTE"),
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "10",
      safetyStock: "0",
      bom: [{ componentId: subassemblyId, quantity: "1" }],
    });
    expect(toteResult.status).toBe(201);
    const toteId = toteResult.body.id as string;
    await db
      .update(lots)
      .set({ receivedAt: utcDateDaysFromToday(12) })
      .where(eq(lots.itemId, toteId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: utcDateDaysFromToday(12) })
      .where(eq(inventoryLotBalances.itemId, toteId));

    const parentId = await createProduct("Aged Nested 2cf Bag", [
      { componentId: toteId, quantity: "1", minimumLotAgeDays: 7 },
    ]);
    await createConfirmedDemand(parentId, "5");

    const planning = await snapshot();
    const subassemblyRecommendation = recommendationFor(planning, subassemblyId);
    const toteRecommendation = planning.recommendations.find(
      (entry) => entry.itemId === toteId
    );
    const blockers = planning.productionBlockerFacts.filter(
      (fact) =>
        fact.parentItemId === parentId &&
        fact.componentItemId === toteId &&
        fact.blockerType === "component_requirement"
    );
    const paths = productionDemandPathsFor(planning, subassemblyId);

    expect(subassemblyRecommendation.recommendationType).toBe(
      "create_manufacturing_order"
    );
    expect(subassemblyRecommendation.quantity).toBe("5");
    expect(subassemblyRecommendation.actionPayload?.actionType).toBe(
      "create_manufacturing_order"
    );
    expect(toteRecommendation).toBeUndefined();
    expect(blockers).toHaveLength(1);
    expect(paths).toHaveLength(1);
    expect(paths[0].uncoveredQuantity).toBe("5");
    expect(paths[0].steps.map((step) => step.itemId)).toEqual([
      subassemblyId,
      toteId,
      parentId,
    ]);
  });

  test("create PO draft from recommendation validates payload and creates a draft", async ({
    db,
  }) => {
    const itemId = await createMaterial("Neem Meal");
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

  test("create WO from recommendation validates payload and creates an open order", async ({
    db,
  }) => {
    const componentId = await createMaterial("Rice Hulls", { stock: "100" });
    const productId = await createProduct("Herb Planter Kit", [
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
    expect(order.status).toBe("open");
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

  test("duplicate recommendation action is rejected", async ({ db }) => {
    const itemId = await createMaterial("Gypsum");
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "4");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);
    expect(recommendation.actionPayload).toBeTruthy();

    const first = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(first.status).toBe(201);
    const duplicate = await createPlanningPurchaseOrderDraft(recommendation.actionPayload!);
    expect(duplicate.status).toBe(409);

    const concurrentItemId = await createMaterial("Azomite");
    await establishSupplierHistory(concurrentItemId);
    await createConfirmedDemand(concurrentItemId, "4");

    const concurrentPlanning = await snapshot();
    const concurrentRecommendation = recommendationFor(
      concurrentPlanning,
      concurrentItemId
    );
    expect(concurrentRecommendation.actionPayload).toBeTruthy();

    const concurrentResults = await Promise.all([
      createPlanningPurchaseOrderDraft(concurrentRecommendation.actionPayload!),
      createPlanningPurchaseOrderDraft(concurrentRecommendation.actionPayload!),
    ]);
    expect(concurrentResults.map((result) => result.status).sort()).toEqual([
      201,
      409,
    ]);

    const marker = `[planning-recommendation:${concurrentRecommendation.id}]`;
    const planningDrafts = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
      )
      .where(
        and(
          eq(purchaseOrderLines.itemId, concurrentItemId),
          sql`${purchaseOrders.notes} LIKE ${`%${marker}%`}`
        )
      );
    expect(planningDrafts).toHaveLength(1);
  });

  test("shared component shortages allocate one component pool across make recommendations", async () => {
    const componentId = await createMaterial("Shared Shortage Component", {
      stock: "15",
      skuKey: "SHARED-SHORT-COMP",
    });
    const firstProductId = await createProduct("Shared Shortage Parent A", [
      { componentId, quantity: "10" },
    ]);
    const secondProductId = await createProduct("Shared Shortage Parent B", [
      { componentId, quantity: "10" },
    ]);
    await createConfirmedDemand(firstProductId, "1");
    await createConfirmedDemand(secondProductId, "1");

    const planning = await snapshot();
    const componentRow = rowFor(planning, componentId);
    const blockers = planning.productionBlockerFacts.filter(
      (fact) =>
        fact.blockerType === "material_shortage" &&
        fact.componentItemId === componentId
    );

    expect(componentRow.demandQuantity).toBe("20");
    expect(componentRow.availableStock).toBe("15");
    expect(componentRow.shortageQuantity).toBe("5");
    expect(blockers.reduce((sum, fact) => sum + Number(fact.shortageQuantity ?? "0"), 0)).toBe(5);
  });

  test("safety-stock-only make recommendation remains in the planning backend", async () => {
    const productName = `Safety Make Product ${runToken}`;
    const componentId = await createMaterial("Safety Make Component", {
      stock: "100",
      skuKey: "SAFETY-MAKE-COMP",
    });
    const product = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", "SAFETY-MAKE-PRODUCT"),
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "3",
      bom: [{ componentId, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, product.body.id as string);
    expect(recommendation.recommendationType).toBe("create_manufacturing_order");
  });

  test("blocked planning MO payload is rejected server-side", async () => {
    const componentId = await createMaterial("Blocked Make Component", {
      stock: "0",
      skuKey: "BLOCKED-MAKE-COMP",
    });
    const productId = await createProduct("Blocked Make Product", [
      { componentId, quantity: "2" },
    ]);
    await createConfirmedDemand(productId, "3");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, productId);
    expect(recommendation.actionPayload?.actionType).toBe("create_manufacturing_order");
    expect(
      planning.productionBlockerFacts.some((fact) => fact.parentItemId === productId)
    ).toBe(true);

    const created = await createPlanningManufacturingOrderDraft(
      recommendation.actionPayload!
    );
    expect(created.status).toBe(409);
    expect(created.body).toMatchObject({
      conflictType: "blocked_make",
    });
  });

  test("missing purchase price produces setup review instead of normal PO action", async () => {
    const item = await createItem({
      name: "Missing Price Material",
      itemType: "material",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-M", "MISSING-PRICE"),
      category,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "1.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;
    await establishSupplierHistory(itemId);
    await createConfirmedDemand(itemId, "4");

    const planning = await snapshot();
    const recommendation = recommendationFor(planning, itemId);

    expect(recommendation.recommendationType).toBe("review_item_setup");
    expect(recommendation.reasonCodes).toContain("missing_purchase_price");
    expect(recommendation.actionPayload).toBeNull();
    expect(rowFor(planning, itemId).suggestedAction).toBe("buy");
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

  test("materials page shows projected vs safety for a short material", async ({
    page,
  }) => {
    const item = await createMaterialRecord("Pump Cap 38mm", {
      skuKey: "UI-PUMP-CAP",
    });
    await createConfirmedDemand(item.id, "7");

    await page.goto("/inventory/materials");
    await page.getByLabel("Search items").fill(item.sku);
    await expect(
      page.getByRole("columnheader", { name: "Projected vs safety" })
    ).toBeVisible();
    const materialRow = page.getByRole("row", { name: new RegExp(item.name) });
    await expect(materialRow).toBeVisible();
    await expect(materialRow).toContainText("safety");
    await expect(materialRow).not.toContainText("Order now");

    await materialRow.getByRole("link", { name: new RegExp(item.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/inventory/materials/${item.id}$`));
  });

  test("material usage history is available from ledger events", async () => {
    const item = await createMaterialRecord("Usage History Gypsum", {
      stock: "50",
      safetyStock: "60",
      skuKey: "UI-USAGE-HISTORY",
    });
    let usageCustomerId = customerId;
    if (!usageCustomerId) {
      const customer = await createCustomer({
        name: `Usage History Customer ${runToken}`,
        email: `usage-history-${runToken}@example.com`,
      });
      expect(customer.status).toBe(201);
      usageCustomerId = customer.body.id as string;
    }
    const order = await createSalesOrder({
      customerId: usageCustomerId,
      status: "open",
      requestedDate: isoDateDaysFromToday(13),
      notes: null,
      lines: [{ itemId: item.id, quantity: "12", unitPrice: "1.00" }],
      confirmOversell: true,
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const shipped = await fulfillSalesOrder(order.body.id as string);
    expect(shipped.status).toBe(200);

    const usageResponse = await testFetch(`/api/items/${item.id}/usage-history`);
    expect(usageResponse.status).toBe(200);
    const usage = await usageResponse.json();
    expect(usage.totals.last30Days).toBe("12");
    expect(usage.totals.last90Days).toBe("12");
    expect(
      usage.buckets.some((bucket: { quantity: string }) => bucket.quantity === "12")
    ).toBe(true);

  });

});
