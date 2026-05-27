"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import { useCardSaveStatus } from "@/components/card-page/use-card-save-status";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  deleteItemCard,
  getItemCard,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { useItemCardDraftController } from "@/components/card-page/use-item-card-draft-controller";

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
  const [configOpen, setConfigOpen] = useState(false);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const persistedHref = useCallback((id: string) => `/inventory/products/${id}`, []);

  const controller = useItemCardDraftController({
    initialItemId,
    initialCard,
    itemType: "product",
    persistedHref,
    unitOptions,
  });
  const currentItemId = controller.currentItemId;
  const isDraft = !controller.hasPersistedEntity;
  const { mergeServerCard } = controller;
  const actionSaveStatus = useCardSaveStatus(currentItemId ?? "__draft__");

  const cardQuery = useQuery({
    queryKey: ["item-card", currentItemId ?? "__draft__"],
    queryFn: () => getItemCard(currentItemId as string),
    initialData: initialCard,
    enabled: !isDraft,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (isDraft || !cardQuery.data) return;
    mergeServerCard(cardQuery.data);
  }, [cardQuery.data, isDraft, mergeServerCard]);
  const card = controller.card;

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
    () => {
      const nextTabs: CardTab[] = [
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
      ];
      return card.family.lotTrackingMode === "tracked"
        ? nextTabs
        : nextTabs.filter((tab) => tab.value !== "lots");
    },
    [card.family.lotTrackingMode, currentItemId, lotsCount],
  );

  const avgIngredientsCost = getAverageIngredientsCost(card);
  const resolvedActiveTab = activeTab ?? getProductCardTabFromPath(pathname);
  const effectiveSaveStatus =
    controller.status === "saving" || actionSaveStatus.status === "saving"
      ? "saving"
      : controller.status === "error" || actionSaveStatus.status === "error"
        ? "error"
        : controller.status;
  const saveState: CardSaveState = isDraft
    ? effectiveSaveStatus === "saving"
      ? "saving"
      : effectiveSaveStatus === "error"
        ? "failed"
        : "not_saved"
    : effectiveSaveStatus === "saving"
      ? "saving"
      : effectiveSaveStatus === "error"
        ? "failed"
        : effectiveSaveStatus === "dirty"
          ? "not_saved"
          : "saved";
  const saveMessage = controller.error ?? actionSaveStatus.errorMessage;

  return (
    <CardPage>
      <CardPageHeader
        title={isDraft && !card.family.name.trim() ? "New product" : card.family.name}
        fallbackHref="/inventory/products"
        saveState={saveState}
        saveMessage={saveMessage}
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
            onFamilyChange={controller.patchFamily}
            onFamilyCommit={controller.commitFamily}
            onSellableChange={controller.setSellable}
            onVariantPatch={controller.patchVariant}
            onVariantReorder={controller.reorderVariants}
            onFlush={controller.flush}
            variantsEnabled={variantsEnabled}
            onVariantsEnabledChange={setVariantsEnabled}
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
            focusItemId={currentItemId}
            onSaved={(nextCard) =>
              setVariantsEnabled(
                nextCard.options.some((option) => option.disabledAt == null),
              )
            }
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
