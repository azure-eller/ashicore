import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import type {
  DuplicateCombinationWarning,
  ItemType,
  VariantOptionValueDisplay,
} from "@/app/(dashboard)/inventory/types";

export class EndpointNotReadyError extends Error {
  constructor(public path: string) {
    super(`Endpoint not ready: ${path}`);
    this.name = "EndpointNotReadyError";
  }
}

export class ItemCardApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ItemCardApiError";
  }
}

// Date-like fields tolerate both Date (server-side, fresh from DAL) and string
// (after server→client RSC serialization). Client code should not depend on
// these being Date instances.
type DateOrIso = Date | string | null;

export type VariantOptionValueDto = {
  id: string;
  label: string;
  code: string;
  sortOrder: number;
  disabledAt: DateOrIso;
};

export type VariantOptionDto = {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  disabledAt: DateOrIso;
  values: VariantOptionValueDto[];
};

export type ItemCardVariantDto = {
  id: string;
  familyId: string;
  name: string;
  displayName: string;
  sku: string | null;
  itemType: ItemType;
  optionCombinationKey: string;
  optionValues: VariantOptionValueDisplay[];
  duplicateCombinationWarnings: DuplicateCombinationWarning[];
  deletedAt: DateOrIso;
  registeredBarcode: string | null;
  internalBarcode: string | null;
  supplierItemCode: string | null;
  defaultLeadTimeDays: number | null;
  minimumOrderQuantity: string | null;
  defaultSellingPrice: string | null;
  inStockQty: string;
  ingredientsCost: string | null;
  operationsCost: string | null;
  sortOrder: number;
  sellable: boolean;
};

export type ItemCardFamilyDto = {
  id: string;
  itemType: ItemType;
  name: string;
  category: string | null;
  description: string | null;
  unitDefinitionId: string;
  unitName: string | null;
  defaultSupplierId: string | null;
  purchaseUnitDefinitionId: string | null;
  purchaseToStockFactor: string | null;
  deletedAt: DateOrIso;
  createdAt: DateOrIso;
  updatedAt: DateOrIso;
};

export type ItemCardDto = {
  family: ItemCardFamilyDto;
  options: VariantOptionDto[];
  variants: ItemCardVariantDto[];
};

export type GenerationPreviewDto = {
  familyId: string;
  potentialCount: number;
  existingCount: number;
  missingCount: number;
  warnOver100: boolean;
  blocksGenerateAll: boolean;
  missingCombinations: Array<{
    optionValueIdsByOptionId: Record<string, string>;
    optionCombinationKey: string;
    displayName: string;
  }>;
};

export type CreateItemCardInput = {
  itemType: ItemType;
  name: string;
  unitDefinitionId: string;
  category?: string | null;
  description?: string | null;
  defaultSupplierId?: string | null;
  purchaseUnitDefinitionId?: string | null;
  purchaseToStockFactor?: string | null;
  sku?: string | null;
  sellable?: boolean;
  defaultSellingPrice?: string | null;
  defaultPurchasePrice?: string | null;
  currentStockUnitCost?: string | null;
  registeredBarcode?: string | null;
  internalBarcode?: string | null;
  supplierItemCode?: string | null;
  defaultLeadTimeDays?: number | null;
  minimumOrderQuantity?: string | null;
};

export type UpdateItemCardInput = Partial<Omit<CreateItemCardInput, "itemType">>;

/**
 * Variant-level fields editable through `PATCH /api/item-cards/:itemId/variant`.
 * Distinct from `UpdateItemCardInput` (family-level fields only).
 */
export type UpdateItemCardVariantInput = {
  sku?: string | null;
  registeredBarcode?: string | null;
  internalBarcode?: string | null;
  supplierItemCode?: string | null;
  defaultLeadTimeDays?: number | null;
  minimumOrderQuantity?: string | null;
  defaultSellingPrice?: string | null;
  defaultPurchasePrice?: string | null;
  currentStockUnitCost?: string | null;
  safetyStock?: string;
  sellable?: boolean;
  optionValueIdsByOptionId?: Record<string, string>;
};

