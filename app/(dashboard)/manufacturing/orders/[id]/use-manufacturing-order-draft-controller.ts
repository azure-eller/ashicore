"use client";

import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  createManufacturingOrder,
  fetchManufacturingOrder,
  patchManufacturingOrder,
  saveManufacturingOrderIngredients,
  type CreateManufacturingOrderInput,
} from "@/lib/api/clients/manufacturing-orders";
import {
  useDraftSaveEngine,
  type DraftServerMergeContext,
  type QueuedDraftOp,
} from "@/lib/hooks/use-draft-save-engine";
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
  patchHeader: (patch: ManufacturingOrderDraftHeaderPatch) => void;
  selectProduct: (product: ManufacturingProductOption) => void;
  updatePlannedInput: (inputQuantity: string) => void;
  addIngredient: (ingredient: ManufacturingOrderIngredientDetail) => void;
  updateIngredient: (
    ingredientId: string,
    patch: Partial<Pick<ManufacturingOrderIngredientDetail, "itemId" | "quantityPerUnit">> &
      Partial<ManufacturingOrderIngredientDetail>,
  ) => void;
  removeIngredient: (ingredientId: string) => void;
  reorderIngredients: (ingredientIds: string[]) => void;
  flush: () => Promise<void>;
  refreshFromServer: () => Promise<void>;
};

type ManufacturingOrderDraftOp =
  | { type: "patchHeader"; patch: ManufacturingOrderDraftHeaderPatch }
  | { type: "selectProduct"; product: ManufacturingProductOption }
  | { type: "updatePlannedInput"; inputQuantity: string; plannedQuantity: string }
  | { type: "addIngredient"; ingredient: ManufacturingOrderIngredientDetail }
  | {
      type: "updateIngredient";
      ingredientId: string;
      patch: Partial<Pick<ManufacturingOrderIngredientDetail, "itemId" | "quantityPerUnit">> &
        Partial<ManufacturingOrderIngredientDetail>;
    }
  | { type: "removeIngredient"; ingredientId: string }
  | { type: "reorderIngredients"; ingredientIds: string[] };

const QUICK_FLUSH_DELAY_MS = 150;
const TEXT_FLUSH_DELAY_MS = 850;

const HEADER_KEYS = [
  "plannedDate",
  "notes",
  "salesOrderId",
  "salesOrderLineId",
  "salesOrderNumber",
  "salesCustomerName",
  "isBlocked",
] as const satisfies ReadonlyArray<keyof ManufacturingOrderDraftHeaderPatch>;

