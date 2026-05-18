"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
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

export type InventoryItemComboboxOption = {
  id: string;
  name: string;
  displayName?: string | null;
  sku?: string | null;
  itemType?: string | null;
  unitName?: string | null;
};

export function inventoryItemSearchText(option: InventoryItemComboboxOption) {
  return [
    option.displayName,
    option.name,
    option.sku,
    option.itemType,
    option.unitName,
  ]
    .filter((part): part is string => part != null && part.trim() !== "")
    .join(" ");
}

export function inventoryItemDisplayText(option: InventoryItemComboboxOption) {
  return option.displayName ?? option.name;
}

function itemTypeLabel(itemType: string) {
  return itemType === "material"
    ? "Material"
    : itemType === "product"
      ? "Product"
      : itemType;
}

export function InventoryItemCombobox<TOption extends InventoryItemComboboxOption>({
  options,
  value,
  onValueChange,
  placeholder,
  emptyMessage,
  inputId,
  inputClassName,
  inputAriaInvalid,
  inputPrimaryFocus = false,
  contentClassName,
  createLinks = [],
  getSearchText = inventoryItemSearchText,
  getDisplayText = inventoryItemDisplayText,
  getSecondaryText,
  renderSecondary,
  showTypeBadge = false,
}: {
  options: TOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder: string;
  emptyMessage: string;
  inputId?: string;
  inputClassName?: string;
  inputAriaInvalid?: boolean;
  inputPrimaryFocus?: boolean;
  contentClassName?: string;
  createLinks?: ComboboxCreateLink[];
  getSearchText?: (option: TOption) => string;
  getDisplayText?: (option: TOption) => string;
  getSecondaryText?: (option: TOption) => string | null;
  renderSecondary?: (option: TOption) => ReactNode;
  showTypeBadge?: boolean;
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
        return option ? getDisplayText(option) : "";
      }}
      filter={(id, query) => {
        const option = optionMap.get(id);
        if (!option) return false;
        return getSearchText(option).toLocaleLowerCase().includes(query.toLocaleLowerCase());
      }}
    >
      <ComboboxInput
        id={inputId}
        aria-invalid={inputAriaInvalid}
        data-editable-line-primary={inputPrimaryFocus ? "" : undefined}
        className={inputClassName}
        placeholder={placeholder}
      />
      <ComboboxContent className={cn("bg-popover text-popover-foreground", contentClassName)}>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => {
            const option = optionMap.get(id);
            const secondary = option ? getSecondaryText?.(option) : null;

            return (
              <ComboboxItem key={id} value={id}>
                <span className="min-w-0">
                  <span className="block truncate">
                    {option?.displayName ?? option?.name ?? id}
                  </span>
                  {option && renderSecondary ? (
                    renderSecondary(option)
                  ) : secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {secondary}
                    </span>
                  ) : null}
                </span>
                {showTypeBadge && option?.itemType ? (
                  <Badge variant="outline" className="ml-auto shrink-0 text-xs">
                    {itemTypeLabel(option.itemType)}
                  </Badge>
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <ComboboxCreateLinks links={createLinks} />
      </ComboboxContent>
    </Combobox>
  );
}
