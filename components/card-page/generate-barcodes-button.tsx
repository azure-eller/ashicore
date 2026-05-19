"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  EndpointNotReadyError,
  getMaxNumericInternalBarcode,
  updateItemCardVariant,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";

export type GenerateBarcodesButtonProps = {
  /** itemId the page is keyed by — used for the mutation key so the header
   * save-status indicator picks this run up alongside other card edits. */
  cardItemId: string;
  variants: ItemCardVariantDto[];
};

/**
 * Fills empty `internalBarcode` on every visible variant with sequential
 * numeric codes starting at `max(existing org-wide numeric barcodes) + 1`.
 * Idempotent — variants that already have a barcode are skipped.
 *
 * v1.1: replace the client-side max+1 walk with a Postgres-sequence endpoint
 * (e.g. `POST /api/items/:variantId/generate-internal-barcode`) backed by
 * `inventory.internal_barcode_seq`. Race window today is small for single-user
 * dev but real under concurrent edits, and the org-wide /api/items fetch is
 * expensive at scale.
 */
export function GenerateBarcodesButton({
  cardItemId,
  variants,
}: GenerateBarcodesButtonProps) {
  const queryClient = useQueryClient();
  const candidates = variants.filter(
    (variant) => variant.deletedAt == null && !variant.internalBarcode,
  );

  const mutation = useMutation({
    mutationKey: ["item-card", cardItemId, "generate-internal-barcodes"],
    mutationFn: async () => {
      if (candidates.length === 0) return { assigned: 0 };
      const startFrom = await getMaxNumericInternalBarcode();
      let cursor = startFrom;
      // Sequential awaits (not Promise.all) — keeps the assignments
      // deterministic and predictable when reviewing assignments.
      for (const variant of candidates) {
        cursor += 1;
        await updateItemCardVariant(variant.id, {
          internalBarcode: String(cursor),
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
        disabled={mutation.isPending || candidates.length === 0}
        title={
          candidates.length === 0
            ? "All variants already have internal barcodes."
            : undefined
        }
      >
        {mutation.isPending
          ? "Assigning…"
          : candidates.length === 0
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
