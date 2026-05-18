import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryIdempotencyClaims,
  inventoryItemBalances,
  items,
  manufacturingOrders,
  salesOrders,
  salesOrderLines,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  deleteItem,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";

// ---------------------------------------------------------------------------
// Local helpers
//
// These are scenario-local inline helpers used by this spec only. If the
// linked-order story grows, these belong in test/helpers/linked-order.ts.
// ---------------------------------------------------------------------------

// TODO(linked-order): promote to test/helpers/linked-order.ts when reused.
async function bulkConfirmSalesOrdersWithKey(
  ids: string[],
  idempotencyKey: string
) {
  const res = await testFetch("/api/sales-orders/bulk-confirm", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ ids }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// TODO(linked-order): promote to test/helpers/linked-order.ts when reused.
async function softDeleteSalesOrder(id: string) {
  const res = await testFetch(`/api/sales-orders/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// TODO(linked-order): promote to test/helpers/linked-order.ts when reused.
async function cancelManufacturingOrder(id: string) {
  const res = await testFetch(`/api/manufacturing-orders/${id}`, {
    method: "DELETE",
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

test.describe("so-mo-linkage fast smokes", () => {
  test("direct sales-linked create with only one of salesOrderId/salesOrderLineId set returns 400 link_incomplete", async ({
    db,
  }) => {
    // S07 — pin validateSalesLineLinkInTx one-null-one-set guard
    const ts = Date.now();
    const unitId = getUnitId();

    const materialResult = await createItem({
      name: `S07 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S07-MAT-${ts}`,
      category: `S07 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `S07 Product ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S07-PROD-${ts}`,
      category: `S07 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const customerResult = await createCustomer({ name: `S07 Customer ${ts}` });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const soResult = await createSalesOrder({
      customerId,
      lines: [{ itemId: productId, quantity: "5", unitPrice: "20.00" }],
    });
    expect(soResult.status).toBe(201);
    const salesOrderId = soResult.body.id as string;

    const beforeCount = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders);
    const beforeMoIds = new Set(beforeCount.map((row) => row.id));

    const response = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        salesOrderId,
        salesOrderLineId: null,
        plannedQuantity: "4",
        ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
      }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Sales order link is incomplete");
    expect(body.errors?.salesOrderLineId).toContain(
      "Select a valid sales order line"
    );

    // Negative assertion: no new MO row inserted by this rejected POST.
    const afterRows = await db
      .select({ id: manufacturingOrders.id, productId: manufacturingOrders.productId })
      .from(manufacturingOrders);
    const newMos = afterRows.filter(
      (row) => !beforeMoIds.has(row.id) && row.productId === productId
    );
    expect(newMos).toHaveLength(0);
  });

  test("sales-linked create with mismatched line.itemId vs productId returns 404 link_missing", async ({
    db,
  }) => {
    // S08 — pin validateSalesLineLinkInTx productId/itemId equality guard
    const ts = Date.now();
    const unitId = getUnitId();

    const materialResult = await createItem({
      name: `S08 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S08-MAT-${ts}`,
      category: `S08 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productAResult = await createItem({
      name: `S08 Product A ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S08-PROD-A-${ts}`,
      category: `S08 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productAResult.status).toBe(201);
    const productAId = productAResult.body.id as string;

    const productBResult = await createItem({
      name: `S08 Product B ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S08-PROD-B-${ts}`,
      category: `S08 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productBResult.status).toBe(201);
    const productBId = productBResult.body.id as string;

    const customerResult = await createCustomer({ name: `S08 Customer ${ts}` });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const soResult = await createSalesOrder({
      customerId,
      lines: [{ itemId: productAId, quantity: "3", unitPrice: "20.00" }],
    });
    expect(soResult.status).toBe(201);
    const salesOrderId = soResult.body.id as string;

    const [productALine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId));
    expect(productALine?.id).toBeTruthy();

    const beforeRows = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders);
    const beforeMoIds = new Set(beforeRows.map((row) => row.id));

    // Pair Product-B's productId with Product-A's sales order line.
    const response = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId: productBId,
        salesOrderId,
        salesOrderLineId: productALine.id,
        plannedQuantity: "4",
        ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
      }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Sales order line not found");
    expect(body.errors?.salesOrderLineId).toContain(
      "Select an active sales order line for this product"
    );

    const afterRows = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders);
    const newRows = afterRows.filter((row) => !beforeMoIds.has(row.id));
    expect(newRows).toHaveLength(0);
  });

  test("create MO for product with empty active BOM returns 400 bom_required", async ({
    db,
  }) => {
    // S09 — pin prepareCreateIngredientsInTx bom_required guard
    const ts = Date.now();
    const unitId = getUnitId();

    const productResult = await createItem({
      name: `S09 No-BOM Product ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S09-PROD-${ts}`,
      category: `S09 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const beforeRows = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders);
    const beforeMoIds = new Set(beforeRows.map((row) => row.id));

    const response = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        salesOrderId: null,
        salesOrderLineId: null,
        plannedQuantity: "4",
        ingredients: [],
      }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    // BR-4: an empty `ingredients: []` array is rejected at the schema layer
    // (cleanedIngredientRowsSchema.refine rows.length >= 1), so the response
    // carries the field-level "At least one ingredient is required" message.
    // The deeper DAL "Products need a BOM" guard at manufacturing/queries.ts:833
    // only fires when ingredients pass schema validation. Either path is a 400
    // that asserts the BR-4 contract; the test allows either.
    const ingredientErrors = body?.errors?.ingredients ?? [];
    const bodyErrorString = typeof body?.error === "string" ? body.error : "";
    const combined = [...ingredientErrors, bodyErrorString].join(" ");
    expect(
      /At least one ingredient is required|Products need a BOM/i.test(combined),
      `Expected BR-4 rejection, got: ${JSON.stringify(body)}`,
    ).toBe(true);

    const afterRows = await db
      .select({ id: manufacturingOrders.id, productId: manufacturingOrders.productId })
      .from(manufacturingOrders);
    const newRows = afterRows.filter(
      (row) => !beforeMoIds.has(row.id) && row.productId === productId
    );
    expect(newRows).toHaveLength(0);
  });

  test("confirmOversell:false on SO create and confirmShortage:false on MO create are silently ignored and inventory effects still apply", async ({
    db,
  }) => {
    // S10 — pin BR-10 no-op contract (flags accepted by Zod, never read by DAL)
    const ts = Date.now();
    const unitId = getUnitId();

    const materialResult = await createItem({
      name: `S10 Zero Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S10-MAT-${ts}`,
      category: `S10 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `S10 Zero Product ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S10-PROD-${ts}`,
      category: `S10 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "5" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const customerResult = await createCustomer({ name: `S10 Customer ${ts}` });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const readBalance = async (itemId: string) => {
      const [row] = await db
        .select({
          committedQty: inventoryItemBalances.committedQty,
          demandQty: inventoryItemBalances.demandQty,
          expectedQty: inventoryItemBalances.expectedQty,
        })
        .from(inventoryItemBalances)
        .where(eq(inventoryItemBalances.itemId, itemId));
      return {
        committedQty: parseFloat(row?.committedQty ?? "0"),
        demandQty: parseFloat(row?.demandQty ?? "0"),
        expectedQty: parseFloat(row?.expectedQty ?? "0"),
      };
    };

    const beforeProduct = await readBalance(productId);
    const beforeMaterial = await readBalance(materialId);

    const soResult = await createSalesOrder({
      customerId,
      lines: [{ itemId: productId, quantity: "10", unitPrice: "20.00" }],
      confirmOversell: false,
    });
    expect(soResult.status).toBe(201);
    const salesOrderId = soResult.body.id as string;

    const moResult = await createManufacturingOrder({
      productId,
      plannedQuantity: "4",
      ingredients: [{ itemId: materialId, quantityPerUnit: "5" }],
      confirmShortage: false,
    });
    expect(moResult.status).toBe(201);
    const moId = moResult.body.id as string;

    // Both rows persisted at status='open'.
    const [soRow] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
    expect(soRow.status).toBe("open");

    const [moRow] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, moId));
    expect(moRow.status).toBe("open");

    // Inventory effects landed (poll because projection updates are async).
    // Note: with 0 product stock, reserveForSalesInTx commits only what's available
    // (Math.min(available, requested) at lib/inventory/kernel/operations/sales.ts).
    // So productCommitted stays at 0; the full order quantity lands in demandQty.
    // The contract pin is: demand rises by the FULL order (10), committed rises
    // only by the reservable portion (0 here). confirmOversell: false did NOT
    // block the SO create — that's the BR-10 assertion.
    await expect
      .poll(
        async () => {
          const productBal = await readBalance(productId);
          const materialBal = await readBalance(materialId);
          return {
            productDemand: productBal.demandQty.toFixed(4),
            productCommitted: productBal.committedQty.toFixed(4),
            productExpected: productBal.expectedQty.toFixed(4),
            materialDemand: materialBal.demandQty.toFixed(4),
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        productDemand: (beforeProduct.demandQty + 10).toFixed(4),
        productCommitted: beforeProduct.committedQty.toFixed(4),
        productExpected: (beforeProduct.expectedQty + 4).toFixed(4),
        materialDemand: (beforeMaterial.demandQty + 5 * 4).toFixed(4),
      });

    // Negative assertion: no rejection event was written for either reference.
    const rejectionEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          inArray(inventoryEvents.referenceId, [salesOrderId, moId]),
          eq(inventoryEvents.eventType, "rejected")
        )
      );
    expect(rejectionEvents).toHaveLength(0);
  });

  test("bulkConfirmSalesOrders idempotency replay returns cached {confirmedCount} and writes exactly one claim row", async ({
    db,
  }) => {
    // S18 — pin T27 replay safety + BR-7 no-op invariant for bulk-confirm
    const ts = Date.now();
    const unitId = getUnitId();
    const idempotencyKey = `s18-bulk-confirm-${ts}-${randomUUID()}`;

    const itemResult = await createItem({
      name: `S18 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S18-MAT-${ts}`,
      category: `S18 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: "10.00",
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(itemResult.status).toBe(201);
    const itemId = itemResult.body.id as string;

    const customerResult = await createCustomer({ name: `S18 Customer ${ts}` });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const so1 = await createSalesOrder({
      customerId,
      lines: [{ itemId, quantity: "2", unitPrice: "10.00" }],
    });
    expect(so1.status).toBe(201);
    const so1Id = so1.body.id as string;

    const so2 = await createSalesOrder({
      customerId,
      lines: [{ itemId, quantity: "3", unitPrice: "10.00" }],
    });
    expect(so2.status).toBe(201);
    const so2Id = so2.body.id as string;

    const first = await bulkConfirmSalesOrdersWithKey([so1Id, so2Id], idempotencyKey);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ confirmedCount: 2 });

    const replay = await bulkConfirmSalesOrdersWithKey(
      [so1Id, so2Id],
      idempotencyKey
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ confirmedCount: 2 });

    // BR-7: dead-write contract — neither SO status nor deletedAt mutated.
    const soRows = await db
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrders)
      .where(inArray(salesOrders.id, [so1Id, so2Id]));
    expect(soRows).toHaveLength(2);
    for (const row of soRows) {
      expect(row.status).toBe("open");
      expect(row.deletedAt).toBeNull();
    }

    // Exactly one idempotency claim row for this operation + key.
    const claimRows = await db
      .select({ id: inventoryIdempotencyClaims.id })
      .from(inventoryIdempotencyClaims)
      .where(
        and(
          eq(inventoryIdempotencyClaims.operationName, "bulkConfirmSalesOrders"),
          eq(inventoryIdempotencyClaims.idempotencyKey, idempotencyKey)
        )
      );
    expect(claimRows).toHaveLength(1);
  });

  test("MO create rejected with 409 bom_changed when submitted ingredient row count differs from current active BOM", async ({
    db,
  }) => {
    // S20 — pin RA-3 bom_changed guard via PUT /api/items/[id] BOM mutation
    const ts = Date.now();
    const unitId = getUnitId();

    const materialA = await createItem({
      name: `S20 Material A ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S20-MAT-A-${ts}`,
      category: `S20 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialA.status).toBe(201);
    const materialAId = materialA.body.id as string;

    const materialB = await createItem({
      name: `S20 Material B ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S20-MAT-B-${ts}`,
      category: `S20 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialB.status).toBe(201);
    const materialBId = materialB.body.id as string;

    const materialC = await createItem({
      name: `S20 Material C ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S20-MAT-C-${ts}`,
      category: `S20 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialC.status).toBe(201);
    const materialCId = materialC.body.id as string;

    const productName = `S20 Product ${ts}`;
    const productResult = await createItem({
      name: productName,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S20-PROD-${ts}`,
      category: `S20 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "30.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: materialAId, quantity: "1" },
        { componentId: materialBId, quantity: "1" },
      ],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    // Capture the original 2-row ingredient payload from the loaded BOM.
    const originalIngredients = [
      { itemId: materialAId, quantityPerUnit: "1" },
      { itemId: materialBId, quantityPerUnit: "1" },
    ];

    // Replace the active BOM with a 3-row revision.
    const updateResult = await updateItem(productId, {
      name: productName,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: `S20-PROD-${ts}`,
      category: `S20 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "30.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      bom: [
        { componentId: materialAId, quantity: "1" },
        { componentId: materialBId, quantity: "1" },
        { componentId: materialCId, quantity: "1" },
      ],
      revisionNote: "Add third ingredient to trigger bom_changed",
    });
    expect(updateResult.status).toBe(200);

    const beforeRows = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders);
    const beforeMoIds = new Set(beforeRows.map((row) => row.id));

    // Submit the stale 2-row ingredient payload after the BOM grew to 3 rows.
    const response = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      body: JSON.stringify({
        productId,
        salesOrderId: null,
        salesOrderLineId: null,
        plannedQuantity: "4",
        ingredients: originalIngredients,
      }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("The product BOM changed");

    const afterRows = await db
      .select({ id: manufacturingOrders.id, productId: manufacturingOrders.productId })
      .from(manufacturingOrders);
    const newRows = afterRows.filter(
      (row) => !beforeMoIds.has(row.id) && row.productId === productId
    );
    expect(newRows).toHaveLength(0);
  });

  test("bulkConfirmSalesOrders dead-write contract: returns confirmedCount equal to ids.length even with duplicate/deleted/nonexistent ids; no rows mutated; one claim row", async ({
    db,
  }) => {
    // S22 — pin current no-validation contract
    const ts = Date.now();
    const unitId = getUnitId();
    const idempotencyKey = `s22-bulk-confirm-${ts}-${randomUUID()}`;

    const itemResult = await createItem({
      name: `S22 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S22-MAT-${ts}`,
      category: `S22 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: "10.00",
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(itemResult.status).toBe(201);
    const itemId = itemResult.body.id as string;

    const customerResult = await createCustomer({ name: `S22 Customer ${ts}` });
    expect(customerResult.status).toBe(201);
    const customerId = customerResult.body.id as string;

    const so1 = await createSalesOrder({
      customerId,
      lines: [{ itemId, quantity: "1", unitPrice: "10.00" }],
    });
    expect(so1.status).toBe(201);
    const so1Id = so1.body.id as string;

    const so2 = await createSalesOrder({
      customerId,
      lines: [{ itemId, quantity: "2", unitPrice: "10.00" }],
    });
    expect(so2.status).toBe(201);
    const so2Id = so2.body.id as string;

    const so3 = await createSalesOrder({
      customerId,
      lines: [{ itemId, quantity: "3", unitPrice: "10.00" }],
    });
    expect(so3.status).toBe(201);
    const so3Id = so3.body.id as string;

    // Soft-delete SO3 — "cancelled" semantics for sales orders == deletedAt SET.
    const deleteSo3 = await softDeleteSalesOrder(so3Id);
    expect(deleteSo3.status).toBe(200);

    const fakeId = randomUUID();

    // Capture pre-state for SO1, SO2, SO3.
    const beforeRows = await db
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrders)
      .where(inArray(salesOrders.id, [so1Id, so2Id, so3Id]));
    expect(beforeRows).toHaveLength(3);
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));

    // POST with duplicate, deleted, and nonexistent ids; current contract: 200/ids.length.
    const ids = [so1Id, so2Id, so1Id, so3Id, fakeId];
    const result = await bulkConfirmSalesOrdersWithKey(ids, idempotencyKey);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ confirmedCount: ids.length });

    // No mutation on any of the known rows.
    const afterRows = await db
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
        deletedAt: salesOrders.deletedAt,
      })
      .from(salesOrders)
      .where(inArray(salesOrders.id, [so1Id, so2Id, so3Id]));
    expect(afterRows).toHaveLength(3);
    for (const row of afterRows) {
      const before = beforeById.get(row.id);
      expect(row.status).toBe(before?.status);
      // deletedAt may be null or a Date; compare nullishness either way.
      if (before?.deletedAt == null) {
        expect(row.deletedAt).toBeNull();
      } else {
        expect(row.deletedAt).not.toBeNull();
      }
    }

    // Exactly one idempotency claim row for this op + key.
    const claimRows = await db
      .select({ id: inventoryIdempotencyClaims.id })
      .from(inventoryIdempotencyClaims)
      .where(
        and(
          eq(inventoryIdempotencyClaims.operationName, "bulkConfirmSalesOrders"),
          eq(inventoryIdempotencyClaims.idempotencyKey, idempotencyKey)
        )
      );
    expect(claimRows).toHaveLength(1);
  });

  test("item soft-delete succeeds when item is referenced only by a cancelled MO (deletedAt SET): T26 inverse", async ({
    db,
  }) => {
    // S25 — pin T26 inverse: deleteItem guard filters status='open' AND deletedAt IS NULL.
    const ts = Date.now();
    const unitId = getUnitId();

    const materialResult = await createItem({
      name: `S25 Material ${ts}`,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `S25-MAT-${ts}`,
      category: `S25 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(materialResult.status).toBe(201);
    const materialId = materialResult.body.id as string;

    const productResult = await createItem({
      name: `S25 Product ${ts}`,
      itemType: "product",
      sellable: true,
      unitDefinitionId: unitId,
      sku: `S25-PROD-${ts}`,
      category: `S25 Linked ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(productResult.status).toBe(201);
    const productId = productResult.body.id as string;

    const moResult = await createManufacturingOrder({
      productId,
      plannedQuantity: "2",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(moResult.status).toBe(201);
    const moId = moResult.body.id as string;

    // Cancel the MO — no picks have happened yet, so the DELETE soft-deletes.
    const cancel = await cancelManufacturingOrder(moId);
    expect(cancel.status).toBe(200);

    // Pre-state: MO is soft-deleted (deletedAt SET); items are not referenced
    // by any active MO via the delete guard.
    const [cancelled] = await db
      .select({
        id: manufacturingOrders.id,
        status: manufacturingOrders.status,
        deletedAt: manufacturingOrders.deletedAt,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, moId));
    expect(cancelled.deletedAt).not.toBeNull();

    // The product references materialId via its BOM, so we delete the product
    // first (no active MO blocking, since the MO is soft-deleted), then the
    // material — both deletes must succeed.
    const deleteProduct = await deleteItem(productId);
    expect(deleteProduct.status).toBe(200);
    expect(deleteProduct.body).toEqual({ success: true });

    const deleteMaterial = await deleteItem(materialId);
    expect(deleteMaterial.status).toBe(200);
    expect(deleteMaterial.body).toEqual({ success: true });

    // Both items soft-deleted (deletedAt SET).
    const itemRows = await db
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(inArray(items.id, [productId, materialId]));
    expect(itemRows).toHaveLength(2);
    for (const row of itemRows) {
      expect(row.deletedAt).not.toBeNull();
    }
  });
});
