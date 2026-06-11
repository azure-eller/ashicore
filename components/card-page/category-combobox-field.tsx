"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { CardField } from "@/components/card-page/card-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { fetchItemCategories } from "@/lib/api/clients/item-cards";
import type { ItemType } from "@/lib/inventory/types";
import styles from "./card-page.module.css";
import { queryKeys } from "@/lib/client/query-keys";

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
  const draftRef = useRef(normalizedValue);
  let draft = draftState.draft;
  if (draftState.source !== normalizedValue) {
    draft = normalizedValue;
    setDraftState({ source: normalizedValue, draft: normalizedValue });
  }
  const inputId = "card-field-category";
  const comboboxId = `${useId()}-categories`;

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.itemCategories.byType(itemType),
    queryFn: () => fetchItemCategories(itemType),
    staleTime: 60_000,
  });

  useEffect(() => {
    draftRef.current = normalizedValue;
  }, [normalizedValue]);

  const options = useMemo(() => {
    const typed = draft.trim();
    const optionSet = new Set(categories);
    if (typed !== "" && !optionSet.has(typed)) {
      optionSet.add(typed);
    }
    return Array.from(optionSet);
  }, [categories, draft]);

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

  function handleDraftChange(next: string) {
    setDraftState({ source: normalizedValue, draft: next });
    draftRef.current = next;
    onChange(toValue(next), Number.POSITIVE_INFINITY);
  }

  return (
    <CardField label={label} htmlFor={inputId}>
      <Combobox
        items={options}
        value={normalizedValue}
        inputValue={draft}
        onInputValueChange={handleDraftChange}
        onValueChange={(nextValue) => {
          const next = nextValue ?? "";
          setDraftState({ source: normalizedValue, draft: next });
          draftRef.current = next;
        }}
        filter={(category, query) =>
          category.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        }
      >
        <ComboboxInput
          id={inputId}
          aria-label={label}
          aria-controls={comboboxId}
          className={styles.underlineControl}
          placeholder={placeholder}
          disabled={disabled}
          onBlur={() => commit(draftRef.current)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <ComboboxContent id={comboboxId} className="bg-[var(--color-surface)] text-[var(--color-ink)]">
          <ComboboxEmpty>No categories found</ComboboxEmpty>
          <ComboboxList>
            {(category: string) => (
              <ComboboxItem key={category} value={category}>
                <span className="min-w-0 truncate">{category}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </CardField>
  );
}
