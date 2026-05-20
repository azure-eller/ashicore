"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  EndpointNotReadyError,
  getNextInternalBarcode,
  updateItemCardVariant,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { cardSaveMutationKey } from "./card-save-status";

export type GenerateBarcodesButtonProps = {
  /** itemId the page is keyed by for card-save status. */
  cardItemId: string;
  variants: ItemCardVariantDto[];
  disabled?: boolean;
};

/**
 * Fills empty `internalBarcode` on every visible variant with sequence-backed
 * numeric codes.
 * Idempotent — variants that already have a barcode are skipped.
 */
export function GenerateBarcodesButton({
  cardItemId,
  variants,
  disabled,
}: GenerateBarcodesButtonProps) {
  const queryClient = useQueryClient();
  const visibleVariants = variants.filter((variant) => variant.deletedAt == null);
  const candidates = visibleVariants.filter((variant) => !variant.internalBarcode);
  const hasVariants = visibleVariants.length > 0;

  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", cardItemId, "generate-internal-barcodes"),
    mutationFn: async () => {
      if (candidates.length === 0) return { assigned: 0 };
      // Sequential awaits (not Promise.all) — keeps the assignments
      // deterministic and predictable when reviewing assignments.
      for (const variant of candidates) {
        const barcode = await getNextInternalBarcode();
        await updateItemCardVariant(variant.id, {
          internalBarcode: barcode,
        });
      }
      return { assigned: candidates.length };
    },
    onSettled: () => {
      // Broad invalidation so every card view picks up the new barcodes.
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const errorMessage = mutation.error
    ? mutation.error instanceof EndpointNotReadyError
      ? "Backend endpoint not ready."
      : (mutation.error as Error).message
    : null;

  return (
    <div className="flex flex-col items-end gap-(--space-1)">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={disabled || mutation.isPending || candidates.length === 0}
        title={
          hasVariants && candidates.length === 0
            ? "All variants already have internal barcodes."
            : undefined
        }
      >
        {mutation.isPending
          ? "Assigning…"
          : hasVariants && candidates.length === 0
          ? "Internal barcodes assigned"
          : "Generate internal barcodes"}
      </Button>
      {errorMessage ? (
        <span className="text-[length:var(--text-xs)] text-destructive">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
