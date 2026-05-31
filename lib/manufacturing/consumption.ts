import {
  normalizeNumeric,
  normalizeNumericScale,
  parsePositiveNumber,
} from "@/lib/format";

export const RECIPE_BASES = ["unit", "batch"] as const;

export type RecipeBasis = (typeof RECIPE_BASES)[number];

export function normalizeRecipeBasis(value: string | null | undefined): RecipeBasis {
  return value === "batch" ? "batch" : "unit";
}

export function calculateIngredientPlannedQuantity(input: {
  recipeBasis: RecipeBasis;
  quantityPerRecipeBasis: string | number;
  outputQuantity: string | number;
  numberOfBatches?: number | null;
}) {
  const quantity = parsePositiveNumber(input.quantityPerRecipeBasis);
  if (quantity == null) return "0";

  if (input.recipeBasis === "batch") {
    const batches =
      input.numberOfBatches != null && Number.isInteger(input.numberOfBatches)
        ? input.numberOfBatches
        : null;
    return batches != null && batches > 0
      ? normalizeNumericScale(quantity * batches, 4)
      : "0";
  }

  const outputQuantity = parsePositiveNumber(input.outputQuantity);
  return outputQuantity != null
    ? normalizeNumericScale(quantity * outputQuantity, 4)
    : "0";
}

export function calculateAverageUnitConsumptionQuantity(input: {
  quantity: string | number;
  recipeBasis?: RecipeBasis | string | null;
  outputQuantity?: string | number | null;
}) {
  const quantity = parsePositiveNumber(input.quantity);
  if (quantity == null) return "0";

  if (normalizeRecipeBasis(input.recipeBasis) === "batch") {
    const outputQuantity = parsePositiveNumber(input.outputQuantity);
    return outputQuantity != null
      ? normalizeNumericScale(quantity / outputQuantity, 6)
      : "0";
  }

  return normalizeNumeric(quantity);
}
