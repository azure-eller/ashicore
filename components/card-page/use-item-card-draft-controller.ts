"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createItemCardDoc,
  createItemCardVariant,
  updateItemCardDoc,
  type CreateItemCardResult,
  type CreateItemCardVariantInput,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardDocInput,
  type UpdateItemCardInput,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import { itemCardDocUpdateSchema } from "@/lib/schemas/item-cards";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import type { CardSaveState } from "./card-save-status";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { ItemType } from "@/lib/inventory/types";
import { queryKeys } from "@/lib/client/query-keys";
import { flushSavedCardOrThrow } from "./use-card-entity-actions";
import { normalizeMoney } from "@/lib/format";

export type ItemCardDraftController = {
  card: ItemCardDto;
  currentItemId: string | null;
  hasPersistedEntity: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  saveState: CardSaveState;
  saveMessage: string | null;
  patchFamily: (patch: UpdateItemCardInput, delayMs?: number) => void;
  commitFamily: (patch?: UpdateItemCardInput) => void;
  setSellable: (sellable: boolean) => void;
  patchVariant: (
    variantId: string,
    patch: UpdateItemCardVariantInput,
    delayMs?: number,
  ) => void;
  createVariant: (input: CreateItemCardVariantInput) => Promise<CreateItemCardResult | null>;
  reorderVariants: (orderedVariantIds: string[]) => void;
  mergeServerCard: (card: ItemCardDto) => void;
  flush: () => Promise<FlushOutcome>;
  resetToSaved: () => void;
};

type UseItemCardDraftControllerConfig = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  itemType: ItemType;
  persistedHref: (id: string) => string;
  unitOptions: Array<{ id: string; name: string }>;
};

const VARIANT_PAYLOAD_KEYS = [
  "sku",
  "registeredBarcode",
  "internalBarcode",
  "supplierItemCode",
  "defaultLeadTimeDays",
  "minimumOrderQuantity",
  "defaultSellingPrice",
  "defaultPurchasePrice",
  "sellable",
  "optionValueIdsByOptionId",
] as const;

function serializeItemCard(draft: ItemCardDto): {
  payload: UpdateItemCardDocInput;
  pathAliases: Record<string, string>;
} {
  const activeVariants = draft.variants.filter(
    (variant) => variant.deletedAt == null,
  );
  const pathAliases: Record<string, string> = {};
  const variants = activeVariants.map((variant, index) => {
    for (const key of VARIANT_PAYLOAD_KEYS) {
      pathAliases[`variants.${index}.${key}`] = `variants.${variant.id}.${key}`;
    }
    return {
      id: variant.id,
      sku: variant.sku,
      registeredBarcode: variant.registeredBarcode,
      internalBarcode: variant.internalBarcode,
      supplierItemCode: variant.supplierItemCode,
      defaultLeadTimeDays: variant.defaultLeadTimeDays,
      minimumOrderQuantity: variant.minimumOrderQuantity,
      defaultSellingPrice: variant.defaultSellingPrice,
      defaultPurchasePrice: variant.defaultPurchasePrice,
      sellable: variant.sellable,
      optionValueIdsByOptionId:
        variant.optionValues.length > 0
          ? Object.fromEntries(
              variant.optionValues.map((value) => [value.optionId, value.valueId]),
            )
          : undefined,
    };
  });

  const family = draft.family;
  return {
    payload: {
      family: {
        name: family.name,
        category: family.category,
        description: family.description,
        unitDefinitionId: family.unitDefinitionId,
        ...(family.itemType === "material"
          ? {
              defaultSupplierId: family.defaultSupplierId,
              purchaseUnitDefinitionId: family.purchaseUnitDefinitionId,
              purchaseToStockFactor: family.purchaseToStockFactor,
            }
          : {}),
        salesUnitDefinitionId: family.salesUnitDefinitionId,
        salesToStockFactor: family.salesToStockFactor,
        lotTrackingMode: family.lotTrackingMode,
      },
      variants: variants.length > 0 ? variants : undefined,
      variantOrder:
        activeVariants.length > 0
          ? activeVariants.map((variant) => variant.id)
          : undefined,
    },
    pathAliases,
  };
}

