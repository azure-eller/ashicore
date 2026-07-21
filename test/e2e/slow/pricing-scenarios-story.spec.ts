import { eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  manufacturingResources,
  organization,
  pricingScenarioRevisions,
  pricingScenarios,
} from "../../../lib/db/schema";
import { createItem, getOrgId, getUnitId, updateItem } from "../../helpers/api";

const orgId = getOrgId();
const unitId = getUnitId();
const ts = Date.now();

test.describe("pricing scenario story", () => {
  test.describe.configure({ mode: "serial" });

  test("an owner models pricing from live recipes and keeps a frozen revision history", async ({
    page,
    db,
  }) => {
    await db
      .update(organization)
      .set({ entitlements: ["pricing_scenarios"] })
      .where(eq(organization.id, orgId));

    const [resource] = await db
      .insert(manufacturingResources)
      .values({
        organizationId: orgId,
        name: `Story Labor ${ts}`,
        resourceType: "labor",
        loadedCostPerHour: "60.000000",
      })
      .returning({ id: manufacturingResources.id });

    const coir = await createItem({
      itemType: "material",
      name: `Story Coir ${ts}`,
      unitDefinitionId: unitId,
      sku: `STORY-COIR-${ts}`,
      category: `Story ${ts}`,
      description: null,
      defaultPurchasePrice: "30.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(coir.status).toBe(201);

    // 1 coir (30) + 0.5h labor (30) = 60 direct cost per unit.
    const blend = await createItem({
      itemType: "product",
      name: `Story Blend ${ts}`,
      unitDefinitionId: unitId,
      sku: `STORY-BLEND-${ts}`,
      category: `Story ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "100.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: coir.body.id, quantity: "1" }],
      operationCosts: [
        {
          operationName: "Blend",
          resourceId: resource.id,
          costScalingMode: "per_output_unit",
          crewSize: "1",
          plannedMinutes: "30",
          loadedCostPerHour: "60",
        },
      ],
    });
    expect(blend.status).toBe(201);

    // Create a named scenario from the library page; autosave persists it
    // once a product is added — there is no save button.
    await page.goto("/sales/pricing-scenarios");
    await page.getByRole("link", { name: "New scenario" }).click();
    await page.locator("#scenario-name").fill(`Story Scenario ${ts}`);
    await page.locator("#scenario-name").press("Enter");
    const picker = page.locator("#scenario-add-product");
    await picker.click();
    await picker.pressSequentially(`STORY-BLEND-${ts}`, { delay: 25 });
    await page.getByRole("option").first().click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // Shared assumptions recalculate live: 60 / (1 - 0.2 - 0.3) = 120.
    await page.locator("#scenario-overhead").fill("20");
    await page.locator("#scenario-overhead").press("Enter");
    await page.locator("#scenario-profit").fill("30");
    await page.locator("#scenario-profit").press("Enter");
    await expect(page.getByText("$120.00").first()).toBeVisible();

    // A material override carries through: 40 + 30 = 70 => 140.
    const priceInput = page.getByLabel(`Story Coir ${ts} price`);
    await priceInput.fill("40");
    await priceInput.press("Enter");
    await expect(page.getByText("$140.00").first()).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // Commit revision 1: the decision record.
    await page.getByRole("button", { name: "Commit revision" }).click();
    await page.getByPlaceholder("Note (optional)").fill("Spring price list");
    await page.getByRole("button", { name: "Commit revision" }).last().click();
    await expect(page.getByText("Rev 1", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const [scenarioRow] = await db
      .select({ id: pricingScenarios.id })
      .from(pricingScenarios)
      .where(eq(pricingScenarios.name, `Story Scenario ${ts}`));
    const revisions = await db
      .select({
        revisionNumber: pricingScenarioRevisions.revisionNumber,
        note: pricingScenarioRevisions.note,
        snapshot: pricingScenarioRevisions.snapshot,
      })
      .from(pricingScenarioRevisions)
      .where(eq(pricingScenarioRevisions.scenarioId, scenarioRow.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].note).toBe("Spring price list");
    const rev1Product = revisions[0].snapshot.products[0];
    expect(rev1Product.result).toMatchObject({ withheld: false, sellAt: "140.00" });

    // ERP moves on: coir price doubles. Reopening shows the live baseline
    // moved while the committed record did not.
    const drift = await updateItem(coir.body.id as string, {
      defaultPurchasePrice: "60.00",
    });
    expect([200, 201]).toContain(drift.status);

    await page.reload();
    await expect(page.getByText("Rev 1", { exact: true })).toBeVisible();
    // Override still pins coir at 40, so the live result stays 140; the
    // placeholder under the override now reflects the new baseline.
    await expect(page.getByText("$140.00").first()).toBeVisible();
    await expect(page.getByLabel(`Story Coir ${ts} price`)).toHaveAttribute(
      "placeholder",
      "60"
    );

    // The frozen record still reads exactly what was decided.
    await page.getByText("Rev 1", { exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Spring price list");
    await expect(page.getByRole("dialog")).toContainText("$140.00");
    await page.getByRole("button", { name: "Close" }).first().click();

    // Clearing the override lets the live baseline through: 60 + 30 = 90
    // => 90 / 0.5 = 180. Committing captures the new reality as Rev 2.
    await page.getByLabel(`Story Coir ${ts} price`).fill("");
    await page.getByLabel(`Story Coir ${ts} price`).press("Enter");
    await expect(page.getByText("$180.00").first()).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Commit revision" }).click();
    await page.getByRole("button", { name: "Commit revision" }).last().click();
    await expect(page.getByText("Rev 2", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const allRevisions = await db
      .select({ revisionNumber: pricingScenarioRevisions.revisionNumber })
      .from(pricingScenarioRevisions)
      .where(eq(pricingScenarioRevisions.scenarioId, scenarioRow.id));
    expect(allRevisions.map((row) => row.revisionNumber).sort()).toEqual([1, 2]);
  });
});
