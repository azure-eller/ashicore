"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CardCheckboxField,
  CardField,
} from "@/components/card-page/card-field";
import {
  UnitSelectField,
  type UnitSelectOption,
} from "@/components/card-page/unit-select-field";
import { UnitConversionField } from "@/components/card-page/unit-conversion-field";
import type {
  ItemCardDto,
  UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";
import { formatPrice, normalizeMoney, normalizeNumeric } from "@/lib/format";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import { deriveUnitToStockFactor } from "@/lib/units-of-measure";

type SalesUnitPatch = Pick<
  UpdateItemCardInput,
  "salesUnitDefinitionId" | "salesToStockFactor"
>;

type PendingUnitChange = {
  patch: SalesUnitPatch;
  nextUnitName: string;
  nextFactor: string;
};

type SalesUnitCardFieldProps = {
  card: ItemCardDto;
  unitOptions: UnitSelectOption[];
  disabled: boolean;
  canCreateUnit: boolean;
  onUnitCreated: (unit: UnitSelectOption) => void;
  onFamilyCommit: (patch: SalesUnitPatch) => void;
};

export function SalesUnitCardField({
  card,
  unitOptions,
  disabled,
  canCreateUnit,
  onUnitCreated,
  onFamilyCommit,
}: SalesUnitCardFieldProps) {
  const hasSellableVariant = card.variants.some(
    (variant) => variant.deletedAt == null && variant.sellable
  );

  if (!hasSellableVariant) {
    return null;
  }

  const persistedBasisKey = [
    card.family.unitDefinitionId,
    card.family.salesUnitDefinitionId ?? "stock",
    card.family.salesToStockFactor ?? "1",
  ].join(":");

  return (
    <SalesUnitCardEditor
      key={persistedBasisKey}
      card={card}
      unitOptions={unitOptions}
      disabled={disabled}
      canCreateUnit={canCreateUnit}
      onUnitCreated={onUnitCreated}
      onFamilyCommit={onFamilyCommit}
    />
  );
}

function SalesUnitCardEditor({
  card,
  unitOptions,
  disabled,
  canCreateUnit,
  onUnitCreated,
  onFamilyCommit,
}: SalesUnitCardFieldProps) {
  const configured = card.family.salesUnitDefinitionId != null;
  const [salesUnitOn, setSalesUnitOn] = useState(configured);
  const [draftUnitId, setDraftUnitId] = useState(
    card.family.salesUnitDefinitionId ?? ""
  );
  const [draftFactor, setDraftFactor] = useState<string | null>(
    card.family.salesToStockFactor
  );
  const [factorError, setFactorError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] =
    useState<PendingUnitChange | null>(null);
  const acceptingChangeRef = useRef(false);

  const unitById = useMemo(
    () => new Map(unitOptions.map((unit) => [unit.id, unit])),
    [unitOptions]
  );
  const salesUnitName =
    unitById.get(draftUnitId)?.name ??
    card.family.salesUnitName ??
    "sales unit";
  const pricedVariants = card.variants.filter(
    (variant) =>
      variant.deletedAt == null && variant.defaultSellingPrice != null
  );

  const resetDraftToSaved = () => {
    setSalesUnitOn(configured);
    setDraftUnitId(card.family.salesUnitDefinitionId ?? "");
    setDraftFactor(card.family.salesToStockFactor);
    setFactorError(null);
  };

  const commitOrConfirm = (
    patch: SalesUnitPatch,
    nextUnitName: string,
    nextFactor: string
  ) => {
    const previousFactor = Number(card.family.salesToStockFactor ?? "1");
    const parsedNextFactor = Number(nextFactor);
    const factorChanges =
      Number.isFinite(previousFactor) &&
      Number.isFinite(parsedNextFactor) &&
      previousFactor !== parsedNextFactor;

    if (factorChanges && pricedVariants.length > 0) {
      setPendingChange({ patch, nextUnitName, nextFactor });
      return;
    }

    onFamilyCommit(patch);
  };

  const clearSalesUnit = () => {
    setSalesUnitOn(false);
    setDraftUnitId("");
    setDraftFactor(null);
    setFactorError(null);
    commitOrConfirm(
      {
        salesUnitDefinitionId: null,
        salesToStockFactor: null,
      },
      card.family.unitName ?? "stock unit",
      "1"
    );
  };

  const handleUnitChange = (unit: UnitSelectOption) => {
    if (unit.id === card.family.unitDefinitionId) {
      clearSalesUnit();
      return;
    }

    const stockingUnit = unitById.get(card.family.unitDefinitionId);
    const derivedFactor =
      stockingUnit == null
        ? null
        : deriveUnitToStockFactor(unit, stockingUnit);
    setDraftUnitId(unit.id);

    if (
      derivedFactor == null ||
      !Number.isFinite(derivedFactor) ||
      derivedFactor <= 0
    ) {
      setDraftFactor(null);
      setFactorError(
        "Enter how many stocking units equal one sales unit."
      );
      return;
    }

    const factor = normalizeNumeric(derivedFactor);
    setDraftFactor(factor);
    setFactorError(null);
    commitOrConfirm(
      {
        salesUnitDefinitionId: unit.id,
        salesToStockFactor: factor,
      },
      unit.name,
      factor
    );
  };

  const priceChangeDescription = pendingChange
    ? describePriceChange({
        card,
        pricedVariants,
        nextUnitName: pendingChange.nextUnitName,
        nextFactor: pendingChange.nextFactor,
      })
    : "";

  return (
    <>
      <CardField label="Sales unit">
        <CardCheckboxField
          label="Use a different sales unit"
          checked={salesUnitOn}
          disabled={disabled}
          onCheckedChange={(checked) => {
            if (checked === true) {
              setSalesUnitOn(true);
              return;
            }
            if (salesUnitOn) clearSalesUnit();
          }}
        />
      </CardField>

      {salesUnitOn ? (
        <>
          <UnitSelectField
            label="Default sales unit of measure"
            currentUnitId={draftUnitId}
            unitOptions={unitOptions}
            disabled={disabled}
            required
            invalid={!draftUnitId}
            canCreateUnit={canCreateUnit}
            createDialogDescription="Add a unit customers can order and receive."
            onUnitCreated={onUnitCreated}
            onUnitChange={handleUnitChange}
          />
          {draftUnitId ? (
            <UnitConversionField
              sourceUnitLabel={salesUnitName}
              stockingUnitName={card.family.unitName ?? ""}
              value={draftFactor}
              disabled={disabled}
              invalid={factorError != null}
              error={factorError}
              onCommit={(next) => {
                if (
                  next == null ||
                  !isPositiveNumberString(next)
                ) {
                  setFactorError(
                    "Enter a conversion greater than zero."
                  );
                  return;
                }
                const normalized = normalizeNumeric(Number(next));
                const unit = unitById.get(draftUnitId);
                if (!unit) return;
                setDraftFactor(normalized);
                setFactorError(null);
                commitOrConfirm(
                  {
                    salesUnitDefinitionId: draftUnitId,
                    salesToStockFactor: normalized,
                  },
                  unit.name,
                  normalized
                );
              }}
            />
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={pendingChange != null}
        onOpenChange={(open) => {
          if (open) return;
          setPendingChange(null);
          if (acceptingChangeRef.current) {
            acceptingChangeRef.current = false;
            return;
          }
          resetDraftToSaved();
        }}
      >
        <AlertDialogContent size="md">
          <AlertDialogHeader>
            <AlertDialogTitle>Change sales unit?</AlertDialogTitle>
            <AlertDialogDescription>
              {priceChangeDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current unit</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingChange) return;
                acceptingChangeRef.current = true;
                onFamilyCommit(pendingChange.patch);
              }}
            >
              Change unit and prices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function describePriceChange({
  card,
  pricedVariants,
  nextUnitName,
  nextFactor,
}: {
  card: ItemCardDto;
  pricedVariants: ItemCardDto["variants"];
  nextUnitName: string;
  nextFactor: string;
}) {
  const previousFactor = Number(card.family.salesToStockFactor ?? "1");
  const parsedNextFactor = Number(nextFactor);
  const previousUnitName =
    card.family.salesUnitName ?? card.family.unitName ?? "stock unit";

  if (pricedVariants.length === 1) {
    const previousPrice = Number(pricedVariants[0].defaultSellingPrice);
    const nextPrice = normalizeMoney(
      (previousPrice * parsedNextFactor) / previousFactor
    );
    return `The default selling price will change from ${
      formatPrice(String(previousPrice)) ?? String(previousPrice)
    } per ${previousUnitName} to ${
      formatPrice(nextPrice) ?? nextPrice
    } per ${nextUnitName}. Existing sales order lines will not change.`;
  }

  return `Default selling prices on ${pricedVariants.length} variants will be rescaled so their underlying stock value stays the same. Existing sales order lines will not change.`;
}
