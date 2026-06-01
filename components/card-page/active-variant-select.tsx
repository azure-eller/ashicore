"use client";

import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardField } from "@/components/card-page/card-field";
import type { ItemCardVariantDto } from "@/lib/api/clients/item-cards";
import styles from "./card-page.module.css";

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
  const generatedId = useId();
  const triggerId = `active-variant-${generatedId}`;
  const visible = variants.filter((variant) => variant.deletedAt == null);
  if (visible.length === 0) return null;
  if (hideWhenSingle && visible.length === 1) return null;

  const trigger = (
    <SelectTrigger
      id={inline ? undefined : triggerId}
      className={`${styles.underlineControl} w-full justify-between md:w-[420px]`}
    >
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
    <CardField label={label} htmlFor={triggerId}>
      <Select value={value} onValueChange={onChange}>
        {trigger}
        {content}
      </Select>
    </CardField>
  );
}
