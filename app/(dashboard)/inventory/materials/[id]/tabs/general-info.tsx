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

type DraftFamilyPatch = Partial<
  Pick<ItemCardDto["family"], "name" | "category" | "description" | "unitDefinitionId">
>;

export type MaterialGeneralInfoTabProps = {
  card: ItemCardDto;
  /** Null on the /new draft page; the name input bootstraps creation. */
  focusItemId: string | null;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  onOpenConfig: () => void;
  onAddInitialStock: (variant: ItemCardVariantDto) => void;
  onDraftFamilyChange: (patch: DraftFamilyPatch) => void;
  onDraftCommit: (patch?: DraftFamilyPatch) => void;
  draftCreatePending?: boolean;
};

export function MaterialGeneralInfoTab({
  card,
  focusItemId,
  unitOptions,
  onOpenConfig,
  onAddInitialStock,
  onDraftFamilyChange,
  onDraftCommit,
  draftCreatePending,
}: MaterialGeneralInfoTabProps) {
  const hasOptions = card.options.some((option) => option.disabledAt == null);
  const visibleVariantCount = card.variants.filter((variant) => variant.deletedAt == null)
    .length;
  const isDraft = focusItemId == null;

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
              onDraftFamilyChange={onDraftFamilyChange}
              onDraftCommit={onDraftCommit}
              disabled={draftCreatePending}
            />
            <EditableFieldText
              focusItemId={focusItemId}
              field="category"
              label="Category"
              value={card.family.category}
              placeholder="Select or create category"
              onDraftFamilyChange={onDraftFamilyChange}
              onDraftCommit={onDraftCommit}
              disabled={draftCreatePending}
            />
            <EditableFieldTextarea
              focusItemId={focusItemId}
              field="description"
              label="Additional info"
              value={card.family.description}
              onDraftFamilyChange={onDraftFamilyChange}
              onDraftCommit={onDraftCommit}
              disabled={draftCreatePending}
            />
          </>
        }
        right={
          <>
            <MaterialUnitSelectField
              focusItemId={focusItemId}
              currentUnitId={card.family.unitDefinitionId}
              unitOptions={unitOptions}
              onDraftFamilyChange={onDraftFamilyChange}
              onDraftCommit={onDraftCommit}
              disabled={draftCreatePending}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenConfig}
              disabled={isDraft}
            >
              Open configuration…
            </Button>
            <GenerateBarcodesButton
              cardItemId={focusItemId ?? ""}
              variants={card.variants}
              disabled={isDraft}
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
  focusItemId: string | null;
  field: keyof UpdateItemCardInput;
  label: string;
  value: string | null;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  onDraftFamilyChange: (patch: DraftFamilyPatch) => void;
  onDraftCommit: (patch?: DraftFamilyPatch) => void;
};

function EditableFieldText({
  focusItemId,
  field,
  label,
  value,
  placeholder,
  required,
  disabled,
  onDraftFamilyChange,
  onDraftCommit,
}: EditableFieldTextProps) {
  const [draft, setDraft] = useState(value ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", field],
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId as string, { [field]: next } as UpdateItemCardInput),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", focusItemId] });
    },
  });

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        autoFocus={focusItemId == null && field === "name"}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (focusItemId == null) {
            onDraftFamilyChange({ [field]: next } as DraftFamilyPatch);
          }
        }}
        onBlur={() => {
          if (disabled) return;
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          if (focusItemId == null) {
            const patch = { [field]: next } as DraftFamilyPatch;
            onDraftFamilyChange(patch);
            onDraftCommit(patch);
            return;
          }
          if (next === (value ?? null)) return;
          if (required && next == null) {
            setDraft(value ?? "");
            return;
          }
          mutation.mutate(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
        placeholder={placeholder}
        disabled={disabled}
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
  disabled,
  onDraftFamilyChange,
  onDraftCommit,
}: Omit<EditableFieldTextProps, "placeholder" | "required">) {
  const [draft, setDraft] = useState(value ?? "");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", field],
    mutationFn: (next: string | null) =>
      updateItemCard(focusItemId as string, { [field]: next } as UpdateItemCardInput),
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
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (focusItemId == null) {
            onDraftFamilyChange({ [field]: next } as DraftFamilyPatch);
          }
        }}
        onBlur={() => {
          if (disabled) return;
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          if (focusItemId == null) {
            const patch = { [field]: next } as DraftFamilyPatch;
            onDraftFamilyChange(patch);
            onDraftCommit(patch);
            return;
          }
          if (next === (value ?? null)) return;
          mutation.mutate(next);
        }}
        disabled={disabled}
        aria-invalid={mutation.isError || undefined}
      />
    </Field>
  );
}

function MaterialUnitSelectField({
  focusItemId,
  currentUnitId,
  unitOptions,
  disabled,
  onDraftFamilyChange,
  onDraftCommit,
}: {
  focusItemId: string | null;
  currentUnitId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  disabled?: boolean;
  onDraftFamilyChange: (patch: DraftFamilyPatch) => void;
  onDraftCommit: (patch?: DraftFamilyPatch) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["item-card", focusItemId, "patch", "unitDefinitionId"],
    mutationFn: (next: string) =>
      updateItemCard(focusItemId as string, { unitDefinitionId: next }),
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
          if (disabled) return;
          if (focusItemId == null) {
            const patch = { unitDefinitionId: value };
            onDraftFamilyChange(patch);
            onDraftCommit(patch);
            return;
          }
          if (value !== currentUnitId) mutation.mutate(value);
        }}
        disabled={disabled}
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
