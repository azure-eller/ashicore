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
import { MaterialGeneralInfoTab } from "./tabs/general-info";
import { MaterialUsedInBomsTab } from "./tabs/used-in-boms";
import { MaterialSupplyDetailsTab } from "./tabs/supply-details";
import styles from "@/components/card-page/card-page.module.css";

export type MaterialCardProps = {
  initialItemId: string;
  initialCard: ItemCardDto;
  usedInBoms: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
};

export function MaterialCard({
  initialItemId,
  initialCard,
  usedInBoms,
  unitOptions,
}: MaterialCardProps) {
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
      router.push("/inventory/materials");
    },
  });

  const tabs: CardTab[] = useMemo(
    () => [
      { value: "general", label: "General info" },
      {
        value: "used-in-boms",
        label: "Used in BOMs",
        count: usedInBoms.length || undefined,
      },
      { value: "supply", label: "Supply details" },
    ],
    [usedInBoms.length],
  );

  const visibleVariantCount = card.variants.filter(
    (variant) => variant.deletedAt == null,
  ).length;

  return (
    <div className={styles.sheet}>
      <CardPageHeader
        itemId={initialItemId}
        typeLabel="Material"
        name={card.family.name}
        category={card.family.category}
        variantCount={visibleVariantCount}
        fallbackHref="/inventory/materials"
        onDelete={() => setConfirmDeleteCard(true)}
      />

      <CardTabs
        tabs={tabs}
        defaultTab="general"
        panels={{
          general: (
            <MaterialGeneralInfoTab
              card={card}
              focusItemId={initialItemId}
              unitOptions={unitOptions}
              onOpenConfig={() => setConfigOpen(true)}
              onAddInitialStock={(variant) => setStockDialogVariant(variant)}
            />
          ),
          "used-in-boms": <MaterialUsedInBomsTab usedInBoms={usedInBoms} />,
          supply: (
            <MaterialSupplyDetailsTab card={card} focusItemId={initialItemId} />
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
