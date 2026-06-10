import "server-only";

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { accountingDocumentSyncs, inventoryEvents, manufacturingOrderBatches, manufacturingOrderOutputs, manufacturingOrderIngredients, manufacturingOrders, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { beginInventoryOperationInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, releaseSalesDemandForSalesLineInTx } from "@/lib/inventory/kernel";
import { deleteManufacturingOrdersInTx } from "@/lib/manufacturing/queries/order-delete";
import { SalesError } from "./errors";
import { isOpenSalesOrderStatus, rerankOpenSalesOrdersInTx, getOrderLinesInTx, getLockedSalesOrderInTx } from "./shared";

async function getSalesOrderDeleteBlockerInTx(tx: Tx, orderIds: string[]) {
  const [shippedOrder] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(salesOrders)
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        or(eq(salesOrders.status, "done"), sql`${salesOrders.shippedAt} IS NOT NULL`)
      )
    )
    .limit(1);

  if (shippedOrder) {
    return `Cannot delete sales order ${shippedOrder.orderNumber} because it has already shipped. Shipped fulfillment history must be preserved.`;
  }
  const [directOrderConsumption] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      salesOrders,
      and(
        eq(inventoryEvents.referenceType, "sales_order"),
        eq(inventoryEvents.referenceId, salesOrders.id)
      )
    )
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        eq(inventoryEvents.eventType, "sales_consumption")
      )
    )
    .limit(1);

  if (directOrderConsumption) {
    return `Cannot delete sales order ${directOrderConsumption.orderNumber} because inventory has already been consumed for fulfillment. Inventory history must be preserved.`;
  }

  const [salesLineConsumption] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      salesOrderLines,
      and(
        eq(inventoryEvents.referenceType, "sales_order_line"),
        eq(inventoryEvents.referenceId, salesOrderLines.id)
      )
    )
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        eq(inventoryEvents.eventType, "sales_consumption")
      )
    )
    .limit(1);

  if (salesLineConsumption) {
    return `Cannot delete sales order ${salesLineConsumption.orderNumber} because inventory has already been consumed for fulfillment. Inventory history must be preserved.`;
  }
  const [pushedOrderInvoice] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(accountingDocumentSyncs)
    .innerJoin(salesOrders, eq(accountingDocumentSyncs.documentId, salesOrders.id))
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
        eq(accountingDocumentSyncs.documentType, "sales_order"),
        inArray(accountingDocumentSyncs.documentId, orderIds),
        or(
          eq(accountingDocumentSyncs.pushStatus, "pushed"),
          sql`${accountingDocumentSyncs.externalDocumentId} IS NOT NULL`
        )
      )
    )
    .limit(1);

  if (pushedOrderInvoice) {
    return `Cannot delete sales order ${pushedOrderInvoice.orderNumber} because its invoice has already been pushed to accounting. Accounting history must be preserved.`;
  }
  return null;
}