export type VariantConfigInput = {
  options: Array<{
    id?: string;
    name: string;
    code?: string;
    sortOrder?: number;
    values: Array<{
      id?: string;
      label: string;
      code?: string;
      sortOrder?: number;
    }>;
  }>;
};

export type CopyVariantConfigInput = {
  sourceItemId: string;
};

export type GenerateVariantsInput = {
  combinations?: Array<Record<string, string>>;
};

async function parseError(response: Response, path: string): Promise<never> {
  if (response.status === 404) {
    throw new EndpointNotReadyError(path);
  }
  let message = `${response.status} ${response.statusText}`;
  let fieldErrors: Record<string, string[]> | undefined;
  try {
    const body = (await response.json()) as { error?: string; errors?: Record<string, string[]> };
    if (body.error) message = body.error;
    if (body.errors) fieldErrors = body.errors;
  } catch {
    // body wasn't JSON; keep status-based message
  }
  throw new ItemCardApiError(message, response.status, fieldErrors);
}

export async function getItemCard(itemId: string): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}`;
  const response = await fetch(path);
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as ItemCardDto;
}

export type CreateItemCardResult = {
  itemId: string;
  card: ItemCardDto;
};

export async function createItemCard(input: CreateItemCardInput): Promise<CreateItemCardResult> {
  const path = `/api/item-cards`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("createItemCard", { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as CreateItemCardResult;
}

export async function updateItemCard(
  itemId: string,
  input: UpdateItemCardInput
): Promise<{ id: string }> {
  const path = `/api/item-cards/${itemId}`;
  const response = await fetch(path, {
    method: "PATCH",
    headers: createIdempotencyHeaders("updateItemCard", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { id: string };
}

/**
 * PATCH variant-level fields for a single variant items row. Family-level
 * fields go through `updateItemCard`; this companion handles the inline-cell
 * autosaves (SKU, barcodes, supplier item code, lead time, MOQ, pricing).
 */
export async function updateItemCardVariant(
  variantItemId: string,
  input: UpdateItemCardVariantInput
): Promise<{ id: string }> {
  const path = `/api/item-cards/${variantItemId}/variant`;
  const response = await fetch(path, {
    method: "PATCH",
    headers: createIdempotencyHeaders("updateItemCardVariant", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { id: string };
}

export async function updateItemCardSellable(
  itemId: string,
  input: { sellable: boolean },
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/sellable`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("updateItemCardSellable", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as ItemCardDto;
}

