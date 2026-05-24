"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fetchItemCategories } from "@/lib/api/clients/item-cards";
import type { ItemType } from "@/app/(dashboard)/inventory/types";
import styles from "./card-page.module.css";

type CategoryComboboxFieldProps = {
  itemType: ItemType;
  value: string | null;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (category: string | null, delayMs?: number) => void;
  onCommit: (category?: string | null) => void;
};

/**
 * Category picker: choose an existing category for the item type or type a new
 * one. New values are persisted as-is — categories are free-text on the family.
 */
export function CategoryComboboxField({
  itemType,
  value,
  label,
  placeholder,
  disabled,
  onChange,
  onCommit,
}: CategoryComboboxFieldProps) {
  const normalizedValue = value ?? "";
  const [draftState, setDraftState] = useState({
    source: normalizedValue,
    draft: normalizedValue,
  });
  let draft = draftState.draft;
  if (draftState.source !== normalizedValue) {
    draft = normalizedValue;
    setDraftState({ source: normalizedValue, draft: normalizedValue });
  }
  const inputId = "card-field-category";
  const listId = `${useId()}-categories`;

  const { data: categories = [] } = useQuery({
    queryKey: ["item-categories", itemType],
    queryFn: () => fetchItemCategories(itemType),
    staleTime: 60_000,
  });

  function toValue(text: string): string | null {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  }

  function commit(text = draft) {
    if (disabled) return;
    const next = toValue(text);
    if (next === (value ?? null)) {
      onCommit();
      return;
    }
    onCommit(next);
  }

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        aria-label={label}
        className={styles.underlineControl}
        list={listId}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraftState({ source: normalizedValue, draft: next });
          onChange(toValue(next), Number.POSITIVE_INFINITY);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <datalist id={listId}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </Field>
  );
}
