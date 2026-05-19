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
import { MaterialGeneralInfoTab } from "./tabs/general-info";
import { MaterialUsedInBomsTab } from "./tabs/used-in-boms";
import { MaterialSupplyDetailsTab } from "./tabs/supply-details";
import type { SupplierOption } from "@/app/(dashboard)/purchasing/types";
import styles from "@/components/card-page/card-page.module.css";

export type MaterialCardProps = {
  initialItemId: string | null;
  initialCard: ItemCardDto;
  usedInBoms: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  supplierOptions: SupplierOption[];
  initialLots: CardLotRow[];
};

export function MaterialCard({
  initialItemId,
  initialCard,
  usedInBoms,
  unitOptions,
  supplierOptions,
  initialLots,
}: MaterialCardProps) {
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
      window.history.replaceState(null, "", `/inventory/materials/${result.itemId}`);
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
      const name = (family.name ?? "").trim();
      if (!name || !family.unitDefinitionId) {
        return;
      }

      createMutation.mutate({
        itemType: "material",
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
      router.push("/inventory/materials");
    },
  });

  const tabs: CardTab[] = useMemo(
    () => [
      { value: "general", label: "General info" },
      {
        value: "lots",
        label: "Lots",
        count: initialLots.length || undefined,
        disabled: !currentItemId,
        disabledReason: "Enter a material name first.",
      },
      {
        value: "used-in-boms",
        label: "Used in BOMs",
        count: usedInBoms.length || undefined,
        disabled: !currentItemId,
        disabledReason: "Enter a material name first.",
      },
      {
        value: "supply",
        label: "Supply details",
        disabled: !currentItemId,
        disabledReason: "Enter a material name first.",
      },
    ],
    [currentItemId, initialLots.length, usedInBoms.length],
  );

  const visibleVariantCount = card.variants.filter(
    (variant) => variant.deletedAt == null,
  ).length;
  const avgIngredientsCost = getAverageIngredientsCost(card);

  return (
    <div className={styles.sheet}>
      <CardPageHeader
        itemId={currentItemId ?? ""}
        typeLabel="Material"
        name={card.family.name}
        category={card.family.category}
        variantCount={visibleVariantCount}
        fallbackHref="/inventory/materials"
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
        caption={
          avgIngredientsCost == null
            ? "Ingredients · — avg"
            : `Ingredients · ${avgIngredientsCost.toFixed(5)} USD avg`
        }
        panels={{
          general: (
            <MaterialGeneralInfoTab
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
          lots: (
            <LotGridTab
              card={card}
              focusItemId={currentItemId ?? ""}
              lots={initialLots}
              unitLabel={card.family.unitName}
            />
          ),
          "used-in-boms": <MaterialUsedInBomsTab usedInBoms={usedInBoms} />,
          supply: (
            <MaterialSupplyDetailsTab
              card={card}
              focusItemId={currentItemId ?? ""}
              unitOptions={unitOptions}
              supplierOptions={supplierOptions}
            />
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
            <AlertDialogTitle>Delete material card?</AlertDialogTitle>
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
