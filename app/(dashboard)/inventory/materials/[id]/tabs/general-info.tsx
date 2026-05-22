"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardSection } from "@/components/card-page/card-page";
import { CardPageTwoColumn } from "@/components/card-page/card-page-two-column";
import {
  ItemCardCommitField,
  ItemCardNotesField,
} from "@/components/card-page/item-card-fields";
import { VariantTable } from "@/components/card-page/variant-table";
import { GenerateBarcodesButton } from "@/components/card-page/generate-barcodes-button";
import { CategoryComboboxField } from "@/components/card-page/category-combobox-field";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { setItemCardFamilyQueryData } from "@/components/card-page/item-card-cache";
import styles from "@/components/card-page/card-page.module.css";
import {
  updateItemCard,
  type ItemCardDto,
  type UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";

type DraftFamilyPatch = Partial<UpdateItemCardInput>;

export type MaterialGeneralInfoTabProps = {
  card: ItemCardDto;
  /** Null on the /new draft page; the name input bootstraps creation. */
  focusItemId: string | null;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  onOpenConfig: () => void;
  onDraftFamilyChange: (patch: DraftFamilyPatch) => void;
  onDraftCommit: (patch?: DraftFamilyPatch) => void;
  draftCreatePending?: boolean;
};

export function MaterialGeneralInfoTab({
  card,
  focusItemId,
  unitOptions,
  onOpenConfig,
  onDraftFamilyChange,
  onDraftCommit,
  draftCreatePending,
}: MaterialGeneralInfoTabProps) {
  const hasOptions = card.options.some((option) => option.disabledAt == null);
  const [variantsEnabled, setVariantsEnabled] = useState(hasOptions);
  const visibleVariantCount = card.variants.filter((variant) => variant.deletedAt == null)
    .length;
  const isDraft = focusItemId == null;

  return (
    <>
      <CardSection>
        <CardPageTwoColumn
        left={
          <>
            <ItemCardCommitField
              focusItemId={focusItemId}
              field="name"
              label="Material name"
              value={card.family.name}
              required
              autoFocus={isDraft}
              onDraftFamilyChange={onDraftFamilyChange}
              onDraftCommit={onDraftCommit}
              disabled={draftCreatePending}
            />
            <CategoryComboboxField
              focusItemId={focusItemId}
              itemType={card.family.itemType}
              label="Category"
              value={card.family.category}
              placeholder="Select or create category"
              onDraftChange={(category) => onDraftFamilyChange({ category })}
              onDraftCommit={(category) => onDraftCommit({ category })}
              disabled={draftCreatePending}
            />
            <ItemCardNotesField
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

      </CardSection>

      <CardSection
        title="Variants"
        count={hasOptions ? `· ${visibleVariantCount} variants` : null}
        actions={
          <>
            {hasOptions || variantsEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenConfig}
                disabled={isDraft}
              >
                Open configuration…
              </Button>
            ) : null}
            <GenerateBarcodesButton
              cardItemId={focusItemId ?? ""}
              variants={card.variants}
              disabled={isDraft}
            />
          </>
        }
      >
        <label className="mb-(--space-2) flex items-center gap-(--space-2) text-[length:var(--text-sm)] text-muted-foreground">
          <Checkbox
            checked={hasOptions || variantsEnabled}
            disabled={isDraft || hasOptions}
            onCheckedChange={(checked) => {
              const enabled = checked === true;
              setVariantsEnabled(enabled);
              if (enabled) onOpenConfig();
            }}
          />
          This material has multiple variants
        </label>

        {hasOptions || variantsEnabled ? (
          <VariantTable card={card} viewMode="material" />
        ) : (
          <p className={styles.helper}>No variants yet. Open configuration to add some.</p>
        )}
      </CardSection>
    </>
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
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? "__draft__", "patch", "unitDefinitionId"),
    mutationFn: (next: string) =>
      updateItemCard(focusItemId as string, { unitDefinitionId: next }),
    onSuccess: (nextCard) => {
      setItemCardFamilyQueryData(queryClient, focusItemId as string, nextCard);
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
