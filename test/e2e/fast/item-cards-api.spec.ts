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
    const materialCardItemId = cardCreateBody.id as string;

    const patchName = `Card API Material Renamed ${ts}`;
    const patch = await testFetch(`/api/item-cards/${materialCardItemId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: patchName }),
    });
    expect(patch.status).toBe(200);

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
      stock: "0",
      safetyStock: "0",
      defaultPurchasePrice: "1",
      currentStockUnitCost: "1",
    });
    expect(component.status).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Card API Product ${ts}`,
      unitDefinitionId,
      sku: `CARD-PROD-${ts}`,
      stock: "0",
      safetyStock: "0",
      sellable: true,
      defaultSellingPrice: "10",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status).toBe(201);

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
  });
});
