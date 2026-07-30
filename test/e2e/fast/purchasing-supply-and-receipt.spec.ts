import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { and, eq, isNull, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  accountingDocumentSyncs,
  attachmentFiles,
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  notifications,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  unitDefinitions,
  user,
} from "../../../lib/db/schema";
import { groupPurchaseOrderByResolvedSupplier } from "../../../lib/purchasing/resolved-supplier-groups";
import {
  findOutboxEmails,
  waitForOutboxEmail,
} from "../../helpers/email-outbox";
import {
  TEST_ACCOUNT_EMAIL,
  TEST_ACCOUNT_ORG_NAME,
} from "../../helpers/test-account";
import { buildStorageState } from "../../helpers/test-env";
import {
  createItem,
  createPurchaseOrder,
  createSupplier,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  receivePurchaseOrder,
  testFetch,
} from "../../helpers/api";

const ACCOUNTING_DOCUMENT_PURCHASE_ORDER = "purchase_order";
const ACCOUNTING_PROVIDER_XERO = "xero";
const ATTACHMENT_OWNER_PURCHASE_ORDER = "purchase_order";
const FCM_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "fcm-outbox");

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

async function editGridCell(
  page: Page,
  colId: string,
  value: string,
  rowIndex = 0,
  gridIndex = 0,
) {
  const cell = editableGrid(page, gridIndex)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function selectInventoryGridItem(
  page: Page,
  rowIndex: number,
  itemName: string,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="itemId"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.getByPlaceholder("Search or create item");
  await expect(input).toBeVisible();
  await input.fill(itemName);
  await page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: itemName })
    .first()
    .click();
}

async function writeFastLocalAttachment(storageKey: string, content: string) {
  const root = process.env.LOCAL_ATTACHMENT_DIR
    ? path.resolve(process.env.LOCAL_ATTACHMENT_DIR)
    : path.join(process.cwd(), ".local-attachments");
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local attachment path.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return `local://${storageKey}`;
}

