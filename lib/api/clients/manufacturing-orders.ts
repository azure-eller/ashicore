import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  PatchManufacturingOrder,
  PatchManufacturingOrderIngredient,
} from "@/lib/schemas/manufacturing-orders";

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