type HeaderKey = (typeof HEADER_KEYS)[number];

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
  const headerRevisionRef = useRef<Partial<Record<HeaderKey, number>>>({});
  const editableSnapshotRevisionRef = useRef(0);

  const applyOp = useCallback(
    (
      current: ManufacturingOrderDetail,
      op: ManufacturingOrderDraftOp,
      revision: number,
    ) => {
      switch (op.type) {
        case "patchHeader":
          for (const key of HEADER_KEYS) {
            if (key in op.patch) headerRevisionRef.current[key] = revision;
          }
          return recomputeManufacturingDraft({
            ...current,
            ...op.patch,
          } as ManufacturingOrderDetail);
        case "selectProduct": {
          editableSnapshotRevisionRef.current = revision;
          const inputQuantity = plannedInputValue(current);
          const plannedQuantity =
            resolvePlannedOutputQuantity({
              inputQuantity,
              manufacturingMode: op.product.manufacturingMode,
              expectedBatchYield: op.product.expectedBatchYield,
            }) ?? "1";
          const ingredientMultiplier =
            op.product.manufacturingMode === "batch" ? inputQuantity : plannedQuantity;
          return recomputeManufacturingDraft({
            ...current,
            productId: op.product.id,
            productName: op.product.displayName || op.product.name,
            productSku: op.product.sku,
            unitName: op.product.unitName,
            manufacturingMode: op.product.manufacturingMode,
            expectedBatchYield: op.product.expectedBatchYield,
            numberOfBatches:
              op.product.manufacturingMode === "batch"
                ? Number(plannedInputValue(current))
                : null,
            requestedQuantity: plannedQuantity,
            plannedQuantity,
            salesOrderId: null,
            salesOrderLineId: null,
            salesOrderNumber: null,
            salesCustomerName: null,
            ingredients: op.product.bom.map((ingredient, index) =>
              makeDraftIngredient(ingredient, ingredientMultiplier, index),
            ),
            operationCosts: [],
          });
        }
        case "updatePlannedInput":
          editableSnapshotRevisionRef.current = revision;
          return recomputeManufacturingDraft({
            ...current,
            requestedQuantity: op.plannedQuantity,
            plannedQuantity: op.plannedQuantity,
            numberOfBatches:
              current.manufacturingMode === "batch"
                ? Number(op.inputQuantity)
                : current.numberOfBatches,
            ingredients: current.ingredients.map((ingredient) => ({
              ...ingredient,
              plannedQuantity: multiplyQuantityString(
                ingredient.quantityPerUnit,
                ingredientRequirementMultiplier({
                  ...current,
                  plannedQuantity: op.plannedQuantity,
                  numberOfBatches:
                    current.manufacturingMode === "batch"
                      ? Number(op.inputQuantity)
                      : current.numberOfBatches,
                }),
              ),
            })),
          });
        case "addIngredient":
          editableSnapshotRevisionRef.current = revision;
          return recomputeManufacturingDraft({
            ...current,
            ingredients: [
              ...current.ingredients,
              {
                ...op.ingredient,
                sortOrder: current.ingredients.length,
                plannedQuantity: multiplyQuantityString(
                  op.ingredient.quantityPerUnit,
                  ingredientRequirementMultiplier(current),
                ),
              },
            ],
          });
        case "updateIngredient":
          editableSnapshotRevisionRef.current = revision;
          return recomputeManufacturingDraft({
            ...current,
            ingredients: current.ingredients.map((ingredient) => {
              if (ingredient.id !== op.ingredientId) return ingredient;
              const next = { ...ingredient, ...op.patch };
              return {
                ...next,
                plannedQuantity: multiplyQuantityString(
                  next.quantityPerUnit,
                  ingredientRequirementMultiplier(current),
                ),
              };
            }),
          });
        case "removeIngredient":
          editableSnapshotRevisionRef.current = revision;
          return recomputeManufacturingDraft({
            ...current,
            ingredients: current.ingredients
              .filter((ingredient) => ingredient.id !== op.ingredientId)
              .map((ingredient, index) => ({ ...ingredient, sortOrder: index })),
          });
        case "reorderIngredients": {
          editableSnapshotRevisionRef.current = revision;
          const byId = new Map(
            current.ingredients.map((ingredient) => [ingredient.id, ingredient]),
          );
          return recomputeManufacturingDraft({
            ...current,
            ingredients: op.ingredientIds
              .map((id, index) => {
                const ingredient = byId.get(id);
                return ingredient ? { ...ingredient, sortOrder: index } : null;
              })
              .filter(
                (ingredient): ingredient is ManufacturingOrderIngredientDetail =>
                  ingredient != null,
              ),
          });
        }
      }
    },
    [],
  );

  const engine = useDraftSaveEngine<
    ManufacturingOrderDetail,
    ManufacturingOrderDraftOp,
    ManufacturingOrderDetail
  >({
    initialDraft: initialOrder ?? initialDraft,
    initialServerSnapshot: initialOrder,
    initialId: initialOrder?.id ?? null,
    isSaveable,
    applyOp,
    create: (draft) => createManufacturingOrder(createPayload(draft)),
    save: async (orderId, draft, ops) => {
      if (ops.length === 0) return null;
      return saveManufacturingOrderOps(orderId, draft, ops);
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      id: draft.id || result.id,
      orderNumber: draft.orderNumber || result.orderNumber,
    }),
    mergeServerOwnedFields: (draft, result, context) =>
      mergeManufacturingServerResult(draft, result, context, {
        headerRevisionRef,
        editableSnapshotRevisionRef,
      }),
    onPersisted,
    onResult: (result, draft) => {
      queryClient.setQueryData(queryKeys.manufacturingOrders.detail(result.id), draft);
      void queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.root });
    },
  });

  const patchHeader = useCallback(
    (patch: ManufacturingOrderDraftHeaderPatch) => {
      engine.applyLocalOp(
        { type: "patchHeader", patch },
        isQuickHeaderPatch(patch) ? QUICK_FLUSH_DELAY_MS : TEXT_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const selectProduct = useCallback(
    (product: ManufacturingProductOption) => {
      if (product.id === engine.draft.productId && engine.currentId != null) return;
      engine.applyLocalOp({ type: "selectProduct", product }, QUICK_FLUSH_DELAY_MS);
    },
    [engine],
  );

  const updatePlannedInput = useCallback(
    (inputQuantity: string) => {
      const plannedQuantity = resolvePlannedOutputQuantity({
        inputQuantity,
        manufacturingMode: engine.draft.manufacturingMode,
        expectedBatchYield: engine.draft.expectedBatchYield,
      }) ?? inputQuantity;
      engine.applyLocalOp(
        { type: "updatePlannedInput", inputQuantity, plannedQuantity },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const addIngredient = useCallback(
    (ingredient: ManufacturingOrderIngredientDetail) => {
      engine.applyLocalOp(
        { type: "addIngredient", ingredient },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const updateIngredient = useCallback(
    (
      ingredientId: string,
      patch: Partial<Pick<ManufacturingOrderIngredientDetail, "itemId" | "quantityPerUnit">> &
        Partial<ManufacturingOrderIngredientDetail>,
    ) => {
      engine.applyLocalOp(
        { type: "updateIngredient", ingredientId, patch },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const removeIngredient = useCallback(
    (ingredientId: string) => {
      engine.applyLocalOp(
        { type: "removeIngredient", ingredientId },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const reorderIngredients = useCallback(
    (ingredientIds: string[]) => {
      engine.applyLocalOp(
        { type: "reorderIngredients", ingredientIds },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const refreshFromServer = useCallback(async () => {
    const orderId = engine.currentId;
    if (!orderId || engine.hasPendingOps()) return;
    const next = await fetchManufacturingOrder(orderId);
    engine.mergeServerResult(next);
  }, [engine]);

  return useMemo(
    () => ({
      draft: engine.draft,
      currentOrderId: engine.currentId,
      hasPersistedOrder: engine.hasPersistedEntity,
      status: engine.status,
      error: engine.error,
      patchHeader,
      selectProduct,
      updatePlannedInput,
      addIngredient,
      updateIngredient,
      removeIngredient,
      reorderIngredients,
      flush: engine.flush,
      refreshFromServer,
    }),
    [
      addIngredient,
      engine,
      patchHeader,
      refreshFromServer,
      removeIngredient,
      reorderIngredients,
      selectProduct,
      updateIngredient,
      updatePlannedInput,
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

async function saveManufacturingOrderOps(
  orderId: string,
  draft: ManufacturingOrderDetail,
  queuedOps: Array<QueuedDraftOp<ManufacturingOrderDraftOp>>,
) {
  let latest: ManufacturingOrderDetail | null = null;
  const structuralOps = queuedOps.filter((queued) => queued.op.type !== "patchHeader");

  if (structuralOps.length > 0) {
    latest = await saveManufacturingOrderIngredients(
      orderId,
      snapshotHeader(draft),
      snapshotIngredients(draft),
    );
    removeQueuedOps(queuedOps, (queued) => queued.op.type !== "patchHeader");
  }

  const headerPatch = persistedHeaderPatch(mergeHeaderPatches(queuedOps));
  if (Object.keys(headerPatch).length > 0) {
    latest = await patchManufacturingOrder(orderId, headerPatch);
    removeQueuedOps(queuedOps, (queued) => queued.op.type === "patchHeader");
  }

  return latest;
}

function isSaveable(order: ManufacturingOrderDetail) {
  return (
    order.productId.trim().length > 0 &&
    resolvePlannedOutputQuantity({
      inputQuantity: plannedInputValue(order),
      manufacturingMode: order.manufacturingMode,
      expectedBatchYield: order.expectedBatchYield,
    }) != null
  );
}

function isQuickHeaderPatch(patch: ManufacturingOrderDraftHeaderPatch) {
  return Object.keys(patch).some((key) => key !== "notes");
}

function persistedHeaderPatch(
  patch: Partial<ManufacturingOrderDraftHeaderPatch>,
): PatchManufacturingOrder {
  const persisted: Partial<PatchManufacturingOrder> = {};
  for (const key of ["plannedDate", "notes", "salesOrderId", "salesOrderLineId", "isBlocked"] as const) {
    if (key in patch) {
      (persisted as Record<string, unknown>)[key] = patch[key];
    }
  }
  return persisted as PatchManufacturingOrder;
}

function snapshotHeader(order: ManufacturingOrderDetail) {
  return {
    productId: order.productId,
    plannedQuantity: order.plannedQuantity,
    plannedDate: order.plannedDate,
    notes: order.notes,
    salesOrderId: order.salesOrderId,
    salesOrderLineId: order.salesOrderLineId,
  };
}

function snapshotIngredients(order: ManufacturingOrderDetail) {
  return order.ingredients
    .filter((ingredient) => ingredient.itemId && Number(ingredient.quantityPerUnit) > 0)
    .map((ingredient) => ({
      itemId: ingredient.itemId,
      quantityPerUnit: ingredient.quantityPerUnit,
    }));
}

function createPayload(order: ManufacturingOrderDetail): CreateManufacturingOrderInput {
  return {
    productId: order.productId,
    plannedQuantity: order.plannedQuantity,
    plannedDate: order.plannedDate,
    notes: order.notes,
    ingredients: snapshotIngredients(order),
  };
}

function mergeManufacturingServerResult(
  draft: ManufacturingOrderDetail,
  server: ManufacturingOrderDetail,
  context: DraftServerMergeContext<ManufacturingOrderDraftOp>,
  refs: {
    headerRevisionRef: RefObject<Partial<Record<HeaderKey, number>>>;
    editableSnapshotRevisionRef: RefObject<number>;
  },
): ManufacturingOrderDetail {
  const savedStructuralOps = context.savedOps.filter(
    (queued) => queued.op.type !== "patchHeader",
  );
  const hasNewerSnapshotEdits =
    refs.editableSnapshotRevisionRef.current > context.saveStartedRevision;
  let next = mergeServerOwnedFields(draft, server);

  if (
    (context.source === "create" || context.source === "save") &&
    savedStructuralOps.length > 0 &&
    !hasNewerSnapshotEdits
  ) {
    next = keepEditableSnapshot(next, {
      ...draft,
      ingredients: server.ingredients,
      operationCosts: server.operationCosts,
    });
  }

  if (context.hasNewerLocalEdits) {
    next = {
      ...next,
      id: draft.id || server.id,
      orderNumber: server.orderNumber,
    };
    for (const key of HEADER_KEYS) {
      const changedAt = refs.headerRevisionRef.current[key] ?? 0;
      if (changedAt > context.saveStartedRevision) {
        (next as unknown as Record<string, unknown>)[key] = draft[key];
      }
    }
    if (hasNewerSnapshotEdits) {
      next = keepEditableSnapshot(next, draft);
    }
  } else if (context.source === "save" && savedStructuralOps.length === 0) {
    next = keepEditableSnapshot(next, draft);
  } else if (context.source === "refresh") {
    next = keepEditableSnapshot(next, draft);
  }

  for (const key of savedHeaderKeys(context.savedOps)) {
    const changedAt = refs.headerRevisionRef.current[key] ?? 0;
    if (changedAt >= context.saveStartedRevision) {
      (next as unknown as Record<string, unknown>)[key] = draft[key];
    }
  }

  return recomputeManufacturingDraft(next);
}

function mergeServerOwnedFields(
  draft: ManufacturingOrderDetail,
  server: ManufacturingOrderDetail,
): ManufacturingOrderDetail {
  return {
    ...draft,
    id: draft.id || server.id,
    orderNumber: server.orderNumber,
    productLotTrackingMode: server.productLotTrackingMode,
    status: server.status,
    isBlocked: server.isBlocked,
    priorityRank: server.priorityRank,
    actualQuantity: server.actualQuantity,
    pickProgressStatus: server.pickProgressStatus,
    actualMaterialCost: server.actualMaterialCost,
    actualOperationsCost: server.actualOperationsCost,
    actualCostPerUnit: server.actualCostPerUnit,
    startedAt: server.startedAt,
    completedAt: server.completedAt,
    cancelledAt: server.cancelledAt,
    deletedAt: server.deletedAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    operationCosts: server.operationCosts,
    batches: server.batches,
    producedLots: server.producedLots,
  };
}

function keepEditableSnapshot(
  base: ManufacturingOrderDetail,
  current: ManufacturingOrderDetail,
) {
  return {
    ...base,
    productId: current.productId,
    productName: current.productName,
    productSku: current.productSku,
    productLotTrackingMode: current.productLotTrackingMode,
    unitName: current.unitName,
    manufacturingMode: current.manufacturingMode,
    numberOfBatches: current.numberOfBatches,
    expectedBatchYield: current.expectedBatchYield,
    requestedQuantity: current.requestedQuantity,
    plannedQuantity: current.plannedQuantity,
    plannedDate: current.plannedDate,
    notes: current.notes,
    salesOrderId: current.salesOrderId,
    salesOrderLineId: current.salesOrderLineId,
    salesOrderNumber: current.salesOrderNumber,
    salesCustomerName: current.salesCustomerName,
    ingredients: current.ingredients,
  };
}

function mergeHeaderPatches(
  ops: Array<QueuedDraftOp<ManufacturingOrderDraftOp>>,
) {
  return ops.reduce<Partial<ManufacturingOrderDraftHeaderPatch>>((patch, queued) => {
    if (queued.op.type !== "patchHeader") return patch;
    return { ...patch, ...queued.op.patch };
  }, {});
}

function savedHeaderKeys(ops: Array<QueuedDraftOp<ManufacturingOrderDraftOp>>) {
  const keys = new Set<HeaderKey>();
  for (const queued of ops) {
    if (queued.op.type !== "patchHeader") continue;
    for (const key of HEADER_KEYS) {
      if (key in queued.op.patch) keys.add(key);
    }
  }
  return keys;
}

function recomputeManufacturingDraft(order: ManufacturingOrderDetail) {
  const requirementMultiplier = ingredientRequirementMultiplier(order);
  return {
    ...order,
    ingredients: order.ingredients.map((ingredient, index) => ({
      ...ingredient,
      sortOrder: index,
      plannedQuantity: multiplyQuantityString(
        ingredient.quantityPerUnit,
        requirementMultiplier,
      ),
      remainingQuantity: multiplyQuantityString(
        ingredient.quantityPerUnit,
        requirementMultiplier,
      ),
    })),
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

function removeQueuedOps<TOp>(
  ops: Array<QueuedDraftOp<TOp>>,
  predicate: (queued: QueuedDraftOp<TOp>) => boolean,
) {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    if (predicate(ops[index])) ops.splice(index, 1);
  }
}
