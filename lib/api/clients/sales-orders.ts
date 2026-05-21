import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  InsertSalesOrder,
  PatchSalesOrderHeader,
  PatchSalesOrderLine,
} from "@/lib/schemas/sales-orders";
import type {
  NegativeStockWarningPayload,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";

export class SalesOrderApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>,
    /** Populated on a 409 stock shortage so callers can confirm-and-retry. */
    public negativeStock?: NegativeStockWarningPayload,
  ) {
    super(message);
    this.name = "SalesOrderApiError";
  }
}

async function parseError(response: Response, path: string): Promise<never> {
  const body = await response.json().catch(() => null as unknown);
  const message =
    body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `Request failed (${response.status} ${path})`;
  const fieldErrors =
    body && typeof body === "object" && "errors" in body
      ? ((body as { errors?: Record<string, string[]> }).errors)
      : undefined;
  const negativeStock =
    body && typeof body === "object" && "negativeStock" in body
      ? ((body as { negativeStock?: NegativeStockWarningPayload }).negativeStock)
      : undefined;
  throw new SalesOrderApiError(message, response.status, fieldErrors, negativeStock);
}

/**
 * Ship the whole sales order (all remaining). 409 carries `.negativeStock`.
 * `syncAccounting` is intentionally omitted: the server defaults it on and only pushes
 * a Xero invoice when the org's `autoPushSalesInvoices` setting is enabled, so invoicing
 * is governed by settings — identical wherever shipping is triggered from.
 */
export async function shipSalesOrder(
  orderId: string,
  confirmNegativeStock: boolean,
): Promise<void> {
  const path = `/api/sales-orders/${orderId}/ship`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("shipSalesOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ confirmNegativeStock }),
  });
  if (!response.ok) await parseError(response, path);
}

/** Mark a single planned shipment shipped. 409 carries `.negativeStock`. */
export async function shipSalesShipment(
  orderId: string,
  shipmentId: string,
  confirmNegativeStock: boolean,
): Promise<void> {
  const path = `/api/sales-orders/${orderId}/shipments/${shipmentId}/ship`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("shipSalesShipment", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ confirmNegativeStock }),
  });
  if (!response.ok) await parseError(response, path);
}

/** Create a sales order from the draft card. Returns the new order id. */
export async function createSalesOrder(
  input: InsertSalesOrder,
): Promise<{ id: string }> {
  const path = `/api/sales-orders`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("createSalesOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response, path);
  return (await response.json()) as { id: string };
}

export async function fetchSalesOrderDetail(
  orderId: string,
): Promise<SalesOrderDetail> {
  const path = `/api/sales-orders/${orderId}`;
  const response = await fetch(path);
  if (!response.ok) await parseError(response, path);
  return (await response.json()) as SalesOrderDetail;
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
  const response = await fetch(path, {
    method: "PATCH",
    headers: createIdempotencyHeaders("patchSalesOrderHeader", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response, path);
  return (await response.json()) as SalesOrderDetail;
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
  const response = await fetch(path, {
    method: "PUT",
    headers: createIdempotencyHeaders("updateSalesOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response, path);
  return (await response.json()) as { id: string };
}

/**
 * Update a planned shipment's header fields (fulfillment type / dates / notes).
 * The PATCH schema requires the full shipment incl. lines, so callers serialize
 * the current shipment and override the changed field.
 */
export async function patchSalesShipment(
  orderId: string,
  shipmentId: string,
  payload: {
    fulfillmentType: "delivery" | "pickup";
    scheduledDate: string | null;
    deliveryDate: string | null;
    notes: string | null;
    lines: { salesOrderLineId: string; quantity: string }[];
  },
): Promise<unknown> {
  const path = `/api/sales-orders/${orderId}/shipments/${shipmentId}`;
  const response = await fetch(path, {
    method: "PATCH",
    headers: createIdempotencyHeaders("updateSalesShipment", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response, path);
  return response.json();
}

/** Per-line patch — quantity and/or unit price. */
export async function patchSalesOrderLine(
  orderId: string,
  lineId: string,
  patch: PatchSalesOrderLine,
): Promise<SalesOrderDetail> {
  const path = `/api/sales-orders/${orderId}/lines/${lineId}`;
  const response = await fetch(path, {
    method: "PATCH",
    headers: createIdempotencyHeaders("patchSalesOrderLine", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response, path);
  return (await response.json()) as SalesOrderDetail;
}
