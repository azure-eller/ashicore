"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  type CreateItemCardVariantInput,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import { getAverageIngredientsCost } from "@/lib/inventory/item-card-metrics";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { LotGridTab, type CardLotRow } from "@/components/card-page/lot-grid-tab";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { MaterialGeneralInfoTab } from "./tabs/general-info";
import { MaterialUsedInBomsTab } from "./tabs/used-in-boms";
import { MaterialSupplyDetailsTab } from "./tabs/supply-details";
import type { SupplierOption } from "@/lib/purchasing/types";
import { useItemCardDraftController } from "@/components/card-page/use-item-card-draft-controller";

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
  canAdminInventory?: boolean;
};

export function MaterialCard({
  initialItemId,
  initialCard,
  usedInBoms,
  unitOptions,
  supplierOptions,
  initialLots,
  canAdminInventory = false,
}: MaterialCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const persistedHref = useCallback((id: string) => `/inventory/materials/${id}`, []);

  const controller = useItemCardDraftController({
    initialItemId,
    initialCard,
    itemType: "material",
    persistedHref,
    unitOptions,
  });
  const currentItemId = controller.currentItemId;
  const isDraft = !controller.hasPersistedEntity;
  const { createVariant, mergeServerCard } = controller;
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

  const deleteCardMutation = useDeleteEntity({
    mutationKey: ["item-card-action", currentItemId ?? "__draft__", "delete-card"],
    mutationFn: () => deleteItemCard(currentItemId as string),
    invalidateQueryKeys: [["item-cards"]],
    onDeleted: () => router.push("/inventory/materials"),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete material card?",
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
      router.push(`/inventory/materials/${result.itemId}`);
    },
  });
  const handleCreateVariant = useCallback(
    async (input: CreateItemCardVariantInput) => {
      const result = await createVariant(input);
      if (result) {
        router.replace(`/inventory/materials/${result.itemId}`, { scroll: false });
      }
      return result;
    },
    [createVariant, router],
  );
  const tabs: CardTab[] = useMemo(
    () => {
      const nextTabs: CardTab[] = [
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
      ];
      return card.family.lotTrackingMode === "tracked"
        ? nextTabs
        : nextTabs.filter((tab) => tab.value !== "lots");
    },
    [card.family.lotTrackingMode, currentItemId, initialLots.length, usedInBoms.length],
  );

  const avgIngredientsCost = getAverageIngredientsCost(card);
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
        title={isDraft && !card.family.name.trim() ? "New material" : card.family.name}
        fallbackHref="/inventory/materials"
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
                  label: cloneCardMutation.isPending ? "Cloning..." : "Clone material",
                  onClick: () => cloneCardMutation.mutate(),
                  disabled: cloneCardMutation.isPending,
                },
                {
                  label: "Delete material",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]),
        ]}
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
              onFamilyChange={controller.patchFamily}
              onFamilyCommit={controller.commitFamily}
              onVariantPatch={controller.patchVariant}
              onVariantReorder={controller.reorderVariants}
              onCreateVariant={handleCreateVariant}
              onFocusedVariantDeleted={(nextVariantId) =>
                router.replace(`/inventory/materials/${nextVariantId}`, { scroll: false })
              }
              onFlush={controller.flush}
              variantsEnabled={variantsEnabled}
              onVariantsEnabledChange={setVariantsEnabled}
              canAdminInventory={canAdminInventory}
            />
          ),
          ...(card.family.lotTrackingMode === "tracked"
            ? {
                lots: (
                  <LotGridTab
                    card={card}
                    focusItemId={currentItemId ?? ""}
                    lots={initialLots}
                    unitLabel={card.family.unitName}
                  />
                ),
              }
            : {}),
          "used-in-boms": <MaterialUsedInBomsTab usedInBoms={usedInBoms} />,
          supply: (
            <MaterialSupplyDetailsTab
              card={card}
              unitOptions={unitOptions}
              supplierOptions={supplierOptions}
              onFamilyChange={controller.patchFamily}
              onVariantPatch={controller.patchVariant}
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
