"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CardCheckboxField,
  CardField,
  CardSelectField,
} from "@/components/card-page/card-field";
import { CardSection } from "@/components/card-page/card-page";
import { CardPageTwoColumn } from "@/components/card-page/card-page-two-column";
import {
  ItemCardCommitField,
  ItemCardNotesField,
} from "@/components/card-page/item-card-fields";
import { VariantTable } from "@/components/card-page/variant-table";
import { GenerateBarcodesButton } from "@/components/card-page/generate-barcodes-button";
import { CategoryComboboxField } from "@/components/card-page/category-combobox-field";
import {
  type ItemCardDto,
  type CreateItemCardResult,
  type CreateItemCardVariantInput,
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
  onCreateVariant: (input: CreateItemCardVariantInput) => Promise<CreateItemCardResult | null>;
  onFocusedVariantDeleted: (nextVariantId: string) => void;
  onFlush: () => Promise<unknown>;
  variantsEnabled: boolean;
  onVariantsEnabledChange: (enabled: boolean) => void;
  canAdminInventory: boolean;
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
  onCreateVariant,
  onFocusedVariantDeleted,
  onFlush,
  variantsEnabled,
  onVariantsEnabledChange,
  canAdminInventory,
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
            <CardField label="Usability">
              <CardCheckboxField
                label="Sellable"
                checked={sellableIndeterminate ? "indeterminate" : sellableChecked}
                disabled={isDraft || visibleVariants.length === 0}
                onCheckedChange={(checked) => {
                  onSellableChange(checked === true);
                }}
              />
            </CardField>
            <CardField label="Tracking">
              <CardCheckboxField
                label="Lot tracked"
                checked={card.family.lotTrackingMode === "tracked"}
                disabled={isDraft || !canAdminInventory}
                onCheckedChange={(checked) =>
                  onFamilyCommit({
                    lotTrackingMode: checked === true ? "tracked" : "untracked",
                  })
                }
              />
            </CardField>
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
          <label className="mb-(--space-2) inline-flex items-center gap-(--space-2) text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
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

        <VariantTable
          card={card}
          focusItemId={focusItemId}
          viewMode="product"
          allowVariantRows={hasOptions}
          onVariantPatch={onVariantPatch}
          onVariantReorder={onVariantReorder}
          onCreateVariant={onCreateVariant}
          onFocusedVariantDeleted={onFocusedVariantDeleted}
        />
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
    <CardSelectField
      label="Unit of measure"
      value={currentUnitId}
      onValueChange={(value) => {
        if (disabled) return;
        if (value === currentUnitId) return;
        const patch = { unitDefinitionId: value };
        onFamilyChange(patch, Number.POSITIVE_INFINITY);
        onFamilyCommit(patch);
      }}
      disabled={disabled}
      placeholder="Select a unit"
      options={unitOptions.map((unit) => ({
        value: unit.id,
        label: `${unit.name} (${unit.size} ${unit.uom})`,
      }))}
    />
  );
}
