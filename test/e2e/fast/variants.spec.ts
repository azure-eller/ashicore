import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { itemVariantValues, items } from "@/lib/db/schema";
import { getUnitId, testFetch } from "../../helpers/api";

test.describe("variant product cards", () => {
  const ts = Date.now();
  const productName = `Test Soil ${ts}`;
  const packageValue = "2 Cubic Foot Bag";

  test("configures a product card variant without legacy master rows", async ({ db }) => {
    const create = await testFetch("/api/item-cards", {
      method: "POST",
      body: JSON.stringify({
        itemType: "product",
        name: productName,
        unitDefinitionId: getUnitId(),
        sellable: true,
        defaultSellingPrice: "30.00",
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    const variantId = created.itemId as string;

    const config = await testFetch(`/api/item-cards/${variantId}/variant-config`, {
      method: "PUT",
      body: JSON.stringify({
        options: [{ name: "Package", values: [{ label: packageValue }] }],
      }),
    });
    expect(config.status).toBe(200);

    const generate = await testFetch(`/api/item-cards/${variantId}/variants/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(generate.status).toBe(201);

    const card = await testFetch(`/api/item-cards/${variantId}`);
    expect(card.status).toBe(200);
    const cardBody = await card.json();
    expect(cardBody.family.name).toBe(productName);
    expect(cardBody.variants).toHaveLength(1);
    expect(cardBody.variants[0].displayName).toBe(`${productName} / ${packageValue}`);

    const [row] = await db.select().from(items).where(eq(items.id, variantId));
    expect(row.familyId).toBeTruthy();

    const assignments = await db
      .select()
      .from(itemVariantValues)
      .where(eq(itemVariantValues.itemId, variantId));
    expect(assignments).toHaveLength(1);

    const [updated] = await db.select().from(items).where(eq(items.id, variantId));
    expect(updated.description).toBeNull();
  });
});
