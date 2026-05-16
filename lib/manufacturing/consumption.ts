import { normalizeNumeric, normalizeNumericScale } from "@/lib/format";

export const CONSUMPTION_MODES = [
  "per_output_unit",
  "per_batch",
  "per_group",
] as const;

export type ConsumptionMode = (typeof CONSUMPTION_MODES)[number];

export const BATCH_SCALING_MODES = [
  "proportional",
  "full_batches_only",
] as const;

export type BatchScalingMode = (typeof BATCH_SCALING_MODES)[number];

export const GROUP_REMAINDER_POLICIES = [
  "ask",
  "leave_loose",
  "create_partial_group",
] as const;

export type GroupRemainderPolicy = (typeof GROUP_REMAINDER_POLICIES)[number];

export const GROUP_REMAINDER_HANDLINGS = [
  "leave_loose",
  "create_partial_group",
] as const;

export type GroupRemainderHandling =
  (typeof GROUP_REMAINDER_HANDLINGS)[number];

export type ConsumptionCalculationInput = {
  quantity: string | number;
  outputQuantity: string | number;
  consumptionMode?: ConsumptionMode | null;
  basisOutputQuantity?: string | number | null;
  batchScalingMode?: BatchScalingMode | null;
  groupRemainderPolicy?: GroupRemainderPolicy | null;
  chosenGroupRemainderHandling?: GroupRemainderHandling | null;
};

export type ConsumptionCalculationResult = {
  plannedQuantity: string;
  calculatedBatchCount: string | null;
  calculatedGroupCount: string | null;
  fullGroupCount: number | null;
  groupRemainderQuantity: string | null;
  chosenGroupRemainderHandling: GroupRemainderHandling | null;
};

export type GroupRemainderChoice = {
  basisOutputQuantity: string;
  handling: GroupRemainderHandling;
};

const EPSILON = 0.000001;

