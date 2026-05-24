"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  deleteItemCard,
  getItemCard,
  type CreateItemCardResult,
  type ItemCardDto,
  createItemCard,
} from "@/lib/api/clients/item-cards";
import {
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";

export type ProductCardTab = "general" | "recipe" | "production" | "lots";

export type ProductCardProps = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  activeTab?: ProductCardTab;
  lotsCount?: number;
  children?: ReactNode;
};

export function ProductCard({
  initialItemId,
  initialCard,
  unitOptions,
  activeTab,
  lotsCount,
  children,
}: ProductCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);

  const engine = useDraftSaveEngine<
    ItemCardDto,
    { type: "patchFamily"; patch: Partial<ItemCardDto["family"]> },
    CreateItemCardResult
  >({
    initialDraft: initialCard,
    initialServerSnapshot: initialItemId ? initialCard : null,
    initialId: initialItemId,
    isSaveable: (draft) =>
      Boolean(draft.family.name.trim()) && Boolean(draft.family.unitDefinitionId),
    applyOp: (draft, op) =>
      op.type === "patchFamily"
        ? { ...draft, family: { ...draft.family, ...op.patch } }
        : draft,
    create: (draft) =>
      createItemCard({
        itemType: "product",
        name: draft.family.name.trim(),
        unitDefinitionId: draft.family.unitDefinitionId,
        category: draft.family.category,
        description: draft.family.description,
      }),
    save: async () => null,
    getResultId: (result) => result.itemId,
    applyPersistedIdentity: (draft, result) =>
      preserveDraftVariantDisplay(draft, result.card),
    mergeServerOwnedFields: (draft, result) =>
      preserveDraftVariantDisplay(draft, result.card),
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/inventory/products/${id}`);
    },
    onResult: (result, draft) => {
      queryClient.setQueryData(["item-card", result.itemId], draft);
      void queryClient.invalidateQueries({ queryKey: ["item-cards"] });
    },
  });
  const currentItemId = engine.currentId;
  const isDraft = !engine.hasPersistedEntity;

  const cardQuery = useQuery({
    queryKey: ["item-card", currentItemId ?? "__draft__"],
    queryFn: () => getItemCard(currentItemId as string),
    initialData: initialCard,
    enabled: !isDraft,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const card = isDraft ? engine.draft : cardQuery.data ?? engine.draft;
  const liveSaveStatus = useEntitySaveStatus("item-card", currentItemId ?? "__draft__");

  useEffect(() => {
    if (!currentItemId) return;
    const legacyTab = searchParams.get("tab");
    if (!legacyTab) return;
    if (legacyTab === "recipe") {
      router.replace(`/inventory/products/${currentItemId}/recipe`, { scroll: false });
      return;
    }
    if (legacyTab === "operations" || legacyTab === "production") {
      router.replace(`/inventory/products/${currentItemId}/production`, { scroll: false });
      return;
    }
    if (legacyTab === "lots") {
      router.replace(`/inventory/products/${currentItemId}/lots`, { scroll: false });
      return;
    }
    if (legacyTab === "general") {
      router.replace(`/inventory/products/${currentItemId}`, { scroll: false });
    }
  }, [currentItemId, router, searchParams]);

  const updateDraftFamily = useCallback((patch: Partial<ItemCardDto["family"]>) => {
    engine.applyLocalOp({ type: "patchFamily", patch }, Number.POSITIVE_INFINITY);
  }, [engine]);

  const commitDraft = useCallback(
    (patch?: Partial<ItemCardDto["family"]>) => {
      if (!isDraft) return;
      if (patch) engine.applyLocalOp({ type: "patchFamily", patch }, Number.POSITIVE_INFINITY);
      void engine.flush().catch(() => undefined);
    },
    [engine, isDraft],
  );

  const deleteCardMutation = useDeleteEntity({
    mutationKey: ["item-card-action", currentItemId ?? "__draft__", "delete-card"],
    mutationFn: () => deleteItemCard(currentItemId as string),
    invalidateQueryKeys: [["item-cards"]],
    onDeleted: () => router.push("/inventory/products"),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete product card?",
    description: (
      <>
        {card.family.name} and all its variants will be removed. This cannot be undone.
      </>
    ),
    confirmLabel: "Delete",
    pendingLabel: "Deleting...",
    mutation: deleteCardMutation,
  });

  const tabs: CardTab[] = useMemo(
    () => [
      {
        value: "general",
        label: "General info",
        href: currentItemId ? `/inventory/products/${currentItemId}` : undefined,
      },
      {
        value: "recipe",
        label: "Recipe",
        href: currentItemId ? `/inventory/products/${currentItemId}/recipe` : undefined,
        disabled: !currentItemId,
        disabledReason: "Enter a product name first.",
      },
      {
        value: "production",
        label: "Production",
        href: currentItemId ? `/inventory/products/${currentItemId}/production` : undefined,
        disabled: !currentItemId,
        disabledReason: "Enter a product name first.",
      },
      {
        value: "lots",
        label: "Lots",
        href: currentItemId ? `/inventory/products/${currentItemId}/lots` : undefined,
        disabled: !currentItemId,
        disabledReason: "Enter a product name first.",
        count: lotsCount || undefined,
      },
    ],
    [currentItemId, lotsCount],
  );

  const avgIngredientsCost = getAverageIngredientsCost(card);
  const resolvedActiveTab = activeTab ?? getProductCardTabFromPath(pathname);
  const saveState: CardSaveState = isDraft
    ? engine.status === "saving"
      ? "saving"
      : engine.status === "error"
        ? "failed"
        : "not_saved"
    : saveStateFromEntityStatus(liveSaveStatus.status);

  return (
    <CardPage>
      <CardPageHeader
        title={isDraft && !card.family.name.trim() ? "New product" : card.family.name}
        fallbackHref="/inventory/products"
        saveState={saveState}
        menuActions={[
          ...(currentItemId
            ? [
                {
                  label: "View inventory activity",
                  href: `/inventory/ledger?itemId=${currentItemId}`,
                },
              ]
            : []),
          ...(isDraft
            ? []
            : [
                {
                  label: "Delete product",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]),
        ]}
      />

      <CardTabs
        tabs={tabs}
        defaultTab="general"
        activeTab={resolvedActiveTab}
        caption={
          avgIngredientsCost == null
            ? "Ingredients · — avg"
            : `Ingredients · ${avgIngredientsCost.toFixed(5)} USD avg`
        }
      >
        {resolvedActiveTab === "general" || isDraft ? (
          <ProductGeneralInfoTab
            card={card}
            focusItemId={currentItemId}
            unitOptions={unitOptions}
            onOpenConfig={() => setConfigOpen(true)}
            onDraftFamilyChange={updateDraftFamily}
            onDraftCommit={commitDraft}
            draftCreatePending={engine.status === "saving"}
          />
        ) : (
          children
        )}
      </CardTabs>

      {isDraft ? null : (
        <>
          <VariantConfigurationDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            card={card}
          />
        </>
      )}

      {deleteConfirm.dialog}
    </CardPage>
  );
}

function getAverageIngredientsCost(card: ItemCardDto) {
  const costs = card.variants
    .filter((variant) => variant.deletedAt == null && variant.ingredientsCost != null)
    .map((variant) => Number(variant.ingredientsCost))
    .filter((value) => Number.isFinite(value));
  if (costs.length === 0) return null;
  return costs.reduce((total, value) => total + value, 0) / costs.length;
}

function getProductCardTabFromPath(pathname: string): ProductCardTab {
  if (pathname.endsWith("/recipe")) return "recipe";
  if (pathname.endsWith("/production")) return "production";
  if (pathname.endsWith("/lots")) return "lots";
  return "general";
}

function preserveDraftVariantDisplay(
  draftCard: ItemCardDto,
  savedCard: ItemCardDto,
): ItemCardDto {
  return {
    ...savedCard,
    options: draftCard.options,
    variants: draftCard.variants,
  };
}
