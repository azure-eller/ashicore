import { apiJson } from "@/lib/client/api";
import type { PurchaseOrderStatus } from "@/lib/schemas/purchase-orders";
import type { PurchaseOrderDetail } from "@/lib/purchasing/types";

export async function getPurchaseOrderDetail(
  orderId: string,
): Promise<PurchaseOrderDetail> {
  return apiJson<PurchaseOrderDetail>(`/api/purchase-orders/${orderId}`, {
    fallbackError: "Failed to load purchase order.",
  });
}

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

export type ReceivePurchaseOrderInput = {
  lines: Array<{
    lineId: string;
    quantityReceived: string;
    disposition?: "available" | "blocked";
  }>;
  confirmOverReceipt?: boolean;
  locationId?: string | null;
};

export async function receivePurchaseOrder(
  orderId: string,
  input: ReceivePurchaseOrderInput,
): Promise<{ id: string; status: PurchaseOrderStatus }> {
  return apiJson<{ id: string; status: PurchaseOrderStatus }>(
    `/api/purchase-orders/${orderId}/receive`,
    {
      method: "POST",
      idempotencyKey: "receive-purchase-order",
      body: input,
      fallbackError: "Failed to receive purchase order.",
    },
  );
}
