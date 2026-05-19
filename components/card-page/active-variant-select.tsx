"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import type { ItemCardVariantDto } from "@/lib/api/clients/item-cards";

export type ActiveVariantSelectProps = {
  variants: ItemCardVariantDto[];
  value: string;
  onChange: (variantId: string) => void;
  /** Hides the dropdown when the card has only one (or zero) non-deleted variants. */
  hideWhenSingle?: boolean;
  /** Label override; defaults to "Active Variant". */
  label?: string;
  /** Inline (no FieldLabel) for compact usage in toolbars. */
  inline?: boolean;
};

/**
 * Reusable variant picker for Recipe / Operations / Lots / Movements tabs.
 * Single source of truth: the active variant id is owned by the tab parent
 * (URL query param + local state). This component is a controlled select.
 */
export function ActiveVariantSelect({
  variants,
  value,
  onChange,
  hideWhenSingle = false,
  label = "Active Variant",
  inline = false,
}: ActiveVariantSelectProps) {
  const visible = variants.filter((variant) => variant.deletedAt == null);
  if (visible.length === 0) return null;
  if (hideWhenSingle && visible.length === 1) return null;

  const trigger = (
    <SelectTrigger className="w-full md:w-[420px]">
      <SelectValue placeholder="Select a variant" />
    </SelectTrigger>
  );

  const content = (
    <SelectContent>
      {visible.map((variant) => (
        <SelectItem key={variant.id} value={variant.id}>
          {variant.displayName}
        </SelectItem>
      ))}
    </SelectContent>
  );

  if (inline) {
    return (
      <Select value={value} onValueChange={onChange}>
        {trigger}
        {content}
      </Select>
    );
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        {trigger}
        {content}
      </Select>
    </Field>
  );
}
