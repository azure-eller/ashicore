import {
  normalizeNumericScale,
  parseNonNegativeNumber,
  parsePositiveNumber,
} from "@/lib/format";
import {
  calculateAverageUnitConsumptionQuantity,
  type RecipeBasis,
} from "@/lib/manufacturing/consumption";

export type RecipeCostPreviewRow = {
  componentId: string | null;
  quantity: string | null;
  minimumLotAgeDays?: string | number | null;
};

function isBlankPreviewRow(row: RecipeCostPreviewRow) {
  return (
    (row.componentId?.trim() ?? "") === "" &&
    (row.quantity?.trim() ?? "") === "" &&
    (row.minimumLotAgeDays == null ||
      String(row.minimumLotAgeDays).trim() === "")
  );
}

export function calculateEstimatedComponentContribution(input: {
  quantity: string | number | null | undefined;
  estimatedUnitCost: string | number | null | undefined;
  recipeBasis: RecipeBasis;
  outputQuantity: string | number | null | undefined;
}) {
  const contribution = calculateEstimatedComponentContributionNumber(input);
  return contribution == null
    ? null
    : normalizeNumericScale(contribution, 6);
}

function calculateEstimatedComponentContributionNumber(input: {
  quantity: string | number | null | undefined;
  estimatedUnitCost: string | number | null | undefined;
  recipeBasis: RecipeBasis;
  outputQuantity: string | number | null | undefined;
}) {
  const quantity = parsePositiveNumber(input.quantity);
  const estimatedUnitCost = parseNonNegativeNumber(input.estimatedUnitCost);
  if (quantity == null || estimatedUnitCost == null) return null;

  if (
    input.recipeBasis === "batch" &&
    parsePositiveNumber(input.outputQuantity) == null
  ) {
    return null;
  }

  const quantityPerOutputUnit = Number(
    calculateAverageUnitConsumptionQuantity({
      quantity,
      recipeBasis: input.recipeBasis,
      outputQuantity: input.outputQuantity,
    }),
  );
  if (!Number.isFinite(quantityPerOutputUnit) || quantityPerOutputUnit <= 0) {
    return null;
  }

  const contribution = quantityPerOutputUnit * estimatedUnitCost;
  return Number.isFinite(contribution) ? contribution : null;
}

export function calculateEstimatedIngredientCost(input: {
  rows: RecipeCostPreviewRow[];
  estimatedUnitCostByComponentId: ReadonlyMap<string, string | null>;
  recipeBasis: RecipeBasis;
  outputQuantity: string | number | null | undefined;
}) {
  if (input.rows.length === 0) return "0";

  let total = 0;

  for (const row of input.rows) {
    if (isBlankPreviewRow(row)) continue;

    const componentId = row.componentId?.trim() ?? "";
    if (!componentId) return null;

    const contribution = calculateEstimatedComponentContributionNumber({
      quantity: row.quantity,
      estimatedUnitCost:
        input.estimatedUnitCostByComponentId.get(componentId) ?? null,
      recipeBasis: input.recipeBasis,
      outputQuantity: input.outputQuantity,
    });
    if (contribution == null) return null;

    total += contribution;
    if (!Number.isFinite(total)) return null;
  }

  return normalizeNumericScale(total, 6);
}

export function calculateEstimatedProductCost(input: {
  ingredientsCost: string | null;
  operationsCost: string | null;
}) {
  const ingredientsCost = parseNonNegativeNumber(input.ingredientsCost);
  const operationsCost = parseNonNegativeNumber(input.operationsCost);
  if (ingredientsCost == null || operationsCost == null) return null;

  const total = ingredientsCost + operationsCost;
  return Number.isFinite(total) ? normalizeNumericScale(total, 6) : null;
}
