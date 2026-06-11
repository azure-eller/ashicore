import "server-only";

import { eq } from "drizzle-orm";
import { manufacturingOrders } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { notify } from "@/lib/notifications/notify";
import { captureAppError } from "@/lib/observability/sentry";
import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_TYPES,
} from "@/lib/reports/constants";

function formatQuantity(value: string | null): string {
  if (value == null) return "";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Post-commit announcement; never throws (delegates to notify's guarantee). */
export async function notifyManufacturingOrderCreated(
  orgId: string,
  orderId: string
): Promise<void> {
  try {
    const [order] = await withOrgContext(orgId, (tx) =>
      tx
        .select({
          orderNumber: manufacturingOrders.orderNumber,
          productName: manufacturingOrders.productName,
          plannedQuantity: manufacturingOrders.plannedQuantity,
          unitName: manufacturingOrders.unitName,
        })
        .from(manufacturingOrders)
        .where(eq(manufacturingOrders.id, orderId))
        .limit(1)
    );
    if (!order) return;

    const quantity = [formatQuantity(order.plannedQuantity), order.unitName]
      .filter(Boolean)
      .join(" ");

    await notify(orgId, {
      type: NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED,
      entityType: NOTIFICATION_ENTITY_TYPES.MANUFACTURING_ORDER,
      entityId: orderId,
      // notifications.title is varchar(255); productName alone can reach 255.
      title: `MO created — ${order.productName}`.slice(0, 255),
      body: [order.orderNumber, `${quantity} ${order.productName}`.trim()]
        .filter(Boolean)
        .join(": "),
    });
  } catch (error) {
    console.error(
      "[notifications] manufacturing_order_created failed",
      { orgId, orderId },
      error
    );
    captureAppError(error, {
      module: "notifications",
      operation: "notify:manufacturing_order_created",
    });
  }
}
