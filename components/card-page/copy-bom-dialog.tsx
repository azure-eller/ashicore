"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  CardCheckboxField,
  CardField,
  CardSelectField,
  CardTextField,
} from "@/components/card-page/card-field";
import {
  copyBomFromVariant,
  copyBomToVariants,
  copyOperationsFromVariant,
  copyOperationsToVariants,
  EndpointNotReadyError,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { cardSaveMutationKey } from "./card-save-status";
import { queryKeys } from "@/lib/client/query-keys";

export type CopyScope = "bom" | "operations";
export type CopyDirection = "to" | "from";

export type CopyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardItemId: string;
  scope: CopyScope;
  direction: CopyDirection;
  activeVariant: ItemCardVariantDto | null;
  siblings: ItemCardVariantDto[];
  beforeCopy: () => Promise<void>;
};

/**
 * Single dialog used for Copy BOM to / from siblings and Copy Operations
 * to / from siblings.
 */
export function CopyDialog({
  open,
  onOpenChange,
  cardItemId,
  scope,
  direction,
  activeVariant,
  siblings,
  beforeCopy,
}: CopyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {open && activeVariant ? (
          <DialogBody
            onOpenChange={onOpenChange}
            cardItemId={cardItemId}
            scope={scope}
            direction={direction}
            activeVariant={activeVariant}
            siblings={siblings}
            beforeCopy={beforeCopy}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
  cardItemId,
  scope,
  direction,
  activeVariant,
  siblings,
  beforeCopy,
}: {
  onOpenChange: (open: boolean) => void;
  cardItemId: string;
  scope: CopyScope;
  direction: CopyDirection;
  activeVariant: ItemCardVariantDto;
  siblings: ItemCardVariantDto[];
  beforeCopy: () => Promise<void>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const otherVariants = siblings.filter(
    (variant) => variant.deletedAt == null && variant.id !== activeVariant.id,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sourceId, setSourceId] = useState<string>(() => otherVariants[0]?.id ?? "");
  const [note, setNote] = useState<string>(() =>
    `Copied ${scope === "bom" ? "recipe" : "operations"} from ${
      direction === "to" ? activeVariant.displayName : "(source variant)"
    } on ${new Date().toISOString().slice(0, 10)}`,
  );

  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", cardItemId, "copy", scope, direction),
    mutationFn: async () => {
      await beforeCopy();
      if (direction === "to") {
        const targetVariantIds = Array.from(selectedIds);
        if (targetVariantIds.length === 0)
          throw new Error("Select at least one target variant.");
        const input = { targetVariantIds, note: note.trim() || null };
        return scope === "bom"
          ? copyBomToVariants(activeVariant.id, input)
          : copyOperationsToVariants(activeVariant.id, input);
      }
      if (!sourceId) throw new Error("Pick a source variant.");
      const input = { sourceVariantId: sourceId, note: note.trim() || null };
      return scope === "bom"
        ? copyBomFromVariant(activeVariant.id, input)
        : copyOperationsFromVariant(activeVariant.id, input);
    },
    onSuccess: () => {
      const affectedVariantIds =
        direction === "to" ? Array.from(selectedIds) : [activeVariant.id];
      for (const variantId of affectedVariantIds) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.itemCards.detail(variantId) });
        void queryClient.invalidateQueries({ queryKey: scope === "bom" ? queryKeys.productTabs.recipe(variantId) : queryKeys.productTabs.production(variantId) });
      }
      onOpenChange(false);
      router.refresh();
    },
  });

  const errorMessage =
    mutation.error instanceof EndpointNotReadyError
      ? `Pending backend: ${scope === "bom" ? "recipe" : "operations"} copy isn’t shipped yet.`
      : mutation.error
      ? (mutation.error as Error).message
      : null;

  const title =
    direction === "to"
      ? `Copy ${scope === "bom" ? "recipe" : "operations"} to sibling variants`
      : `Copy ${scope === "bom" ? "recipe" : "operations"} from another variant`;
  const canSubmit =
    direction === "to" ? selectedIds.size > 0 : sourceId.trim() !== "";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {direction === "to"
            ? `Source: ${activeVariant.displayName}`
            : `Target: ${activeVariant.displayName}`}
        </DialogDescription>
      </DialogHeader>

      {direction === "to" ? (
        <CardField label="Target variants" controlStyle="dialog">
          {otherVariants.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
              No sibling variants available.
            </p>
          ) : (
            <div className="space-y-(--space-2)">
              {otherVariants.map((variant) => (
                <CardCheckboxField
                  key={variant.id}
                  label={variant.displayName}
                  checked={selectedIds.has(variant.id)}
                  controlStyle="dialog"
                  onCheckedChange={(checked) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(variant.id);
                      else next.delete(variant.id);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}
        </CardField>
      ) : (
        <CardSelectField
          label="Source variant"
          value={sourceId}
          onValueChange={setSourceId}
          controlStyle="dialog"
          disabled={otherVariants.length === 0}
          placeholder="None available"
          options={otherVariants.map((variant) => ({
            value: variant.id,
            label: variant.displayName,
          }))}
        />
      )}

      <CardTextField
        label="Revision note"
        value={note}
        controlStyle="dialog"
        onChange={(event) => setNote(event.target.value)}
      />

      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={mutation.isPending || !canSubmit}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending
            ? "Copying…"
            : direction === "to"
            ? "Copy to selected"
            : "Copy from source"}
        </Button>
      </DialogFooter>
    </>
  );
}