function toFiniteNumber(value: string | number | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeConsumptionMode(
  mode: string | null | undefined
): ConsumptionMode {
  return CONSUMPTION_MODES.includes(mode as ConsumptionMode)
    ? (mode as ConsumptionMode)
    : "per_output_unit";
}

export function normalizeBatchScalingMode(
  mode: string | null | undefined
): BatchScalingMode {
  return BATCH_SCALING_MODES.includes(mode as BatchScalingMode)
    ? (mode as BatchScalingMode)
    : "proportional";
}

export function normalizeGroupRemainderPolicy(
  policy: string | null | undefined
): GroupRemainderPolicy {
  return GROUP_REMAINDER_POLICIES.includes(policy as GroupRemainderPolicy)
    ? (policy as GroupRemainderPolicy)
    : "ask";
}

export function normalizeGroupRemainderHandling(
  handling: string | null | undefined
): GroupRemainderHandling | null {
  return GROUP_REMAINDER_HANDLINGS.includes(handling as GroupRemainderHandling)
    ? (handling as GroupRemainderHandling)
    : null;
}

export function makeGroupChoiceKey(basisOutputQuantity: string | number) {
  const basis = toFiniteNumber(basisOutputQuantity);
  return basis != null ? normalizeNumeric(basis) : "";
}

export function calculateConsumptionRequirement(
  input: ConsumptionCalculationInput
): ConsumptionCalculationResult {
  const quantity = toFiniteNumber(input.quantity) ?? 0;
  const outputQuantity = toFiniteNumber(input.outputQuantity) ?? 0;
  const mode = normalizeConsumptionMode(input.consumptionMode);

  if (mode === "per_output_unit") {
    return {
      plannedQuantity: normalizeNumeric(quantity * outputQuantity),
      calculatedBatchCount: null,
      calculatedGroupCount: null,
      fullGroupCount: null,
      groupRemainderQuantity: null,
      chosenGroupRemainderHandling: null,
    };
  }

  const basisOutputQuantity = toFiniteNumber(input.basisOutputQuantity);
  if (basisOutputQuantity == null || basisOutputQuantity <= 0) {
    return {
      plannedQuantity: "0",
      calculatedBatchCount: null,
      calculatedGroupCount: null,
      fullGroupCount: null,
      groupRemainderQuantity: null,
      chosenGroupRemainderHandling: null,
    };
  }

  if (mode === "per_batch") {
    const batchScalingMode = normalizeBatchScalingMode(input.batchScalingMode);
    const batchCount =
      batchScalingMode === "full_batches_only"
        ? Math.ceil(outputQuantity / basisOutputQuantity)
        : outputQuantity / basisOutputQuantity;

    return {
      plannedQuantity: normalizeNumeric(quantity * batchCount),
      calculatedBatchCount: normalizeNumeric(batchCount),
      calculatedGroupCount: null,
      fullGroupCount: null,
      groupRemainderQuantity: null,
      chosenGroupRemainderHandling: null,
    };
  }

  const fullGroupCount = Math.floor(outputQuantity / basisOutputQuantity);
  const remainderQuantity = Math.max(
    0,
    outputQuantity - fullGroupCount * basisOutputQuantity
  );
  const hasRemainder = remainderQuantity > EPSILON;
  const policy = normalizeGroupRemainderPolicy(input.groupRemainderPolicy);
  const requestedHandling = normalizeGroupRemainderHandling(
    input.chosenGroupRemainderHandling
  );
  const chosenHandling =
    policy === "ask"
      ? requestedHandling ?? "leave_loose"
      : policy === "create_partial_group"
        ? "create_partial_group"
        : "leave_loose";
  const groupCount =
    hasRemainder && chosenHandling === "create_partial_group"
      ? fullGroupCount + 1
      : fullGroupCount;

  return {
    plannedQuantity: normalizeNumeric(quantity * groupCount),
    calculatedBatchCount: null,
    calculatedGroupCount: normalizeNumeric(groupCount),
    fullGroupCount,
    groupRemainderQuantity: normalizeNumeric(remainderQuantity),
    chosenGroupRemainderHandling: hasRemainder ? chosenHandling : null,
  };
}

export function calculateAverageUnitConsumptionQuantity(
  input: Pick<
    ConsumptionCalculationInput,
    "quantity" | "consumptionMode" | "basisOutputQuantity"
  >
) {
  const quantity = toFiniteNumber(input.quantity) ?? 0;
  const mode = normalizeConsumptionMode(input.consumptionMode);

  if (mode === "per_output_unit") {
    return normalizeNumericScale(quantity, 6);
  }

  const basisOutputQuantity = toFiniteNumber(input.basisOutputQuantity);
  if (basisOutputQuantity == null || basisOutputQuantity <= 0) {
    return "0";
  }

  return normalizeNumericScale(quantity / basisOutputQuantity, 6);
}

export function summarizeGroupRemainders(
  rows: Array<{
    consumptionMode?: string | null;
    basisOutputQuantity?: string | number | null;
    groupRemainderPolicy?: string | null;
  }>,
  outputQuantity: string | number
) {
  const output = toFiniteNumber(outputQuantity);
  if (output == null || output <= 0) return [];

  const byBasis = new Map<
    string,
    {
      basisOutputQuantity: string;
      fullGroupCount: number;
      remainderQuantity: string;
      requiresChoice: boolean;
      policies: Set<GroupRemainderPolicy>;
    }
  >();

  rows.forEach((row) => {
    if (normalizeConsumptionMode(row.consumptionMode) !== "per_group") return;
    const basis = toFiniteNumber(row.basisOutputQuantity);
    if (basis == null || basis <= 0) return;

    const key = makeGroupChoiceKey(basis);
    const fullGroupCount = Math.floor(output / basis);
    const remainderQuantity = Math.max(0, output - fullGroupCount * basis);
    const policy = normalizeGroupRemainderPolicy(row.groupRemainderPolicy);
    const current =
      byBasis.get(key) ??
      {
        basisOutputQuantity: key,
        fullGroupCount,
        remainderQuantity: normalizeNumeric(remainderQuantity),
        requiresChoice: false,
        policies: new Set<GroupRemainderPolicy>(),
      };

    current.requiresChoice ||= remainderQuantity > EPSILON && policy === "ask";
    current.policies.add(policy);
    byBasis.set(key, current);
  });

  return [...byBasis.values()].sort(
    (left, right) =>
      Number(left.basisOutputQuantity) - Number(right.basisOutputQuantity)
  );
}
