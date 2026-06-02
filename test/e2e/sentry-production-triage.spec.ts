import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";

test("supports legacy same-unit package conversions without throwing", () => {
  expect(
    derivePurchaseToStockFactor(
      { size: "1", uom: "pallet" },
      { size: "1", uom: "pallet" }
    )
  ).toBe(1);

  expect(
    derivePurchaseToStockFactor(
      { size: "2", uom: "pallet" },
      { size: "1", uom: "pallet" }
    )
  ).toBe(2);
});

test("sales allocation remaining demand SQL reads shipped line quantity", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl).toBeTruthy();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await expect(
      client.query(`
        SELECT GREATEST(
          "sales"."sales_order_lines"."quantity"
          - "sales"."sales_order_lines"."cancelled_quantity"
          - "sales"."sales_order_lines"."shipped_quantity",
          0
        )
        FROM "sales"."sales_order_lines"
        LIMIT 1
      `)
    ).resolves.toBeDefined();
  } finally {
    await client.end();
  }
});
