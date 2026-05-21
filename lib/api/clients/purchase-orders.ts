import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";

/**
 * Transition a purchase order's status. The backend handles the side effects of each
 * transition (submit on `ordered`, auto-receive remaining lines on `received`, etc.).
 */
export async function updatePurchaseOrderStatus(
  orderId: string,
  status: PurchaseOrderStatus,
): Promise<{ id: string }> {
  const response = await fetch(`/api/purchase-orders/${orderId}/status`, {
    method: "PATCH",
    headers: createIdempotencyHeaders("purchase-order-status", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ status }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to update purchase order status.");
  }
  return body as { id: string };
}
