import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  PatchManufacturingOrder,
  PatchManufacturingOrderIngredient,
} from "@/lib/schemas/manufacturing-orders";
import type {
  ManufacturingOrderDetail,
  ManufacturingReleaseWarningPayload,
  ManufacturingSalesOrderPreview,
} from "@/app/(dashboard)/manufacturing/types";

export class ManufacturingOrderApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>,
    /** Populated on a 409 stock/requirement shortage so callers can confirm-and-retry. */
    public shortage?: ManufacturingReleaseWarningPayload,
  ) {
    super(message);
    this.name = "ManufacturingOrderApiError";
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  let fieldErrors: Record<string, string[]> | undefined;
  let shortage: ManufacturingReleaseWarningPayload | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      errors?: Record<string, string[]>;
      shortage?: ManufacturingReleaseWarningPayload;
    };
    if (body.error) message = body.error;
    if (body.errors) fieldErrors = body.errors;
    if (body.shortage) shortage = body.shortage;
  } catch {
    // body wasn't JSON; keep status message
  }
  throw new ManufacturingOrderApiError(message, response.status, fieldErrors, shortage);
}

export type OutputDisposition = "available" | "blocked";

/**
 * Finalize an MO: backflush ingredients and produce the good output, moving the order
 * to `done`. On a 409 stock shortage the thrown error carries `.shortage`; retry with
 * `confirmNegativeStock: true` after the user confirms.
 */
export async function completeManufacturingOrder(
  orderId: string,
  input: {
    actualQuantity?: string;
    outputDisposition: OutputDisposition;
    confirmNegativeStock?: boolean;
  },
): Promise<{ id: string }> {
  const response = await fetch(`/api/manufacturing-orders/${orderId}/complete`, {
    method: "POST",
    headers: createIdempotencyHeaders("completeManufacturingOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      actualQuantity: input.actualQuantity,
      outputDisposition: input.outputDisposition,
      ingredientActuals: [],
      confirmNegativeStock: input.confirmNegativeStock ?? false,
    }),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}

/**
 * Record partial good output without closing the order (the order stays open for the
 * remaining quantity). Same 409 shortage / confirm-and-retry contract as completion.
 */
export async function recordManufacturingOutput(
  orderId: string,
  input: {
    quantity: string;
    outputDisposition: OutputDisposition;
    confirmNegativeStock?: boolean;
  },
): Promise<{ id: string }> {
  const response = await fetch(`/api/manufacturing-orders/${orderId}/outputs`, {
    method: "POST",
    headers: createIdempotencyHeaders("recordManufacturingOutput", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      quantity: input.quantity,
      outputDisposition: input.outputDisposition,
      confirmNegativeStock: input.confirmNegativeStock ?? false,
    }),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}

/**
 * Metadata PATCH for the redesigned MO sheet. Inventory-affecting changes
 * such as quantity and ingredients go through the full update endpoint.
 */
export async function patchManufacturingOrder(
  orderId: string,
  input: PatchManufacturingOrder,
): Promise<{ id: string }> {
  const response = await fetch(`/api/manufacturing-orders/${orderId}`, {
    method: "PATCH",
    headers: createIdempotencyHeaders("patchManufacturingOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}

export async function fetchManufacturingOrder(
  orderId: string,
): Promise<ManufacturingOrderDetail> {
  const response = await fetch(`/api/manufacturing-orders/${orderId}`);
  if (!response.ok) return parseError(response);
  return (await response.json()) as ManufacturingOrderDetail;
}

export type CreateManufacturingOrderInput = {
  productId: string;
  plannedQuantity: string;
  plannedDate: string | null;
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
};

/**
 * Creates an MO from the draft sheet — mirrors the item-card draft commit.
 * Auto-allocates lots (FIFO) on save and confirms shortages so the create
 * is a single inline action, just like typing a product name + quantity.
 */
export async function createManufacturingOrder(
  input: CreateManufacturingOrderInput,
): Promise<{ id: string }> {
  const response = await fetch("/api/manufacturing-orders", {
    method: "POST",
    headers: createIdempotencyHeaders("createManufacturingOrder", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      productId: input.productId,
      plannedQuantity: input.plannedQuantity,
      plannedDate: input.plannedDate,
      ingredients: input.ingredients,
      autoAllocateIngredientLots: true,
      confirmShortage: true,
    }),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}

export type ManufacturingSalesOrderOptionDto = {
  id: string;
  orderNumber: string;
  customerName: string;
  shipDate: string | null;
  requestedDate: string | null;
  manufacturableLineCount: number;
  hasManufacturableLines: boolean;
  disabledReason: string | null;
};

export async function fetchSalesOrderOptions(): Promise<
  ManufacturingSalesOrderOptionDto[]
> {
  const response = await fetch("/api/manufacturing-orders/sales-order-options");
  if (!response.ok) return parseError(response);
  return (await response.json()) as ManufacturingSalesOrderOptionDto[];
}

export async function fetchSalesOrderManufacturingPreview(
  salesOrderId: string,
): Promise<ManufacturingSalesOrderPreview> {
  const response = await fetch(
    `/api/sales-orders/${salesOrderId}/manufacturing-orders`,
  );
  if (!response.ok) return parseError(response);
  return (await response.json()) as ManufacturingSalesOrderPreview;
}

/**
 * Replace the MO's ingredient list or planned quantity through the existing
 * kernel-safe full-update path.
 */
export async function saveManufacturingOrderIngredients(
  orderId: string,
  header: {
    plannedQuantity: string;
    plannedDate: string | null;
    notes: string | null;
    salesOrderId: string | null;
    salesOrderLineId: string | null;
  },
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>,
): Promise<{ id: string }> {
  const response = await fetch(`/api/manufacturing-orders/${orderId}`, {
    method: "PUT",
    headers: createIdempotencyHeaders("saveManufacturingOrderIngredients", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      plannedQuantity: header.plannedQuantity,
      plannedDate: header.plannedDate,
      notes: header.notes,
      salesOrderId: header.salesOrderId,
      salesOrderLineId: header.salesOrderLineId,
      ingredients,
      autoAllocateIngredientLots: true,
    }),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}

export async function reorderManufacturingOrderIngredients(
  orderId: string,
  ingredientIds: string[],
): Promise<void> {
  const response = await fetch(
    `/api/manufacturing-orders/${orderId}/ingredients/reorder`,
    {
      method: "PATCH",
      headers: createIdempotencyHeaders("reorderManufacturingOrderIngredients", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ ingredientIds }),
    },
  );
  if (!response.ok) return parseError(response);
}

export async function patchManufacturingOrderIngredient(
  orderId: string,
  ingredientId: string,
  input: PatchManufacturingOrderIngredient,
): Promise<{ id: string }> {
  const response = await fetch(
    `/api/manufacturing-orders/${orderId}/ingredients/${ingredientId}`,
    {
      method: "PATCH",
      headers: createIdempotencyHeaders("patchManufacturingOrderIngredient", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
}
