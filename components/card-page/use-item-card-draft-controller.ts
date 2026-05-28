"use client";

import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createItemCard,
  updateItemCard,
  updateItemCardSellable,
  updateItemCardVariant,
  reorderItemCardVariants,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardInput,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import {
  useDraftSaveEngine,
  type QueuedDraftOp,
} from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { ItemType } from "@/app/(dashboard)/inventory/types";

export type ItemCardDraftOp =
  | { type: "patchFamily"; patch: UpdateItemCardInput }
  | { type: "setSellable"; sellable: boolean }
  | { type: "patchVariant"; variantId: string; patch: UpdateItemCardVariantInput }
  | { type: "reorderVariants"; orderedVariantIds: string[] };

export type ItemCardDraftController = {
  card: ItemCardDto;
  currentItemId: string | null;
  hasPersistedEntity: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  patchFamily: (patch: UpdateItemCardInput, delayMs?: number) => void;
  commitFamily: (patch?: UpdateItemCardInput) => void;
  setSellable: (sellable: boolean) => void;
  patchVariant: (
    variantId: string,
    patch: UpdateItemCardVariantInput,
    delayMs?: number,
  ) => void;
  reorderVariants: (orderedVariantIds: string[]) => void;
  mergeServerCard: (card: ItemCardDto) => void;
  flush: () => Promise<void>;
  resetToSaved: () => void;
};

type UseItemCardDraftControllerConfig = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  itemType: ItemType;
  persistedHref: (id: string) => string;
  unitOptions: Array<{ id: string; name: string }>;
};

type ItemCardSaveResult = {
  itemId: string;
  card: ItemCardDto;
};

