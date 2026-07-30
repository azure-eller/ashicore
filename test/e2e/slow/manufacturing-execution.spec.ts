import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  lots,
  manufacturingOrderIngredients,
  manufacturingOrderOutputs,
  manufacturingOrders,
  manufacturingResources,
} from "../../../lib/db/schema";
import {
  completeManufacturingOrder,
  createItem,
  getOrgId,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";
import {
  createMaterialFixture,
  createReleasedManufacturingOrder,
  createSellableProductFixture,
  pickAllIngredients,
} from "./story-helpers";

test.describe("manufacturing execution operating story", () => {
  test.describe.configure({ mode: "serial" });

  let componentId: string;
  let productId: string;
  let orderId: string;

  test("prices a saved batch recipe using its revision output", async ({
    db,
    page,
  }) => {
    const component = await createMaterialFixture({
      name: "Batch recipe cost component",
      stock: "20",
      cost: "2.00",
    });
    const product = await createSellableProductFixture({
      name: "Batch recipe cost product",
      stock: "0",
      price: "24.00",
      bom: [{ componentId: component.id, quantity: "10" }],
    });
    const revisionResponse = await testFetch(
      `/api/items/${product.id}/bom-revisions`,
      {
        method: "POST",
        body: JSON.stringify({
          recipeBasis: "batch",
          expectedBatchYield: "10",
          outputQuantity: "10",
          bom: [{ componentId: component.id, quantity: "10" }],
        }),
      },
    );
    expect([200, 201]).toContain(revisionResponse.status);

    await db
      .update(items)
      .set({ expectedBatchYield: "20" })
      .where(eq(items.id, product.id));

    await page.goto(`/inventory/products/${product.id}/recipe`);
    const ingredientRow = page
      .locator(".ag-root")
      .last()
      .locator(".ag-row")
      .filter({ hasText: component.name });
    await expect(
      ingredientRow.locator('.ag-cell[col-id="estimatedContribution"]'),
    ).toContainText("2.00000");
    await expect(page.getByLabel("Output per batch")).toHaveValue("10");
  });

  test("keeps operation cost visible when a recipe has no ingredients", async ({
    db,
    page,
  }) => {
    const [resource] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: getOrgId(),
        name: `Operation-only recipe resource ${Date.now()}`,
        resourceType: "labor",
        loadedCostPerHour: "12.000000",
      })
      .returning({ id: manufacturingResources.id });
    const product = await createItem({
      itemType: "product",
      name: `Operation-only recipe ${Date.now()}`,
      sellable: true,
      unitDefinitionId: getUnitId(),
      sku: `OPERATION-ONLY-${Date.now()}`,
      category: "Slow Story",
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20.00",
      stock: "0",
      safetyStock: "0",
      bom: [],
      operationCosts: [
        {
          operationName: "Finish",
          resourceId: resource.id,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "15",
          loadedCostPerHour: "12",
        },
      ],
    });
    expect(product.status).toBe(201);

    await page.goto(`/inventory/products/${product.body.id}/recipe`);
    await expect(page.getByText(/Estimated ingredient cost \//).locator(".."))
      .toContainText("0.00000 USD");
    await expect(page.getByText(/Current operation cost \//).locator(".."))
      .toContainText("3.00000 USD");
    await expect(page.getByText(/Estimated product cost \//).locator(".."))
      .toContainText("3.00000 USD");
  });

  test("creates BOM snapshot and releases ingredient demand", async ({ db, page }) => {
    const component = await createMaterialFixture({
      name: "Manufacturing Story Component",
      stock: "20",
      cost: "2.50",
    });
    const draftComponent = await createMaterialFixture({
      name: "Manufacturing Story Draft Component",
      stock: "20",
      cost: "4.00",
    });
    componentId = component.id;
    const product = await createSellableProductFixture({
      name: "Manufacturing Story Product",
      stock: "0",
      price: "24.00",
      bom: [{ componentId, quantity: "2" }],
    });
    productId = product.id;

    await page.goto(`/inventory/products/${productId}/recipe`);
    await expect(
      page.getByRole("heading", { name: "Recipe / Bill of Materials" }),
    ).toBeVisible();

    const recipeGrid = page.locator(".ag-root").last();
    const ingredientRow = recipeGrid.locator(".ag-row").filter({
      hasText: component.name,
    });
    await expect(
      ingredientRow.locator('.ag-cell[col-id="estimatedContribution"]'),
    ).toContainText("5.00000");
    const productCostRow = page
      .getByText(/Estimated product cost \//)
      .locator("..");
    await expect(productCostRow).toContainText("5.00000 USD");

    const quantityCell = ingredientRow.locator('.ag-cell[col-id="quantity"]');
    await quantityCell.click();
    const quantityInput = quantityCell.locator("input:visible");
    await expect(quantityInput).toBeVisible();
    await quantityInput.fill("3");
    await quantityInput.press("Enter");

    await expect(
      ingredientRow.locator('.ag-cell[col-id="estimatedContribution"]'),
    ).toContainText("7.50000");
    await expect(productCostRow).toContainText("7.50000 USD");
    await expect(productCostRow).toContainText("draft");
    await expect(page.getByRole("button", { name: "Save recipe" })).toBeEnabled();

    await page.getByRole("button", { name: "Add ingredient" }).click();
    const draftRow = recipeGrid.locator('.ag-row[row-index="1"]');
    await draftRow.locator('.ag-cell[col-id="componentId"]').click();
    const componentSearch = page.getByPlaceholder("Search items...");
    await componentSearch.fill(draftComponent.name);
    await page
      .locator('[data-slot="combobox-item"]')
      .filter({ hasText: draftComponent.name })
      .first()
      .click();
    const draftQuantityCell = draftRow.locator('.ag-cell[col-id="quantity"]');
    await draftQuantityCell.click();
    const draftQuantityInput = draftQuantityCell.locator("input:visible");
    await draftQuantityInput.fill("1");
    await draftQuantityInput.press("Enter");
    await expect(
      draftRow.locator('.ag-cell[col-id="estimatedContribution"]'),
    ).toContainText("4.00000");
    await expect(productCostRow).toContainText("11.50000 USD");

    await draftRow.getByRole("button", { name: "Delete row" }).click();
    await ingredientRow.getByRole("button", { name: "Delete row" }).click();
    await expect(recipeGrid.locator(".ag-row")).toHaveCount(0);
    await expect(productCostRow).toContainText("0.00000 USD");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload();
    await expect(
      page
        .locator(".ag-root")
        .last()
        .locator(".ag-row")
        .filter({ hasText: component.name })
        .locator('.ag-cell[col-id="estimatedContribution"]'),
    ).toContainText("5.00000");
    await expect(
      page
        .locator(".ag-root")
        .last()
        .locator(".ag-row")
        .filter({ hasText: draftComponent.name }),
    ).toHaveCount(0);

    orderId = await createReleasedManufacturingOrder({
      productId,
      componentId,
      plannedQuantity: "4",
      quantityPerUnit: "2",
    });

    const [ingredient] = await db
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, componentId),
          eq(inventoryDemandSummary.referenceType, "manufacturing_order_ingredient"),
          eq(inventoryDemandSummary.referenceId, ingredient.id)
        )
      );
    expect(demand.quantity).toBe("8.0000");

    await page.goto(`/manufacturing/orders/${orderId}`);
    await expect(page.locator("main")).toContainText(product.name);
  });

  test("picks ingredients before completion", async ({ db }) => {
    await pickAllIngredients(orderId);

    const [componentBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, componentId));
    expect(componentBalance.onHandQty).toBe("12.0000");

    const componentEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, componentId),
          eq(inventoryEvents.eventType, "manufacturing_ingredient_consumption")
        )
      );
    expect(componentEvents).toHaveLength(1);
    expect(componentEvents[0].quantity).toBe("8.0000");
  });

  test("completion creates output stock and done status", async ({ db }) => {
    const completion = await completeManufacturingOrder(orderId, "4");
    expect(completion.status).toBe(200);

    const [productBalance] = await db
      .select({ onHandQty: inventoryItemBalances.onHandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(productBalance.onHandQty).toBe("4.0000");

    const [order] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(order.status).toBe("done");

    const outputEvents = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "manufacturing_output")
        )
      );
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0].quantity).toBe("4.0000");
  });

  test("output lot carries compact cost truth from consumed ingredients", async ({ db }) => {
    const [output] = await db
      .select({
        quantity: manufacturingOrderOutputs.quantity,
        unitCost: manufacturingOrderOutputs.unitCost,
        materialCostTotal: manufacturingOrderOutputs.materialCostTotal,
        lotId: manufacturingOrderOutputs.lotId,
      })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(output.quantity).toBe("4.0000");
    expect(output.unitCost).toBe("5.000000");
    expect(output.materialCostTotal).toBe("20.000000");

    const [lot] = await db
      .select({ unitCost: inventoryLotBalances.unitCost, quantity: lots.quantity })
      .from(lots)
      .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, lots.id))
      .where(eq(lots.id, output.lotId));
    expect(lot).toMatchObject({
      quantity: "4.0000",
      unitCost: "5.000000",
    });

    const staleUpdate = await updateItem(componentId, {
      name: "Manufacturing Story Component Updated",
      defaultPurchasePrice: "4.00",
      stock: "12",
      bom: [],
    });
    expect(staleUpdate.status).toBe(200);

    const [unchangedOutput] = await db
      .select({ unitCost: manufacturingOrderOutputs.unitCost })
      .from(manufacturingOrderOutputs)
      .where(eq(manufacturingOrderOutputs.manufacturingOrderId, orderId));
    expect(unchangedOutput.unitCost).toBe("5.000000");
  });

  test("deleting a released order rolls back expected output", async ({ db }) => {
    const deleteComponent = await createMaterialFixture({
      name: "Manufacturing Delete Component",
      stock: "5",
      cost: "2.00",
    });
    const deleteProduct = await createSellableProductFixture({
      name: "Manufacturing Delete Product",
      stock: "0",
      price: "20.00",
      bom: [{ componentId: deleteComponent.id, quantity: "1" }],
    });
    const deleteOrderId = await createReleasedManufacturingOrder({
      productId: deleteProduct.id,
      componentId: deleteComponent.id,
      plannedQuantity: "2",
      quantityPerUnit: "1",
    });

    const [productBefore] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, deleteProduct.id));
    expect(productBefore.expectedQty).toBe("2.0000");

    const deleteResponse = await testFetch(`/api/manufacturing-orders/${deleteOrderId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const [deletedOrder] = await db
      .select({ deletedAt: manufacturingOrders.deletedAt })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, deleteOrderId));
    expect(deletedOrder.deletedAt).toBeTruthy();

    const [productAfter] = await db
      .select({ expectedQty: inventoryItemBalances.expectedQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, deleteProduct.id));
    expect(productAfter.expectedQty).toBe("0.0000");

    const referencedEvents = await db
      .select({ eventType: inventoryEvents.eventType })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.referenceId, deleteOrderId));
    expect(
      referencedEvents.filter((event) =>
        [
          "manufacturing_ingredient_consumption",
          "manufacturing_output",
          "unpick_restock",
        ].includes(event.eventType)
      )
    ).toHaveLength(0);
  });
});
