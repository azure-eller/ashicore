import {
  ApiClientError,
  createApiJsonRequester,
} from "@/lib/client/api";
import type { NegativeStockWarningPayload } from "@/lib/sales/types";

export class SalesOrderApiError extends ApiClientError {
  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
    /** Populated on a 409 stock shortage so callers can confirm-and-retry. */
    public negativeStock?: NegativeStockWarningPayload,
  ) {
    super("SalesOrderApiError", message, status, fieldErrors);
  }
}

const json = createApiJsonRequester(({ message, status, fieldErrors, body }) => {
  const negativeStock =
    body && typeof body === "object" && "negativeStock" in body
      ? ((body as { negativeStock?: NegativeStockWarningPayload }).negativeStock)
      : undefined;
  return new SalesOrderApiError(message, status, fieldErrors, negativeStock);
}, (path) => `Request failed (${path})`, (status, path) => `Request failed (${status} ${path})`);

/**
 * Ship all remaining sales quantities, or the supplied partial `sellingQuantity`
 * values. The server converts them with each line's snapshotted sales-to-stock
 * factor; 409 carries `.negativeStock`.
 * `syncAccounting` is intentionally omitted: the server defaults it on and only pushes
 * a Xero invoice when the org's `autoPushSalesInvoices` setting is enabled, so invoicing
 * is governed by settings — identical wherever shipping is triggered from.
 */
export async function shipSalesOrder(
  orderId: string,
  confirmNegativeStock: boolean,
  lines?: Array<{ salesOrderLineId: string; sellingQuantity: string }>,
  locationId?: string | null,
): Promise<void> {
  const path = `/api/sales-orders/${orderId}/ship`;
  await json<void>(path, {
    method: "POST",
    idempotencyKey: "shipSalesOrder",
    body: {
      confirmNegativeStock,
      lines,
      ...(locationId ? { locationId } : {}),
    },
  });
}
