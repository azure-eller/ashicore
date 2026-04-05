import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import {
  items,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { lockItemsInTx } from "./stock";

export async function recomputeExpectedQty(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)].sort();

  if (uniqueItemIds.length === 0) {
    return;
  }

  await lockItemsInTx(tx, uniqueItemIds);

  const manufacturingTotals = await tx
    .select({
      itemId: manufacturingOrders.productId,
      total: sql<string>`COALESCE(SUM(${manufacturingOrders.plannedQuantity}), 0)`,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.productId, uniqueItemIds),
        isNull(manufacturingOrders.deletedAt),
        eq(manufacturingOrders.status, "released")
      )
    )
    .groupBy(manufacturingOrders.productId);

  const purchasingTotals = await tx
    .select({
      itemId: purchaseOrderLines.itemId,
      total: sql<string>`COALESCE(SUM(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}), 0)`,
    })
    .from(purchaseOrderLines)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id)
    )
    .where(
      and(
        inArray(purchaseOrderLines.itemId, uniqueItemIds),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["ordered", "partial"])
      )
    )
    .groupBy(purchaseOrderLines.itemId);

  const expectedByItem = new Map<string, number>();

  manufacturingTotals.forEach((row) => {
    expectedByItem.set(row.itemId, parseFloat(row.total));
  });

  purchasingTotals.forEach((row) => {
    expectedByItem.set(
      row.itemId,
      roundQuantity((expectedByItem.get(row.itemId) ?? 0) + parseFloat(row.total))
    );
  });

  for (const itemId of uniqueItemIds) {
    await tx
      .update(items)
      .set({
        expectedQty: normalizeNumeric(expectedByItem.get(itemId) ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }
}
