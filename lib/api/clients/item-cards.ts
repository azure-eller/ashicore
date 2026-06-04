import {
  ApiClientError,
  createApiJsonRequester,
} from "@/lib/client/api";
import type {
  DuplicateCombinationWarning,
  ItemType,
  VariantOptionValueDisplay,
} from "@/app/(dashboard)/inventory/types";
import type { BomComponentConstraint } from "@/lib/bom/constraints";

export class EndpointNotReadyError extends Error {
  constructor(public path: string) {
    super(`Endpoint not ready: ${path}`);
    this.name = "EndpointNotReadyError";
  }
}

export class ItemCardApiError extends ApiClientError {
  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>
  ) {
    super("ItemCardApiError", message, status, fieldErrors);
  }
}

// Date-like fields tolerate both Date (server-side, fresh from DAL) and string
// (after server→client RSC serialization). Client code should not depend on
// these being Date instances.
type DateOrIso = Date | string | null;

export type LotTrackingMode = "tracked" | "untracked";

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
  lotTrackingMode: LotTrackingMode;
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
  lotTrackingMode?: LotTrackingMode;
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

const json = createApiJsonRequester(({ message, status, fieldErrors, path }) => {
  if (status === 404) {
    return new EndpointNotReadyError(path);
  }

  return new ItemCardApiError(message, status, fieldErrors);
}, (path) => `Request failed (${path})`, (status, path) => `Request failed (${status} ${path})`);

function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: HeadersInit;
    idempotencyKey?: string;
    body?: unknown;
  } = {},
) {
  return json<T>(path, options);
}

export async function getItemCard(itemId: string): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}`;
  return request<ItemCardDto>(path);
}

export async function fetchItemCategories(itemType: ItemType): Promise<string[]> {
  const path = `/api/item-cards/categories?itemType=${itemType}`;
  return request<string[]>(path);
}

export type CreateItemCardResult = {
  itemId: string;
  card: ItemCardDto;
};

export async function createItemCard(input: CreateItemCardInput): Promise<CreateItemCardResult> {
  const path = `/api/item-cards`;
  return request<CreateItemCardResult>(path, {
    method: "POST",
    idempotencyKey: "createItemCard",
    body: input,
  });
}

export async function updateItemCard(
  itemId: string,
  input: UpdateItemCardInput
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}`;
  return request<ItemCardDto>(path, {
    method: "PATCH",
    idempotencyKey: "updateItemCard",
    body: input,
  });
}

/**
 * PATCH variant-level fields for a single variant items row. Family-level
 * fields go through `updateItemCard`; this companion handles the inline-cell
 * autosaves (SKU, barcodes, supplier item code, lead time, MOQ, pricing).
 */
export async function updateItemCardVariant(
  variantItemId: string,
  input: UpdateItemCardVariantInput
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${variantItemId}/variant`;
  return request<ItemCardDto>(path, {
    method: "PATCH",
    idempotencyKey: "updateItemCardVariant",
    body: input,
  });
}

export async function updateItemCardSellable(
  itemId: string,
  input: { sellable: boolean },
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/sellable`;
  return request<ItemCardDto>(path, {
    method: "POST",
    idempotencyKey: "updateItemCardSellable",
    body: input,
  });
}

export async function reorderItemCardVariants(
  itemId: string,
  orderedVariantIds: string[],
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variants/reorder`;
  return request<ItemCardDto>(path, {
    method: "POST",
    idempotencyKey: "reorderItemCardVariants",
    body: { orderedVariantIds },
  });
}

export async function deleteItemCard(itemId: string): Promise<{ deleted: boolean }> {
  const path = `/api/item-cards/${itemId}`;
  return request<{ deleted: boolean }>(path, {
    method: "DELETE",
    idempotencyKey: "deleteItemCard",
  });
}

export async function cloneItemCard(itemId: string): Promise<CreateItemCardResult> {
  const path = `/api/item-cards/${itemId}/clone`;
  return request<CreateItemCardResult>(path, {
    method: "POST",
    idempotencyKey: "cloneItemCard",
  });
}

export async function updateVariantConfig(
  itemId: string,
  input: VariantConfigInput
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variant-config`;
  return request<ItemCardDto>(path, {
    method: "PUT",
    idempotencyKey: "updateItemCardVariantConfig",
    body: input,
  });
}

export async function copyVariantConfigFrom(
  itemId: string,
  input: CopyVariantConfigInput,
): Promise<ItemCardDto> {
  const path = `/api/item-cards/${itemId}/variant-config/copy-from`;
  return request<ItemCardDto>(path, {
    method: "POST",
    idempotencyKey: "copyItemCardVariantConfig",
    body: input,
  });
}

export async function previewVariantGeneration(itemId: string): Promise<GenerationPreviewDto> {
  const path = `/api/item-cards/${itemId}/variants/generate-preview`;
  return request<GenerationPreviewDto>(path, { method: "POST" });
}

export async function generateVariants(
  itemId: string,
  input: GenerateVariantsInput
): Promise<{ created: Array<{ id: string }> }> {
  const path = `/api/item-cards/${itemId}/variants/generate`;
  return request<{ created: Array<{ id: string }> }>(path, {
    method: "POST",
    idempotencyKey: "generateItemCardVariants",
    body: input,
  });
}

