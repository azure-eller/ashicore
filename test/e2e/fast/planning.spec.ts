import { and, asc, eq, sql } from "drizzle-orm";
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
  autoPlanDrafts,
  createPlanningManufacturingOrderDraft,
  createPlanningPurchaseOrderDraft,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  getBaseUrl,
  getPlanningSnapshot,
  getUnitId,
  receivePurchaseOrder,
  releaseManufacturingOrder,
  submitPurchaseOrder,
  updatePlanningRules,
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

  async function createProduct(name: string, bom: Array<{ componentId: string; quantity: string }>) {
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

  test("planning rules drive supplier, lead time, and deterministic order quantity", async ({
    db,
  }) => {
    const item = await createMaterialRecord("Planning Rule Kelp", {
      stock: "2",
      skuKey: "RULE-KELP",
    });
    const update = await updatePlanningRules(item.id, {
      reorderPoint: "5",
      targetCoverDays: "10",
      preferredSupplierItem: {
        supplierId,
        supplierSku: `SUP-KELP-${runToken}`,
        unitCost: "2.5",
        purchaseToStockFactor: "1",
        leadTimeDaysOverride: "3",
        minimumOrderQuantity: "4",
        orderMultiple: "3",
      },
    });
    expect(update.status).toBe(200);
    await createConfirmedDemand(item.id, "6");

    const planning = await snapshot();
    const row = rowFor(planning, item.id);
    const recommendation = recommendationFor(planning, item.id);

    expect(row.reorderPoint).toBe("5");
    expect(row.targetCoverDays).toBe(10);
    expect(row.leadTimeDays).toBe(3);
    expect(row.leadTimeSource).toBe("supplier_item");
    expect(row.daysOfCoverStatus).toBe("order_now");
    expect(row.suggestedOrderQuantity).toBe("6");
    expect(row.minimumOrderQuantity).toBe("4");
    expect(row.orderMultiple).toBe("3");
    expect(row.preferredSupplierId).toBe(supplierId);
    expect(row.preferredSupplierSku).toBe(`SUP-KELP-${runToken}`);
    expect(recommendation.quantity).toBe("6");
    expect(recommendation.actionPayload).toMatchObject({
      actionType: "create_purchase_order",
      quantity: "6",
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
    expect(line.quantityOrdered).toBe("6.0000");
    expect(line.unitCost).toBe("2.5000");
  });

  test("lead time falls back to received purchase order history", async ({ db }) => {
    const item = await createMaterialRecord("Planning History Gypsum", {
      skuKey: "HISTORY-GYPSUM",
    });
    const purchaseOrder = await createPurchaseOrder({
      supplierId,
      expectedDate: "2026-05-01",
      notes: "Lead time history fixture",
      lines: [{ itemId: item.id, quantityOrdered: "2", unitCost: "1.00" }],
    });
    expect(purchaseOrder.status).toBe(201);
    const submit = await submitPurchaseOrder(purchaseOrder.body.id as string);
    expect(submit.status).toBe(200);
    const [line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrder.body.id as string));
    const receive = await receivePurchaseOrder(purchaseOrder.body.id as string, {
      lines: [{ lineId: line.id, quantityReceived: "2" }],
    });
    expect(receive.status).toBe(200);
    await createConfirmedDemand(item.id, "3");

    const planning = await snapshot();
    const row = rowFor(planning, item.id);

    expect(row.leadTimeSource).toBe("history");
    expect(row.leadTimeDays).toBeGreaterThanOrEqual(1);
    expect(row.leadTimeSampleCount).toBeGreaterThanOrEqual(1);
  });

  test("production planning exposes start bucket and batch count", async () => {
    const componentId = await createMaterial("Production Batch Component", {
      stock: "100",
      skuKey: "PROD-BATCH-COMP",
    });
    const product = await createItem({
      name: "Production Batch Blend",
      itemType: "product",
      unitDefinitionId: unitId,
      sku: buildItemSku("PLAN-P", "PROD-BATCH-BLEND"),
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
    const update = await updatePlanningRules(productId, {
      productionLeadTimeDays: "5",
    });
    expect(update.status).toBe(200);
    await createConfirmedDemand(productId, "9");

    const planning = await snapshot();
    const row = rowFor(planning, productId);

    expect(row.productionLeadTimeDays).toBe(5);
    expect(row.productionLeadTimeSource).toBe("manual");
    expect(row.latestStartDate).toBe("2026-05-10");
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

  test("stale purchase recommendation is rejected after planning rule changes", async () => {
    const item = await createMaterialRecord("Planning Stale Supplier Rule", {
      skuKey: "STALE-SUPPLIER-RULE",
    });
    const firstUpdate = await updatePlanningRules(item.id, {
      preferredSupplierItem: {
        supplierId,
        unitCost: "1",
        purchaseToStockFactor: "1",
      },
    });
    expect(firstUpdate.status).toBe(200);
    await createConfirmedDemand(item.id, "4");
    const planning = await snapshot();
    const recommendation = recommendationFor(planning, item.id);
    expect(recommendation.actionPayload).toBeTruthy();

    const secondUpdate = await updatePlanningRules(item.id, {
      preferredSupplierItem: {
        supplierId,
        unitCost: "2",
        purchaseToStockFactor: "1",
      },
    });
    expect(secondUpdate.status).toBe(200);

    const stale = await createPlanningPurchaseOrderDraft(
      recommendation.actionPayload!
    );
    expect(stale.status).toBe(409);
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

  test("create WO draft from recommendation validates payload and creates a draft", async ({
    db,
  }) => {
    const componentId = await createMaterial("Rice Hulls");
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

  test("planning page opens supplier detail and creates a suggested PO draft", async ({
    page,
    db,
  }) => {
    const item = await createMaterialRecord("Pump Cap 38mm", {
      skuKey: "UI-PUMP-CAP",
    });
    await establishSupplierHistory(item.id);
    await createConfirmedDemand(item.id, "7");

    await page.goto("/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await page.getByRole("radio", { name: /Replenishment/ }).click();
    await page.getByLabel("Search planning").fill(item.sku);
    const materialRow = page.getByRole("row", { name: new RegExp(item.name) });
    await expect(materialRow).toBeVisible();
    await expect(materialRow).toContainText(supplierName);
    await expect(materialRow).toContainText("Order");

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith("/api/planning/actions/purchase-orders")
      ),
      materialRow.getByRole("button", { name: "Order" }).click(),
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
    expect(lines[0].itemId).toBe(item.id);
    expect(lines[0].quantityOrdered).toBe("7.0000");
  });

  test("planning page groups purchasing actions by supplier and creates one draft", async ({
    page,
    db,
  }) => {
    const searchToken = `BUY-GROUP-${runToken}`;
    const firstItem = await createMaterialRecord("Coconut Coir Brick", {
      skuKey: `${searchToken}-COIR`,
    });
    const secondItem = await createMaterialRecord("Mycorrhizae Blend", {
      skuKey: `${searchToken}-MYCO`,
    });
    await establishSupplierHistory(firstItem.id);
    await establishSupplierHistory(secondItem.id);
    await createConfirmedDemand(firstItem.id, "2");
    await createConfirmedDemand(secondItem.id, "5");

    await page.goto("/planning");
    await page.getByRole("radio", { name: /Replenishment/ }).click();
    await page.getByLabel("Search planning").fill(searchToken);

    await expect(page.getByRole("row", { name: new RegExp(firstItem.name) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(secondItem.name) })).toBeVisible();
    await page.getByLabel(`Select ${firstItem.name}`).click();
    await page.getByLabel(`Select ${secondItem.name}`).click();
    await expect(page.getByText("2 materials selected")).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith("/api/planning/actions/purchase-orders")
      ),
      page.getByRole("button", { name: "Create 1 PO" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await page.waitForURL(/\/purchasing\/orders\/[0-9a-f-]+$/);

    const createdId = page.url().split("/").at(-1) ?? "";
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, createdId));
    expect(order.status).toBe("draft");
    expect(order.supplierId).toBe(supplierId);

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, createdId))
      .orderBy(asc(purchaseOrderLines.sortOrder));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.itemId).sort()).toEqual(
      [firstItem.id, secondItem.id].sort()
    );
    expect(order.notes).toContain("[planning-recommendation:");
  });

  test("auto-plan creates safe drafts and reports skipped recommendations", async () => {
    const item = await createMaterialRecord("Planning Auto Plan Meal", {
      skuKey: "AUTO-PLAN-MEAL",
    });
    const update = await updatePlanningRules(item.id, {
      preferredSupplierItem: {
        supplierId,
        unitCost: "1.25",
        purchaseToStockFactor: "1",
      },
    });
    expect(update.status).toBe(200);
    await createConfirmedDemand(item.id, "3");
    const planning = await snapshot();
    const recommendation = recommendationFor(planning, item.id);
    expect(recommendation.actionPayload?.actionType).toBe("create_purchase_order");

    const result = await autoPlanDrafts();
    expect(result.status).toBe(201);
    expect(
      result.body.created.some(
        (entry: { recommendationId: string }) =>
          entry.recommendationId === recommendation.id
      )
    ).toBe(true);
    expect(Array.isArray(result.body.skipped)).toBe(true);
  });
});
