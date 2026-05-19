"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  deleteItemCard,
  getItemCard,
  type ItemCardDto,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { AddInitialStockDialog } from "@/components/card-page/add-initial-stock-dialog";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { ProductRecipeTab } from "./tabs/recipe";
import { ProductOperationsTab } from "./tabs/operations";
import styles from "@/components/card-page/card-page.module.css";

export type ProductCardProps = {
  initialItemId: string;
  initialCard: ItemCardDto;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
};

export function ProductCard({
  initialItemId,
  initialCard,
  unitOptions,
}: ProductCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cardQuery = useQuery({
    queryKey: ["item-card", initialItemId],
    queryFn: () => getItemCard(initialItemId),
    initialData: initialCard,
    refetchOnWindowFocus: false,
  });
  const card = cardQuery.data ?? initialCard;

  const [stockDialogVariant, setStockDialogVariant] = useState<ItemCardVariantDto | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(false);

  const deleteCardMutation = useMutation({
    mutationKey: ["item-card", initialItemId, "delete-card"],
    mutationFn: () => deleteItemCard(initialItemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-cards"] });
      router.push("/inventory/products");
    },
  });

  const tabs: CardTab[] = useMemo(
    () => [
      { value: "general", label: "General info" },
      { value: "recipe", label: "Product recipe / BOM" },
      { value: "operations", label: "Production operations" },
    ],
    [],
  );

  const visibleVariantCount = card.variants.filter(
    (variant) => variant.deletedAt == null,
  ).length;

  return (
    <div className={styles.sheet}>
      <CardPageHeader
        itemId={initialItemId}
        typeLabel="Product"
        name={card.family.name}
        category={card.family.category}
        variantCount={visibleVariantCount}
        fallbackHref="/inventory/products"
        onDelete={() => setConfirmDeleteCard(true)}
      />

      <CardTabs
        tabs={tabs}
        defaultTab="general"
        panels={{
          general: (
            <ProductGeneralInfoTab
              card={card}
              focusItemId={initialItemId}
              unitOptions={unitOptions}
              onOpenConfig={() => setConfigOpen(true)}
              onAddInitialStock={(variant) => setStockDialogVariant(variant)}
            />
          ),
          recipe: (
            <ProductRecipeTab card={card} focusItemId={initialItemId} />
          ),
          operations: (
            <ProductOperationsTab card={card} focusItemId={initialItemId} />
          ),
        }}
      />

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
