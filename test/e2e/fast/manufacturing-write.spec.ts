import { eq } from "drizzle-orm";
import { test, expect, getIdFromUrl, selectDate } from "../fixtures";
import {
  manufacturingOrderIngredients,
  manufacturingOrders,
} from "../../../lib/db/schema";
import { createItem, getUnitId } from "../../helpers/api";

test.describe("Manufacturing write-path smoke", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitId = getUnitId();
  const sandName = `Fast MO Sand ${ts}`;
  const compostName = `Fast MO Compost ${ts}`;
  const productName = `Fast MO Blend ${ts}`;
  let productId = "";
  let sandId = "";
  let compostId = "";
  let orderId = "";

  test("creates and edits a manufacturing order through the browser form", async ({
    page,
    db,
  }) => {
    const sandCreate = await createItem({
      name: sandName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MO-SAND-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing sand",
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });
    const compostCreate = await createItem({
      name: compostName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FAST-MO-COMPOST-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing compost",
      defaultPurchasePrice: "3.00",
      defaultSellingPrice: null,
      stock: "20",
      safetyStock: "0",
      bom: [],
    });

    expect(sandCreate.status).toBe(201);
    expect(compostCreate.status).toBe(201);
    sandId = sandCreate.body.id;
    compostId = compostCreate.body.id;

    const productCreate = await createItem({
      name: productName,
      itemType: "product",
      unitDefinitionId: unitId,
      sku: `FAST-MO-PRODUCT-${ts}`,
      category: `Fast Manufacturing ${ts}`,
      description: "Fast manufacturing product",
      defaultPurchasePrice: null,
      defaultSellingPrice: "45.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        { componentId: sandId, quantity: "2" },
        { componentId: compostId, quantity: "1" },
      ],
    });

    expect(productCreate.status).toBe(201);
    productId = productCreate.body.id;

    await page.goto("/manufacturing/orders/new");
    await expect(page.getByText("Add Manufacturing Order")).toBeVisible();

    const productInput = page.getByPlaceholder("Search products...");
    await productInput.click();
    await productInput.fill(productName);
    await page.getByRole("option", { name: new RegExp(productName) }).click();

    await page.getByLabel("Planned Quantity").fill("5");
    await selectDate(page, page.getByLabel("Planned Date"), "2026-04-25");
    await page.getByLabel("Notes").fill("Fast manufacturing smoke test");
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/manufacturing-orders")
      ),
      page.getByRole("button", { name: "Create Order" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);

    await page.waitForURL(/\/manufacturing\/orders\/[0-9a-f-]+$/);
    orderId = getIdFromUrl(page.url());
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/MO-\d{4}-\d{4}/);

    const [order] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(order.productId).toBe(productId);
    expect(order.status).toBe("draft");
    expect(order.requestedQuantity).toBe("5.0000");
    expect(order.plannedQuantity).toBe("5.0000");
    expect(order.plannedDate).toBe("2026-04-25");
    expect(order.notes).toBe("Fast manufacturing smoke test");

    const ingredients = await db
      .select()
      .from(manufacturingOrderIngredients)
      .where(eq(manufacturingOrderIngredients.manufacturingOrderId, orderId));
    expect(ingredients).toHaveLength(2);

    await page.goto(`/manufacturing/orders/${orderId}/edit`);
    await page.waitForURL(`**/manufacturing/orders/${orderId}/edit`);
    await expect(
      page.getByRole("heading", { name: "Edit Manufacturing Order" })
    ).toBeVisible();
    await page.getByLabel("Notes").fill("Fast manufacturing updated");
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/manufacturing-orders/${orderId}`)
    );
    await page.getByRole("button", { name: "Save Changes" }).click();
    expect((await updateResponsePromise).status()).toBe(200);
    await page.waitForURL(`**/manufacturing/orders/${orderId}`);

    const [updatedOrder] = await db
      .select()
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, orderId));
    expect(updatedOrder.notes).toBe("Fast manufacturing updated");
  });
});
