"use client";

import { useCallback, useMemo, useState } from "react";
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
  createItemCard,
  deleteItemCard,
  getItemCard,
  type CreateItemCardInput,
  type ItemCardDto,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { AddInitialStockDialog } from "@/components/card-page/add-initial-stock-dialog";
import { LotGridTab, type CardLotRow } from "@/components/card-page/lot-grid-tab";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { ProductGeneralInfoTab } from "./tabs/general-info";
import { ProductRecipeTab } from "./tabs/recipe";
import { ProductOperationsTab } from "./tabs/operations";
import styles from "@/components/card-page/card-page.module.css";

type BomPayloadRow = {
  componentId: string | null;
  quantity: string | null;
  consumptionMode?: "per_output_unit" | "per_batch" | "per_group" | null;
  basisOutputQuantity?: string | null;
  batchScalingMode?: "proportional" | "full_batches_only" | null;
  groupRemainderPolicy?: "ask" | "leave_loose" | "create_partial_group" | null;
  minimumLotAgeDays?: string | number | null;
  alternates?: Array<{ itemId: string }>;
};

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

export type ProductCardProps = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  initialBomRows: BomPayloadRow[];
  availableComponents: AvailableComponent[];
  canViewBom: boolean;
  initialLots: CardLotRow[];
};

export function ProductCard({
  initialItemId,
  initialCard,
  unitOptions,
  initialBomRows,
  availableComponents,
  canViewBom,
  initialLots,
}: ProductCardProps) {
  const router = useRouter();
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
      { value: "general", label: "General info" },
      { value: "lots", label: "Lots", count: initialLots.length || undefined },
      { value: "recipe", label: "Product recipe / BOM" },
      { value: "operations", label: "Production operations" },
    ],
    [initialLots.length],
  );

  const visibleVariantCount = card.variants.filter(
    (variant) => variant.deletedAt == null,
  ).length;

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
        panels={{
          general: (
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
          ),
          recipe: (
            <ProductRecipeTab
              card={card}
              focusItemId={currentItemId ?? ""}
              initialBomRows={initialBomRows}
              availableComponents={availableComponents}
              canViewBom={!isDraft && canViewBom}
            />
          ),
          lots: (
            <LotGridTab
              card={card}
              focusItemId={currentItemId ?? ""}
              lots={initialLots}
              unitLabel={card.family.unitName}
            />
          ),
          operations: (
            <ProductOperationsTab card={card} focusItemId={currentItemId ?? ""} />
          ),
        }}
      />

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
