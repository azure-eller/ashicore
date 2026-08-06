import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { salesOrders } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { documentNumberSortSql } from "@/lib/document-numbers";
import type { ReorderSalesOrderPriorityRanks } from "@/lib/schemas/sales-orders";
import { SalesError } from "./errors";
import {
  OPEN_SALES_ORDER_STATUSES,
  isOpenSalesOrderStatus,
  withSalesTransactionRetry,
} from "./shared";

function assertSameStringSet(actual: string[], expected: string[], message: string) {
  if (actual.length !== expected.length) {
    throw new SalesError(message, 400);
  }

  const expectedSet = new Set(expected);
  if (actual.some((value) => !expectedSet.has(value))) {
    throw new SalesError(message, 400);
  }
}

function mergeSubmittedOrderIds(currentIds: string[], submittedIds: string[]) {
  const submittedIdSet = new Set(submittedIds);
  let submittedIndex = 0;

  const mergedIds = currentIds.map((id) => {
    if (!submittedIdSet.has(id)) {
      return id;
    }

    return submittedIds[submittedIndex++] ?? id;
  });

  if (submittedIndex !== submittedIds.length) {
    throw new SalesError("Sales order ranking does not match open orders.", 400);
  }

  return mergedIds;
}

export async function reorderSalesOrderPriorityRanks(
  payload: ReorderSalesOrderPriorityRanks
): Promise<{ updated: number }> {
  // Reordering locks the submitted orders by id and then the whole open queue by
  // rank, so it can deadlock against a concurrent sales-order write that takes the
  // same rows in the other order. Every other sales mutation already absorbs that
  // through this retry; this path was the one that surfaced it as a 500.
  return withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId) => {
    await lockSalesPriorityQueueInTx(tx, orgId);

    const orders = await tx
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.id, payload.orderIds),
          isNull(salesOrders.deletedAt)
        )
      )
      // Take these rows in id order, the same order rerankOpenSalesOrdersInTx uses.
      // An unordered FOR UPDATE lets Postgres pick the row order per plan, which is
      // how two transactions over the same orders end up holding each other's rows.
      .orderBy(asc(salesOrders.id))
      .for("update");

    const rankedOpenOrders = await tx
      .select({
        id: salesOrders.id,
        priorityRank: salesOrders.priorityRank,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
          isNull(salesOrders.deletedAt)
        )
      )
      .orderBy(
        asc(sql`COALESCE(${salesOrders.priorityRank}, 2147483647)`),
        asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
        asc(salesOrders.orderNumber)
      )
      .for("update");

    assertSameStringSet(
      orders.map((order) => order.id),
      payload.orderIds,
      "Sales order ranking does not match active orders."
    );

    const submittedOpenIds = payload.orderIds.filter((id) => {
      const order = orders.find((candidate) => candidate.id === id);
      return order ? isOpenSalesOrderStatus(order.status) : false;
    });

    const orderedIds = mergeSubmittedOrderIds(
      rankedOpenOrders.map((order) => order.id),
      submittedOpenIds
    );

    const now = new Date();
    await tx
      .update(salesOrders)
      .set({
        priorityRank: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
          isNull(salesOrders.deletedAt)
        )
      );

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(salesOrders)
        .set({
          priorityRank: index + 1,
          updatedAt: now,
        })
        .where(eq(salesOrders.id, id));
    }

    return { updated: orderedIds.length };
  }));
}
