import { test, expect } from "../fixtures";
import {
  completeManufacturingOrder,
  createItem,
  createManufacturingOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
  updateItem,
} from "../../helpers/api";

// Regression: "produced today" (the mobile Done-today hero + the daily
// manufacturing report) must count EVERY completed production, not only
// sellable finished goods. Non-sellable intermediates (media prep, totes) are
// produced on the shop floor and must show up the same day.
//
// The assertion below is the read-path under test. Building the production
// (create item -> MO -> release -> pick -> complete) goes through the
// manufacturing write-path, which can transiently 500 under heavy parallel
// load; `produceToday` retries that setup so the read-path assertion stays
// deterministic. Each attempt uses fresh SKUs to avoid collisions.
test.describe("produced-today includes all production, not just sellable goods", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  async function pickAllIngredients(orderId: string) {
    const execution = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
    if (execution.status !== 200) throw new Error(`execution ${execution.status}`);
    const body = await execution.json();
    for (const ingredient of body.ingredients ?? []) {
      const pick = await testFetch(
        `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
        { method: "POST", body: JSON.stringify({}) }
      );
      if (pick.status !== 200) throw new Error(`pick ${pick.status}`);
    }
  }

  /** Build + complete one MO today, forcing the product's sellable flag. Throws on any non-2xx. */
  async function produceOnce(
    suffix: string,
    sellable: boolean,
    qty: string
  ): Promise<{ sku: string; orderId: string }> {
    const component = await createItem({
      itemType: "material",
      name: `PT Comp ${suffix}`,
      unitDefinitionId: unitId,
      sku: `PT-C-${suffix}`,
      category: `Produced Today ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    if (component.status !== 201) throw new Error(`component ${component.status}`);

    const sku = `PT-P-${suffix}`;
    const product = await createItem({
      itemType: "product",
      name: `PT Prod ${suffix}`,
      unitDefinitionId: unitId,
      sku,
      category: `Produced Today ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      sellable,
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    if (product.status !== 201) throw new Error(`product ${product.status}`);

    // Force the sellable flag explicitly (the create default may not honor it).
    const setSellable = await updateItem(product.body.id, { sellable });
    if (setSellable.status >= 400) throw new Error(`sellable ${setSellable.status}`);

    const order = await createManufacturingOrder({
      productId: product.body.id,
      plannedQuantity: qty,
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    if (order.status !== 201) throw new Error(`order ${order.status}`);
    const release = await releaseManufacturingOrder(order.body.id);
    if (release.status !== 200) throw new Error(`release ${release.status}`);
    await pickAllIngredients(order.body.id);
    const completion = await completeManufacturingOrder(order.body.id, qty);
    if (completion.status !== 200) throw new Error(`complete ${completion.status}`);
    return { sku, orderId: order.body.id as string };
  }

  async function produceToday(
    label: string,
    sellable: boolean,
    qty: string
  ): Promise<{ sku: string; orderId: string }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await produceOnce(`${label}-${ts}-${attempt}`, sellable, qty);
      } catch (error) {
        lastErr = error;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("produceToday failed");
  }

  test("non-sellable production from today shows up in produced-today", async () => {
    const { sku: intermediateSku } = await produceToday("INT", false, "5");
    const { sku: finishedSku } = await produceToday("FIN", true, "3");

    const res = await testFetch("/api/manufacturing-orders/produced-today");
    expect(res.status).toBe(200);
    const skus = ((await res.json()) as Array<{ productSku: string | null }>).map(
      (row) => row.productSku
    );

    // Control: a sellable finished good is present (endpoint works before + after the fix).
    expect(skus).toContain(finishedSku);
    // The bug: a non-sellable intermediate produced today must ALSO be counted.
    expect(skus).toContain(intermediateSku);
  });

  test("a same-day done→WIP reopen nets out of produced-today", async () => {
    const { sku, orderId } = await produceToday("REOPEN", true, "4");

    const before = await testFetch("/api/manufacturing-orders/produced-today");
    expect(before.status).toBe(200);
    const skusBefore = ((await before.json()) as Array<{ productSku: string | null }>).map(
      (row) => row.productSku
    );
    expect(skusBefore).toContain(sku);

    const reopen = await testFetch(`/api/manufacturing-orders/${orderId}/reopen`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(reopen.status, await reopen.text()).toBe(200);

    const after = await testFetch("/api/manufacturing-orders/produced-today");
    expect(after.status).toBe(200);
    const skusAfter = ((await after.json()) as Array<{ productSku: string | null }>).map(
      (row) => row.productSku
    );
    // Reversed production is no longer "produced today" — the negative
    // reversal rows net the day's sum to zero for this order.
    expect(skusAfter).not.toContain(sku);
  });
});
