import { normalizeNumeric, roundQuantity } from "@/lib/format";

export function toAllocationQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function allocationQuantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}
