import { eq, and, isNull } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "./fixtures";
import {
  createItem,
  createCustomer,
  createSalesOrder,
  createManufacturingOrder,
  releaseManufacturingOrder,
  completeManufacturingOrder,
  deleteItem,
  updateItem,
  testFetch,
  getUnitId,
} from "../helpers/api";
import {
  getTestTimestamp,
  withTs,
  ALL_MATERIALS,
  PRODUCTS,
  NUTE_PACK_BOM,
  BOMB_BOM,
  PRO_BASE_BOM,
  CUSTOMERS,
  PO_MOUNTAIN_MINERALS_LINES,
} from "../helpers/paonia";
import {
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrders,
  salesOrders,
  salesOrderLines,
  stockMovements,
} from "../../lib/db/schema";

test.describe("Chapter 4 — Manufacturing: Paonia Soil Co.", () => {
  test.describe.configure({ mode: "serial" });

  const ts = getTestTimestamp();

  // ── Resolved inventory IDs ─────────────────────────────────────
  // Materials (12)
  const materialIds: Record<string, string> = {};
  // Products (3)
  const productIds: Record<string, string> = {};

  // ── Manufacturing order IDs ────────────────────────────────────
  let nutePackDraftMoId: string;
  let nutePackCompletionMoId: string;
  let theBombMoId: string;

  // ── Sales fixtures ─────────────────────────────────────────────
  let customerId: string;
  let salesOrderId: string;
  let salesOrderLineId: string;
  let salesOrderNumber: string;

  /* ══════════════════════════════════════════════════════════════════
     1. Resolve materials + products from inventory spec
     ══════════════════════════════════════════════════════════════════ */

  test("resolves all materials and products from inventory spec", async ({
    db,
  }) => {
    // Resolve all 12 materials
    for (const baseName of ALL_MATERIALS) {
      const name = withTs(baseName, ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.name, name), isNull(items.deletedAt)));
      expect(row, `${name} not found — run 01-inventory first`).toBeTruthy();
      materialIds[baseName] = row.id;
    }

    // Resolve all 3 products
    for (const baseName of [
      PRODUCTS.NUTE_PACK,
      PRODUCTS.BOMB,
      PRODUCTS.PRO_BASE,
    ]) {
      const name = withTs(baseName, ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.name, name), isNull(items.deletedAt)));
      expect(row, `${name} not found — run 01-inventory first`).toBeTruthy();
      productIds[baseName] = row.id;
    }

    expect(Object.keys(materialIds)).toHaveLength(12);
    expect(Object.keys(productIds)).toHaveLength(3);
  });

  /* ══════════════════════════════════════════════════════════════════
     2. Create draft MO for Bomb Nute Pack via UI
     ══════════════════════════════════════════════════════════════════ */

  test("creates a draft MO for Bomb Nute Pack with 8 BOM snapshots", async ({
    page,
    db,
  }) => {
    const nutePackName = withTs(PRODUCTS.NUTE_PACK, ts);

    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    // Select product
    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(nutePackName);
    await page
      .getByRole("option", { name: new RegExp(nutePackName) })
      .click();

    // BOM snapshot table should show 8 ingredients
    await expect(page.locator("tbody tr")).toHaveCount(8);
    for (const ingredient of NUTE_PACK_BOM) {
      await expect(page.locator("table")).toContainText(
        withTs(ingredient.component, ts)
      );
    }

    // Fill order details
    await page.getByLabel("Planned Quantity").fill("5");
    await page.getByLabel("Planned Date").fill("2026-05-01");
    await page.getByLabel("Notes").fill("Nute pack batch for spring");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);

    nutePackDraftMoId = getIdFromUrl(page.url());
    expect(nutePackDraftMoId).toBeTruthy();

    // ── DB verification ──
    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, nutePackDraftMoId));

    expect(order).toBeTruthy();
    expect(order.status).toBe("draft");
    expect(order.orderNumber).toMatch(/^MO-\d{4}-\d{4}$/);
    expect(order.productId).toBe(productIds[PRODUCTS.NUTE_PACK]);
    expect(order.plannedQuantity).toBe("5.0000");
    expect(order.plannedDate).toBe("2026-05-01");
    expect(order.notes).toBe("Nute pack batch for spring");
    expect(order.salesOrderId).toBeNull();
    expect(order.salesOrderLineId).toBeNull();

    // Verify ingredient snapshots
    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(
          manufacturingOrderIngredients.manufacturingOrderId,
          nutePackDraftMoId
        )
      );

    expect(ingredients).toHaveLength(8);

    const ingredientByItemId = new Map(
      ingredients.map((row) => [row.itemId, row])
    );

    for (const bomLine of NUTE_PACK_BOM) {
      const itemId = materialIds[bomLine.component];
      const ingredient = ingredientByItemId.get(itemId);
      expect(ingredient, `Ingredient ${bomLine.component} missing`).toBeTruthy();
      expect(ingredient!.itemName).toBe(withTs(bomLine.component, ts));
      expect(ingredient!.quantityPerUnit).toBe(
        parseFloat(bomLine.quantity).toFixed(4)
      );
      // plannedQuantity = quantityPerUnit * 5
      const expectedPlanned = (parseFloat(bomLine.quantity) * 5).toFixed(4);
      expect(ingredient!.plannedQuantity).toBe(expectedPlanned);
    }
  });

  /* ══════════════════════════════════════════════════════════════════
     3. Edit nute pack MO, recalculate, release with shortage dialog
     ══════════════════════════════════════════════════════════════════ */

  test("edits nute pack MO, recalculates, and releases with shortage warning", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${nutePackDraftMoId}/edit`);
    await expect(page.getByText("Edit Manufacturing Order")).toBeVisible();

    // Change planned qty to force a shortage on some amendments
    await page.getByLabel("Planned Quantity").fill("20");

    // Edit Kelp Meal qty per unit from 2 to 3
    const kelpRow = page
      .locator("tbody tr")
      .filter({ hasText: withTs("Kelp Meal", ts) });
    await kelpRow.locator('input[inputmode="decimal"]').fill("3");

    await page.getByLabel("Notes").fill("Increased to 20 for shortage test");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(
      new RegExp(`/manufacturing/orders/${nutePackDraftMoId}$`)
    );

    // ── DB verification after edit ──
    const [editedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, nutePackDraftMoId));

    expect(editedOrder.plannedQuantity).toBe("20.0000");
    expect(editedOrder.notes).toBe("Increased to 20 for shortage test");

    const editedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(
          manufacturingOrderIngredients.manufacturingOrderId,
          nutePackDraftMoId
        )
      );
    const editedByItemId = new Map(
      editedIngredients.map((row) => [row.itemId, row])
    );

    // Kelp Meal: 3 per unit * 20 = 60
    expect(
      editedByItemId.get(materialIds["Kelp Meal"])?.quantityPerUnit
    ).toBe("3.0000");
    expect(
      editedByItemId.get(materialIds["Kelp Meal"])?.plannedQuantity
    ).toBe("60.0000");

    // Fish Bone Meal: 3 per unit * 20 = 60 (unchanged qty per unit)
    expect(
      editedByItemId.get(materialIds["Fish Bone Meal"])?.quantityPerUnit
    ).toBe("3.0000");
    expect(
      editedByItemId.get(materialIds["Fish Bone Meal"])?.plannedQuantity
    ).toBe("60.0000");

    // ── Release with shortage dialog ──
    await page.getByRole("button", { name: "Release" }).click();

    await expect(page.getByText("Release with shortages?")).toBeVisible({
      timeout: 15_000,
    });

    const shortageDialog = page.getByRole("alertdialog");
    // Shortage table should show ingredient names with Needed/Available columns
    await expect(shortageDialog.locator("table")).toBeVisible();
    // At least one ingredient name should appear in the shortage table
    await expect(shortageDialog.locator("table")).toContainText("Needed");
    await expect(shortageDialog.locator("table")).toContainText("Available");

    // Verify the Shortage tooltip
    await shortageDialog.getByText("Shortage", { exact: true }).hover();
    await expect(
      page.getByText("Needed minus available right now.")
    ).toBeVisible();

    await page.getByRole("button", { name: "Release Anyway" }).click();

    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toBeVisible({ timeout: 15_000 });
    // Edit button should be gone after release
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

    // ── DB verification after release ──
    const [releasedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, nutePackDraftMoId));

    expect(releasedOrder.status).toBe("released");
    expect(releasedOrder.releasedAt).toBeTruthy();

    // expectedQty should be updated on the product
    const [productRow] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.NUTE_PACK]));

    expect(productRow.expectedQty).toBe("20.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     4. Cancel released MO without mutating stock
     ══════════════════════════════════════════════════════════════════ */

  test("cancels released MO without creating stock movements", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${nutePackDraftMoId}`);
    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Cancel this order?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel Order" }).click();

    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toHaveCount(0);

    // ── DB verification ──
    const [cancelledOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, nutePackDraftMoId));

    expect(cancelledOrder.status).toBe("cancelled");
    expect(cancelledOrder.cancelledAt).toBeTruthy();

    // expectedQty back to 0
    const [productRow] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.NUTE_PACK]));

    expect(productRow.expectedQty).toBe("0.0000");

    // No stock movements created for cancelled order
    const referencedMovements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, nutePackDraftMoId));

    expect(referencedMovements).toHaveLength(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     5. Create + release + complete Bomb Nute Pack MO (FIFO, costs)
     ══════════════════════════════════════════════════════════════════ */

  test("creates, releases, and completes Bomb Nute Pack MO with FIFO consumption", async ({
    page,
    db,
  }) => {
    const nutePackName = withTs(PRODUCTS.NUTE_PACK, ts);

    // ── Create new MO via UI ──
    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(nutePackName);
    await page
      .getByRole("option", { name: new RegExp(nutePackName) })
      .click();

    await page.getByLabel("Planned Quantity").fill("5");
    await page.getByLabel("Notes").fill("Nute pack completion flow");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    nutePackCompletionMoId = getIdFromUrl(page.url());
    expect(nutePackCompletionMoId).toBeTruthy();

    // ── Release ──
    await page.getByRole("button", { name: "Release" }).click();

    // If shortage dialog appears, release anyway
    const shortageDialog = page.getByText("Release with shortages?");
    if (await shortageDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.getByRole("button", { name: "Release Anyway" }).click();
    }

    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toBeVisible({ timeout: 15_000 });

    // Verify expectedQty incremented
    const [releasedProduct] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.NUTE_PACK]));
    expect(releasedProduct.expectedQty).toBe("5.0000");

    // ── Complete with actual quantity ──
    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel("Actual Quantity").fill("5");
    await page.getByRole("button", { name: "Complete Order" }).click();

    // Wait for completion to propagate
    await expect
      .poll(
        async () => {
          const [order] = await db
            .select({ status: manufacturingOrders.status })
            .from(manufacturingOrders)
            .where(eq(manufacturingOrders.id, nutePackCompletionMoId));
          return order?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("completed");

    // ── DB verification: completed order ──
    const [completedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, nutePackCompletionMoId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("5.0000");
    expect(completedOrder.actualMaterialCost).toBeTruthy();
    expect(completedOrder.actualCostPerUnit).toBeTruthy();
    expect(completedOrder.completedAt).toBeTruthy();

    // Store cost values for later assertions
    const actualMaterialCost = parseFloat(completedOrder.actualMaterialCost!);
    const actualCostPerUnit = parseFloat(completedOrder.actualCostPerUnit!);
    expect(actualMaterialCost).toBeGreaterThan(0);
    expect(actualCostPerUnit).toBeGreaterThan(0);
    // costPerUnit = materialCost / actualQuantity
    expect(actualCostPerUnit).toBeCloseTo(actualMaterialCost / 5, 3);

    // ── Ingredient actuals ──
    const completedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(
          manufacturingOrderIngredients.manufacturingOrderId,
          nutePackCompletionMoId
        )
      );
    const completedByItemId = new Map(
      completedIngredients.map((row) => [row.itemId, row])
    );

    // Each ingredient should have actualQuantity = quantityPerUnit * 5
    for (const bomLine of NUTE_PACK_BOM) {
      const itemId = materialIds[bomLine.component];
      const ingredient = completedByItemId.get(itemId);
      expect(
        ingredient,
        `Completed ingredient ${bomLine.component} missing`
      ).toBeTruthy();
      const expectedActual = (parseFloat(bomLine.quantity) * 5).toFixed(4);
      expect(ingredient!.actualQuantity).toBe(expectedActual);
      expect(ingredient!.actualCostTotal).toBeTruthy();
      expect(parseFloat(ingredient!.actualCostTotal!)).toBeGreaterThan(0);
    }

    // ── FIFO lot verification ──
    // Each amendment material lot should be partially or fully consumed.
    // The first lot (from purchasing) should be depleted or reduced.
    for (const bomLine of NUTE_PACK_BOM) {
      const itemId = materialIds[bomLine.component];
      const materialLots = await db
        .select()
        .from(lots)
        .where(eq(lots.itemId, itemId));
      expect(materialLots.length).toBeGreaterThanOrEqual(1);

      // Total remaining stock should be original - consumed
      const totalRemaining = materialLots.reduce(
        (sum, lot) => sum + parseFloat(lot.quantity),
        0
      );
      const consumed = parseFloat(bomLine.quantity) * 5;
      // The original stock came from PO receiving
      const poLine = PO_MOUNTAIN_MINERALS_LINES.find(
        (l) => l.material === bomLine.component
      );
      if (poLine) {
        const original = parseFloat(poLine.quantity);
        expect(totalRemaining).toBeCloseTo(original - consumed, 2);
      }
    }

    // ── Produced lot ──
    const producedLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, productIds[PRODUCTS.NUTE_PACK]));
    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("5.0000");
    expect(producedLots[0].costPerUnit).toBe(completedOrder.actualCostPerUnit);

    // ── Stock movements ──
    const movements = await db
      .select({
        itemId: stockMovements.itemId,
        lotId: stockMovements.lotId,
        quantity: stockMovements.quantity,
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
      })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, nutePackCompletionMoId));

    // 8 consumed (one per ingredient) + 1 produced = 9 minimum
    // Some ingredients may span multiple lots (FIFO), yielding more consumed movements
    const consumedMovements = movements.filter(
      (m) => m.movementType === "manufacturing_consumed"
    );
    const producedMovements = movements.filter(
      (m) => m.movementType === "manufacturing_produced"
    );
    expect(consumedMovements.length).toBeGreaterThanOrEqual(8);
    expect(producedMovements).toHaveLength(1);
    expect(
      movements.every((m) => m.referenceType === "manufacturing_order")
    ).toBe(true);

    // expectedQty should be back to 0 after completion
    const [completedProduct] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.NUTE_PACK]));
    expect(completedProduct.expectedQty).toBe("0.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Create MO for The Bomb linked to a sales order
     ══════════════════════════════════════════════════════════════════ */

  test("creates MO for The Bomb linked to a sales order", async ({
    page,
    db,
  }) => {
    const theBombName = withTs(PRODUCTS.BOMB, ts);
    const customerName = withTs(CUSTOMERS.ROCKY_MOUNTAIN.name, ts);

    // Create customer via API
    const customerResult = await createCustomer({ name: customerName });
    expect(customerResult.status).toBe(201);
    customerId = customerResult.body.id;

    // Create sales order via API
    const soResult = await createSalesOrder({
      customerId,
      lines: [
        {
          itemId: productIds[PRODUCTS.BOMB],
          quantity: "10",
          unitPrice: "89.99",
        },
      ],
      requestedDate: "2026-05-15",
      notes: "Manufacturing traceability test",
    });
    expect(soResult.status).toBe(201);
    salesOrderId = soResult.body.id;

    // Resolve sales order details from DB
    const [salesOrder] = await db
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
    expect(salesOrder).toBeTruthy();
    salesOrderNumber = salesOrder.orderNumber;

    const [salesLine] = await db
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId));
    expect(salesLine).toBeTruthy();
    expect(salesLine.itemId).toBe(productIds[PRODUCTS.BOMB]);
    expect(salesLine.quantity).toBe("10.0000");
    salesOrderLineId = salesLine.id;

    // ── Create MO via UI ──
    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(theBombName);
    await page
      .getByRole("option", { name: new RegExp(theBombName) })
      .click();

    // BOM snapshot should show 5 ingredients (4 bases + nute pack)
    await expect(page.locator("tbody tr")).toHaveCount(5);
    for (const ingredient of BOMB_BOM) {
      await expect(page.locator("table")).toContainText(
        withTs(ingredient.component, ts)
      );
    }

    await page.getByLabel("Planned Quantity").fill("5");
    await page.getByLabel("Planned Date").fill("2026-05-10");

    // Link to sales order
    const salesLineInput = page.getByPlaceholder("Search sales lines...");
    await salesLineInput.click();
    await salesLineInput.fill(salesOrderNumber);
    await page
      .getByRole("option", { name: new RegExp(salesOrderNumber) })
      .click();

    await page.getByLabel("Notes").fill("The Bomb batch linked to SO");
    await page.getByRole("button", { name: "Create Order" }).click();

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    theBombMoId = getIdFromUrl(page.url());
    expect(theBombMoId).toBeTruthy();

    // ── DB verification ──
    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, theBombMoId));

    expect(order).toBeTruthy();
    expect(order.status).toBe("draft");
    expect(order.productId).toBe(productIds[PRODUCTS.BOMB]);
    expect(order.salesOrderId).toBe(salesOrderId);
    expect(order.salesOrderLineId).toBe(salesOrderLineId);
    expect(order.salesOrderNumber).toBe(salesOrderNumber);
    expect(order.salesCustomerName).toBe(customerName);
    expect(order.plannedQuantity).toBe("5.0000");

    // Verify ingredient snapshots (5 rows)
    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(manufacturingOrderIngredients.manufacturingOrderId, theBombMoId)
      );

    expect(ingredients).toHaveLength(5);

    const ingredientByItemId = new Map(
      ingredients.map((row) => [row.itemId, row])
    );

    for (const bomLine of BOMB_BOM) {
      // component could be a material or a product (Bomb Nute Pack)
      const itemId =
        materialIds[bomLine.component] ?? productIds[bomLine.component];
      expect(itemId, `${bomLine.component} ID not found`).toBeTruthy();
      const ingredient = ingredientByItemId.get(itemId);
      expect(
        ingredient,
        `Ingredient ${bomLine.component} missing`
      ).toBeTruthy();
      expect(ingredient!.quantityPerUnit).toBe(
        parseFloat(bomLine.quantity).toFixed(4)
      );
    }
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Release and complete The Bomb MO
     ══════════════════════════════════════════════════════════════════ */

  test("releases and completes The Bomb MO with FIFO consumption", async ({
    page,
    db,
  }) => {
    await page.goto(`/manufacturing/orders/${theBombMoId}`);

    // ── Release ──
    await page.getByRole("button", { name: "Release" }).click();

    // If shortage dialog appears, release anyway
    const shortageDialog = page.getByText("Release with shortages?");
    if (await shortageDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.getByRole("button", { name: "Release Anyway" }).click();
    }

    await expect(
      page.getByRole("button", { name: "Complete" })
    ).toBeVisible({ timeout: 15_000 });

    // Verify expectedQty incremented
    const [releasedProduct] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.BOMB]));
    expect(releasedProduct.expectedQty).toBe("5.0000");

    // ── Complete ──
    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel("Actual Quantity").fill("5");
    await page.getByRole("button", { name: "Complete Order" }).click();

    // Wait for completion
    await expect
      .poll(
        async () => {
          const [order] = await db
            .select({ status: manufacturingOrders.status })
            .from(manufacturingOrders)
            .where(eq(manufacturingOrders.id, theBombMoId));
          return order?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("completed");

    // ── DB verification ──
    const [completedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, theBombMoId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("5.0000");
    expect(completedOrder.actualMaterialCost).toBeTruthy();
    expect(completedOrder.actualCostPerUnit).toBeTruthy();
    expect(completedOrder.completedAt).toBeTruthy();

    const actualMaterialCost = parseFloat(completedOrder.actualMaterialCost!);
    const actualCostPerUnit = parseFloat(completedOrder.actualCostPerUnit!);
    expect(actualCostPerUnit).toBeCloseTo(actualMaterialCost / 5, 3);

    // ── Ingredient actuals ──
    const completedIngredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(
        eq(manufacturingOrderIngredients.manufacturingOrderId, theBombMoId)
      );
    const completedByItemId = new Map(
      completedIngredients.map((row) => [row.itemId, row])
    );

    // Verify actuals for each BOM line
    for (const bomLine of BOMB_BOM) {
      const itemId =
        materialIds[bomLine.component] ?? productIds[bomLine.component];
      const ingredient = completedByItemId.get(itemId);
      expect(ingredient).toBeTruthy();
      const expectedActual = (parseFloat(bomLine.quantity) * 5).toFixed(4);
      expect(ingredient!.actualQuantity).toBe(expectedActual);
      expect(ingredient!.actualCostTotal).toBeTruthy();
      expect(parseFloat(ingredient!.actualCostTotal!)).toBeGreaterThan(0);
    }

    // ── FIFO: nute pack sub-assembly lot should be consumed ──
    const nutePackLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, productIds[PRODUCTS.NUTE_PACK]));
    // The nute pack lot from test 5 (qty 5) should be fully consumed (qty=0)
    expect(nutePackLots).toHaveLength(1);
    expect(nutePackLots[0].quantity).toBe("0.0000");

    // ── Produced lot for The Bomb ──
    const producedLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, productIds[PRODUCTS.BOMB]));
    expect(producedLots).toHaveLength(1);
    expect(producedLots[0].quantity).toBe("5.0000");
    expect(producedLots[0].costPerUnit).toBe(completedOrder.actualCostPerUnit);

    // ── Stock movements ──
    const movements = await db
      .select({
        itemId: stockMovements.itemId,
        movementType: stockMovements.movementType,
        referenceType: stockMovements.referenceType,
      })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, theBombMoId));

    const consumedMovements = movements.filter(
      (m) => m.movementType === "manufacturing_consumed"
    );
    const producedMovements = movements.filter(
      (m) => m.movementType === "manufacturing_produced"
    );
    // 5 ingredients consumed (possibly more if FIFO spans lots) + 1 produced
    expect(consumedMovements.length).toBeGreaterThanOrEqual(5);
    expect(producedMovements).toHaveLength(1);
    expect(
      movements.every((m) => m.referenceType === "manufacturing_order")
    ).toBe(true);

    // expectedQty back to 0
    const [completedProduct] = await db
      .select({ expectedQty: items.expectedQty })
      .from(items)
      .where(eq(items.id, productIds[PRODUCTS.BOMB]));
    expect(completedProduct.expectedQty).toBe("0.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Decimal ingredient quantities without false shortage
     ══════════════════════════════════════════════════════════════════ */

  test("completes decimal ingredient quantities without false shortage", async ({
    db,
  }) => {
    const unitId = getUnitId();
    const decimalTs = Date.now();
    const decimalMaterialName = `Decimal Resin ${decimalTs}`;
    const decimalProductName = `Decimal Blend ${decimalTs}`;

    // Create material with 0.3 stock
    const materialCreate = await createItem({
      name: decimalMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `MAT-DEC-${decimalTs}`,
      category: `Decimal Test ${decimalTs}`,
      description: "Decimal ingredient",
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0.3",
      safetyStock: "0",
      bom: [],
    });
    expect(materialCreate.status).toBe(201);
    const decimalMaterialId = materialCreate.body.id as string;

    // Create product with 0.1 per unit BOM
    const productCreate = await createItem({
      name: decimalProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `PROD-DEC-${decimalTs}`,
      category: `Decimal Test ${decimalTs}`,
      description: "Decimal finished product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: decimalMaterialId, quantity: "0.1" }],
    });
    expect(productCreate.status).toBe(201);
    const decimalProductId = productCreate.body.id as string;

    // Create MO via API: qty 3 => needs 0.1 * 3 = 0.3 exactly
    const moResult = await createManufacturingOrder({
      productId: decimalProductId,
      plannedQuantity: "3",
      notes: "Decimal completion coverage",
      ingredients: [{ itemId: decimalMaterialId, quantityPerUnit: "0.1" }],
    });
    expect(moResult.status).toBe(201);
    const decimalOrderId = moResult.body.id as string;

    // Release
    const releaseResult = await releaseManufacturingOrder(decimalOrderId);
    expect(releaseResult.status).toBe(200);

    // Complete
    const completeResult = await completeManufacturingOrder(
      decimalOrderId,
      "3"
    );
    expect(completeResult.status).toBe(200);
    expect(completeResult.body?.id).toBe(decimalOrderId);

    // ── DB verification ──
    const [completedOrder] = await db
      .select({
        status: manufacturingOrders.status,
        actualQuantity: manufacturingOrders.actualQuantity,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, decimalOrderId));

    expect(completedOrder.status).toBe("completed");
    expect(completedOrder.actualQuantity).toBe("3.0000");

    // Ingredient actual should be exactly 0.3
    const [completedIngredient] = await db
      .select({
        actualQuantity: manufacturingOrderIngredients.actualQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(
        eq(manufacturingOrderIngredients.manufacturingOrderId, decimalOrderId)
      );
    expect(completedIngredient.actualQuantity).toBe("0.3000");

    // Material lot should be fully consumed
    const decimalLots = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, decimalMaterialId));
    expect(decimalLots).toHaveLength(1);
    expect(decimalLots[0].quantity).toBe("0.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Block deleting items used by active manufacturing orders
     ══════════════════════════════════════════════════════════════════ */

  test("blocks deleting items used by active manufacturing orders", async ({
    db,
  }) => {
    const proBaseProductId = productIds[PRODUCTS.PRO_BASE];

    // Create a draft MO for Pro Base to guard items
    const guardMoResult = await createManufacturingOrder({
      productId: proBaseProductId,
      plannedQuantity: "1",
      notes: "Delete guard coverage",
      ingredients: PRO_BASE_BOM.map((line) => ({
        itemId: materialIds[line.component],
        quantityPerUnit: line.quantity,
      })),
    });
    expect(guardMoResult.status).toBe(201);
    const guardOrderId = guardMoResult.body.id as string;

    // Verify it's draft
    const [guardOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, guardOrderId));
    expect(guardOrder.status).toBe("draft");

    // Clear the product's BOM first (so the only block is manufacturing)
    const proBaseName = withTs(PRODUCTS.PRO_BASE, ts);
    const clearBomResult = await updateItem(proBaseProductId, {
      name: proBaseName,
      defaultPurchasePrice: null,
      defaultSellingPrice: "59.99",
      safetyStock: "0",
      bom: [],
    });
    expect(clearBomResult.status).toBe(200);

    // Clean up the sales order from test 6 so it doesn't block product delete
    if (salesOrderId) {
      const deleteSoResponse = await testFetch("/api/sales-orders", {
        method: "DELETE",
        body: JSON.stringify({ ids: [salesOrderId] }),
      });
      expect(deleteSoResponse.status).toBe(200);
    }

    // Try to delete an ingredient (Coconut Coir) — should be blocked
    const deleteIngredientResult = await deleteItem(
      materialIds["Coconut Coir"]
    );
    expect(deleteIngredientResult.status).toBe(400);
    expect(deleteIngredientResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );

    // Try to delete the product (Pro Base) — should be blocked
    const deleteProductResult = await deleteItem(proBaseProductId);
    expect(deleteProductResult.status).toBe(400);
    expect(deleteProductResult.body?.error).toContain(
      "draft or released manufacturing orders"
    );
  });
});
