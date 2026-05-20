import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  PatchManufacturingOrder,
  PatchManufacturingOrderIngredient,
} from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingOrderDetail } from "@/app/(dashboard)/manufacturing/types";

export class ManufacturingOrderApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ManufacturingOrderApiError";
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  let fieldErrors: Record<string, string[]> | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      errors?: Record<string, string[]>;
    };
    if (body.error) message = body.error;
    if (body.errors) fieldErrors = body.errors;
  } catch {
    // body wasn't JSON; keep status message
  }
  throw new ManufacturingOrderApiError(message, response.status, fieldErrors);
}

/**
 * Partial PATCH for the redesigned MO sheet. Each call sends only the fields
 * that changed. Mirrors the item-card autosave shape — every mutation uses
 * mutationKey `["mo", moId, ...]` so the `useMoSaveStatus(moId)` aggregator
 * can drive the header pill.
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
      groupRemainderChoices: [],
      autoAllocateIngredientLots: true,
      confirmShortage: true,
    }),
  });
  if (!response.ok) return parseError(response);
  return (await response.json()) as { id: string };
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
