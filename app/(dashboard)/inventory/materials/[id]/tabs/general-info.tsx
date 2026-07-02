"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CardCheckboxField,
  CardField,
} from "@/components/card-page/card-field";
import { SellableCardField } from "@/components/card-page/sellable-card-field";
import {
  UnitSelectField,
  type UnitSelectOption,
} from "@/components/card-page/unit-select-field";
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

export type MaterialGeneralInfoTabProps = {
  card: ItemCardDto;
  /** Null on the /new draft page; the name input bootstraps creation. */
  focusItemId: string | null;
  unitOptions: UnitSelectOption[];
  onUnitCreated: (unit: UnitSelectOption) => void;
  onOpenConfig: () => void;
  onFamilyChange: (patch: DraftFamilyPatch, delayMs?: number) => void;
  onFamilyCommit: (patch?: DraftFamilyPatch) => void;
  onSellableChange: (sellable: boolean) => void;
  onVariantPatch: (variantId: string, patch: UpdateItemCardVariantInput) => void;
  onVariantReorder: (orderedVariantIds: string[]) => void;
  onCreateVariant: (input: CreateItemCardVariantInput) => Promise<CreateItemCardResult | null>;
  onBeforeStockAdjustment: (variantId: string) => Promise<void>;
  onFocusedVariantDeleted: (nextVariantId: string) => void;
  onFlush: () => Promise<unknown>;
  variantsEnabled: boolean;
  onVariantsEnabledChange: (enabled: boolean) => void;
  canAdminInventory: boolean;
};

export function MaterialGeneralInfoTab({
  card,
  focusItemId,
  unitOptions,
  onUnitCreated,
  onOpenConfig,
  onFamilyChange,
  onFamilyCommit,
  onSellableChange,
  onVariantPatch,
  onVariantReorder,
  onCreateVariant,
  onBeforeStockAdjustment,
  onFocusedVariantDeleted,
  onFlush,
  variantsEnabled,
  onVariantsEnabledChange,
  canAdminInventory,
}: MaterialGeneralInfoTabProps) {
  const hasOptions = card.options.some((option) => option.disabledAt == null);
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const visibleVariantCount = visibleVariants.length;
  const isDraft = focusItemId == null;
  const variantsActive = hasOptions || variantsEnabled;

  return (
    <>
      <CardSection>
        <CardPageTwoColumn
          left={
            <>
              <ItemCardCommitField
                field="name"
                label="Material name"
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
                label="Additional info"
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
                required
                invalid={!card.family.unitDefinitionId}
                canCreateUnit={canAdminInventory}
                onUnitCreated={onUnitCreated}
                onUnitChange={(unit) => {
                  const patch = { unitDefinitionId: unit.id };
                  onFamilyChange(patch, Number.POSITIVE_INFINITY);
                  onFamilyCommit(patch);
                }}
              />
              <SellableCardField
                variants={card.variants}
                disabled={isDraft}
                onChange={onSellableChange}
              />
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
            This material has multiple variants
          </label>
        )}

        <VariantTable
          card={card}
          focusItemId={focusItemId}
          viewMode="material"
          allowVariantRows={hasOptions}
          onVariantPatch={onVariantPatch}
          onVariantReorder={onVariantReorder}
          onCreateVariant={onCreateVariant}
          onBeforeStockAdjustment={onBeforeStockAdjustment}
          onFocusedVariantDeleted={onFocusedVariantDeleted}
        />
      </CardSection>
    </>
  );
}