export async function reorderItemCardVariants(
  itemId: string,
  orderedVariantIds: string[],
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variants/reorder`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("reorderItemCardVariants", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ orderedVariantIds }),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as ItemCardDto;
}

export async function deleteItemCard(itemId: string): Promise<{ deleted: boolean }> {
  const path = `/api/item-cards/${itemId}`;
  const response = await fetch(path, {
    method: "DELETE",
    headers: createIdempotencyHeaders("deleteItemCard"),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { deleted: boolean };
}

export async function updateVariantConfig(
  itemId: string,
  input: VariantConfigInput
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variant-config`;
  const response = await fetch(path, {
    method: "PUT",
    headers: createIdempotencyHeaders("updateItemCardVariantConfig", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as ItemCardDto;
}

export async function copyVariantConfigFrom(
  itemId: string,
  input: CopyVariantConfigInput,
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variant-config/copy-from`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("copyItemCardVariantConfig", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as ItemCardDto;
}

export async function previewVariantGeneration(itemId: string): Promise<GenerationPreviewDto> {
  const path = `/api/item-cards/${itemId}/variants/generate-preview`;
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as GenerationPreviewDto;
}

export async function generateVariants(
  itemId: string,
  input: GenerateVariantsInput
): Promise<{ created: Array<{ id: string }> }> {
  const path = `/api/item-cards/${itemId}/variants/generate`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("generateItemCardVariants", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { created: Array<{ id: string }> };
}

/**
 * Delete a single variant (operational items row).
 * Uses the existing /api/items/:id DELETE endpoint, which blocks if the variant
 * is referenced by orders/BOMs/MOs/POs/stocktakes.
 */
export async function deleteVariant(variantId: string): Promise<{ success: boolean }> {
  const path = `/api/items/${variantId}`;
  const response = await fetch(path, {
    method: "DELETE",
    headers: createIdempotencyHeaders("deleteItemCardVariant"),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { success: boolean };
}

export type AddInitialStockInput = {
  quantity: string;
  costPerUnit?: string | null;
  occurredAt: string;
  note?: string | null;
};

export async function addInitialStock(
  variantId: string,
  input: AddInitialStockInput
): Promise<{ lotId: string; eventId: string }> {
  const path = `/api/items/${variantId}/stock-adjustments`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("addInitialStock", { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { lotId: string; eventId: string };
}

export type CopyBomInput = {
  targetVariantIds: string[];
  note?: string | null;
};

export async function copyBomToVariants(
  sourceVariantId: string,
  input: CopyBomInput
): Promise<{ revisions: Array<{ variantId: string; revisionId: string }> }> {
  const path = `/api/items/${sourceVariantId}/bom/copy-to`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("copyBomToVariants", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { revisions: Array<{ variantId: string; revisionId: string }> };
}

export type CopyBomFromInput = {
  sourceVariantId: string;
  note?: string | null;
};

export async function copyBomFromVariant(
  targetVariantId: string,
  input: CopyBomFromInput
): Promise<{ revisionId: string }> {
  const path = `/api/items/${targetVariantId}/bom/copy-from`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("copyBomFromVariant", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { revisionId: string };
}

/**
 * Persist a new BOM revision for the given variant (product). Called from the
 * Recipe tab when the user clicks Save.
 */
export type SaveBomRevisionInput = {
  outputQuantity?: string | null;
  bom: Array<{
    componentId: string;
    quantity: string;
    everyQuantity?: string | null;
    consumptionMode?: "per_output_unit" | "per_batch" | "per_group" | null;
    basisOutputQuantity?: string | null;
    batchScalingMode?: "proportional" | "full_batches_only" | null;
    groupRemainderPolicy?: "ask" | "leave_loose" | "create_partial_group" | null;
    minimumLotAgeDays?: string | number | null;
    alternates?: Array<{ itemId: string }>;
  }>;
  operationCosts?: Array<{
    operationName: string;
    resourceId: string;
    costScalingMode?: "per_output_unit" | "fixed_per_mo" | null;
    crewSize: string;
    plannedMinutes: string;
    loadedCostPerHour?: string | null;
  }>;
  note?: string | null;
};

export async function saveBomRevision(
  variantId: string,
  input: SaveBomRevisionInput,
): Promise<{ revisionId: string; revisionNumber: number }> {
  const path = `/api/items/${variantId}/bom-revisions`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("createBomRevision", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { revisionId: string; revisionNumber: number };
}

export async function copyOperationsToVariants(
  sourceVariantId: string,
  input: CopyBomInput
): Promise<{ revisions: Array<{ variantId: string; revisionId: string }> }> {
  const path = `/api/items/${sourceVariantId}/operations/copy-to`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("copyOperationsToVariants", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { revisions: Array<{ variantId: string; revisionId: string }> };
}

export async function copyOperationsFromVariant(
  targetVariantId: string,
  input: CopyBomFromInput
): Promise<{ revisionId: string }> {
  const path = `/api/items/${targetVariantId}/operations/copy-from`;
  const response = await fetch(path, {
    method: "POST",
    headers: createIdempotencyHeaders("copyOperationsFromVariant", {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(input),
  });
  if (!response.ok) return parseError(response, path);
  return (await response.json()) as { revisionId: string };
}

export async function getNextInternalBarcode(): Promise<string> {
  const path = "/api/items/internal-barcodes/next";
  const response = await fetch(path);
  if (!response.ok) return parseError(response, path);
  const body = (await response.json()) as { value: string };
  return body.value;
}
