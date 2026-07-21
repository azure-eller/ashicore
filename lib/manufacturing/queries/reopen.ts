import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { manufacturingOrderBatches, manufacturingOrderOutputs, manufacturingOrders } from "@/lib/db/schema";
import { normalizeQuantityNumber } from "@/lib/format";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { addIngredientDemandForManufacturingInTx, beginInventoryOperationInTx, editExpectedFromManufacturingInTx, finishInventoryOperationInTx, getManufacturingIngredientDemandRowsInTx, releaseIngredientDemandForManufacturingInTx } from "@/lib/inventory/kernel";
import { ManufacturingError } from "./errors";
import { getOutputQuantityInTx } from "./execution-state";
import { recomputeManufacturingActualRollupsInTx, reverseManufacturingOutputInTx } from "./output";
import { getLockedManufacturingOrderInTx, rerankOpenManufacturingOrdersInTx } from "./shared";

/**
 * Done → work in progress. Reverses the completion's inventory effects with
 * the same compensating reversal open orders use, restores planning to the
 * full plan targets, and reopens the order at the end of the priority queue.
 * Eligibility is the kernel's no-negative-stock guard: if produced stock has
 * since shipped or been consumed, the reversal throws and everything rolls
 * back with the order still done.
 */
export async function reopenManufacturingOrder(
  id: string,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);

    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "reopenManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });
    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedManufacturingOrderInTx(tx, id);
    if (!order) {
      throw new ManufacturingError("Order not found", 404);
    }
    if (order.status !== "done") {
      throw new ManufacturingError(
        "Only completed orders can return to work in progress.",
        400
      );
    }

    const outputBuckets: Array<string | null> = [null];
    if (order.manufacturingMode === "batch") {
      const batchRows = await tx
        .select({ batchId: manufacturingOrderOutputs.manufacturingOrderBatchId })
        .from(manufacturingOrderOutputs)
        .where(
          and(
            eq(manufacturingOrderOutputs.manufacturingOrderId, id),
            isNotNull(manufacturingOrderOutputs.manufacturingOrderBatchId)
          )
        )
        .groupBy(manufacturingOrderOutputs.manufacturingOrderBatchId);
      outputBuckets.push(...batchRows.map((row) => row.batchId));
    }

    for (const batchId of outputBuckets) {
      const netQuantity = normalizeQuantityNumber(
        await getOutputQuantityInTx(tx, {
          manufacturingOrderId: id,
          manufacturingOrderBatchId: batchId,
        })
      );
      if (netQuantity <= 0) continue;
      await reverseManufacturingOutputInTx(tx, {
        organizationId: orgId,
        manufacturingOrderId: id,
        manufacturingOrderBatchId: batchId,
        productId: order.productId,
        quantity: netQuantity,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey,
      });
    }
    await recomputeManufacturingActualRollupsInTx(tx, id);

    if (order.manufacturingMode === "batch") {
      await tx
        .update(manufacturingOrderBatches)
        .set({
          status: "pending",
          completedAt: null,
          actualQuantity: "0",
          updatedAt: new Date(),
        })
        .where(eq(manufacturingOrderBatches.manufacturingOrderId, id));
    }

    // Planning back to the full plan targets, exactly inverting the
    // completion close-out plus the consumed portions.
    const demandRows = await getManufacturingIngredientDemandRowsInTx(tx, id);
    await releaseIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      actorUserId: userId,
      reason: "edited",
      ingredientIds: demandRows.map((row) => row.ingredientId),
    });
    await addIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      actorUserId: userId,
      ingredients: demandRows.map((row) => ({
        ingredientId: row.ingredientId,
        itemId: row.itemId,
        quantity: parseFloat(row.plannedQuantity),
      })),
    });
    await editExpectedFromManufacturingInTx(tx, {
      organizationId: orgId,
      manufacturingOrderId: id,
      productId: order.productId,
      actorUserId: userId,
      nextQuantity: parseFloat(order.plannedQuantity),
    });

    await tx
      .update(manufacturingOrders)
      .set({
        status: "open",
        completedAt: null,
        startedAt: order.startedAt ?? new Date(),
        priorityRank: null,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, id));
    await rerankOpenManufacturingOrdersInTx(tx, orgId);

    const result = { id };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });
    return result;
  });
}
