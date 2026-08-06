import type {
  ItemCardFamilyDto,
  UpdateItemCardInput,
} from "@/lib/api/clients/item-cards";
import { normalizeNumeric } from "@/lib/format";
import {
  deriveUnitToStockFactor,
  type UnitDefinitionOption,
} from "@/lib/units-of-measure";

type StockUnitChangeResult =
  | { patch: UpdateItemCardInput; error: null }
  | { patch: null; error: string };

/**
 * Rebase alternate-unit conversions whenever the stocking unit changes.
 *
 * Compatible dimensional units are exact and can be converted automatically.
 * For incompatible/manual conversions, changing the denominator without a new
 * user-provided factor would silently corrupt later PO/SO quantities, so the
 * stock-unit change is blocked until the alternate unit is cleared.
 */
export function buildStockUnitChangePatch(params: {
  family: ItemCardFamilyDto;
  nextStockUnit: UnitDefinitionOption;
  unitOptions: UnitDefinitionOption[];
}): StockUnitChangeResult {
  const { family, nextStockUnit, unitOptions } = params;
  const unitById = new Map(unitOptions.map((unit) => [unit.id, unit]));
  const patch: UpdateItemCardInput = {
    unitDefinitionId: nextStockUnit.id,
  };

  if (family.salesUnitDefinitionId != null) {
    if (family.salesUnitDefinitionId === nextStockUnit.id) {
      patch.salesUnitDefinitionId = null;
      patch.salesToStockFactor = null;
    } else {
      const salesUnit = unitById.get(family.salesUnitDefinitionId);
      const factor =
        salesUnit == null
          ? null
          : deriveUnitToStockFactor(salesUnit, nextStockUnit);
      if (factor == null || !Number.isFinite(factor) || factor <= 0) {
        return {
          patch: null,
          error:
            "Clear the different sales unit before changing to an incompatible stocking unit, then configure its new conversion.",
        };
      }
      patch.salesToStockFactor = normalizeNumeric(factor);
    }
  }

  if (
    family.itemType === "material" &&
    family.purchaseUnitDefinitionId != null
  ) {
    if (family.purchaseUnitDefinitionId === nextStockUnit.id) {
      patch.purchaseUnitDefinitionId = null;
      patch.purchaseToStockFactor = null;
    } else {
      const purchaseUnit = unitById.get(family.purchaseUnitDefinitionId);
      const factor =
        purchaseUnit == null
          ? null
          : deriveUnitToStockFactor(purchaseUnit, nextStockUnit);
      if (factor == null || !Number.isFinite(factor) || factor <= 0) {
        return {
          patch: null,
          error:
            "Clear the different purchase unit before changing to an incompatible stocking unit, then configure its new conversion.",
        };
      }
      patch.purchaseToStockFactor = normalizeNumeric(factor);
    }
  }

  return { patch, error: null };
}