async function deleteSalesLinkedManufacturingOrdersInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    salesOrderIds: string[];
    salesOrderLineIds: string[];
  }
) {
  const linkedOrders = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      status: manufacturingOrders.status,
      completedAt: manufacturingOrders.completedAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.salesOrderId, params.salesOrderIds),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .for("update");

  if (linkedOrders.length === 0) {
    return null;
  }

  const salesOrderLineIdSet = new Set(params.salesOrderLineIds);
  const linkedToMissingLine = linkedOrders.find(
    (order) =>
      !order.salesOrderLineId || !salesOrderLineIdSet.has(order.salesOrderLineId)
  );

  if (linkedToMissingLine) {
    return `Cannot delete this sales order because manufacturing order ${linkedToMissingLine.orderNumber} is linked to the order but not to a matching active sales line. Remove or repair the manufacturing link first.`;
  }

  const linkedOrderIds = linkedOrders.map((order) => order.id);
  const outputRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
      outputQuantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
      ).as("outputQuantity"),
    })
    .from(manufacturingOrderOutputs)
    .where(inArray(manufacturingOrderOutputs.manufacturingOrderId, linkedOrderIds))
    .groupBy(manufacturingOrderOutputs.manufacturingOrderId);
  const ingredientStartRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        inArray(manufacturingOrderIngredients.manufacturingOrderId, linkedOrderIds),
        or(
          sql`${manufacturingOrderIngredients.pickedQuantity} > 0`,
          sql`${manufacturingOrderIngredients.actualQuantity} IS NOT NULL AND ${manufacturingOrderIngredients.actualQuantity} > 0`
        )
      )
    )
    .groupBy(manufacturingOrderIngredients.manufacturingOrderId);
  const activeBatchRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
    })
    .from(manufacturingOrderBatches)
    .where(
      and(
        inArray(manufacturingOrderBatches.manufacturingOrderId, linkedOrderIds),
        ne(manufacturingOrderBatches.status, "pending")
      )
    )
    .groupBy(manufacturingOrderBatches.manufacturingOrderId);
  const startedOrderIds = new Set([
    ...linkedOrders
      .filter((order) => order.status !== "open" || order.completedAt != null)
      .map((order) => order.id),
    ...ingredientStartRows.map((row) => row.manufacturingOrderId),
    ...activeBatchRows.map((row) => row.manufacturingOrderId),
    ...outputRows
      .filter((row) => Number(row.outputQuantity) > 0)
      .map((row) => row.manufacturingOrderId),
  ]);

  const startedLinkedOrderIds = linkedOrderIds.filter((id) => startedOrderIds.has(id));
  const notStartedLinkedOrderIds = linkedOrderIds.filter((id) => !startedOrderIds.has(id));

  if (startedLinkedOrderIds.length > 0) {
    await tx
      .update(manufacturingOrders)
      .set({
        salesOrderId: null,
        salesOrderLineId: null,
        updatedAt: new Date(),
      })
      .where(inArray(manufacturingOrders.id, startedLinkedOrderIds));
  }

  const deleted = await deleteManufacturingOrdersInTx(tx, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    ids: notStartedLinkedOrderIds,
  });

  return deleted.error ?? null;
}


export async function deleteSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deleted: boolean }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return replay.result;
    }

    await lockSalesPriorityQueueInTx(tx, orgId);
    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      const result = { deleted: false };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
	      return result;
	    }

    const blocker = await getSalesOrderDeleteBlockerInTx(tx, [id]);
    if (blocker) {
      throw new SalesError(blocker, 400);
    }

    const existingLines = await getOrderLinesInTx(tx, id);
    const existingLineIds = existingLines.map((line) => line.id);
    const linkedManufacturingError = await deleteSalesLinkedManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      salesOrderIds: [id],
      salesOrderLineIds: existingLineIds,
    });

    if (linkedManufacturingError) {
      throw new SalesError(linkedManufacturingError, 400);
    }

    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({
        priorityRank: null,
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(salesOrders.id, id));

	    await releaseSalesDemandForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "delete-order"
      ),
      reason: "deleted",
	      salesOrderLineIds: existingLineIds,
	    });

    if (isOpenSalesOrderStatus(order.status)) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    const result = { deleted: true };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deleteSalesOrders(
  ids: string[],
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deletedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { ids: [...new Set(ids)].sort() },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const uniqueIds = [...new Set(ids)];

    await lockSalesPriorityQueueInTx(tx, orgId);
	    const orders = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          inArray(salesOrders.id, uniqueIds),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (orders.length === 0) {
      const result = { deletedCount: 0 };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

	    const orderIds = orders.map((o) => o.id);
    const blocker = await getSalesOrderDeleteBlockerInTx(tx, orderIds);
    if (blocker) {
      throw new SalesError(blocker, 400);
    }

    const lines = await tx
      .select({ id: salesOrderLines.id })
	      .from(salesOrderLines)
	      .where(inArray(salesOrderLines.salesOrderId, orderIds));
    const lineIds = lines.map((line) => line.id);
    const linkedManufacturingError = await deleteSalesLinkedManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      salesOrderIds: orderIds,
      salesOrderLineIds: lineIds,
    });

    if (linkedManufacturingError) {
      throw new SalesError(linkedManufacturingError, 400);
    }
	    const deletedAt = new Date();

	    await tx
      .update(salesOrders)
      .set({ priorityRank: null, deletedAt, updatedAt: deletedAt })
      .where(inArray(salesOrders.id, orderIds));

    await releaseSalesDemandForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: orderIds.join(","),
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "bulk-delete-orders"
      ),
      reason: "deleted",
	      salesOrderLineIds: lineIds,
	    });

    if (orders.some((order) => isOpenSalesOrderStatus(order.status))) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    const result = { deletedCount: orders.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
