"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CardPage } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardTabs, type CardTab } from "@/components/card-page/card-tabs";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  createItemCard,
  deleteItemCard,
  getItemCard,
  type CreateItemCardResult,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import {
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import { LotGridTab, type CardLotRow } from "@/components/card-page/lot-grid-tab";
import { VariantConfigurationDialog } from "@/components/card-page/variant-configuration-dialog";
import { MaterialGeneralInfoTab } from "./tabs/general-info";
import { MaterialUsedInBomsTab } from "./tabs/used-in-boms";
import { MaterialSupplyDetailsTab } from "./tabs/supply-details";
import type { SupplierOption } from "@/app/(dashboard)/purchasing/types";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";

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
        itemType: "material",
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
      reflectPersistedCardUrlWithoutNavigation(`/inventory/materials/${id}`);
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

  const avgIngredientsCost = getAverageIngredientsCost(card);
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
        title={isDraft && !card.family.name.trim() ? "New material" : card.family.name}
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
              onDraftFamilyChange={updateDraftFamily}
              onDraftCommit={commitDraft}
              draftCreatePending={engine.status === "saving"}
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
