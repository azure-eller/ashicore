import { conversions, MeasureKind } from "convert/conversions";

// Practical units per category — symbols must match the convert library.
const ALLOWED_UNITS: Record<number, Set<string>> = {
  [MeasureKind.Volume]: new Set([
    "ml", "cl", "l", "kl", "m³",
    "cu in", "cu ft", "cu yd",
    "tsp", "tbsp", "fl oz", "c", "pt", "qt", "gal",
    "imp gal", "imp pt", "imp fl oz",
  ]),
  [MeasureKind.Mass]: new Set([
    "mg", "g", "kg", "t",
    "oz", "lb", "st", "short ton", "long ton",
  ]),
  [MeasureKind.Length]: new Set([
    "mm", "cm", "m", "km",
    "in", "ft", "yd", "mi",
  ]),
  [MeasureKind.Area]: new Set([
    "cm²", "m²", "km²", "ha", "ac",
    "sq in", "sq ft", "sq yd", "sq mi",
  ]),
};

export interface UomOption {
  value: string;
  label: string;
}

export interface UomGroup {
  category: string;
  options: UomOption[];
}

/**
 * Returns practical units of measure from the convert library,
 * grouped by category (Volume, Mass, Length, Area).
 */
export function getUomOptions(): UomGroup[] {
  const groups: UomGroup[] = [];

  for (const [kindKey, data] of conversions) {
    const allowed = ALLOWED_UNITS[kindKey as number];
    if (!allowed) continue;

    const category = MeasureKind[kindKey as number] as string;

    const options: UomOption[] = [];
    for (const unit of data.units) {
      const symbol = unit.symbols[0] ?? unit.names[0];
      if (!allowed.has(symbol)) continue;
      const name = unit.names[0];
      options.push({ value: symbol, label: `${name} (${symbol})` });
    }

    groups.push({ category, options });
  }

  return groups;
}
