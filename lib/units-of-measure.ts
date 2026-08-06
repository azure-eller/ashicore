import { conversions, MeasureKind } from "convert/conversions";
import { convert, getMeasureKind } from "convert";

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

const COUNT_UNITS = new Set(["ea", "pcs"]);

function isCountUnit(uom: string) {
  return COUNT_UNITS.has(uom);
}

export interface UomOption {
  value: string;
  label: string;
}

export interface UomGroup {
  category: string;
  options: UomOption[];
}

export type UnitDefinitionOption = {
  id: string;
  name: string;
  size: string;
  uom: string;
};

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

  groups.push({
    category: "Count",
    options: [
      { value: "pcs", label: "pieces (pcs)" },
      { value: "ea", label: "each (ea)" },
    ],
  });

  return groups;
}

export function areUnitsCompatible(sourceUom: string, targetUom: string) {
  if (sourceUom === targetUom) {
    return true;
  }

  if (isCountUnit(sourceUom) || isCountUnit(targetUom)) {
    return isCountUnit(sourceUom) && isCountUnit(targetUom);
  }

  try {
    return getMeasureKind(sourceUom) === getMeasureKind(targetUom);
  } catch {
    return false;
  }
}

export function deriveUnitToStockFactor(
  sourceUnit: Pick<UnitDefinitionOption, "size" | "uom">,
  stockingUnit: Pick<UnitDefinitionOption, "size" | "uom">
) {
  if (!areUnitsCompatible(sourceUnit.uom, stockingUnit.uom)) {
    return null;
  }

  if (sourceUnit.uom === stockingUnit.uom || (isCountUnit(sourceUnit.uom) && isCountUnit(stockingUnit.uom))) {
    const sourceSize = Number(sourceUnit.size);
    const stockingSize = Number(stockingUnit.size);

    if (!Number.isFinite(sourceSize) || !Number.isFinite(stockingSize) || stockingSize <= 0) {
      return null;
    }

    return sourceSize / stockingSize;
  }

  let convertedSourceSize: number;
  try {
    convertedSourceSize = Number(
      convert(
        Number(sourceUnit.size),
        sourceUnit.uom as Parameters<typeof convert>[1]
      ).to(stockingUnit.uom as Parameters<ReturnType<typeof convert>["to"]>[0])
    );
  } catch {
    return null;
  }
  const stockingSize = Number(stockingUnit.size);

  if (!Number.isFinite(convertedSourceSize) || !Number.isFinite(stockingSize) || stockingSize <= 0) {
    return null;
  }

  return convertedSourceSize / stockingSize;
}

export function derivePurchaseToStockFactor(
  purchaseUnit: Pick<UnitDefinitionOption, "size" | "uom">,
  stockingUnit: Pick<UnitDefinitionOption, "size" | "uom">
) {
  return deriveUnitToStockFactor(purchaseUnit, stockingUnit);
}
