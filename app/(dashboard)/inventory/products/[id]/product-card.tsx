"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import { useCardSaveStatus } from "@/components/card-page/use-card-save-status";
import {
  runCardAction,
  resolveSavedCardId,
  useCardEntityActions,
} from "@/components/card-page/use-card-entity-actions";
import {
  cloneItemCard,
  deleteItemCard,
  getItemCard,
  type CreateItemCardVariantInput,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import { getAverageIngredientsCost } from "@/lib/inventory/item-card-metrics";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { StockByLocationSection } from "../../stock-by-location-section";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { useItemCardDraftController } from "@/components/card-page/use-item-card-draft-controller";
import { ItemCardProvider } from "@/components/card-page/item-card-focus-context";
import { queryKeys } from "@/lib/client/query-keys";
import type { UnitSelectOption } from "@/components/card-page/unit-select-field";
import { LotDispositionActions } from "../../lot-disposition-actions";

export type ProductCardTab = "general" | "recipe" | "production" | "lots";

export type ProductCardProps = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  unitOptions: UnitSelectOption[];
  activeTab?: ProductCardTab;
  lotsCount?: number;
  canOperateInventory?: boolean;
  canAdminInventory?: boolean;
  lotTrackingLocked?: boolean;
  children?: ReactNode;
};

