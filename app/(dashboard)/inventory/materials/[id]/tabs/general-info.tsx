"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { CardPageTwoColumn } from "@/components/card-page/card-page-two-column";
import { VariantTable } from "@/components/card-page/variant-table";
import { GenerateBarcodesButton } from "@/components/card-page/generate-barcodes-button";
import styles from "@/components/card-page/card-page.module.css";
import {
  updateItemCard,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";

export type MaterialGeneralInfoTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  onOpenConfig: () => void;
  onAddInitialStock: (variant: ItemCardVariantDto) => void;
};

export function MaterialGeneralInfoTab({
  card,
  focusItemId,
  onOpenConfig,
  onAddInitialStock,
}: MaterialGeneralInfoTabProps) {
  const hasOptions = card.options.some((option) => option.disabledAt == null);
  const visibleVariantCount = card.variants.filter((variant) => variant.deletedAt == null)
    .length;

  return (
    <>
      <section className={styles.section}>
        <CardPageTwoColumn
        left={
          <>
            <EditableFieldText
              focusItemId={focusItemId}
              field="name"
              label="Material name"
              value={card.family.name}
              required
            />
            <EditableFieldText
              focusItemId={focusItemId}
              field="category"
              label="Category"
              value={card.family.category}
              placeholder="Select or create category"
            />
            <EditableFieldTextarea
              focusItemId={focusItemId}
              field="description"
              label="Additional info"
              value={card.family.description}
            />
          </>
        }
        right={
          <>
            <Field>
              <FieldLabel>Unit of measure</FieldLabel>
              <Input value={card.family.unitName ?? ""} disabled />
              <p className="text-[length:var(--text-xs)] text-muted-foreground mt-(--space-1)">
                Unit of measure is fixed after the card is created.
              </p>
            </Field>
          </>
        }
      />

      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>
          Variants
          {hasOptions ? (
            <span className={styles.count}>· {visibleVariantCount} variants</span>
          ) : null}
          <span className={styles.hint} style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="button" variant="outline" size="sm" onClick={onOpenConfig}>
              Open configuration…
            </Button>
            <GenerateBarcodesButton
              cardItemId={focusItemId}
              variants={card.variants}
            />
          </span>
        </h2>

        <VariantTable
          card={card}
          viewMode="material"
          onAddInitialStock={onAddInitialStock}
          addInitialStockEndpointReady={false}
        />
      </section>
    </>
  );
}

type EditableFieldTextProps = {
  focusItemId: string;
  field: keyof UpdateItemCardInput;
  label: string;
  value: string | null;
  placeholder?: string;
  required?: boolean;
};

function EditableFieldText({
  focusItemId,
  field,
  label,
  value,
  placeholder,
  required,
}: EditableFieldTextProps) {
  const [draft, setDraft] = useState(value ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", field],
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId, { [field]: next } as UpdateItemCardInput),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
    },
  });

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          if (next === (value ?? null)) return;
          if (required && next == null) {
            setDraft(value ?? "");
            return;
          }
          mutation.mutate(next);
        }}
        placeholder={placeholder}
        aria-invalid={mutation.isError || undefined}
      />
    </Field>
  );
}

function EditableFieldTextarea({
  focusItemId,
  field,
  label,
  value,
}: Omit<EditableFieldTextProps, "placeholder" | "required">) {
  const [draft, setDraft] = useState(value ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", field],
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId, { [field]: next } as UpdateItemCardInput),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
    },
  });

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          if (next === (value ?? null)) return;
          mutation.mutate(next);
        }}
        aria-invalid={mutation.isError || undefined}
      />
    </Field>
  );
}
