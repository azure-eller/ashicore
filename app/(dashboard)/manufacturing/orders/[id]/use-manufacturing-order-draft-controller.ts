"use client";

import { useCallback, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { updateManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import type { PatchManufacturingOrder } from "@/lib/schemas/manufacturing-orders";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
} from "@/lib/manufacturing/types";
import type { ManufacturingProductOption } from "./manufacturing-order-card";
import { queryKeys } from "@/lib/client/query-keys";

export type ManufacturingOrderDraftHeaderPatch = PatchManufacturingOrder & {
  salesOrderNumber?: string | null;
  salesCustomerName?: string | null;
};

export type ManufacturingOrderDraftController = {
  draft: ManufacturingOrderDetail;
  currentOrderId: string | null;
  hasPersistedOrder: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  saveState: CardSaveState;
  saveMessage: string | null;
  patchHeader: (patch: ManufacturingOrderDraftHeaderPatch) => void;
  selectProduct: (product: ManufacturingProductOption) => void;
  updatePlannedInput: (inputQuantity: string) => void;
  updatePlannedOutput: (outputQuantity: string) => void;
  addIngredient: (ingredient: ManufacturingOrderIngredientDetail) => void;
  updateIngredient: (
    ingredientId: string,
    patch: Partial<Pick<ManufacturingOrderIngredientDetail, "itemId" | "quantityPerUnit">> &
      Partial<ManufacturingOrderIngredientDetail>,
  ) => void;
  removeIngredient: (ingredientId: string) => void;
  reorderIngredients: (ingredientIds: string[]) => void;
  flush: () => Promise<FlushOutcome>;
  refreshFromServer: () => Promise<void>;
};

type ManufacturingOrderPayload = {
  productId: string;
  plannedQuantity: string;
  plannedDate: string | null;
  notes: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  ingredients: Array<{
    itemId: string;
    defaultItemId?: string;
    quantityPerUnit: string;
  }>;
  batchCount?: string;
};

const QUICK_FLUSH_DELAY_MS = 150;
const TEXT_FLUSH_DELAY_MS = 850;

function serializeManufacturingOrder(draft: ManufacturingOrderDetail): {
  payload: ManufacturingOrderPayload;
  pathAliases: Record<string, string>;
} {
  const payloadIngredients = draft.ingredients.filter(
    (ingredient) => ingredient.itemId && Number(ingredient.quantityPerUnit) > 0,
  );
  const pathAliases: Record<string, string> = {};
  payloadIngredients.forEach((ingredient, index) => {
    for (const key of ["itemId", "quantityPerUnit"] as const) {
      pathAliases[`ingredients.${index}.${key}`] =
        `ingredients.${ingredient.id}.${key}`;
    }
  });
  return {
    payload: {
      productId: draft.productId,
      plannedQuantity: draft.plannedQuantity,
      plannedDate: draft.plannedDate,
      notes: draft.notes,
      salesOrderId: draft.salesOrderId,
      salesOrderLineId: draft.salesOrderLineId,
      batchCount:
        draft.manufacturingMode === "batch" && draft.numberOfBatches != null
          ? String(draft.numberOfBatches)
          : undefined,
      ingredients: payloadIngredients.map((ingredient) => ({
        itemId: ingredient.itemId,
        defaultItemId: ingredient.defaultItemId ?? undefined,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
    },
    pathAliases,
  };
}

export function useManufacturingOrderDraftController({
  initialOrder,
  initialDraft,
  queryClient,
  onPersisted,
}: {
  initialOrder: ManufacturingOrderDetail | null;
  initialDraft: ManufacturingOrderDetail;
  queryClient: QueryClient;
  onPersisted?: (id: string) => void;
}): ManufacturingOrderDraftController {
  const [newOrderId] = useState(() => crypto.randomUUID());
  const orderId = initialOrder?.id ?? newOrderId;

  const handleDetail = useCallback(
    (detail: ManufacturingOrderDetail) => {
      queryClient.setQueryData(
        queryKeys.manufacturingOrders.detail(detail.id),
        detail,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.manufacturingOrders.root,
      });
      return detail;
    },
    [queryClient],
  );

  const kernel = useCardKernel<ManufacturingOrderDetail, ManufacturingOrderPayload>({
    entityType: "manufacturing-order",
    id: orderId,
    initialServerDoc: initialOrder,
    makeNewDoc: () => initialDraft,
    collections: { ingredients: { idKey: "id" } },
    schema: updateManufacturingOrderSchema,
    serialize: serializeManufacturingOrder,
    derive: recomputeManufacturingDraft,
    readVersion: (doc) => (doc.version > 0 ? doc.version : null),
    readId: (doc) => doc.id,
    create: async (payload, opts) =>
      handleDetail(
        await apiJson<ManufacturingOrderDetail>("/api/manufacturing-orders", {
          method: "POST",
          body: { ...payload, id: orderId },
          idempotencyKey: opts.idempotencyKey,
          keepalive: opts.keepalive,
          fallbackError: "Failed to save manufacturing order.",
        }),
      ),
    update: async (id, payload, opts) =>
      handleDetail(
        await apiJson<ManufacturingOrderDetail>(
          `/api/manufacturing-orders/${id}`,
          {
            method: "PUT",
            body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
            idempotencyKey: opts.idempotencyKey,
            keepalive: opts.keepalive,
            fallbackError: "Failed to save manufacturing order.",
          },
        ),
      ),
    onCreated: (doc) => {
      onPersisted?.(doc.id);
    },
  });

  const update = kernel.update;
  const flush = kernel.flush;
  const adoptServerDoc = kernel.adoptServerDoc;
  const getPersistedId = kernel.getPersistedId;

  const patchHeader = useCallback(
    (patch: ManufacturingOrderDraftHeaderPatch) => {
      update(
        (draft) => ({ ...draft, ...patch }) as ManufacturingOrderDetail,
        {
          debounceMs: isQuickHeaderPatch(patch)
            ? QUICK_FLUSH_DELAY_MS
            : TEXT_FLUSH_DELAY_MS,
        },
      );
    },
    [update],
  );

  const selectProduct = useCallback(
    (product: ManufacturingProductOption) => {
      if (product.id === kernel.draft.productId && kernel.isPersisted) return;
      update(
        (current) => {
          const inputQuantity = plannedInputValue(current);
          const plannedQuantity =
            resolvePlannedOutputQuantity({
              inputQuantity,
              manufacturingMode: product.manufacturingMode,
              expectedBatchYield: product.expectedBatchYield,
            }) ?? "1";
          const ingredientMultiplier =
            product.manufacturingMode === "batch" ? inputQuantity : plannedQuantity;
          return {
            ...current,
            productId: product.id,
            productName: product.displayName || product.name,
            productSku: product.sku,
            unitName: product.unitName,
            manufacturingMode: product.manufacturingMode,
            expectedBatchYield: product.expectedBatchYield,
            numberOfBatches:
              product.manufacturingMode === "batch"
                ? Number(plannedInputValue(current))
                : null,
            requestedQuantity: plannedQuantity,
            plannedQuantity,
            salesOrderId: null,
            salesOrderLineId: null,
            salesOrderNumber: null,
            salesCustomerName: null,
            ingredients: product.bom.map((ingredient, index) =>
              makeDraftIngredient(ingredient, ingredientMultiplier, index),
            ),
            operationCosts: [],
          };
        },
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [kernel.draft.productId, kernel.isPersisted, update],
  );

  const updatePlannedInput = useCallback(
    (inputQuantity: string) => {
      update(
        (current) => {
          const plannedQuantity =
            resolvePlannedOutputQuantity({
              inputQuantity,
              manufacturingMode: current.manufacturingMode,
              expectedBatchYield: current.expectedBatchYield,
            }) ?? inputQuantity;
          return {
            ...current,
            requestedQuantity: plannedQuantity,
            plannedQuantity,
            numberOfBatches:
              current.manufacturingMode === "batch"
                ? Number(inputQuantity)
                : current.numberOfBatches,
          };
        },
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const updatePlannedOutput = useCallback(
    (outputQuantity: string) => {
      update(
        (current) => {
          const output = Number(outputQuantity);
          const batchCount =
            current.manufacturingMode === "batch"
              ? Math.max(1, Math.round(Number(current.numberOfBatches ?? 1)))
              : null;
          if (!Number.isFinite(output) || output <= 0 || batchCount == null) {
            return current;
          }
          return {
            ...current,
            requestedQuantity: formatDecimal(output),
            plannedQuantity: formatDecimal(output),
            expectedBatchYield: formatDecimal(output / batchCount),
          };
        },
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const addIngredient = useCallback(
    (ingredient: ManufacturingOrderIngredientDetail) => {
      update(
        (current) => ({
          ...current,
          ingredients: [
            ...current.ingredients,
            { ...ingredient, sortOrder: current.ingredients.length },
          ],
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const updateIngredient = useCallback(
    (
      ingredientId: string,
      patch: Partial<Pick<ManufacturingOrderIngredientDetail, "itemId" | "quantityPerUnit">> &
        Partial<ManufacturingOrderIngredientDetail>,
    ) => {
      update(
        (current) => ({
          ...current,
          ingredients: current.ingredients.map((ingredient) =>
            ingredient.id === ingredientId
              ? { ...ingredient, ...patch }
              : ingredient,
          ),
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const removeIngredient = useCallback(
    (ingredientId: string) => {
      update(
        (current) => ({
          ...current,
          ingredients: current.ingredients.filter(
            (ingredient) => ingredient.id !== ingredientId,
          ),
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const reorderIngredients = useCallback(
    (ingredientIds: string[]) => {
      update(
        (current) => {
          const byId = new Map(
            current.ingredients.map((ingredient) => [ingredient.id, ingredient]),
          );
          return {
            ...current,
            ingredients: ingredientIds
              .map((id) => byId.get(id))
              .filter(
                (ingredient): ingredient is ManufacturingOrderIngredientDetail =>
                  ingredient != null,
              ),
          };
        },
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const refreshFromServer = useCallback(async () => {
    const persistedId = getPersistedId();
    if (!persistedId) return;
    const next = await apiJson<ManufacturingOrderDetail>(
      `/api/manufacturing-orders/${persistedId}`,
      { fallbackError: "Failed to load manufacturing order." },
    );
    adoptServerDoc(next);
  }, [adoptServerDoc, getPersistedId]);

  return useMemo(
    () => ({
      draft: kernel.draft,
      currentOrderId: kernel.persistedId,
      hasPersistedOrder: kernel.isPersisted,
      status:
        kernel.status === "blocked"
          ? kernel.isPersisted
            ? "error"
            : "idle"
          : kernel.status === "idle"
            ? kernel.isPersisted
              ? "saved"
              : "idle"
            : kernel.status,
      error: kernel.error,
      saveState: kernel.saveState,
      saveMessage: kernel.saveMessage,
      patchHeader,
      selectProduct,
      updatePlannedInput,
      addIngredient,
      updateIngredient,
      removeIngredient,
      reorderIngredients,
      updatePlannedOutput,
      flush,
      refreshFromServer,
    }),
    [
      addIngredient,
      flush,
      kernel,
      patchHeader,
      refreshFromServer,
      removeIngredient,
      reorderIngredients,
      selectProduct,
      updateIngredient,
      updatePlannedInput,
      updatePlannedOutput,
    ],
  );
}

export function makeDraftManufacturingOrder(): ManufacturingOrderDetail {
  const now = new Date();
  return {
    id: "",
    orderNumber: "",
    productId: "",
    productName: "",
    productSku: null,
    productLotTrackingMode: "tracked",
    outputDispositionLocked: false,
    unitName: "",
    salesOrderId: null,
    salesOrderLineId: null,
    salesOrderNumber: null,
    salesCustomerName: null,
    status: "open",
    isBlocked: false,
    manufacturingMode: "discrete",
    numberOfBatches: null,
    expectedBatchYield: null,
    priorityRank: null,
    requestedQuantity: "1",
    plannedQuantity: "1",
    actualQuantity: null,
    pickProgressStatus: "not_started",
    plannedDate: null,
    actualMaterialCost: null,
    actualOperationsCost: null,
    actualCostPerUnit: null,
    notes: null,
    version: 0,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ingredients: [],
    operationCosts: [],
    batches: [],
    producedLots: [],
  };
}

export function makeDraftIngredient(
  input: {
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
    defaultQuantityPerUnit?: string | null;
    siblingVariants?: ManufacturingOrderIngredientDetail["siblingVariants"];
    alternates?: ManufacturingOrderIngredientDetail["alternates"];
  },
  requirementMultiplier: string,
  sortOrder = 0,
): ManufacturingOrderIngredientDetail {
  const plannedQuantity = multiplyQuantityString(input.quantityPerUnit, requirementMultiplier);
  return {
    id: `draft-${crypto.randomUUID()}`,
    itemId: input.itemId,
    itemName: input.itemName,
    itemSku: input.itemSku,
    itemType: input.itemType,
    lotTrackingMode: "tracked",
    unitName: input.unitName,
    quantityPerUnit: input.quantityPerUnit,
    plannedQuantity,
    lotStrategy: "fifo",
    pickedQuantity: "0",
    remainingQuantity: plannedQuantity,
    pickStatus: "not_picked",
    actualQuantity: null,
    actualCostTotal: null,
    lotAllocations: [],
    sortOrder,
    constraints: [],
    defaultItemId: input.itemId,
    defaultItemName: input.itemName,
    defaultItemSku: input.itemSku,
    defaultUnitName: input.unitName,
    defaultQuantityPerUnit: input.defaultQuantityPerUnit ?? input.quantityPerUnit,
    siblingVariants: input.siblingVariants ?? [],
    alternates: input.alternates ?? [],
  };
}

export function resolvePlannedOutputQuantity({
  inputQuantity,
  manufacturingMode,
  expectedBatchYield,
}: {
  inputQuantity: string;
  manufacturingMode?: string | null;
  expectedBatchYield?: string | null;
}) {
  const quantity = Number(inputQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (manufacturingMode !== "batch") return formatDecimal(quantity);

  const batchCount = Math.round(quantity);
  if (Math.abs(quantity - batchCount) > 0.0001) return null;
  const batchYield = Number(expectedBatchYield);
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  return formatDecimal(batchCount * batchYield);
}

function isQuickHeaderPatch(patch: ManufacturingOrderDraftHeaderPatch) {
  return Object.keys(patch).some((key) => key !== "notes");
}

/**
 * Pure cascade math: planned quantities follow quantityPerUnit × requirement
 * multiplier, and remaining follows planned minus the server-owned picked
 * quantity (so post-pick docs stay truthful through every rebase).
 */
function recomputeManufacturingDraft(order: ManufacturingOrderDetail) {
  const requirementMultiplier = ingredientRequirementMultiplier(order);
  return {
    ...order,
    ingredients: order.ingredients.map((ingredient, index) => {
      const plannedQuantity = multiplyQuantityString(
        ingredient.quantityPerUnit,
        requirementMultiplier,
      );
      const remaining =
        Number(plannedQuantity || 0) - Number(ingredient.pickedQuantity || 0);
      return {
        ...ingredient,
        sortOrder: index,
        plannedQuantity,
        remainingQuantity: formatDecimal(Math.max(remaining, 0)),
      };
    }),
  };
}

export function ingredientRequirementMultiplier(order: Pick<
  ManufacturingOrderDetail,
  "manufacturingMode" | "numberOfBatches" | "plannedQuantity" | "expectedBatchYield" | "requestedQuantity"
>) {
  if (order.manufacturingMode !== "batch") {
    return order.requestedQuantity || order.plannedQuantity || "1";
  }

  if (order.numberOfBatches != null && Number.isFinite(order.numberOfBatches)) {
    return formatDecimal(order.numberOfBatches);
  }

  const plannedQuantity = Number(order.plannedQuantity);
  const batchYield = Number(order.expectedBatchYield);
  if (
    Number.isFinite(plannedQuantity) &&
    plannedQuantity > 0 &&
    Number.isFinite(batchYield) &&
    batchYield > 0
  ) {
    return formatDecimal(plannedQuantity / batchYield);
  }

  return plannedInputValue(order as ManufacturingOrderDetail);
}

function plannedInputValue(order: ManufacturingOrderDetail) {
  return order.manufacturingMode === "batch" && order.numberOfBatches != null
    ? String(order.numberOfBatches)
    : order.requestedQuantity || order.plannedQuantity || "1";
}

export function multiplyQuantityString(left: string, right: string | number) {
  const result = Number(left || 0) * Number(right || 0);
  return Number.isFinite(result) ? formatDecimal(result) : "0";
}

function formatDecimal(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}
