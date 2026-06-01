import "server-only";

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { toRows } from "@/lib/db/query-result";
import type { Tx } from "@/lib/db/with-org-context";
import {
  items,
  manufacturingOrderOperationCosts,
  manufacturingOrderOutputs,
  manufacturingOrders,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";

export type ProducedTodayOperationResource = {
  id: string | null;
  name: string;
  type: string;
};

/**
 * One manufacturing order's total output recorded during the org's *current
 * calendar day*. The Android "Done today" hero aggregates these by product and
 * filters by crew (via the same operationResources/category derivation the order
 * list uses), so quantities reflect production events — not whether the MO has
 * reached `done`. Mirrors the daily-manufacturing report's window + output sum.
 */
export type ProducedTodayOrder = {
  manufacturingOrderId: string;
  productName: string | null;
  productSku: string | null;
  productCategory: string | null;
  unitName: string | null;
  quantity: string;
  operationResources: ProducedTodayOperationResource[];
};

/**
 * Today's [start, end) instants for `timeZone`, computed the same way the daily
 * manufacturing report builds its window (`AT TIME ZONE`), so produced-today and
 * the report agree on the day boundary regardless of server/UTC offset.
 */
async function resolveTodayWindow(
  tx: Tx,
  timeZone: string
): Promise<{ startAt: Date; endAt: Date }> {
  const result = await tx.execute(sql`
    SELECT
      (date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}) AS "startAt",
      ((date_trunc('day', now() AT TIME ZONE ${timeZone}) + interval '1 day') AT TIME ZONE ${timeZone}) AS "endAt"
  `);
  const [row] = toRows<{ startAt: Date; endAt: Date }>(result);
  if (!row) {
    throw new Error("Unable to resolve produced-today window.");
  }
  return { startAt: new Date(row.startAt), endAt: new Date(row.endAt) };
}

/** Per-order output produced during the org's current day, with crew context. */
export async function getProducedTodayOrders(
  timeZone: string
): Promise<ProducedTodayOrder[]> {
  return withAuthedOrgContext(async (tx) => {
    const window = await resolveTodayWindow(tx, timeZone);

    const rows = await tx
      .select({
        manufacturingOrderId: manufacturingOrders.id,
        productId: manufacturingOrders.productId,
        productName: manufacturingOrders.productName,
        productSku: manufacturingOrders.productSku,
        productCategory: items.category,
        unitName: manufacturingOrders.unitName,
        quantity: trimScale(
          sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
        ).as("quantity"),
      })
      .from(manufacturingOrderOutputs)
      .innerJoin(
        manufacturingOrders,
        eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
      )
      // LEFT join + no sellable filter: "produced today" counts EVERY completed
      // production — non-sellable intermediates (media prep, totes) included, and
      // a missing product row never drops the output. Mirrors the report below.
      .leftJoin(items, eq(manufacturingOrders.productId, items.id))
      .where(
        and(
          sql`${manufacturingOrderOutputs.createdAt} >= ${window.startAt}`,
          sql`${manufacturingOrderOutputs.createdAt} < ${window.endAt}`,
          gt(manufacturingOrderOutputs.quantity, "0"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .groupBy(
        manufacturingOrders.id,
        manufacturingOrders.productId,
        manufacturingOrders.productName,
        manufacturingOrders.productSku,
        items.category,
        manufacturingOrders.unitName
      )
      .orderBy(asc(manufacturingOrders.productName));

    if (rows.length === 0) {
      return [];
    }

    const displayNamesByItemId = await getItemDisplayNamesByIdInTx(
      tx,
      rows.map((row) => row.productId)
    );
    const orderIds = rows.map((row) => row.manufacturingOrderId);
    const resourceRows = await tx
      .select({
        manufacturingOrderId: manufacturingOrderOperationCosts.manufacturingOrderId,
        resourceId: manufacturingOrderOperationCosts.resourceId,
        resourceName: manufacturingOrderOperationCosts.resourceName,
        resourceType: manufacturingOrderOperationCosts.resourceType,
        sortOrder: manufacturingOrderOperationCosts.sortOrder,
      })
      .from(manufacturingOrderOperationCosts)
      .where(
        inArray(manufacturingOrderOperationCosts.manufacturingOrderId, orderIds)
      )
      .orderBy(
        asc(manufacturingOrderOperationCosts.manufacturingOrderId),
        asc(manufacturingOrderOperationCosts.sortOrder)
      );

    const resourcesByOrder = new Map<string, ProducedTodayOperationResource[]>();
    for (const row of resourceRows) {
      const existing = resourcesByOrder.get(row.manufacturingOrderId) ?? [];
      const key = row.resourceId ?? `${row.resourceType}:${row.resourceName}`;
      if (
        existing.some(
          (resource) => (resource.id ?? `${resource.type}:${resource.name}`) === key
        )
      ) {
        continue;
      }
      existing.push({
        id: row.resourceId,
        name: row.resourceName,
        type: row.resourceType,
      });
      resourcesByOrder.set(row.manufacturingOrderId, existing);
    }

    return rows.map((row) => ({
      manufacturingOrderId: row.manufacturingOrderId,
      productName: displayNamesByItemId.get(row.productId) ?? row.productName,
      productSku: row.productSku,
      productCategory: row.productCategory,
      unitName: row.unitName,
      quantity: row.quantity as string,
      operationResources: resourcesByOrder.get(row.manufacturingOrderId) ?? [],
    }));
  });
}
