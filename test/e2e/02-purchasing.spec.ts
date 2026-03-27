import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect, getIdFromUrl } from "./fixtures";
import { testFetch, deleteItem } from "../helpers/api";
import {
  getTestTimestamp,
  withTs,
  ALL_MATERIALS,
  SUPPLIERS,
  PO_MOUNTAIN_MINERALS_LINES,
  PO_WESTERN_GROW_LINES,
  AMENDMENT_MATERIALS,
  BASE_MATERIALS,
} from "../helpers/paonia";
import {
  items,
  lots,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  suppliers as suppliersTable,
} from "../../lib/db/schema";

test.describe("Chapter 2 — Purchasing: Paonia Soil Co.", () => {
  test.describe.configure({ mode: "serial" });

  // ── Shared timestamp from inventory spec ──────────────────────────
  const ts = getTestTimestamp();

  // ── Per-run timestamp for supplier names to avoid collisions ──────
  const runTs = Date.now();

  // ── Material IDs resolved from DB (created by 01-inventory) ───────
  const materialIds: Record<string, string> = {};

  // ── Supplier IDs ──────────────────────────────────────────────────
  let mountainMineralsSupplierId: string;
  let westernGrowSupplierId: string;

  // ── Purchase Order IDs and numbers ────────────────────────────────
  let po1Id: string; // Mountain Minerals (amendments)
  let po1Number: string;
  let po2Id: string; // Western Grow (bases)
  let po2Number: string;

  /* ══════════════════════════════════════════════════════════════════
     1. Resolves all 12 materials by name from DB
     ══════════════════════════════════════════════════════════════════ */

  test("resolves all 12 materials from inventory spec", async ({ db }) => {
    for (const baseName of ALL_MATERIALS) {
      const name = withTs(baseName, ts);
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(eq(items.name, name));

      expect(row, `Material "${name}" not found — run 01-inventory first`).toBeTruthy();
      materialIds[baseName] = row.id;
    }

    expect(Object.keys(materialIds)).toHaveLength(12);
  });

  /* ══════════════════════════════════════════════════════════════════
     2. Creates Mountain Minerals Supply with all fields via UI
     ══════════════════════════════════════════════════════════════════ */

  test("creates Mountain Minerals Supply with all fields", async ({ page, db }) => {
    const sup = SUPPLIERS.MOUNTAIN_MINERALS;
    const supplierName = `${sup.name} ${runTs}`;

    await page.goto("/purchasing/suppliers/new");
    await expect(page.getByText("Add Supplier")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(supplierName);
    await page.getByLabel("Code").fill(`${sup.code}-${runTs}`);
    await page.getByLabel("Contact Name").fill(sup.contactName);
    await page.getByLabel("Payment Terms").fill(sup.paymentTerms);
    await page.getByLabel("Email").fill(`mm-${runTs}@example.com`);
    await page.getByLabel("Phone").fill(sup.phone);
    await page.getByLabel("Address").fill(sup.address);
    await page.getByLabel("Notes").fill(sup.notes);

    await page.getByRole("button", { name: "Create Supplier" }).click();
    await page.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]+$/);
    mountainMineralsSupplierId = getIdFromUrl(page.url());

    // ── UI verification: detail page ──
    await expect(
      page.getByRole("heading", { name: supplierName })
    ).toBeVisible();
    await expect(page.getByText(sup.contactName)).toBeVisible();
    await expect(page.getByText(sup.paymentTerms)).toBeVisible();
    await expect(page.getByText(sup.notes)).toBeVisible();

    // ── DB verification ──
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, mountainMineralsSupplierId));

    expect(supplier.name).toBe(supplierName);
    expect(supplier.code).toBe(`${sup.code}-${runTs}`);
    expect(supplier.contactName).toBe(sup.contactName);
    expect(supplier.paymentTerms).toBe(sup.paymentTerms);
    expect(supplier.email).toBe(`mm-${runTs}@example.com`);
    expect(supplier.phone).toBe(sup.phone);
    expect(supplier.address).toBe(sup.address);
    expect(supplier.notes).toBe(sup.notes);
    expect(supplier.deletedAt).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     3. Creates Western Grow Media with all fields via UI
     ══════════════════════════════════════════════════════════════════ */

  test("creates Western Grow Media with all fields", async ({ page, db }) => {
    const sup = SUPPLIERS.WESTERN_GROW;
    const supplierName = `${sup.name} ${runTs}`;

    await page.goto("/purchasing/suppliers/new");
    await expect(page.getByText("Add Supplier")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(supplierName);
    await page.getByLabel("Code").fill(`${sup.code}-${runTs}`);
    await page.getByLabel("Contact Name").fill(sup.contactName);
    await page.getByLabel("Payment Terms").fill(sup.paymentTerms);
    await page.getByLabel("Email").fill(`wg-${runTs}@example.com`);
    await page.getByLabel("Phone").fill(sup.phone);
    await page.getByLabel("Address").fill(sup.address);
    await page.getByLabel("Notes").fill(sup.notes);

    await page.getByRole("button", { name: "Create Supplier" }).click();
    await page.waitForURL(/\/purchasing\/suppliers\/[0-9a-f-]+$/);
    westernGrowSupplierId = getIdFromUrl(page.url());

    // ── UI verification: detail page ──
    await expect(
      page.getByRole("heading", { name: supplierName })
    ).toBeVisible();
    await expect(page.getByText(sup.contactName)).toBeVisible();
    await expect(page.getByText(sup.paymentTerms)).toBeVisible();

    // ── DB verification ──
    const [supplier] = await db
      .select()
      .from(suppliersTable)
      .where(eq(suppliersTable.id, westernGrowSupplierId));

    expect(supplier.name).toBe(supplierName);
    expect(supplier.code).toBe(`${sup.code}-${runTs}`);
    expect(supplier.contactName).toBe(sup.contactName);
    expect(supplier.paymentTerms).toBe(sup.paymentTerms);
    expect(supplier.email).toBe(`wg-${runTs}@example.com`);
    expect(supplier.phone).toBe(sup.phone);
    expect(supplier.address).toBe(sup.address);
    expect(supplier.notes).toBe(sup.notes);
    expect(supplier.deletedAt).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     4. Creates PO #1 to Mountain Minerals (8 amendment lines)
     ══════════════════════════════════════════════════════════════════ */

  test("creates PO #1 to Mountain Minerals with 8 amendment lines", async ({ page, db }) => {
    const supplierName = `${SUPPLIERS.MOUNTAIN_MINERALS.name} ${runTs}`;

    await page.goto("/purchasing/orders/new");
    await expect(page.getByText("Add Purchase Order")).toBeVisible();

    // ── Supplier selection ──
    const supplierInput = page.getByPlaceholder("Search suppliers...");
    await supplierInput.click();
    await supplierInput.fill(supplierName);
    await page.getByRole("option", { name: new RegExp(supplierName) }).click();

    // ── Expected date ──
    await page.locator("#expectedDate").fill("2026-06-01");

    // ── Notes ──
    await page.locator("#notes").fill("Amendment restock — all 8 minerals for nute pack production.");

    // ── Add 8 amendment material lines ──
    for (let i = 0; i < PO_MOUNTAIN_MINERALS_LINES.length; i++) {
      const line = PO_MOUNTAIN_MINERALS_LINES[i];
      const materialName = withTs(line.material, ts);

      if (i > 0) {
        await page.getByRole("button", { name: "Add Material" }).click();
      }

      const row = page.locator("tbody tr").nth(i);
      const materialInput = row.getByPlaceholder("Search materials...");
      await materialInput.click();
      await materialInput.fill(materialName);
      await page.getByRole("option", { name: new RegExp(materialName) }).click();

      // Quantity (the "Ordered Qty" input is the first placeholder="0" in the row)
      await row.getByPlaceholder("0").fill(line.quantity);

      // Unit cost may be auto-filled from defaultPurchasePrice — overwrite it
      await row.getByPlaceholder("0.00").fill(line.unitCost);
    }

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/purchasing\/orders\/[0-9a-f-]+$/);
    po1Id = getIdFromUrl(page.url());

    // ── DB verification ──
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po1Id));

    po1Number = order.orderNumber;
    expect(order.status).toBe("draft");
    expect(order.supplierName).toBe(supplierName);
    expect(order.expectedDate).toBe("2026-06-01");

    // Verify total: sum of (qty * unitCost) for all 8 lines
    const expectedTotal = PO_MOUNTAIN_MINERALS_LINES.reduce(
      (sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unitCost),
      0
    );
    expect(parseFloat(order.totalAmount)).toBeCloseTo(expectedTotal, 2);

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po1Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines).toHaveLength(8);

    // Verify each line maps to the correct material
    for (let i = 0; i < PO_MOUNTAIN_MINERALS_LINES.length; i++) {
      const expected = PO_MOUNTAIN_MINERALS_LINES[i];
      expect(lines[i].itemId).toBe(materialIds[expected.material]);
      expect(lines[i].quantityOrdered).toBe(expected.quantity);
      expect(lines[i].quantityReceived).toBe("0.0000");
    }
  });

  /* ══════════════════════════════════════════════════════════════════
     5. Creates PO #2 to Western Grow Media (4 base lines)
     ══════════════════════════════════════════════════════════════════ */

  test("creates PO #2 to Western Grow Media with 4 base lines", async ({ page, db }) => {
    const supplierName = `${SUPPLIERS.WESTERN_GROW.name} ${runTs}`;

    await page.goto("/purchasing/orders/new");
    await expect(page.getByText("Add Purchase Order")).toBeVisible();

    // ── Supplier selection ──
    const supplierInput = page.getByPlaceholder("Search suppliers...");
    await supplierInput.click();
    await supplierInput.fill(supplierName);
    await page.getByRole("option", { name: new RegExp(supplierName) }).click();

    // ── Expected date ──
    await page.locator("#expectedDate").fill("2026-06-15");

    // ── Notes ──
    await page.locator("#notes").fill("Base materials for Bomb Original and Pro Base Coco production.");

    // ── Add 4 base material lines ──
    for (let i = 0; i < PO_WESTERN_GROW_LINES.length; i++) {
      const line = PO_WESTERN_GROW_LINES[i];
      const materialName = withTs(line.material, ts);

      if (i > 0) {
        await page.getByRole("button", { name: "Add Material" }).click();
      }

      const row = page.locator("tbody tr").nth(i);
      const materialInput = row.getByPlaceholder("Search materials...");
      await materialInput.click();
      await materialInput.fill(materialName);
      await page.getByRole("option", { name: new RegExp(materialName) }).click();

      await row.getByPlaceholder("0").fill(line.quantity);
      await row.getByPlaceholder("0.00").fill(line.unitCost);
    }

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/purchasing\/orders\/[0-9a-f-]+$/);
    po2Id = getIdFromUrl(page.url());

    // ── DB verification ──
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po2Id));

    po2Number = order.orderNumber;
    expect(order.status).toBe("draft");
    expect(order.supplierName).toBe(supplierName);
    expect(order.expectedDate).toBe("2026-06-15");

    const expectedTotal = PO_WESTERN_GROW_LINES.reduce(
      (sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unitCost),
      0
    );
    expect(parseFloat(order.totalAmount)).toBeCloseTo(expectedTotal, 2);

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po2Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines).toHaveLength(4);

    for (let i = 0; i < PO_WESTERN_GROW_LINES.length; i++) {
      const expected = PO_WESTERN_GROW_LINES[i];
      expect(lines[i].itemId).toBe(materialIds[expected.material]);
      expect(lines[i].quantityOrdered).toBe(expected.quantity);
      expect(lines[i].quantityReceived).toBe("0.0000");
    }
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Edits PO #1 — changes kelp meal quantity
     ══════════════════════════════════════════════════════════════════ */

  test("edits PO #1 — changes kelp meal quantity from 50 to 60", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${po1Id}`);
    await expect(page.getByRole("heading", { name: po1Number })).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(`**/purchasing/orders/${po1Id}/edit`);
    await expect(page.getByText("Edit Purchase Order")).toBeVisible();

    // ── Verify pre-population: 8 lines exist ──
    await expect(page.locator("tbody tr")).toHaveCount(8);

    // ── Change kelp meal quantity (first row) from 50 to 60 ──
    const firstRow = page.locator("tbody tr").first();
    await firstRow.getByPlaceholder("0").fill("60");

    // ── Change expected date ──
    await page.locator("#expectedDate").fill("2026-06-05");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/purchasing/orders/${po1Id}`);

    // ── DB verification ──
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po1Id));

    expect(order.expectedDate).toBe("2026-06-05");

    // New total: old total - (50 * 8.50) + (60 * 8.50) = old + 10 * 8.50
    const oldTotal = PO_MOUNTAIN_MINERALS_LINES.reduce(
      (sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unitCost),
      0
    );
    const newTotal = oldTotal + 10 * 8.50;
    expect(parseFloat(order.totalAmount)).toBeCloseTo(newTotal, 2);

    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po1Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines).toHaveLength(8);
    expect(lines[0].quantityOrdered).toBe("60"); // kelp meal updated
    expect(lines[1].quantityOrdered).toBe("75"); // fish bone meal unchanged
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Submits both POs, verifies expectedQty, tests referential integrity
     ══════════════════════════════════════════════════════════════════ */

  test("submits both POs and blocks active deletes", async ({ page, db }) => {
    // ── Submit PO #1 (Mountain Minerals — amendments) ──
    await page.goto(`/purchasing/orders/${po1Id}`);
    await expect(page.getByRole("heading", { name: po1Number })).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Ordered")).toBeVisible();

    const [order1] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po1Id));
    expect(order1.status).toBe("ordered");
    expect(order1.orderedAt).not.toBeNull();

    // ── Submit PO #2 (Western Grow — bases) ──
    await page.goto(`/purchasing/orders/${po2Id}`);
    await expect(page.getByRole("heading", { name: po2Number })).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Ordered")).toBeVisible();

    const [order2] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po2Id));
    expect(order2.status).toBe("ordered");
    expect(order2.orderedAt).not.toBeNull();

    // ── Verify expectedQty on amendment materials (PO #1) ──
    // Kelp meal was edited to 60
    const [kelpItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Kelp Meal"]));
    expect(kelpItem.expectedQty).toBe("60");

    const [fishBoneItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Fish Bone Meal"]));
    expect(fishBoneItem.expectedQty).toBe("75");

    // ── Verify expectedQty on base materials (PO #2) ──
    const [cocoItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Coconut Coir"]));
    expect(cocoItem.expectedQty).toBe("200");

    const [perliteItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Perlite"]));
    expect(perliteItem.expectedQty).toBe("150");

    // ── Referential integrity: supplier delete blocked ──
    const supplierDeleteRes = await testFetch(
      `/api/suppliers/${mountainMineralsSupplierId}`,
      { method: "DELETE" }
    );
    const supplierDeleteBody = await supplierDeleteRes.json().catch(() => null);
    expect(supplierDeleteRes.status).toBe(400);
    expect(supplierDeleteBody?.error).toContain("purchase orders");

    // ── Referential integrity: material on active PO delete blocked ──
    const materialDeleteRes = await deleteItem(materialIds["Kelp Meal"]);
    expect(materialDeleteRes.status).toBe(400);
    expect(materialDeleteRes.body?.error).toContain("purchase orders");
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Partially receives PO #2 (coco + perlite only)
     ══════════════════════════════════════════════════════════════════ */

  test("partially receives PO #2 — coco and perlite only", async ({ page, db }) => {
    await page.goto(`/purchasing/orders/${po2Id}`);
    await expect(page.getByRole("heading", { name: po2Number })).toBeVisible();

    await page.getByRole("button", { name: "Receive" }).click();

    const receiveDialog = page.getByRole("dialog", {
      name: "Receive Purchase Order",
    });
    await expect(receiveDialog).toBeVisible();

    // PO #2 lines (ordered by sort_order): Coconut Coir, Perlite, Rice Hulls, Worm Castings
    // Receive only coco (200) and perlite (150)
    await receiveDialog.getByPlaceholder("0").nth(0).fill("200");
    await receiveDialog.getByPlaceholder("0").nth(1).fill("150");
    // Leave rice hulls and worm castings blank

    await receiveDialog.getByRole("button", { name: "Receive Materials" }).click();
    await expect(receiveDialog).not.toBeVisible();
    await expect(page.getByText("Partially Received")).toBeVisible();

    // ── DB verification: order status ──
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po2Id));
    expect(order.status).toBe("partial");

    // ── DB verification: line quantities received ──
    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po2Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(lines[0].quantityReceived).toBe("200");
    expect(lines[1].quantityReceived).toBe("150");
    expect(lines[2].quantityReceived).toBe("0.0000"); // rice hulls
    expect(lines[3].quantityReceived).toBe("0.0000"); // worm castings

    // ── DB verification: lots created ──
    const cocoLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, materialIds["Coconut Coir"]));
    // Coconut Coir was created with stock=0 in inventory, so the only lot is from this receive
    expect(cocoLots.length).toBeGreaterThanOrEqual(1);
    const cocoReceiveLot = cocoLots.find(
      (lot) => lot.quantity === "200.0000"
    );
    expect(cocoReceiveLot).toBeTruthy();
    expect(cocoReceiveLot!.costPerUnit).toBe("4.5000");

    const perliteLots = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, materialIds["Perlite"]));
    expect(perliteLots.length).toBeGreaterThanOrEqual(1);
    const perliteReceiveLot = perliteLots.find(
      (lot) => lot.quantity === "150.0000"
    );
    expect(perliteReceiveLot).toBeTruthy();
    expect(perliteReceiveLot!.costPerUnit).toBe("5.0000");

    // ── DB verification: stock movements ──
    const cocoMovements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.itemId, materialIds["Coconut Coir"]),
          eq(stockMovements.referenceId, po2Id),
          eq(stockMovements.movementType, "purchase_received")
        )
      );
    expect(cocoMovements).toHaveLength(1);
    expect(cocoMovements[0].referenceType).toBe("purchase_order");

    // ── DB verification: expectedQty reduced by received amounts ──
    const [cocoItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Coconut Coir"]));
    // Ordered 200, received 200 from PO#2 => expectedQty should be 0 for this PO
    expect(cocoItem.expectedQty).toBe("0");

    const [perliteItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Perlite"]));
    expect(perliteItem.expectedQty).toBe("0");

    // Rice hulls and worm castings still have full expected qty
    const [riceItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Rice Hulls"]));
    expect(riceItem.expectedQty).toBe("100");

    const [wormItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, materialIds["Worm Castings"]));
    expect(wormItem.expectedQty).toBe("80");
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Fully receives PO #2 remainder and PO #1
     ══════════════════════════════════════════════════════════════════ */

  test("fully receives PO #2 remainder and PO #1", async ({ page, db }) => {
    // ── Receive remaining PO #2 lines (rice hulls + worm castings) ──
    await page.goto(`/purchasing/orders/${po2Id}`);
    await expect(page.getByRole("heading", { name: po2Number })).toBeVisible();

    await page.getByRole("button", { name: "Receive" }).click();

    let receiveDialog = page.getByRole("dialog", {
      name: "Receive Purchase Order",
    });
    await expect(receiveDialog).toBeVisible();

    // Coco and perlite already fully received — their remaining is 0
    // Rice hulls (index 2) and worm castings (index 3) still need receiving
    await receiveDialog.getByPlaceholder("0").nth(2).fill("100");
    await receiveDialog.getByPlaceholder("0").nth(3).fill("80");

    await receiveDialog.getByRole("button", { name: "Receive Materials" }).click();
    await expect(receiveDialog).not.toBeVisible();
    await expect(page.getByText("Received")).toBeVisible();

    // ── DB verification: PO #2 fully received ──
    const [order2] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po2Id));
    expect(order2.status).toBe("received");
    expect(order2.receivedAt).not.toBeNull();

    const po2Lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po2Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(po2Lines[0].quantityReceived).toBe("200"); // coco
    expect(po2Lines[1].quantityReceived).toBe("150"); // perlite
    expect(po2Lines[2].quantityReceived).toBe("100"); // rice hulls
    expect(po2Lines[3].quantityReceived).toBe("80");  // worm castings

    // ── Now fully receive PO #1 (all 8 amendments at once) ──
    await page.goto(`/purchasing/orders/${po1Id}`);
    await expect(page.getByRole("heading", { name: po1Number })).toBeVisible();

    await page.getByRole("button", { name: "Receive" }).click();

    receiveDialog = page.getByRole("dialog", {
      name: "Receive Purchase Order",
    });
    await expect(receiveDialog).toBeVisible();

    // Fill all 8 amendment lines with their ordered quantities
    // Line 0: Kelp Meal — 60 (edited from 50)
    const po1Quantities = ["60", "75", "60", "100", "80", "50", "40", "30"];
    for (let i = 0; i < po1Quantities.length; i++) {
      await receiveDialog.getByPlaceholder("0").nth(i).fill(po1Quantities[i]);
    }

    await receiveDialog.getByRole("button", { name: "Receive Materials" }).click();
    await expect(receiveDialog).not.toBeVisible();
    await expect(page.getByText("Received")).toBeVisible();

    // ── DB verification: PO #1 fully received ──
    const [order1] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po1Id));
    expect(order1.status).toBe("received");
    expect(order1.receivedAt).not.toBeNull();

    const po1Lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po1Id))
      .orderBy(asc(purchaseOrderLines.sortOrder));

    expect(po1Lines).toHaveLength(8);
    expect(po1Lines[0].quantityReceived).toBe("60");  // kelp meal
    expect(po1Lines[1].quantityReceived).toBe("75");  // fish bone meal

    // ── DB verification: lots exist for all amendments ──
    for (const amendmentName of AMENDMENT_MATERIALS) {
      const amendLots = await db
        .select()
        .from(lots)
        .where(eq(lots.itemId, materialIds[amendmentName]));
      expect(
        amendLots.length,
        `Expected lot(s) for ${amendmentName}`
      ).toBeGreaterThanOrEqual(1);
    }

    // ── DB verification: lots exist for all bases ──
    for (const baseName of BASE_MATERIALS) {
      const baseLots = await db
        .select()
        .from(lots)
        .where(eq(lots.itemId, materialIds[baseName]));
      expect(
        baseLots.length,
        `Expected lot(s) for ${baseName}`
      ).toBeGreaterThanOrEqual(1);
    }

    // ── DB verification: all stock movements created ──
    const allReceiveMovements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.movementType, "purchase_received"),
          inArray(stockMovements.referenceId, [po1Id, po2Id])
        )
      );
    // PO#1: 8 lines in one receive = 8 movements
    // PO#2: 2 movements (partial) + 2 movements (remainder) = 4 movements
    // Total: 12
    expect(allReceiveMovements).toHaveLength(12);

    // ── DB verification: all expectedQty back to 0 ──
    for (const materialName of ALL_MATERIALS) {
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, materialIds[materialName]));
      expect(
        item.expectedQty,
        `expectedQty for ${materialName} should be 0`
      ).toBe("0");
    }
  });
});
