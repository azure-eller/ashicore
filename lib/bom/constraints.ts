import { z } from "zod";

export const LOT_AGE_MIN_DAYS_CONSTRAINT = "lot_age_min_days" as const;

export const lotAgeMinDaysConfigSchema = z.object({
  days: z.number().int().positive(),
  basis: z.literal("received_at"),
});

export type LotAgeMinDaysConstraintConfig = z.infer<
  typeof lotAgeMinDaysConfigSchema
>;

export type LotAgeMinDaysConstraint = {
  id?: string;
  constraintType: typeof LOT_AGE_MIN_DAYS_CONSTRAINT;
  config: LotAgeMinDaysConstraintConfig;
  sortOrder: number;
};

export type BomComponentConstraint = LotAgeMinDaysConstraint;
export type BomComponentConstraintType = BomComponentConstraint["constraintType"];
export type BomComponentConstraintConfig = LotAgeMinDaysConstraintConfig;

// Evaluation results are serialized into manufacturing shortage payloads;
// the `requirement*` field names are frozen API surface.
export type RequirementEvaluationResult = {
  requirementId?: string;
  requirementType: BomComponentConstraintType;
  status: "pass" | "warning" | "block" | "needs_override";
  label: string;
  message: string;
  facts: Record<string, unknown>;
  overrideAllowed: boolean;
  overrideReasonRequired: boolean;
};

export type RequirementViolationPayload = RequirementEvaluationResult & {
  config: BomComponentConstraint["config"];
  nextEligibleDate?: string | null;
};

// Planning snapshots persist this shape; `requirementType` is frozen there too.
export type PlanningComponentRequirement = {
  requirementType: typeof LOT_AGE_MIN_DAYS_CONSTRAINT;
  days: number;
  basis: "received_at";
};

export function normalizeMinimumLotAgeDays(
  value: string | number | null | undefined
) {
  if (value == null) return null;
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (raw === "" || raw === "0") return null;
  if (!/^[1-9][0-9]*$/.test(raw)) return Number.NaN;
  return Number(raw);
}

export function createLotAgeMinDaysConstraint(
  days: number | null | undefined
): LotAgeMinDaysConstraint | null {
  if (days == null || days <= 0) return null;

  return {
    constraintType: LOT_AGE_MIN_DAYS_CONSTRAINT,
    config: { days, basis: "received_at" },
    sortOrder: 0,
  };
}

export function isLotAgeMinDaysConstraint(
  constraint: BomComponentConstraint
): constraint is LotAgeMinDaysConstraint {
  return constraint.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT;
}

export function getMinimumLotAgeDays(
  constraints: readonly BomComponentConstraint[] | null | undefined
) {
  const constraint = constraints?.find(isLotAgeMinDaysConstraint);
  return constraint?.config.days ?? null;
}

export function formatMinimumLotAgeRequirementLabel(days: number) {
  return `Age ≥ ${days}d`;
}

export function formatMinimumLotAgeRequirement(days: number) {
  return `>= ${days} ${days === 1 ? "day" : "days"} age requirement`;
}

export function formatMinimumLotAgeRequirementViolation(days: number) {
  return `Ingredient does not match the ${formatMinimumLotAgeRequirement(days)}.`;
}

function lotAgeRequirementMessage(days: number) {
  return `Lots must be at least ${days} ${days === 1 ? "day" : "days"} old based on received date.`;
}

export function summarizeComponentRequirements(
  constraints: readonly BomComponentConstraint[] | null | undefined
) {
  if (!constraints || constraints.length === 0) {
    return "None";
  }

  const first = constraints[0];
  const firstLabel = isLotAgeMinDaysConstraint(first)
    ? formatMinimumLotAgeRequirementLabel(first.config.days)
    : "Requirement";

  if (constraints.length === 1) {
    return firstLabel;
  }

  return `${firstLabel} +${constraints.length - 1}`;
}

export function toPlanningComponentRequirement(
  constraint: BomComponentConstraint
): PlanningComponentRequirement | null {
  if (!isLotAgeMinDaysConstraint(constraint)) {
    return null;
  }

  const parsed = lotAgeMinDaysConfigSchema.safeParse(constraint.config);
  if (!parsed.success) {
    return null;
  }

  return {
    requirementType: constraint.constraintType,
    days: parsed.data.days,
    basis: parsed.data.basis,
  };
}

export function evaluateLotAgeMinDaysRequirement(params: {
  constraint: LotAgeMinDaysConstraint;
  requiredQuantity: number;
  eligibleQuantity: number;
  nextEligibleDate?: string | null;
}): RequirementViolationPayload {
  const days = params.constraint.config.days;
  const shortageQuantity = Math.max(
    0,
    params.requiredQuantity - params.eligibleQuantity
  );

  return {
    requirementId: params.constraint.id,
    requirementType: params.constraint.constraintType,
    status: shortageQuantity > 0 ? "block" : "pass",
    label: formatMinimumLotAgeRequirementLabel(days),
    message: lotAgeRequirementMessage(days),
    config: params.constraint.config,
    facts: {
      eligibleQuantity: params.eligibleQuantity,
      requiredQuantity: params.requiredQuantity,
      shortageQuantity,
    },
    overrideAllowed: true,
    overrideReasonRequired: false,
    nextEligibleDate: params.nextEligibleDate ?? null,
  };
}