export function useItemCardDraftController({
  initialItemId,
  initialCard,
  itemType,
  persistedHref,
  unitOptions,
}: UseItemCardDraftControllerConfig): ItemCardDraftController {
  const queryClient = useQueryClient();
  const fieldRevisionRef = useRef<Record<string, number>>({});
  const unitNameById = useMemo(
    () => new Map(unitOptions.map((unit) => [unit.id, unit.name])),
    [unitOptions],
  );
  const isSaveable = useCallback(
    (draft: ItemCardDto) =>
      Boolean(draft.family.name.trim()) && Boolean(draft.family.unitDefinitionId),
    [],
  );
  const applyOp = useCallback(
    (draft: ItemCardDto, op: ItemCardDraftOp, revision: number) => {
      stampOpRevisions(fieldRevisionRef.current, op, revision);
      return applyItemCardOp(draft, op, unitNameById);
    },
    [unitNameById],
  );
  const create = useCallback(
    async (draft: ItemCardDto) =>
      createItemCard({
        itemType,
        name: draft.family.name.trim(),
        unitDefinitionId: draft.family.unitDefinitionId,
        category: draft.family.category,
        description: draft.family.description,
        defaultSupplierId: itemType === "material" ? draft.family.defaultSupplierId : undefined,
        purchaseUnitDefinitionId:
          itemType === "material" ? draft.family.purchaseUnitDefinitionId : undefined,
        purchaseToStockFactor:
          itemType === "material" ? draft.family.purchaseToStockFactor : undefined,
        lotTrackingMode: draft.family.lotTrackingMode,
      }),
    [itemType],
  );
  const save = useCallback(
    (itemId: string, draft: ItemCardDto, ops: Array<QueuedDraftOp<ItemCardDraftOp>>) =>
      saveItemCardOps(itemId, draft, ops),
    [],
  );
  const getResultId = useCallback((result: ItemCardSaveResult) => result.itemId, []);
  const applyPersistedIdentity = useCallback(
    (draft: ItemCardDto, result: ItemCardSaveResult) =>
      applyItemCardPersistedIdentity(draft, result.card),
    [],
  );
  const mergeServerOwnedFields = useCallback(
    (
      draft: ItemCardDto,
      result: ItemCardSaveResult,
      context: { hasNewerLocalEdits: boolean; saveStartedRevision: number; source: string },
    ) => {
      const next = mergeItemCardServerResult(draft, result.card, fieldRevisionRef.current);
      if (!context.hasNewerLocalEdits && context.source !== "refresh") {
        clearRevisionsThrough(fieldRevisionRef.current, context.saveStartedRevision);
      }
      return next;
    },
    [],
  );
  const onPersisted = useCallback(
    (id: string) => {
      reflectPersistedCardUrlWithoutNavigation(persistedHref(id));
    },
    [persistedHref],
  );
  const onResult = useCallback(
    (result: ItemCardSaveResult, draft: ItemCardDto) => {
      queryClient.setQueryData(["item-card", result.itemId], draft);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["item-cards"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["item-categories", itemType] }),
      ]);
    },
    [itemType, queryClient],
  );
  const getErrorMessage = useCallback(
    (error: unknown) =>
      error instanceof Error ? error.message : "Failed to save item card.",
    [],
  );

  const engine = useDraftSaveEngine<ItemCardDto, ItemCardDraftOp, ItemCardSaveResult>({
    initialDraft: initialCard,
    initialServerSnapshot: initialItemId ? initialCard : null,
    initialId: initialItemId,
    isSaveable,
    applyOp,
    coalesceOps: coalesceItemCardOps,
    create,
    save,
    getResultId,
    applyPersistedIdentity,
    mergeServerOwnedFields,
    onPersisted,
    onResult,
    getErrorMessage,
  });
  const { applyLocalOp, flush, mergeServerResult } = engine;

  return {
    card: engine.draft,
    currentItemId: engine.currentId,
    hasPersistedEntity: engine.hasPersistedEntity,
    status: engine.status,
    error: engine.error,
    patchFamily: useCallback(
      (patch, delayMs = 0) => {
        applyLocalOp({ type: "patchFamily", patch }, delayMs);
      },
      [applyLocalOp],
    ),
    commitFamily: useCallback(
      (patch) => {
        if (patch) applyLocalOp({ type: "patchFamily", patch }, Number.POSITIVE_INFINITY);
        void flush().catch(reportItemCardSaveError);
      },
      [applyLocalOp, flush],
    ),
    setSellable: useCallback(
      (sellable) => {
        applyLocalOp({ type: "setSellable", sellable }, 0);
      },
      [applyLocalOp],
    ),
    patchVariant: useCallback(
      (variantId, patch, delayMs = 0) => {
        applyLocalOp({ type: "patchVariant", variantId, patch }, delayMs);
      },
      [applyLocalOp],
    ),
    reorderVariants: useCallback(
      (orderedVariantIds) => {
        applyLocalOp({ type: "reorderVariants", orderedVariantIds }, 0);
      },
      [applyLocalOp],
    ),
    mergeServerCard: useCallback(
      (card) => {
        const itemId = engine.currentId ?? card.variants[0]?.id ?? card.family.id;
        mergeServerResult({ itemId, card });
      },
      [engine.currentId, mergeServerResult],
    ),
    flush,
    resetToSaved: engine.resetToServer,
  };
}

async function saveItemCardOps(
  itemId: string,
  _draft: ItemCardDto,
  queuedOps: Array<QueuedDraftOp<ItemCardDraftOp>>,
): Promise<ItemCardSaveResult | null> {
  if (queuedOps.length === 0) return null;

  let result: ItemCardSaveResult | null = null;
  const familyPatch: UpdateItemCardInput = {};
  const variantPatches = new Map<string, UpdateItemCardVariantInput>();
  let sellable: boolean | null = null;
  let orderedVariantIds: string[] | null = null;

  for (const { op } of queuedOps) {
    if (op.type === "patchFamily") {
      Object.assign(familyPatch, op.patch);
    } else if (op.type === "setSellable") {
      sellable = op.sellable;
    } else if (op.type === "patchVariant") {
      variantPatches.set(op.variantId, {
        ...(variantPatches.get(op.variantId) ?? {}),
        ...op.patch,
      });
    } else {
      orderedVariantIds = op.orderedVariantIds;
    }
  }

  if (Object.keys(familyPatch).length > 0) {
    result = { itemId, card: await updateItemCard(itemId, familyPatch) };
    removeQueuedOps(queuedOps, (queued) => queued.op.type === "patchFamily");
  }
  if (sellable != null) {
    result = { itemId, card: await updateItemCardSellable(itemId, { sellable }) };
    removeQueuedOps(queuedOps, (queued) => queued.op.type === "setSellable");
  }
  for (const [variantId, patch] of variantPatches) {
    result = { itemId, card: await updateItemCardVariant(variantId, patch) };
    removeQueuedOps(
      queuedOps,
      (queued) => queued.op.type === "patchVariant" && queued.op.variantId === variantId,
    );
  }
  if (orderedVariantIds) {
    result = { itemId, card: await reorderItemCardVariants(itemId, orderedVariantIds) };
    removeQueuedOps(queuedOps, (queued) => queued.op.type === "reorderVariants");
  }

  return result;
}

