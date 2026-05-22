"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Field, FieldLabel } from "@/components/ui/field";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { setItemCardFamilyQueryData } from "@/components/card-page/item-card-cache";
import {
  updateItemCard,
  type UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";

type DraftItemCardPatch = Partial<UpdateItemCardInput>;

type ItemCardFieldProps = {
  focusItemId: string | null;
  field: keyof UpdateItemCardInput;
  label: string;
  value: string | null;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onDraftFamilyChange: (patch: DraftItemCardPatch) => void;
  onDraftCommit: (patch?: DraftItemCardPatch) => void;
};

export function ItemCardCommitField({
  focusItemId,
  field,
  label,
  value,
  placeholder,
  required,
  disabled,
  autoFocus,
  onDraftFamilyChange,
  onDraftCommit,
}: ItemCardFieldProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? "__draft__", "patch", field),
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId as string, { [field]: next } as UpdateItemCardInput),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId as string, nextCard);
    },
  });

  return (
    <Field data-invalid={mutation.isError}>
      <FieldLabel>{label}</FieldLabel>
      <CommitInput
        label={label}
        autoFocus={autoFocus}
        value={value}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        commitUnchangedValue={focusItemId == null}
        onDraftChange={(next) => {
          if (focusItemId == null) {
            onDraftFamilyChange({ [field]: next } as DraftItemCardPatch);
          }
        }}
        onCommit={(next) => {
          if (focusItemId == null) {
            const patch = { [field]: next } as DraftItemCardPatch;
            onDraftFamilyChange(patch);
            onDraftCommit(patch);
            return;
          }
          if (next === (value ?? null)) return;
          mutation.mutate(next);
        }}
      />
    </Field>
  );
}

export function ItemCardNotesField({
  focusItemId,
  field,
  label,
  value,
  disabled,
  onDraftFamilyChange,
  onDraftCommit,
}: Omit<ItemCardFieldProps, "placeholder" | "required" | "autoFocus">) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? "__draft__", "patch", field),
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId as string, { [field]: next } as UpdateItemCardInput),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId as string, nextCard);
    },
  });

  return (
    <NotesField
      label={label}
      value={value}
      disabled={disabled}
      rows={3}
      commitUnchangedValue={focusItemId == null}
      onDraftChange={(next) => {
        if (focusItemId == null) {
          onDraftFamilyChange({ [field]: next } as DraftItemCardPatch);
        }
      }}
      onCommit={(next) => {
        if (focusItemId == null) {
          const patch = { [field]: next } as DraftItemCardPatch;
          onDraftFamilyChange(patch);
          onDraftCommit(patch);
          return;
        }
        if (next === (value ?? null)) return;
        mutation.mutate(next);
      }}
    />
  );
}
