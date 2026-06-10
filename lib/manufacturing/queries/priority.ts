import "server-only";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { manufacturingOrderIngredients, manufacturingOrders } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { documentNumberSortSql } from "@/lib/document-numbers";
import type { ReorderManufacturingOrderPriorityRanks, ReorderManufacturingIngredients, UpdateManufacturingOrderPriority } from "@/lib/schemas/manufacturing-orders";
import { ManufacturingError } from "./errors";
import { assertSameStringSet, effectiveManufacturingPriorityRankSql, getLockedManufacturingOrderInTx, isOpenManufacturingOrder } from "./shared";

function mergeSubmittedOrderIds(
  currentIds: string[],
  submittedIds: string[]
) {
  const submittedIdSet = new Set(submittedIds);
  let submittedIndex = 0;

  const mergedIds = currentIds.map((id) => {
    if (!submittedIdSet.has(id)) {
      return id;
    }

    return submittedIds[submittedIndex++] ?? id;
  });

  if (submittedIndex !== submittedIds.length) {
    throw new ManufacturingError(
      "Manufacturing order ranking does not match active orders.",
      400
    );
  }

  return mergedIds;
}

async function assertPriorityRankAvailableInTx(
  tx: Tx,
  orgId: string,
  priorityRank: number | null,
  excludeId?: string
) {
  if (priorityRank == null) {
    return;
  }

  const filters = [
    eq(manufacturingOrders.organizationId, orgId),
    eq(manufacturingOrders.priorityRank, priorityRank),
    eq(manufacturingOrders.status, "open"),
    isNull(manufacturingOrders.deletedAt),
  ];

  if (excludeId) {
    filters.push(ne(manufacturingOrders.id, excludeId));
  }

  const [conflict] = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .where(and(...filters))
    .for("update");

  if (conflict) {
    throw new ManufacturingError(
      `Priority rank ${priorityRank} is already assigned to another active order.`,
      409
    );
  }
}

export async function updateManufacturingOrderPriority(
  id: string,
  payload: UpdateManufacturingOrderPriority
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status !== "open") {
      return { id: order.id };
    }

    await assertPriorityRankAvailableInTx(tx, orgId, payload.priorityRank, id);

    const [updated] = await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: payload.priorityRank,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id))
      .returning({ id: manufacturingOrders.id });

    return updated;
  });
}

export async function reorderManufacturingOrderPriorityRanks(
  payload: ReorderManufacturingOrderPriorityRanks
): Promise<{ updated: number }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const orders = await tx
      .select({
        id: manufacturingOrders.id,
        status: manufacturingOrders.status,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          inArray(manufacturingOrders.id, payload.orderIds),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .for("update");

    const rankedOpenOrders = await tx
      .select({
        id: manufacturingOrders.id,
        priorityRank: effectiveManufacturingPriorityRankSql().as("priorityRank"),
        orderNumber: manufacturingOrders.orderNumber,
      })
      .from(manufacturingOrders)
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .orderBy(
        asc(sql`COALESCE(${manufacturingOrders.priorityRank}, 2147483647)`),
        asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
        asc(manufacturingOrders.orderNumber)
      )
      .for("update");

    assertSameStringSet(
      orders.map((order) => order.id),
      payload.orderIds,
      "Manufacturing order ranking does not match active orders."
    );

    const submittedOpenIds = payload.orderIds.flatMap((id) => {
      const order = orders.find((candidate) => candidate.id === id);
      return order?.status === "open" ? [order.id] : [];
    });

    const orderedIds = mergeSubmittedOrderIds(
      rankedOpenOrders.map((order) => order.id),
      submittedOpenIds
    );

    const now = new Date();
    await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      );

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(manufacturingOrders)
        .set({
          priorityRank: index + 1,
          updatedAt: now,
        })
        .where(eq(manufacturingOrders.id, id));
    }

    return { updated: orderedIds.length };
  });
}

export async function reorderManufacturingOrderIngredients(
  id: string,
  payload: ReorderManufacturingIngredients
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedManufacturingOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status !== "open") {
      throw new ManufacturingError(
        "Only open manufacturing orders can be reordered.",
        400
      );
    }

    const submittedRows = await tx
      .select({
        id: manufacturingOrderIngredients.id,
        itemId: manufacturingOrderIngredients.itemId,
        manufacturingOrderBatchId:
          manufacturingOrderIngredients.manufacturingOrderBatchId,
      })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, id),
          inArray(manufacturingOrderIngredients.id, payload.ingredientIds)
        )
      )
      .for("update");

    assertSameStringSet(
      submittedRows.map((row) => row.id),
      payload.ingredientIds,
      "Ingredient order does not match this manufacturing order."
    );

    const now = new Date();

    if (order.manufacturingMode === "batch" && isOpenManufacturingOrder(order)) {
      if (submittedRows.some((row) => row.manufacturingOrderBatchId == null)) {
        throw new ManufacturingError(
          "Batch execution order must use batch ingredient rows.",
          400
        );
      }

      const itemIdByIngredientId = new Map(
        submittedRows.map((row) => [row.id, row.itemId])
      );
      const orderedItemIds = payload.ingredientIds.map(
        (ingredientId) => itemIdByIngredientId.get(ingredientId)!
      );
      const allBatchRows = await tx
        .select({
          id: manufacturingOrderIngredients.id,
          itemId: manufacturingOrderIngredients.itemId,
        })
        .from(manufacturingOrderIngredients)
        .where(eq(manufacturingOrderIngredients.manufacturingOrderId, id))
        .for("update");
      const allItemIds = [...new Set(allBatchRows.map((row) => row.itemId))];

      assertSameStringSet(
        orderedItemIds,
        allItemIds,
        "Ingredient order must include every batch ingredient."
      );

      for (const [sortOrder, itemId] of orderedItemIds.entries()) {
        await tx
          .update(manufacturingOrderIngredients)
          .set({ sortOrder, updatedAt: now })
          .where(
            and(
              eq(manufacturingOrderIngredients.manufacturingOrderId, id),
              eq(manufacturingOrderIngredients.itemId, itemId)
            )
          );
      }

      return { id };
    }

    const templateRows = await tx
      .select({ id: manufacturingOrderIngredients.id })
      .from(manufacturingOrderIngredients)
      .where(
        and(
          eq(manufacturingOrderIngredients.manufacturingOrderId, id),
          sql`${manufacturingOrderIngredients.manufacturingOrderBatchId} IS NULL`
        )
      )
      .for("update");

    assertSameStringSet(
      payload.ingredientIds,
      templateRows.map((row) => row.id),
      "Ingredient order must include every ingredient."
    );

    for (const [sortOrder, ingredientId] of payload.ingredientIds.entries()) {
      await tx
        .update(manufacturingOrderIngredients)
        .set({ sortOrder, updatedAt: now })
        .where(eq(manufacturingOrderIngredients.id, ingredientId));
    }

    return { id };
  });
}
