"use client";

import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  copyBomFromVariant,
  copyBomToVariants,
  copyOperationsFromVariant,
  copyOperationsToVariants,
  EndpointNotReadyError,
  type ItemCardVariantDto,
} from "@/lib/api/clients/item-cards";
import { cardSaveMutationKey } from "./card-save-status";

export type CopyScope = "bom" | "operations";
export type CopyDirection = "to" | "from";

export type CopyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: CopyScope;
  direction: CopyDirection;
  activeVariant: ItemCardVariantDto | null;
  siblings: ItemCardVariantDto[];
};

/**
 * Single dialog used for Copy BOM to / from siblings and Copy Operations
 * to / from siblings.
 */
export function CopyDialog({
  open,
  onOpenChange,
  scope,
  direction,
  activeVariant,
  siblings,
}: CopyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {open && activeVariant ? (
          <DialogBody
            onOpenChange={onOpenChange}
            scope={scope}
            direction={direction}
            activeVariant={activeVariant}
            siblings={siblings}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
  scope,
  direction,
  activeVariant,
  siblings,
}: {
  onOpenChange: (open: boolean) => void;
  scope: CopyScope;
  direction: CopyDirection;
  activeVariant: ItemCardVariantDto;
  siblings: ItemCardVariantDto[];
}) {
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
    mutationKey: cardSaveMutationKey("item-card", activeVariant.id, "copy", scope, direction),
    mutationFn: async () => {
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
      void queryClient.invalidateQueries({
        queryKey: ["item-card", activeVariant.familyId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["bom-revisions", activeVariant.id],
      });
      onOpenChange(false);
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
        <Field>
          <FieldLabel>Target variants</FieldLabel>
          {otherVariants.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-muted-foreground">
              No sibling variants available.
            </p>
          ) : (
            <div className="space-y-(--space-2)">
              {otherVariants.map((variant) => (
                <label
                  key={variant.id}
                  className="flex items-center gap-(--space-2) text-[length:var(--text-sm)]"
                >
                  <Checkbox
                    checked={selectedIds.has(variant.id)}
                    onCheckedChange={(checked) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (checked === true) next.add(variant.id);
                        else next.delete(variant.id);
                        return next;
                      });
                    }}
                  />
                  {variant.displayName}
                </label>
              ))}
            </div>
          )}
        </Field>
      ) : (
        <Field>
          <FieldLabel>Source variant</FieldLabel>
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="border border-border h-[var(--height-input-md)] px-(--space-3) bg-background"
          >
            {otherVariants.length === 0 ? <option value="">None available</option> : null}
            {otherVariants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.displayName}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field>
        <FieldLabel>Revision note</FieldLabel>
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>

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
