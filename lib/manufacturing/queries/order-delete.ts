import "server-only";

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { inventoryEvents, manufacturingOrderBatches, manufacturingOrderIngredients, manufacturingOrders } from "@/lib/db/schema";
import { trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { cancelReleasedManufacturingOrderInTx, getManufacturingIngredientDemandRowsInTx } from "@/lib/inventory/kernel";
import { getLockedBatchStateRowsInTx } from "./execution-state";
import { isOpenManufacturingOrder, rerankOpenManufacturingOrdersInTx } from "./shared";

async function getManufacturingIngredientDemandRowsForBatchesInTx(
  tx: Tx,
  manufacturingOrderId: string,
  batchIds: string[]
) {
  if (batchIds.length === 0) {
    return [];
  }

  return tx
    .select({
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      plannedQuantity: manufacturingOrderIngredients.plannedQuantity,
      pickedQuantity: manufacturingOrderIngredients.pickedQuantity,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId),
        inArray(manufacturingOrderIngredients.manufacturingOrderBatchId, batchIds)
      )
    );
}

export async function deleteManufacturingOrder(
  id: string
): Promise<{ deleted: boolean; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const deleted = await deleteManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      ids: [id],
    });

    return { deleted: deleted.deletedIds.length > 0, error: deleted.error };
  });
}

export async function deleteManufacturingOrders(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const deleted = await deleteManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      ids,
    });

    return { deletedCount: deleted.deletedIds.length, error: deleted.error };
  });
}

export async function deleteManufacturingOrdersInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    ids: string[];
  }
): Promise<{ deletedIds: string[]; error?: string }> {
  const uniqueIds = [...new Set(params.ids)];

  if (uniqueIds.length === 0) {
    return { deletedIds: [] };
  }

  const orders = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      productId: manufacturingOrders.productId,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
      completedAt: manufacturingOrders.completedAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.id, uniqueIds),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .for("update");

  if (orders.length === 0) {
    return { deletedIds: [] };
  }

  const orderIds = orders.map((order) => order.id);
  const finalizedOrder = orders.find(
    (order) =>
      order.status !== "open" ||
      order.completedAt != null ||
      (order.manufacturingMode !== "batch" && parseFloat(order.actualQuantity ?? "0") > 0)
  );

  if (finalizedOrder) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${finalizedOrder.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  const [completedDiscreteBatch] = await tx
    .select({
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(manufacturingOrderBatches)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderBatches.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        inArray(manufacturingOrderBatches.manufacturingOrderId, orderIds),
        ne(manufacturingOrders.manufacturingMode, "batch"),
        or(
          eq(manufacturingOrderBatches.status, "completed"),
          isNotNull(manufacturingOrderBatches.completedAt),
          isNotNull(manufacturingOrderBatches.lotId),
          sql`${manufacturingOrderBatches.actualQuantity} IS NOT NULL AND ${manufacturingOrderBatches.actualQuantity} > 0`
        )
      )
    )
    .limit(1);

  if (completedDiscreteBatch) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${completedDiscreteBatch.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  const [finalizedDiscreteEvent] = await tx
    .select({
      orderNumber: manufacturingOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      manufacturingOrders,
      or(
        and(
          eq(inventoryEvents.referenceType, "manufacturing_order"),
          eq(inventoryEvents.referenceId, manufacturingOrders.id)
        ),
        and(
          eq(inventoryEvents.referenceType, "manufacturing_batch"),
          inArray(
            inventoryEvents.referenceId,
            tx
              .select({ id: manufacturingOrderBatches.id })
              .from(manufacturingOrderBatches)
              .where(
                eq(manufacturingOrderBatches.manufacturingOrderId, manufacturingOrders.id)
              )
          )
        )
      )
    )
    .where(
      and(
        inArray(manufacturingOrders.id, orderIds),
        ne(manufacturingOrders.manufacturingMode, "batch"),
        eq(inventoryEvents.eventType, "manufacturing_output")
      )
    )
    .limit(1);

  if (finalizedDiscreteEvent) {
    return {
      deletedIds: [],
      error: `Cannot delete manufacturing order ${finalizedDiscreteEvent.orderNumber} because production output has already been recorded. Production history must be preserved.`,
    };
  }

  for (const order of orders) {
    if (!isOpenManufacturingOrder(order)) continue;

    let demandRows: Awaited<
      ReturnType<typeof getManufacturingIngredientDemandRowsInTx>
    > = [];

    if (order.manufacturingMode === "batch") {
      const batches = await getLockedBatchStateRowsInTx(tx, order.id);
      const deletableBatchIds = batches
        .filter((batch) => batch.status !== "completed")
        .map((batch) => batch.id);
      demandRows =
        deletableBatchIds.length > 0
          ? await getManufacturingIngredientDemandRowsForBatchesInTx(
              tx,
              order.id,
              deletableBatchIds
            )
          : [];
    } else {
      demandRows = await getManufacturingIngredientDemandRowsInTx(tx, order.id);
    }

    await cancelReleasedManufacturingOrderInTx(tx, {
      organizationId: params.organizationId,
      manufacturingOrderId: order.id,
      productId: order.productId,
      actorUserId: params.actorUserId,
      idempotencyKey: `delete-manufacturing-order:${order.id}`,
      ingredientRows: demandRows.map((row) => ({
        ingredientId: row.ingredientId,
        itemId: row.itemId,
        pickedQuantity: parseFloat(row.pickedQuantity),
      })),
    });
  }

  const deletedAt = new Date();
  const deleted = await tx
    .update(manufacturingOrders)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(inArray(manufacturingOrders.id, orderIds), isNull(manufacturingOrders.deletedAt))
    )
    .returning({ id: manufacturingOrders.id });

  if (orders.some(isOpenManufacturingOrder)) {
    await rerankOpenManufacturingOrdersInTx(tx, params.organizationId);
  }

  return { deletedIds: deleted.map((order) => order.id) };
}
