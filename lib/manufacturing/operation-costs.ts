import { normalizeNumericScale } from "@/lib/format";

export const OPERATION_COST_SCALING_MODES = [
  "per_output_unit",
  "fixed_per_mo",
] as const;

export type OperationCostScalingMode =
  (typeof OPERATION_COST_SCALING_MODES)[number];

export function calculateOperationBaseCost(params: {
  crewSize: string | number;
  plannedMinutes: string | number;
  loadedCostPerHour: string | number;
}) {
  return (
    Number(params.crewSize) *
    Number(params.plannedMinutes) *
    Number(params.loadedCostPerHour) /
    60
  );
}

export function calculatePlannedOperationCost(params: {
  costScalingMode: OperationCostScalingMode;
  crewSize: string | number;
  plannedMinutes: string | number;
  loadedCostPerHour: string | number;
  outputQuantity: string | number;
}) {
  const baseCost = calculateOperationBaseCost(params);
  const scaledCost =
    params.costScalingMode === "per_output_unit"
      ? baseCost * Number(params.outputQuantity)
      : baseCost;

  return normalizeNumericScale(scaledCost, 6);
}
