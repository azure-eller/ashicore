import {
  LOT_AGE_MIN_DAYS_REQUIREMENT,
  createLotAgeMinDaysRequirement,
  evaluateLotAgeMinDaysRequirement,
  formatComponentRequirement as formatRequirement,
  formatMinimumLotAgeRequirementLabel,
  getMinimumLotAgeDays as getMinimumLotAgeRequirementDays,
  normalizeMinimumLotAgeDays,
  summarizeComponentRequirements as summarizeRequirements,
  toPlanningComponentRequirement as requirementToPlanningComponentRequirement,
  type BomComponentRequirement,
  type LotAgeMinDaysRequirement,
  type LotAgeMinDaysRequirementConfig,
  type RequirementEvaluationResult,
  type RequirementViolationPayload,
} from "./requirements";

export const LOT_AGE_MIN_DAYS_CONSTRAINT = LOT_AGE_MIN_DAYS_REQUIREMENT;

export type LotAgeMinDaysConstraint = Omit<
  LotAgeMinDaysRequirement,
  "requirementType"
> & {
  constraintType: typeof LOT_AGE_MIN_DAYS_CONSTRAINT;
};

export type BomComponentConstraint = LotAgeMinDaysConstraint;
export type BomComponentConstraintType = BomComponentConstraint["constraintType"];
export type BomComponentConstraintConfig = LotAgeMinDaysRequirementConfig;
export type { RequirementEvaluationResult, RequirementViolationPayload };

function toRequirement(
  constraint: BomComponentConstraint
): BomComponentRequirement {
  return {
    id: constraint.id,
    requirementType: constraint.constraintType,
    config: constraint.config,
    sortOrder: constraint.sortOrder,
  };
}

export function createLotAgeMinDaysConstraint(
  days: number | null | undefined
): LotAgeMinDaysConstraint | null {
  const requirement = createLotAgeMinDaysRequirement(days);
  if (!requirement) return null;

  return {
    constraintType: requirement.requirementType,
    config: requirement.config,
    sortOrder: requirement.sortOrder,
  };
}

export function getMinimumLotAgeDays(
  constraints: readonly BomComponentConstraint[] | null | undefined
) {
  return getMinimumLotAgeRequirementDays(constraints?.map(toRequirement));
}

export function formatComponentRequirement(
  constraint: BomComponentConstraint
) {
  return formatRequirement(toRequirement(constraint));
}

export function formatMinimumLotAgeRequirement(days: number) {
  return `>= ${days} ${days === 1 ? "day" : "days"} age requirement`;
}

export function formatMinimumLotAgeRequirementViolation(days: number) {
  return `Ingredient does not match the ${formatMinimumLotAgeRequirement(days)}.`;
}

export function summarizeComponentRequirements(
  constraints: readonly BomComponentConstraint[] | null | undefined
) {
  return summarizeRequirements(constraints?.map(toRequirement));
}

export function toPlanningComponentRequirement(
  constraint: BomComponentConstraint
) {
  return requirementToPlanningComponentRequirement(toRequirement(constraint));
}

export {
  evaluateLotAgeMinDaysRequirement,
  formatMinimumLotAgeRequirementLabel,
  normalizeMinimumLotAgeDays,
};
