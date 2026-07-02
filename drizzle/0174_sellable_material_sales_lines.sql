UPDATE "inventory"."items" AS item
SET
  "sellable" = true,
  "updated_at" = now()
WHERE
  item."item_type" = 'material'
  AND item."sellable" IS NOT TRUE
  AND item."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "sales"."sales_order_lines" AS line
    JOIN "sales"."sales_orders" AS sales_order
      ON sales_order."id" = line."sales_order_id"
    WHERE
      line."item_id" = item."id"
      AND sales_order."deleted_at" IS NULL
  );
