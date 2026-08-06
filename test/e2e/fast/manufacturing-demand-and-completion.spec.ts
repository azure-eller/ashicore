import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLocations,
  lots,
  itemFamilies,
  items,
  manufacturingResources,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  manufacturingOrders,
  manufacturingPickAllocations,
  notifications,
  salesOrderLines,
  user,
} from "../../../lib/db/schema";
import {
  completeManufacturingOrder,
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
  updateSalesOrder,
} from "../../helpers/api";
import { buildStorageState } from "../../helpers/test-env";

const FCM_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "fcm-outbox");

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

async function editGridCell(page: Page, colId: string, value: string) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="0"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function expectRows(page: Page, count: number, gridIndex = 0) {
  await expect(
    editableGrid(page, gridIndex).locator(".ag-center-cols-container .ag-row"),
  ).toHaveCount(count, { timeout: 15_000 });
}

test.describe("manufacturing demand and completion heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();
  const orgId = getOrgId();

  async function createBomFixture(
    label: string,
    operationCosts: Array<{
      operationName: string;
      resourceId: string;
      costScalingMode: "per_output_unit";
      crewSize: string;
      plannedMinutes: string;
      loadedCostPerHour: string;
    }> = []
  ) {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-${label}-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast MO ${label} Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-${label}-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "2" }],
      operationCosts,
    });
    expect(product.status).toBe(201);

    return {
      componentId: component.body.id as string,
      productId: product.body.id as string,
    };
  }

  async function pickAllIngredients(orderId: string) {
    const execution = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
    expect(execution.status).toBe(200);
    const body = await execution.json();

    for (const ingredient of body.ingredients ?? []) {
      const pick = await testFetch(
        `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      expect(pick.status).toBe(200);
    }
  }

  async function setNotificationPreference(eventType: string, enabled: boolean) {
    const res = await testFetch("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({
        eventType,
        enabled,
      }),
    });
    expect(res.status).toBe(200);
  }

  async function setManufacturingResourceExclusion(
    resourceId: string,
    excluded: boolean
  ) {
    const res = await testFetch("/api/notification-preferences/resource-exclusions", {
      method: "PUT",
      body: JSON.stringify({
        eventType: "manufacturing_order_created",
        resourceId,
        excluded,
      }),
    });
    expect(res.status).toBe(200);
  }

  test("manufacturing order create replays under the same idempotency key", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Replay");
    const notes = `idempotent MO create ${ts}`;
    const payload = {
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: null,
      notes,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    };
    const postCreate = () =>
      testFetch("/api/manufacturing-orders", {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-mo-create-replay:${ts}`,
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
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.productId, fixture.productId),
          eq(manufacturingOrders.notes, notes)
        )
      );
    expect(rows).toHaveLength(1);
  });

  test("BOM ingredient can swap to an active same-family variant and keeps submitted quantity", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const defaultMaterial = await createItem({
      itemType: "material",
      name: `Fast Variant Small ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-VAR-SM-${unique}`,
      category: `Fast Variant ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "12",
      safetyStock: "0",
      bom: [],
    });
    expect(defaultMaterial.status).toBe(201);

    const [familyRow] = await db
      .select({ id: itemFamilies.id })
      .from(items)
      .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, defaultMaterial.body.id));
    expect(familyRow?.id).toBeTruthy();

    const [largeSibling] = await db
      .insert(items)
      .values({
        organizationId: orgId,
        familyId: familyRow.id,
        name: `Fast Variant Large ${unique}`,
        sku: `FAST-VAR-LG-${unique}`,
        itemType: "material",
        unitDefinitionId: unitId,
        safetyStock: "0",
        defaultPurchasePrice: "10.00",
        defaultSellingPrice: null,
        sellable: false,
        manufacturingMode: "discrete",
        optionCombinationKey: `fast-large-${unique}`,
        isMaster: false,
        sortOrder: 1,
      })
      .returning({ id: items.id });

    const unrelatedMaterial = await createItem({
      itemType: "material",
      name: `Fast Variant Unrelated ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-VAR-OTHER-${unique}`,
      category: `Fast Variant ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "12",
      safetyStock: "0",
      bom: [],
    });
    expect(unrelatedMaterial.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Variant Product ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-VAR-PRODUCT-${unique}`,
      category: `Fast Variant ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: defaultMaterial.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "3",
      ingredients: [{ itemId: defaultMaterial.body.id, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const detailResponse = await testFetch(`/api/manufacturing-orders/${orderId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(
      detail.ingredients[0].siblingVariants.map((row: { itemId: string }) => row.itemId),
    ).toEqual(expect.arrayContaining([defaultMaterial.body.id, largeSibling.id]));

    const siblingUpdate = await testFetch(`/api/manufacturing-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "3",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [
          {
            itemId: largeSibling.id,
            defaultItemId: defaultMaterial.body.id,
            quantityPerUnit: "7",
          },
        ],
      }),
    });
    expect(siblingUpdate.status, await siblingUpdate.text()).toBe(200);

    const [savedIngredient] = await db
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(savedIngredient).toMatchObject({
      itemId: largeSibling.id,
      quantityPerUnit: "7.0000",
      plannedQuantity: "21.0000",
    });

    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, savedIngredient.id),
          eq(inventoryDemandSummary.itemId, largeSibling.id),
        ),
      );
    expect(demand.quantity).toBe("21.0000");

    const crossFamilyUpdate = await testFetch(`/api/manufacturing-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "3",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [
          {
            itemId: unrelatedMaterial.body.id,
            defaultItemId: defaultMaterial.body.id,
            quantityPerUnit: "7",
          },
        ],
      }),
    });
    expect(crossFamilyUpdate.status).toBe(400);

    const [ingredientAfterRejectedUpdate] = await db
      .select({
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.id, savedIngredient.id));
    expect(ingredientAfterRejectedUpdate).toMatchObject({
      itemId: largeSibling.id,
      quantityPerUnit: "7.0000",
      plannedQuantity: "21.0000",
    });

    const leftoverDemand = await db
      .select({ itemId: inventoryDemandSummary.itemId })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, savedIngredient.id),
          ne(inventoryDemandSummary.itemId, largeSibling.id),
        ),
      );
    expect(leftoverDemand).toHaveLength(0);
  });

  test("BOM-backed updates keep all component rows by default item identity", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const firstComponent = await createItem({
      itemType: "material",
      name: `Fast Bom Identity First ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-BOM-ID-1-${unique}`,
      category: `Fast Bom Identity ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "12",
      safetyStock: "0",
      bom: [],
    });
    expect(firstComponent.status).toBe(201);

    const secondComponent = await createItem({
      itemType: "material",
      name: `Fast Bom Identity Second ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-BOM-ID-2-${unique}`,
      category: `Fast Bom Identity ${ts}`,
      description: null,
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "12",
      safetyStock: "0",
      bom: [],
    });
    expect(secondComponent.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Bom Identity Product ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-BOM-ID-PRODUCT-${unique}`,
      category: `Fast Bom Identity ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: firstComponent.body.id, quantity: "1" },
        { componentId: secondComponent.body.id, quantity: "2" },
      ],
    });
    expect(product.status).toBe(201);

    const order = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      headers: { "Idempotency-Key": `fast-bom-identity-create:${unique}` },
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "3",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [
          {
            itemId: secondComponent.body.id,
            defaultItemId: secondComponent.body.id,
            quantityPerUnit: "2",
          },
          {
            itemId: firstComponent.body.id,
            defaultItemId: firstComponent.body.id,
            quantityPerUnit: "1",
          },
        ],
        confirmShortage: false,
      }),
    });
    const orderText = await order.text();
    expect(order.status, orderText).toBe(201);
    const createdOrder = JSON.parse(orderText);
    const orderId = createdOrder.id as string;

    const createdIngredients = await db
      .select({
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
        sortOrder: manufacturingOrderIngredients.sortOrder,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
      .orderBy(manufacturingOrderIngredients.sortOrder);
    expect(createdIngredients).toMatchObject([
      {
        itemId: firstComponent.body.id,
        quantityPerUnit: "1.0000",
        plannedQuantity: "3.0000",
        sortOrder: 0,
      },
      {
        itemId: secondComponent.body.id,
        quantityPerUnit: "2.0000",
        plannedQuantity: "6.0000",
        sortOrder: 1,
      },
    ]);

    const omittedComponentUpdate = await testFetch(
      `/api/manufacturing-orders/${orderId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          productId: product.body.id,
          plannedQuantity: "3",
          plannedDate: null,
          notes: null,
          salesOrderId: null,
          salesOrderLineId: null,
          ingredients: [
            {
              itemId: firstComponent.body.id,
              defaultItemId: firstComponent.body.id,
              quantityPerUnit: "1",
            },
          ],
        }),
      }
    );
    expect(omittedComponentUpdate.status).toBe(409);

    const reorderedUpdate = await testFetch(`/api/manufacturing-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "3",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [
          {
            itemId: secondComponent.body.id,
            defaultItemId: secondComponent.body.id,
            quantityPerUnit: "5",
          },
          {
            itemId: firstComponent.body.id,
            defaultItemId: firstComponent.body.id,
            quantityPerUnit: "4",
          },
        ],
      }),
    });
    expect(reorderedUpdate.status, await reorderedUpdate.text()).toBe(200);

    const savedIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
        sortOrder: manufacturingOrderIngredients.sortOrder,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId))
      .orderBy(manufacturingOrderIngredients.sortOrder);
    expect(savedIngredients).toMatchObject([
      {
        itemId: firstComponent.body.id,
        quantityPerUnit: "4.0000",
        plannedQuantity: "12.0000",
        sortOrder: 0,
      },
      {
        itemId: secondComponent.body.id,
        quantityPerUnit: "5.0000",
        plannedQuantity: "15.0000",
        sortOrder: 1,
      },
    ]);

    const demandRows = await db
      .select({
        itemId: inventoryDemandSummary.itemId,
        referenceId: inventoryDemandSummary.referenceId,
        quantity: inventoryDemandSummary.quantity,
      })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          inArray(
            inventoryDemandSummary.referenceId,
            savedIngredients.map((ingredient) => ingredient.id)
          )
        )
      );
    expect(demandRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: firstComponent.body.id,
          referenceId: savedIngredients[0].id,
          quantity: "12.0000",
        }),
        expect.objectContaining({
          itemId: secondComponent.body.id,
          referenceId: savedIngredients[1].id,
          quantity: "15.0000",
        }),
      ])
    );
    expect(demandRows).toHaveLength(2);
  });

  test("batch output override stores MO yield while ingredient demand follows batch count", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Batch Override Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-OVR-COMP-${unique}`,
      category: `Fast Batch Override ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "12",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Batch Override Product ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-BATCH-OVR-PRODUCT-${unique}`,
      category: `Fast Batch Override ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const batchRevision = await testFetch(
      `/api/items/${product.body.id}/bom-revisions`,
      {
        method: "POST",
        body: JSON.stringify({
          recipeBasis: "batch",
          expectedBatchYield: "10",
          outputQuantity: "10",
          bom: [{ componentId: component.body.id, quantity: "1" }],
        }),
      }
    );
    expect([200, 201]).toContain(batchRevision.status);

    const create = await testFetch("/api/manufacturing-orders", {
      method: "POST",
      headers: { "Idempotency-Key": `fast-batch-output:${unique}` },
      body: JSON.stringify({
        id: randomUUID(),
        productId: product.body.id,
        plannedQuantity: "20",
        batchCount: "2",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
        confirmShortage: false,
      }),
    });
    expect(create.status, await create.text()).toBe(201);
    const created = await create.json();

    const update = await testFetch(`/api/manufacturing-orders/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: product.body.id,
        plannedQuantity: "16",
        batchCount: "2",
        plannedDate: null,
        notes: null,
        salesOrderId: null,
        salesOrderLineId: null,
        ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      }),
    });
    expect(update.status, await update.text()).toBe(200);

    const [savedOrder] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, created.id));
    expect(savedOrder).toMatchObject({
      plannedQuantity: "16.0000",
      numberOfBatches: 2,
      expectedBatchYield: "8.0000",
    });

    const savedIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, created.id));
    expect(
      savedIngredients.reduce(
        (sum, ingredient) => sum + Number(ingredient.plannedQuantity),
        0
      )
    ).toBe(2);

    const [savedDemand] = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)`,
      })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          inArray(
            inventoryDemandSummary.referenceId,
            savedIngredients.map((ingredient) => ingredient.id)
          ),
          eq(inventoryDemandSummary.itemId, component.body.id)
        )
      );
    expect(savedDemand.quantity).toBe("2.0000");

    const batchCountOnlyUpdate = await testFetch(
      `/api/manufacturing-orders/${created.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          productId: product.body.id,
          plannedQuantity: "16",
          batchCount: "4",
          plannedDate: null,
          notes: null,
          salesOrderId: null,
          salesOrderLineId: null,
          ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
        }),
      }
    );
    expect(batchCountOnlyUpdate.status, await batchCountOnlyUpdate.text()).toBe(200);

    const [resavedOrder] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, created.id));
    expect(resavedOrder).toMatchObject({
      plannedQuantity: "16.0000",
      numberOfBatches: 4,
      expectedBatchYield: "4.0000",
    });

    const resavedIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, created.id));
    expect(
      resavedIngredients.reduce(
        (sum, ingredient) => sum + Number(ingredient.plannedQuantity),
        0
      )
    ).toBe(4);

    const resavedDemandRows = await db
      .select({
        referenceId: inventoryDemandSummary.referenceId,
        quantity: inventoryDemandSummary.quantity,
      })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.itemId, component.body.id),
          inArray(
            inventoryDemandSummary.referenceId,
            resavedIngredients.map((ingredient) => ingredient.id)
          )
        )
      );
    expect(
      resavedDemandRows.reduce((sum, demand) => sum + Number(demand.quantity), 0)
    ).toBe(4);

    const omittedBatchCountUpdate = await testFetch(
      `/api/manufacturing-orders/${created.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          productId: product.body.id,
          plannedQuantity: "15",
          plannedDate: null,
          notes: null,
          salesOrderId: null,
          salesOrderLineId: null,
          ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
        }),
      }
    );
    expect(omittedBatchCountUpdate.status, await omittedBatchCountUpdate.text()).toBe(200);

    const [omittedBatchCountOrder] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, created.id));
    expect(omittedBatchCountOrder).toMatchObject({
      plannedQuantity: "15.0000",
      numberOfBatches: 4,
      expectedBatchYield: "3.7500",
    });

    const omittedBatchCountIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, created.id));
    expect(
      omittedBatchCountIngredients.reduce(
        (sum, ingredient) => sum + Number(ingredient.plannedQuantity),
        0
      )
    ).toBe(4);

    const staleDemandRows = await db
      .select({ referenceId: inventoryDemandSummary.referenceId })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.itemId, component.body.id),
          inArray(
            inventoryDemandSummary.referenceId,
            savedIngredients.map((ingredient) => ingredient.id)
          )
        )
      );
    expect(staleDemandRows).toHaveLength(0);

    const duplicate = await testFetch(
      `/api/manufacturing-orders/${created.id}/duplicate`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-batch-output-duplicate:${unique}`,
        },
        body: JSON.stringify({}),
      }
    );
    expect(duplicate.status, await duplicate.text()).toBe(201);
    const duplicated = await duplicate.json();

    const [duplicatedOrder] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        numberOfBatches: manufacturingOrders.numberOfBatches,
        expectedBatchYield: manufacturingOrders.expectedBatchYield,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, duplicated.id));
    expect(duplicatedOrder).toMatchObject({
      plannedQuantity: "15.0000",
      numberOfBatches: 4,
      expectedBatchYield: "3.7500",
    });

    const duplicatedIngredients = await db
      .select({
        id: manufacturingOrderIngredients.id,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, duplicated.id));
    expect(
      duplicatedIngredients.reduce(
        (sum, ingredient) => sum + Number(ingredient.plannedQuantity),
        0
      )
    ).toBe(4);
  });

  test("sales-order make-to-stock MO creation is idempotent", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast MTS Replay Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MTS-REPLAY-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast MTS Replay Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-MTS-REPLAY-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const customer = await createCustomer({
      name: `Fast MTS Replay Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderNumber: `MTS-REPLAY-${ts}`,
      orderDate: "2026-05-10",
      shipDate: "2026-05-20",
      lines: [{ itemId: product.body.id, quantity: "4", unitPrice: "10.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line).toBeTruthy();

    const body = JSON.stringify({
      manufacturingStrategy: "make_to_stock",
      plannedDate: "2026-05-19",
      salesOrderLineIds: [line.id],
      priorityRank: null,
      lineQuantities: [
        {
          salesOrderLineId: line.id,
          quantity: "4",
        },
      ],
      notes: null,
    });
    const replayKey = `fast-mts-replay:${order.body.id}`;
    const postCreateFromSalesOrder = () =>
      testFetch(`/api/sales-orders/${order.body.id}/manufacturing-orders`, {
        method: "POST",
        headers: { "Idempotency-Key": replayKey },
        body,
      });

    const first = await postCreateFromSalesOrder();
    const firstBody = (await first.json()) as {
      created: Array<{ manufacturingOrderId: string }>;
    };
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreateFromSalesOrder();
    const replayBody = (await replay.json()) as {
      created: Array<{ manufacturingOrderId: string }>;
    };
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.created).toEqual(firstBody.created);

    const orders = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.productId, product.body.id));
    expect(orders.map((row) => row.id)).toEqual([
      firstBody.created[0]?.manufacturingOrderId,
    ]);
  });

  test("manufacturing order client-id replay finalizes a different idempotency key", async ({
    db,
  }) => {
    const fixture = await createBomFixture("ClientIdReplay");
    const orderId = randomUUID();
    const notes = `client-id MO replay ${ts}`;
    const payload = {
      id: orderId,
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: null,
      notes,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    };
    const postCreate = (idempotencyKey: string) =>
      testFetch("/api/manufacturing-orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });

    const first = await postCreate(`fast-mo-client-id-create:${ts}:first`);
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);
    expect(firstBody.id).toBe(orderId);

    const secondKey = `fast-mo-client-id-create:${ts}:second`;
    const second = await postCreate(secondKey);
    const secondBody = await second.json();
    expect(second.status, JSON.stringify(secondBody)).toBe(201);
    expect(secondBody.id).toBe(orderId);

    const replaySecondKey = await postCreate(secondKey);
    const replaySecondKeyBody = await replaySecondKey.json();
    expect(replaySecondKey.status, JSON.stringify(replaySecondKeyBody)).toBe(201);
    expect(replaySecondKeyBody.id).toBe(orderId);

    const rows = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(rows).toHaveLength(1);
  });

  test("manufacturing order duplicate replays under the same idempotency key", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Duplicate");
    const notes = `duplicate MO replay ${ts}`;
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: null,
      notes,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const postDuplicate = () =>
      testFetch(`/api/manufacturing-orders/${order.body.id}/duplicate`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-mo-duplicate-replay:${ts}`,
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
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.productId, fixture.productId),
          eq(manufacturingOrders.notes, notes)
        )
      );
    expect(rows).toHaveLength(2);
  });

  test("manufacturing order duplicate action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const fixture = await createBomFixture(`DupUI${unique}`);
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `dirty manufacturing duplicate notes ${unique}`;

    await page.goto(`/manufacturing/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Notes for this order…");
    await notesInput.scrollIntoViewIfNeeded();
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/manufacturing/order/") &&
        url.pathname !== `/manufacturing/order/${orderId}`
      );
    });
    const duplicatedId = page.url().split("/").pop();
    expect(duplicatedId).toBeTruthy();
    expect(duplicatedId).not.toBe(orderId);

    const rows = await db
      .select({
        id: manufacturingOrders.id,
        notes: manufacturingOrders.notes,
        productId: manufacturingOrders.productId,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.productId, fixture.productId),
          eq(manufacturingOrders.notes, notes),
        ),
      );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [orderId, duplicatedId as string].sort(),
    );

    const ingredients = await db
      .select({
        manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.itemId, fixture.componentId));
    expect(ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manufacturingOrderId: orderId,
          quantityPerUnit: "2.0000",
        }),
        expect.objectContaining({
          manufacturingOrderId: duplicatedId,
          quantityPerUnit: "2.0000",
        }),
      ]),
    );
  });

  test("manufacturing status transition flushes dirty autosave before patching status", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const fixture = await createBomFixture(`StatusFlush${unique}`);
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `dirty manufacturing status notes ${unique}`;
    const writes: Array<{ method: string; body: unknown }> = [];

    await page.route(`**/api/manufacturing-orders/${orderId}`, async (route) => {
      const request = route.request();
      if (request.method() === "PUT" || request.method() === "PATCH") {
        writes.push({
          method: request.method(),
          body: request.postDataJSON(),
        });
      }
      await route.continue();
    });

    await page.goto(`/manufacturing/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Notes for this order…");
    await notesInput.scrollIntoViewIfNeeded();
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);

    await page.getByLabel("Change status: Not started").click();
    await page.getByRole("menuitem", { name: "Blocked" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await expect.poll(() => writes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      body: expect.objectContaining({ notes }),
    });
    expect(writes[1]).toMatchObject({
      method: "PATCH",
      body: expect.objectContaining({ isBlocked: true }),
    });
    await expect(page.getByLabel("Change status: Blocked")).toBeVisible({
      timeout: 15_000,
    });

    const [saved] = await db
      .select({
        notes: manufacturingOrders.notes,
        isBlocked: manufacturingOrders.isBlocked,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(saved.notes).toBe(notes);
    expect(saved.isBlocked).toBe(true);
  });

  test("manufacturing status transition blocks when autosave is invalid", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const fixture = await createBomFixture(`StatusBlock${unique}`);
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const writes: Array<{ method: string; body: unknown }> = [];

    await page.route(`**/api/manufacturing-orders/${orderId}`, async (route) => {
      const request = route.request();
      if (request.method() === "PUT" || request.method() === "PATCH") {
        writes.push({
          method: request.method(),
          body: request.postDataJSON(),
        });
      }
      await route.continue();
    });

    await page.goto(`/manufacturing/order/${orderId}`);
    const quantityInput = page.getByLabel("Quantity", { exact: true });
    await quantityInput.scrollIntoViewIfNeeded();
    await expect(quantityInput).toBeVisible();
    await quantityInput.fill("0");

    await page.getByLabel("Change status: Not started").click();
    await page.getByRole("menuitem", { name: "Blocked" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "Planned quantity must be greater than 0",
    );
    await expect(page.getByLabel("Change status: Not started")).toBeVisible();
    await expect
      .poll(
        () =>
          writes.some(
            (write) =>
              write.method === "PATCH" &&
              typeof write.body === "object" &&
              write.body != null &&
              "isBlocked" in write.body,
          ),
        { timeout: 2_000 },
      )
      .toBe(false);

    const [saved] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        isBlocked: manufacturingOrders.isBlocked,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(saved.plannedQuantity).toBe("3.0000");
    expect(saved.isBlocked).toBe(false);
  });

  test("manufacturing completion dialog stays reachable on an invalid dirty draft", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const fixture = await createBomFixture(`Reach${unique}`);
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    await page.goto(`/manufacturing/order/${order.body.id}`);
    await page.getByLabel("Quantity").fill("0");

    await page.getByLabel("Change status: Not started").click();
    await page.getByRole("menuitem", { name: "Done" }).click();

    await expect(page.getByRole("dialog", { name: "Complete order" })).toBeVisible();
  });

  test("released manufacturing order creates ingredient demand", async ({ db }) => {
    const fixture = await createBomFixture("Demand");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);

    const release = await releaseManufacturingOrder(order.body.id);
    expect(release.status).toBe(200);

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, order.body.id));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, fixture.componentId),
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, ingredient.id)
        )
    );
    expect(demand.quantity).toBe("6.0000");
  });

  test("ingredient pick warns before taking stock covered by earlier demand", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Queue Pick");
    const earlierOrder = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(earlierOrder.status, JSON.stringify(earlierOrder.body)).toBe(201);
    const laterOrder = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "5",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(laterOrder.status, JSON.stringify(laterOrder.body)).toBe(201);

    const reorder = await testFetch("/api/manufacturing-orders/priority-ranks", {
      method: "PATCH",
      body: JSON.stringify({
        orderIds: [earlierOrder.body.id, laterOrder.body.id],
      }),
    });
    expect(reorder.status, await reorder.text()).toBe(200);
    expect((await releaseManufacturingOrder(earlierOrder.body.id)).status).toBe(200);
    expect(
      (await releaseManufacturingOrder(laterOrder.body.id, { confirmShortage: true }))
        .status
    ).toBe(200);

    const [laterIngredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, laterOrder.body.id));
    const firstPick = await testFetch(
      `/api/manufacturing-orders/${laterOrder.body.id}/ingredients/${laterIngredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ confirmNegativeStock: false }),
      }
    );
    const firstPickBody = await firstPick.json();
    expect(firstPick.status, JSON.stringify(firstPickBody)).toBe(409);
    expect(firstPickBody?.shortage?.ingredients?.[0]).toMatchObject({
      itemId: fixture.componentId,
      available: 0,
      needed: 10,
      shortage: 10,
      warningType: "queue_conflict",
    });

    const confirmedPickKey = `confirmed-pick-${ts}`;
    const confirmedPick = await testFetch(
      `/api/manufacturing-orders/${laterOrder.body.id}/ingredients/${laterIngredient.id}/pick`,
      {
        method: "POST",
        headers: { "Idempotency-Key": confirmedPickKey },
        body: JSON.stringify({ confirmNegativeStock: true }),
      }
    );
    expect(confirmedPick.status, await confirmedPick.text()).toBe(200);
    const confirmedReplay = await testFetch(
      `/api/manufacturing-orders/${laterOrder.body.id}/ingredients/${laterIngredient.id}/pick`,
      {
        method: "POST",
        headers: { "Idempotency-Key": confirmedPickKey },
        body: JSON.stringify({ confirmNegativeStock: true }),
      }
    );
    expect(confirmedReplay.status, await confirmedReplay.text()).toBe(200);

    const componentEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, fixture.componentId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(componentEvents).toHaveLength(1);
    expect(componentEvents[0].quantity).toBe("10.0000");
  });

  test("completion consumes ingredients once and produces output once", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Complete");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);
    await pickAllIngredients(order.body.id);

    const completion = await completeManufacturingOrder(order.body.id, "3");
    expect(completion.status).toBe(200);

    const componentEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, fixture.componentId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(componentEvents).toHaveLength(1);
    expect(componentEvents[0].quantity).toBe("6.0000");

    const outputEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, fixture.productId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0].quantity).toBe("3.0000");

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, fixture.componentId));
    const [productBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, fixture.productId));

    expect(componentBalance.onHandQty).toBe("4.0000");
    expect(productBalance.onHandQty).toBe("3.0000");

    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");

    const remainingDemand = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, order.body.ingredients[0].id)
        )
      );
    expect(remainingDemand).toHaveLength(0);
  });

  test("confirmed completion can consume ingredients into negative stock", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO Negative Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-NEG-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
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
      name: `Fast MO Negative Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-NEG-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "1",
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);

    const firstAttempt = await completeManufacturingOrder(order.body.id, "1");
    expect(firstAttempt.status).toBe(409);
    expect(firstAttempt.body?.shortage?.ingredients?.[0]?.warningType).toBe(
      "stock_shortage"
    );

    const confirmed = await completeManufacturingOrder(order.body.id, "1", {
      confirmNegativeStock: true,
    });
    expect(confirmed.status).toBe(200);

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, component.body.id));
    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));

    expect(componentBalance.onHandQty).toBe("-2.0000");
    expect(savedOrder.status).toBe("done");

    const remainingDemand = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, order.body.ingredients[0].id)
        )
      );
    expect(remainingDemand).toHaveLength(0);
  });

  test("batch order completion lots each batch into its own produced lot", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast MO Batch Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-BATCH-COMP-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast MO Batch Product ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-MO-BATCH-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

    const batchRevision = await testFetch(
      `/api/items/${product.body.id}/bom-revisions`,
      {
        method: "POST",
        body: JSON.stringify({
          recipeBasis: "batch",
          expectedBatchYield: "10",
          outputQuantity: "10",
          bom: [{ componentId: component.body.id, quantity: "1" }],
        }),
      }
    );
    expect([200, 201]).toContain(batchRevision.status);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "20", // 2 batches of 10
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    expect((await releaseManufacturingOrder(order.body.id)).status).toBe(200);
    const orderId = order.body.id as string;

    async function currentBatchId() {
      const execution = await testFetch(
        `/api/manufacturing-orders/${orderId}/execution`
      );
      expect(execution.status).toBe(200);
      const body = await execution.json();
      const batch =
        body.currentBatch ??
        body.batches.find((b: { status: string }) => b.status !== "completed");
      return batch.id as string;
    }

    // Each batch records and completes on its own — the field workflow where the
    // first batch must not swallow the second batch's output.
    const batch1 = await currentBatchId();
    const batch1Output = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch1}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({ quantity: "10", producedLotNumber: "BATCH-A" }),
      }
    );
    expect(batch1Output.status).toBe(200);
    const batch1Complete = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch1}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          actualQuantity: null,
          outputDisposition: "available",
          ingredientActuals: [],
          confirmNegativeStock: false,
        }),
      }
    );
    expect(batch1Complete.status).toBe(200);

    const batch2 = await currentBatchId();
    const batch2Output = await testFetch(
      `/api/manufacturing-orders/${orderId}/batches/${batch2}/outputs`,
      { method: "POST", body: JSON.stringify({ quantity: "10" }) }
    );
    expect(batch2Output.status).toBe(200);
    await setNotificationPreference("manufacturing_order_completed", true);
    try {
      const batch2Complete = await testFetch(
        `/api/manufacturing-orders/${orderId}/batches/${batch2}/complete`,
        { method: "POST", body: JSON.stringify({}) }
      );
      expect(batch2Complete.status).toBe(200);
    } finally {
      await setNotificationPreference("manufacturing_order_completed", false);
    }

    const batches = await db
      .select({
        id: manufacturingOrderBatches.id,
        lotId: manufacturingOrderBatches.lotId,
      })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId));
    expect(batches).toHaveLength(2);
    expect(new Set(batches.map((b) => b.lotId)).size).toBe(2);

    const [namedBatch] = await db
      .select({ lotNumber: lots.lotNumber, quantity: lots.quantity })
      .from(lots)
      .innerJoin(manufacturingOrderBatches, eq(manufacturingOrderBatches.lotId, lots.id))
      .where(eq(manufacturingOrderBatches.id, batch1));
    expect(namedBatch.lotNumber).toBe("BATCH-A");
    expect(namedBatch.quantity).toBe("10.0000");

    const [savedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(savedOrder.status).toBe("done");

    const reopen = await testFetch(
      `/api/manufacturing-orders/${orderId}/reopen`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(reopen.status, await reopen.text()).toBe(200);

    const reopenedBatches = await db
      .select({
        status: manufacturingOrderBatches.status,
        actualQuantity: manufacturingOrderBatches.actualQuantity,
        completedAt: manufacturingOrderBatches.completedAt,
      })
      .from(manufacturingOrderBatches)
      .where(eq(manufacturingOrderBatches.manufacturingOrderId, orderId));
    expect(reopenedBatches).toHaveLength(2);
    expect(reopenedBatches).toEqual(
      expect.arrayContaining([
        { status: "pending", actualQuantity: "0.0000", completedAt: null },
        { status: "pending", actualQuantity: "0.0000", completedAt: null },
      ])
    );
    const [reopenedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(reopenedOrder.status).toBe("open");

    const [batchDoneNotification] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, orderId),
          eq(notifications.type, "manufacturing_order_completed")
        )
      );
    expect(batchDoneNotification).toBeTruthy();
  });

  test("started open order blocks planning edits but allows rescheduling", async ({
    db,
  }) => {
    const fixture = await createBomFixture("StartedEditGuard");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "2",
      plannedDate: "2026-06-10",
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);

    const start = await testFetch(`/api/manufacturing-orders/${order.body.id}/start`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(start.status).toBe(200);

    const datePatch = await testFetch(`/api/manufacturing-orders/${order.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plannedDate: "2026-06-15" }),
    });
    expect(datePatch.status).toBe(200);

    const quantityEdit = await testFetch(`/api/manufacturing-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: fixture.productId,
        plannedQuantity: "3",
        plannedDate: "2026-06-20",
        notes: null,
        ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
        lotAllocations: [],
      }),
    });
    const quantityEditBody = await quantityEdit.json().catch(() => null);
    expect(quantityEdit.status).toBe(400);
    expect(quantityEditBody?.error).toContain("Manufacturing work has started");

    const [saved] = await db
      .select({
        plannedQuantity: manufacturingOrders.plannedQuantity,
        plannedDate: manufacturingOrders.plannedDate,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, order.body.id));

    expect(saved.plannedQuantity).toBe("2.0000");
    expect(saved.plannedDate).toBe("2026-06-15");
  });

  test("manufacturing order stale save returns the shared conflict envelope with the fresh order", async ({
    db,
  }) => {
    const fixture = await createBomFixture("ConflictEnvelope");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const detailResponse = await testFetch(`/api/manufacturing-orders/${orderId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    const basePayload = {
      productId: detail.productId,
      plannedQuantity: detail.plannedQuantity,
      plannedDate: detail.plannedDate,
      notes: detail.notes,
      salesOrderId: detail.salesOrderId,
      salesOrderLineId: detail.salesOrderLineId,
      ingredients: detail.ingredients.map(
        (ingredient: { itemId: string; quantityPerUnit: string }) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: ingredient.quantityPerUnit,
        }),
      ),
      expectedVersion: detail.version,
    };

    const first = await testFetch(`/api/manufacturing-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first manufacturing writer" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/manufacturing-orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale manufacturing writer" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first manufacturing writer");
    expect(staleBody.current.version).toBe(detail.version + 1);
    expect(staleBody.order).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [savedOrder] = await db
      .select({ notes: manufacturingOrders.notes, version: manufacturingOrders.version })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(savedOrder.notes).toBe("first manufacturing writer");
    expect(savedOrder.version).toBe(detail.version + 1);
  });

  test("notes autosave rebase preserves an unsent blank ingredient row", async ({
    page,
  }) => {
    const fixture = await createBomFixture("BlankRow");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;
    const notes = `Blank ingredient rebase ${Date.now()}`;
    let delayedFirstSave = false;

    await page.route(`**/api/manufacturing-orders/${orderId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstSave) {
        delayedFirstSave = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/manufacturing/order/${orderId}`);
    await expectRows(page, 1);
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await expectRows(page, 2);

    const notesInput = page.getByPlaceholder("Notes for this order…");
    await notesInput.fill(notes);
    await notesInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectRows(page, 2);

    const saved = await (await testFetch(`/api/manufacturing-orders/${orderId}`)).json();
    expect(saved.notes).toBe(notes);
    expect(saved.ingredients).toHaveLength(1);
  });

  test("manufacturing order autosave keeps ingredient edits made during an in-flight header save", async ({
    page,
    db,
  }) => {
    const fixture = await createBomFixture("InflightIngredient");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;
    const notes = `MO save in flight ${Date.now()}`;

    let delayedFirstPut = false;
    let markPutStarted: () => void = () => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    await page.route(`**/api/manufacturing-orders/${orderId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        markPutStarted();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/manufacturing/order/${orderId}`);
    await expectRows(page, 1);

    const notesInput = page.getByPlaceholder("Notes for this order…");
    await notesInput.fill(notes);
    await notesInput.blur();
    await putStarted;

    await editGridCell(page, "quantityPerUnit", "4");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantityPerUnit"]').first(),
    ).toContainText("4");

    const [savedOrder] = await db
      .select({ notes: manufacturingOrders.notes })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(savedOrder.notes).toBe(notes);

    const [ingredient] = await db
      .select({
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
        plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredient.quantityPerUnit).toBe("4.0000");
    expect(ingredient.plannedQuantity).toBe("12.0000");
  });

  test("manufacturing order autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const fixture = await createBomFixture("ConflictUI");
    const order = await createManufacturingOrder({
      productId: fixture.productId,
      plannedQuantity: "3",
      plannedDate: "2026-06-10",
      notes: null,
      ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;
    const firstWriterNotes = `first manufacturing writer ${Date.now()}`;
    const staleWriterNotes = `stale manufacturing writer ${Date.now()}`;
    const resolvedNotes = `resolved manufacturing writer ${Date.now()}`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/manufacturing/order/${orderId}`);
      await secondPage.goto(`/manufacturing/order/${orderId}`);

      const firstNotes = secondPage.getByPlaceholder("Notes for this order…");
      await expect(firstNotes).toHaveValue("");
      await firstNotes.fill(firstWriterNotes);
      await firstNotes.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleNotes = page.getByPlaceholder("Notes for this order…");
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
        .select({ notes: manufacturingOrders.notes, version: manufacturingOrders.version })
        .from(manufacturingOrders)
        .where(eq(manufacturingOrders.id, orderId));
      expect(afterConflict.notes).toBe(firstWriterNotes);
      expect(afterConflict.version).toBe(2);

      await staleNotes.fill(resolvedNotes);
      await staleNotes.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByPlaceholder("Notes for this order…")).toHaveValue(
        resolvedNotes,
      );

      const [afterRecovery] = await db
        .select({ notes: manufacturingOrders.notes, version: manufacturingOrders.version })
        .from(manufacturingOrders)
        .where(eq(manufacturingOrders.id, orderId));
      expect(afterRecovery.notes).toBe(resolvedNotes);
      expect(afterRecovery.version).toBe(3);
    } finally {
      await secondContext.close();
    }
  });

  test("MO lifecycle fans out notifications to subscribed users only", async ({
    db,
  }) => {
    const fixture = await createBomFixture("Notif Fanout");

    async function createOrder() {
      const order = await createManufacturingOrder({
        productId: fixture.productId,
        plannedQuantity: "3",
        ingredients: [{ itemId: fixture.componentId, quantityPerUnit: "2" }],
        confirmShortage: false,
      });
      expect(order.status).toBe(201);
      return order.body.id as string;
    }

    try {
      // Not subscribed -> no rows.
      await setNotificationPreference("manufacturing_order_created", false);
      await setNotificationPreference("manufacturing_order_completed", false);
      const silentOrderId = await createOrder();
      const silentRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.entityId, silentOrderId));
      expect(silentRows).toHaveLength(0);

      // Subscribed with a device -> row delivered + push in outbox.
      await setNotificationPreference("manufacturing_order_created", true);
      await setNotificationPreference("manufacturing_order_completed", true);
      const token = `fast-fanout-${ts}`;
      const deviceRes = await testFetch("/api/push-devices", {
        method: "POST",
        body: JSON.stringify({ token, platform: "android" }),
      });
      expect(deviceRes.status).toBe(200);

      const orderId = await createOrder();
      const [testUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "test@test.com"));
      const rows = await db
        .select({
          id: notifications.id,
          deliveryStatus: notifications.deliveryStatus,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, orderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].deliveryStatus).toBe("delivered");

      const files = await fs.readdir(FCM_OUTBOX_DIR);
      const payloads = await Promise.all(
        files.map((f) =>
          fs.readFile(path.join(FCM_OUTBOX_DIR, f), "utf8").then(JSON.parse)
        )
      );
      // The data payload is the mobile contract: Android renders it client-side.
      const payload = payloads.find(
        (p) => p.token === token && p.data?.notificationId === rows[0].id
      );
      expect(payload).toBeDefined();
      expect(payload.data).toMatchObject({
        type: "manufacturing_order_created",
        entityType: "manufacturing_order",
        entityId: orderId,
      });
      expect(payload.data.organizationId).toBeTruthy();
      expect(payload.data.title).toBeTruthy();
      expect(payload.data.body).toBeTruthy();

      const completeBody = JSON.stringify({
        actualQuantity: "3",
        outputDisposition: "available",
        confirmNegativeStock: false,
      });
      const completionHeaders = {
        "Idempotency-Key": `fast-mo-complete-notification-${orderId}`,
      };
      const complete = await testFetch(`/api/manufacturing-orders/${orderId}/complete`, {
        method: "POST",
        headers: completionHeaders,
        body: completeBody,
      });
      expect(complete.status).toBe(200);
      const replay = await testFetch(`/api/manufacturing-orders/${orderId}/complete`, {
        method: "POST",
        headers: completionHeaders,
        body: completeBody,
      });
      expect(replay.status).toBe(200);
      const completedRows = await db
        .select({
          id: notifications.id,
          deliveryStatus: notifications.deliveryStatus,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, orderId),
            eq(notifications.type, "manufacturing_order_completed"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(completedRows).toHaveLength(1);
      const completedRow = completedRows[0];
      expect(completedRow.deliveryStatus).toBe("delivered");

      const afterCompleteFiles = await fs.readdir(FCM_OUTBOX_DIR);
      const afterCompletePayloads = await Promise.all(
        afterCompleteFiles.map((f) =>
          fs.readFile(path.join(FCM_OUTBOX_DIR, f), "utf8").then(JSON.parse)
        )
      );
      const completedPayload = afterCompletePayloads.find(
        (p) => p.token === token && p.data?.notificationId === completedRow.id
      );
      expect(completedPayload).toBeDefined();
      expect(completedPayload.data).toMatchObject({
        type: "manufacturing_order_completed",
        entityType: "manufacturing_order",
        entityId: orderId,
      });
    } finally {
      // Leave the shared test user unsubscribed for other suites.
      await setNotificationPreference("manufacturing_order_created", false);
      await setNotificationPreference("manufacturing_order_completed", false);
    }
  });

  test("MO created notifications respect manufacturing resource exclusions", async ({
    db,
  }) => {
    const [bagCrew] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Fast MO Bag Crew ${ts}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id, name: manufacturingResources.name });
    const [labelCrew] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Fast MO Label Crew ${ts}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id, name: manufacturingResources.name });

    const bagFixture = await createBomFixture("Notif Bag Resource", [
      {
        operationName: "Bagging",
        resourceId: bagCrew.id,
        costScalingMode: "per_output_unit",
        crewSize: "1",
        plannedMinutes: "10",
        loadedCostPerHour: "60",
      },
    ]);
    const labelFixture = await createBomFixture("Notif Label Resource", [
      {
        operationName: "Labeling",
        resourceId: labelCrew.id,
        costScalingMode: "per_output_unit",
        crewSize: "1",
        plannedMinutes: "10",
        loadedCostPerHour: "60",
      },
    ]);
    const multiFixture = await createBomFixture("Notif Multi Resource", [
      {
        operationName: "Bagging",
        resourceId: bagCrew.id,
        costScalingMode: "per_output_unit",
        crewSize: "1",
        plannedMinutes: "10",
        loadedCostPerHour: "60",
      },
      {
        operationName: "Labeling",
        resourceId: labelCrew.id,
        costScalingMode: "per_output_unit",
        crewSize: "1",
        plannedMinutes: "10",
        loadedCostPerHour: "60",
      },
    ]);

    async function createOrder(productId: string, componentId: string) {
      const order = await createManufacturingOrder({
        productId,
        plannedQuantity: "3",
        ingredients: [{ itemId: componentId, quantityPerUnit: "2" }],
        confirmShortage: false,
      });
      expect(order.status).toBe(201);
      return order.body.id as string;
    }

    try {
      await setNotificationPreference("manufacturing_order_created", true);
      await setManufacturingResourceExclusion(bagCrew.id, true);

      const prefs = await testFetch("/api/notification-preferences");
      expect(prefs.status).toBe(200);
      const prefsBody = await prefs.json();
      const manufacturingPref = prefsBody.preferences.find(
        (row: { eventType: string }) =>
          row.eventType === "manufacturing_order_created"
      );
      expect(manufacturingPref.resourceFilter.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: bagCrew.id,
            name: bagCrew.name,
            excluded: true,
          }),
          expect.objectContaining({
            id: labelCrew.id,
            name: labelCrew.name,
            excluded: false,
          }),
        ])
      );

      const bagOrderId = await createOrder(
        bagFixture.productId,
        bagFixture.componentId
      );
      const [testUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, "test@test.com"));
      const excludedRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, bagOrderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(excludedRows).toHaveLength(0);

      const labelOrderId = await createOrder(
        labelFixture.productId,
        labelFixture.componentId
      );
      const includedRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, labelOrderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(includedRows).toHaveLength(1);

      // Excluding only one of a multi-resource MO's resources still notifies.
      const partialOrderId = await createOrder(
        multiFixture.productId,
        multiFixture.componentId
      );
      const partialRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, partialOrderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(partialRows).toHaveLength(1);

      // Suppressed only once every resource on the MO is excluded.
      await setManufacturingResourceExclusion(labelCrew.id, true);
      const suppressedOrderId = await createOrder(
        multiFixture.productId,
        multiFixture.componentId
      );
      const suppressedRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.entityId, suppressedOrderId),
            eq(notifications.type, "manufacturing_order_created"),
            eq(notifications.userId, testUser.id)
          )
        );
      expect(suppressedRows).toHaveLength(0);
    } finally {
      await setManufacturingResourceExclusion(bagCrew.id, false).catch(() => {});
      await setManufacturingResourceExclusion(labelCrew.id, false).catch(() => {});
      await setNotificationPreference("manufacturing_order_created", false);
    }
  });

  test("done order reopens to work in progress with exact compensation, re-completes once, and blocks after shipping", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Reopen Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-REOPEN-COMP-${unique}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);
    const product = await createItem({
      itemType: "product",
      name: `Fast Reopen Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-REOPEN-PROD-${unique}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "3",
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "2" }],
      confirmShortage: false,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;
    expect((await releaseManufacturingOrder(orderId)).status).toBe(200);

    const [defaultLocation] = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, orgId),
          eq(inventoryLocations.isDefault, true)
        )
      );
    const [secondaryLocation] = await db
      .insert(inventoryLocations)
      .values({
        organizationId: orgId,
        name: `Fast Reopen Secondary ${unique}`,
        code: `fast-reopen-secondary-${unique}`,
        isDefault: false,
      })
      .returning({ id: inventoryLocations.id });
    const transfer = await testFetch("/api/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: defaultLocation.id,
        toLocationId: secondaryLocation.id,
        lines: [{ itemId: component.body.id, quantity: "7" }],
      }),
    });
    expect(transfer.status, await transfer.text()).toBe(201);
    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    await db
      .update(manufacturingOrderIngredients)
      .set({ plannedQuantity: "3" })
      .where(eq(manufacturingOrderIngredients.id, ingredient.id));
    const pickSecondary = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ locationId: secondaryLocation.id }),
      }
    );
    expect(pickSecondary.status, await pickSecondary.text()).toBe(200);
    await db
      .update(manufacturingOrderIngredients)
      .set({ plannedQuantity: "6", pickStatus: "in_progress" })
      .where(eq(manufacturingOrderIngredients.id, ingredient.id));
    const pickDefault = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    expect(pickDefault.status, await pickDefault.text()).toBe(200);
    const partialOutput = await testFetch(
      `/api/manufacturing-orders/${orderId}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({ quantity: "1" }),
      }
    );
    expect(partialOutput.status, await partialOutput.text()).toBe(200);
    const partialReversal = await testFetch(
      `/api/manufacturing-orders/${orderId}/outputs`,
      {
        method: "POST",
        body: JSON.stringify({ quantity: "-1" }),
      }
    );
    expect(partialReversal.status, await partialReversal.text()).toBe(200);
    const allocationsAfterPartialReversal = await db
      .select({
        locationId: manufacturingPickAllocations.locationId,
        quantityUsed: manufacturingPickAllocations.quantityUsed,
      })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    expect(
      allocationsAfterPartialReversal
        .map((allocation) => ({
          locationId: allocation.locationId,
          quantityUsed: allocation.quantityUsed,
        }))
        .sort((left, right) => (left.locationId ?? "").localeCompare(right.locationId ?? ""))
    ).toEqual(
      [
        { locationId: defaultLocation.id, quantityUsed: "3.0000" },
        { locationId: secondaryLocation.id, quantityUsed: "1.0000" },
      ].sort((left, right) => (left.locationId ?? "").localeCompare(right.locationId ?? ""))
    );
    const pickRemainder = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({ locationId: secondaryLocation.id }),
      }
    );
    expect(pickRemainder.status, await pickRemainder.text()).toBe(200);
    const completion = await completeManufacturingOrder(orderId, "3");
    expect(completion.status, JSON.stringify(completion.body)).toBe(200);

    async function onHand(itemId: string) {
      const [row] = await db
        .select({ onHandQty: sql<string>`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)` })
        .from(inventoryItemBalances)
        .where(eq(inventoryItemBalances.itemId, itemId));
      return row?.onHandQty ?? "0.0000";
    }

    const reopen = () =>
      testFetch(`/api/manufacturing-orders/${orderId}/reopen`, {
        method: "POST",
        body: JSON.stringify({}),
      });

    // Reopen restores stock, planning, and lifecycle exactly.
    const reopened = await reopen();
    expect(reopened.status, await reopened.text()).toBe(200);
    expect(await onHand(product.body.id)).toBe("0.0000");
    expect(await onHand(component.body.id)).toBe("10.0000");
    const allocationsAfterReopen = await db
      .select({ locationId: manufacturingPickAllocations.locationId })
      .from(manufacturingPickAllocations)
      .where(
        eq(manufacturingPickAllocations.manufacturingOrderIngredientId, ingredient.id)
      );
    expect(allocationsAfterReopen).toHaveLength(0);
    const [demand] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${inventoryDemandSummary.quantity}), 0)`,
      })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.itemId, component.body.id)
        )
      );
    expect(Number(demand.total)).toBe(6);
    const [expected] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${inventoryExpectedSummary.quantity}), 0)`,
      })
      .from(inventoryExpectedSummary)
      .where(
        and(
          eq(inventoryExpectedSummary.referenceType, "manufacturing_order"),
          eq(inventoryExpectedSummary.referenceId, orderId)
        )
      );
    expect(Number(expected.total)).toBe(3);
    const [afterReopen] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(afterReopen.status).toBe("open");
    expect(afterReopen.completedAt).toBeNull();
    expect(afterReopen.startedAt).not.toBeNull();
    expect(afterReopen.priorityRank).not.toBeNull();

    // Re-completion posts exactly one live output set on top of the
    // compensated history.
    const replenishDefault = await testFetch("/api/inventory/transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: secondaryLocation.id,
        toLocationId: defaultLocation.id,
        lines: [{ itemId: component.body.id, quantity: "1" }],
      }),
    });
    expect(replenishDefault.status, await replenishDefault.text()).toBe(201);
    expect((await completeManufacturingOrder(orderId, "2")).status).toBe(200);
    expect(await onHand(product.body.id)).toBe("2.0000");
    expect(await onHand(component.body.id)).toBe("6.0000");
    const [netOutput] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(Number(netOutput.total)).toBe(2);

    // Shipped output makes the transition fail atomically.
    const customer = await createCustomer({ name: `Fast Reopen Customer ${unique}` });
    expect(customer.status).toBe(201);
    const so = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-07-01",
      shipDate: "2026-07-02",
      lines: [{ itemId: product.body.id, quantity: "2", unitPrice: "25.00" }],
    });
    expect(so.status).toBe(201);
    const ship = await testFetch(`/api/sales-orders/${so.body.id}/ship`, {
      method: "POST",
      headers: { "Idempotency-Key": `fast-reopen-ship-${unique}` },
      body: JSON.stringify({}),
    });
    expect(ship.status, await ship.text()).toBe(200);

    const blocked = await reopen();
    expect([400, 409]).toContain(blocked.status);
    const [afterBlocked] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(afterBlocked.status).toBe("done");
    expect(await onHand(component.body.id)).toBe("6.0000");
  });

  test("linked make-to-order completion reopens without losing its sales link, and deleting the reopened order frees the line", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Reopen MTO Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-REOPEN-MTO-COMP-${unique}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status).toBe(201);
    const product = await createItem({
      itemType: "product",
      name: `Fast Reopen MTO Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-REOPEN-MTO-PROD-${unique}`,
      category: `Fast Manufacturing ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);
    const customer = await createCustomer({ name: `Fast Reopen MTO Customer ${unique}` });
    expect(customer.status).toBe(201);
    const salesOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderNumber: `REOPEN-MTO-${unique}`,
      orderDate: "2026-07-01",
      shipDate: "2026-07-02",
      lines: [{ itemId: product.body.id, quantity: "2", unitPrice: "20.00" }],
    });
    expect(salesOrder.status).toBe(201);
    const [salesLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrder.body.id));

    const createLinked = await testFetch(
      `/api/sales-orders/${salesOrder.body.id}/manufacturing-orders`,
      {
        method: "POST",
        body: JSON.stringify({
          manufacturingStrategy: "make_to_order",
          plannedDate: "2026-07-01",
          salesOrderLineIds: [salesLine.id],
          priorityRank: null,
          notes: null,
        }),
      }
    );
    expect(createLinked.status, await createLinked.text()).toBe(201);
    const [linkedOrder] = await db
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.salesOrderLineId, salesLine.id));
    expect((await releaseManufacturingOrder(linkedOrder.id)).status).toBe(200);
    const completed = await completeManufacturingOrder(linkedOrder.id, "2");
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);

    const deleteWhileDone = await testFetch(
      `/api/manufacturing-orders/${linkedOrder.id}`,
      { method: "DELETE" }
    );
    expect([400, 409]).toContain(deleteWhileDone.status);

    const reopened = await testFetch(
      `/api/manufacturing-orders/${linkedOrder.id}/reopen`,
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(reopened.status, await reopened.text()).toBe(200);
    const [afterReopen] = await db
      .select({
        status: manufacturingOrders.status,
        salesOrderId: manufacturingOrders.salesOrderId,
        salesOrderLineId: manufacturingOrders.salesOrderLineId,
      })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, linkedOrder.id));
    expect(afterReopen).toEqual({
      status: "open",
      salesOrderId: salesOrder.body.id,
      salesOrderLineId: salesLine.id,
    });

    const blockedLineEdit = await updateSalesOrder(salesOrder.body.id, {
      customerId: customer.body.id,
      orderDate: "2026-07-01",
      shipDate: "2026-07-02",
      lines: [{ itemId: product.body.id, quantity: "3", unitPrice: "20.00" }],
    });
    expect(blockedLineEdit.status).toBe(400);

    const deleteReopened = await testFetch(
      `/api/manufacturing-orders/${linkedOrder.id}`,
      { method: "DELETE" }
    );
    expect(deleteReopened.status, await deleteReopened.text()).toBe(200);
    const [afterDelete] = await db
      .select({ deletedAt: manufacturingOrders.deletedAt })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, linkedOrder.id));
    expect(afterDelete.deletedAt).not.toBeNull();

    const freedLineEdit = await updateSalesOrder(salesOrder.body.id, {
      customerId: customer.body.id,
      orderDate: "2026-07-01",
      shipDate: "2026-07-02",
      lines: [{ itemId: product.body.id, quantity: "3", unitPrice: "20.00" }],
    });
    expect(freedLineEdit.status, JSON.stringify(freedLineEdit.body)).toBe(200);
  });

  test("BOM alternate quantity is server-owned, and swapping is allowed until the ingredient is picked", async ({
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const base = await createItem({
      itemType: "material",
      name: `Alt Base ${unique}`,
      unitDefinitionId: unitId,
      sku: `ALT-BASE-${unique}`,
      category: `Alt Qty ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "500",
      safetyStock: "0",
      bom: [],
    });
    expect(base.status).toBe(201);

    const [familyRow] = await db
      .select({ id: itemFamilies.id })
      .from(items)
      .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(items.id, base.body.id));

    const [alt] = await db
      .insert(items)
      .values({
        organizationId: orgId,
        familyId: familyRow.id,
        name: `Alt Large ${unique}`,
        sku: `ALT-LARGE-${unique}`,
        itemType: "material",
        unitDefinitionId: unitId,
        safetyStock: "0",
        defaultPurchasePrice: "8.00",
        defaultSellingPrice: null,
        sellable: false,
        manufacturingMode: "discrete",
        optionCombinationKey: `alt-large-${unique}`,
        isMaster: false,
        sortOrder: 1,
      })
      .returning({ id: items.id });

    // Base line takes 12; the larger package takes 3 for the same output.
    const product = await createItem({
      itemType: "product",
      name: `Alt Product ${unique}`,
      unitDefinitionId: unitId,
      sku: `ALT-PRODUCT-${unique}`,
      category: `Alt Qty ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: base.body.id,
          quantity: "12",
          alternates: [{ itemId: alt.id, quantity: "3" }],
        },
      ],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    // The client submits the base line's number, as the mobile picker used to. The recipe
    // owns the alternate's quantity, so 3 wins over 12 — carrying 12 across the swap books a
    // much larger package at the small package's count and drifts stock every batch.
    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: "2",
      ingredients: [
        { itemId: alt.id, defaultItemId: base.body.id, quantityPerUnit: "12" },
      ],
      confirmShortage: false,
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;

    const [created] = await db
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(created).toMatchObject({ itemId: alt.id, quantityPerUnit: "3.0000" });

    const released = await releaseManufacturingOrder(orderId, { confirmShortage: true });
    expect([200, 201]).toContain(released.status);

    // Still unpicked: production may switch package after release.
    const swapBack = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${created.id}/material`,
      { method: "PATCH", body: JSON.stringify({ itemId: base.body.id }) },
    );
    expect(swapBack.status, await swapBack.text()).toBe(200);

    const [swapped] = await db
      .select({
        itemId: manufacturingOrderIngredients.itemId,
        quantityPerUnit: manufacturingOrderIngredients.quantityPerUnit,
      })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(swapped).toMatchObject({ itemId: base.body.id, quantityPerUnit: "12.0000" });

    const picked = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${created.id}/pick`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect([200, 201]).toContain(picked.status);

    // Once picked the material is fixed: reversing consumed stock by lot, location and cost
    // layer is out of scope, so the order is changed by deleting and recreating it.
    const refused = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${created.id}/material`,
      { method: "PATCH", body: JSON.stringify({ itemId: alt.id }) },
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("picked");
  });
});
