"use client";

import type { ReactNode } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  ComboboxCreateLinks,
  type ComboboxCreateLink,
} from "@/components/combobox-create-links";
import { cn } from "@/lib/utils";

export type EntityComboboxOption = {
  id: string;
  name: string;
  code?: string | null;
  email?: string | null;
};

function defaultEntitySearchText(option: EntityComboboxOption) {
  return [option.name, option.code, option.email]
    .filter((part): part is string => part != null && part.trim() !== "")
    .join(" ");
}

export function EntityCombobox<TOption extends EntityComboboxOption>({
  options,
  value,
  onValueChange,
  placeholder,
  emptyMessage,
  inputId,
  inputClassName,
  inputAriaInvalid,
  contentClassName,
  createLinks = [],
  getSearchText = defaultEntitySearchText,
  renderSecondary,
}: {
  options: TOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder: string;
  emptyMessage: string;
  inputId?: string;
  inputClassName?: string;
  inputAriaInvalid?: boolean;
  contentClassName?: string;
  createLinks?: ComboboxCreateLink[];
  getSearchText?: (option: TOption) => string;
  renderSecondary?: (option: TOption) => ReactNode;
}) {
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));

  return (
    <Combobox
      items={optionIds}
      value={value ?? ""}
      onValueChange={(nextValue) => onValueChange(nextValue ?? null)}
      itemToStringLabel={(id) => {
        const option = optionMap.get(id);
        return option ? getSearchText(option) : "";
      }}
    >
      <ComboboxInput
        id={inputId}
        aria-invalid={inputAriaInvalid}
        className={inputClassName}
        placeholder={placeholder}
      />
      <ComboboxContent className={cn("bg-popover text-popover-foreground", contentClassName)}>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => {
            const option = optionMap.get(id);
            return (
              <ComboboxItem key={id} value={id}>
                <span className="min-w-0 truncate">{option?.name ?? id}</span>
                {option ? renderSecondary?.(option) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <ComboboxCreateLinks links={createLinks} />
      </ComboboxContent>
    </Combobox>
  );
}
