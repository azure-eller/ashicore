"use client";

import { useState } from "react";
import type {
  ItemCardDto,
  UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";
import { buildStockUnitChangePatch } from "@/lib/inventory/stock-unit-change";
import {
  UnitSelectField,
  type UnitSelectOption,
} from "@/components/card-page/unit-select-field";

export function StockUnitCardField({
  card,
  unitOptions,
  canCreateUnit,
  onUnitCreated,
  onFamilyChange,
  onFamilyCommit,
}: {
  card: ItemCardDto;
  unitOptions: UnitSelectOption[];
  canCreateUnit: boolean;
  onUnitCreated: (unit: UnitSelectOption) => void;
  onFamilyChange: (patch: UpdateItemCardInput, delayMs?: number) => void;
  onFamilyCommit: (patch: UpdateItemCardInput) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <UnitSelectField
      currentUnitId={card.family.unitDefinitionId}
      unitOptions={unitOptions}
      required
      invalid={!card.family.unitDefinitionId || error != null}
      error={error}
      canCreateUnit={canCreateUnit}
      onUnitCreated={onUnitCreated}
      onUnitChange={(unit) => {
        const result = buildStockUnitChangePatch({
          family: card.family,
          nextStockUnit: unit,
          unitOptions,
        });
        if (result.error != null) {
          setError(result.error);
          return;
        }

        setError(null);
        onFamilyChange(result.patch, Number.POSITIVE_INFINITY);
        onFamilyCommit(result.patch);
      }}
    />
  );
}
