import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { filterList, test, expect } from "../fixtures";
import { db as appDb } from "../../../lib/db";
import {
  inventoryLocations,
  inventoryEvents,
  inventoryLotBalances,
  items,
  lots,
  manufacturingOrderBatches,
  manufacturingOrders,
  organization,
  purchaseOrders,
  salesOrders,
  stocktakeItems,
  unitDefinitions,
} from "../../../lib/db/schema";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  getOrgId,
  getUnitId,
  submitPurchaseOrder,
  testFetch,
  updateItem,
} from "../../helpers/api";

const ownerConnectionString = process.env.DATABASE_URL;
const ownerIsNeon = ownerConnectionString?.includes(".neon.tech") ?? false;

function createOwnerDb() {
  if (!ownerConnectionString) {
    throw new Error("DATABASE_URL is required for inventory ledger balance setup.");
  }

  if (ownerIsNeon) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    return drizzle(new Pool({ connectionString: ownerConnectionString }));
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  return drizzle(new Pool({ connectionString: ownerConnectionString }));
}

const ownerDb = createOwnerDb();

test.describe("Inventory ledger explorer", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();

  const purchaseMaterialName = `Ledger Purchase Material ${ts}`;
  const supplierName = `Ledger Supplier ${ts}`;
  const salesProductName = `Ledger Sales Product ${ts}`;
  const customerName = `Ledger Customer ${ts}`;
  const stocktakeCategory = `Ledger Stocktake ${ts}`;
  const stocktakeLossMaterialName = `Ledger Stocktake Loss ${ts}`;
  const stocktakeVerifiedMaterialName = `Ledger Stocktake Verified ${ts}`;
  const stocktakeName = `Ledger Stocktake ${ts}`;
  const balanceMaterialName = `Ledger Balance Material ${ts}`;
  const balanceCategory = `Ledger Balance ${ts}`;
  const balanceLotANumber = `LBA-${String(ts).slice(-10)}`;
  const balanceLotBNumber = `LBB-${String(ts).slice(-10)}`;
  const balanceYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const balanceYesterdayLater = new Date(
    balanceYesterday.getTime() + 60 * 60 * 1000
  );
  const balanceToday = new Date();

  let purchaseMaterialId = "";
  let purchaseOrderId = "";
  let purchaseOrderNumber = "";
  let manualEventId = "";
  let manualEventQuantity = "";
  let manualEventReferenceType: string | null = null;
  let manualEventReferenceId: string | null = null;
  let manualEventDateUtc = "";
  let manualEventLotNumber = "";
  let manualEventActorUserId = "";

  let salesOrderId = "";
  let salesOrderNumber = "";
  let salesProductId = "";

  let stocktakeId = "";
  let stocktakeLossLineId = "";
  let stocktakeVerifiedLineId = "";
  let balanceItemId = "";
  let balanceLotAId = "";
  let balanceLotBId = "";
  let balanceOpeningEventId = "";
  let balanceIncreaseEventId = "";
  let balanceDecreaseEventId = "";
  let balanceOtherOrgEventId = "";
  let balanceLocationId = "";

  function balanceUpdatePayload(stock: string) {
    return {
      name: balanceMaterialName,
      sku: `LEDGER-BAL-${ts}`,
      category: balanceCategory,
      description: "Ledger on-hand after fixture",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: "1.00",
      currentStockUnitCost: null,
      defaultSellingPrice: null,
      sellable: true,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      stock,
      safetyStock: "0",
      bom: [],
      revisionNote: null,
    };
  }

  test("creates shared ledger fixtures", async ({ db }) => {
    const purchaseMaterialCreate = await createItem({
      name: purchaseMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-PO-MAT-${ts}`,
      category: `Ledger Purchasing ${ts}`,
      description: "Ledger purchasing material",
      defaultPurchasePrice: "2.25",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(purchaseMaterialCreate.status).toBe(201);
    purchaseMaterialId = purchaseMaterialCreate.body.id as string;

    const supplierCreate = await createSupplier({
      name: supplierName,
      code: `LEDGER-SUP-${ts}`,
      contactName: "Casey Ledger",
      email: `ledger-${ts}@example.com`,
      paymentTerms: "Net 15",
    });
    expect(supplierCreate.status).toBe(201);

    const purchaseOrderCreate = await createPurchaseOrder({
      supplierId: supplierCreate.body.id as string,
      expectedDate: "2026-05-02",
      notes: "Ledger explorer purchase order",
      lines: [
        {
          itemId: purchaseMaterialId,
          quantityOrdered: "3",
          unitCost: "2.25",
        },
      ],
    });
    expect(purchaseOrderCreate.status).toBe(201);
    purchaseOrderId = purchaseOrderCreate.body.id as string;

    const submitOrder = await submitPurchaseOrder(purchaseOrderId);
    expect(submitOrder.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, purchaseMaterialId));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("manual_adjustment_increase");
    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, purchaseMaterialId));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("expected_increase");

    const [manualEvent] = await db
      .select({
        id: inventoryEvents.id,
        quantity: inventoryEvents.quantity,
        referenceType: inventoryEvents.referenceType,
        referenceId: inventoryEvents.referenceId,
        occurredAt: inventoryEvents.occurredAt,
        actorUserId: inventoryEvents.actorUserId,
        lotNumber: lots.lotNumber,
      })
      .from(inventoryEvents)
      .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
      .where(
        and(
          eq(inventoryEvents.itemId, purchaseMaterialId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .limit(1);
    expect(manualEvent).toBeTruthy();
    manualEventId = manualEvent!.id;
    manualEventQuantity = manualEvent!.quantity;
    manualEventReferenceType = manualEvent!.referenceType;
    manualEventReferenceId = manualEvent!.referenceId;
    manualEventDateUtc = manualEvent!.occurredAt.toISOString().slice(0, 10);
    manualEventLotNumber = manualEvent!.lotNumber ?? "";
    manualEventActorUserId = manualEvent!.actorUserId ?? `ledger-actor-${ts}`;

    if (!manualEvent!.actorUserId) {
      await db
        .update(inventoryEvents)
        .set({ actorUserId: manualEventActorUserId })
        .where(eq(inventoryEvents.id, manualEventId));
    }

    const [purchaseOrder] = await db
      .select({ orderNumber: purchaseOrders.orderNumber })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(purchaseOrder?.orderNumber).toMatch(/PO-\d{4}-\d{4}/);
    purchaseOrderNumber = purchaseOrder!.orderNumber;

    const salesProductCreate = await createItem({
      name: salesProductName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `LEDGER-SALES-${ts}`,
      category: `Ledger Sales ${ts}`,
      description: "Ledger sales product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "18.50",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(salesProductCreate.status).toBe(201);
    salesProductId = salesProductCreate.body.id as string;
    const customerCreate = await createCustomer({
      name: customerName,
      email: `ledger-customer-${ts}@example.com`,
    });
    expect(customerCreate.status).toBe(201);

    const salesOrderCreate = await createSalesOrder({
      customerId: customerCreate.body.id as string,
      lines: [
        {
          itemId: salesProductCreate.body.id as string,
          quantity: "2",
          unitPrice: "18.50",
        },
      ],
      notes: "Ledger explorer sales order",
    });
    expect(salesOrderCreate.status).toBe(201);
    salesOrderId = salesOrderCreate.body.id as string;

    const confirmOrder = await confirmSalesOrder(salesOrderId, {
      confirmOversell: true,
    });
    expect(confirmOrder.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(eq(inventoryEvents.itemId, salesProductCreate.body.id as string));
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("demand_increase");

    const [salesOrder] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
    expect(salesOrder?.orderNumber).toMatch(/SO-\d{4}-\d{4}/);
    salesOrderNumber = salesOrder!.orderNumber;

    const stocktakeLossMaterialCreate = await createItem({
      name: stocktakeLossMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-STK-LOSS-${ts}`,
      category: stocktakeCategory,
      description: "Ledger stocktake loss material",
      defaultPurchasePrice: "2.50",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(stocktakeLossMaterialCreate.status).toBe(201);

    const stocktakeVerifiedMaterialCreate = await createItem({
      name: stocktakeVerifiedMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `LEDGER-STK-VERIFY-${ts}`,
      category: stocktakeCategory,
      description: "Ledger stocktake verified material",
      defaultPurchasePrice: "3.10",
      defaultSellingPrice: null,
      stock: "2",
      safetyStock: "0",
      bom: [],
    });
    expect(stocktakeVerifiedMaterialCreate.status).toBe(201);

    const stocktakeCreate = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: stocktakeName,
        scope: buildStocktakeCategoryScope("material", stocktakeCategory),
        notes: "Ledger explorer stocktake",
      }),
    });
    const stocktakeBody = await stocktakeCreate.json();

    expect(stocktakeCreate.status).toBe(201);
    stocktakeId = stocktakeBody.id as string;

    const lines = await db
      .select({
        id: stocktakeItems.id,
        itemId: stocktakeItems.itemId,
      })
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, stocktakeId));

    stocktakeLossLineId =
      lines.find((line) => line.itemId === stocktakeLossMaterialCreate.body.id)?.id ?? "";
    stocktakeVerifiedLineId =
      lines.find((line) => line.itemId === stocktakeVerifiedMaterialCreate.body.id)?.id ?? "";

    expect(stocktakeLossLineId).not.toBe("");
    expect(stocktakeVerifiedLineId).not.toBe("");

    const saveCounts = await testFetch(`/api/stocktakes/${stocktakeId}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [
          {
            lineId: stocktakeLossLineId,
            countedQty: "3",
          },
          {
            lineId: stocktakeVerifiedLineId,
            countedQty: "2",
          },
        ],
      }),
    });
    expect(saveCounts.status).toBe(200);

    const completeStocktake = await testFetch(
      `/api/stocktakes/${stocktakeId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false }),
      }
    );
    expect(completeStocktake.status).toBe(200);

    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(
            and(
              eq(inventoryEvents.referenceType, "stocktake_line"),
              inArray(inventoryEvents.referenceId, [
                stocktakeLossLineId,
                stocktakeVerifiedLineId,
              ])
            )
          );
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("stocktake_loss");
    await expect
      .poll(async () => {
        const rows = await db
          .select({ eventType: inventoryEvents.eventType })
          .from(inventoryEvents)
          .where(
            and(
              eq(inventoryEvents.referenceType, "stocktake_line"),
              inArray(inventoryEvents.referenceId, [
                stocktakeLossLineId,
                stocktakeVerifiedLineId,
              ])
            )
          );
        return rows.map((row) => row.eventType).sort().join(",");
      })
      .toContain("stocktake_verification");
  });

  test("applies date filters in the requested timezone and hides raw metadata", async ({
    db,
  }) => {
    const [sourceEvent] = await db
      .select({ locationId: inventoryEvents.locationId })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, purchaseMaterialId))
      .limit(1);
    if (!sourceEvent) {
      throw new Error("Expected a source inventory event for ledger date filter test.");
    }

    const [denverIncludedEvent, denverExcludedEvent] = await db
      .insert(inventoryEvents)
      .values([
        {
          organizationId: getOrgId(),
          locationId: sourceEvent.locationId,
          eventType: "cost_basis_change",
          eventSubtype: "default_purchase_price",
          itemId: purchaseMaterialId,
          quantity: "0",
          referenceType: "item",
          referenceId: purchaseMaterialId,
          occurredAt: new Date("2026-04-25T05:30:00.000Z"),
          metadata: {
            note: "ledger secret note",
            token: "ledger secret token",
          },
        },
        {
          organizationId: getOrgId(),
          locationId: sourceEvent.locationId,
          eventType: "cost_basis_change",
          eventSubtype: "default_purchase_price",
          itemId: purchaseMaterialId,
          quantity: "0",
          referenceType: "item",
          referenceId: purchaseMaterialId,
          occurredAt: new Date("2026-04-25T06:30:00.000Z"),
          metadata: {
            note: "outside Denver day",
          },
        },
      ])
      .returning({ id: inventoryEvents.id });
    if (!denverIncludedEvent || !denverExcludedEvent) {
      throw new Error("Expected test inventory events to be inserted.");
    }

    const denverResponse = await testFetch(
      `/api/inventory-ledger?itemId=${purchaseMaterialId}&scope=all&eventType=cost_basis_change&dateFrom=2026-04-24&dateTo=2026-04-24&timeZone=America%2FDenver`
    );
    const denverBody = await denverResponse.json();

    expect(denverResponse.status).toBe(200);
    const denverRowIds = denverBody.rows.map((row: { id: string }) => row.id);
    expect(denverRowIds).toContain(denverIncludedEvent.id);
    expect(denverRowIds).not.toContain(denverExcludedEvent.id);

    const includedRow = denverBody.rows.find(
      (row: { id: string }) => row.id === denverIncludedEvent.id
    );
    if (!includedRow) {
      throw new Error("Expected the Denver ledger response to include the late-day event.");
    }
    expect(includedRow).not.toHaveProperty("metadata");
    expect(includedRow.metadataSummary).toEqual(
      expect.arrayContaining([
        { label: "Internal note", value: "Hidden" },
        { label: "Additional metadata", value: "Hidden" },
      ])
    );
    expect(JSON.stringify(includedRow)).not.toContain("ledger secret");

    const utcResponse = await testFetch(
      `/api/inventory-ledger?itemId=${purchaseMaterialId}&scope=all&eventType=cost_basis_change&dateFrom=2026-04-24&dateTo=2026-04-24&timeZone=UTC`
    );
    const utcBody = await utcResponse.json();
    const utcRowIds = utcBody.rows.map((row: { id: string }) => row.id);

    expect(utcResponse.status).toBe(200);
    expect(utcRowIds).not.toContain(denverIncludedEvent.id);
    expect(utcRowIds).not.toContain(denverExcludedEvent.id);
  });

  test("returns raw event rows and applies core API filters", async () => {
    const exactResponse = await testFetch(
      `/api/inventory-ledger?q=${encodeURIComponent(
        purchaseMaterialName
      )}&dateFrom=${manualEventDateUtc}&dateTo=${manualEventDateUtc}&timeZone=UTC&itemType=material&eventType=manual_adjustment_increase&lot=${encodeURIComponent(
        manualEventLotNumber
      )}&documentType=item&documentId=${purchaseMaterialId}&actorUserId=${encodeURIComponent(
        manualEventActorUserId
      )}&scope=all`
    );
    const exactBody = await exactResponse.json();

    expect(exactResponse.status).toBe(200);
    const exactRow = exactBody.rows.find(
      (row: { id: string }) => row.id === manualEventId
    );
    expect(exactRow).toMatchObject({
      id: manualEventId,
      eventType: "manual_adjustment_increase",
      referenceType: manualEventReferenceType,
      referenceId: manualEventReferenceId,
      item: expect.objectContaining({
        id: purchaseMaterialId,
        itemType: "material",
      }),
    });
    expect(parseFloat(exactRow.quantity)).toBe(parseFloat(manualEventQuantity));

    const categoryResponse = await testFetch(
      `/api/inventory-ledger?itemId=${purchaseMaterialId}&scope=all&eventClass=expected`
    );
    const categoryBody = await categoryResponse.json();

    expect(categoryResponse.status).toBe(200);
    expect(
      categoryBody.rows.every(
        (row: { eventClass: string }) => row.eventClass === "expected"
      )
    ).toBe(true);
    expect(
      categoryBody.rows.some(
        (row: { eventType: string }) => row.eventType === "expected_increase"
      )
    ).toBe(true);
    expect(
      categoryBody.rows.some((row: { id: string }) => row.id === manualEventId)
    ).toBe(false);
  });

  test("creates on-hand-after balance fixtures across two lots", async ({ db }) => {
    const createResponse = await createItem({
      ...balanceUpdatePayload("20"),
      itemType: "material",
      unitDefinitionId: unitId,
    });
    expect(createResponse.status).toBe(201);
    balanceItemId = createResponse.body.id as string;

    const increaseResponse = await updateItem(
      balanceItemId,
      balanceUpdatePayload("25")
    );
    expect(increaseResponse.status).toBe(200);

    const increaseEvents = await db
      .select({
        id: inventoryEvents.id,
        lotId: inventoryEvents.lotId,
        quantity: inventoryEvents.quantity,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, balanceItemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(asc(inventoryEvents.occurredAt), asc(inventoryEvents.id));

    const openingEvent = increaseEvents.find(
      (event) => parseFloat(event.quantity) === 20
    );
    const increaseEvent = increaseEvents.find(
      (event) => parseFloat(event.quantity) === 5
    );
    expect(openingEvent?.lotId).toBeTruthy();
    expect(increaseEvent?.lotId).toBeTruthy();

    balanceOpeningEventId = openingEvent!.id;
    balanceIncreaseEventId = increaseEvent!.id;
    balanceLotAId = openingEvent!.lotId!;
    balanceLotBId = increaseEvent!.lotId!;

    await db
      .update(lots)
      .set({ lotNumber: balanceLotANumber })
      .where(eq(lots.id, balanceLotAId));
    await db
      .update(lots)
      .set({ lotNumber: balanceLotBNumber })
      .where(eq(lots.id, balanceLotBId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: balanceYesterday })
      .where(eq(inventoryLotBalances.lotId, balanceLotAId));
    await db
      .update(inventoryLotBalances)
      .set({ receivedAt: balanceYesterdayLater })
      .where(eq(inventoryLotBalances.lotId, balanceLotBId));

    const decreaseResponse = await updateItem(
      balanceItemId,
      balanceUpdatePayload("22")
    );
    expect(decreaseResponse.status).toBe(200);

    const [decreaseEvent] = await db
      .select({
        id: inventoryEvents.id,
        locationId: inventoryEvents.locationId,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, balanceItemId),
          eq(inventoryEvents.eventType, "manual_adjustment_decrease")
        )
      );
    expect(decreaseEvent?.lotId).toBe(balanceLotAId);
    balanceDecreaseEventId = decreaseEvent!.id;
    balanceLocationId = decreaseEvent!.locationId;

    await ownerDb
      .update(inventoryEvents)
      .set({ occurredAt: balanceYesterday })
      .where(eq(inventoryEvents.id, balanceOpeningEventId));
    await ownerDb
      .update(inventoryEvents)
      .set({ occurredAt: balanceYesterdayLater })
      .where(eq(inventoryEvents.id, balanceIncreaseEventId));
    await ownerDb
      .update(inventoryEvents)
      .set({ occurredAt: balanceToday })
      .where(eq(inventoryEvents.id, balanceDecreaseEventId));

    balanceOtherOrgEventId = randomUUID();
    await ownerDb.insert(inventoryEvents).values({
      id: balanceOtherOrgEventId,
      organizationId: `ledger-balance-other-${ts}`,
      locationId: balanceLocationId,
      eventType: "manual_adjustment_increase",
      itemId: balanceItemId,
      lotId: balanceLotAId,
      quantity: "999",
      unitCost: "1",
      extendedCost: "999",
      occurredAt: new Date(balanceToday.getTime() - 1_000),
    });
  });

  test("returns on-hand after from full event history, not only date-filtered rows", async () => {
    const today = balanceToday.toISOString().slice(0, 10);
    const todayResponse = await testFetch(
      `/api/inventory-ledger?itemId=${balanceItemId}&dateFrom=${today}&dateTo=${today}&timeZone=UTC`
    );
    const todayBody = await todayResponse.json();

    expect(todayResponse.status).toBe(200);
    const todayRowIds = todayBody.rows.map((row: { id: string }) => row.id);
    expect(todayRowIds).toContain(balanceDecreaseEventId);
    expect(todayRowIds).not.toContain(balanceOpeningEventId);

    const decreaseRow = todayBody.rows.find(
      (row: { id: string }) => row.id === balanceDecreaseEventId
    );
    expect(decreaseRow).toMatchObject({
      signedQuantity: "-3",
      onHandAfter: "17",
      lot: expect.objectContaining({ number: balanceLotANumber }),
    });

    const allResponse = await testFetch(
      `/api/inventory-ledger?itemId=${balanceItemId}&scope=all`
    );
    const allBody = await allResponse.json();
    const openingRow = allBody.rows.find(
      (row: { id: string }) => row.id === balanceOpeningEventId
    );
    const increaseRow = allBody.rows.find(
      (row: { id: string }) => row.id === balanceIncreaseEventId
    );

    expect(allResponse.status).toBe(200);
    expect(openingRow).toMatchObject({ signedQuantity: "20", onHandAfter: "20" });
    expect(increaseRow).toMatchObject({
      signedQuantity: "5",
      onHandAfter: "5",
      lot: expect.objectContaining({ number: balanceLotBNumber }),
    });
    expect(
      allBody.rows.some((row: { id: string }) => row.id === balanceOtherOrgEventId)
    ).toBe(false);
    expect(
      allBody.rows.some(
        (row: { onHandAfter: string | null }) => row.onHandAfter === "1016"
      )
    ).toBe(false);
  });

  test("shows on-hand-after as a dedicated ledger table column", async ({ page }) => {
    await page.goto(`/inventory/ledger?itemId=${balanceItemId}`);

    const tableBody = page.locator("tbody");
    await expect(
      page.getByRole("columnheader", { name: "Change", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "On hand after" })
    ).toBeVisible();

    const decreaseRow = tableBody
      .locator("tr")
      .filter({ hasText: "Manual stock decrease" })
      .filter({ hasText: balanceLotANumber })
      .first();
    await expect(decreaseRow.getByRole("cell").nth(5)).toHaveText("-3");
    await expect(decreaseRow.getByRole("cell").nth(6)).toHaveText("17");

    const openingRow = tableBody
      .locator("tr")
      .filter({ hasText: "Manual stock increase" })
      .filter({ hasText: balanceLotANumber })
      .filter({ hasText: "+20" })
      .first();
    await expect(openingRow.getByRole("cell").nth(6)).toHaveText("20");

    const lotBRow = tableBody
      .locator("tr")
      .filter({ hasText: "Manual stock increase" })
      .filter({ hasText: balanceLotBNumber })
      .first();
    await expect(lotBRow.getByRole("cell").nth(5)).toHaveText("+5");
    await expect(lotBRow.getByRole("cell").nth(6)).toHaveText("5");
    await expect(lotBRow.getByRole("cell").nth(6)).not.toHaveText("22");
  });

  test("uses event id as a same-timestamp tie-breaker and dashes unknown balances", async ({
    page,
  }) => {
    const verificationEventId = `ffffffff-ffff-ffff-ffff-${String(ts)
      .slice(-12)
      .padStart(12, "0")}`;
    const tieBreakAt = new Date(Date.now() + 60 * 60 * 1000);

    await ownerDb
      .update(inventoryEvents)
      .set({ occurredAt: tieBreakAt })
      .where(eq(inventoryEvents.id, balanceDecreaseEventId));

    await ownerDb.insert(inventoryEvents).values({
      id: verificationEventId,
      organizationId: getOrgId(),
      locationId: balanceLocationId,
      eventType: "stocktake_verification",
      itemId: balanceItemId,
      quantity: "0",
      referenceType: "stocktake_line",
      referenceId: randomUUID(),
      occurredAt: tieBreakAt,
      metadata: { stocktakeId: randomUUID() },
    });

    await page.goto(`/inventory/ledger?itemId=${balanceItemId}&scope=all`);

    const firstDataRow = page.locator("tbody > tr").first();
    await expect(firstDataRow).toContainText("Stocktake verification");
    await expect(firstDataRow.getByRole("cell").nth(5)).toHaveText("—");
    await expect(firstDataRow.getByRole("cell").nth(6)).toHaveText("—");

    const secondDataRow = page.locator("tbody > tr").nth(1);
    await expect(secondDataRow).toContainText("Manual stock decrease");
    await expect(secondDataRow.getByRole("cell").nth(5)).toHaveText("-3");
    await expect(secondDataRow.getByRole("cell").nth(6)).toHaveText("17");
  });

  test("does not return another organization's ledger rows", async () => {
    const otherOrgId = randomUUID();
    const otherUnitId = randomUUID();
    const otherLocationId = randomUUID();
    const otherItemId = randomUUID();
    const otherEventId = randomUUID();
    const otherOrgName = `Other Ledger Org ${ts}`;
    const otherItemName = `Other Org Ledger Material ${ts}`;

    await appDb.insert(organization).values({
      id: otherOrgId,
      name: otherOrgName,
      slug: `other-ledger-${ts}`,
      createdAt: new Date(),
    });

    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${otherOrgId}, true)`);
      await tx.insert(unitDefinitions).values({
        id: otherUnitId,
        organizationId: otherOrgId,
        name: "Each",
        size: "1",
        uom: "ea",
      });
      await tx.insert(inventoryLocations).values({
        id: otherLocationId,
        organizationId: otherOrgId,
        name: "Other default",
        code: `OTHER-${ts}`,
        isDefault: true,
      });
      await tx.insert(items).values({
        id: otherItemId,
        organizationId: otherOrgId,
        name: otherItemName,
        itemType: "material",
        unitDefinitionId: otherUnitId,
        sellable: false,
      });
      await tx.insert(inventoryEvents).values({
        id: otherEventId,
        organizationId: otherOrgId,
        locationId: otherLocationId,
        eventType: "cost_basis_change",
        eventSubtype: "other_org_visibility",
        itemId: otherItemId,
        quantity: "0",
        referenceType: "item",
        referenceId: otherItemId,
      });
    });

    const response = await testFetch(
      `/api/inventory-ledger?scope=all&q=${encodeURIComponent(otherItemName)}`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toEqual([]);
  });

  test("loads with primary filters and opens more filters popover", async ({
    page,
  }) => {
    await page.goto("/inventory/ledger");
    await expect(
      page.getByRole("heading", { name: "Inventory Activity" })
    ).toBeVisible();
    await expect(page.getByLabel("Search ledger")).toBeVisible();
    await expect(page.getByLabel("Filter from date")).toBeVisible();
    await expect(page.getByLabel("Filter to date")).toBeVisible();
    await expect(page.getByLabel("Filter by movement category")).toBeVisible();
    await expect(page.getByLabel("Filter by item type")).toBeVisible();
    await expect(page.getByLabel("Filter by lot")).toBeHidden();
    await expect(page.locator("tbody").getByText("On-hand")).toHaveCount(0);
    await expect(page.locator("tbody").getByText("test-agent@erp-test.local")).toHaveCount(0);
    await expect(page.locator("tbody").getByText(`LEDGER-PO-MAT-${ts}`)).toHaveCount(0);

    await page.getByRole("button", { name: "More filters" }).click();
    await expect(page.getByLabel("Filter by lot")).toBeVisible();
    await expect(page.getByLabel("Filter by scope")).toBeVisible();
    await expect(page.getByLabel("Filter by event type")).toBeVisible();
    await expect(page.getByLabel("Filter by document type")).toBeVisible();
    await expect(page.getByLabel("Filter by actor")).toBeVisible();

    await filterList(page, "Search ledger", purchaseMaterialName);
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("q") === purchaseMaterialName
      ),
      page.getByRole("button", { name: "Apply" }).click(),
    ]);

    const globalTableBody = page.locator("tbody");
    await expect(globalTableBody.getByText("Manual stock increase")).toBeVisible();
    await expect(globalTableBody.getByText("Expected supply increase")).toHaveCount(0);

    await page.getByLabel("Filter by movement category").click();
    await page.getByRole("option", { name: "Expected supply" }).click();

    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("q") === purchaseMaterialName &&
          url.searchParams.get("eventClass") === "expected" &&
          url.searchParams.get("scope") === "all"
      ),
      page.getByRole("button", { name: "Apply" }).click(),
    ]);

    await expect(globalTableBody.getByText("Expected supply increase").first()).toBeVisible();
    await expect(globalTableBody.getByText("Manual stock increase")).toHaveCount(0);
  });

  test("shows ledger as a lean table without expanded rows", async ({ page }) => {
    await page.goto(`/inventory/ledger?itemId=${purchaseMaterialId}`);

    const tableBody = page.locator("tbody");
    await expect(
      page.getByRole("columnheader", { name: "On hand after" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Value change" })
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Unit cost" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand row" })).toHaveCount(0);

    const manualRow = tableBody
      .locator("tr")
      .filter({ hasText: "Manual stock increase" })
      .filter({ hasText: purchaseMaterialName })
      .first();
    await expect(manualRow.getByRole("cell").nth(7)).toContainText("$");
    await expect(page.getByText("Advanced")).toHaveCount(0);
    await expect(
      page.getByText("manual_adjustment_increase", { exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View Item" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View Source" })).toHaveCount(0);
  });

  test("shows business-friendly manufacturing movement labels", async ({
    db,
    page,
  }) => {
    const [sourceEvent] = await db
      .select({
        locationId: inventoryEvents.locationId,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, purchaseMaterialId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .limit(1);
    if (!sourceEvent?.lotId) {
      throw new Error("Expected a source lot for manufacturing label coverage.");
    }

    const [productLot] = await db
      .insert(lots)
      .values({
        organizationId: getOrgId(),
        itemId: salesProductId,
        lotNumber: `LMO-${String(ts).slice(-12)}`,
        quantity: "0",
      })
      .returning({ id: lots.id });
    if (!productLot) {
      throw new Error("Expected a product lot for manufacturing label coverage.");
    }

    const [manufacturingOrder] = await db
      .insert(manufacturingOrders)
      .values({
        organizationId: getOrgId(),
        orderNumber: `MO-LEDGER-${String(ts).slice(-10)}`,
        productId: salesProductId,
        productName: salesProductName,
        productSku: `LEDGER-SALES-${ts}`,
        unitName: "Each",
        requestedQuantity: "1",
        plannedQuantity: "1",
        status: "released",
      })
      .returning({ id: manufacturingOrders.id, orderNumber: manufacturingOrders.orderNumber });
    if (!manufacturingOrder) {
      throw new Error("Expected a manufacturing order for ledger label coverage.");
    }

    const labelEvents = await db
      .insert(inventoryEvents)
      .values([
        {
          organizationId: getOrgId(),
          locationId: sourceEvent.locationId,
          eventType: "manufacturing_ingredient_consumption",
          eventSubtype: "pick",
          itemId: purchaseMaterialId,
          lotId: sourceEvent.lotId,
          quantity: "1",
          unitCost: "2.25",
          extendedCost: "2.25",
          referenceType: "manufacturing_order",
          referenceId: manufacturingOrder.id,
          actorUserId: manualEventActorUserId,
        },
        {
          organizationId: getOrgId(),
          locationId: sourceEvent.locationId,
          eventType: "manufacturing_output",
          eventSubtype: "complete",
          itemId: salesProductId,
          lotId: productLot.id,
          quantity: "1",
          unitCost: "2.25",
          extendedCost: "2.25",
          referenceType: "manufacturing_order",
          referenceId: manufacturingOrder.id,
          actorUserId: manualEventActorUserId,
        },
      ])
      .returning({ id: inventoryEvents.id });

    try {
      await page.goto(
        `/inventory/ledger?scope=all&eventType=manufacturing_ingredient_consumption&q=${encodeURIComponent(
          purchaseMaterialName
        )}`
      );
      await expect(page.locator("tbody").getByText("Manufacturing material used")).toBeVisible();
      const materialUseRow = page
        .locator("tbody")
        .locator("tr")
        .filter({ hasText: "Manufacturing material used" })
        .filter({ hasText: purchaseMaterialName })
        .first();
      await expect(materialUseRow.getByRole("cell").nth(5)).toHaveText("-1");
      await expect(materialUseRow.getByRole("cell").nth(7)).toHaveText("-$2.25");
      await expect(
        materialUseRow.getByRole("link", { name: manufacturingOrder.orderNumber })
      ).toBeVisible();

      await page.goto(
        `/inventory/ledger?scope=all&eventType=manufacturing_output&q=${encodeURIComponent(
          salesProductName
        )}`
      );
      await expect(page.locator("tbody").getByText("Manufacturing output")).toBeVisible();
      const outputRow = page
        .locator("tbody")
        .locator("tr")
        .filter({ hasText: "Manufacturing output" })
        .filter({ hasText: salesProductName })
        .first();
      await expect(outputRow.getByRole("cell").nth(7)).toHaveText("$2.25");
    } finally {
      const labelEventIds = labelEvents.map((event) => event.id);
      if (labelEventIds.length > 0) {
        await ownerDb.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.current_org_id', ${getOrgId()}, true)`
          );
          await tx.execute(sql`
            DELETE FROM inventory.inventory_events
            WHERE organization_id = ${getOrgId()}
              AND id IN (${sql.join(
                labelEventIds.map((id) => sql`${id}`),
                sql`, `
              )})
          `);
        });
      }
    }
  });

  test("shows full item activity when deep-linking from item detail", async ({ page }) => {
    await page.goto(`/inventory/materials/${purchaseMaterialId}`);
    const viewFullLedgerLink = page.getByRole("link", { name: "View Full Ledger" });
    await expect(viewFullLedgerLink).toBeVisible();
    await viewFullLedgerLink.click();
    await expect(page).toHaveURL(new RegExp(`/inventory/ledger\\?itemId=${purchaseMaterialId}`));

    const itemTableBody = page.locator("tbody");
    await expect(itemTableBody.getByText("Manual stock increase")).toBeVisible();
    await expect(itemTableBody.getByText("Expected supply increase").first()).toBeVisible();

    const expectedSupplyRow = itemTableBody
      .locator("tr")
      .filter({ hasText: "Expected supply increase" })
      .filter({ hasText: purchaseOrderNumber })
      .first();
    await expect(
      expectedSupplyRow.getByRole("link", { name: purchaseMaterialName })
    ).toBeVisible();
    await expect(
      expectedSupplyRow.getByRole("link", { name: purchaseOrderNumber })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand row" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View Item" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View Source" })).toHaveCount(0);
  });

  test("drills through from purchase and sales order detail pages", async ({ page }) => {
    await page.goto(`/purchasing/orders/${purchaseOrderId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const purchaseLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(purchaseLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "purchase_order" &&
          url.searchParams.get("documentId") === purchaseOrderId,
        { timeout: 15_000 }
      ),
      purchaseLedgerItem.click(),
    ]);

    const purchaseTableBody = page.locator("tbody");
    await expect(purchaseTableBody.getByText("Expected supply increase")).toBeVisible({
      timeout: 15_000,
    });
    await expect(purchaseTableBody.getByText("Manual stock increase")).toHaveCount(0);
    await expect(purchaseTableBody.getByText(purchaseOrderNumber)).toBeVisible();

    await page.goto(`/sales/orders/${salesOrderId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const salesLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(salesLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "sales_order" &&
          url.searchParams.get("documentId") === salesOrderId,
        { timeout: 15_000 }
      ),
      salesLedgerItem.click(),
    ]);

    const salesTableBody = page.locator("tbody");
    await expect(salesTableBody.getByText("Customer demand increase")).toBeVisible({
      timeout: 15_000,
    });
    await expect(salesTableBody.getByText("Manual stock increase")).toHaveCount(0);
    await expect(salesTableBody.getByText(salesOrderNumber)).toBeVisible();
  });

  test("returns stocktake rows from the ledger API using stocktake-line resolution", async () => {
    const response = await testFetch(
      `/api/inventory-ledger?documentType=stocktake&documentId=${stocktakeId}`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resolvedFilters.documentLabel).toBe(stocktakeName);
    expect(body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "stocktake_loss",
          referenceType: "stocktake_line",
          sourceDocument: expect.objectContaining({
            type: "stocktake",
            id: stocktakeId,
          }),
        }),
        expect.objectContaining({
          eventType: "stocktake_verification",
          referenceType: "stocktake_line",
          sourceDocument: expect.objectContaining({
            type: "stocktake",
            id: stocktakeId,
          }),
        }),
      ])
    );
    expect(
      body.rows.every((row: { referenceId: string }) =>
        [stocktakeLossLineId, stocktakeVerifiedLineId].includes(row.referenceId)
      )
    ).toBe(true);
  });

  test("returns manufacturing batch rows from the ledger API using batch resolution", async ({
    db,
  }) => {
    const [sourceEvent] = await db
      .select({ locationId: inventoryEvents.locationId })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, purchaseMaterialId))
      .limit(1);
    if (!sourceEvent) {
      throw new Error("Expected a source inventory event for batch ledger test.");
    }

    const [order] = await db
      .insert(manufacturingOrders)
      .values({
        organizationId: getOrgId(),
        orderNumber: `MO-LEDGER-${ts}`,
        productId: salesProductId,
        productName: salesProductName,
        unitName: "Each",
        manufacturingMode: "batch",
        numberOfBatches: 1,
        expectedBatchYield: "1",
        requestedQuantity: "1",
        plannedQuantity: "1",
        status: "released",
      })
      .returning({ id: manufacturingOrders.id, orderNumber: manufacturingOrders.orderNumber });
    if (!order) {
      throw new Error("Expected test manufacturing order to be inserted.");
    }

    const [batch] = await db
      .insert(manufacturingOrderBatches)
      .values({
        manufacturingOrderId: order.id,
        batchNumber: 1,
        status: "completed",
        plannedQuantity: "1",
        actualQuantity: "1",
      })
      .returning({ id: manufacturingOrderBatches.id });
    if (!batch) {
      throw new Error("Expected test manufacturing batch to be inserted.");
    }

    const [batchEvent] = await db
      .insert(inventoryEvents)
      .values({
        organizationId: getOrgId(),
        locationId: sourceEvent.locationId,
        eventType: "cost_basis_change",
        eventSubtype: "bom_edited",
        itemId: purchaseMaterialId,
        quantity: "0",
        referenceType: "manufacturing_batch",
        referenceId: batch.id,
      })
      .returning({ id: inventoryEvents.id });
    if (!batchEvent) {
      throw new Error("Expected test manufacturing batch event to be inserted.");
    }

    const response = await testFetch(
      `/api/inventory-ledger?documentType=manufacturing_order&documentId=${order.id}&scope=all&eventType=cost_basis_change`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resolvedFilters.documentLabel).toBe(order.orderNumber);
    expect(body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: batchEvent.id,
          referenceType: "manufacturing_batch",
          sourceDocument: expect.objectContaining({
            type: "manufacturing_order",
            id: order.id,
            label: order.orderNumber,
          }),
        }),
      ])
    );
  });

  test("shows stocktake activity in the UI drill-through", async ({ page }) => {
    await page.goto(`/inventory/stocktakes/${stocktakeId}`);
    await page.getByRole("button", { name: "More actions" }).click();
    const stocktakeLedgerItem = page.getByRole("menuitem", {
      name: "View inventory activity",
    });
    await expect(stocktakeLedgerItem).toBeVisible();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/inventory/ledger" &&
          url.searchParams.get("documentType") === "stocktake" &&
          url.searchParams.get("documentId") === stocktakeId,
        { timeout: 15_000 }
      ),
      stocktakeLedgerItem.click(),
    ]);

    const stocktakeTableBody = page.locator("tbody");
    await expect(
      stocktakeTableBody.getByText("Stocktake adjustment", { exact: true })
    ).toBeVisible();
    await expect(
      stocktakeTableBody.getByText("Stocktake verification", { exact: true })
    ).toBeVisible();
    await expect(
      stocktakeTableBody.getByRole("link", { name: stocktakeName, exact: true })
    ).toHaveCount(2);
  });
});
