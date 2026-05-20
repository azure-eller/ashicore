import { z } from "zod";

export const LOT_AGE_MIN_DAYS_REQUIREMENT = "lot_age_min_days" as const;

export const BOM_REQUIREMENT_TYPES = [LOT_AGE_MIN_DAYS_REQUIREMENT] as const;
export type BomRequirementType = (typeof BOM_REQUIREMENT_TYPES)[number];

export const lotAgeMinDaysConfigSchema = z.object({
  days: z.number().int().positive(),
  basis: z.literal("received_at"),
});

export type LotAgeMinDaysRequirementConfig = z.infer<
  typeof lotAgeMinDaysConfigSchema
>;

export type LotAgeMinDaysRequirement = {
  id?: string;
  requirementType: typeof LOT_AGE_MIN_DAYS_REQUIREMENT;
  config: LotAgeMinDaysRequirementConfig;
  sortOrder: number;
};

export type BomComponentRequirement = LotAgeMinDaysRequirement;

export type RequirementEvaluationStatus =
  | "pass"
  | "warning"
  | "block"
  | "needs_override";

export type RequirementEvaluationResult = {
  requirementId?: string;
  requirementType: BomRequirementType;
  status: RequirementEvaluationStatus;
  label: string;
  message: string;
  facts: Record<string, unknown>;
  overrideAllowed: boolean;
  overrideReasonRequired: boolean;
};

export type RequirementViolationPayload = RequirementEvaluationResult & {
  config: BomComponentRequirement["config"];
  nextEligibleDate?: string | null;
};

export type PlanningComponentRequirement = {
  requirementType: typeof LOT_AGE_MIN_DAYS_REQUIREMENT;
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

export function createLotAgeMinDaysRequirement(
  days: number | null | undefined
): LotAgeMinDaysRequirement | null {
  if (days == null || days <= 0) return null;

  return {
    requirementType: LOT_AGE_MIN_DAYS_REQUIREMENT,
    config: { days, basis: "received_at" },
    sortOrder: 0,
  };
}

export function isLotAgeMinDaysRequirement(
  requirement: BomComponentRequirement
): requirement is LotAgeMinDaysRequirement {
  return requirement.requirementType === LOT_AGE_MIN_DAYS_REQUIREMENT;
}

export function getMinimumLotAgeDays(
  requirements: readonly BomComponentRequirement[] | null | undefined
) {
  const requirement = requirements?.find(isLotAgeMinDaysRequirement);
  return requirement?.config.days ?? null;
}

export function formatMinimumLotAgeRequirementLabel(days: number) {
  return `Age ≥ ${days}d`;
}

export function formatMinimumLotAgeRequirement(days: number) {
  return `Lots must be at least ${days} ${days === 1 ? "day" : "days"} old based on received date.`;
}

export function formatMinimumLotAgeRequirementViolation(days: number) {
  return formatMinimumLotAgeRequirement(days);
}

export function formatComponentRequirement(
  requirement: BomComponentRequirement
) {
  if (isLotAgeMinDaysRequirement(requirement)) {
    return formatMinimumLotAgeRequirement(requirement.config.days);
  }

  return "Component requirement.";
}

export function summarizeComponentRequirements(
  requirements: readonly BomComponentRequirement[] | null | undefined
) {
  if (!requirements || requirements.length === 0) {
    return "None";
  }

  const firstRequirement = requirements[0];
  const firstLabel = isLotAgeMinDaysRequirement(firstRequirement)
    ? formatMinimumLotAgeRequirementLabel(firstRequirement.config.days)
    : "Requirement";

  if (requirements.length === 1) {
    return firstLabel;
  }

  return `${firstLabel} +${requirements.length - 1}`;
}

export function toPlanningComponentRequirement(
  requirement: BomComponentRequirement
): PlanningComponentRequirement | null {
  if (!isLotAgeMinDaysRequirement(requirement)) {
    return null;
  }

  const parsed = lotAgeMinDaysConfigSchema.safeParse(requirement.config);
  if (!parsed.success) {
    return null;
  }

  return {
    requirementType: requirement.requirementType,
    days: parsed.data.days,
    basis: parsed.data.basis,
  };
}

export function evaluateLotAgeMinDaysRequirement(params: {
  requirementId?: string;
  requirement: LotAgeMinDaysRequirement;
  requiredQuantity: number;
  eligibleQuantity: number;
  nextEligibleDate?: string | null;
}): RequirementViolationPayload {
  const days = params.requirement.config.days;
  const shortageQuantity = Math.max(
    0,
    params.requiredQuantity - params.eligibleQuantity
  );

  return {
    requirementId: params.requirementId ?? params.requirement.id,
    requirementType: params.requirement.requirementType,
    status: shortageQuantity > 0 ? "block" : "pass",
    label: formatMinimumLotAgeRequirementLabel(days),
    message: formatMinimumLotAgeRequirement(days),
    config: params.requirement.config,
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
