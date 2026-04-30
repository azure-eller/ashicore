import type { BomComponentConstraintConfig } from "@/lib/db/schema";

export const LOT_AGE_MIN_DAYS_CONSTRAINT = "lot_age_min_days" as const;

export type LotAgeMinDaysConstraint = {
  constraintType: typeof LOT_AGE_MIN_DAYS_CONSTRAINT;
  config: BomComponentConstraintConfig;
  sortOrder: number;
};

export type BomComponentConstraint = LotAgeMinDaysConstraint;

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

export function getMinimumLotAgeDays(
  constraints: readonly BomComponentConstraint[] | null | undefined
) {
  const constraint = constraints?.find(
    (entry) => entry.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT
  );
  return constraint?.config.days ?? null;
}

export function formatComponentRequirement(
  constraint: BomComponentConstraint
) {
  if (constraint.constraintType === LOT_AGE_MIN_DAYS_CONSTRAINT) {
    return `Lot must be at least ${constraint.config.days} ${
      constraint.config.days === 1 ? "day" : "days"
    } old.`;
  }

  return "Component requirement.";
}