export function useItemCardDraftController({
  initialItemId,
  initialCard,
  itemType,
  persistedHref,
  unitOptions,
}: UseItemCardDraftControllerConfig): ItemCardDraftController {
  const queryClient = useQueryClient();
  const [newItemId] = useState(() => crypto.randomUUID());
  const unitNameById = useMemo(
    () => new Map(unitOptions.map((unit) => [unit.id, unit.name])),
    [unitOptions],
  );

  const kernel = useCardKernel<ItemCardDto, UpdateItemCardDocInput>({
    entityType: "item-card",
    id: initialItemId ?? newItemId,
    initialServerDoc: initialItemId ? initialCard : null,
    makeNewDoc: () => initialCard,
    collections: { variants: { idKey: "id" } },
    schema: itemCardDocUpdateSchema,
    // The doc-update schema is all-optional; the create endpoint is what
    // requires name + unit, so the gate carries those reasons pre-persist.
    createGate: (draft) =>
      !(draft.family.name ?? "").trim()
        ? "Name is required"
        : draft.family.unitDefinitionId
          ? null
          : "Choose a unit to save",
    serialize: serializeItemCard,
    readVersion: (card) => card.family.version ?? null,
    readId: (card) => card.focusedVariantId,
    create: async (payload, opts) => {
      const family = payload.family ?? {};
      const result = await createItemCardDoc(
        {
          itemType,
          name: (family.name ?? "").trim(),
          unitDefinitionId: family.unitDefinitionId ?? "",
          category: family.category,
          description: family.description,
          defaultSupplierId:
            itemType === "material" ? family.defaultSupplierId : undefined,
          purchaseUnitDefinitionId:
            itemType === "material" ? family.purchaseUnitDefinitionId : undefined,
          purchaseToStockFactor:
            itemType === "material" ? family.purchaseToStockFactor : undefined,
          salesUnitDefinitionId: family.salesUnitDefinitionId,
          salesToStockFactor: family.salesToStockFactor,
          lotTrackingMode: family.lotTrackingMode,
        },
        opts,
      );
      return result.card;
    },
    update: (id, payload, opts) => updateItemCardDoc(id, payload, opts),
    onServerDoc: (card) => {
      queryClient.setQueryData(
        queryKeys.itemCards.detail(card.focusedVariantId),
        card,
      );
      for (const variant of card.variants) {
        queryClient.setQueryData(queryKeys.itemCards.detail(variant.id), card);
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.itemCards.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.itemCategories.byType(itemType),
        }),
      ]);
    },
    onCreated: (card) => {
      reflectPersistedCardUrlWithoutNavigation(
        persistedHref(card.focusedVariantId),
      );
    },
  });

  const update = kernel.update;
  const flush = kernel.flush;
  const adoptServerDoc = kernel.adoptServerDoc;
  const getPersistedId = kernel.getPersistedId;

  const patchFamily = useCallback(
    (patch: UpdateItemCardInput, delayMs = 0) => {
      update(
        (draft) => {
          const family = {
            ...draft.family,
            ...patch,
            unitName:
              patch.unitDefinitionId != null
                ? unitNameById.get(patch.unitDefinitionId) ?? draft.family.unitName
                : draft.family.unitName,
          };
          const previousFactor = Number(
            draft.family.salesToStockFactor ?? "1",
          );
          const nextFactor = Number(family.salesToStockFactor ?? "1");
          const previousSellingUnitId =
            draft.family.salesUnitDefinitionId ??
            draft.family.unitDefinitionId;
          const nextSellingUnitId =
            family.salesUnitDefinitionId ?? family.unitDefinitionId;
          const stockingUnitChanged =
            family.unitDefinitionId !== draft.family.unitDefinitionId;
          const factorChanged =
            Number.isFinite(previousFactor) &&
            Number.isFinite(nextFactor) &&
            previousFactor > 0 &&
            nextFactor > 0 &&
            previousFactor !== nextFactor &&
            !(
              stockingUnitChanged &&
              previousSellingUnitId === nextSellingUnitId
            );

          return {
            ...draft,
            family,
            variants: factorChanged
              ? draft.variants.map((variant) => ({
                  ...variant,
                  defaultSellingPrice:
                    variant.defaultSellingPrice == null
                      ? null
                      : normalizeMoney(
                          (Number(variant.defaultSellingPrice) * nextFactor) /
                            previousFactor,
                        ),
                }))
              : draft.variants,
          };
        },
        { debounceMs: delayMs },
      );
    },
    [unitNameById, update],
  );
  return {
    card: kernel.draft,
    currentItemId: kernel.persistedId,
    hasPersistedEntity: kernel.isPersisted,
    status:
      kernel.status === "blocked"
        ? "error"
        : kernel.status === "idle"
          ? kernel.isPersisted
            ? "saved"
            : "idle"
          : kernel.status,
    error: kernel.error,
    saveState: kernel.saveState,
    saveMessage: kernel.saveMessage,
    patchFamily,
    commitFamily: useCallback(
      (patch?: UpdateItemCardInput) => {
        // The kernel's createGate blocks the flush while the draft can't
        // create yet, so committing is safe at any completeness.
        if (patch) patchFamily(patch, Number.POSITIVE_INFINITY);
        void flush();
      },
      [flush, patchFamily],
    ),
    setSellable: useCallback(
      (sellable: boolean) => {
        update((draft) => ({
          ...draft,
          variants: draft.variants.map((variant) =>
            variant.deletedAt == null ? { ...variant, sellable } : variant,
          ),
        }));
      },
      [update],
    ),
    patchVariant: useCallback(
      (variantId, patch, delayMs = 0) => {
        update(
          (draft) => ({
            ...draft,
            variants: draft.variants.map((variant) =>
              variant.id === variantId
                ? applyVariantPatch(variant, patch, draft.options)
                : variant,
            ),
          }),
          { debounceMs: delayMs },
        );
      },
      [update],
    ),
    createVariant: useCallback(
      async (input) => {
        await flushSavedCardOrThrow({
          flush,
          blockedMessage: "Fix the highlighted fields before adding a variant.",
        });
        const sourceItemId = getPersistedId();
        if (!sourceItemId) return null;
        const result = await createItemCardVariant(sourceItemId, input);
        adoptServerDoc(result.card);
        return result;
      },
      [adoptServerDoc, flush, getPersistedId],
    ),
    reorderVariants: useCallback(
      (orderedVariantIds: string[]) => {
        const sortById = new Map(orderedVariantIds.map((id, index) => [id, index]));
        update((draft) => ({
          ...draft,
          variants: [...draft.variants]
            .sort(
              (left, right) =>
                (sortById.get(left.id) ?? 9999) - (sortById.get(right.id) ?? 9999),
            )
            .map((variant, index) => ({ ...variant, sortOrder: index })),
        }));
      },
      [update],
    ),
    mergeServerCard: useCallback(
      (card: ItemCardDto) => {
        adoptServerDoc(card);
      },
      [adoptServerDoc],
    ),
    flush,
    resetToSaved: kernel.resetToServer,
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
