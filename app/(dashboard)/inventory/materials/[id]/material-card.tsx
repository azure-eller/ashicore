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
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import {
  createItemCard,
  deleteItemCard,
  getItemCard,
  type CreateItemCardInput,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import {
  cardSaveMutationKey,
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import { LotGridTab, type CardLotRow } from "@/components/card-page/lot-grid-tab";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import type { ItemCommitmentSummary } from "@/app/(dashboard)/inventory/commitment-summary";
import { MaterialGeneralInfoTab } from "./tabs/general-info";
import { MaterialUsedInBomsTab } from "./tabs/used-in-boms";
import { MaterialSupplyDetailsTab } from "./tabs/supply-details";
import type { SupplierOption } from "@/app/(dashboard)/purchasing/types";

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
  commitmentSummary?: ItemCommitmentSummary;
};

export function MaterialCard({
  initialItemId,
  initialCard,
  usedInBoms,
  unitOptions,
  supplierOptions,
  initialLots,
  commitmentSummary,
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
  const liveSaveStatus = useEntitySaveStatus("item-card", currentItemId ?? "__draft__");

  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(false);

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", "__draft__", "create"),
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
    mutationKey: ["item-card-action", currentItemId ?? "__draft__", "delete-card"],
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
  const saveState: CardSaveState = isDraft
    ? createMutation.isPending
      ? "saving"
      : createMutation.isError
        ? "failed"
        : "not_saved"
    : saveStateFromEntityStatus(liveSaveStatus.status);

  return (
    <CardPage>
      <CardPageHeader
        eyebrow={card.family.category ? `Material · ${card.family.category}` : "Material"}
        title={isDraft && !card.family.name.trim() ? "New material" : card.family.name}
        meta={
          <span>
            {visibleVariantCount} {visibleVariantCount === 1 ? "variant" : "variants"}
          </span>
        }
        fallbackHref="/inventory/materials"
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
                  label: "Delete material",
                  onClick: () => setConfirmDeleteCard(true),
                  destructive: true,
                },
              ]),
        ]}
      />

      <CardTabs
        tabs={tabs}
        defaultTab={isDraft ? "general" : "used-in-boms"}
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
              onDraftFamilyChange={updateDraftFamily}
              onDraftCommit={commitDraft}
              draftCreatePending={createMutation.isPending}
              commitmentSummary={commitmentSummary}
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
