// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that depend on them
// ---------------------------------------------------------------------------

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

// Mock DAL functions
const mockCreateItemWithLot = vi.fn();
const mockUpdateItem = vi.fn();
const mockDeleteItem = vi.fn();
const mockGetItems = vi.fn();

vi.mock("@/app/(dashboard)/inventory/queries", () => ({
  getItems: (...args: unknown[]) => mockGetItems(...args),
  createItemWithLot: (...args: unknown[]) => mockCreateItemWithLot(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
}));

// Mock next/navigation redirect error check
vi.mock("next/dist/client/components/redirect-error", () => ({
  isRedirectError: () => false,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { POST, GET } from "@/app/api/items/route";
import { PUT, DELETE } from "@/app/api/items/[id]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// All nullable string fields must be explicitly provided (nullableString accepts
// string | null but NOT undefined). POST requires itemType + unitDefinitionId;
// the updateItemSchema strips them silently via Zod's default behavior.
const validPostBody = {
  name: "Test Product",
  itemType: "product",
  unitDefinitionId: "unit-uuid",
  stock: "0",
  safetyStock: "0",
  sku: null,
  category: null,
  description: null,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
};

// updateItemSchema omits itemType, unitDefinitionId, and stock is optional.
const validPutBody = {
  name: "Test Product",
  stock: "0",
  safetyStock: "0",
  sku: null,
  category: null,
  description: null,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
};

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/items", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function putReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/items/item-123", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function deleteReq() {
  return new Request("http://localhost/api/items/item-123", {
    method: "DELETE",
  });
}

function putCtx(id = "item-123") {
  return { params: Promise.resolve({ id }) };
}

function deleteCtx(id = "item-123") {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("product-bom API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // 1. sku-duplicate-same-org
  // ---------------------------------------------------------------
  test("sku-duplicate-same-org: DB unique constraint error returns 500", async () => {
    mockCreateItemWithLot.mockRejectedValue(
      new Error("duplicate key value violates unique constraint")
    );

    const res = await POST(postReq({ ...validPostBody, sku: "SKU-001" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Internal server error" });
  });

  // ---------------------------------------------------------------
  // 2. purchase-price-non-numeric-passes-zod
  // ---------------------------------------------------------------
  test("purchase-price-non-numeric-passes-zod: non-numeric price passes Zod, rejected by DB", async () => {
    mockCreateItemWithLot.mockRejectedValue(
      new Error("invalid input syntax for type numeric")
    );

    const res = await POST(
      postReq({ ...validPostBody, defaultPurchasePrice: "abc" })
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Internal server error" });

    // Verify the DAL was called with the non-numeric price (Zod did not reject it)
    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [data] = mockCreateItemWithLot.mock.calls[0];
    expect(data.defaultPurchasePrice).toBe("abc");
  });

  // ---------------------------------------------------------------
  // 3. stock-zero-no-lot-created
  // ---------------------------------------------------------------
  test("stock-zero-no-lot-created: POST with stock=0 returns 201", async () => {
    mockCreateItemWithLot.mockResolvedValue({ id: "new-id" });

    const res = await POST(postReq({ ...validPostBody, stock: "0" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ id: "new-id" });

    // Verify createItemWithLot received stock="0" — the DAL decides lot creation
    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [, stock] = mockCreateItemWithLot.mock.calls[0];
    expect(stock).toBe("0");
  });

  // ---------------------------------------------------------------
  // 4. stock-positive-creates-lot
  // ---------------------------------------------------------------
  test("stock-positive-creates-lot: POST with positive stock returns 201", async () => {
    mockCreateItemWithLot.mockResolvedValue({ id: "new-id" });

    const res = await POST(
      postReq({ ...validPostBody, stock: "50", defaultPurchasePrice: "10.00" })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ id: "new-id" });

    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [, stock] = mockCreateItemWithLot.mock.calls[0];
    expect(stock).toBe("50");
  });

  // ---------------------------------------------------------------
  // 5. stock-edit-increase-creates-new-lot
  // ---------------------------------------------------------------
  test("stock-edit-increase-creates-new-lot: PUT with stock=80 passes parsed float to updateItem", async () => {
    mockUpdateItem.mockResolvedValue({ id: "item-123" });

    const res = await PUT(
      putReq({ ...validPutBody, stock: "80" }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "item-123" });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [id, , stock, bom] = mockUpdateItem.mock.calls[0];
    expect(id).toBe("item-123");
    expect(stock).toBe(80);
  });

  // ---------------------------------------------------------------
  // 6. stock-edit-decrease-fifo-deduction
  // ---------------------------------------------------------------
  test("stock-edit-decrease-fifo-deduction: PUT with stock=10 returns 200", async () => {
    mockUpdateItem.mockResolvedValue({ id: "item-123" });

    const res = await PUT(
      putReq({ ...validPutBody, stock: "10" }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "item-123" });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [, , stock] = mockUpdateItem.mock.calls[0];
    expect(stock).toBe(10);
  });

  // ---------------------------------------------------------------
  // 7. stock-edit-decrease-insufficient
  // ---------------------------------------------------------------
  test("stock-edit-decrease-insufficient: returns 400 with stock field error", async () => {
    mockUpdateItem.mockRejectedValue(
      new Error("Insufficient stock. Available: 5, requested: 10")
    );

    const res = await PUT(
      putReq({ ...validPutBody, stock: "0" }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      errors: {
        stock: ["Insufficient stock. Available: 5, requested: 10"],
      },
    });
  });

  // ---------------------------------------------------------------
  // 8. safety-stock-non-numeric-passes-zod
  // ---------------------------------------------------------------
  test("safety-stock-non-numeric-passes-zod: Zod transform passes non-numeric safetyStock through", async () => {
    mockCreateItemWithLot.mockRejectedValue(
      new Error("invalid input syntax for type numeric")
    );

    const res = await POST(
      postReq({ ...validPostBody, safetyStock: "abc" })
    );

    // The DAL was called — Zod did not reject the non-numeric value
    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [data] = mockCreateItemWithLot.mock.calls[0];
    expect(data.safetyStock).toBe("abc");
  });

  // ---------------------------------------------------------------
  // 9. bom-self-reference-rejected-by-api
  // ---------------------------------------------------------------
  test("bom-self-reference-rejected-by-api: PUT with self-referencing BOM returns 400", async () => {
    const res = await PUT(
      putReq({
        ...validPutBody,
        bomMode: "quantity",
        bom: [
          { componentId: "item-123", quantity: "5", percentage: null },
        ],
      }),
      putCtx("item-123")
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      errors: {
        bom: ["An item cannot reference itself as a component"],
      },
    });
    // updateItem should NOT have been called
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // 10. bom-update-deletes-and-reinserts
  // ---------------------------------------------------------------
  test("bom-update-deletes-and-reinserts: PUT with BOM array passes it to updateItem", async () => {
    mockUpdateItem.mockResolvedValue({ id: "item-123" });

    const bom = [
      { componentId: "a", quantity: "3", percentage: null },
      { componentId: "c", quantity: "7", percentage: null },
    ];

    const res = await PUT(
      putReq({ ...validPutBody, bomMode: "quantity", bom }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "item-123" });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [, , , receivedBom] = mockUpdateItem.mock.calls[0];
    expect(receivedBom).toEqual(bom);
  });

  // ---------------------------------------------------------------
  // 11. concurrent-edit-stale-stock
  // ---------------------------------------------------------------
  test("concurrent-edit-stale-stock: API always passes absolute stock value; delta computed server-side", async () => {
    mockUpdateItem.mockResolvedValue({ id: "item-123" });

    const res = await PUT(
      putReq({ ...validPutBody, stock: "80" }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "item-123" });

    // The route passes parseFloat("80") = 80 to updateItem
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [, , stock] = mockUpdateItem.mock.calls[0];
    expect(stock).toBe(80);
  });

  // ---------------------------------------------------------------
  // 12. bom-quantity-non-numeric-passes-zod
  // ---------------------------------------------------------------
  test("bom-quantity-non-numeric-passes-zod: non-numeric quantity passes Zod, rejected by DB", async () => {
    mockCreateItemWithLot.mockRejectedValue(
      new Error("invalid input syntax for type numeric")
    );

    const bom = [
      { componentId: "a", quantity: "two", percentage: null },
    ];

    const res = await POST(
      postReq({ ...validPostBody, bomMode: "quantity", bom })
    );

    // Zod passed it through — DAL was called
    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [, , receivedBom] = mockCreateItemWithLot.mock.calls[0];
    expect(receivedBom).toEqual(bom);
  });

  // ---------------------------------------------------------------
  // 13. item-type-enum-injection-blocked
  // ---------------------------------------------------------------
  test("item-type-enum-injection-blocked: invalid itemType rejected by Zod", async () => {
    const res = await POST(
      postReq({ ...validPostBody, itemType: "semi-finished" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.errors).toBeDefined();
    expect(json.errors.itemType).toBeDefined();
    expect(json.errors.itemType.length).toBeGreaterThan(0);

    // DAL should never have been called
    expect(mockCreateItemWithLot).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // 14. create-product-with-bom-shows-in-detail-page
  // ---------------------------------------------------------------
  test("create-product-with-bom-shows-in-detail-page: POST with BOM rows returns 201 and passes bom to DAL", async () => {
    mockCreateItemWithLot.mockResolvedValue({ id: "new-id" });

    const bom = [
      { componentId: "comp-a", quantity: "10", percentage: null },
      { componentId: "comp-b", quantity: "5", percentage: null },
    ];

    const res = await POST(
      postReq({ ...validPostBody, bomMode: "quantity", bom })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ id: "new-id" });

    expect(mockCreateItemWithLot).toHaveBeenCalledTimes(1);
    const [, , receivedBom] = mockCreateItemWithLot.mock.calls[0];
    expect(receivedBom).toEqual(bom);
    expect(receivedBom).toHaveLength(2);
  });

  // ---------------------------------------------------------------
  // 15. delete-component-used-in-bom-blocked
  // ---------------------------------------------------------------
  test("delete-component-used-in-bom-blocked: returns 400 when item is used in BOM", async () => {
    mockDeleteItem.mockResolvedValue({ deleted: false, usedInBom: true });

    const res = await DELETE(deleteReq(), deleteCtx());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error:
        "Cannot delete: this item is used as a component in other products.",
    });
  });

  // ---------------------------------------------------------------
  // 16. delete-product-cascades-bom-rows
  // ---------------------------------------------------------------
  test("delete-product-cascades-bom-rows: successful delete returns 200 with success:true", async () => {
    mockDeleteItem.mockResolvedValue({ deleted: true });

    const res = await DELETE(deleteReq(), deleteCtx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
  });

  // ---------------------------------------------------------------
  // 17. bom-component-soft-deleted-hidden-from-detail
  // ---------------------------------------------------------------
  test("bom-component-soft-deleted-hidden-from-detail: GET returns filtered items from getItems", async () => {
    const filteredItems = [
      { id: "item-1", name: "Active Product", deletedAt: null },
      { id: "item-2", name: "Another Product", deletedAt: null },
    ];
    mockGetItems.mockResolvedValue(filteredItems);

    const req = new Request("http://localhost/api/items?itemType=product");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(filteredItems);
    expect(json).toHaveLength(2);
  });

  // ---------------------------------------------------------------
  // 18. concurrent-stock-decrease-insufficient-stock
  // ---------------------------------------------------------------
  test("concurrent-stock-decrease-insufficient-stock: returns 400 with stock field error", async () => {
    mockUpdateItem.mockRejectedValue(
      new Error("Insufficient stock. Available: 3, requested: 8")
    );

    const res = await PUT(
      putReq({ ...validPutBody, stock: "2" }),
      putCtx()
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      errors: {
        stock: ["Insufficient stock. Available: 3, requested: 8"],
      },
    });
  });

  // ---------------------------------------------------------------
  // 19. duplicate-sku-across-items-server-error
  // ---------------------------------------------------------------
  test("duplicate-sku-across-items-server-error: generic DAL error returns 500", async () => {
    mockCreateItemWithLot.mockRejectedValue(
      new Error("unique constraint violation")
    );

    const res = await POST(postReq({ ...validPostBody }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "Internal server error" });
  });

  // ---------------------------------------------------------------
  // 20. bulk-delete-with-bom-protected-items
  // ---------------------------------------------------------------
  test("bulk-delete-with-bom-protected-items: first item blocked by BOM, second item deleted", async () => {
    // First call: item is used in a BOM
    mockDeleteItem.mockResolvedValueOnce({ deleted: false, usedInBom: true });
    // Second call: item deletes successfully
    mockDeleteItem.mockResolvedValueOnce({ deleted: true });

    // First DELETE — blocked
    const res1 = await DELETE(deleteReq(), deleteCtx("bom-protected-item"));
    const json1 = await res1.json();

    expect(res1.status).toBe(400);
    expect(json1).toEqual({
      error:
        "Cannot delete: this item is used as a component in other products.",
    });

    // Second DELETE — succeeds
    const res2 = await DELETE(deleteReq(), deleteCtx("deletable-item"));
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2).toEqual({ success: true });
  });

  // ---------------------------------------------------------------
  // 21. insufficient-stock-decrease-rolls-back-metadata
  // ---------------------------------------------------------------
  test("insufficient-stock-decrease-rolls-back-metadata: name change + stock decrease returns 400 field error, not 500", async () => {
    mockUpdateItem.mockRejectedValue(
      new Error("Insufficient stock. Available: 5, requested: 15")
    );

    const res = await PUT(
      putReq({
        ...validPutBody,
        name: "Renamed Product",
        stock: "0",
      }),
      putCtx()
    );
    const json = await res.json();

    // The error is caught and returned as a field-level error, not a 500
    expect(res.status).toBe(400);
    expect(json).toEqual({
      errors: {
        stock: ["Insufficient stock. Available: 5, requested: 15"],
      },
    });
    // The 500 handler was NOT hit
    expect(json.error).toBeUndefined();
  });
});
