import { normalizeNumeric, parseNumberOrZero, roundQuantity } from "@/lib/format";

export function toAllocationQuantity(value: string | number | null | undefined) {
  return parseNumberOrZero(value);
}

export function allocationQuantityString(value: number) {
  return normalizeNumeric(roundQuantity(Math.max(0, value)));
}