/**
 * Delete a single variant (operational items row).
 * Uses the existing /api/items/:id DELETE endpoint, which blocks if the variant
 * is referenced by orders/BOMs/MOs/POs/stocktakes.
 */
export async function deleteVariant(variantId: string): Promise<{ success: boolean }> {
  const path = `/api/items/${variantId}`;
  return request<{ success: boolean }>(path, {
    method: "DELETE",
    idempotencyKey: "deleteItemCardVariant",
  });
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
  const path = `/api/items/${variantId}/initial-stock`;
  return request<{ lotId: string; eventId: string }>(path, {
    method: "POST",
    idempotencyKey: "addInitialStock",
    body: input,
  });
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
  return request<{ revisions: Array<{ variantId: string; revisionId: string }> }>(path, {
    method: "POST",
    idempotencyKey: "copyBomToVariants",
    body: input,
  });
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
  return request<{ revisionId: string }>(path, {
    method: "POST",
    idempotencyKey: "copyBomFromVariant",
    body: input,
  });
}

/**
 * Persist a new BOM revision for the given variant (product). Called from the
 * Recipe tab when the user clicks Save.
 */
export type SaveBomRevisionInput = {
  recipeBasis?: "unit" | "batch";
  expectedBatchYield?: string | null;
  outputQuantity?: string | null;
  bom: Array<{
    componentId: string;
    quantity: string;
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

export type ProductRecipeTabPayload = {
  focusItemId: string;
  initialBomRows: Array<{
    componentId: string | null;
    quantity: string | null;
    minimumLotAgeDays?: string | number | null;
    alternates?: Array<{ itemId: string }>;
  }>;
  initialBomRevisionId: string | null;
  initialOutputQuantity: string;
  initialRecipeBasis: "unit" | "batch";
  initialExpectedBatchYield: string | null;
  bomRevisions: Array<{
    id: string;
    revisionNumber: number;
    isCurrent: boolean;
    note: string | null;
    createdAt: Date | string;
    createdByName: string | null;
    components: Array<{
      id: string;
      componentId: string;
      componentName: string;
      componentItemType: string;
      unitName: string;
      quantity: string;
      constraints: BomComponentConstraint[];
    }>;
  }>;
  availableComponents: Array<{
    id: string;
    name: string;
    displayName: string;
    itemType: string;
    unit: string;
  }>;
  canViewBom: boolean;
  canEditProduct: boolean;
};

export type ProductProductionTabPayload = {
  focusItemId: string;
  currentBomRows: ProductRecipeTabPayload["initialBomRows"];
  currentBomOutputQuantity: string;
  currentRecipeBasis: "unit" | "batch";
  initialOperationCosts: Array<{
    operationName: string | null;
    resourceId: string | null;
    costScalingMode?: "per_output_unit" | "fixed_per_mo" | null;
    crewSize: string | null;
    plannedMinutes: string | null;
    loadedCostPerHour?: string | null;
  }>;
  resources: Array<{
    id: string;
    name: string;
    resourceType: string;
    loadedCostPerHour: string;
  }>;
  expectedBatchYield: string | null;
  typicalBatchSize: string | null;
  standardCostQuantity: string | null;
};

export async function saveBomRevision(
  variantId: string,
  input: SaveBomRevisionInput,
): Promise<{ revisionId: string; revisionNumber: number }> {
  const path = `/api/items/${variantId}/bom-revisions`;
  return request<{ revisionId: string; revisionNumber: number }>(path, {
    method: "POST",
    idempotencyKey: "createBomRevision",
    body: input,
  });
}

export async function getProductRecipeTabPayload(
  variantId: string,
): Promise<ProductRecipeTabPayload> {
  const path = `/api/items/${variantId}/recipe-tab`;
  return request<ProductRecipeTabPayload>(path);
}

export async function getProductProductionTabPayload(
  variantId: string,
): Promise<ProductProductionTabPayload> {
  const path = `/api/items/${variantId}/production-tab`;
  return request<ProductProductionTabPayload>(path);
}

export async function copyOperationsToVariants(
  sourceVariantId: string,
  input: CopyBomInput
): Promise<{ revisions: Array<{ variantId: string; revisionId: string }> }> {
  const path = `/api/items/${sourceVariantId}/operations/copy-to`;
  return request<{ revisions: Array<{ variantId: string; revisionId: string }> }>(path, {
    method: "POST",
    idempotencyKey: "copyOperationsToVariants",
    body: input,
  });
}

export async function copyOperationsFromVariant(
  targetVariantId: string,
  input: CopyBomFromInput
): Promise<{ revisionId: string }> {
  const path = `/api/items/${targetVariantId}/operations/copy-from`;
  return request<{ revisionId: string }>(path, {
    method: "POST",
    idempotencyKey: "copyOperationsFromVariant",
    body: input,
  });
}

export async function getNextInternalBarcode(): Promise<string> {
  const path = "/api/items/internal-barcodes/next";
  const body = await request<{ value: string }>(path);
  return body.value;
}
