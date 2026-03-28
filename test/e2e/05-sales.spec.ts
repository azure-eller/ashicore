import { eq, and, isNull } from "drizzle-orm";
import { test, expect, filterList } from "./fixtures";
import {
  getTestTimestamp,
  withTs,
  PRODUCTS,
  CUSTOMERS,
} from "../helpers/paonia";
import {
  customers as salesCustomers,
  items,
  lots,
  salesOrderLines,
  salesOrders,
  stockMovements,
} from "../../lib/db/schema";
import {
  createCustomer,
  createSalesOrder,
  testFetch,
} from "../helpers/api";

test.describe("Chapter 5 — Sales: Paonia Soil Co.", () => {
  test.describe.configure({ mode: "serial" });

  const ts = getTestTimestamp();
  // Per-run timestamp for customers/orders — avoids collision on re-runs.
  const run = Date.now();

  // ── Resolved product IDs from inventory spec ─────────────────
  let theBombId: string;
  let theBombName: string;
  let proBaseId: string;
  let proBaseName: string;

  // ── Customer IDs ─────────────────────────────────────────────
  let rockyMtnId: string;
  let rockyMtnName: string;
  let frontRangeName: string;

  // ── Order IDs ────────────────────────────────────────────────
  let draftOrderId: string;
  let draftOrderNumber: string;
  let guardOrderId: string;

  /* ══════════════════════════════════════════════════════════════════
     1. Resolve products created by the inventory spec
     ══════════════════════════════════════════════════════════════════ */

  test("resolves products from inventory spec", async ({ db }) => {
    const bombName = withTs(PRODUCTS.BOMB, ts);
    const [bomb] = await db
      .select()
      .from(items)
      .where(and(eq(items.name, bombName), isNull(items.deletedAt)));
    expect(
      bomb,
      `Product "${bombName}" not found — run 01-inventory first`
    ).toBeTruthy();
    theBombId = bomb.id;
    theBombName = bomb.name;

    const proBaseFullName = withTs(PRODUCTS.PRO_BASE, ts);
    const [proBase] = await db
      .select()
      .from(items)
      .where(and(eq(items.name, proBaseFullName), isNull(items.deletedAt)));
    expect(
      proBase,
      `Product "${proBaseFullName}" not found — run 01-inventory first`
    ).toBeTruthy();
    proBaseId = proBase.id;
    proBaseName = proBase.name;
  });

  /* ══════════════════════════════════════════════════════════════════
     2. Create Rocky Mountain Nursery customer with all fields
     ══════════════════════════════════════════════════════════════════ */

  test("creates Rocky Mountain Nursery with all fields", async ({
    page,
    db,
  }) => {
    rockyMtnName = `${CUSTOMERS.ROCKY_MOUNTAIN.name} ${run}`;
    const email = `rocky-${run}@example.com`;

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.getByLabel("Name").fill(rockyMtnName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone").fill(CUSTOMERS.ROCKY_MOUNTAIN.phone);
    await page.getByLabel("Address").fill(CUSTOMERS.ROCKY_MOUNTAIN.address);
    await page.getByLabel("Notes").fill(CUSTOMERS.ROCKY_MOUNTAIN.notes);

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — detail page
    await expect(
      page.getByRole("heading", { name: rockyMtnName })
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(
      page.getByText(CUSTOMERS.ROCKY_MOUNTAIN.phone)
    ).toBeVisible();
    await expect(
      page.getByText(CUSTOMERS.ROCKY_MOUNTAIN.address)
    ).toBeVisible();
    await expect(
      page.getByText(CUSTOMERS.ROCKY_MOUNTAIN.notes)
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // UI — list page
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", rockyMtnName);
    const fullRow = page
      .getByRole("row", { name: new RegExp(rockyMtnName) })
      .first();
    await expect(fullRow).toBeVisible();
    await expect(fullRow).toContainText(email);
    await expect(fullRow).toContainText(CUSTOMERS.ROCKY_MOUNTAIN.phone);
    await expect(fullRow).not.toContainText("Invalid");

    // DB
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, rockyMtnName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    rockyMtnId = customer.id;

    expect(customer.email).toBe(email);
    expect(customer.phone).toBe(CUSTOMERS.ROCKY_MOUNTAIN.phone);
    expect(customer.address).toBe(CUSTOMERS.ROCKY_MOUNTAIN.address);
    expect(customer.notes).toBe(CUSTOMERS.ROCKY_MOUNTAIN.notes);
    expect(customer.deletedAt).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     3. Edit Rocky Mountain — pre-population, changes phone + notes
     ══════════════════════════════════════════════════════════════════ */

  test("edits Rocky Mountain — verifies pre-population and saves changes", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/customers/${rockyMtnId}`);
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("Edit Customer")).toBeVisible();

    // Verify pre-populated
    await expect(page.getByLabel("Name")).toHaveValue(rockyMtnName);
    await expect(page.getByLabel("Email")).toHaveValue(
      `rocky-${run}@example.com`
    );
    await expect(page.getByLabel("Phone")).toHaveValue(
      CUSTOMERS.ROCKY_MOUNTAIN.phone
    );
    await expect(page.getByLabel("Address")).toHaveValue(
      CUSTOMERS.ROCKY_MOUNTAIN.address
    );
    await expect(page.getByLabel("Notes")).toHaveValue(
      CUSTOMERS.ROCKY_MOUNTAIN.notes
    );

    // Make changes
    await page.getByLabel("Phone").fill("555-0499");
    await page.getByLabel("Notes").fill("Updated: priority wholesale account");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/customers/${rockyMtnId}`);

    // UI — detail page reflects edits
    await expect(page.getByText("555-0499")).toBeVisible();
    await expect(
      page.getByText("Updated: priority wholesale account")
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const [updated] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, rockyMtnId));
    expect(updated.phone).toBe("555-0499");
    expect(updated.notes).toBe("Updated: priority wholesale account");
    // Unchanged fields
    expect(updated.email).toBe(`rocky-${run}@example.com`);
    expect(updated.address).toBe(CUSTOMERS.ROCKY_MOUNTAIN.address);
  });

  /* ══════════════════════════════════════════════════════════════════
     4. Create Front Range Garden Center (minimal — name only)
     ══════════════════════════════════════════════════════════════════ */

  test("creates Front Range Garden Center (minimal)", async ({ page, db }) => {
    frontRangeName = `${CUSTOMERS.FRONT_RANGE.name} ${run}`;

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();

    await page.getByLabel("Name").fill(frontRangeName);

    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);

    // UI — detail page
    await expect(
      page.getByRole("heading", { name: frontRangeName })
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // UI — list page
    await page.goto("/sales/customers");
    await filterList(page, "Search customers", frontRangeName);
    const minRow = page
      .getByRole("row", { name: new RegExp(frontRangeName) })
      .first();
    await expect(minRow).toBeVisible();
    await expect(minRow).not.toContainText("Invalid");

    // DB
    const rows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, frontRangeName));
    expect(rows).toHaveLength(1);

    const customer = rows[0];
    expect(customer.email).toBeNull();
    expect(customer.phone).toBeNull();
    expect(customer.address).toBeNull();
    expect(customer.notes).toBeNull();
    expect(customer.deletedAt).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     5. Create draft order for Rocky Mountain:
        line 1 = The Bomb x 10, line 2 = Pro Base x 5
     ══════════════════════════════════════════════════════════════════ */

  test("creates a draft order with two product lines", async ({
    page,
    db,
  }) => {
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    // ── Customer picker ──
    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(rockyMtnName);
    await page
      .getByRole("option", { name: new RegExp(rockyMtnName) })
      .click();

    // ── Requested date ──
    await page.getByLabel("Requested Date").fill("2026-05-01");

    // ── Line 1: The Bomb x 10 ──
    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(theBombName);
    await page
      .getByRole("option", { name: new RegExp(theBombName) })
      .click();
    await page.locator('input[placeholder="0"]').first().fill("10");

    // ── Line 2: Pro Base x 5 ──
    await page.getByRole("button", { name: "Add Item" }).click();
    const row2 = page.locator("tbody tr").last();
    await row2.getByPlaceholder("Search products...").click();
    await row2.getByPlaceholder("Search products...").fill(proBaseName);
    await page
      .getByRole("option", { name: new RegExp(proBaseName) })
      .click();
    await row2.locator('input[placeholder="0"]').first().fill("5");

    // ── Notes ──
    await page.getByLabel("Notes").fill("Spring order for Rocky Mountain");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // UI — detail page
    await expect(
      page.locator("main").getByText("Draft", { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(rockyMtnName)).toBeVisible();
    await expect(page.getByText(theBombName)).toBeVisible();
    await expect(page.getByText(proBaseName)).toBeVisible();
    await expect(
      page.getByText("Spring order for Rocky Mountain")
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB — order
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, rockyMtnId));
    expect(orderRows).toHaveLength(1);

    const order = orderRows[0];
    draftOrderId = order.id;
    draftOrderNumber = order.orderNumber;

    expect(order.customerName).toBe(rockyMtnName);
    expect(order.status).toBe("draft");
    expect(order.requestedDate).toBe("2026-05-01");
    expect(order.notes).toBe("Spring order for Rocky Mountain");
    expect(order.deletedAt).toBeNull();

    // DB — line items
    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.id));
    expect(lineRows).toHaveLength(2);

    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(theBombId)?.quantity).toBe("10.0000");
    expect(lineByItem.get(proBaseId)?.quantity).toBe("5.0000");

    // DB — committedQty should be 0 for draft orders
    const [bombItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, theBombId));
    const [proBaseItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, proBaseId));
    expect(bombItem.committedQty).toBe("0.0000");
    expect(proBaseItem.committedQty).toBe("0.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Edit draft — change The Bomb qty to 15, update notes
     ══════════════════════════════════════════════════════════════════ */

  test("edits the draft order — changes The Bomb qty to 15 and updates notes", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/orders/${draftOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    // Verify pre-populated fields
    await expect(page.getByLabel("Requested Date")).toHaveValue("2026-05-01");
    await expect(page.getByLabel("Notes")).toHaveValue(
      "Spring order for Rocky Mountain"
    );

    // Change first line quantity from 10 to 15
    const quantityInputs = page.locator('input[placeholder="0"]');
    await quantityInputs.first().fill("15");
    await page.getByLabel("Notes").fill("Updated: 15 units of The Bomb");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForURL(`**/sales/orders/${draftOrderId}`);
    await expect(
      page.getByRole("heading", { name: draftOrderNumber })
    ).toBeVisible();

    // UI
    await expect(
      page.getByText("Updated: 15 units of The Bomb")
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid");

    // DB
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, draftOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("draft");
    expect(orderRows[0].notes).toBe("Updated: 15 units of The Bomb");

    // Verify line quantity updated
    const lineRows = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, draftOrderId));
    const lineByItem = new Map(lineRows.map((line) => [line.itemId, line]));
    expect(lineByItem.get(theBombId)?.quantity).toBe("15.0000");
    expect(lineByItem.get(proBaseId)?.quantity).toBe("5.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Confirm order — oversell dialog — commits stock
     ══════════════════════════════════════════════════════════════════ */

  test("confirms the order — handles oversell dialog — and commits stock", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/orders/${draftOrderId}/edit`);
    await expect(page.getByText("Edit Sales Order")).toBeVisible();

    // Change status from Draft to Confirmed via the Select trigger
    await page
      .getByRole("combobox")
      .filter({ hasText: "Draft" })
      .first()
      .click();
    await page.getByRole("option", { name: "Confirmed" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Products have limited/no stock, so the oversell dialog should appear
    const oversellDialog = page.getByRole("alertdialog", {
      name: "Confirm Oversell?",
    });
    await expect(oversellDialog).toBeVisible();

    // Verify the tooltip header is present
    await oversellDialog
      .getByText("Current Committed", { exact: true })
      .hover();
    await expect(
      page.getByText("Quantity already reserved by confirmed sales orders.")
    ).toBeVisible();

    await oversellDialog
      .getByRole("button", { name: "Confirm Anyway" })
      .scrollIntoViewIfNeeded();
    await oversellDialog
      .getByRole("button", { name: "Confirm Anyway" })
      .click();

    await page.waitForURL(`**/sales/orders/${draftOrderId}`);

    // DB — status changed
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, draftOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("confirmed");

    // DB — committedQty updated
    const [bombItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, theBombId));
    const [proBaseItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, proBaseId));
    expect(parseFloat(bombItem.committedQty!)).toBeGreaterThanOrEqual(15);
    expect(parseFloat(proBaseItem.committedQty!)).toBeGreaterThanOrEqual(5);
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Confirmed order is read-only — no Edit link, Cancel visible
     ══════════════════════════════════════════════════════════════════ */

  test("confirmed order is read-only", async ({ page }) => {
    await page.goto(`/sales/orders/${draftOrderId}`);
    await expect(
      page.getByRole("heading", { name: draftOrderNumber })
    ).toBeVisible();

    await expect(page.getByRole("link", { name: "Edit" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Cancel confirmed order — releases committed stock
     ══════════════════════════════════════════════════════════════════ */

  test("cancels the confirmed order and releases committed stock", async ({
    page,
    db,
  }) => {
    await page.goto(`/sales/orders/${draftOrderId}`);
    await expect(
      page.getByRole("heading", { name: draftOrderNumber })
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Cancel Order" }).click();

    // Page refreshes after cancel — give extra time (slowmo can eat the default 5s)
    await expect(
      page
        .locator("main")
        .getByText("Cancelled", { exact: true })
        .first()
    ).toBeVisible({ timeout: 15000 });

    // DB — status
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, draftOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe("cancelled");

    // DB — committedQty released to 0
    const [bombItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, theBombId));
    const [proBaseItem] = await db
      .select()
      .from(items)
      .where(eq(items.id, proBaseId));
    expect(bombItem.committedQty).toBe("0.0000");
    expect(proBaseItem.committedQty).toBe("0.0000");
  });

  /* ══════════════════════════════════════════════════════════════════
     10. Delete cancelled order
     ══════════════════════════════════════════════════════════════════ */

  test("deletes the cancelled order", async ({ page, db }) => {
    await page.goto(`/sales/orders/${draftOrderId}`);
    await expect(
      page.getByRole("heading", { name: draftOrderNumber })
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");

    await filterList(page, "Search orders", draftOrderNumber);
    await expect(
      page.getByText(`No results for "${draftOrderNumber}"`)
    ).toBeVisible();

    // DB — soft deleted
    const orderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, draftOrderId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].deletedAt).not.toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     11. Fulfillment — confirm + fulfill a small order via API,
         verify stock consumed and committed released
     ══════════════════════════════════════════════════════════════════ */

  test("fulfills a confirmed order — consumes stock FIFO and releases committed", async ({
    db,
  }) => {
    // Create a small order (1× The Bomb) via API — The Bomb has stock from manufacturing
    const customerResult = await createCustomer({
      name: `Fulfill Test Customer ${run}`,
    });
    expect(customerResult.status).toBe(201);
    const fulfillCustomerId = customerResult.body.id as string;

    const orderResult = await createSalesOrder({
      customerId: fulfillCustomerId,
      status: "confirmed",
      requestedDate: null,
      notes: "Fulfillment test order",
      lines: [
        { itemId: theBombId, quantity: "1", unitPrice: "89.99" },
      ],
      confirmOversell: true,
    });
    expect(orderResult.status).toBe(201);
    const fulfillOrderId = orderResult.body.id as string;

    // Verify order is confirmed and committed qty increased
    const [confirmedOrder] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillOrderId));
    expect(confirmedOrder.status).toBe("confirmed");

    const [beforeFulfill] = await db
      .select({ committedQty: items.committedQty })
      .from(items)
      .where(eq(items.id, theBombId));
    const committedBefore = parseFloat(beforeFulfill.committedQty!);
    expect(committedBefore).toBeGreaterThanOrEqual(1);

    // Snapshot stock before fulfillment
    const bombLotsBefore = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, theBombId));
    const stockBefore = bombLotsBefore.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );

    // ── Fulfill via API ──
    const fulfillRes = await testFetch(
      `/api/sales-orders/${fulfillOrderId}/fulfill`,
      { method: "POST" }
    );
    expect(fulfillRes.status).toBe(200);

    // ── DB: order status is now "fulfilled" ──
    const [fulfilledOrder] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, fulfillOrderId));
    expect(fulfilledOrder.status).toBe("fulfilled");
    expect(fulfilledOrder.fulfilledAt).not.toBeNull();

    // ── DB: stock decreased by 1 (FIFO consumption) ──
    const bombLotsAfter = await db
      .select()
      .from(lots)
      .where(eq(lots.itemId, theBombId));
    const stockAfter = bombLotsAfter.reduce(
      (sum, lot) => sum + parseFloat(lot.quantity),
      0
    );
    expect(stockAfter).toBeCloseTo(stockBefore - 1, 2);

    // ── DB: committed qty decreased (fulfilled orders don't reserve stock) ──
    const [afterFulfill] = await db
      .select({ committedQty: items.committedQty })
      .from(items)
      .where(eq(items.id, theBombId));
    const committedAfter = parseFloat(afterFulfill.committedQty!);
    expect(committedAfter).toBeLessThan(committedBefore);

    // ── DB: stock movements created with type "sales_fulfilled" ──
    const fulfillMovements = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.referenceId, fulfillOrderId),
          eq(stockMovements.movementType, "sales_fulfilled")
        )
      );
    expect(fulfillMovements.length).toBeGreaterThanOrEqual(1);
    expect(fulfillMovements[0].referenceType).toBe("sales_order");
  });

  /* ══════════════════════════════════════════════════════════════════
     12. Referential integrity — customer/product delete blocks,
         then cleanup succeeds after guard order is removed
     ══════════════════════════════════════════════════════════════════ */

  test("referential integrity: blocks customer + product delete, then cleanup", async ({
    page,
    db,
  }) => {
    // ── Create a guard order (draft) to block customer + product deletes ──
    await page.goto("/sales/orders/new");
    await expect(page.getByText("Add Sales Order")).toBeVisible();

    const customerInput = page.getByPlaceholder("Search customers...");
    await customerInput.click();
    await customerInput.fill(rockyMtnName);
    await page
      .getByRole("option", { name: new RegExp(rockyMtnName) })
      .click();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(proBaseName);
    await page
      .getByRole("option", { name: new RegExp(proBaseName) })
      .click();
    await page.locator('input[placeholder="0"]').first().fill("1");

    await page.getByRole("button", { name: "Create Order" }).click();
    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]+$/);

    // Resolve guard order ID from DB
    const guardOrderRows = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.customerId, rockyMtnId));
    const activeOrder = guardOrderRows.find((row) => row.deletedAt == null);
    expect(activeOrder).toBeTruthy();
    guardOrderId = activeOrder!.id;

    // ── Try to delete customer — should be blocked ──
    await page.goto(`/sales/customers/${rockyMtnId}`);
    await expect(
      page.getByRole("heading", { name: rockyMtnName })
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Customer" }).click();

    await expect(page.getByText(/cannot delete|active.*order/i)).toBeVisible();

    // DB — customer still active
    const customerRows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, rockyMtnId));
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].deletedAt).toBeNull();

    // ── Try to delete product (Pro Base) — should be blocked ──
    await page.goto("/inventory/products");
    await filterList(page, "Search items", proBaseName);

    await page.getByLabel(`Select ${proBaseName}`).click();
    await page.getByRole("button", { name: "Actions (1 selected)" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/items") &&
        response.request().postData()?.includes(proBaseId) === true
    );

    await page.getByRole("button", { name: "Delete" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(400);

    // DB — product still active
    const productRows = await db
      .select()
      .from(items)
      .where(eq(items.id, proBaseId));
    expect(productRows).toHaveLength(1);
    expect(productRows[0].deletedAt).toBeNull();

    // ── Delete the guard order, then delete customer succeeds ──
    await page.goto(`/sales/orders/${guardOrderId}`);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Order" }).click();
    await page.waitForURL("**/sales/orders");

    await page.goto(`/sales/customers/${rockyMtnId}`);
    await expect(
      page.getByRole("heading", { name: rockyMtnName })
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Customer" }).click();
    await page.waitForURL("**/sales/customers");

    await filterList(page, "Search customers", rockyMtnName);
    await expect(
      page.getByText(`No results for "${rockyMtnName}"`)
    ).toBeVisible();

    // DB — customer soft-deleted
    const finalCustomerRows = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, rockyMtnId));
    expect(finalCustomerRows).toHaveLength(1);
    expect(finalCustomerRows[0].deletedAt).not.toBeNull();
  });
});
