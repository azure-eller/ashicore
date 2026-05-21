import type { ManufacturingOrderDetail } from "@/app/(dashboard)/manufacturing/types";

/**
 * The largest per-group output size across the order's group-consumed ingredients,
 * or null when the product isn't produced in fixed groups. Output must be entered in
 * multiples of this size (e.g. bags made 50 at a time).
 */
export function largestGroupSize(order: ManufacturingOrderDetail | null): number | null {
  if (!order) return null;
  const sizes = order.ingredients
    .filter(
      (ingredient) =>
        ingredient.consumptionMode === "per_group" &&
        ingredient.basisOutputQuantity != null,
    )
    .map((ingredient) => Number(ingredient.basisOutputQuantity))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (sizes.length === 0) return null;
  return Math.max(...sizes);
}
