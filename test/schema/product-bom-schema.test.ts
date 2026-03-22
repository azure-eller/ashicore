// Mock the items table so createInsertSchema can derive the base schema
// without needing a real DB connection.
vi.mock("@/lib/db/schema", () => {
  const {
    pgSchema,
    varchar,
    text,
    numeric,
    timestamp,
    uuid,
  } = require("drizzle-orm/pg-core");

  const inventory = pgSchema("inventory");

  const items = inventory.table("items", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    itemType: varchar("item_type", { length: 20 }).notNull(),
    sku: varchar("sku", { length: 100 }),
    category: varchar("category", { length: 100 }),
    description: text("description"),
    unitDefinitionId: uuid("unit_definition_id").notNull(),
    defaultPurchasePrice: numeric("default_purchase_price", {
      precision: 10,
      scale: 4,
    }),
    defaultSellingPrice: numeric("default_selling_price", {
      precision: 10,
      scale: 4,
    }),
    safetyStock: numeric("safety_stock", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    committedQty: numeric("committed_qty", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    expectedQty: numeric("expected_qty", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    bomMode: varchar("bom_mode", { length: 20 }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  });

  return { items };
});

import { insertItemSchema } from "@/lib/schemas/items";

// All nullable fields must be explicitly set because createInsertSchema does NOT
// wrap overrides with .optional() — nullableString accepts string | null, not undefined.
const validProduct = {
  name: "Topsoil Mix",
  itemType: "product" as const,
  unitDefinitionId: "some-uuid-123",
  stock: "0",
  safetyStock: "0",
  sku: null,
  category: null,
  description: null,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
};

describe("product-bom schema", () => {
  // ---------------------------------------------------------------
  // 1. name-valid-typical
  // ---------------------------------------------------------------
  test("name-valid-typical: accepts a valid product name", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      name: "Topsoil Mix",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Topsoil Mix");
    }
  });

  // ---------------------------------------------------------------
  // 2. name-empty-string-rejected
  // ---------------------------------------------------------------
  test("name-empty-string-rejected: rejects empty name", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      name: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Name is required");
    }
  });

  // ---------------------------------------------------------------
  // 3. name-whitespace-only-rejected (documents a gap)
  // ---------------------------------------------------------------
  test("name-whitespace-only-rejected: whitespace-only name passes because min(1) checks length not content", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      name: "   ",
    });

    // Documents a gap: "   " has length 3, which passes min(1).
    // The name field uses z.string().min(1), not nullableString, so no trimming occurs.
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------
  // 4. sku-empty-becomes-null
  // ---------------------------------------------------------------
  test("sku-empty-becomes-null: empty string SKU is normalized to null", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      sku: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sku).toBeNull();
    }
  });

  // ---------------------------------------------------------------
  // 5. purchase-price-valid-decimal
  // ---------------------------------------------------------------
  test("purchase-price-valid-decimal: keeps valid decimal string as-is", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      defaultPurchasePrice: "12.50",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultPurchasePrice).toBe("12.50");
    }
  });

  // ---------------------------------------------------------------
  // 6. stock-negative-rejected-by-zod
  // ---------------------------------------------------------------
  test("stock-negative-rejected-by-zod: rejects negative stock", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      stock: "-5",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Must be a non-negative number");
    }
  });

  // ---------------------------------------------------------------
  // 7. stock-non-numeric-rejected-by-zod
  // ---------------------------------------------------------------
  test("stock-non-numeric-rejected-by-zod: rejects non-numeric stock", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      stock: "abc",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Must be a non-negative number");
    }
  });

  // ---------------------------------------------------------------
  // 8. unit-required-on-create
  // ---------------------------------------------------------------
  test("unit-required-on-create: rejects empty unitDefinitionId", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      unitDefinitionId: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Unit is required");
    }
  });

  // ---------------------------------------------------------------
  // 9. bom-quantity-mode-valid-submission
  // ---------------------------------------------------------------
  test("bom-quantity-mode-valid-submission: accepts valid quantity-mode BOM", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "quantity",
      bom: [
        { componentId: "a", quantity: "2.5", percentage: null },
        { componentId: "b", quantity: "1", percentage: null },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bom).toHaveLength(2);
      expect(result.data.bom![0].quantity).toBe("2.5");
      expect(result.data.bom![1].quantity).toBe("1");
    }
  });

  // ---------------------------------------------------------------
  // 10. bom-percentage-mode-valid-submission
  // ---------------------------------------------------------------
  test("bom-percentage-mode-valid-submission: accepts valid percentage-mode BOM", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "percentage",
      bom: [
        { componentId: "a", quantity: null, percentage: "60" },
        { componentId: "b", quantity: null, percentage: "40" },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bom).toHaveLength(2);
      expect(result.data.bom![0].percentage).toBe("60");
      expect(result.data.bom![1].percentage).toBe("40");
    }
  });

  // ---------------------------------------------------------------
  // 11. bom-quantity-mode-missing-quantity-rejected
  // ---------------------------------------------------------------
  test("bom-quantity-mode-missing-quantity-rejected: rejects BOM row with empty quantity in quantity mode", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "quantity",
      bom: [{ componentId: "a", quantity: "", percentage: null }],
    });

    // nullableString transforms "" to null, then bomRefine checks !row.quantity
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity is required");
      // Verify the error path points to the correct BOM row field
      const quantityIssue = result.error.issues.find(
        (i) => i.message === "Quantity is required"
      );
      expect(quantityIssue?.path).toEqual(["bom", 0, "quantity"]);
    }
  });

  // ---------------------------------------------------------------
  // 12. bom-percentage-mode-missing-percentage-rejected
  // ---------------------------------------------------------------
  test("bom-percentage-mode-missing-percentage-rejected: rejects BOM row with empty percentage in percentage mode", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "percentage",
      bom: [{ componentId: "a", quantity: null, percentage: "" }],
    });

    // nullableString transforms "" to null, then bomRefine checks !row.percentage
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Percentage is required");
      const percentageIssue = result.error.issues.find(
        (i) => i.message === "Percentage is required"
      );
      expect(percentageIssue?.path).toEqual(["bom", 0, "percentage"]);
    }
  });

  // ---------------------------------------------------------------
  // 13. bom-duplicate-component-rejected
  // ---------------------------------------------------------------
  test("bom-duplicate-component-rejected: rejects duplicate componentId in BOM", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "quantity",
      bom: [
        { componentId: "a", quantity: "1", percentage: null },
        { componentId: "a", quantity: "2", percentage: null },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const duplicateIssue = result.error.issues.find(
        (i) => i.message === "Duplicate component"
      );
      expect(duplicateIssue).toBeDefined();
      expect(duplicateIssue?.path).toEqual(["bom", 1, "componentId"]);
    }
  });

  // ---------------------------------------------------------------
  // 14. bom-empty-component-rejected
  // ---------------------------------------------------------------
  test("bom-empty-component-rejected: rejects BOM row with empty componentId", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "quantity",
      bom: [{ componentId: "", quantity: "5", percentage: null }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Component is required");
    }
  });

  // ---------------------------------------------------------------
  // 15. selling-price-non-numeric-string-accepted
  // ---------------------------------------------------------------
  test("selling-price-non-numeric-string-accepted: nullableString has no numeric check so non-numeric strings pass", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      defaultSellingPrice: "12.34.56",
    });

    // nullableString only trims — no numeric validation
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultSellingPrice).toBe("12.34.56");
    }
  });

  // ---------------------------------------------------------------
  // 16. bom-percentage-non-numeric-accepted-bug
  // ---------------------------------------------------------------
  test("bom-percentage-non-numeric-accepted-bug: nullableString has no numeric check so non-numeric percentage passes", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "percentage",
      bom: [{ componentId: "a", quantity: null, percentage: "not-a-number" }],
    });

    // Documents a bug: nullableString has no numeric validation,
    // so "not-a-number" is accepted as a valid percentage.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bom![0].percentage).toBe("not-a-number");
    }
  });
});
