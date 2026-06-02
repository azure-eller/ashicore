import {
  ApiClientError,
  createApiJsonRequester,
} from "@/lib/client/api";
import type {
  InsertSalesOrder,
  PatchSalesOrderHeader,
  PatchSalesOrderLine,
} from "@/lib/schemas/sales-orders";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";

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
 * Ship the whole sales order (all remaining). 409 carries `.negativeStock`.
 * `syncAccounting` is intentionally omitted: the server defaults it on and only pushes
 * a Xero invoice when the org's `autoPushSalesInvoices` setting is enabled, so invoicing
 * is governed by settings — identical wherever shipping is triggered from.
 */
export async function shipSalesOrder(
  orderId: string,
  confirmNegativeStock: boolean,
  lines?: Array<{ salesOrderLineId: string; quantity: string }>,
): Promise<void> {
  const path = `/api/sales-orders/${orderId}/ship`;
  await json<void>(path, {
    method: "POST",
    idempotencyKey: "shipSalesOrder",
    body: { confirmNegativeStock, lines },
  });
}

/** Create a sales order from the draft card. Returns the new order id. */
export async function createSalesOrder(
  input: InsertSalesOrder,
): Promise<{ id: string }> {
  const path = `/api/sales-orders`;
  return json<{ id: string }>(path, {
    method: "POST",
    idempotencyKey: "createSalesOrder",
    body: input,
  });
}

export async function fetchSalesOrderDetail(
  orderId: string,
): Promise<SalesOrderDetail> {
  const path = `/api/sales-orders/${orderId}`;
  return json<SalesOrderDetail>(path);
}

/**
 * Per-field header patch for the inline-edit flow on the new Calm Matrix
 * Sales Order page. Mirrors the Item Detail PATCH client.
 */
export async function patchSalesOrderHeader(
  orderId: string,
  patch: PatchSalesOrderHeader,
): Promise<SalesOrderDetail> {
  const path = `/api/sales-orders/${orderId}`;
  return json<SalesOrderDetail>(path, {
    method: "PATCH",
    idempotencyKey: "patchSalesOrderHeader",
    body: patch,
  });
}

/**
 * Full-document update (PUT). Used for structural line changes (add/remove)
 * on a saved order, which need the canonical updateSalesOrder reservation
 * handling. Returns the updated order.
 */
export async function updateSalesOrderFull(
  orderId: string,
  payload: InsertSalesOrder,
): Promise<{ id: string }> {
  const path = `/api/sales-orders/${orderId}`;
  return json<{ id: string }>(path, {
    method: "PUT",
    idempotencyKey: "updateSalesOrder",
    body: payload,
  });
}

/** Per-line patch — quantity and/or unit price. */
export async function patchSalesOrderLine(
  orderId: string,
  lineId: string,
  patch: PatchSalesOrderLine,
): Promise<SalesOrderDetail> {
  const path = `/api/sales-orders/${orderId}/lines/${lineId}`;
  return json<SalesOrderDetail>(path, {
    method: "PATCH",
    idempotencyKey: "patchSalesOrderLine",
    body: patch,
  });
}
