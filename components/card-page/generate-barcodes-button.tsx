"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EndpointNotReadyError,
  getNextInternalBarcode,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";

export type GenerateBarcodesButtonProps = {
  variants: ItemCardVariantDto[];
  disabled?: boolean;
  onAssignBarcode: (variantId: string, barcode: string) => void;
  onFlush: () => Promise<unknown>;
};

/**
 * Fills empty `internalBarcode` on every visible variant with sequence-backed
 * numeric codes.
 * Idempotent — variants that already have a barcode are skipped.
 */
export function GenerateBarcodesButton({
  variants,
  disabled,
  onAssignBarcode,
  onFlush,
}: GenerateBarcodesButtonProps) {
  const visibleVariants = variants.filter((variant) => variant.deletedAt == null);
  const candidates = visibleVariants.filter((variant) => !variant.internalBarcode);
  const hasVariants = visibleVariants.length > 0;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const assign = async () => {
    setPending(true);
    setError(null);
    try {
      if (candidates.length === 0) return { assigned: 0 };
      // Sequential awaits (not Promise.all) — keeps the assignments
      // deterministic and predictable when reviewing assignments.
      for (const variant of candidates) {
        const barcode = await getNextInternalBarcode();
        onAssignBarcode(variant.id, barcode);
      }
      await onFlush();
      return { assigned: candidates.length };
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError : new Error("Failed to assign barcodes."));
      return { assigned: 0 };
    } finally {
      setPending(false);
    }
  };

  const errorMessage = error
    ? error instanceof EndpointNotReadyError
      ? "Backend endpoint not ready."
      : error.message
    : null;

  return (
    <div className="flex flex-col items-end gap-(--space-1)">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void assign()}
        disabled={disabled || pending || candidates.length === 0}
        title={
          hasVariants && candidates.length === 0
            ? "All variants already have internal barcodes."
            : undefined
        }
      >
        {pending
          ? "Assigning…"
          : hasVariants && candidates.length === 0
          ? "Internal barcodes assigned"
          : "Generate internal barcodes"}
      </Button>
      {errorMessage ? (
        <span className="text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
