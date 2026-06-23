import {
  ApiClientError,
  createApiJsonRequester,
} from "@/lib/client/api";
import { appendSearchParams } from "@/lib/routing/search-params";
import type {
  PatchManufacturingOrder,
  PatchManufacturingOrderIngredient,
} from "@/lib/schemas/manufacturing-orders";
import type {
  ManufacturingOrderDetail,
  ManufacturingReleaseWarningPayload,
  ManufacturingSalesLineOption,
} from "@/lib/manufacturing/types";

export class ManufacturingOrderApiError extends ApiClientError {
  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
    /** Populated on a 409 stock/requirement shortage so callers can confirm-and-retry. */
    public shortage?: ManufacturingReleaseWarningPayload,
  ) {
    super("ManufacturingOrderApiError", message, status, fieldErrors);
  }
}

const json = createApiJsonRequester(({ message, status, fieldErrors, body }) => {
  const shortage =
    body && typeof body === "object" && "shortage" in body
      ? ((body as { shortage?: ManufacturingReleaseWarningPayload }).shortage)
      : undefined;

  return new ManufacturingOrderApiError(message, status, fieldErrors, shortage);
}, (path) => `Request failed (${path})`, (status, path) => `Request failed (${status} ${path})`);

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
    batchCount?: number;
    outputDisposition: OutputDisposition;
    confirmNegativeStock?: boolean;
    producedLotId?: string;
    producedLotNumber?: string;
    locationId?: string | null;
  },
): Promise<{ id: string }> {
  const path = `/api/manufacturing-orders/${orderId}/complete`;
  return json<{ id: string }>(path, {
    method: "POST",
    idempotencyKey: "completeManufacturingOrder",
    body: {
      ...(input.locationId ? { locationId: input.locationId } : {}),
      actualQuantity: input.actualQuantity,
      batchCount: input.batchCount,
      outputDisposition: input.outputDisposition,
      ingredientActuals: [],
      confirmNegativeStock: input.confirmNegativeStock ?? false,
      producedLotId: input.producedLotId,
      producedLotNumber: input.producedLotNumber,
    },
  });
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
    producedLotId?: string;
    producedLotNumber?: string;
    locationId?: string | null;
  },
): Promise<{ id: string }> {
  const path = `/api/manufacturing-orders/${orderId}/outputs`;
  return json<{ id: string }>(path, {
    method: "POST",
    idempotencyKey: "recordManufacturingOutput",
    body: {
      ...(input.locationId ? { locationId: input.locationId } : {}),
      quantity: input.quantity,
      outputDisposition: input.outputDisposition,
      confirmNegativeStock: input.confirmNegativeStock ?? false,
      producedLotId: input.producedLotId,
      producedLotNumber: input.producedLotNumber,
    },
  });
}

/**
 * Metadata PATCH for the redesigned MO sheet. Inventory-affecting changes
 * such as quantity and ingredients go through the full update endpoint.
 */
export async function patchManufacturingOrder(
  orderId: string,
  input: PatchManufacturingOrder,
): Promise<ManufacturingOrderDetail> {
  const path = `/api/manufacturing-orders/${orderId}`;
  return json<ManufacturingOrderDetail>(path, {
    method: "PATCH",
    idempotencyKey: "patchManufacturingOrder",
    body: input,
  });
}

export async function fetchManufacturingOrder(
  orderId: string,
): Promise<ManufacturingOrderDetail> {
  const path = `/api/manufacturing-orders/${orderId}`;
  return json<ManufacturingOrderDetail>(path);
}

export async function startManufacturingOrder(
  orderId: string,
): Promise<ManufacturingOrderDetail> {
  const path = `/api/manufacturing-orders/${orderId}/start`;
  return json<ManufacturingOrderDetail>(path, {
    method: "POST",
    idempotencyKey: "startManufacturingOrder",
    body: {},
  });
}

type ManufacturingOrderIngredientInput = {
  itemId: string;
  defaultItemId?: string;
  quantityPerUnit: string;
};

export type CreateManufacturingOrderInput = {
  productId: string;
  plannedQuantity: string;
  batchCount?: string | null;
  plannedDate: string | null;
  notes?: string | null;
  ingredients: ManufacturingOrderIngredientInput[];
};

/**
 * Creates an MO from the draft sheet — mirrors the item-card draft commit.
 * Confirms shortages so create remains a single inline action, just like
 * typing a product name + quantity.
 */
export async function createManufacturingOrder(
  input: CreateManufacturingOrderInput,
): Promise<ManufacturingOrderDetail> {
  const path = "/api/manufacturing-orders";
  return json<ManufacturingOrderDetail>(path, {
    method: "POST",
    idempotencyKey: "createManufacturingOrder",
    body: {
      productId: input.productId,
      plannedQuantity: input.plannedQuantity,
      batchCount: input.batchCount ?? undefined,
      plannedDate: input.plannedDate,
      notes: input.notes ?? null,
      ingredients: input.ingredients,
      confirmShortage: true,
    },
  });
}

export async function fetchManufacturingSalesLineOptions(
  productId: string,
): Promise<ManufacturingSalesLineOption[]> {
  const path = appendSearchParams(
    "/api/manufacturing-orders/sales-line-options",
    { productId },
  );
  return json<ManufacturingSalesLineOption[]>(path);
}

/**
 * Replace the MO's ingredient list or planned quantity through the existing
 * kernel-safe full-update path.
 */
export async function saveManufacturingOrderIngredients(
  orderId: string,
  header: {
    productId?: string;
    plannedQuantity: string;
    batchCount?: string | null;
    plannedDate: string | null;
    notes: string | null;
    salesOrderId: string | null;
    salesOrderLineId: string | null;
  },
  ingredients: ManufacturingOrderIngredientInput[],
): Promise<ManufacturingOrderDetail> {
  const path = `/api/manufacturing-orders/${orderId}`;
  return json<ManufacturingOrderDetail>(path, {
    method: "PUT",
    idempotencyKey: "saveManufacturingOrderIngredients",
    body: {
      productId: header.productId,
      plannedQuantity: header.plannedQuantity,
      batchCount: header.batchCount ?? undefined,
      plannedDate: header.plannedDate,
      notes: header.notes,
      salesOrderId: header.salesOrderId,
      salesOrderLineId: header.salesOrderLineId,
      ingredients,
    },
  });
}

export async function reorderManufacturingOrderIngredients(
  orderId: string,
  ingredientIds: string[],
): Promise<void> {
  const path = `/api/manufacturing-orders/${orderId}/ingredients/reorder`;
  await json<void>(path, {
    method: "PATCH",
    idempotencyKey: "reorderManufacturingOrderIngredients",
    body: { ingredientIds },
  });
}

export async function patchManufacturingOrderIngredient(
  orderId: string,
  ingredientId: string,
  input: PatchManufacturingOrderIngredient,
): Promise<{ id: string }> {
  const path = `/api/manufacturing-orders/${orderId}/ingredients/${ingredientId}`;
  return json<{ id: string }>(path, {
    method: "PATCH",
    idempotencyKey: "patchManufacturingOrderIngredient",
    body: input,
  });
}
