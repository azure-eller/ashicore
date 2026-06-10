import "server-only";

import { eq } from "drizzle-orm";
import { purchaseOrders } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  addExpectedFromPurchaseInTx,
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
} from "@/lib/inventory/kernel";
import { PurchasingError } from "./errors";
import { getLockedPurchaseOrderInTx, getPurchaseOrderLinesInTx } from "./shared";

export async function submitPurchaseOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
    syncAccounting?: boolean;
    sendEmail?: boolean;
  },
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "submitPurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: {
          id,
          syncAccounting: options?.syncAccounting ?? true,
          sendEmail: options?.sendEmail ?? false,
        },
      },
    );

    if (replay.replayed) {
      return {
        replayed: true as const,
        submitted: replay.result,
        orgId,
      };
    }

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        submitted: null,
        orgId,
      };
    }

    if (order.status !== "draft") {
      throw new PurchasingError(
        "Only draft purchase orders can be submitted.",
        400,
      );
    }

    const lines = await getPurchaseOrderLinesInTx(tx, id);
    if (lines.length === 0) {
      throw new PurchasingError(
        "Add at least one material before ordering this purchase order.",
        400,
      );
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "ordered",
        orderedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await addExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "submit-order",
      ),
      lines: lines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: parseFloat(line.stockQuantityOrdered),
      })),
    });

    const submitted = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: submitted,
    });

    return {
      replayed: false as const,
      submitted,
      orgId,
    };
  });

  if (!result.submitted) {
    return null;
  }

  if (result.replayed) {
    return result.submitted;
  }

  if (options?.syncAccounting === false) {
    return result.submitted;
  }

  const { getXeroAutomationSettingsForOrg } = await import("@/lib/dal/xero");
  const automation = await getXeroAutomationSettingsForOrg(result.orgId);
  if (!automation?.autoPushPurchaseOrders) {
    return result.submitted;
  }

  // Stock + expected-supply tx has committed. Attempt the Xero PO push;
  // a failure must NOT roll back the submit — the order is ordered
  // regardless of accounting state.
  const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
    await import("@/lib/xero/push-purchase-order");
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushPurchaseOrderToXero(result.orgId, id, {
      sendEmail: options?.sendEmail,
    });
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      if (!error.message.includes("not connected")) {
        await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
    }
  }

  return result.submitted;
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
