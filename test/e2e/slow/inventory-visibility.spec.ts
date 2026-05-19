import { test, expect, filterList } from "../fixtures";
import {
  confirmSalesOrder,
  createCustomer,
  createItem,
  createSalesOrder,
  createVariant,
  fulfillSalesOrder,
  getUnitId,
  updateItem,
} from "../../helpers/api";

test.describe("Inventory visibility ranking", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const unitDefinitionId = getUnitId();

  const materialName = `Revenue Material ${ts}`;
  const productAName = `Revenue Rank ${ts} Alpha`;
  const productBName = `Revenue Rank ${ts} Bravo`;
  const zeroOlderName = `Revenue Rank ${ts} Zero Older`;
  const zeroNewerName = `Revenue Rank ${ts} Zero Newer`;
  const familyName = `Revenue Rank ${ts} Family`;
  const soldVariantDisplayName = `${familyName} / Retail`;
  const unsoldVariantDisplayName = `${familyName} / Bulk`;

  // TODO(card-ui): Rewrite to use the card variant-config + generate flow.
  // Legacy POST /api/items with `isMaster: true` returns 410 now that the
  // card's variant-config endpoints are the supported way to create variant
  // families. This test exercises variant grouping in revenue ranking; once
  // rewritten, it should use:
  //   1. POST /api/item-cards to create the family
  //   2. PUT /api/item-cards/:itemId/variant-config to define options + values
  //   3. POST /api/item-cards/:itemId/variants/generate to produce variants
  test.skip("creates fulfilled sales history for revenue-ranked products", async () => {
    const material = await createItem({
      name: materialName,
      itemType: "material",
      unitDefinitionId,
      sellable: true,
      stock: "500",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(material.status).toBe(201);
    const materialId = material.body.id;

    const olderZero = await createItem({
      name: zeroOlderName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "0",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "9.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(olderZero.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const newerZero = await createItem({
      name: zeroNewerName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "0",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "9.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [],
      revisionNote: null,
    });
    expect(newerZero.status).toBe(201);

    const productA = await createItem({
      name: productAName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "25",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: "Initial recipe",
    });
    expect(productA.status).toBe(201);
    const productAId = productA.body.id;

    const productB = await createItem({
      name: productBName,
      itemType: "product",
      unitDefinitionId,
      sellable: true,
      stock: "25",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "50.00",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: "Initial recipe",
    });
    expect(productB.status).toBe(201);
    const productBId = productB.body.id;

    const family = await createItem({
      isMaster: true,
      name: familyName,
      description: null,
      category: `Revenue ${ts}`,
      variantAxes: ["Package"],
    });
    expect(family.status).toBe(201);
    const familyId = family.body.id;

    const soldVariant = await createVariant(familyId, {
      unitDefinitionId,
      variantAttrs: { Package: "Retail" },
      sellable: true,
      sku: null,
      description: null,
      defaultSellingPrice: "40.00",
      defaultPurchasePrice: null,
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: "Sellable retail pack",
    });
    expect(soldVariant.status).toBe(201);
    const soldVariantId = soldVariant.body.id;

    const unsoldVariant = await createVariant(familyId, {
      unitDefinitionId,
      variantAttrs: { Package: "Bulk" },
      sellable: true,
      sku: null,
      description: null,
      defaultSellingPrice: "35.00",
      defaultPurchasePrice: null,
      safetyStock: "0",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: "Sellable bulk pack",
    });
    expect(unsoldVariant.status).toBe(201);

    const soldVariantStock = await updateItem(soldVariantId, {
      name: familyName,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      sku: null,
      category: `Revenue ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "40.00",
      sellable: true,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      stock: "25",
      safetyStock: "0",
      bom: [{ componentId: materialId, quantity: "1" }],
      revisionNote: null,
    });
    expect(soldVariantStock.status).toBe(200);

    const customer = await createCustomer({ name: `Revenue Customer ${ts}` });
    expect(customer.status).toBe(201);
    const customerId = customer.body.id;

    const orderA = await createSalesOrder({
      customerId,
      lines: [{ itemId: productAId, quantity: "10", unitPrice: "10.00" }],
    });
    expect(orderA.status).toBe(201);
    expect((await confirmSalesOrder(orderA.body.id)).status).toBe(200);
    expect((await fulfillSalesOrder(orderA.body.id)).status).toBe(200);

    const orderB = await createSalesOrder({
      customerId,
      lines: [{ itemId: productBId, quantity: "1", unitPrice: "50.00" }],
    });
    expect(orderB.status).toBe(201);
    expect((await confirmSalesOrder(orderB.body.id)).status).toBe(200);
    expect((await fulfillSalesOrder(orderB.body.id)).status).toBe(200);

    const familyOrder = await createSalesOrder({
      customerId,
      lines: [{ itemId: soldVariantId, quantity: "4", unitPrice: "40.00" }],
    });
    expect(familyOrder.status).toBe(201);
    expect((await confirmSalesOrder(familyOrder.body.id)).status).toBe(200);
    expect((await fulfillSalesOrder(familyOrder.body.id)).status).toBe(200);

    const rankedNames = [
      soldVariantDisplayName,
      productAName,
      productBName,
      unsoldVariantDisplayName,
      zeroNewerName,
      zeroOlderName,
    ];
    expect(rankedNames).toHaveLength(6);
    expect(customerId).not.toBe("");
    expect(materialId).not.toBe("");
    expect(unsoldVariant.body.id).not.toBe("");
  });

  // TODO(card-ui): Depends on the variant family created by the skipped
  // revenue-ranking test above. Rewire after the card variant flow rewrite.
  test.skip("orders Products alphabetically with variants grouped by family", async ({ page }) => {
    await page.goto("/inventory/products");
    await filterList(page, "Search items", `Revenue Rank ${ts}`);

    const rowLinks = page.locator(
      "[data-slot='erp-data-grid'] .ag-center-cols-container [role='row'][row-index] a[href^='/inventory/products/']",
    );
    await expect(rowLinks.first()).toBeVisible();

    const orderedNames = await rowLinks.evaluateAll((links) =>
      links.map((link) => link.textContent?.trim() ?? "").filter(Boolean),
    );
    const expectedNames = [
      productAName,
      productBName,
      unsoldVariantDisplayName,
      soldVariantDisplayName,
      zeroNewerName,
    ];
    const currentRunNames = orderedNames.filter((name) => expectedNames.includes(name));

    expect(currentRunNames).toEqual(expectedNames);
  });
});
