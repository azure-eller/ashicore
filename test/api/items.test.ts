import {
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const mockCreateItemWithLot = vi.fn();
const mockGetItems = vi.fn();

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

vi.mock("@/app/(dashboard)/inventory/queries", () => ({
  createItemWithLot: (...args: unknown[]) => mockCreateItemWithLot(...args),
  getItems: (...args: unknown[]) => mockGetItems(...args),
}));

vi.mock("next/dist/client/components/redirect-error", () => ({
  isRedirectError: () => false,
}));

import { POST } from "@/app/api/items/route";

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/items", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("items API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("POST passes a quantity BOM through to createItemWithLot", async () => {
    mockCreateItemWithLot.mockResolvedValue({ id: "new-item-id" });

    const response = await POST(
      postReq({
        name: "Route Test Product",
        itemType: "product",
        unitDefinitionId: "unit-123",
        sku: null,
        category: null,
        description: null,
        defaultPurchasePrice: null,
        defaultSellingPrice: "14.50",
        stock: "0",
        safetyStock: "0",
        bomMode: "percentage",
        bom: [
          {
            componentId: "component-123",
            quantity: "2.5",
          },
        ],
      })
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({ id: "new-item-id" });
    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);

    const [data, stock, bom] = mockCreateItemWithLot.mock.calls[0] as [
      Record<string, unknown>,
      string,
      Array<{ componentId: string; quantity: string | null }>,
    ];

    expect(data).toMatchObject({
      name: "Route Test Product",
      itemType: "product",
      unitDefinitionId: "unit-123",
      defaultSellingPrice: "14.50",
    });
    expect(data).not.toHaveProperty("bomMode");
    expect(stock).toBe("0");
    expect(bom).toEqual([
      {
        componentId: "component-123",
        quantity: "2.5",
      },
    ]);
  });
});
