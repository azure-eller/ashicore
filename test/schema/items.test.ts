import {
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

vi.mock("@/lib/db/schema", () => {
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
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  });

  return { items };
});

import { insertItemSchema } from "@/lib/schemas/items";

const validProduct = {
  name: "Topsoil Mix",
  itemType: "product" as const,
  unitDefinitionId: "unit-1",
  stock: "0",
  safetyStock: "0",
  sku: null,
  category: null,
  description: null,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
};

describe("items schema", () => {
  test("accepts quantity-only BOM rows", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bom: [
        { componentId: "comp-a", quantity: "2.5" },
        { componentId: "comp-b", quantity: "1" },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bom).toEqual([
        { componentId: "comp-a", quantity: "2.5" },
        { componentId: "comp-b", quantity: "1" },
      ]);
    }
  });

  test("rejects BOM rows without a quantity", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bom: [{ componentId: "comp-a", quantity: "" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "Quantity is required",
            path: ["bom", 0, "quantity"],
          }),
        ])
      );
    }
  });

  test("strips stale bomMode input from old payloads", () => {
    const result = insertItemSchema.safeParse({
      ...validProduct,
      bomMode: "percentage",
      bom: [{ componentId: "comp-a", quantity: "4" }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("bomMode");
      expect(result.data.bom).toEqual([{ componentId: "comp-a", quantity: "4" }]);
    }
  });
});
