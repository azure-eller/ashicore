import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  PatchSalesOrderHeader,
  PatchSalesOrderLine,
} from "@/lib/schemas/sales-orders";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";

export class SalesOrderApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>,
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
  throw new SalesOrderApiError(message, response.status, fieldErrors);
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
