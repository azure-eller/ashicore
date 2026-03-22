import { describe, test, expect } from "vitest";
import { createItem, getUnitId } from "@/test/helpers/api";

describe("API smoke test (real auth, real DB)", () => {
  test("creating a product hits the real API and returns a result", async () => {
    const unitId = getUnitId();
    expect(unitId).toBeTruthy();

    const { status, body } = await createItem({
      name: "Smoke Test Product",
      itemType: "product",
      unitDefinitionId: unitId,
      stock: "0",
      safetyStock: "0",
      bomMode: "quantity",
      bom: [],
    });

    // This will FAIL if the product creation bug exists
    expect(body, `API returned ${status}: ${JSON.stringify(body)}`).toHaveProperty("id");
    expect(status).toBe(201);
  });
});
