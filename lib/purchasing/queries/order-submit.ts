import "server-only";

import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  beginInventoryOperationInTx,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel";
import { PurchasingError } from "./errors";
import { getLockedPurchaseOrderInTx } from "./shared";

export async function compatSubmitPurchaseOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
    syncAccounting?: boolean;
    sendEmail?: boolean;
  },
) {
  if (options?.syncAccounting === true || options?.sendEmail === true) {
    throw new PurchasingError(
      "ERP purchase order export to accounting has been retired. Import open purchase orders from accounting instead.",
      410,
    );
  }

  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "compatSubmitPurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id },
      },
    );

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (!["not_received", "partial", "received"].includes(order.status)) {
      throw new PurchasingError(
        "Purchase orders are booked when created; submit no longer changes status.",
        400,
      );
    }

    const submitted = { id };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: submitted,
    });
    return submitted;
  });
}

export async function retryXeroPushForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
      await import("@/lib/xero/push-purchase-order");
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushPurchaseOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (
        error instanceof XeroError &&
        (error.status === 404 || error.status === 409)
      ) {
        throw error;
      }

      await markXeroPurchaseOrderPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function retryXeroEmailForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { emailPurchaseOrderForOrder } =
      await import("@/lib/xero/push-purchase-order");
    const result = await emailPurchaseOrderForOrder(orgId, id);
    return { ok: true as const, result };
  });
}
