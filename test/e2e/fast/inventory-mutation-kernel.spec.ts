import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  inventoryTransfers,
  bomRevisionComponents,
  bomRevisionOperationCosts,
  bomRevisions,
  itemFamilies,
  itemVariantValues,
  items,
  lots,
  manufacturingResources,
  organization,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
  variantOptionValues,
  variantOptions,
} from "../../../lib/db/schema";
import { buildStorageState, readTestEnv } from "../../helpers/test-env";
import {
  consumeStockFifoInTx,
  createPositiveStockEventInTx,
  getDefaultInventoryLocationInTx,
  INTERNAL_UNTRACKED_LOT_NUMBER,
} from "../../../lib/inventory/kernel";
import { buildStocktakeCategoryScope } from "../../../lib/schemas/stocktakes";
import {
  createItem,
  createManufacturingOrder,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
  updateItem,
} from "../../helpers/api";

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

function nonRfcPostgresUuid() {
  const id = randomUUID().split("");
  id[14] = "f";
  id[19] = "0";
  return id.join("");
}

async function expectRows(page: Page, count: number, gridIndex = 0) {
  await expect(
    editableGrid(page, gridIndex).locator(".ag-center-cols-container .ag-row"),
  ).toHaveCount(count, { timeout: 15_000 });
}

