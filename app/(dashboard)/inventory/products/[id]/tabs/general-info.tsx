"use client";

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
import styles from "@/components/card-page/card-page.module.css";
import {
  type ItemCardDto,
  type UpdateItemCardVariantInput,
  type UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";

type DraftFamilyPatch = Partial<UpdateItemCardInput>;

export type ProductGeneralInfoTabProps = {
  card: ItemCardDto;
  /** Null on the /new draft page; the name input bootstraps creation. */
  focusItemId: string | null;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  onOpenConfig: () => void;
  onFamilyChange: (patch: DraftFamilyPatch, delayMs?: number) => void;
  onFamilyCommit: (patch?: DraftFamilyPatch) => void;
  onSellableChange: (sellable: boolean) => void;
  onVariantPatch: (variantId: string, patch: UpdateItemCardVariantInput) => void;
  onVariantReorder: (orderedVariantIds: string[]) => void;
  onFlush: () => Promise<void>;
  variantsEnabled: boolean;
  onVariantsEnabledChange: (enabled: boolean) => void;
};

export function ProductGeneralInfoTab({
  card,
  focusItemId,
  unitOptions,
  onOpenConfig,
  onFamilyChange,
  onFamilyCommit,
  onSellableChange,
  onVariantPatch,
  onVariantReorder,
  onFlush,
  variantsEnabled,
  onVariantsEnabledChange,
}: ProductGeneralInfoTabProps) {
  const hasOptions = card.options.some((option) => option.disabledAt == null);
  const visibleVariantCount = card.variants.filter((variant) => variant.deletedAt == null)
    .length;
  const isDraft = focusItemId == null;
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const sellableChecked =
    visibleVariants.length > 0 && visibleVariants.every((variant) => variant.sellable);
  const sellableIndeterminate =
    visibleVariants.some((variant) => variant.sellable) &&
    visibleVariants.some((variant) => !variant.sellable);
  const variantsActive = hasOptions || variantsEnabled;

  return (
    <>
      <CardSection>
        <CardPageTwoColumn
        left={
          <>
            <ItemCardCommitField
              field="name"
              label="Product name"
              value={card.family.name}
              required
              autoFocus={isDraft}
              onFamilyChange={onFamilyChange}
              onFamilyCommit={onFamilyCommit}
            />
            <CategoryComboboxField
              itemType={card.family.itemType}
              label="Category"
              value={card.family.category}
              placeholder="Select or create category"
              onChange={(category, delayMs) => onFamilyChange({ category }, delayMs)}
              onCommit={(category) =>
                category === undefined ? onFamilyCommit() : onFamilyCommit({ category })
              }
            />
            <ItemCardNotesField
              field="description"
              label="Description"
              value={card.family.description}
              onFamilyChange={onFamilyChange}
              onFamilyCommit={onFamilyCommit}
            />
          </>
        }
        right={
          <>
            <UnitSelectField
              currentUnitId={card.family.unitDefinitionId}
              unitOptions={unitOptions}
              onFamilyChange={onFamilyChange}
              onFamilyCommit={onFamilyCommit}
            />
            <Field>
              <FieldLabel>Usability</FieldLabel>
              <label className="flex items-center gap-(--space-2) text-[length:var(--text-sm)]">
                <Checkbox
                  checked={sellableIndeterminate ? "indeterminate" : sellableChecked}
                  disabled={isDraft || visibleVariants.length === 0}
                  onCheckedChange={(checked) => {
                    onSellableChange(checked === true);
                  }}
                />
                <span>Sellable</span>
              </label>
            </Field>
            <Field>
              <FieldLabel>Tracking</FieldLabel>
              <label className="flex items-center gap-(--space-2) text-[length:var(--text-sm)]">
                <Checkbox
                  checked={card.family.lotTrackingMode === "tracked"}
                  disabled={isDraft}
                  onCheckedChange={(checked) =>
                    onFamilyCommit({
                      lotTrackingMode: checked === true ? "tracked" : "untracked",
                    })
                  }
                />
                <span>Lot tracked</span>
              </label>
            </Field>
          </>
        }
      />

      </CardSection>

      <CardSection
        title="Variants"
        count={hasOptions ? `· ${visibleVariantCount} variants` : null}
        actions={
          <>
            {variantsActive ? (
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
              variants={card.variants}
              disabled={isDraft}
              onAssignBarcode={(variantId, barcode) =>
                onVariantPatch(variantId, { internalBarcode: barcode })
              }
              onFlush={onFlush}
            />
          </>
        }
      >
        {variantsActive ? null : (
          <label className="mb-(--space-2) flex items-center gap-(--space-2) text-[length:var(--text-sm)] text-muted-foreground">
            <Checkbox
              checked={false}
              disabled={isDraft}
              onCheckedChange={(checked) => {
                if (checked !== true) return;
                onVariantsEnabledChange(true);
                onOpenConfig();
              }}
            />
            This product has multiple variants
          </label>
        )}

        {hasOptions ? (
          <VariantTable
            card={card}
            viewMode="product"
            onVariantPatch={onVariantPatch}
            onVariantReorder={onVariantReorder}
          />
        ) : (
          <p className={styles.helper}>No variants yet.</p>
        )}
      </CardSection>
    </>
  );
}

type UnitSelectFieldProps = {
  currentUnitId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
  disabled?: boolean;
  onFamilyChange: (patch: DraftFamilyPatch, delayMs?: number) => void;
  onFamilyCommit: (patch?: DraftFamilyPatch) => void;
};

function UnitSelectField({
  currentUnitId,
  unitOptions,
  disabled,
  onFamilyChange,
  onFamilyCommit,
}: UnitSelectFieldProps) {
  return (
    <Field>
      <FieldLabel>Unit of measure</FieldLabel>
      <Select
        value={currentUnitId}
        onValueChange={(value) => {
          if (disabled) return;
          if (value === currentUnitId) return;
          const patch = { unitDefinitionId: value };
          onFamilyChange(patch, Number.POSITIVE_INFINITY);
          onFamilyCommit(patch);
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
