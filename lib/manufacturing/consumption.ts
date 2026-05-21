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
  everyQuantity?: string | number | null;
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

type ParsedDecimal = {
  sign: bigint;
  digits: bigint;
  scale: number;
};

function parseDecimal(value: string | number | null | undefined): ParsedDecimal | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(raw)) return null;

  const sign = raw.startsWith("-") ? BigInt(-1) : BigInt(1);
  const unsigned = raw.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = BigInt(`${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "") || "0");

  return { sign, digits, scale: fraction.length };
}

function pow10(exponent: number) {
  return BigInt(10) ** BigInt(exponent);
}

function comparePositiveDecimals(left: ParsedDecimal, right: ParsedDecimal) {
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.digits * pow10(scale - left.scale);
  const rightScaled = right.digits * pow10(scale - right.scale);
  if (leftScaled === rightScaled) return 0;
  return leftScaled > rightScaled ? 1 : -1;
}

function ceilDividePositiveDecimals(numerator: ParsedDecimal, denominator: ParsedDecimal) {
  if (numerator.digits === BigInt(0)) return BigInt(0);
  const scale = Math.max(numerator.scale, denominator.scale);
  const numeratorScaled = numerator.digits * pow10(scale - numerator.scale);
  const denominatorScaled = denominator.digits * pow10(scale - denominator.scale);
  return (numeratorScaled + denominatorScaled - BigInt(1)) / denominatorScaled;
}

function formatScaledDecimal(value: bigint, scale: number) {
  if (value === BigInt(0)) return "0";
  const sign = value < BigInt(0) ? "-" : "";
  const abs = value < BigInt(0) ? -value : value;

  if (scale === 0) return `${sign}${abs.toString()}`;

  const divisor = pow10(scale);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(scale, "0").replace(/0+$/, "");
  return fraction ? `${sign}${whole.toString()}.${fraction}` : `${sign}${whole.toString()}`;
}

function multiplyDecimalByInteger(value: ParsedDecimal, multiplier: bigint, scale: number) {
  const raw = value.digits * multiplier;
  let scaled: bigint;
  if (value.scale > scale) {
    const divisor = pow10(value.scale - scale);
    scaled = raw / divisor;
    const remainder = raw % divisor;
    if (remainder * BigInt(2) >= divisor) scaled += BigInt(1);
  } else {
    scaled = raw * pow10(scale - value.scale);
  }

  return formatScaledDecimal(scaled * value.sign, scale);
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPositiveDecimal(value: ParsedDecimal | null) {
  return value != null && value.sign > BigInt(0) && value.digits > BigInt(0);
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
    : "full_batches_only";
}

export function normalizeGroupRemainderPolicy(
  policy: string | null | undefined
): GroupRemainderPolicy {
  return GROUP_REMAINDER_POLICIES.includes(policy as GroupRemainderPolicy)
    ? (policy as GroupRemainderPolicy)
    : "create_partial_group";
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
  const quantity = parseDecimal(input.quantity);
  const outputQuantity = parseDecimal(input.outputQuantity);
  const everyQuantity = parseDecimal(
    input.everyQuantity ?? input.basisOutputQuantity ?? input.outputQuantity
  );

  if (
    !isPositiveDecimal(quantity) ||
    !isPositiveDecimal(outputQuantity) ||
    !isPositiveDecimal(everyQuantity)
  ) {
    return {
      plannedQuantity: "0",
      calculatedBatchCount: null,
      calculatedGroupCount: null,
      fullGroupCount: null,
      groupRemainderQuantity: null,
      chosenGroupRemainderHandling: null,
    };
  }

  const groupCount = ceilDividePositiveDecimals(outputQuantity!, everyQuantity!);
  const plannedQuantity = multiplyDecimalByInteger(quantity!, groupCount, 4);

  return {
    plannedQuantity,
    calculatedBatchCount: normalizeNumeric(Number(groupCount)),
    calculatedGroupCount: normalizeNumeric(Number(groupCount)),
    fullGroupCount: Number(groupCount),
    groupRemainderQuantity: null,
    chosenGroupRemainderHandling: null,
  };
}

export function calculateAverageUnitConsumptionQuantity(
  input: {
    quantity: string | number;
    everyQuantity?: string | number | null;
    basisOutputQuantity?: string | number | null;
    outputQuantity?: string | number | null;
  }
) {
  const outputQuantity = parseDecimal(
    input.outputQuantity ?? input.everyQuantity ?? input.basisOutputQuantity
  );
  const requirement = calculateConsumptionRequirement({
    quantity: input.quantity,
    outputQuantity: input.outputQuantity ?? input.everyQuantity ?? input.basisOutputQuantity ?? "0",
    everyQuantity: input.everyQuantity ?? input.basisOutputQuantity ?? input.outputQuantity,
  });
  const requiredQuantity = toFiniteNumber(requirement.plannedQuantity);
  const outputQuantityNumber = toFiniteNumber(
    input.outputQuantity ?? input.everyQuantity ?? input.basisOutputQuantity
  );

  if (
    !isPositiveDecimal(outputQuantity) ||
    requiredQuantity == null ||
    outputQuantityNumber == null ||
    outputQuantityNumber <= 0
  ) {
    return "0";
  }

  return normalizeNumericScale(requiredQuantity / outputQuantityNumber, 6);
}

export function summarizeGroupRemainders(..._args: unknown[]): Array<{
  basisOutputQuantity: string;
  fullGroupCount: number;
  remainderQuantity: string;
  requiresChoice: boolean;
  policies: Set<GroupRemainderPolicy>;
}> {
  void _args;
  return [];
}

export function hasPartialEveryQuantityGroup(params: {
  outputQuantity: string | number;
  everyQuantity: string | number | null | undefined;
}) {
  const outputQuantity = parseDecimal(params.outputQuantity);
  const everyQuantity = parseDecimal(params.everyQuantity);
  if (!isPositiveDecimal(outputQuantity) || !isPositiveDecimal(everyQuantity)) {
    return false;
  }
  return comparePositiveDecimals(outputQuantity!, everyQuantity!) !== 0;
}
