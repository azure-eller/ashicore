import "server-only";

import { eq } from "drizzle-orm";
import { purchaseOrders } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { notify } from "@/lib/notifications/notify";
import { captureAppError } from "@/lib/observability/sentry";
import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_TYPES,
} from "@/lib/reports/constants";

/** Post-commit announcement for any successful PO receipt; never throws. */
export async function notifyPurchaseOrderReceived(
  orgId: string,
  purchaseOrderId: string
): Promise<void> {
  try {
    const [order] = await withOrgContext(orgId, (tx) =>
      tx
        .select({
          orderNumber: purchaseOrders.orderNumber,
          supplierName: purchaseOrders.supplierName,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, purchaseOrderId))
        .limit(1)
    );
    if (!order) return;

    const statusLabel = order.status === "received" ? "fully received" : "partially received";

    await notify(orgId, {
      type: NOTIFICATION_TYPES.PURCHASE_ORDER_RECEIVED,
      entityType: NOTIFICATION_ENTITY_TYPES.PURCHASE_ORDER,
      entityId: purchaseOrderId,
      title: `PO received — ${order.supplierName}`.slice(0, 255),
      body: `${order.orderNumber}: ${statusLabel}`,
    });
  } catch (error) {
    console.error(
      "[notifications] purchase_order_received failed",
      { orgId, purchaseOrderId },
      error
    );
    captureAppError(error, {
      module: "notifications",
      operation: "notify:purchase_order_received",
    });
  }
}
