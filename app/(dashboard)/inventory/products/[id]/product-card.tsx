"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import {
  createItemCard,
  deleteItemCard,
  getItemCard,
  type CreateItemCardInput,
  type ItemCardDto,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { AddInitialStockDialog } from "@/components/card-page/add-initial-stock-dialog";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import styles from "@/components/card-page/card-page.module.css";

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
  activeTab = "general",
  lotsCount,
  children,
}: ProductCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [currentItemId, setCurrentItemId] = useState<string | null>(initialItemId);
  const [draftCard, setDraftCard] = useState<ItemCardDto>(initialCard);
  const isDraft = currentItemId == null;

  const cardQuery = useQuery({
    queryKey: ["item-card", currentItemId ?? "__draft__"],
    queryFn: () => getItemCard(currentItemId as string),
    initialData: initialCard,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const card = isDraft ? draftCard : cardQuery.data ?? draftCard;

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

  const [stockDialogVariant, setStockDialogVariant] = useState<ItemCardVariantDto | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(false);

  const createMutation = useMutation({
    mutationKey: ["item-card", "__draft__", "create"],
    mutationFn: (input: CreateItemCardInput) => createItemCard(input),
    onSuccess: (result) => {
      setCurrentItemId(result.itemId);
      setDraftCard(result.card);
      queryClient.setQueryData(["item-card", result.itemId], result.card);
      void queryClient.invalidateQueries({ queryKey: ["item-cards"] });
      window.history.replaceState(null, "", `/inventory/products/${result.itemId}`);
    },
  });

  const updateDraftFamily = useCallback((patch: Partial<ItemCardDto["family"]>) => {
    setDraftCard((current) => ({
      ...current,
      family: {
        ...current.family,
        ...patch,
      },
    }));
  }, []);

  const commitDraft = useCallback(
    (patch?: Partial<ItemCardDto["family"]>) => {
      if (currentItemId != null || createMutation.isPending || createMutation.isSuccess) {
        return;
      }

      const family = { ...draftCard.family, ...patch };
      const name = family.name.trim();
      if (!name || !family.unitDefinitionId) {
        return;
      }

      createMutation.mutate({
        itemType: "product",
        name,
        unitDefinitionId: family.unitDefinitionId,
        category: family.category,
        description: family.description,
      });
    },
    [createMutation, currentItemId, draftCard.family],
  );

  const deleteCardMutation = useMutation({
    mutationKey: ["item-card", currentItemId ?? "__draft__", "delete-card"],
    mutationFn: () => deleteItemCard(currentItemId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-cards"] });
      router.push("/inventory/products");
    },
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
      },
      {
        value: "production",
        label: "Production",
        href: currentItemId ? `/inventory/products/${currentItemId}/production` : undefined,
      },
      {
        value: "lots",
        label: "Lots",
        href: currentItemId ? `/inventory/products/${currentItemId}/lots` : undefined,
        count: lotsCount || undefined,
      },
    ],
    [currentItemId, lotsCount],
  );

  const visibleVariantCount = card.variants.filter(
    (variant) => variant.deletedAt == null,
  ).length;
  const avgIngredientsCost = getAverageIngredientsCost(card);

  return (
    <div className={styles.sheet}>
      <CardPageHeader
        itemId={currentItemId ?? ""}
        typeLabel="Product"
        name={card.family.name}
        category={card.family.category}
        variantCount={visibleVariantCount}
        fallbackHref="/inventory/products"
        isDraft={isDraft}
        createdAt={card.family.createdAt}
        updatedAt={card.family.updatedAt}
        saveStatus={
          isDraft
            ? createMutation.isPending
              ? "saving"
              : createMutation.isError
                ? "error"
                : "draft"
            : undefined
        }
        onDelete={isDraft ? undefined : () => setConfirmDeleteCard(true)}
      />

      <CardTabs
        tabs={tabs}
        defaultTab="general"
        activeTab={activeTab}
        caption={
          avgIngredientsCost == null
            ? "Ingredients · — avg"
            : `Ingredients · ${avgIngredientsCost.toFixed(5)} USD avg`
        }
      >
        {activeTab === "general" || isDraft ? (
          <ProductGeneralInfoTab
            card={card}
            focusItemId={currentItemId}
            unitOptions={unitOptions}
            onOpenConfig={() => setConfigOpen(true)}
            onAddInitialStock={(variant) => setStockDialogVariant(variant)}
            onDraftFamilyChange={updateDraftFamily}
            onDraftCommit={commitDraft}
            draftCreatePending={createMutation.isPending}
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

          <AddInitialStockDialog
            open={stockDialogVariant != null}
            onOpenChange={(next) => {
              if (!next) setStockDialogVariant(null);
            }}
            variant={stockDialogVariant}
            unitLabel={card.family.unitName ?? undefined}
          />
        </>
      )}

      <AlertDialog open={confirmDeleteCard} onOpenChange={setConfirmDeleteCard}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product card?</AlertDialogTitle>
            <AlertDialogDescription>
              {card.family.name} and all its variants will be removed. This cannot be undone.
              {deleteCardMutation.error ? (
                <span className="block mt-(--space-2) text-destructive">
                  {(deleteCardMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => deleteCardMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                deleteCardMutation.mutate();
              }}
              disabled={deleteCardMutation.isPending}
            >
              {deleteCardMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
