"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { fetchItemCategories, updateItemCard } from "@/lib/api/clients/item-cards";
import type { ItemType } from "@/app/(dashboard)/inventory/types";

type CategoryComboboxFieldProps = {
  focusItemId: string | null;
  itemType: ItemType;
  value: string | null;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onDraftChange: (category: string | null) => void;
  onDraftCommit: (category: string | null) => void;
};

/**
 * Category picker: choose an existing category for the item type or type a new
 * one. New values are persisted as-is — categories are free-text on the family.
 */
export function CategoryComboboxField({
  focusItemId,
  itemType,
  value,
  label,
  placeholder,
  disabled,
  onDraftChange,
  onDraftCommit,
}: CategoryComboboxFieldProps) {
  const [draft, setDraft] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const inputId = "card-field-category";

  const { data: categories = [] } = useQuery({
    queryKey: ["item-categories", itemType],
    queryFn: () => fetchItemCategories(itemType),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? "__draft__", "patch", "category"),
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId as string, { category: next }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
      void queryClient.invalidateQueries({ queryKey: ["item-categories", itemType] });
    },
  });

  function toValue(text: string): string | null {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  }

  function commit() {
    if (disabled) return;
    const next = toValue(draft);
    if (focusItemId == null) {
      onDraftChange(next);
      onDraftCommit(next);
      return;
    }
    if (next === (value ?? null)) return;
    mutation.mutate(next);
  }

  return (
    <Field data-invalid={mutation.isError}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Combobox
        items={categories}
        open={open}
        onOpenChange={setOpen}
        inputValue={draft}
        onInputValueChange={(next) => {
          setDraft(next);
          if (focusItemId == null) onDraftChange(toValue(next));
        }}
        itemToStringLabel={(category: string) => category}
        filter={(category: string, query: string) =>
          category.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        }
      >
        <ComboboxInput
          id={inputId}
          className="w-full"
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={mutation.isError || undefined}
          onBlur={() => {
            // Close the popup on blur so it can't overlay the page; base-ui
            // doesn't close on a programmatic/synthetic blur on its own.
            setOpen(false);
            commit();
          }}
        />
        <ComboboxContent className="bg-popover text-popover-foreground">
          <ComboboxEmpty>No matching categories</ComboboxEmpty>
          <ComboboxList>
            {(category: string) => (
              <ComboboxItem key={category} value={category}>
                {category}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