export function ProductCard({
  initialItemId,
  initialCard,
  unitOptions,
  activeTab,
  lotsCount,
  canOperateInventory = false,
  canAdminInventory = false,
  lotTrackingLocked = false,
  children,
}: ProductCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusedVariantParam = searchParams.get("variant");
  const [configOpen, setConfigOpen] = useState(false);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const [availableUnitOptions, setAvailableUnitOptions] = useState(unitOptions);
  const [focusedItemId, setFocusedItemIdState] = useState<string | null>(
    initialCard.variants.some(
      (variant) => variant.id === focusedVariantParam && variant.deletedAt == null,
    )
      ? focusedVariantParam
      : initialItemId,
  );
  const setFocusedItemId = useCallback((itemId: string | null) => {
    setFocusedItemIdState(itemId);
  }, []);
  const persistedHref = useCallback((id: string) => `/inventory/products/${id}`, []);

  const controller = useItemCardDraftController({
    initialItemId,
    initialCard,
    itemType: "product",
    persistedHref,
    unitOptions: availableUnitOptions,
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
  }, [setFocusedItemId]);
  const isDraft = !controller.hasPersistedEntity;
  const { createVariant, mergeServerCard } = controller;
  const actionSaveStatus = useCardSaveStatus(currentItemId ?? "__draft__");

  const cardQuery = useQuery({
    queryKey: queryKeys.itemCards.detail(currentItemId ?? "__draft__"),
    queryFn: () => getItemCard(currentItemId as string),
    initialData: initialCard,
    enabled: !isDraft,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (isDraft || !cardQuery.data) return;
    const handle = window.setTimeout(() => mergeServerCard(cardQuery.data), 0);
    return () => window.clearTimeout(handle);
  }, [cardQuery.data, isDraft, mergeServerCard]);
  const card = controller.card;
  const renderedCard =
    !isDraft && controller.status === "saved" && cardQuery.data
      ? cardQuery.data
      : card;
  const lotTrackingModeForReachability = !isDraft
    ? (cardQuery.data?.family.lotTrackingMode ?? initialCard.family.lotTrackingMode)
    : renderedCard.family.lotTrackingMode;
  const visibleVariantIds = useMemo(
    () =>
      new Set(
        renderedCard.variants
          .filter((variant) => variant.deletedAt == null)
          .map((variant) => variant.id),
      ),
    [renderedCard.variants],
  );
  const fallbackFocusItemId =
    currentItemId && visibleVariantIds.has(currentItemId)
      ? currentItemId
      : renderedCard.variants.find((variant) => variant.deletedAt == null)?.id ??
        currentItemId;
  const focusedVariantParamIsVisible =
    focusedVariantParam != null && visibleVariantIds.has(focusedVariantParam);
  const resolvedFocusedItemId = focusedVariantParamIsVisible
    ? focusedVariantParam
    : focusedItemId && visibleVariantIds.has(focusedItemId)
      ? focusedItemId
      : fallbackFocusItemId;

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

  const actions = useCardEntityActions({
    entity: "item-card-action",
    getId: () => controller.currentItemId,
    flush: controller.flush,
    invalidateQueryKeys: [queryKeys.itemCards.root],
    delete: {
      label: "Delete product",
      run: (id) => deleteItemCard(id),
      navigateTo: "/inventory/products",
      confirm: {
        title: "Delete product card?",
        description: (
          <>
            {renderedCard.family.name} and all its variants will be removed. This cannot be undone.
          </>
        ),
      },
    },
  });
  const cloneCardMutation = useMutation({
    mutationKey: ["item-card-action", currentItemId ?? "__draft__", "clone-card"],
    mutationFn: async () => {
      const itemId = await resolveSavedCardId({
        flush: controller.flush,
        getId: () => controller.currentItemId,
        missingIdError: "Save the product first.",
      });
      return cloneItemCard(itemId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itemCards.root });
      router.push(productCardHrefForTab(result.itemId, getProductCardTabFromPath(pathname)));
    },
  });
  const handleCreateVariant = useCallback(
    async (input: CreateItemCardVariantInput) => {
      const result = await createVariant(input);
      if (result) setFocusedItemId(result.itemId);
      return result;
    },
    [createVariant, setFocusedItemId],
  );
  const handleBeforeStockAdjustment = useCallback(
    async () => {
      await runCardAction({
        flushPolicy: "requireSaved",
        requiresPersistedId: true,
        flush: controller.flush,
        getId: () => controller.currentItemId,
        missingIdError: "Save the product first.",
        blockedMessage: "Fix the highlighted fields before adjusting stock.",
        run: () => undefined,
      });
    },
    [controller],
  );
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
      return lotTrackingModeForReachability === "tracked"
        ? nextTabs
        : nextTabs.filter((tab) => tab.value !== "lots");
    },
    [lotTrackingModeForReachability, currentItemId, resolvedFocusedItemId, lotsCount],
  );

  const avgIngredientsCost = getAverageIngredientsCost(renderedCard);
  const focusedVariant = renderedCard.variants.find(
    (variant) => variant.id === (resolvedFocusedItemId ?? currentItemId),
  );
  const resolvedActiveTab = activeTab ?? getProductCardTabFromPath(pathname);
  const saveState: CardSaveState =
    actionSaveStatus.status === "saving" || cloneCardMutation.isPending
      ? "saving"
      : actionSaveStatus.status === "error" || cloneCardMutation.isError
        ? "failed"
        : controller.saveState;
  const saveMessage =
    controller.error ??
    actionSaveStatus.errorMessage ??
    (cloneCardMutation.error instanceof Error ? cloneCardMutation.error.message : null) ??
    controller.saveMessage;
  const cardContextValue = useMemo(
    () => ({
      card: renderedCard,
      controller,
      focusedItemId: resolvedFocusedItemId ?? currentItemId,
      setFocusedItemId,
    }),
    [renderedCard, controller, currentItemId, resolvedFocusedItemId, setFocusedItemId],
  );

  return (
    <CardPage>
      <CardPageHeader
        title={
          isDraft && !renderedCard.family.name.trim()
            ? "New product"
            : renderedCard.family.name
        }
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
                ...(actions.deleteAction ? [actions.deleteAction] : []),
              ]),
        ]}
      />

      <ItemCardProvider value={cardContextValue}>
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
            <>
              <ProductGeneralInfoTab
                card={renderedCard}
                focusItemId={resolvedFocusedItemId ?? currentItemId}
                unitOptions={availableUnitOptions}
                onUnitCreated={(unit) =>
                  setAvailableUnitOptions((current) =>
                    current.some((option) => option.id === unit.id)
                      ? current
                      : [...current, unit],
                  )
                }
                onOpenConfig={() => setConfigOpen(true)}
                onFamilyChange={controller.patchFamily}
                onFamilyCommit={controller.commitFamily}
                onSellableChange={controller.setSellable}
                onVariantPatch={controller.patchVariant}
                onVariantReorder={controller.reorderVariants}
                onCreateVariant={handleCreateVariant}
                onBeforeStockAdjustment={handleBeforeStockAdjustment}
                onFocusedVariantDeleted={(nextVariantId) => {
                  setFocusedItemId(nextVariantId);
                  router.replace(`/inventory/products/${nextVariantId}`, { scroll: false });
                }}
                onFlush={controller.flush}
                variantsEnabled={variantsEnabled}
                onVariantsEnabledChange={setVariantsEnabled}
                canAdminInventory={canAdminInventory}
              />
              <StockByLocationSection
                itemId={isDraft ? null : resolvedFocusedItemId ?? currentItemId}
                unitLabel={renderedCard.family.unitName}
              />
              {canOperateInventory &&
              lotTrackingModeForReachability === "untracked" &&
              focusedVariant ? (
                <div className="flex justify-end">
                  <LotDispositionActions
                    key={focusedVariant.id}
                    itemId={focusedVariant.id}
                    balances={focusedVariant.dispositionBalances}
                    locked={lotTrackingLocked}
                  />
                </div>
              ) : null}
            </>
          ) : (
            children
          )}
        </CardTabs>
      </ItemCardProvider>

      {isDraft ? null : (
        <>
          <VariantConfigurationDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            card={renderedCard}
            focusItemId={currentItemId}
            onSaved={(nextCard) =>
              setVariantsEnabled(
                nextCard.options.some((option) => option.disabledAt == null),
              )
            }
          />
        </>
      )}

      {actions.dialogs}
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