test.describe("purchasing supply and receipt heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  test("new purchase order waits for a supplier and complete material line before first autosave", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const orderNumber = `PO-DEFER-${unique}`;
    const materialName = `Fast Deferred PO Material ${unique}`;
    const material = await createItem({
      itemType: "material",
      name: materialName,
      unitDefinitionId: unitId,
      sku: `FAST-DEFER-${unique}`,
      category: `Fast Purchasing ${unique}`,
      description: null,
      defaultPurchasePrice: "3.50",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const supplier = await createSupplier({
      name: `Fast Deferred PO Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    await page.goto("/purchasing/order");
    await expect(page.getByText("New purchase order")).toBeVisible();
    // The save pill states the blocker at each stage of the create gate.
    await expect(page.getByText("Supplier is required").first()).toBeVisible();
    await page.getByLabel("Purchase order").fill(orderNumber);
    await page.waitForTimeout(1_000);

    let rows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orderNumber, orderNumber));
    expect(rows).toHaveLength(0);

    await page.getByPlaceholder("Search suppliers...").fill(supplier.body.name);
    await page
      .locator('[data-slot="combobox-item"]')
      .filter({ hasText: supplier.body.name })
      .first()
      .click();
    await expect(page.getByText("Add a material to save")).toBeVisible();
    await page.waitForTimeout(1_000);

    rows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orderNumber, orderNumber));
    expect(rows).toHaveLength(0);
    await expect(
      page.getByText("Purchase orders must have at least one material."),
    ).toHaveCount(0);

    await selectInventoryGridItem(page, 0, materialName);
    await page.waitForTimeout(1_000);

    rows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orderNumber, orderNumber));
    expect(rows).toHaveLength(0);

    await editGridCell(page, "quantityOrdered", "2");
    await editGridCell(page, "unitCost", "3.50");
    await page.waitForURL(/\/purchasing\/order\/[0-9a-f-]+$/);

    rows = await db
      .select({
        id: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        orderNumber: purchaseOrders.orderNumber,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orderNumber, orderNumber));
    expect(rows).toEqual([
      {
        id: page.url().split("/").pop(),
        supplierId: supplier.body.id,
        orderNumber,
      },
    ]);
  });

  test("card save with a stale expectedVersion returns 409 with the fresh doc and applies nothing", async ({ db }) => {
    const supplier = await createSupplier({ name: `Fast Version Gate ${ts}` });
    expect(supplier.status).toBe(201);
    const supplierId = (supplier.body as { id: string; version: number }).id;

    const basePayload = {
      name: `Fast Version Gate ${ts}`,
      code: null,
      contactName: null,
      email: null,
      phone: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      paymentTerms: null,
      notes: null,
    };

    const first = await testFetch(`/api/suppliers/${supplierId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first writer", expectedVersion: 1 }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { version: number };
    expect(firstBody.version).toBe(2);

    const stale = await testFetch(`/api/suppliers/${supplierId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale writer", expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      conflict: boolean;
      current: { notes: string | null; version: number };
    };
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first writer");
    expect(staleBody.current.version).toBe(2);

    const [row] = await db
      .select({ notes: suppliers.notes, version: suppliers.version })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    expect(row.notes).toBe("first writer");
    expect(row.version).toBe(2);
  });

  test("supplier card reload after blur keeps the pagehide autosave result visible", async ({
    page,
    db,
  }) => {
    const supplier = await createSupplier({
      name: `Fast Reload Supplier ${Date.now()}`,
      paymentTerms: "Net 10",
    });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.id as string;
    const paymentTerms = `Reload bridge ${Date.now()}`;

    await page.goto(`/purchasing/suppliers/${supplierId}`);
    const paymentTermsInput = page.getByLabel("Payment terms");
    await expect(paymentTermsInput).toBeVisible();
    await expect(paymentTermsInput).toHaveValue("Net 10");

    await paymentTermsInput.fill(paymentTerms);
    await expect(paymentTermsInput).toHaveValue(paymentTerms);
    await paymentTermsInput.blur();
    await page.reload();

    await expect(paymentTermsInput).toHaveValue(paymentTerms, {
      timeout: 15_000,
    });
    await expect
      .poll(async () => {
        const [row] = await db
          .select({ paymentTerms: suppliers.paymentTerms })
          .from(suppliers)
          .where(eq(suppliers.id, supplierId));
        return row?.paymentTerms;
      }, { timeout: 15_000 })
      .toBe(paymentTerms);
    await expect(page.getByText("Saved")).toBeVisible();
  });

  test("supplier autosave keeps scalar edits made while the first save is in flight", async ({
    page,
    db,
  }) => {
    const supplier = await createSupplier({
      name: `Fast Inflight Supplier ${Date.now()}`,
      paymentTerms: "Net 10",
      phone: "555-0100",
    });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.id as string;
    const paymentTerms = `Inflight terms ${Date.now()}`;
    const phone = `555-${randomUUID().slice(0, 4)}`;

    let delayedFirstPut = false;
    let markPutStarted: () => void = () => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    await page.route(`**/api/suppliers/${supplierId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        markPutStarted();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/purchasing/suppliers/${supplierId}`);
    const paymentTermsInput = page.getByLabel("Payment terms");
    const phoneInput = page.getByLabel("Phone");
    await expect(paymentTermsInput).toHaveValue("Net 10");
    await expect(phoneInput).toHaveValue("555-0100");

    await paymentTermsInput.fill(paymentTerms);
    await paymentTermsInput.blur();
    await putStarted;

    await phoneInput.fill(phone);
    await phoneInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(paymentTermsInput).toHaveValue(paymentTerms);
    await expect(phoneInput).toHaveValue(phone);

    const [row] = await db
      .select({ paymentTerms: suppliers.paymentTerms, phone: suppliers.phone })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    expect(row.paymentTerms).toBe(paymentTerms);
    expect(row.phone).toBe(phone);
  });

  test("supplier autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const supplier = await createSupplier({
      name: `Fast Conflict UI Supplier ${Date.now()}`,
    });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.id as string;
    const firstWriterNotes = `first writer ${randomUUID()}`;
    const staleWriterNotes = `stale writer ${randomUUID()}`;
    const resolvedNotes = `resolved writer ${randomUUID()}`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/purchasing/suppliers/${supplierId}`);
      await secondPage.goto(`/purchasing/suppliers/${supplierId}`);

      const firstNotes = secondPage.getByLabel("Notes");
      await expect(firstNotes).toHaveValue("");
      await firstNotes.fill(firstWriterNotes);
      await firstNotes.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleNotes = page.getByLabel("Notes");
      await expect(staleNotes).toHaveValue("");
      await staleNotes.fill(staleWriterNotes);
      await staleNotes.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ notes: suppliers.notes, version: suppliers.version })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      expect(afterConflict.notes).toBe(firstWriterNotes);
      expect(afterConflict.version).toBe(2);

      await staleNotes.fill(resolvedNotes);
      await staleNotes.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByLabel("Notes")).toHaveValue(resolvedNotes);

      const [afterRecovery] = await db
        .select({ notes: suppliers.notes, version: suppliers.version })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      expect(afterRecovery.notes).toBe(resolvedNotes);
      expect(afterRecovery.version).toBe(3);
    } finally {
      await secondContext.close();
    }
  });

  test("supplier create replays under the same idempotency key", async ({
    db,
  }) => {
    const name = `Fast Supplier Create Replay ${ts}`;
    const payload = {
      name,
      code: null,
      contactName: null,
      email: null,
      phone: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      paymentTerms: null,
      notes: null,
    };
    const postCreate = () =>
      testFetch("/api/suppliers", {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-supplier-create-replay:${ts}`,
        },
        body: JSON.stringify(payload),
      });

    const first = await postCreate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const rows = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.name, name));
    expect(rows).toHaveLength(1);
  });

  test("purchase order card save replays the committed result for the same idempotency key", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Replay Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-REPLAY-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Replay Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "7.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const payload = {
      orderNumber: order.body.orderNumber,
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      shippingCost: "0",
      notes: "committed once",
      accountingPurchaseAccountCode: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      expectedVersion: order.body.version,
      lines: [
        {
          id: order.body.lines[0].id,
          itemId: material.body.id,
          quantityOrdered: "5",
          unitCost: "7.00",
          taxRateId: null,
          accountingPurchaseAccountCode: null,
          shipAddressEntryId: null,
          shipContactName: null,
          shipContactPhone: null,
          shipLine1: null,
          shipLine2: null,
          shipCity: null,
          shipRegion: null,
          shipPostcode: null,
          shipCountry: null,
          shipDeliveryInstructions: null,
        },
      ],
      additionalCosts: [],
    };
    const body = JSON.stringify(payload);
    const headers = {
      "Idempotency-Key": `test:purchase-order-replay:${order.body.id}`,
    };

    const first = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body,
      headers,
    });
    expect(first.status, await first.text()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.version).toBe(order.body.version + 1);

    const replay = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body,
      headers,
    });
    expect(replay.status, await replay.text()).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.version).toBe(firstBody.version);
    expect(replayBody.notes).toBe("committed once");

    const [row] = await db
      .select({ notes: purchaseOrders.notes, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(row.notes).toBe("committed once");
    expect(row.version).toBe(firstBody.version);
  });

  test("receive dialog stays reachable on an invalid dirty persisted purchase order", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Receive Reachable Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-RECEIVE-REACH-${unique}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Receive Reachable Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "7.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    await page.goto(`/purchasing/order/${order.body.id}`);
    await page.locator('input[value^="PO-"]').first().fill(`PO-${"X".repeat(40)}`);

    await page.getByLabel("Change status: Not received").click();
    await page.getByRole("menuitem", { name: "Received", exact: true }).click();

    await expect(page.getByRole("dialog", { name: "Receive purchase order" })).toBeVisible();
  });

  test("purchase order create replays under the same idempotency key", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Create Replay Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-CREATE-REPLAY-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Create Replay Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const notes = `create PO replay ${ts}`;
    const payload = {
      supplierId: supplier.body.id,
      expectedDate: null,
      notes,
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "3.00",
        },
      ],
    };
    const postCreate = () =>
      testFetch("/api/purchase-orders", {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-po-create-replay:${ts}`,
        },
        body: JSON.stringify(payload),
      });

    const first = await postCreate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const rows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.supplierId, supplier.body.id),
          eq(purchaseOrders.notes, notes)
        )
      );
    expect(rows).toHaveLength(1);
  });

  test("purchase order duplicate replays under the same idempotency key", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Duplicate Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-DUP-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Duplicate Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const notes = `duplicate PO replay ${ts}`;
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      notes,
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "2.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const postDuplicate = () =>
      testFetch(`/api/purchase-orders/${order.body.id}/duplicate`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-po-duplicate-replay:${ts}`,
        },
        body: JSON.stringify({}),
      });

    const first = await postDuplicate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postDuplicate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const rows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.supplierId, supplier.body.id),
          eq(purchaseOrders.notes, notes)
        )
      );
    expect(rows).toHaveLength(2);
  });

  test("purchase order duplicate action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Duplicate UI Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-DUP-UI-${unique}`,
      category: `Fast Purchasing ${unique}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Duplicate UI Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "7.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `dirty duplicate notes ${unique}`;

    await page.goto(`/purchasing/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Supplier-facing notes shown");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/purchasing/order/") &&
        url.pathname !== `/purchasing/order/${orderId}`
      );
    });
    const duplicatedId = page.url().split("/").pop();
    expect(duplicatedId).toBeTruthy();
    expect(duplicatedId).not.toBe(orderId);

    const rows = await db
      .select({
        id: purchaseOrders.id,
        notes: purchaseOrders.notes,
        supplierId: purchaseOrders.supplierId,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.supplierId, supplier.body.id),
          eq(purchaseOrders.notes, notes),
        ),
      );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [orderId, duplicatedId as string].sort(),
    );

    const lines = await db
      .select({
        purchaseOrderId: purchaseOrderLines.purchaseOrderId,
        itemId: purchaseOrderLines.itemId,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.itemId, material.body.id));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purchaseOrderId: orderId,
          quantityOrdered: "4.0000",
        }),
        expect.objectContaining({
          purchaseOrderId: duplicatedId,
          quantityOrdered: "4.0000",
        }),
      ]),
    );
  });

  test("purchase order email action blocks when autosave is invalid", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Block Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-BLOCK-${unique}`,
      category: `Fast Purchasing ${unique}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({
      name: `Fast PO Email Block Supplier ${unique}`,
      email: `po-email-block-${unique}@example.com`,
    });
    expect(material.status, JSON.stringify(material.body)).toBe(201);
    expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-13",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "1",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    let emailCalls = 0;

    await page.route(`**/api/purchase-orders/${orderId}/email`, async (route) => {
      emailCalls += 1;
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "po email should be blocked" }),
      });
    });

    await page.goto(`/purchasing/order/${orderId}`);
    await page
      .locator("#purchaseOrderNumber")
      .fill(`PO-${"X".repeat(40)}-${unique}`);

    await page.getByRole("button", { name: "Send PO email" }).click();

    await expect(
      page.getByText("Purchase order number must be 32 characters or fewer").first(),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(emailCalls).toBe(0);
  });

  test("purchase order stale save returns the shared conflict envelope with the fresh order", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Conflict Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-CONFLICT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "6.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Conflict Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-07",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const basePayload = {
      orderNumber: order.body.orderNumber,
      supplierId: supplier.body.id,
      expectedDate: "2026-05-07",
      shippingCost: "0",
      notes: null,
      accountingPurchaseAccountCode: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      expectedVersion: order.body.version,
      lines: [
        {
          id: order.body.lines[0].id,
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
          taxRateId: null,
          accountingPurchaseAccountCode: null,
          shipAddressEntryId: null,
          shipContactName: null,
          shipContactPhone: null,
          shipLine1: null,
          shipLine2: null,
          shipCity: null,
          shipRegion: null,
          shipPostcode: null,
          shipCountry: null,
          shipDeliveryInstructions: null,
        },
      ],
      additionalCosts: [],
    };

    const first = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first purchase writer" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale purchase writer" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first purchase writer");
    expect(staleBody.current.version).toBe(order.body.version + 1);
    expect(staleBody.order).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [row] = await db
      .select({ notes: purchaseOrders.notes, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(row.notes).toBe("first purchase writer");
    expect(row.version).toBe(order.body.version + 1);
  });

  test("purchase order autosave keeps line edits made while the header save is in flight", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Inflight Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-INFLIGHT-${unique}`,
      category: `Fast PO Inflight ${unique}`,
      description: null,
      defaultPurchasePrice: "6.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Inflight Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `PO save in flight ${unique}`;

    let delayedFirstPut = false;
    await page.route(`**/api/purchase-orders/${orderId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/purchasing/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Supplier-facing notes shown");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);
    await notesInput.blur();

    await editGridCell(page, "quantityOrdered", "9");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantityOrdered"]').first(),
    ).toContainText("9");

    const [row] = await db
      .select({ notes: purchaseOrders.notes })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    expect(row.notes).toBe(notes);

    const [line] = await db
      .select({ quantityOrdered: purchaseOrderLines.quantityOrdered })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, order.body.lines[0].id));
    expect(line.quantityOrdered).toBe("9.0000");
  });

  test("purchase order autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Conflict UI Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-CONFLICT-UI-${unique}`,
      category: `Fast PO Conflict UI ${unique}`,
      description: null,
      defaultPurchasePrice: "6.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Conflict UI Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const firstWriterNotes = `first purchase writer ${randomUUID()}`;
    const staleWriterNotes = `stale purchase writer ${randomUUID()}`;
    const resolvedNotes = `resolved purchase writer ${randomUUID()}`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/purchasing/order/${orderId}`);
      await secondPage.goto(`/purchasing/order/${orderId}`);

      const firstNotes = secondPage.getByPlaceholder("Supplier-facing notes shown");
      await expect(firstNotes).toHaveValue("");
      await firstNotes.fill(firstWriterNotes);
      await firstNotes.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleNotes = page.getByPlaceholder("Supplier-facing notes shown");
      await expect(staleNotes).toHaveValue("");
      await staleNotes.fill(staleWriterNotes);
      await staleNotes.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ notes: purchaseOrders.notes, version: purchaseOrders.version })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, orderId));
      expect(afterConflict.notes).toBe(firstWriterNotes);
      expect(afterConflict.version).toBe(order.body.version + 1);

      await staleNotes.fill(resolvedNotes);
      await staleNotes.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByPlaceholder("Supplier-facing notes shown")).toHaveValue(
        resolvedNotes,
      );

      const [afterRecovery] = await db
        .select({ notes: purchaseOrders.notes, version: purchaseOrders.version })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, orderId));
      expect(afterRecovery.notes).toBe(resolvedNotes);
      expect(afterRecovery.version).toBe(order.body.version + 2);
    } finally {
      await secondContext.close();
    }
  });

  test("purchase order autosave preserves an unsent blank material row across header rebase", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const existingMaterial = await createItem({
      itemType: "material",
      name: `Fast PO Blank Existing Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-BLANK-EXISTING-${unique}`,
      category: `Fast PO Blank ${unique}`,
      description: null,
      defaultPurchasePrice: "6.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(existingMaterial.status).toBe(201);

    const newMaterialName = `Fast PO Blank Filled Material ${unique}`;
    const newMaterial = await createItem({
      itemType: "material",
      name: newMaterialName,
      unitDefinitionId: unitId,
      sku: `FAST-PO-BLANK-FILLED-${unique}`,
      category: `Fast PO Blank ${unique}`,
      description: null,
      defaultPurchasePrice: "9.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(newMaterial.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Blank Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: existingMaterial.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `PO blank row rebase ${unique}`;
    let delayedFirstPut = false;

    await page.route(`**/api/purchase-orders/${orderId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/purchasing/order/${orderId}`);
    await expect(
      editableGrid(page).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(1, { timeout: 15_000 });

    await page.getByRole("button", { name: "Add material" }).click();
    await expect(
      editableGrid(page).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(2, { timeout: 15_000 });

    const notesInput = page.getByPlaceholder("Supplier-facing notes shown");
    await notesInput.fill(notes);
    await notesInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      editableGrid(page).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(2);

    const savedLineRows = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
    expect(savedLineRows).toHaveLength(1);

    await selectInventoryGridItem(page, 1, newMaterialName);
    await editGridCell(page, "quantityOrdered", "3", 1);
    await editGridCell(page, "unitCost", "9.00", 1);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(2, { timeout: 15_000 });
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantityOrdered"]'),
    ).toContainText(["4", "3"]);

    const savedLineDetails = await db
      .select({
        itemId: purchaseOrderLines.itemId,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        unitCost: purchaseOrderLines.unitCost,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
    expect(savedLineDetails).toHaveLength(2);
    expect(savedLineDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: newMaterial.body.id,
          quantityOrdered: "3.0000",
          unitCost: "9.0000",
        }),
      ]),
    );
  });

  test("purchase order autosave preserves an unsent blank additional-cost row across header rebase", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Blank Cost Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-BLANK-COST-${unique}`,
      category: `Fast PO Blank Cost ${unique}`,
      description: null,
      defaultPurchasePrice: "6.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast PO Blank Cost Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "4",
          unitCost: "6.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `PO blank cost rebase ${unique}`;
    let delayedFirstPut = false;

    await page.route(`**/api/purchase-orders/${orderId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/purchasing/order/${orderId}`);
    await expect(
      editableGrid(page).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(1, { timeout: 15_000 });

    await page.getByRole("button", { name: "Additional costs" }).click();
    await expect(
      editableGrid(page, 1).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(1, { timeout: 15_000 });

    const notesInput = page.getByPlaceholder("Supplier-facing notes shown");
    await notesInput.fill(notes);
    await notesInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      editableGrid(page, 1).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(1);

    const savedBlankCostRows = await db
      .select({ id: purchaseOrderAdditionalCosts.id })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId));
    expect(savedBlankCostRows).toHaveLength(0);

    await editGridCell(page, "amount", "12.50", 0, 1);
    // The pill still reads "Saved" from the notes save during the debounce
    // window, so wait for the persisted row instead of the pill.
    await expect
      .poll(
        async () =>
          (
            await db
              .select({ id: purchaseOrderAdditionalCosts.id })
              .from(purchaseOrderAdditionalCosts)
              .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId))
          ).length,
        { timeout: 15_000 },
      )
      .toBe(1);
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page, 1).locator(".ag-center-cols-container .ag-row"),
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(
      editableGrid(page, 1).locator('.ag-row .ag-cell[col-id="amount"]'),
    ).toContainText("12.50");

    const savedCostRows = await db
      .select({
        costType: purchaseOrderAdditionalCosts.costType,
        amount: purchaseOrderAdditionalCosts.amount,
      })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId));
    expect(savedCostRows).toEqual([
      expect.objectContaining({
        costType: "shipping",
        amount: "12.5000",
      }),
    ]);
  });

  test("purchase order autosave keeps failed server-validation edits recoverable", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Validation Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-VALIDATION-${unique}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Validation Supplier ${unique}` });
    expect(supplier.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-05",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "10",
          unitCost: "4.00",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    const receipt = await receivePurchaseOrder(order.body.id, {
      lines: [{ lineId: line.id, quantityReceived: "5" }],
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);

    await page.goto(`/purchasing/order/${order.body.id}`);
    await editGridCell(page, "quantityOrdered", "4");
    await expect(
      page.getByText("Ordered quantity cannot be less than quantity already received."),
    ).toBeVisible({ timeout: 15_000 });

    const [afterFailedSave] = await db
      .select({ quantityOrdered: purchaseOrderLines.quantityOrdered })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    expect(afterFailedSave.quantityOrdered).toBe("10.0000");

    await editGridCell(page, "quantityOrdered", "6");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantityOrdered"]').first(),
    ).toContainText("6");

    const [afterRecovery] = await db
      .select({ quantityOrdered: purchaseOrderLines.quantityOrdered })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    expect(afterRecovery.quantityOrdered).toBe("6.0000");
  });

  test("purchase order create books expected supply", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Expected Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EXPECTED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast PO Supplier ${ts}` });
    expect(supplier.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-05",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "9",
          unitCost: "4.00",
        },
      ],
    });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe("not_received");

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    const [expected] = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.itemId, material.body.id),
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id)
        )
      );
    expect(expected.quantity).toBe("9.0000");

    const [testUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, TEST_ACCOUNT_EMAIL));
    const [expectedEvent] = await db
      .select({ actorUserId: inventoryEvents.actorUserId })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.eventType, "expected_increase"),
          eq(inventoryEvents.eventSubtype, "purchase_submit"),
          eq(inventoryEvents.referenceType, "purchase_order_line"),
          eq(inventoryEvents.referenceId, line.id),
        ),
      );
    expect(expectedEvent.actorUserId).toBe(testUser.id);

    const [balance] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, material.body.id));
    expect(balance.expectedQty).toBe("9.0000");
  });

  test("standard purchase order create requires a material line", async () => {
    const supplier = await createSupplier({
      name: `Fast PO Empty Standard Supplier ${ts}`,
    });
    expect(supplier.status).toBe(201);

    const response = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-05",
        lines: [],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Purchase orders must have at least one material.",
    );
  });

  test("receipt converts expected supply into physical stock", async ({ db }) => {
    await rm(FCM_OUTBOX_DIR, { recursive: true, force: true });
    await mkdir(FCM_OUTBOX_DIR, { recursive: true });
    const token = `fast-po-receipt-${ts}`;
    const pref = await testFetch("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({
        eventType: "purchase_order_received",
        enabled: true,
      }),
    });
    expect(pref.status).toBe(200);
    const deviceRes = await testFetch("/api/push-devices", {
      method: "POST",
      body: JSON.stringify({ token, platform: "android" }),
    });
    expect(deviceRes.status).toBe(200);

    const material = await createItem({
      itemType: "material",
      name: `Fast PO Receipt Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-RECEIPT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "5.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast Receipt Supplier ${ts}` });
    expect(supplier.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-06",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "7",
          unitCost: "5.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    const receiveKey = `receive-once-${ts}`;
    const receiptPayload = {
      lines: [{ lineId: line.id, quantityReceived: "7" }],
    };
    const receipt = await testFetch(`/api/purchase-orders/${order.body.id}/receive`, {
      method: "POST",
      headers: { "Idempotency-Key": receiveKey },
      body: JSON.stringify(receiptPayload),
    });
    expect(receipt.status).toBe(200);
    const replay = await testFetch(`/api/purchase-orders/${order.body.id}/receive`, {
      method: "POST",
      headers: { "Idempotency-Key": receiveKey },
      body: JSON.stringify(receiptPayload),
    });
    expect(replay.status, await replay.text()).toBe(200);

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        expectedQty: inventoryItemBalances.expectedQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, material.body.id));
    expect(balance).toMatchObject({
      onHandQty: "7.0000",
      expectedQty: "0.0000",
    });

    const [event] = await db
      .select({ eventType: inventoryEvents.eventType, quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, material.body.id),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(event).toMatchObject({
      eventType: "purchase_receipt",
      quantity: "7.0000",
    });

    const [savedOrder] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(savedOrder.status).toBe("received");

    const [testUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "test@test.com"));
    const [notification] = await db
      .select({
        id: notifications.id,
        deliveryStatus: notifications.deliveryStatus,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, order.body.id),
          eq(notifications.type, "purchase_order_received"),
          eq(notifications.userId, testUser.id)
        )
      );
    expect(notification.deliveryStatus).toBe("delivered");

    const payloads = await Promise.all(
      (await readdir(FCM_OUTBOX_DIR)).map((file) =>
        readFile(path.join(FCM_OUTBOX_DIR, file), "utf8").then(JSON.parse)
      )
    );
    const payload = payloads.find(
      (p) => p.token === token && p.data?.notificationId === notification.id
    );
    expect(payload).toBeDefined();
    expect(payload.data).toMatchObject({
      type: "purchase_order_received",
      entityType: "purchase_order",
      entityId: order.body.id,
    });

    const cleanupPref = await testFetch("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({
        eventType: "purchase_order_received",
        enabled: false,
      }),
    });
    expect(cleanupPref.status).toBe(200);
  });

  test("value and quantity costs use independent allocation bases", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const [purchaseUnit] = await db
      .insert(unitDefinitions)
      .values({
        organizationId: getOrgId(),
        name: `Fast Quantity Purchase Unit ${unique}`,
        size: "1",
        uom: "ea",
      })
      .returning({ id: unitDefinitions.id });
    const [highValueMaterial, highQuantityMaterial] = await Promise.all([
      createItem({
        itemType: "material",
        name: `Fast Quantity Cost High Value ${unique}`,
        unitDefinitionId: unitId,
        purchaseUnitDefinitionId: purchaseUnit.id,
        purchaseToStockFactor: "48",
        sku: `FAST-QTY-COST-HIGH-${unique}`,
        category: `Fast Purchasing ${unique}`,
        description: null,
        defaultPurchasePrice: "100.00",
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      }),
      createItem({
        itemType: "material",
        name: `Fast Quantity Cost High Quantity ${unique}`,
        unitDefinitionId: unitId,
        purchaseUnitDefinitionId: purchaseUnit.id,
        purchaseToStockFactor: "3072",
        sku: `FAST-QTY-COST-MANY-${unique}`,
        category: `Fast Purchasing ${unique}`,
        description: null,
        defaultPurchasePrice: "10.00",
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      }),
    ]);
    expect(highValueMaterial.status).toBe(201);
    expect(highQuantityMaterial.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast Quantity Cost Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const response = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-07-20",
        notes: null,
        lines: [
          {
            itemId: highValueMaterial.body.id,
            quantityOrdered: "2",
            unitCost: "100.00",
          },
          {
            itemId: highQuantityMaterial.body.id,
            quantityOrdered: "8",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Per-unit freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "100.00",
          },
          {
            costType: "customs",
            reference: "Value-based duty",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "70.00",
          },
          {
            costType: "other",
            reference: "Deposit",
            distributionMethod: "not_distributed",
            accountingPurchaseAccountCode: null,
            amount: "30.00",
          },
        ],
      }),
    });
    const order = await response.json();
    expect(response.status, JSON.stringify(order)).toBe(201);
    expect(order.additionalCosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          distributionMethod: "by_quantity",
          amount: "100",
        }),
        expect.objectContaining({
          distributionMethod: "by_value",
          amount: "70",
        }),
        expect.objectContaining({
          distributionMethod: "not_distributed",
          amount: "30",
        }),
      ]),
    );
    expect(order).toMatchObject({
      shippingCost: "100",
      subtotalAmount: "480",
      totalAmount: "480",
    });

    const lineByItemId = new Map(
      order.lines.map((line: { itemId: string }) => [line.itemId, line]),
    );
    expect(lineByItemId.get(highValueMaterial.body.id)).toMatchObject({
      // 20 by purchase quantity + 50 by material value.
      allocatedAdditionalCost: "70",
      landedCost: "270",
      purchaseToStockFactor: "48",
      stockQuantityOrdered: "96",
      stockUnitCost: "2.8125",
    });
    expect(lineByItemId.get(highQuantityMaterial.body.id)).toMatchObject({
      // 80 by purchase quantity + 20 by material value.
      allocatedAdditionalCost: "100",
      landedCost: "180",
      purchaseToStockFactor: "3072",
      stockQuantityOrdered: "24576",
      stockUnitCost: "0.007324",
    });
  });

  test("purchase order edit clears additional costs explicitly", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Cost Clear Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-COST-CLEAR-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast Cost Clear Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        notes: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const updateResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        shippingCost: "12.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [],
      }),
    });
    const updateText = await updateResponse.text();
    expect(updateResponse.status, updateText).toBe(200);
    const updated = JSON.parse(updateText);
    expect(updated.lines).toHaveLength(1);
    expect(updated.additionalCosts).toEqual([]);
    expect(updated.shippingCost).toBe("0");
    expect(updated.totalAmount).toBe("10");

    const costs = await db
      .select({ id: purchaseOrderAdditionalCosts.id })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, order.id));
    expect(costs).toHaveLength(0);

    const [savedOrder] = await db
      .select({
        shippingCost: purchaseOrders.shippingCost,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(savedOrder).toMatchObject({
      shippingCost: "0.0000",
      totalAmount: "10.0000",
    });
  });

  test("additional cost with a supplier is validated, not silently dropped", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Cost Supplier Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-COST-SUP-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({ name: `Fast Cost Sup Main ${ts}` });
    expect(supplier.status).toBe(201);
    const freightSupplier = await createSupplier({
      name: `Fast Cost Sup Freight ${ts}`,
    });
    expect(freightSupplier.status).toBe(201);

    const lines = [
      { itemId: material.body.id, quantityOrdered: "1", unitCost: "10.00" },
    ];
    const supplierOnlyCost = {
      costType: "shipping",
      reference: null,
      distributionMethod: "by_value",
      accountingPurchaseAccountCode: null,
      amount: "",
      supplierId: freightSupplier.body.id,
    };

    const rejectedResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        notes: null,
        lines,
        additionalCosts: [supplierOnlyCost],
      }),
    });
    const rejectedText = await rejectedResponse.text();
    expect(rejectedResponse.status, rejectedText).toBe(400);
    expect(rejectedText).toContain("Amount is required");

    const createdResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-07",
        notes: null,
        lines,
        additionalCosts: [{ ...supplierOnlyCost, amount: "25.00" }],
      }),
    });
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);

    const costs = await db
      .select({ supplierId: purchaseOrderAdditionalCosts.supplierId })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, created.id));
    expect(costs).toEqual([{ supplierId: freightSupplier.body.id }]);
  });

  test("accounting re-import preserves local additional-cost assignments", async ({
    db,
  }) => {
    const mainName = `Fast Import Main ${ts}-${randomUUID().slice(0, 6)}`;
    const freightName = `Fast Import Freight ${ts}-${randomUUID().slice(0, 6)}`;
    const materialName = `Fast Import Material ${ts}-${randomUUID().slice(0, 6)}`;
    const mainSupplier = await createSupplier({ name: mainName });
    expect(mainSupplier.status).toBe(201);
    const freightSupplier = await createSupplier({ name: freightName });
    expect(freightSupplier.status).toBe(201);
    const material = await createItem({
      itemType: "material",
      name: materialName,
      unitDefinitionId: unitId,
      sku: `FAST-PO-IMPORT-${ts}-${randomUUID().slice(0, 6)}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: mainSupplier.body.id,
        expectedDate: "2026-07-20",
        notes: null,
        lines: [
          { itemId: material.body.id, quantityOrdered: "2", unitCost: "10.00" },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
            supplierId: freightSupplier.body.id,
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status, JSON.stringify(order)).toBe(201);

    const document = {
      id: `fast-ext-${order.id}`,
      number: order.orderNumber,
      status: "AUTHORISED",
      supplierContactId: null,
      supplierName: mainName,
      date: "2026-07-01",
      deliveryDate: null,
      deliveryAddress: null,
      total: null,
      updatedAt: null,
      lines: [
        {
          lineItemID: "line-1",
          itemCode: null,
          description: materialName,
          quantity: 2,
          unitAmount: 10,
          accountCode: null,
          taxType: null,
        },
        {
          lineItemID: "line-2",
          itemCode: null,
          description: "Freight",
          quantity: 1,
          unitAmount: 50,
          accountCode: null,
          taxType: null,
        },
      ],
    };
    const runImport = (importDocument: unknown) =>
      execFileSync(
        "npx",
        [
          "tsx",
          "--tsconfig",
          "test/helpers/tsconfig.accounting-import.json",
          "test/helpers/accounting-import-harness.ts",
          JSON.stringify({ orgId: getOrgId(), document: importDocument }),
        ],
        {
          encoding: "utf8",
          timeout: 60_000,
          // The fast lane runs under --conditions react-server; the harness
          // needs full React and stubs server-only via its tsconfig instead.
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      );

    // Re-import with the same charge line: the assignment survives.
    const firstRun = runImport(document);
    expect(firstRun, firstRun).toContain('"updated":1');
    const costRows = () =>
      db
        .select({
          supplierId: purchaseOrderAdditionalCosts.supplierId,
          distributionMethod: purchaseOrderAdditionalCosts.distributionMethod,
          amount: purchaseOrderAdditionalCosts.amount,
        })
        .from(purchaseOrderAdditionalCosts)
        .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, order.id));
    expect(await costRows()).toEqual([
      expect.objectContaining({
        supplierId: freightSupplier.body.id,
        distributionMethod: "by_quantity",
        amount: "50.0000",
      }),
    ]);

    // Amount edited in the provider: the lone same-type pair still carries.
    const editedDocument = {
      ...document,
      lines: [document.lines[0], { ...document.lines[1], unitAmount: 60 }],
    };
    const secondRun = runImport(editedDocument);
    expect(secondRun, secondRun).toContain('"updated":1');
    expect(await costRows()).toEqual([
      expect.objectContaining({
        supplierId: freightSupplier.body.id,
        distributionMethod: "by_quantity",
        amount: "60.0000",
      }),
    ]);

    await db.insert(purchaseOrderAdditionalCosts).values({
      organizationId: getOrgId(),
      purchaseOrderId: order.id,
      supplierId: mainSupplier.body.id,
      costType: "shipping",
      reference: "Freight",
      distributionMethod: "by_value",
      amount: "60.00",
    });
    const ambiguousExactRun = runImport(editedDocument);
    expect(ambiguousExactRun, ambiguousExactRun).toContain('"updated":1');
    expect(await costRows()).toEqual([
      expect.objectContaining({
        supplierId: null,
        distributionMethod: "by_value",
        amount: "60.0000",
      }),
    ]);

    await db
      .update(purchaseOrderAdditionalCosts)
      .set({ supplierId: freightSupplier.body.id })
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, order.id));
    await db.insert(purchaseOrderAdditionalCosts).values({
      organizationId: getOrgId(),
      purchaseOrderId: order.id,
      supplierId: null,
      costType: "shipping",
      reference: "Handling",
      distributionMethod: "by_value",
      amount: "75.00",
    });
    const ambiguousFallbackDocument = {
      ...document,
      lines: [document.lines[0], { ...document.lines[1], unitAmount: 70 }],
    };
    const ambiguousFallbackRun = runImport(ambiguousFallbackDocument);
    expect(ambiguousFallbackRun, ambiguousFallbackRun).toContain('"updated":1');
    expect(await costRows()).toEqual([
      expect.objectContaining({
        supplierId: null,
        distributionMethod: "by_value",
        amount: "70.0000",
      }),
    ]);
  });

  test("quantity-distributed freight edit revalues landed cost via append-only event", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Reval Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-REVAL-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const itemId = material.body.id as string;

    const supplier = await createSupplier({ name: `Fast Reval Supplier ${ts}` });
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        notes: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "20.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    expect(
      (await receivePurchaseOrder(order.id, {
        lines: [{ lineId: line.id, quantityReceived: "10" }],
      })).status
    ).toBe(200);

    const [receipt] = await db
      .select({
        id: inventoryEvents.id,
        lotId: inventoryEvents.lotId,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "purchase_receipt")
        )
      );
    expect(receipt.unitCost).toBe("12.000000");

    const editResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(editResponse.status, await editResponse.text()).toBe(200);

    const [editedOrder] = await db
      .select({ status: purchaseOrders.status, receivedAt: purchaseOrders.receivedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(editedOrder.status).toBe("received");
    expect(editedOrder.receivedAt).not.toBeNull();

    const expectedRows = await db
      .select({ referenceId: inventoryExpectedSummary.referenceId })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id),
        ),
      );
    expect(expectedRows).toHaveLength(0);

    const impossibleQuantityEditResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "9", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(impossibleQuantityEditResponse.status, await impossibleQuantityEditResponse.text()).toBe(400);

    const [reval] = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
        lotId: inventoryEvents.lotId,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        metadata: inventoryEvents.metadata,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      );
    expect(reval).toMatchObject({
      quantity: "0.0000",
      unitCost: "15.000000",
      extendedCost: "30.000000",
      lotId: receipt.lotId,
      referenceType: "purchase_order",
      referenceId: order.id,
      metadata: expect.objectContaining({
        allocationBasis: "by_quantity",
      }),
    });

    const [lot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, receipt.lotId!));
    expect(lot.unitCost).toBe("15.000000");

    const [item] = await db
      .select({ currentStockUnitCost: items.currentStockUnitCost })
      .from(items)
      .where(eq(items.id, itemId));
    expect(item.currentStockUnitCost).toBe("15.000000");

    const [receiptAfter] = await db
      .select({
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.id, receipt.id));
    expect(receiptAfter).toMatchObject({
      unitCost: receipt.unitCost,
      extendedCost: receipt.extendedCost,
    });

    // Base price 10 -> 11 with freight 50 => landed unit cost 16.
    const priceEditResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-20",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [{ itemId, quantityOrdered: "10", unitCost: "11.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(priceEditResponse.status, await priceEditResponse.text()).toBe(200);

    const [lineAfterPriceEdit] = await db
      .select({
        unitCost: purchaseOrderLines.unitCost,
        stockUnitCost: purchaseOrderLines.stockUnitCost,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    expect(Number(lineAfterPriceEdit.unitCost)).toBe(11);
    expect(Number(lineAfterPriceEdit.stockUnitCost)).toBe(16);

    const [lotAfterPriceEdit] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, receipt.lotId!));
    expect(lotAfterPriceEdit.unitCost).toBe("16.000000");

    const [itemAfterPriceEdit] = await db
      .select({ currentStockUnitCost: items.currentStockUnitCost })
      .from(items)
      .where(eq(items.id, itemId));
    expect(itemAfterPriceEdit.currentStockUnitCost).toBe("16.000000");
  });

  test("quantity allocation revalues an earlier receipt when over-receipt expands the order", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast Quantity Over Receipt Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-QTY-OVER-${unique}`,
      category: `Fast Purchasing ${unique}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const itemId = material.body.id as string;

    const supplier = await createSupplier({
      name: `Fast Quantity Over Receipt Supplier ${unique}`,
    });
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-07-20",
        notes: null,
        lines: [{ itemId, quantityOrdered: "2", unitCost: "10.00" }],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_quantity",
            accountingPurchaseAccountCode: null,
            amount: "20.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status, JSON.stringify(order)).toBe(201);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    const firstReceipt = await receivePurchaseOrder(order.id, {
      lines: [{ lineId: line.id, quantityReceived: "1" }],
    });
    expect(firstReceipt.status, JSON.stringify(firstReceipt.body)).toBe(200);
    expect(firstReceipt.body.status).toBe("partial");

    const overReceipt = await receivePurchaseOrder(order.id, {
      confirmOverReceipt: true,
      lines: [{ lineId: line.id, quantityReceived: "2" }],
    });
    expect(overReceipt.status, JSON.stringify(overReceipt.body)).toBe(200);
    expect(overReceipt.body.status).toBe("received");

    const [updatedLine] = await db
      .select({
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        stockUnitCost: purchaseOrderLines.stockUnitCost,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, line.id));
    expect(updatedLine).toMatchObject({
      quantityOrdered: "3.0000",
      quantityReceived: "3.0000",
      stockUnitCost: "16.666667",
    });

    const events = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
        lotId: inventoryEvents.lotId,
        metadata: inventoryEvents.metadata,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.referenceType, "purchase_order"),
          eq(inventoryEvents.referenceId, order.id),
        ),
      );
    const revaluation = events.find(
      (event) => event.eventType === "landed_cost_revaluation",
    );
    expect(revaluation).toMatchObject({
      quantity: "0.0000",
      unitCost: "16.666667",
      extendedCost: "-3.333333",
      metadata: expect.objectContaining({
        allocationBasis: "by_quantity",
        previousUnitCost: "20",
        newUnitCost: "16.666667",
        revaluedQuantity: "1",
      }),
    });

    const receiptCosts = events
      .filter((event) => event.eventType === "purchase_receipt")
      .map((event) => ({
        quantity: event.quantity,
        unitCost: event.unitCost,
      }));
    expect(receiptCosts).toEqual(
      expect.arrayContaining([
        { quantity: "1.0000", unitCost: "20.000000" },
        { quantity: "2.0000", unitCost: "16.666667" },
      ]),
    );

    const [firstReceiptLot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, revaluation!.lotId!));
    expect(firstReceiptLot.unitCost).toBe("16.666667");
  });

  test("freight edit after receipt revalues only remaining available stock", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast Freight Quality Block Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-FREIGHT-QUALITY-BLOCK-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);

    const supplier = await createSupplier({
      name: `Fast Freight Quality Supplier ${ts}`,
    });
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-21",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "10",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.body.id));
    expect(
      (await receivePurchaseOrder(order.body.id, {
        lines: [{ lineId: line.id, quantityReceived: "10" }],
      })).status
    ).toBe(200);

    const [lot] = await db
      .select({ lotId: inventoryLotBalances.lotId })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, material.body.id));

    const block = await testFetch(
      `/api/items/${material.body.id}/lots/${lot.lotId}/disposition`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "block",
          fromDisposition: "available",
          quantity: "2",
          notes: null,
        }),
      }
    );
    expect(block.status, await block.text()).toBe(200);

    const edit = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-21",
        shippingCost: "50.00",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "10",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "50.00",
          },
        ],
      }),
    });
    expect(edit.status, await edit.text()).toBe(200);

    const [reval] = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        extendedCost: inventoryEvents.extendedCost,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, material.body.id),
          eq(inventoryEvents.eventType, "landed_cost_revaluation")
        )
      );
    expect(reval).toMatchObject({
      quantity: "0.0000",
      unitCost: "15.000000",
      extendedCost: "40.000000",
      lotId: lot.lotId,
    });

    const balances = await db
      .select({
        disposition: inventoryLotBalances.disposition,
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.lotId, lot.lotId));
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "available",
          quantity: "8.0000",
          unitCost: "15.000000",
        }),
        expect.objectContaining({
          disposition: "blocked",
          quantity: "2.0000",
          unitCost: "10.000000",
        }),
      ])
    );
  });

  test("resolved supplier grouping collapses supplier overrides and splits supplier costs", async () => {
    const groups = groupPurchaseOrderByResolvedSupplier({
      purchaseOrderSupplier: {
        id: "supplier-a",
        name: "Supplier A",
      },
      suppliersById: new Map([
        ["carrier-a", { id: "carrier-a", name: "Carrier A" }],
        ["carrier-b", { id: "carrier-b", name: "Carrier B" }],
      ]),
      lines: [{ id: "line-1" }],
      additionalCosts: [
        { id: "cost-supplier", supplierId: "supplier-a" },
        { id: "cost-carrier-a", supplierId: "carrier-a" },
        { id: "cost-carrier-b", supplierId: "carrier-b" },
      ],
    });

    expect(groups).toMatchObject([
      {
        key: "supplier:supplier-a",
        isPurchaseOrderSupplier: true,
        lines: [{ id: "line-1" }],
        additionalCosts: [{ id: "cost-supplier" }],
      },
      {
        key: "additional-cost:carrier-a",
        isPurchaseOrderSupplier: false,
        lines: [],
        additionalCosts: [{ id: "cost-carrier-a" }],
      },
      {
        key: "additional-cost:carrier-b",
        isPurchaseOrderSupplier: false,
        lines: [],
        additionalCosts: [{ id: "cost-carrier-b" }],
      },
    ]);
  });

  test("additional-cost purchase orders reconcile to current supplier cost groups", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const supplier = await createSupplier({ name: `Fast Freight Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Carrier ${ts}` });
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const firstFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const firstFreightBody = await firstFreightResponse.json();
    expect(firstFreightResponse.status).toBe(200);
    expect(firstFreightBody.additionalCostPurchaseOrders).toHaveLength(1);
    const freightOrderId = firstFreightBody.additionalCostPurchaseOrders[0].id;
    const [freightOrder] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(freightOrder.status).toBe("not_received");

    const freightLines = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, freightOrderId));
    expect(freightLines).toHaveLength(0);

    const freightExpectedRows = await db
      .select({ referenceId: inventoryExpectedSummary.referenceId })
      .from(inventoryExpectedSummary)
      .innerJoin(
        purchaseOrderLines,
        eq(inventoryExpectedSummary.referenceId, purchaseOrderLines.id),
      )
      .where(eq(purchaseOrderLines.purchaseOrderId, freightOrderId));
    expect(freightExpectedRows).toHaveLength(0);

    const updateResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "18.00",
          },
        ],
      }),
    });
    expect(updateResponse.status, await updateResponse.text()).toBe(200);

    const secondFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const secondFreightBody = await secondFreightResponse.json();
    expect(secondFreightResponse.status).toBe(200);
    expect(secondFreightBody.additionalCostPurchaseOrders[0].id).toBe(freightOrderId);

    const [updatedFreight] = await db
      .select({
        shippingCost: purchaseOrders.shippingCost,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(updatedFreight).toMatchObject({
      shippingCost: "18.0000",
      totalAmount: "18.0000",
    });

    const clearResponse = await testFetch(`/api/purchase-orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-08",
        notes: null,
        accountingPurchaseAccountCode: null,
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [],
      }),
    });
    expect(clearResponse.status, await clearResponse.text()).toBe(200);
    const clearedFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const clearedFreightBody = await clearedFreightResponse.json();
    expect(clearedFreightResponse.status).toBe(200);
    expect(clearedFreightBody.additionalCostPurchaseOrders).toHaveLength(0);

    const [deletedFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(deletedFreight.deletedAt).not.toBeNull();
  });

  test("supplier delete is blocked while used as an active supplier override", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Carrier Delete Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-CARRIER-DELETE-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({
      name: `Fast Carrier Delete Supplier ${ts}`,
    });
    const carrier = await createSupplier({
      name: `Fast Carrier Delete Carrier ${ts}`,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-14",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    expect(createResponse.status, await createResponse.text()).toBe(201);

    const deleteResponse = await testFetch(`/api/suppliers/${carrier.body.id}`, {
      method: "DELETE",
    });
    const body = await deleteResponse.json();
    expect(deleteResponse.status).toBe(400);
    expect(body.error).toBe(
      "Cannot delete supplier used as a supplier on active not received or partially received purchase orders.",
    );
  });

  test("additional-cost purchase orders are not created from terminal parent orders", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Terminal Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-TERM-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Terminal Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Terminal Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createOrderWithFreight = async () => {
      const response = await testFetch("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.body.id,
          expectedDate: "2026-05-10",
          lines: [
            {
              itemId: material.body.id,
              quantityOrdered: "1",
              unitCost: "10.00",
            },
          ],
          additionalCosts: [
            {
              costType: "shipping",
              reference: "Freight",
              supplierId: carrier.body.id,
              distributionMethod: "by_value",
              accountingPurchaseAccountCode: null,
              amount: "12.00",
            },
          ],
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(201);
      return body;
    };

    const deletedOrder = await createOrderWithFreight();
    const deleteResponse = await testFetch(
      `/api/purchase-orders/${deletedOrder.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    const deletedFreightResponse = await testFetch(
      `/api/purchase-orders/${deletedOrder.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(deletedFreightResponse.status).toBe(404);

    const receivedOrder = await createOrderWithFreight();
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, receivedOrder.id));
    const receipt = await receivePurchaseOrder(receivedOrder.id, {
      lines: [{ lineId: line.id, quantityReceived: "1" }],
    });
    expect(receipt.status).toBe(200);
    const receivedFreightResponse = await testFetch(
      `/api/purchase-orders/${receivedOrder.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(receivedFreightResponse.status).toBe(404);
  });

  test("linked additional-cost purchase orders follow parent delete", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Child Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-CHILD-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Child Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Freight Child Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createOrderWithFreight = async () => {
      const createResponse = await testFetch("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.body.id,
          expectedDate: "2026-05-11",
          lines: [
            {
              itemId: material.body.id,
              quantityOrdered: "1",
              unitCost: "10.00",
            },
          ],
          additionalCosts: [
            {
              costType: "shipping",
              reference: "Freight",
              supplierId: carrier.body.id,
              distributionMethod: "by_value",
              accountingPurchaseAccountCode: null,
              amount: "12.00",
            },
          ],
        }),
      });
      const order = await createResponse.json();
      expect(createResponse.status).toBe(201);
      const freightResponse = await testFetch(
        `/api/purchase-orders/${order.id}/additional-cost-pos`,
        { method: "POST" },
      );
      const freightBody = await freightResponse.json();
      expect(freightResponse.status).toBe(200);
      return {
        orderId: order.id as string,
        freightOrderId: freightBody.additionalCostPurchaseOrders[0].id as string,
      };
    };

    const deleted = await createOrderWithFreight();
    const childDeleteResponse = await testFetch(
      `/api/purchase-orders/${deleted.freightOrderId}`,
      { method: "DELETE" },
    );
    expect(childDeleteResponse.status).toBe(404);
    const [activeFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, deleted.freightOrderId));
    expect(activeFreight.deletedAt).toBeNull();

    const deleteResponse = await testFetch(
      `/api/purchase-orders/${deleted.orderId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    const [deletedFreight] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, deleted.freightOrderId));
    expect(deletedFreight.deletedAt).not.toBeNull();
  });

  test("additional-cost purchase orders keep ordered timestamp when reconciled", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight Ordered Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-ORDERED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight Ordered Supplier ${ts}` });
    const carrier = await createSupplier({ name: `Fast Freight Ordered Carrier ${ts}` });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);
    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-12",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const firstFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    const firstFreightBody = await firstFreightResponse.json();
    expect(firstFreightResponse.status).toBe(200);
    const freightOrderId = firstFreightBody.additionalCostPurchaseOrders[0].id as string;
    const [firstFreight] = await db
      .select({ orderedAt: purchaseOrders.orderedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(firstFreight.orderedAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondFreightResponse = await testFetch(
      `/api/purchase-orders/${order.id}/additional-cost-pos`,
      { method: "POST" },
    );
    expect(secondFreightResponse.status).toBe(200);
    const [secondFreight] = await db
      .select({ orderedAt: purchaseOrders.orderedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, freightOrderId));
    expect(secondFreight.orderedAt?.getTime()).toBe(
      firstFreight.orderedAt?.getTime(),
    );
  });

  test("purchase order email retry skips groups already marked sent", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Retry Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-RETRY-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-${ts}@example.com`;
    const carrierEmail = `carrier-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Retry Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Retry Carrier ${ts}`,
      email: carrierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);
    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-13",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const supplierGroupKey = `supplier:${supplier.body.id}`;
    const carrierGroupKey = `additional-cost:${carrier.body.id}`;
    await db.insert(accountingDocumentSyncs).values({
      organizationId: getOrgId(),
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
      documentId: order.id,
      groupKey: supplierGroupKey,
      emailStatus: "sent",
      emailedAt: new Date(),
    });

    const retryResponse = await testFetch(
      `/api/purchase-orders/${order.id}/email`,
      {
        method: "POST",
        body: JSON.stringify({
          groups: [
            {
              groupKey: supplierGroupKey,
              include: true,
              to: supplierEmail,
              replyTo: "buyer@example.com",
              bcc: null,
              subject: "Supplier copy",
              message: "Supplier copy",
            },
            {
              groupKey: carrierGroupKey,
              include: true,
              to: carrierEmail,
              replyTo: "buyer@example.com",
              bcc: null,
              subject: "Carrier copy",
              message: "Carrier copy",
            },
          ],
        }),
      },
    );
    const retryBody = await retryResponse.json();
    expect(retryResponse.status, JSON.stringify(retryBody)).toBe(200);
    expect(retryBody.sent).toEqual([
      { groupKey: carrierGroupKey, recipientEmail: carrierEmail },
    ]);
  });

  test("purchase order email allows excluded supplier groups without an email", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Excluded Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-EXCLUDED-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-excluded-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Excluded Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Excluded Carrier ${ts}`,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-15",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
          },
          {
            groupKey: `additional-cost:${carrier.body.id}`,
            include: false,
            to: "",
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "",
            message: "",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.sent).toEqual([
      { groupKey: `supplier:${supplier.body.id}`, recipientEmail: supplierEmail },
    ]);
  });

  test("purchase order email keeps same-supplier additional costs on the supplier copy", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Same Supplier Email Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-SAME-SUPPLIER-EMAIL-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `same-supplier-po-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Same Supplier ${ts}`,
      email: supplierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-15",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "other",
            reference: "Handling",
            supplierId: null,
            distributionMethod: "not_distributed",
            accountingPurchaseAccountCode: null,
            amount: "40.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const since = Date.now();
    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.sent).toEqual([
      { groupKey: `supplier:${supplier.body.id}`, recipientEmail: supplierEmail },
    ]);

    const [savedOrder] = await db
      .select({ totalAmount: purchaseOrders.totalAmount })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    expect(savedOrder.totalAmount).toBe("50.0000");

    const emailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const pdfNames =
      emailEntry.attachments
        ?.filter((file) => file.filename.endsWith(".pdf"))
        .map((file) => file.filename) ?? [];
    expect(pdfNames).toHaveLength(1);
    expect(pdfNames.some((name) => name.includes("Supplier"))).toBe(false);
  });

  test("purchase order email rejects deleted purchase orders", async () => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Deleted Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-DELETE-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `deleted-po-email-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Deleted Supplier ${ts}`,
      email: supplierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);

    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-17",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "1",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const deleteResponse = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const response = await testFetch(`/api/purchase-orders/${order.body.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            subject: "Deleted PO",
            message: "Should not send",
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Purchase order not found.");
  });

  test("purchase order email sends selected attachments per supplier group", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Email Attachments Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-EMAIL-ATTACH-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplierEmail = `supplier-attachments-${ts}@example.com`;
    const carrierEmail = `carrier-attachments-${ts}@example.com`;
    const supplier = await createSupplier({
      name: `Fast PO Email Attachments Supplier ${ts}`,
      email: supplierEmail,
    });
    const carrier = await createSupplier({
      name: `Fast PO Email Attachments Carrier ${ts}`,
      email: carrierEmail,
    });
    expect(material.status).toBe(201);
    expect(supplier.status).toBe(201);
    expect(carrier.status).toBe(201);

    const createResponse = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: supplier.body.id,
        expectedDate: "2026-05-16",
        lines: [
          {
            itemId: material.body.id,
            quantityOrdered: "1",
            unitCost: "10.00",
          },
        ],
        additionalCosts: [
          {
            costType: "shipping",
            reference: "Freight",
            supplierId: carrier.body.id,
            distributionMethod: "by_value",
            accountingPurchaseAccountCode: null,
            amount: "12.00",
          },
        ],
      }),
    });
    const order = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const supplierStorageKey = `fast-po-email/${randomUUID()}-supplier-note.txt`;
    const carrierStorageKey = `fast-po-email/${randomUUID()}-carrier-note.txt`;
    const supplierBlobUrl = await writeFastLocalAttachment(
      supplierStorageKey,
      "Supplier note",
    );
    const carrierBlobUrl = await writeFastLocalAttachment(
      carrierStorageKey,
      "Carrier note",
    );
    const [supplierAttachment, carrierAttachment] = await db
      .insert(attachmentFiles)
      .values([
        {
          organizationId: getOrgId(),
          ownerType: ATTACHMENT_OWNER_PURCHASE_ORDER,
          ownerId: order.id,
          storageKey: supplierStorageKey,
          blobUrl: supplierBlobUrl,
          filename: "supplier-note.txt",
          contentType: "text/plain",
          sizeBytes: "Supplier note".length,
          uploadedByUserId: "test-user",
          uploadedByName: "Test User",
        },
        {
          organizationId: getOrgId(),
          ownerType: ATTACHMENT_OWNER_PURCHASE_ORDER,
          ownerId: order.id,
          storageKey: carrierStorageKey,
          blobUrl: carrierBlobUrl,
          filename: "carrier-note.txt",
          contentType: "text/plain",
          sizeBytes: "Carrier note".length,
          uploadedByUserId: "test-user",
          uploadedByName: "Test User",
        },
      ])
      .returning({ id: attachmentFiles.id });

    const since = Date.now();
    const response = await testFetch(`/api/purchase-orders/${order.id}/email`, {
      method: "POST",
      body: JSON.stringify({
        groups: [
          {
            groupKey: `supplier:${supplier.body.id}`,
            include: true,
            to: supplierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Supplier copy",
            message: "Supplier copy",
            attachmentFileIds: [supplierAttachment.id],
          },
          {
            groupKey: `additional-cost:${carrier.body.id}`,
            include: true,
            to: carrierEmail,
            replyTo: "buyer@example.com",
            bcc: null,
            subject: "Carrier copy",
            message: "Carrier copy",
            attachmentFileIds: [carrierAttachment.id],
          },
        ],
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);

    const [submittedOrder] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.id));
    const [line] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    const [expected] = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.itemId, material.body.id),
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, line.id),
        ),
      );
    expect(submittedOrder.status).toBe("not_received");
    expect(expected.quantity).toBe("1.0000");

    const supplierEmailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const carrierEmailEntry = await waitForOutboxEmail({
      since,
      tag: "purchase-order",
      to: carrierEmail,
    });
    const supplierEmailEntries = await findOutboxEmails({
      since,
      tag: "purchase-order",
      to: supplierEmail,
    });
    const carrierEmailEntries = await findOutboxEmails({
      since,
      tag: "purchase-order",
      to: carrierEmail,
    });
    const supplierAttachmentNames =
      supplierEmailEntry.attachments?.map((file) => file.filename) ?? [];
    const carrierAttachmentNames =
      carrierEmailEntry.attachments?.map((file) => file.filename) ?? [];

    const escapedOrgName = TEST_ACCOUNT_ORG_NAME.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    expect(supplierEmailEntry.from).toEqual(
      expect.stringMatching(new RegExp(`^"${escapedOrgName}" <[^>]+>$`)),
    );
    expect(carrierEmailEntry.from).toBe(supplierEmailEntry.from);
    expect(supplierEmailEntry.bcc).toBeUndefined();
    expect(carrierEmailEntry.bcc).toBeUndefined();
    expect(supplierEmailEntries).toHaveLength(1);
    expect(carrierEmailEntries).toHaveLength(1);
    expect(supplierAttachmentNames).toContain("supplier-note.txt");
    expect(supplierAttachmentNames).not.toContain("carrier-note.txt");
    expect(supplierAttachmentNames.some((name) => name.includes("Carrier"))).toBe(false);
    expect(carrierAttachmentNames).toContain("carrier-note.txt");
    expect(carrierAttachmentNames).not.toContain("supplier-note.txt");
    expect(carrierAttachmentNames.some((name) => name.includes("Carrier"))).toBe(true);
    expect(supplierAttachmentNames.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
    expect(carrierAttachmentNames.filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
  });

  test("additional-cost links and supplier overrides cannot cross organization boundaries", async ({ db }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast PO Freight RLS Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-PO-FREIGHT-RLS-${ts}`,
      category: `Fast Purchasing ${ts}`,
      description: null,
      defaultPurchasePrice: "10.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const supplier = await createSupplier({ name: `Fast Freight RLS Supplier ${ts}` });
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      expectedDate: "2026-05-09",
      lines: [
        {
          itemId: material.body.id,
          quantityOrdered: "1",
          unitCost: "10.00",
        },
      ],
    });
    expect(order.status).toBe(201);

    const otherOrgId = `${getOrgId()}-other`;
    const otherSupplierId = randomUUID();
    const otherParentId = randomUUID();
    const otherParentNumber = `OTHER-${ts}`.slice(0, 32);
    await db.execute(sql`
      WITH org_context AS (
        SELECT set_config('app.current_org_id', ${otherOrgId}, true)
      )
      INSERT INTO purchasing.suppliers (id, organization_id, name)
      SELECT ${otherSupplierId}, ${otherOrgId}, ${`Other Org Carrier ${ts}`}
      FROM org_context
    `);
    await db.execute(sql`
      WITH org_context AS (
        SELECT set_config('app.current_org_id', ${otherOrgId}, true)
      )
      INSERT INTO purchasing.purchase_orders (
        id,
        organization_id,
        order_number,
        supplier_id,
        supplier_name
      )
      SELECT
        ${otherParentId},
        ${otherOrgId},
        ${otherParentNumber},
        ${otherSupplierId},
        ${`Other Org Carrier ${ts}`}
      FROM org_context
    `);

    await expect(
      (async () => {
        await db.insert(purchaseOrderAdditionalCosts).values({
          organizationId: getOrgId(),
          purchaseOrderId: order.body.id,
          supplierId: otherSupplierId,
          costType: "shipping",
          reference: "Cross-org carrier",
          distributionMethod: "by_value",
          amount: "1.00",
        });
      })(),
    ).rejects.toThrow();

    await expect(
      (async () => {
        await db.insert(purchaseOrders).values({
          organizationId: getOrgId(),
          orderNumber: `BAD-F-${ts}`.slice(0, 32),
          parentPurchaseOrderId: otherParentId,
          type: "additional_cost",
          supplierId: supplier.body.id,
          supplierName: supplier.body.name,
        });
      })(),
    ).rejects.toThrow();

    const currentOrgFreightRows = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.parentPurchaseOrderId, otherParentId),
          eq(purchaseOrders.type, "additional_cost"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    expect(currentOrgFreightRows).toHaveLength(0);
  });

  test("deleting a received PO caps reversal at its receipt and preserves consumed history", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const orgId = getOrgId();
    const supplier = await createSupplier({ name: `Fast Delete Supplier ${unique}` });
    expect(supplier.status).toBe(201);
    const material = await createItem({
      itemType: "material",
      name: `Fast Delete Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-DEL-${unique}`,
      category: `Fast Delete ${ts}`,
      description: null,
      defaultPurchasePrice: "5.00",
      defaultSellingPrice: null,
      lotTrackingMode: "tracked",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const order = await createPurchaseOrder({
      supplierId: supplier.body.id,
      lines: [{ itemId: material.body.id, quantityOrdered: "10", unitCost: "5" }],
    });
    expect(order.status).toBe(201);
    const received = await receivePurchaseOrder(order.body.id, {
      lines: [{ lineId: order.body.lines[0].id, quantityReceived: "10" }],
    });
    expect(received.status).toBe(200);

    // Consume part of the receipt lot, then delete the order.
    const lotsRes = await testFetch(`/api/items/${material.body.id}/lots`);
    const lots = (await lotsRes.json()) as Array<{ id: string; quantity: string }>;
    expect(lots).toHaveLength(1);
    const adjusted = await testFetch(`/api/items/${material.body.id}/stock-adjustments`, {
      method: "POST",
      body: JSON.stringify({
        reason: "data_correction",
        lots: [{ lotId: lots[0].id, newQuantity: "6" }],
      }),
    });
    expect(adjusted.ok).toBeTruthy();

    const preview = await testFetch(
      `/api/purchase-orders/${order.body.id}/delete-preview`,
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(Number(previewBody.items[0].removeQty)).toBe(6);
    expect(Number(previewBody.items[0].keptQty)).toBe(4);

    const increased = await testFetch(
      `/api/items/${material.body.id}/stock-adjustments`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: "data_correction",
          lots: [{ lotId: lots[0].id, newQuantity: "11" }],
        }),
      },
    );
    expect(increased.ok).toBeTruthy();

    const cappedPreview = await testFetch(
      `/api/purchase-orders/${order.body.id}/delete-preview`,
    );
    expect(cappedPreview.status).toBe(200);
    const cappedPreviewBody = await cappedPreview.json();
    expect(Number(cappedPreviewBody.items[0].removeQty)).toBe(10);
    expect(Number(cappedPreviewBody.items[0].keptQty)).toBe(0);

    const deleted = await testFetch(`/api/purchase-orders/${order.body.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    // Exactly one compensating reversal event for the on-hand remainder.
    const reversalRows = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.organizationId, orgId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease"),
          eq(inventoryEvents.eventSubtype, "purchase_receipt_reversal"),
          eq(inventoryEvents.referenceType, "purchase_order"),
          eq(inventoryEvents.referenceId, order.body.id),
        ),
      );
    expect(reversalRows).toHaveLength(1);
    expect(Number(reversalRows[0].quantity)).toBe(10);

    // The receipt and the consumption events are preserved.
    const receiptRows = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.organizationId, orgId),
          eq(inventoryEvents.eventType, "purchase_receipt"),
          eq(inventoryEvents.referenceId, order.body.id),
        ),
      );
    expect(receiptRows).toHaveLength(1);

    const [balance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(
        and(
          eq(inventoryItemBalances.organizationId, orgId),
          eq(inventoryItemBalances.itemId, material.body.id),
        ),
      );
    expect(Number(balance?.onHandQty ?? "0")).toBe(1);

    const expectedRows = await db
      .select({ quantity: inventoryExpectedSummary.quantity })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.referenceType, "purchase_order_line"),
          eq(inventoryExpectedSummary.referenceId, order.body.lines[0].id),
        ),
      );
    for (const row of expectedRows) expect(Number(row.quantity)).toBe(0);

    const [po] = await db
      .select({ deletedAt: purchaseOrders.deletedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, order.body.id));
    expect(po?.deletedAt).not.toBeNull();
  });
});