function removeQueuedOps<TOp>(
  ops: Array<QueuedDraftOp<TOp>>,
  predicate: (queued: QueuedDraftOp<TOp>) => boolean,
) {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    if (predicate(ops[index])) ops.splice(index, 1);
  }
}

function applyItemCardOp(
  draft: ItemCardDto,
  op: ItemCardDraftOp,
  unitNameById: Map<string, string>,
): ItemCardDto {
  if (op.type === "patchFamily") {
    const nextFamily = {
      ...draft.family,
      ...op.patch,
      unitName:
        op.patch.unitDefinitionId != null
          ? unitNameById.get(op.patch.unitDefinitionId) ?? draft.family.unitName
          : draft.family.unitName,
    };
    return { ...draft, family: nextFamily };
  }
  if (op.type === "setSellable") {
    return {
      ...draft,
      variants: draft.variants.map((variant) =>
        variant.deletedAt == null ? { ...variant, sellable: op.sellable } : variant,
      ),
    };
  }
  if (op.type === "patchVariant") {
    return {
      ...draft,
      variants: draft.variants.map((variant) =>
        variant.id === op.variantId
          ? applyVariantPatch(variant, op.patch, draft.options)
          : variant,
      ),
    };
  }

  const sortById = new Map(op.orderedVariantIds.map((id, index) => [id, index]));
  return {
    ...draft,
    variants: [...draft.variants]
      .sort((left, right) => (sortById.get(left.id) ?? 9999) - (sortById.get(right.id) ?? 9999))
      .map((variant, index) => ({ ...variant, sortOrder: index })),
  };
}

function applyVariantPatch(
  variant: ItemCardVariantDto,
  patch: UpdateItemCardVariantInput,
  options: ItemCardDto["options"],
): ItemCardVariantDto {
  const { optionValueIdsByOptionId: optionValueIds, ...scalarPatch } = patch;
  return {
    ...variant,
    ...scalarPatch,
    optionValues:
      optionValueIds === undefined
        ? variant.optionValues
        : variant.optionValues.map((value) => ({
            ...value,
            ...resolveOptionValueDisplay(
              options,
              value.optionId,
              optionValueIds[value.optionId] ?? value.valueId,
            ),
          })),
  };
}

function resolveOptionValueDisplay(
  options: ItemCardDto["options"],
  optionId: string,
  valueId: string,
) {
  const option = options.find((candidate) => candidate.id === optionId);
  const value = option?.values.find((candidate) => candidate.id === valueId);
  return {
    valueId,
    valueLabel: value?.label ?? "",
    valueCode: value?.code ?? "",
    optionDisabledAt: toDateOrNull(option?.disabledAt),
    valueDisabledAt: toDateOrNull(value?.disabledAt),
  };
}

