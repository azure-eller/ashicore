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
