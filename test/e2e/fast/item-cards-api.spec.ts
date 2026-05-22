import { eq, and } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponents,
  bomRevisions,
  itemFamilies,
  itemVariantValues,
  items,
} from "@/lib/db/schema";
import { createItem, deleteItem, getUnitId, testFetch } from "../../helpers/api";

test.describe("item card API", () => {
  test("creates, configures, generates, copies BOM, and guards deletes", async ({ db }) => {
    const ts = Date.now();
    const unitDefinitionId = getUnitId();

    const cardCreate = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "material",
        name: `Card API Material ${ts}`,
        category: `Card API ${ts}`,
        unitDefinitionId,
      }),
    });
    expect(cardCreate.status).toBe(201);
    const cardCreateBody = await cardCreate.json();
    const materialCardItemId = cardCreateBody.itemId as string;

    const patchName = `Card API Material Renamed ${ts}`;
    const patch = await testFetch(`/api/item-cards/${materialCardItemId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: patchName }),
    });
    expect(patch.status).toBe(200);
    const patchBody = await patch.json();
    expect(patchBody.family.name).toBe(patchName);
    expect(patchBody.family.category).toBe(`Card API ${ts}`);

    const patchedCard = await testFetch(`/api/item-cards/${materialCardItemId}`);
    expect(patchedCard.status).toBe(200);
    const patchedCardBody = await patchedCard.json();
    expect(patchedCardBody.family.name).toBe(patchName);
    expect(patchedCardBody.family.category).toBe(`Card API ${ts}`);

    const config = await testFetch(`/api/item-cards/${materialCardItemId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Grade",
            values: [{ label: "A" }, { label: "B" }],
          },
        ],
      }),
    });
    expect(config.status).toBe(200);

    const copyTarget = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "material",
        name: `Card API Copy Target ${ts}`,
        category: `Card API ${ts}`,
        unitDefinitionId,
      }),
    });
    expect(copyTarget.status).toBe(201);
    const copyTargetBody = await copyTarget.json();
    const copyConfig = await testFetch(
      `/api/item-cards/${copyTargetBody.itemId}/variant-config/copy-from`,
      {
        method: "POST",
        body: JSON.stringify({ sourceItemId: materialCardItemId }),
      },
    );
    expect(copyConfig.status).toBe(200);
    const copiedConfigBody = await copyConfig.json();
    expect(copiedConfigBody.options).toHaveLength(1);
    expect(copiedConfigBody.options[0].name).toBe("Grade");
    expect(copiedConfigBody.options[0].values.map((value: { label: string }) => value.label)).toEqual([
      "A",
      "B",
    ]);

    const preview = await testFetch(
      `/api/item-cards/${materialCardItemId}/variants/generate-preview`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.missingCount).toBe(2);

    const generateNone = await testFetch(
      `/api/item-cards/${materialCardItemId}/variants/generate`,
      { method: "POST", body: JSON.stringify({ combinations: [] }) },
    );
    expect(generateNone.status).toBe(201);
    expect((await generateNone.json()).created).toHaveLength(0);

    const generateAll = await testFetch(
      `/api/item-cards/${materialCardItemId}/variants/generate`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(generateAll.status).toBe(201);
    const generated = await generateAll.json();
    expect(generated.created).toHaveLength(1);

    const materialCard = await testFetch(`/api/item-cards/${materialCardItemId}`);
    expect(materialCard.status).toBe(200);
    const materialCardBody = await materialCard.json();
    expect(materialCardBody.variants).toHaveLength(2);
    expect(
      materialCardBody.variants.every(
        (variant: { optionCombinationKey: string }) => variant.optionCombinationKey !== "",
      ),
    ).toBe(true);

    const deleteGenerated = await deleteItem(generated.created[0].id);
    expect(deleteGenerated.status).toBe(200);

    const deleteLast = await deleteItem(materialCardItemId);
    expect(deleteLast.status).toBe(400);

    const component = await createItem({
      itemType: "material",
      name: `Card API Component ${ts}`,
      unitDefinitionId,
      sku: `CARD-COMP-${ts}`,
      category: `Card API ${ts}`,
      description: null,
      stock: "0",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: null,
      currentStockUnitCost: "1",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Card API Product ${ts}`,
      unitDefinitionId,
      sku: `CARD-PROD-${ts}`,
      category: `Card API ${ts}`,
      description: null,
      stock: "0",
      safetyStock: "0",
      sellable: true,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "10",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: component.body.id, quantity: "1" }],
      revisionNote: "Initial card API BOM",
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    const productConfig = await testFetch(`/api/item-cards/${product.body.id}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [
          {
            name: "Pack",
            values: [{ label: "Small" }, { label: "Large" }],
          },
        ],
      }),
    });
    expect(productConfig.status).toBe(200);

    const productGenerate = await testFetch(
      `/api/item-cards/${product.body.id}/variants/generate`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(productGenerate.status).toBe(201);
    const productGenerated = await productGenerate.json();
    const targetVariantId = productGenerated.created[0].id as string;

    const copyBom = await testFetch(`/api/item-cards/${product.body.id}/bom-copy`, {
      method: "POST",
      body: JSON.stringify({ targetVariantIds: [targetVariantId] }),
    });
    expect(copyBom.status).toBe(201);

    const [targetRevision] = await db
      .select({ id: bomRevisions.id })
      .from(bomRevisions)
      .where(and(eq(bomRevisions.productId, targetVariantId), eq(bomRevisions.isCurrent, true)));
    expect(targetRevision).toBeTruthy();

    const targetComponents = await db
      .select()
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, targetRevision.id));
    expect(targetComponents).toHaveLength(1);
    expect(targetComponents[0].componentId).toBe(component.body.id);

    const [sourceItem] = await db
      .select({ familyId: items.familyId })
      .from(items)
      .where(eq(items.id, product.body.id));
    expect(sourceItem.familyId).toBeTruthy();

    const [family] = await db
      .select()
      .from(itemFamilies)
      .where(eq(itemFamilies.id, sourceItem.familyId!));
    expect(family.name).toBe(`Card API Product ${ts}`);

    const assignments = await db
      .select()
      .from(itemVariantValues)
      .where(eq(itemVariantValues.itemId, product.body.id));
    expect(assignments).toHaveLength(1);

    const legacyUpdate = await testFetch(`/api/items/${product.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Legacy update should not work" }),
    });
    expect(legacyUpdate.status).toBe(405);
  });

  test("uses recipe-standard ingredient cost on item cards and list margins", async () => {
    const ts = Date.now();
    const unitDefinitionId = getUnitId();

    const material = await createItem({
      itemType: "material",
      name: `Card Cost Material ${ts}`,
      unitDefinitionId,
      sku: `CARD-COST-MAT-${ts}`,
      category: `Card Cost ${ts}`,
      description: null,
      stock: "0",
      safetyStock: "0",
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: "2",
      defaultSellingPrice: null,
      currentStockUnitCost: null,
      bom: [],
    });
    expect(material.status, JSON.stringify(material.body)).toBe(201);

    const subassembly = await createItem({
      itemType: "product",
      name: `Card Cost Subassembly ${ts}`,
      unitDefinitionId,
      sku: `CARD-COST-SUB-${ts}`,
      category: `Card Cost ${ts}`,
      description: null,
      stock: "0",
      safetyStock: "0",
      sellable: false,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: material.body.id, quantity: "3" }],
    });
    expect(subassembly.status, JSON.stringify(subassembly.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Card Cost Product ${ts}`,
      unitDefinitionId,
      sku: `CARD-COST-PROD-${ts}`,
      category: `Card Cost ${ts}`,
      description: null,
      stock: "0",
      safetyStock: "0",
      sellable: true,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "20",
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      bom: [{ componentId: subassembly.body.id, quantity: "2" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    const card = await testFetch(`/api/item-cards/${product.body.id}`);
    expect(card.status).toBe(200);
    const cardBody = await card.json();
    const productVariant = cardBody.variants.find(
      (variant: { id: string }) => variant.id === product.body.id
    );
    expect(productVariant).toMatchObject({
      ingredientsCost: "12",
      operationsCost: null,
    });

    const productsResponse = await testFetch("/api/items?itemType=product");
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as Array<{
      id: string;
      estimatedUnitCost: string | null;
      marginPercent: string | null;
    }>;
    const listProduct = products.find((row) => row.id === product.body.id);
    expect(listProduct).toMatchObject({
      estimatedUnitCost: "12",
      marginPercent: "40",
    });
  });
});