function toDateOrNull(value: Date | string | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function coalesceItemCardOps(
  existing: Array<QueuedDraftOp<ItemCardDraftOp>>,
  next: QueuedDraftOp<ItemCardDraftOp>,
): Array<QueuedDraftOp<ItemCardDraftOp>> {
  if (next.op.type === "patchFamily") {
    const retained = existing.filter((queued) => queued.op.type !== "patchFamily");
    const previous = existing.findLast(
      (queued): queued is QueuedDraftOp<Extract<ItemCardDraftOp, { type: "patchFamily" }>> =>
        queued.op.type === "patchFamily",
    );
    return [
      ...retained,
      previous
        ? {
            op: {
              type: "patchFamily",
              patch: { ...previous.op.patch, ...next.op.patch },
            },
            revision: next.revision,
          }
        : next,
    ];
  }
  if (next.op.type === "setSellable") {
    return [
      ...existing.filter((queued) => queued.op.type !== "setSellable"),
      next,
    ];
  }
  if (next.op.type === "reorderVariants") {
    return [
      ...existing.filter((queued) => queued.op.type !== "reorderVariants"),
      next,
    ];
  }
  if (next.op.type !== "patchVariant") return [...existing, next];
  const nextVariantId = next.op.variantId;
  const retained = existing.filter(
    (queued) => {
      if (queued.op.type !== "patchVariant") return true;
      return queued.op.variantId !== nextVariantId;
    },
  );
  const previous = existing.findLast(
    (queued): queued is QueuedDraftOp<Extract<ItemCardDraftOp, { type: "patchVariant" }>> =>
      queued.op.type === "patchVariant" &&
      queued.op.variantId === nextVariantId,
  );
  if (!previous) return [...retained, next];
  return [
    ...retained,
    {
      op: {
        type: "patchVariant",
        variantId: next.op.variantId,
        patch: { ...previous.op.patch, ...next.op.patch },
      },
      revision: next.revision,
    },
  ];
}

function stampOpRevisions(
  revisions: Record<string, number>,
  op: ItemCardDraftOp,
  revision: number,
) {
  if (op.type === "patchFamily") {
    for (const key of Object.keys(op.patch)) revisions[`family:${key}`] = revision;
    return;
  }
  if (op.type === "setSellable") {
    revisions["variants:*:sellable"] = revision;
    return;
  }
  if (op.type === "patchVariant") {
    for (const key of Object.keys(op.patch)) revisions[`variant:${op.variantId}:${key}`] = revision;
    return;
  }
  revisions["variants:sortOrder"] = revision;
}

function clearRevisionsThrough(revisions: Record<string, number>, revision: number) {
  for (const [key, value] of Object.entries(revisions)) {
    if (value <= revision) delete revisions[key];
  }
}

function mergeItemCardServerResult(
  draft: ItemCardDto,
  server: ItemCardDto,
  revisions: Record<string, number>,
): ItemCardDto {
  const family = { ...server.family };
  for (const key of Object.keys(draft.family) as Array<keyof ItemCardDto["family"]>) {
    if (revisions[`family:${String(key)}`] != null) {
      family[key] = draft.family[key] as never;
    }
  }

  const draftVariants = new Map(draft.variants.map((variant) => [variant.id, variant]));
  const variants = server.variants.map((serverVariant) => {
    const draftVariant = draftVariants.get(serverVariant.id);
    if (!draftVariant) return serverVariant;
    let next = { ...serverVariant };
    for (const key of Object.keys(draftVariant) as Array<keyof ItemCardVariantDto>) {
      if (
        revisions[`variant:${serverVariant.id}:${String(key)}`] != null ||
        (key === "sellable" && revisions["variants:*:sellable"] != null)
      ) {
        next = { ...next, [key]: draftVariant[key] };
      }
    }
    return next;
  });

  if (revisions["variants:sortOrder"] != null) {
    const draftOrder = new Map(draft.variants.map((variant, index) => [variant.id, index]));
    variants.sort(
      (left, right) => (draftOrder.get(left.id) ?? 9999) - (draftOrder.get(right.id) ?? 9999),
    );
  }

  return { ...server, family, variants };
}

function applyItemCardPersistedIdentity(
  draft: ItemCardDto,
  server: ItemCardDto,
): ItemCardDto {
  const family = {
    ...draft.family,
    id: server.family.id,
    createdAt: server.family.createdAt,
    updatedAt: server.family.updatedAt,
  };
  const draftVariants = new Map(draft.variants.map((variant) => [variant.id, variant]));
  const variants = server.variants.map((serverVariant) => ({
    ...serverVariant,
    ...(draftVariants.get(serverVariant.id) ?? {}),
    id: serverVariant.id,
    familyId: serverVariant.familyId,
  }));

  return {
    ...draft,
    family,
    options: server.options,
    variants,
  };
}

function reportItemCardSaveError(error: unknown) {
  console.error("Item card save failed:", error);
}
