"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import { useCardSaveStatus } from "@/components/card-page/use-card-save-status";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  cloneItemCard,
  deleteItemCard,
  getItemCard,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import { getAverageIngredientsCost } from "@/lib/inventory/item-card-metrics";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { useItemCardDraftController } from "@/components/card-page/use-item-card-draft-controller";
import { ItemCardFocusProvider } from "@/components/card-page/item-card-focus-context";

export type ProductCardTab = "general" | "recipe" | "production" | "lots";

export type ProductCardProps = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  activeTab?: ProductCardTab;
  lotsCount?: number;
  canAdminInventory?: boolean;
  children?: ReactNode;
};

export function ProductCard({
  initialItemId,
  initialCard,
  unitOptions,
  activeTab,
  lotsCount,
  canAdminInventory = false,
  children,
}: ProductCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusedVariantParam = searchParams.get("variant");
  const [configOpen, setConfigOpen] = useState(false);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState(
    initialCard.variants.some(
      (variant) => variant.id === focusedVariantParam && variant.deletedAt == null,
    )
      ? focusedVariantParam
      : initialItemId,
  );
  const persistedHref = useCallback((id: string) => `/inventory/products/${id}`, []);

  const controller = useItemCardDraftController({
    initialItemId,
    initialCard,
    itemType: "product",
    persistedHref,
    unitOptions,
  });
  const currentItemId = controller.currentItemId;
  useEffect(() => {
    const handlePopState = () => {
      const focusedVariantId = new URL(window.location.href).searchParams.get("variant");
      const match = window.location.pathname.match(/^\/inventory\/products\/([^/]+)/);
      if (focusedVariantId || match?.[1]) {
        setFocusedItemId(focusedVariantId ?? match?.[1] ?? null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
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
  const visibleVariantIds = useMemo(
    () =>
      new Set(
        card.variants
          .filter((variant) => variant.deletedAt == null)
          .map((variant) => variant.id),
      ),
    [card.variants],
  );
  const fallbackFocusItemId =
    currentItemId && visibleVariantIds.has(currentItemId)
      ? currentItemId
      : card.variants.find((variant) => variant.deletedAt == null)?.id ?? currentItemId;
  const focusedVariantParamIsVisible =
    focusedVariantParam != null && visibleVariantIds.has(focusedVariantParam);
  const resolvedFocusedItemId = focusedVariantParamIsVisible
    ? focusedVariantParam
    : focusedItemId && visibleVariantIds.has(focusedItemId)
      ? focusedItemId
      : fallbackFocusItemId;

  if (focusedItemId !== resolvedFocusedItemId) {
    setFocusedItemId(resolvedFocusedItemId);
  }

  useEffect(() => {
    if (!currentItemId) return;
    const variant = searchParams.get("variant");
    if (!variant || visibleVariantIds.has(variant)) return;

    const nextSearch = new URLSearchParams(searchParams.toString());
    nextSearch.delete("variant");
    const query = nextSearch.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    currentItemId,
    pathname,
    router,
    searchParams,
    visibleVariantIds,
  ]);

  useEffect(() => {
    if (!currentItemId) return;
    const legacyTab = searchParams.get("tab");
    if (!legacyTab) return;
    const variant = searchParams.get("variant");
    const variantQuery = variant ? `?variant=${encodeURIComponent(variant)}` : "";
    if (legacyTab === "recipe") {
      router.replace(`/inventory/products/${currentItemId}/recipe${variantQuery}`, {
        scroll: false,
      });
      return;
    }
    if (legacyTab === "operations" || legacyTab === "production") {
      router.replace(`/inventory/products/${currentItemId}/production${variantQuery}`, {
        scroll: false,
      });
      return;
    }
    if (legacyTab === "lots") {
      router.replace(`/inventory/products/${currentItemId}/lots${variantQuery}`, {
        scroll: false,
      });
      return;
    }
    if (legacyTab === "general") {
      router.replace(`/inventory/products/${currentItemId}${variantQuery}`, {
        scroll: false,
      });
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
  const cloneCardMutation = useMutation({
    mutationKey: ["item-card-action", currentItemId ?? "__draft__", "clone-card"],
    mutationFn: () => cloneItemCard(currentItemId as string),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["item-cards"] });
      router.push(productCardHrefForTab(result.itemId, getProductCardTabFromPath(pathname)));
    },
  });

  const tabs: CardTab[] = useMemo(
    () => {
      const tabItemId = currentItemId;
      const variantQuery =
        resolvedFocusedItemId && resolvedFocusedItemId !== currentItemId
          ? `?variant=${encodeURIComponent(resolvedFocusedItemId)}`
          : "";
      const nextTabs: CardTab[] = [
        {
          value: "general",
          label: "General info",
          href: tabItemId ? `/inventory/products/${tabItemId}${variantQuery}` : undefined,
        },
        {
          value: "recipe",
          label: "Recipe",
          href: tabItemId ? `/inventory/products/${tabItemId}/recipe${variantQuery}` : undefined,
          disabled: !currentItemId,
          disabledReason: "Enter a product name first.",
        },
        {
          value: "production",
          label: "Production",
          href: tabItemId
            ? `/inventory/products/${tabItemId}/production${variantQuery}`
            : undefined,
          disabled: !currentItemId,
          disabledReason: "Enter a product name first.",
        },
        {
          value: "lots",
          label: "Lots",
          href: tabItemId ? `/inventory/products/${tabItemId}/lots${variantQuery}` : undefined,
          disabled: !currentItemId,
          disabledReason: "Enter a product name first.",
          count: lotsCount || undefined,
        },
      ];
      return card.family.lotTrackingMode === "tracked"
        ? nextTabs
        : nextTabs.filter((tab) => tab.value !== "lots");
    },
    [card.family.lotTrackingMode, currentItemId, resolvedFocusedItemId, lotsCount],
  );

  const avgIngredientsCost = getAverageIngredientsCost(card);
  const resolvedActiveTab = activeTab ?? getProductCardTabFromPath(pathname);
  const effectiveSaveStatus =
    controller.status === "saving" ||
    actionSaveStatus.status === "saving" ||
    cloneCardMutation.isPending
      ? "saving"
      : controller.status === "error" ||
          actionSaveStatus.status === "error" ||
          cloneCardMutation.isError
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
  const saveMessage =
    controller.error ??
    actionSaveStatus.errorMessage ??
    (cloneCardMutation.error instanceof Error ? cloneCardMutation.error.message : null);

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
                  label: cloneCardMutation.isPending ? "Cloning..." : "Clone product",
                  onClick: () => cloneCardMutation.mutate(),
                  disabled: cloneCardMutation.isPending,
                },
                {
                  label: "Delete product",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]),
        ]}
      />

      <ItemCardFocusProvider
        value={{
          focusedItemId: resolvedFocusedItemId ?? currentItemId,
          setFocusedItemId,
        }}
      >
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
              focusItemId={resolvedFocusedItemId ?? currentItemId}
              unitOptions={unitOptions}
              onOpenConfig={() => setConfigOpen(true)}
              onFamilyChange={controller.patchFamily}
              onFamilyCommit={controller.commitFamily}
              onSellableChange={controller.setSellable}
              onVariantPatch={controller.patchVariant}
              onVariantReorder={controller.reorderVariants}
              onFocusedVariantDeleted={(nextVariantId) => {
                setFocusedItemId(nextVariantId);
                router.replace(`/inventory/products/${nextVariantId}`, { scroll: false });
              }}
              onFlush={controller.flush}
              variantsEnabled={variantsEnabled}
              onVariantsEnabledChange={setVariantsEnabled}
              canAdminInventory={canAdminInventory}
            />
          ) : (
            children
          )}
        </CardTabs>
      </ItemCardFocusProvider>

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

function getProductCardTabFromPath(pathname: string): ProductCardTab {
  if (pathname.endsWith("/recipe")) return "recipe";
  if (pathname.endsWith("/production")) return "production";
  if (pathname.endsWith("/lots")) return "lots";
  return "general";
}

function productCardHrefForTab(itemId: string, tab: ProductCardTab) {
  if (tab === "recipe") return `/inventory/products/${itemId}/recipe`;
  if (tab === "production") return `/inventory/products/${itemId}/production`;
  if (tab === "lots") return `/inventory/products/${itemId}/lots`;
  return `/inventory/products/${itemId}`;
}