async function editGridCell(
  page: Page,
  colId: string,
  value: string,
  rowIndex = 0,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

test.describe("inventory mutation kernel heartbeat", () => {
  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();

  test("onboarding import commits opening stock through the kernel", async ({ db }) => {
    const form = new FormData();
    form.append(
      "file",
      new File(["name,sku,qty\nFast Import Material,IMP-1,5\n"], "inventory.csv", {
        type: "text/csv",
      }),
    );

    const upload = await fetch(`${getBaseUrl()}/api/onboarding/imports`, {
      method: "POST",
      headers: { Cookie: getSessionCookie() },
      body: form,
    });
    expect(upload.status).toBe(201);
    const created = (await upload.json()) as { session: { id: string } };

    const sku = `FAST-IMPORT-${ts}`;
    const patch = await testFetch(`/api/onboarding/imports/${created.session.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        openingStockAsOf: "2026-06-01",
        includeBoms: false,
        package: {
          version: "1",
          openingStockAsOf: "2026-06-01",
          units: [{ tempId: "unit-lb", name: "Pound", size: "1", uom: "lb" }],
          suppliers: [],
          customers: [],
          items: [
            {
              tempId: "item-material",
              itemType: "material",
              name: `Fast Import Material ${ts}`,
              sku,
              unitRef: "unit-lb",
              lotTrackingMode: "tracked",
              match: { suggestion: "create" },
              provenance: [{ fileId: "manual", location: "fast" }],
              confidence: 1,
            },
          ],
          openingStock: [
            {
              itemRef: "item-material",
              quantity: "5",
              unitCost: "3.25",
              receivedAt: "2026-06-01",
              provenance: [{ fileId: "manual", location: "fast" }],
              confidence: 1,
            },
          ],
          boms: [],
          unresolvedQuestions: [],
        },
      }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json();

    const approved = await testFetch(
      `/api/onboarding/imports/${created.session.id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ previewHash: patched.preview.hash }),
      },
    );
    expect(approved.status).toBe(200);

    const [item] = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.sku, sku));
    expect(item?.id).toBeTruthy();

    const [event] = await db
      .select({
        quantity: inventoryEvents.quantity,
        unitCost: inventoryEvents.unitCost,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, item.id),
          eq(inventoryEvents.eventType, "opening_balance"),
        ),
      );
    expect(event).toMatchObject({
      quantity: "5.0000",
      unitCost: "3.250000",
    });
    expect(event.lotId).toBeTruthy();
  });

  test("manual adjustment writes stock event and projection truth", async ({
    db,
  }) => {
    const item = await createItem({
      itemType: "material",
      name: `Fast Kernel Adjustment ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-KERNEL-ADJ-${ts}`,
      category: `Fast Kernel ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const response = await testFetch(`/api/items/${itemId}/initial-stock`, {
      method: "POST",
      body: JSON.stringify({
        quantity: "12",
        costPerUnit: "2.00",
        occurredAt: new Date().toISOString(),
        note: "fast heartbeat adjustment",
      }),
    });
    expect(response.status).toBe(200);

    const [event] = await db
      .select({
        eventType: inventoryEvents.eventType,
        quantity: inventoryEvents.quantity,
        lotId: inventoryEvents.lotId,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "manual_adjustment_increase")
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt), desc(inventoryEvents.id));

    expect(event).toMatchObject({
      eventType: "manual_adjustment_increase",
      quantity: "12.0000",
    });
    expect(event.lotId).toBeTruthy();

    const [lotBalance] = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, itemId));
    const [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(lotBalance.quantity).toBe("13.0000");
    expect(itemBalance).toMatchObject({
      onHandQty: "13.0000",
      availableToPromise: "13.0000",
    });
  });

  test("negative stock uses one debt lot and withholds receipts until debt clears", async ({
    db,
  }) => {
    const category = `Fast Negative Debt ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: `Fast Negative Debt ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-NEG-DEBT-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [location] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const locationId = location?.id;
    expect(locationId).toBeTruthy();
    if (!locationId) throw new Error("Default inventory location not found.");

    await db.transaction(async (tx) => {
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 4,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 6,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
    });

    let [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "-10.0000",
      availableToPromise: "0.0000",
    });

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 5,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 8,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 7,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    const lotRows = await db
      .select({
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.lotNumber);

    expect(
      lotRows.filter((lot) => lot.lotNumber === "UNBATCHED-NEGATIVE-STOCK")
    ).toEqual([expect.objectContaining({ quantity: "-13.0000" })]);
    expect(
      lotRows.filter((lot) => lot.lotNumber !== "UNBATCHED-NEGATIVE-STOCK")
    ).toHaveLength(2);
    expect(
      lotRows
        .filter((lot) => lot.lotNumber !== "UNBATCHED-NEGATIVE-STOCK")
        .reduce((sum, lot) => sum + Number(lot.quantity), 0)
    ).toBe(7);

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "-6.0000",
      availableToPromise: "0.0000",
    });

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Negative Debt Stocktake ${ts}`,
        scope: buildStocktakeCategoryScope("material", category),
        reason: "cycle_count",
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    const [line] = await db
      .select({ id: stocktakeItems.id, expectedQty: stocktakeItems.expectedQty })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktake.id),
          eq(stocktakeItems.itemId, itemId)
        )
      );
    expect(line).toBeTruthy();
    if (!line) throw new Error("Expected stocktake line was not created.");
    expect(line?.expectedQty).toBe("-6.0000");

    const stocktakeLotRows = await db
      .select({ id: stocktakeLotItems.id })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));
    expect(stocktakeLotRows).toEqual([]);

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId,
        itemId,
        quantity: 10,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_negative_regression",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));

    expect(itemBalance).toMatchObject({
      onHandQty: "4.0000",
      availableToPromise: "4.0000",
    });
  });

  test("untracked stock uses one hidden internal lot even when negative", async ({
    db,
  }) => {
    const itemName = `Fast Untracked Internal Lot ${ts}`;
    const category = `Fast Untracked Internal ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: itemName,
      unitDefinitionId: unitId,
      sku: `FAST-UNTRACKED-INT-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        family: {
          name: itemName,
          category,
          description: null,
          unitDefinitionId: unitId,
          lotTrackingMode: "untracked",
        },
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    const location = await db.transaction((tx) =>
      getDefaultInventoryLocationInTx(tx, orgId),
    );

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 5,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
        metadata: {
          lotNumber: "SHOULD-NOT-LEAK",
          internalUntrackedLot: false,
        },
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 3,
        unitCost: "4.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
      });
      await consumeStockFifoInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 10,
        eventType: "manual_adjustment_decrease",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
        allowNegativeStock: true,
      });
    });

    let lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));

    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "-2.0000",
      }),
    ]);

    let [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance).toMatchObject({
      onHandQty: "-2.0000",
      availableToPromise: "0.0000",
    });

    const eventRows = await db
      .select({
        lotId: inventoryEvents.lotId,
        metadata: inventoryEvents.metadata,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));
    expect(eventRows).toHaveLength(3);
    expect(new Set(eventRows.map((event) => event.lotId))).toEqual(
      new Set([lotRows[0].id])
    );
    expect(eventRows.every((event) => event.metadata?.internalUntrackedLot === true)).toBe(
      true
    );
    expect(eventRows.some((event) => "lotNumber" in (event.metadata ?? {}))).toBe(false);

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 5,
        unitCost: "3.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_untracked_internal",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "3.0000",
      }),
    ]);

    [itemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(itemBalance).toMatchObject({
      onHandQty: "3.0000",
      availableToPromise: "3.0000",
    });

    const block = await testFetch(`/api/items/${itemId}/disposition`, {
      method: "POST",
      body: JSON.stringify({
        action: "block",
        fromDisposition: "available",
        quantity: "1",
        notes: "Fast untracked disposition",
      }),
    });
    expect(block.status, await block.text()).toBe(200);

    const [blockedItemBalance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(blockedItemBalance).toMatchObject({
      onHandQty: "3.0000",
      availableToPromise: "2.0000",
    });

    const list = await testFetch("/api/items?itemType=material");
    const listedItem = ((await list.json()) as Array<{
      id: string;
      dispositionBalances: Array<{ disposition: string; quantity: string }>;
    }>).find((row) => row.id === itemId);
    expect(listedItem?.dispositionBalances).toEqual(
      expect.arrayContaining([
        { disposition: "available", quantity: "2" },
        { disposition: "blocked", quantity: "1" },
      ]),
    );

    const card = (await (
      await testFetch(`/api/item-cards/${itemId}`)
    ).json()) as {
      variants: Array<{
        id: string;
        dispositionBalances: Array<{ disposition: string; quantity: string }>;
      }>;
    };
    expect(
      card.variants.find((variant) => variant.id === itemId)?.dispositionBalances,
    ).toEqual(
      expect.arrayContaining([
        { disposition: "available", quantity: "2" },
        { disposition: "blocked", quantity: "1" },
      ]),
    );

    const untrackedLotRoute = await testFetch(
      `/api/items/${itemId}/lots/${lotRows[0].id}/disposition`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "block",
          fromDisposition: "available",
          quantity: "1",
          notes: null,
        }),
      },
    );
    expect(untrackedLotRoute.status).toBe(409);
    expect(await (await testFetch(`/api/items/${itemId}/lots`)).json()).toEqual([]);
  });

  test("disposition routes enforce tracked item and lot addressing", async ({
    db,
  }) => {
    const createTrackedItem = async (suffix: string) => {
      const response = await createItem({
        itemType: "material",
        name: `Fast Tracked Disposition ${suffix} ${ts}`,
        unitDefinitionId: unitId,
        sku: `FAST-TRACKED-DISP-${suffix}-${ts}`,
        category: `Fast Tracked Disposition ${ts}`,
        description: null,
        defaultPurchasePrice: "2.00",
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(response.status).toBe(201);
      return response.body.id as string;
    };

    const itemId = await createTrackedItem("A");
    const otherItemId = await createTrackedItem("B");
    const [otherLot] = await db
      .insert(lots)
      .values({
        organizationId: orgId,
        itemId: otherItemId,
        lotNumber: `FAST-TRACKED-DISP-${ts}`,
      })
      .returning({ id: lots.id });
    const action = JSON.stringify({
      action: "block",
      fromDisposition: "available",
      quantity: "1",
      notes: null,
    });

    const itemRoute = await testFetch(`/api/items/${itemId}/disposition`, {
      method: "POST",
      body: action,
    });
    expect(itemRoute.status).toBe(409);

    const mismatchedLotRoute = await testFetch(
      `/api/items/${itemId}/lots/${otherLot.id}/disposition`,
      { method: "POST", body: action },
    );
    expect(mismatchedLotRoute.status).toBe(404);

    const events = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(inArray(inventoryEvents.itemId, [itemId, otherItemId]));
    expect(events).toEqual([]);
  });

  test("turning off lot tracking consolidates existing lots", async ({ db }) => {
    const itemName = `Fast Disable Lot Tracking ${ts}`;
    const category = `Fast Disable Lot Tracking ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: itemName,
      unitDefinitionId: unitId,
      sku: `FAST-DISABLE-LOTS-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const [location] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    if (!location?.id) throw new Error("Default inventory location not found.");

    const [otherLocation] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Overflow ${ts}`,
        code: `overflow-${ts}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });

    await db.transaction(async (tx) => {
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 4,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots",
        referenceType: "item",
        referenceId: itemId,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: location.id,
        itemId,
        quantity: 6,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots",
        referenceType: "item",
        referenceId: itemId,
      });
      await createPositiveStockEventInTx(tx, {
        organizationId: orgId,
        locationId: otherLocation.id,
        itemId,
        quantity: 9,
        unitCost: "2.00",
        eventType: "manual_adjustment_increase",
        eventSubtype: "fast_disable_lots_other_location",
        referenceType: "item",
        referenceId: itemId,
      });
    });

    const beforeLots = await db
      .select({ lotNumber: lots.lotNumber })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(beforeLots).toHaveLength(3);

    const modeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        family: {
          name: itemName,
          category,
          description: null,
          unitDefinitionId: unitId,
          lotTrackingMode: "untracked",
        },
      }),
    });
    expect(
      modeResponse.status,
      JSON.stringify(await modeResponse.json().catch(() => null))
    ).toBe(200);

    let lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toEqual([
      expect.objectContaining({
        lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
        quantity: "19.0000",
      }),
    ]);

    const eventRows = await db
      .select({ lotId: inventoryEvents.lotId })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, itemId));
    expect(new Set(eventRows.map((event) => event.lotId))).toEqual(
      new Set([lotRows[0].id])
    );

    const untrackedBalances = await db
      .select({
        locationId: inventoryLotBalances.locationId,
        quantity: inventoryLotBalances.quantity,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.lotId, lotRows[0].id),
          eq(inventoryLotBalances.disposition, "available")
        )
      )
      .orderBy(inventoryLotBalances.locationId);
    expect(untrackedBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId: location.id, quantity: "10.0000" }),
        expect.objectContaining({ locationId: otherLocation.id, quantity: "9.0000" }),
      ])
    );

    const trackedModeResponse = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        family: {
          name: itemName,
          category,
          description: null,
          unitDefinitionId: unitId,
          lotTrackingMode: "tracked",
        },
      }),
    });
    expect(
      trackedModeResponse.status,
      JSON.stringify(await trackedModeResponse.json().catch(() => null))
    ).toBe(200);

    lotRows = await db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0]?.lotNumber).toMatch(/^LOT-\d{4}-\d{2}-\d{2}/);
    expect(lotRows[0]?.quantity).toBe("19.0000");
  });

  test("stock transfer preserves lot identity, cost, and projection truth across locations", async ({
    db,
  }) => {
    const item = await createItem({
      itemType: "material",
      name: `Fast Transfer ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-TRANSFER-${ts}`,
      category: `Fast Transfer ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      lotTrackingMode: "tracked",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const day = 24 * 60 * 60 * 1000;
    for (const [offset, cost] of [
      [2, "2"],
      [1, "3"],
    ] as const) {
      const seeded = await testFetch(`/api/items/${itemId}/initial-stock`, {
        method: "POST",
        body: JSON.stringify({
          quantity: "10",
          costPerUnit: cost,
          occurredAt: new Date(ts - offset * day).toISOString(),
          note: null,
        }),
      });
      expect(seeded.ok).toBe(true);
    }

    const [defaultLocation] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const [otherLocation] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Fast Transfer Target ${ts}`,
        code: `fast-transfer-${ts}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });

    const response = await testFetch("/api/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: defaultLocation.id,
        toLocationId: otherLocation.id,
        lines: [{ itemId, quantity: "12" }],
      }),
    });
    expect(response.status).toBe(201);
    const transferId = (await response.json()).id as string;

    const events = await db
      .select()
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "inventory_transfer"),
          eq(inventoryEvents.referenceId, transferId)
        )
      );
    const outs = events.filter((event) => event.eventType === "transfer_out");
    const ins = events.filter((event) => event.eventType === "transfer_in");
    expect(outs).toHaveLength(2);
    expect(ins).toHaveLength(2);
    for (const inEvent of ins) {
      const parent = outs.find((out) => out.id === inEvent.parentEventId);
      expect(parent).toBeTruthy();
      expect(parent!.locationId).toBe(defaultLocation.id);
      expect(inEvent.locationId).toBe(otherLocation.id);
      expect(parent!.lotId).toBe(inEvent.lotId);
      expect(parent!.quantity).toBe(inEvent.quantity);
      expect(parent!.extendedCost).toBe(inEvent.extendedCost);
    }

    // FIFO: the older 10 @ 2.00 lot drains first, then 2 @ 3.00; the
    // destination balance keeps each lot's identity, cost, and received age.
    const destBalances = await db
      .select({
        lotId: inventoryLotBalances.lotId,
        quantity: inventoryLotBalances.quantity,
        unitCost: inventoryLotBalances.unitCost,
        receivedAt: inventoryLotBalances.receivedAt,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.itemId, itemId),
          eq(inventoryLotBalances.locationId, otherLocation.id)
        )
      )
      .orderBy(inventoryLotBalances.receivedAt);
    expect(destBalances).toHaveLength(2);
    expect(destBalances[0]).toMatchObject({ quantity: "10.0000", unitCost: "2.000000" });
    expect(destBalances[1]).toMatchObject({ quantity: "2.0000", unitCost: "3.000000" });

    const sourceLots = await db
      .select({ id: lots.id, quantity: lots.quantity, receivedAt: lots.receivedAt })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    // Org-wide lot quantity is location-invariant: a transfer nets to zero.
    expect(sourceLots.map((lot) => lot.quantity).sort()).toEqual([
      "10.0000",
      "10.0000",
    ]);
    const olderLot = sourceLots.find((lot) => lot.id === destBalances[0].lotId);
    expect(destBalances[0].receivedAt.getTime()).toBe(olderLot!.receivedAt!.getTime());

    const itemBalances = await db
      .select({
        locationId: inventoryItemBalances.locationId,
        onHandQty: inventoryItemBalances.onHandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, itemId));
    expect(
      itemBalances.find((row) => row.locationId === defaultLocation.id)?.onHandQty
    ).toBe("8.0000");
    expect(
      itemBalances.find((row) => row.locationId === otherLocation.id)?.onHandQty
    ).toBe("12.0000");
  });

  test("output reversal exits each output's recorded location, surviving re-outputs", async ({
    db,
  }) => {
    const material = await createItem({
      itemType: "material",
      name: `Fast RevAttr Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-REVATTR-M-${ts}`,
      category: `Fast RevAttr ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      lotTrackingMode: "tracked",
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id as string;
    const product = await createItem({
      itemType: "product",
      name: `Fast RevAttr Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-REVATTR-P-${ts}`,
      category: `Fast RevAttr ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      lotTrackingMode: "tracked",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const [defaultLocation] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const [locationB] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Fast RevAttr B ${ts}`,
        code: `fast-revattr-${ts}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });
    const moved = await testFetch("/api/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: defaultLocation.id,
        toLocationId: locationB.id,
        lines: [{ itemId: materialId, quantity: "4" }],
      }),
    });
    expect(moved.status).toBe(201);

    const mo = await createManufacturingOrder({
      productId,
      plannedQuantity: "10",
      ingredients: [{ itemId: materialId, quantityPerUnit: "1" }],
    });
    expect(mo.status, JSON.stringify(mo.body)).toBe(201);
    const moId = mo.body.id as string;
    expect((await releaseManufacturingOrder(moId)).status).toBe(200);
    const recordOutput = async (body: Record<string, unknown>) => {
      const res = await testFetch(`/api/manufacturing-orders/${moId}/outputs`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(res.status, await res.text().catch(() => "")).toBe(200);
    };

    // Produce at B and fully reverse; the take-back must come out of B even
    // though the reversal names no location (outputs record where they landed).
    await recordOutput({ locationId: locationB.id, quantity: "4" });
    await recordOutput({ quantity: "-4" });
    // Re-output at the default, then reverse: per-row reversed-quantity
    // attribution must charge this reversal to the live default row, not
    // re-walk onto the already-reversed (empty) B row.
    await recordOutput({ quantity: "3" });
    await recordOutput({ quantity: "-3" });

    const reversalEvents = await db
      .select({ locationId: inventoryEvents.locationId })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, moId),
          eq(inventoryEvents.eventSubtype, "manufacturing_output_reversal"),
          // The physical take-back legs only — the planning re-adds share the
          // subtype but are pinned to the default by design.
          eq(inventoryEvents.eventType, "manual_adjustment_decrease"),
          eq(inventoryEvents.itemId, productId)
        )
      );
    expect(reversalEvents.map((event) => event.locationId).sort()).toEqual(
      [defaultLocation.id, locationB.id].sort()
    );

    const balances = await db
      .select({
        itemId: inventoryItemBalances.itemId,
        locationId: inventoryItemBalances.locationId,
        onHandQty: inventoryItemBalances.onHandQty,
      })
      .from(inventoryItemBalances)
      .where(inArray(inventoryItemBalances.itemId, [materialId, productId]));
    const qty = (itemId: string, locationId: string) =>
      balances.find((row) => row.itemId === itemId && row.locationId === locationId)
        ?.onHandQty ?? "0.0000";
    expect(qty(productId, defaultLocation.id)).toBe("0.0000");
    expect(qty(productId, locationB.id)).toBe("0.0000");
    expect(qty(materialId, defaultLocation.id)).toBe("6.0000");
    expect(qty(materialId, locationB.id)).toBe("4.0000");
  });

  test("stock transfer API rejects replay drift and non-addressable inputs", async ({
    db,
  }) => {
    const item = await createItem({
      itemType: "material",
      name: `Fast Transfer Boundary ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-TRANSFER-BOUNDARY-${ts}`,
      category: `Fast Transfer Boundary ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      lotTrackingMode: "tracked",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const seeded = await testFetch(`/api/items/${itemId}/initial-stock`, {
      method: "POST",
      body: JSON.stringify({
        quantity: "5",
        costPerUnit: "2.00",
        occurredAt: new Date().toISOString(),
        note: null,
      }),
    });
    expect(seeded.status).toBe(200);

    const [defaultLocation] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const [otherLocation] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Fast Transfer Boundary Target ${ts}`,
        code: `fast-transfer-boundary-${ts}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });

    async function postTransfer(body: unknown, idempotencyKey: string) {
      const response = await fetch(`${getBaseUrl()}/api/inventory/transfers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: getSessionCookie(),
          Origin: getBaseUrl(),
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
      };
    }

    const payload = {
      fromLocationId: defaultLocation.id,
      toLocationId: otherLocation.id,
      note: "first note",
      lines: [{ itemId, quantity: "1" }],
    };
    const idempotencyKey = `fast-transfer-boundary:${randomUUID()}`;
    const first = await postTransfer(payload, idempotencyKey);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const changedNote = await postTransfer(
      { ...payload, note: "changed note" },
      idempotencyKey
    );
    expect(changedNote.status, JSON.stringify(changedNote.body)).toBe(409);

    const tiny = await postTransfer(
      {
        fromLocationId: defaultLocation.id,
        toLocationId: otherLocation.id,
        lines: [{ itemId, quantity: "0.00001" }],
      },
      `fast-transfer-tiny:${randomUUID()}`
    );
    expect(tiny.status, JSON.stringify(tiny.body)).toBe(400);

    await db
      .update(items)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(items.id, itemId));
    const deletedTransfer = await postTransfer(
      {
        fromLocationId: defaultLocation.id,
        toLocationId: otherLocation.id,
        lines: [{ itemId, quantity: "1" }],
      },
      `fast-transfer-deleted:${randomUUID()}`
    );
    expect(deletedTransfer.status, JSON.stringify(deletedTransfer.body)).toBe(404);

    const balances = await testFetch(`/api/items/${itemId}/location-balances`);
    expect(balances.status, JSON.stringify(await balances.json().catch(() => null))).toBe(
      404
    );

    const transferRows = await db
      .select({ id: inventoryTransfers.id })
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.toLocationId, otherLocation.id));
    expect(transferRows).toEqual([{ id: first.body.id }]);
  });

  test("lot quantity edit cancel restores the UI draft without writing stock", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const item = await createItem({
      itemType: "material",
      name: `Fast Lot Cancel ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-LOT-CANCEL-${unique}`,
      category: `Fast Lot Cancel ${unique}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    await page.goto(`/inventory/materials/${itemId}?tab=lots`);
    await expect(page.getByRole("heading", { name: /Lots · 5 on hand/ })).toBeVisible();
    const quantityCell = page.locator('.ag-cell[col-id="quantity"]').first();
    await expect(quantityCell).toContainText("5");

    await quantityCell.dblclick();
    const input = quantityCell.locator("input");
    await expect(input).toBeVisible();
    await input.fill("3");
    await input.press("Enter");
    await expect(page.getByRole("alertdialog", { name: "Adjust this lot?" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("alertdialog", { name: "Adjust this lot?" })).toBeHidden();
    await expect(quantityCell).toContainText("5");

    const [lot] = await db
      .select({ quantity: lots.quantity })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(lot?.quantity).toBe("5.0000");
  });

  test("tracked item lots stay reachable from an invalid untracked draft", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const item = await createItem({
      itemType: "material",
      name: `Fast Lot Reachable ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-LOT-REACH-${unique}`,
      category: `Fast Lot Reachable ${unique}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      lotTrackingMode: "tracked",
      stock: "5",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    await page.goto(`/inventory/materials/${itemId}`);
    await page.getByLabel("Material name").fill("");
    await page.getByLabel("Lot tracked").uncheck();

    await page.getByRole("button", { name: /Lots/ }).click();
    await expect(page.getByRole("heading", { name: /Lots · 5 on hand/ })).toBeVisible();
  });

  test("tracked product lots stay reachable from an invalid untracked draft", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const item = await createItem({
      itemType: "product",
      name: `Fast Product Lot Reachable ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-PROD-LOT-REACH-${unique}`,
      category: `Fast Product Lot Reachable ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "4.00",
      lotTrackingMode: "tracked",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    await page.goto(`/inventory/products/${itemId}`);
    await page.getByLabel("Product name").fill("");
    await page.getByLabel("Lot tracked").uncheck();

    await page.getByRole("link", { name: /Lots/ }).click();
    await expect(page.getByRole("heading", { name: /^Lots/ })).toBeVisible();
  });

  test("stocktake count becomes authoritative stock truth", async ({ db }) => {
    const category = `Fast Stocktake ${ts}`;
    const item = await createItem({
      itemType: "material",
      name: `Fast Stocktake Material ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-STOCKTAKE-${ts}`,
      category,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Stocktake ${ts}`,
        scope: buildStocktakeCategoryScope("material", category),
        reason: "cycle_count",
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    const [line] = await db
      .select({ id: stocktakeItems.id })
      .from(stocktakeItems)
      .where(
        and(
          eq(stocktakeItems.stocktakeId, stocktake.id),
          eq(stocktakeItems.itemId, itemId)
        )
      );
    expect(line?.id).toBeTruthy();

    const [lotLine] = await db
      .select({ id: stocktakeLotItems.id, lotId: stocktakeLotItems.lotId })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, line.id));
    expect(lotLine?.id).toBeTruthy();
    const lotId = lotLine?.lotId;
    expect(lotId).toBeTruthy();

    const saveResponse = await testFetch(`/api/stocktakes/${stocktake.id}`, {
      method: "PUT",
      body: JSON.stringify({
        lines: [],
        lotLines: [{ lotLineId: lotLine.id, countedQty: "3" }],
      }),
    });
    expect(saveResponse.status).toBe(200);

    const completeResponse = await testFetch(
      `/api/stocktakes/${stocktake.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ confirmStale: false, reason: "cycle_count" }),
      }
    );
    expect(completeResponse.status).toBe(200);

    const [completed] = await db
      .select({ status: stocktakes.status })
      .from(stocktakes)
      .where(eq(stocktakes.id, stocktake.id));
    expect(completed.status).toBe("completed");

    const [lotTotal] = await db
      .select({ quantity: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
      .from(lots)
      .where(eq(lots.itemId, itemId));
    expect(Number(lotTotal.quantity)).toBe(3);

    const events = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(sql`${inventoryEvents.metadata}->>'stocktakeId' = ${stocktake.id}`);
    expect(events.some((event) => event.eventType === "stocktake_loss")).toBe(true);
  });

  test("stocktake UI count queue persists rapid row edits while a save is in flight", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const category = `Fast Stocktake Queue ${unique}`;
    const firstItem = await createItem({
      itemType: "material",
      name: `Fast Stocktake Queue A ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-STQ-A-${unique}`,
      category,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      lotTrackingMode: "untracked",
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(firstItem.status).toBe(201);
    const secondItem = await createItem({
      itemType: "material",
      name: `Fast Stocktake Queue B ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-STQ-B-${unique}`,
      category,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      lotTrackingMode: "untracked",
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(secondItem.status).toBe(201);

    const stocktakeResponse = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Stocktake Queue ${unique}`,
        scope: buildStocktakeCategoryScope("material", category),
        reason: "cycle_count",
        notes: null,
      }),
    });
    expect(stocktakeResponse.status).toBe(201);
    const stocktake = await stocktakeResponse.json();

    let delayedFirstPut = false;
    let markPutStarted: () => void = () => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    await page.route(`**/api/stocktakes/${stocktake.id}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        markPutStarted();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/inventory/stocktakes/${stocktake.id}`);
    await expectRows(page, 4);
    await editGridCell(page, "countedQty", "7", 1);
    await putStarted;
    await editGridCell(page, "countedQty", "13", 3);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const savedLotLines = await db
      .select({
        itemId: stocktakeItems.itemId,
        countedQty: stocktakeLotItems.countedQty,
        varianceQty: stocktakeLotItems.varianceQty,
      })
      .from(stocktakeLotItems)
      .innerJoin(stocktakeItems, eq(stocktakeLotItems.stocktakeItemId, stocktakeItems.id))
      .where(eq(stocktakeItems.stocktakeId, stocktake.id));
    expect(savedLotLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: firstItem.body.id,
          countedQty: "7.0000",
          varianceQty: "-3.0000",
        }),
        expect.objectContaining({
          itemId: secondItem.body.id,
          countedQty: "13.0000",
          varianceQty: "-7.0000",
        }),
      ]),
    );

    await page.reload();
    await expectRows(page, 4);
    await expect(
      editableGrid(page).locator('.ag-row[row-index="1"] .ag-cell[col-id="countedQty"]'),
    ).toContainText("7");
    await expect(
      editableGrid(page).locator('.ag-row[row-index="3"] .ag-cell[col-id="countedQty"]'),
    ).toContainText("13");
  });

  test("item card clone copies variant structure and current recipe without stock", async ({
    db,
  }) => {
    const [resource] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Fast Clone Labor ${ts}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id });

    const component = await createItem({
      itemType: "material",
      name: `Fast Clone Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-CLONE-COMP-${ts}`,
      category: `Fast Clone ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Clone Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-CLONE-PROD-${ts}`,
      category: `Fast Clone ${ts}`,
      description: "Clone source",
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      registeredBarcode: `REG-${ts}`,
      internalBarcode: `INT-${ts}`,
      stock: "7",
      safetyStock: "3",
      bom: [{ componentId: component.body.id, quantity: "2" }],
      operationCosts: [
        {
          operationName: "Assembly",
          resourceId: resource.id,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "10",
          loadedCostPerHour: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const sourceItemId = product.body.id as string;

    const configResponse = await testFetch(
      `/api/item-cards/${sourceItemId}/variant-config`,
      {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              name: "Size",
              code: "size",
              values: [
                { label: "Small", code: "small" },
                { label: "Large", code: "large" },
              ],
            },
          ],
        }),
      },
    );
    expect(configResponse.status).toBe(200);

    const generateResponse = await testFetch(
      `/api/item-cards/${sourceItemId}/variants/generate`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(generateResponse.status).toBe(201);

    const sourceCardResponse = await testFetch(`/api/item-cards/${sourceItemId}`);
    expect(sourceCardResponse.status).toBe(200);
    const sourceCard = await sourceCardResponse.json();
    const sizeOption = sourceCard.options[0] as {
      id: string;
      name: string;
      values: Array<{ id: string; label: string }>;
    };
    const focusedGeneratedVariantId = sourceCard.variants.find(
      (variant: { id: string }) => variant.id !== sourceItemId,
    )?.id as string;
    expect(focusedGeneratedVariantId).toBeTruthy();

    const expandedConfigResponse = await testFetch(
      `/api/item-cards/${focusedGeneratedVariantId}/variant-config`,
      {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              id: sizeOption.id,
              name: sizeOption.name,
              values: [
                ...sizeOption.values.map((value) => ({
                  id: value.id,
                  label: value.label,
                })),
                { label: "Medium" },
              ],
            },
          ],
        }),
      },
    );
    expect(expandedConfigResponse.status).toBe(200);
    const expandedCard = await expandedConfigResponse.json();
    const mediumValue = expandedCard.options[0].values.find(
      (value: { label: string }) => value.label === "Medium",
    ) as { id: string } | undefined;
    expect(mediumValue?.id).toBeTruthy();

    const focusedGenerateResponse = await testFetch(
      `/api/item-cards/${focusedGeneratedVariantId}/variants/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          combinations: [
            {
              [sizeOption.id]: mediumValue?.id,
            },
          ],
        }),
      },
    );
    expect(focusedGenerateResponse.status).toBe(201);

    const cloneIdempotencyKey = `fast-clone-card:${ts}:${sourceItemId}`;
    const cloneResponse = await testFetch(`/api/item-cards/${sourceItemId}/clone`, {
      method: "POST",
      headers: { "Idempotency-Key": cloneIdempotencyKey },
    });
    expect(cloneResponse.status).toBe(201);
    const cloneBody = await cloneResponse.json();
    const clonedItemId = cloneBody.itemId as string;
    expect(clonedItemId).not.toBe(sourceItemId);

    const cloneReplayResponse = await testFetch(`/api/item-cards/${sourceItemId}/clone`, {
      method: "POST",
      headers: { "Idempotency-Key": cloneIdempotencyKey },
    });
    expect(cloneReplayResponse.status).toBe(201);
    const cloneReplayBody = await cloneReplayResponse.json();
    expect(cloneReplayBody.itemId).toBe(clonedItemId);

    const clonedCardResponse = await testFetch(`/api/item-cards/${clonedItemId}`);
    expect(clonedCardResponse.status).toBe(200);
    const clonedCard = await clonedCardResponse.json();

    expect(clonedCard.family.name).toBe(`Copy of Fast Clone Product ${ts}`);
    expect(clonedCard.family.category).toBe(`Fast Clone ${ts}`);
    expect(clonedCard.options).toHaveLength(1);
    expect(clonedCard.options[0].values).toHaveLength(3);
    expect(clonedCard.variants).toHaveLength(3);
    expect(
      clonedCard.variants.every(
        (variant: {
          sku: string | null;
          registeredBarcode: string | null;
          internalBarcode: string | null;
          optionValues: unknown[];
        }) =>
          variant.sku === null &&
          variant.registeredBarcode === null &&
          variant.internalBarcode === null &&
          variant.optionValues.length === 1,
      ),
    ).toBe(true);

    const clonedVariantIds = clonedCard.variants.map(
      (variant: { id: string }) => variant.id,
    );
    const [clonedStock] = await db
      .select({
        onHandQty: sql<string>`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`,
      })
      .from(inventoryItemBalances)
      .where(inArray(inventoryItemBalances.itemId, clonedVariantIds));
    expect(Number(clonedStock.onHandQty)).toBe(0);

    const clonedBomRows = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, clonedItemId), eq(bomRevisions.isCurrent, true)));
    expect(clonedBomRows).toHaveLength(1);

    const clonedComponentRows = await db
      .select({ id: bomRevisionComponents.id })
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, clonedBomRows[0].id));
    expect(clonedComponentRows).toHaveLength(1);

    const clonedOperationRows = await db
      .select({ id: bomRevisionOperationCosts.id })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, clonedBomRows[0].id));
    expect(clonedOperationRows).toHaveLength(1);

    const [clonedFamily] = await db
      .select({ id: itemFamilies.id })
      .from(items)
      .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, clonedItemId));
    const clonedOptions = await db
      .select({ id: variantOptions.id })
      .from(variantOptions)
      .where(eq(variantOptions.familyId, clonedFamily.id));
    const clonedValues = await db
      .select({ id: variantOptionValues.id })
      .from(variantOptionValues)
      .innerJoin(variantOptions, eq(variantOptionValues.optionId, variantOptions.id))
      .where(eq(variantOptions.familyId, clonedFamily.id));
    const clonedAssignments = await db
      .select({ itemId: itemVariantValues.itemId })
      .from(itemVariantValues)
      .where(inArray(itemVariantValues.itemId, clonedVariantIds));
    expect(clonedOptions).toHaveLength(1);
    expect(clonedValues).toHaveLength(3);
    expect(clonedAssignments).toHaveLength(3);
  });

  test("product clone action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Clone UI Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-CLONE-UI-${unique}`,
      category: `Fast Clone UI ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const sourceItemId = product.body.id as string;
    const description = `Dirty clone description ${unique}`;

    await page.goto(`/inventory/products/${sourceItemId}`);
    const infoInput = page.getByLabel("Description");
    await expect(infoInput).toBeVisible();
    await infoInput.fill(description);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Clone product" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/inventory/products/") &&
        url.pathname !== `/inventory/products/${sourceItemId}`
      );
    });
    const clonedItemId = page.url().split("/").pop();
    expect(clonedItemId).toBeTruthy();
    expect(clonedItemId).not.toBe(sourceItemId);

    const itemRows = await db
      .select({ id: items.id, familyId: items.familyId })
      .from(items)
      .where(inArray(items.id, [sourceItemId, clonedItemId as string]));
    expect(itemRows).toHaveLength(2);
    const familyIds = itemRows
      .map((row) => row.familyId)
      .filter((id): id is string => id != null);

    const familyRows = await db
      .select({
        id: itemFamilies.id,
        description: itemFamilies.description,
      })
      .from(itemFamilies)
      .where(inArray(itemFamilies.id, familyIds));
    expect(familyRows.map((row) => row.description).sort()).toEqual(
      [description, description].sort(),
    );
  });

  test("material clone action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast Clone UI Material ${unique}`,
      sellable: false,
      unitDefinitionId: unitId,
      sku: `FAST-MAT-CLONE-${unique}`,
      category: `Fast Clone UI ${unique}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status, JSON.stringify(material.body)).toBe(201);
    const sourceItemId = material.body.id as string;
    const description = `Dirty material clone description ${unique}`;

    await page.goto(`/inventory/materials/${sourceItemId}`);
    const infoInput = page.getByLabel("Additional info");
    await expect(infoInput).toBeVisible();
    await infoInput.fill(description);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Clone material" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/inventory/materials/") &&
        url.pathname !== `/inventory/materials/${sourceItemId}`
      );
    });
    const clonedItemId = page.url().split("/").pop();
    expect(clonedItemId).toBeTruthy();
    expect(clonedItemId).not.toBe(sourceItemId);

    const itemRows = await db
      .select({ id: items.id, familyId: items.familyId })
      .from(items)
      .where(inArray(items.id, [sourceItemId, clonedItemId as string]));
    expect(itemRows).toHaveLength(2);
    const familyIds = itemRows
      .map((row) => row.familyId)
      .filter((id): id is string => id != null);

    const familyRows = await db
      .select({
        id: itemFamilies.id,
        description: itemFamilies.description,
      })
      .from(itemFamilies)
      .where(inArray(itemFamilies.id, familyIds));
    expect(familyRows.map((row) => row.description).sort()).toEqual(
      [description, description].sort(),
    );
  });

  test("recipe-only BOM revision preserves production operations", async ({ db }) => {
    const unique = randomUUID().slice(0, 8);
    const [resource] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Fast Recipe Labor ${unique}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id });

    const component = await createItem({
      itemType: "material",
      name: `Fast Recipe Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-RECIPE-COMP-${unique}`,
      category: `Fast Recipe ${unique}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Recipe Product ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-RECIPE-PROD-${unique}`,
      category: `Fast Recipe ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
      operationCosts: [
        {
          operationName: "Mixing",
          resourceId: resource.id,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "10",
          loadedCostPerHour: "60",
        },
      ],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const saveRecipe = await testFetch(`/api/items/${productId}/bom-revisions`, {
      method: "POST",
      body: JSON.stringify({
        recipeBasis: "unit",
        outputQuantity: "1",
        bom: [{ componentId: component.body.id, quantity: "2" }],
        note: "Recipe-only change",
      }),
    });
    expect(saveRecipe.status).toBe(201);

    const [currentRevision] = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));
    expect(currentRevision).toBeTruthy();

    const componentRows = await db
      .select({ quantity: bomRevisionComponents.quantity })
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, currentRevision.id));
    expect(componentRows.map((row) => Number(row.quantity))).toEqual([2]);

    const operationRows = await db
      .select({ operationName: bomRevisionOperationCosts.operationName })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, currentRevision.id));
    expect(operationRows.map((row) => row.operationName)).toEqual(["Mixing"]);

    const updateRecipeOnly = await updateItem(productId, {
      bom: [{ componentId: component.body.id, quantity: "3" }],
      revisionNote: "BOM-only helper change",
    });
    expect(updateRecipeOnly.status).toBe(200);

    const [nextRevision] = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));
    expect(nextRevision).toBeTruthy();

    const nextComponentRows = await db
      .select({ quantity: bomRevisionComponents.quantity })
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, nextRevision.id));
    expect(nextComponentRows.map((row) => Number(row.quantity))).toEqual([3]);

    const nextOperationRows = await db
      .select({ operationName: bomRevisionOperationCosts.operationName })
      .from(bomRevisionOperationCosts)
      .where(eq(bomRevisionOperationCosts.bomRevisionId, nextRevision.id));
    expect(nextOperationRows.map((row) => row.operationName)).toEqual(["Mixing"]);
  });

  test("product recipe deep links drop deleted variant focus", async ({ page }) => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Deleted Variant Link ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-DELETED-VARIANT-${unique}`,
      category: `Fast Variant ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      registeredBarcode: null,
      internalBarcode: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status).toBe(201);
    const itemId = product.body.id as string;

    const configResponse = await testFetch(`/api/item-cards/${itemId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Focus",
            values: [{ label: "Keep" }, { label: "Delete" }],
          },
        ],
      }),
    });
    expect(configResponse.status).toBe(200);

    const generateResponse = await testFetch(`/api/item-cards/${itemId}/variants/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(generateResponse.status).toBe(201);

    const cardResponse = await testFetch(`/api/item-cards/${itemId}`);
    expect(cardResponse.status).toBe(200);
    const card = await cardResponse.json();
    const deletedVariant = card.variants.find(
      (variant: { id: string; optionValues: Array<{ valueLabel: string }> }) =>
        variant.optionValues.some((value) => value.valueLabel === "Delete"),
    );
    const remainingVariant = card.variants.find(
      (variant: {
        id: string;
        displayName: string;
        optionValues: Array<{ valueLabel: string }>;
      }) => variant.optionValues.some((value) => value.valueLabel === "Keep"),
    );
    expect(deletedVariant?.id).toBeTruthy();
    expect(remainingVariant?.id).toBeTruthy();

    const deleteResponse = await testFetch(`/api/items/${deletedVariant.id}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    expect(deleteResponse.status).toBe(200);

    await page.goto(`/inventory/products/${itemId}/recipe?variant=${deletedVariant.id}`);
    await expect(
      page.getByText(`Any changes made here only affect ${remainingVariant.displayName}.`),
    ).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`variant=${deletedVariant.id}`));
  });

  test("manual variant row creation accepts duplicate option combinations", async () => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Manual Variant Row ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-MANUAL-VARIANT-${unique}`,
      category: `Fast Manual Variant Row ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      registeredBarcode: null,
      internalBarcode: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status).toBe(201);
    const itemId = product.body.id as string;

    const configResponse = await testFetch(`/api/item-cards/${itemId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Pack",
            values: [{ label: "1 ct" }, { label: "2 ct" }],
          },
        ],
      }),
    });
    expect(configResponse.status).toBe(200);

    const generateResponse = await testFetch(`/api/item-cards/${itemId}/variants/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(generateResponse.status).toBe(201);

    const cardResponse = await testFetch(`/api/item-cards/${itemId}`);
    expect(cardResponse.status).toBe(200);
    const card = await cardResponse.json();
    const option = card.options[0] as {
      id: string;
      name: string;
      values: Array<{ id: string; label: string }>;
    };
    const duplicateValue = option.values.find((value) => value.label === "1 ct");
    expect(duplicateValue?.id).toBeTruthy();

    const createVariantKey = `fast-create-variant-replay:${unique}`;
    const createDuplicateResponse = await testFetch(`/api/item-cards/${itemId}/variant`, {
      method: "POST",
      headers: { "Idempotency-Key": createVariantKey },
      body: JSON.stringify({
        optionValueIdsByOptionId: {
          [option.id]: duplicateValue!.id,
        },
        sku: `FAST-MANUAL-VARIANT-DUP-${unique}`,
      }),
    });
    expect(createDuplicateResponse.status).toBe(201);
    const duplicateBody = await createDuplicateResponse.json();

    const createDuplicateReplayResponse = await testFetch(
      `/api/item-cards/${itemId}/variant`,
      {
        method: "POST",
        headers: { "Idempotency-Key": createVariantKey },
        body: JSON.stringify({
          optionValueIdsByOptionId: {
            [option.id]: duplicateValue!.id,
          },
          sku: `FAST-MANUAL-VARIANT-DUP-${unique}`,
        }),
      },
    );
    expect(createDuplicateReplayResponse.status).toBe(201);
    const duplicateReplayBody = await createDuplicateReplayResponse.json();
    expect(duplicateReplayBody.itemId).toBe(duplicateBody.itemId);

    const updatedCardResponse = await testFetch(`/api/item-cards/${itemId}`);
    expect(updatedCardResponse.status).toBe(200);
    const updatedCard = await updatedCardResponse.json();
    const activeVariants = updatedCard.variants.filter(
      (variant: { deletedAt: string | null }) => variant.deletedAt == null,
    );
    const duplicates = activeVariants.filter(
      (variant: { optionValues: Array<{ valueLabel: string }> }) =>
        variant.optionValues.some((value) => value.valueLabel === "1 ct"),
    );
    expect(activeVariants).toHaveLength(3);
    expect(duplicates).toHaveLength(2);
    expect(
      duplicates.every(
        (variant: { duplicateCombinationWarnings: unknown[] }) =>
          variant.duplicateCombinationWarnings.length > 0,
      ),
    ).toBe(true);
  });

  test("item-card create replays under the same idempotency key", async ({ db }) => {
    const unique = randomUUID().slice(0, 8);
    const name = `Fast Item Card Create Replay ${unique}`;
    const payload = {
      itemType: "material",
      name,
      category: `Fast Item Card Create Replay ${unique}`,
      description: null,
      unitDefinitionId: unitId,
      defaultSupplierId: null,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: `FAST-ITEM-CARD-CREATE-${unique}`,
      sellable: false,
      defaultSellingPrice: null,
      defaultPurchasePrice: "4.00",
      currentStockUnitCost: null,
      registeredBarcode: null,
      internalBarcode: null,
      supplierItemCode: null,
      defaultLeadTimeDays: null,
      minimumOrderQuantity: null,
      lotTrackingMode: "tracked",
    };
    const idempotencyKey = `fast-item-card-create-replay:${unique}`;
    const postCreate = () =>
      testFetch("/api/item-cards", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });

    const first = await postCreate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.itemId).toBe(firstBody.itemId);

    const families = await db
      .select({ id: itemFamilies.id })
      .from(itemFamilies)
      .where(eq(itemFamilies.name, name));
    expect(families).toHaveLength(1);
  });

  test("variant document shape changes bump the item-card document version", async ({ db }) => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Variant Version ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-VARIANT-VERSION-${unique}`,
      category: `Fast Variant Version ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      registeredBarcode: null,
      internalBarcode: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status).toBe(201);
    const itemId = product.body.id as string;

    const [beforeConfig] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .innerJoin(items, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, itemId));

    const configResponse = await testFetch(`/api/item-cards/${itemId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Pack",
            values: [{ label: "1 ct" }, { label: "2 ct" }],
          },
        ],
      }),
    });
    expect(configResponse.status).toBe(200);

    const [afterConfig] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .innerJoin(items, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, itemId));
    expect(afterConfig.version).toBeGreaterThan(beforeConfig.version);

    const generateResponse = await testFetch(`/api/item-cards/${itemId}/variants/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(generateResponse.status).toBe(201);

    const [afterGenerate] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .innerJoin(items, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, itemId));
    expect(afterGenerate.version).toBeGreaterThan(afterConfig.version);

    const cardResponse = await testFetch(`/api/item-cards/${itemId}`);
    expect(cardResponse.status).toBe(200);
    const card = await cardResponse.json();
    const familyId = card.family.id as string;
    const option = card.options[0] as {
      id: string;
      values: Array<{ id: string; label: string }>;
    };
    const duplicateValue = option.values.find((value) => value.label === "1 ct");
    expect(duplicateValue?.id).toBeTruthy();

    const [beforeCreate] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId));

    const createDuplicateResponse = await testFetch(`/api/item-cards/${itemId}/variant`, {
      method: "POST",
      body: JSON.stringify({
        optionValueIdsByOptionId: {
          [option.id]: duplicateValue!.id,
        },
        sku: `FAST-VARIANT-VERSION-DUP-${unique}`,
      }),
    });
    expect(createDuplicateResponse.status).toBe(201);
    const created = await createDuplicateResponse.json();
    const createdVariantId = created.itemId as string;

    const [afterCreate] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId));
    expect(afterCreate.version).toBeGreaterThan(beforeCreate.version);

    const deleteResponse = await testFetch(`/api/items/${createdVariantId}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    expect(deleteResponse.status).toBe(200);

    const [afterDelete] = await db
      .select({ version: itemFamilies.version })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, familyId));
    expect(afterDelete.version).toBeGreaterThan(afterCreate.version);
  });

  test("item-card stale save returns the shared conflict envelope with the fresh card", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Item Conflict ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-ITEM-CONFLICT-${unique}`,
      category: `Fast Item Conflict ${unique}`,
      description: "before",
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      registeredBarcode: null,
      internalBarcode: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status).toBe(201);
    const itemId = product.body.id as string;

    const detailResponse = await testFetch(`/api/item-cards/${itemId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    const basePayload = {
      family: {
        description: "before",
      },
      expectedVersion: detail.family.version,
    };

    const first = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...basePayload,
        family: { description: "first item writer" },
      }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/item-cards/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...basePayload,
        family: { description: "stale item writer" },
      }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.family.description).toBe("first item writer");
    expect(staleBody.current.family.version).toBe(detail.family.version + 1);
    expect(staleBody.card).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [family] = await db
      .select({
        description: itemFamilies.description,
        version: itemFamilies.version,
      })
      .from(itemFamilies)
      .where(eq(itemFamilies.id, detail.family.id));
    expect(family.description).toBe("first item writer");
    expect(family.version).toBe(detail.family.version + 1);
  });

  test("item-card document autosave preserves grid edits made during an in-flight save", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast Inflight Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-INFLIGHT-MAT-${unique}`,
      category: `Fast Inflight Material ${unique}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const itemId = material.body.id as string;
    const description = `Family save in flight ${unique}`;
    const supplierItemCode = `SUP-${unique}`;
    let delayedFirstPatch = false;

    await page.route(`**/api/item-cards/${itemId}`, async (route) => {
      if (route.request().method() === "PATCH" && !delayedFirstPatch) {
        delayedFirstPatch = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/inventory/materials/${itemId}`);
    const infoInput = page.getByLabel("Additional info");
    await expect(infoInput).toBeVisible();
    await infoInput.fill(description);
    await infoInput.blur();

    await page.getByRole("button", { name: "Supply" }).click();
    await editGridCell(page, "supplierItemCode", supplierItemCode);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await page.getByRole("button", { name: "Supply" }).click();

    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="supplierItemCode"]').first(),
    ).toContainText(supplierItemCode);

    const card = await (await testFetch(`/api/item-cards/${itemId}`)).json();
    expect(card.family.description).toBe(description);
    expect(card.variants[0]).toMatchObject({
      id: itemId,
      supplierItemCode,
    });
  });

  test("material stock adjustment blocks when item-card autosave is invalid", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast Stock Boundary Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-STOCK-BOUNDARY-${unique}`,
      category: `Fast Stock Boundary ${unique}`,
      description: null,
      defaultPurchasePrice: "9.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status, JSON.stringify(material.body)).toBe(201);
    const materialId = material.body.id as string;
    let adjustmentRequestCount = 0;

    await page.route(`**/api/items/${materialId}/stock-adjustments`, async (route) => {
      adjustmentRequestCount += 1;
      await route.continue();
    });

    await page.goto(`/inventory/materials/${materialId}`);
    const nameInput = page.getByLabel("Material name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("");

    await editGridCell(page, "inStock", "8");
    const dialog = page.getByRole("dialog", { name: "Reduce stock" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cycle count" }).click();
    await dialog.getByRole("button", { name: "Adjust stock" }).click();

    await expect(dialog.getByText("Name is required")).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(adjustmentRequestCount).toBe(0);

    const events = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.itemId, materialId));
    expect(events.map((event) => event.eventType)).not.toContain(
      "manual_adjustment_decrease",
    );
  });

  test("product recipe save blocks when item-card autosave is invalid", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Recipe Boundary Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-RECIPE-BOUNDARY-COMP-${unique}`,
      category: `Fast Recipe Boundary ${unique}`,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Recipe Boundary Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-RECIPE-BOUNDARY-PROD-${unique}`,
      category: `Fast Recipe Boundary ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const productId = product.body.id as string;
    let revisionRequestCount = 0;

    const beforeRevisions = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));

    await page.route(`**/api/items/${productId}/bom-revisions`, async (route) => {
      revisionRequestCount += 1;
      await route.continue();
    });

    await page.goto(`/inventory/products/${productId}`);
    const nameInput = page.getByLabel("Product name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("");
    await page.getByRole("link", { name: "Recipe" }).click();
    await expect(
      page.getByRole("heading", { name: "Recipe / Bill of Materials" }),
    ).toBeVisible();

    await editGridCell(page, "quantity", "2");
    await page.getByRole("button", { name: "Save recipe" }).click();
    const dialog = page.getByRole("dialog", { name: "Save recipe" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Save recipe" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Name is required" }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(revisionRequestCount).toBe(0);

    const afterRevisions = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));
    expect(afterRevisions).toHaveLength(beforeRevisions.length);
  });

  test("legacy IDs and partial existing variants do not block recipe save or copy", async ({
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Variant Compatibility Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-VARIANT-COMPAT-COMP-${unique}`,
      category: `Fast Variant Compatibility ${unique}`,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    const product = await createItem({
      itemType: "product",
      name: `Fast Variant Compatibility Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-VARIANT-COMPAT-PROD-${unique}`,
      category: `Fast Variant Compatibility ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const sourceId = product.body.id as string;
    const [source] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, sourceId));

    const packageOptionId = nonRfcPostgresUuid();
    const packageValueId = nonRfcPostgresUuid();
    const focusOptionId = randomUUID();
    const gardenValueId = randomUUID();
    const industrialValueId = randomUUID();
    await db.insert(variantOptions).values([
      {
        id: packageOptionId,
        organizationId: orgId,
        familyId: source.familyId!,
        name: "Package",
        code: `package_${unique}`,
        sortOrder: 0,
      },
      {
        id: focusOptionId,
        organizationId: orgId,
        familyId: source.familyId!,
        name: "Focus",
        code: `focus_${unique}`,
        sortOrder: 1,
      },
    ]);
    await db.insert(variantOptionValues).values([
      {
        id: packageValueId,
        organizationId: orgId,
        optionId: packageOptionId,
        label: "1.5 cf bag",
        code: `bag_${unique}`,
      },
      {
        id: gardenValueId,
        organizationId: orgId,
        optionId: focusOptionId,
        label: "Garden",
        code: `garden_${unique}`,
        sortOrder: 0,
      },
      {
        id: industrialValueId,
        organizationId: orgId,
        optionId: focusOptionId,
        label: "Industrial",
        code: `industrial_${unique}`,
        sortOrder: 1,
      },
    ]);
    await db.insert(itemVariantValues).values({
      organizationId: orgId,
      itemId: sourceId,
      optionId: packageOptionId,
      optionValueId: packageValueId,
    });

    const incompleteCreate = await testFetch(`/api/item-cards/${sourceId}/variant`, {
      method: "POST",
      body: JSON.stringify({
        optionValueIdsByOptionId: {
          [packageOptionId]: packageValueId,
        },
        sku: `FAST-VARIANT-COMPAT-INCOMPLETE-${unique}`,
      }),
    });
    expect(incompleteCreate.status, await incompleteCreate.text()).toBe(400);

    const targetIds: string[] = [];
    for (const [valueId, sku] of [
      [gardenValueId, `FAST-VARIANT-COMPAT-GARDEN-${unique}`],
      [industrialValueId, `FAST-VARIANT-COMPAT-INDUSTRIAL-${unique}`],
    ]) {
      const response = await testFetch(`/api/item-cards/${sourceId}/variant`, {
        method: "POST",
        body: JSON.stringify({
          optionValueIdsByOptionId: {
            [packageOptionId]: packageValueId,
            [focusOptionId]: valueId,
          },
          sku,
          sellable: true,
        }),
      });
      expect(response.status, await response.text()).toBe(201);
      targetIds.push((await response.json()).itemId);
    }

    const card = await (await testFetch(`/api/item-cards/${sourceId}`)).json();
    const partialUpdate = await testFetch(`/api/item-cards/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        variants: [
          {
            id: sourceId,
            optionValueIdsByOptionId: {
              [packageOptionId]: packageValueId,
            },
          },
        ],
        expectedVersion: card.family.version,
      }),
    });
    expect(partialUpdate.status, await partialUpdate.text()).toBe(200);

    const emptyUpdate = await testFetch(`/api/item-cards/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        variants: [
          {
            id: sourceId,
            optionValueIdsByOptionId: {},
          },
        ],
        expectedVersion: card.family.version + 1,
      }),
    });
    expect(emptyUpdate.status, await emptyUpdate.text()).toBe(400);
    const sourceAssignments = await db
      .select({ optionId: itemVariantValues.optionId })
      .from(itemVariantValues)
      .where(eq(itemVariantValues.itemId, sourceId));
    expect(sourceAssignments).toEqual([{ optionId: packageOptionId }]);

    await page.goto(`/inventory/products/${sourceId}/recipe`);
    await editGridCell(page, "quantity", "2");
    await page.getByRole("button", { name: "Save recipe" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save recipe" });
    await saveDialog.getByRole("button", { name: "Save recipe" }).click();
    await expect(saveDialog).toBeHidden();

    await page.getByRole("button", { name: "Copy to…" }).click();
    const copyDialog = page.getByRole("dialog", {
      name: "Copy recipe to sibling variants",
    });
    await copyDialog.getByRole("checkbox", { name: /Garden/ }).click();
    await copyDialog.getByRole("checkbox", { name: /Industrial/ }).click();
    await copyDialog.getByRole("button", { name: "Copy to selected" }).click();
    await expect(copyDialog).toBeHidden();

    for (const targetId of targetIds) {
      const [revision] = await db
        .select({ id: bomRevisions.id })
        .from(bomRevisions)
        .where(
          and(
            eq(bomRevisions.productId, targetId),
            eq(bomRevisions.isCurrent, true),
          ),
        );
      expect(revision?.id).toBeTruthy();
      const rows = await db
        .select({
          componentId: bomRevisionComponents.componentId,
          quantity: bomRevisionComponents.quantity,
        })
        .from(bomRevisionComponents)
        .where(eq(bomRevisionComponents.bomRevisionId, revision.id));
      expect(rows).toEqual([
        { componentId: component.body.id, quantity: "2.0000" },
      ]);
    }
  });

  test("item-card autosave preserves an unsent blank variant row through a header rebase", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const product = await createItem({
      itemType: "product",
      name: `Fast Blank Variant Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-BLANK-VAR-${unique}`,
      category: `Fast Blank Variant ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "15.00",
      registeredBarcode: null,
      internalBarcode: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(product.status).toBe(201);
    const itemId = product.body.id as string;

    const configResponse = await testFetch(`/api/item-cards/${itemId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Pack",
            values: [{ label: "Single" }, { label: "Case" }],
          },
        ],
      }),
    });
    expect(configResponse.status).toBe(200);

    const generateResponse = await testFetch(`/api/item-cards/${itemId}/variants/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(generateResponse.status).toBe(201);

    const description = `blank variant survives rebase ${unique}`;
    let delayedFirstPatch = false;
    await page.route(`**/api/item-cards/${itemId}`, async (route) => {
      if (route.request().method() === "PATCH" && !delayedFirstPatch) {
        delayedFirstPatch = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/inventory/products/${itemId}`);
    await expectRows(page, 2);
    await page.getByRole("button", { name: "Add row" }).click();
    await expectRows(page, 3);
    await page.keyboard.press("Escape");

    const infoInput = page.getByLabel("Description");
    await expect(infoInput).toBeVisible();
    await infoInput.fill(description);
    const savedPatch = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/item-cards/${itemId}`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await infoInput.blur();
    await savedPatch;
    await expectRows(page, 3);

    const saved = await (await testFetch(`/api/item-cards/${itemId}`)).json();
    expect(saved.family.description).toBe(description);
    expect(
      saved.variants.filter(
        (variant: { deletedAt: string | null }) => variant.deletedAt == null,
      ),
    ).toHaveLength(2);
  });

  test("item-card autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const material = await createItem({
      itemType: "material",
      name: `Fast Item Conflict UI Material ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-ITEM-CONFLICT-UI-${unique}`,
      category: `Fast Item Conflict UI ${unique}`,
      description: null,
      defaultPurchasePrice: "4.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const itemId = material.body.id as string;
    const firstWriterDescription = `first item writer ${randomUUID()}`;
    const staleWriterDescription = `stale item writer ${randomUUID()}`;
    const resolvedDescription = `resolved item writer ${randomUUID()}`;
    const cardBefore = await (await testFetch(`/api/item-cards/${itemId}`)).json();
    const familyId = cardBefore.family.id as string;
    const baseVersion = cardBefore.family.version as number;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/inventory/materials/${itemId}`);
      await secondPage.goto(`/inventory/materials/${itemId}`);

      const firstDescription = secondPage.getByLabel("Additional info");
      await expect(firstDescription).toHaveValue("");
      await firstDescription.fill(firstWriterDescription);
      await firstDescription.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleDescription = page.getByLabel("Additional info");
      await expect(staleDescription).toHaveValue("");
      await staleDescription.fill(staleWriterDescription);
      await staleDescription.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ description: itemFamilies.description, version: itemFamilies.version })
        .from(itemFamilies)
        .where(eq(itemFamilies.id, familyId));
      expect(afterConflict.description).toBe(firstWriterDescription);
      expect(afterConflict.version).toBe(baseVersion + 1);

      await staleDescription.fill(resolvedDescription);
      await staleDescription.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByLabel("Additional info")).toHaveValue(
        resolvedDescription,
      );

      const [afterRecovery] = await db
        .select({ description: itemFamilies.description, version: itemFamilies.version })
        .from(itemFamilies)
        .where(eq(itemFamilies.id, familyId));
      expect(afterRecovery.description).toBe(resolvedDescription);
      expect(afterRecovery.version).toBe(baseVersion + 2);
    } finally {
      await secondContext.close();
    }
  });

  test("product item-card reload renders saved variant sellable state", async ({
    context,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Sellable Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-SELLABLE-COMP-${unique}`,
      category: `Fast Sellable ${unique}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "25",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Sellable Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SELLABLE-PROD-${unique}`,
      category: `Fast Sellable ${unique}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "9.00",
      stock: "10",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const productId = product.body.id as string;
    const sellableCheckbox = page
      .locator("label")
      .filter({ hasText: /^Sellable$/ })
      .locator('[role="checkbox"]');

    await page.goto(`/inventory/products/${productId}`);
    await page.getByLabel("Category").fill(`Fast Sellable Saved ${unique}`);
    await page.getByLabel("Category").blur();
    await page.keyboard.press("Escape");
    await page.getByText("Sellable", { exact: true }).click();
    await expect(sellableCheckbox).not.toBeChecked();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const saved = await (await testFetch(`/api/item-cards/${productId}`)).json();
    expect(saved.variants[0].sellable).toBe(false);

    await page.reload();
    await expect(sellableCheckbox).not.toBeChecked();

    const freshPage = await context.newPage();
    await freshPage.goto(`/inventory/products/${productId}`);
    await expect(
      freshPage
        .locator("label")
        .filter({ hasText: /^Sellable$/ })
        .locator('[role="checkbox"]'),
    ).not.toBeChecked();
    await freshPage.close();
  });

  test("expired Free blocks item creation once the org has 30 active SKUs", async ({
    db,
  }) => {
    const id = randomUUID().slice(0, 8);
    const orgId = readTestEnv().TEST_ORG_ID;
    const [originalOrg] = await db
      .select({ plan: organization.plan, skuLimitStartsAt: organization.skuLimitStartsAt })
      .from(organization)
      .where(eq(organization.id, orgId));
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(items)
      .where(and(eq(items.organizationId, orgId), sql`${items.deletedAt} IS NULL`));

    await db
      .update(organization)
      .set({ plan: "free", skuLimitStartsAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(organization.id, orgId));

    const missingCapacity = Math.max(0, 30 - Number(count));
    const probes = missingCapacity
      ? await db
          .insert(items)
          .values(
            Array.from({ length: missingCapacity }, (_, index) => ({
              organizationId: orgId,
              name: `Sku Meter Probe ${id} ${index}`,
              sku: `SKU-METER-${id}-${index}`,
              itemType: "material" as const,
              unitDefinitionId: unitId,
              safetyStock: "0",
              defaultPurchasePrice: "1",
              currentStockUnitCost: "1",
              defaultSellingPrice: null,
              sellable: false,
              manufacturingMode: "discrete" as const,
            })),
          )
          .returning({ id: items.id })
      : [];

    try {
      const blocked = await createItem({
        itemType: "material",
        name: `Sku Meter Probe Final ${id}`,
        unitDefinitionId: unitId,
        sku: `SKU-METER-FINAL-${id}`,
        category: `Sku Meter ${id}`,
        description: null,
        sellable: false,
        defaultPurchasePrice: "1.00",
        defaultSellingPrice: null,
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(blocked.status).toBe(402);
      expect(blocked.body).toMatchObject({
        error: "Free includes up to 30 active SKUs. Start Pro for unlimited SKUs.",
        billing: { dimension: "skus", limit: 30, requested: 1 },
      });
    } finally {
      await db
        .update(items)
        .set({ deletedAt: new Date() })
        .where(inArray(items.id, probes.map((probe) => probe.id)));
      await db
        .update(organization)
        .set({
          plan: originalOrg.plan,
          skuLimitStartsAt: originalOrg.skuLimitStartsAt,
        })
        .where(eq(organization.id, orgId));
    }
  });

  test("concurrent item-card creation routes share one deadlock-safe capacity lock", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    let probeIds: string[] = [];
    const [originalOrg] = await db
      .select({ plan: organization.plan, skuLimitStartsAt: organization.skuLimitStartsAt })
      .from(organization)
      .where(eq(organization.id, orgId));

    try {
      await db.update(organization).set({ plan: "pro" }).where(eq(organization.id, orgId));
      const product = await createItem({
        itemType: "product",
        name: `Fast SKU Lock ${unique}`,
        sellable: true,
        unitDefinitionId: unitId,
        sku: `FAST-SKU-LOCK-${unique}`,
        category: "Fast SKU Lock",
        description: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: "10.00",
        stock: "0",
        safetyStock: "0",
        bom: [],
      });
      expect(product.status).toBe(201);
      const itemId = product.body.id as string;

      const configResponse = await testFetch(`/api/item-cards/${itemId}/variant-config`, {
        method: "PUT",
        body: JSON.stringify({
          options: [
            {
              name: "Size",
              values: [{ label: "Small" }, { label: "Medium" }, { label: "Large" }],
            },
          ],
        }),
      });
      expect(configResponse.status).toBe(200);
      const configured = await configResponse.json();
      const option = configured.options[0] as {
        id: string;
        values: Array<{ id: string }>;
      };

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(items)
        .where(and(eq(items.organizationId, orgId), sql`${items.deletedAt} IS NULL`));
      const missingCapacity = Math.max(0, 30 - Number(count));
      const probes = missingCapacity
        ? await db
            .insert(items)
            .values(
              Array.from({ length: missingCapacity }, (_, index) => ({
                organizationId: orgId,
                name: `Fast SKU Lock Probe ${unique} ${index}`,
                sku: `FAST-SKU-LOCK-PROBE-${unique}-${index}`,
                itemType: "material" as const,
                unitDefinitionId: unitId,
                safetyStock: "0",
                defaultPurchasePrice: "1",
                currentStockUnitCost: "1",
                defaultSellingPrice: null,
                sellable: false,
                manufacturingMode: "discrete" as const,
              })),
            )
            .returning({ id: items.id })
        : [];
      probeIds = probes.map((probe) => probe.id);

      await db
        .update(organization)
        .set({ plan: "free", skuLimitStartsAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(organization.id, orgId));

      const createPayload = {
        itemType: "product",
        name: `Fast SKU Lock Blocked ${unique}`,
        category: "Fast SKU Lock",
        description: null,
        unitDefinitionId: unitId,
        defaultSupplierId: null,
        purchaseUnitDefinitionId: null,
        purchaseToStockFactor: null,
        sku: `FAST-SKU-LOCK-BLOCKED-${unique}`,
        sellable: true,
        defaultSellingPrice: "10.00",
        defaultPurchasePrice: null,
        currentStockUnitCost: null,
        registeredBarcode: null,
        internalBarcode: null,
        supplierItemCode: null,
        defaultLeadTimeDays: null,
        minimumOrderQuantity: null,
        lotTrackingMode: "tracked",
      };
      const responses = await Promise.all([
        testFetch("/api/item-cards", {
          method: "POST",
          headers: { "Idempotency-Key": `fast-sku-lock-create-${unique}` },
          body: JSON.stringify(createPayload),
        }),
        testFetch(`/api/item-cards/${itemId}/clone`, {
          method: "POST",
          headers: { "Idempotency-Key": `fast-sku-lock-clone-${unique}` },
        }),
        testFetch(`/api/item-cards/${itemId}/variant`, {
          method: "POST",
          headers: { "Idempotency-Key": `fast-sku-lock-variant-${unique}` },
          body: JSON.stringify({
            optionValueIdsByOptionId: { [option.id]: option.values[0].id },
            sku: `FAST-SKU-LOCK-VARIANT-${unique}`,
          }),
        }),
        testFetch(`/api/item-cards/${itemId}/variants/generate`, {
          method: "POST",
          headers: { "Idempotency-Key": `fast-sku-lock-generate-${unique}` },
          body: JSON.stringify({}),
        }),
      ]);

      expect(responses.map((response) => response.status)).toEqual([402, 402, 402, 402]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(bodies.map((body) => body.billing.requested)).toEqual([1, 1, 1, 2]);
    } finally {
      if (probeIds.length > 0) {
        await db
          .update(items)
          .set({ deletedAt: new Date() })
          .where(inArray(items.id, probeIds));
      }
      await db
        .update(organization)
        .set({
          plan: originalOrg.plan,
          skuLimitStartsAt: originalOrg.skuLimitStartsAt,
        })
        .where(eq(organization.id, orgId));
    }
  });

  test("location management preserves API shape and blocks unsafe default swaps", async () => {
    const code = `FAST-LOC-${ts}`;
    const created = await testFetch("/api/locations", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Location ${ts}`,
        code,
      }),
    });
    expect(created.status).toBe(201);
    const location = await created.json();
    expect(location).toMatchObject({
      name: `Fast Location ${ts}`,
      code: code.toLowerCase(),
      isDefault: false,
      hasActivity: false,
    });

    const duplicate = await testFetch("/api/locations", {
      method: "POST",
      body: JSON.stringify({
        name: `Fast Location Duplicate ${ts}`,
        code: code.toLowerCase(),
      }),
    });
    expect(duplicate.status).toBe(409);

    const renamed = await testFetch(`/api/locations/${location.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `Fast Location Renamed ${ts}` }),
    });
    expect(renamed.status).toBe(200);
    const renamedBody = await renamed.json();
    expect(renamedBody).toMatchObject({
      id: location.id,
      name: `Fast Location Renamed ${ts}`,
      code: code.toLowerCase(),
      isDefault: false,
      hasActivity: false,
    });
    expect(renamedBody.ok).toBeUndefined();

    const item = await createItem({
      itemType: "material",
      name: `Fast Location Blocker ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-LOC-BLOCKER-${ts}`,
      category: `Fast Location ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "1",
      safetyStock: "0",
      bom: [],
    });
    expect(item.status).toBe(201);

    const defaultSwap = await testFetch(`/api/locations/${location.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isDefault: true }),
    });
    expect(defaultSwap.status).toBe(409);
  });
});
