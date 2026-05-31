import { apiJson } from "@/lib/client/api";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

/**
 * Transition a purchase order's status. The backend handles the side effects of each
 * transition (submit on `ordered`, auto-receive remaining lines on `received`, etc.).
 */
export async function updatePurchaseOrderStatus(
  orderId: string,
  status: PurchaseOrderStatus,
): Promise<{ id: string }> {
  return apiJson<{ id: string }>(`/api/purchase-orders/${orderId}/status`, {
    method: "PATCH",
    idempotencyKey: "purchase-order-status",
    body: { status },
    fallbackError: "Failed to update purchase order status.",
  });
}
