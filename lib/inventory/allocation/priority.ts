import type { AllocationDemandType } from "./types";

export type AllocationDemandOrder = {
  demandType: AllocationDemandType;
  priorityRank: number | null;
  priorityDate: string | null;
  priorityLabel: string;
};

export const DEMAND_GROUP_RANK: Record<AllocationDemandType, number> = {
  manufacturing_order_ingredient: 0,
  sales_order_line: 1,
};

export function compareNullableNumber(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

export function compareNullableDate(left: string | null, right: string | null) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

export function compareDemandOrder<T extends AllocationDemandOrder>(
  left: T,
  right: T
) {
  const groupCompare =
    DEMAND_GROUP_RANK[left.demandType] - DEMAND_GROUP_RANK[right.demandType];
  if (groupCompare !== 0) return groupCompare;
  const rankCompare = compareNullableNumber(left.priorityRank, right.priorityRank);
  if (rankCompare !== 0) return rankCompare;
  const dateCompare = compareNullableDate(left.priorityDate, right.priorityDate);
  if (dateCompare !== 0) return dateCompare;
  return left.priorityLabel.localeCompare(right.priorityLabel, undefined, {
    numeric: true,
  });
}
