"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export type ProductGeneralInfoTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  onOpenConfig: () => void;
  onAddInitialStock: (variant: ItemCardVariantDto) => void;
};

export function ProductGeneralInfoTab({
  card,
  focusItemId,
  unitOptions,
  onOpenConfig,
  onAddInitialStock,
}: ProductGeneralInfoTabProps) {
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
              label="Product name"
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
              label="Description"
              value={card.family.description}
            />
          </>
        }
        right={
          <>
            <UnitSelectField
              focusItemId={focusItemId}
              currentUnitId={card.family.unitDefinitionId}
              unitOptions={unitOptions}
            />
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
          viewMode="product"
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

type UnitSelectFieldProps = {
  focusItemId: string;
  currentUnitId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
};

function UnitSelectField({
  focusItemId,
  currentUnitId,
  unitOptions,
}: UnitSelectFieldProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", "unitDefinitionId"],
    mutationFn: (next: string) =>
      updateItemCard(focusItemId, { unitDefinitionId: next }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
    },
  });

  return (
    <Field>
      <FieldLabel>Unit of measure</FieldLabel>
      <Select
        value={currentUnitId}
        onValueChange={(value) => {
          if (value !== currentUnitId) mutation.mutate(value);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a unit" />
        </SelectTrigger>
        <SelectContent>
          {unitOptions.map((unit) => (
            <SelectItem key={unit.id} value={unit.id}>
              {unit.name} ({unit.size} {unit.uom})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
