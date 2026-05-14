import type { InferredItemVisual, ItemColorFamily, ItemSpriteKind } from "./types";

type InferItemVisualInput = {
  itemType?: string | null;
  category?: string | null;
  unitName?: string | null;
  unitUom?: string | null;
  sku?: string | null;
  name?: string | null;
};

const KIND_HINTS: Array<{ kind: ItemSpriteKind; patterns: RegExp[] }> = [
  { kind: "pallet", patterns: [/pallet/i, /\bplt\b/i] },
  { kind: "drum", patterns: [/drum/i, /barrel/i] },
  { kind: "bucket", patterns: [/bucket/i, /pail/i] },
  { kind: "crate", patterns: [/crate/i, /case/i] },
  { kind: "tote", patterns: [/tote/i, /bin/i, /tray/i] },
  { kind: "roll", patterns: [/roll/i, /film/i, /label/i, /sticker/i] },
  { kind: "sack", patterns: [/sack/i, /burlap/i] },
  { kind: "bag-1cf", patterns: [/\b1\s*(?:cubic\s*foot|cu\s*ft|cf|cfb)\s*bag/i, /\b1cfb?\b/i, /bag[_\s-]*1cf/i] },
  { kind: "bag-2cf", patterns: [/\b2\s*(?:cubic\s*foot|cu\s*ft|cf|cfb)\s*bag/i, /\b2cfb?\b/i, /bag[_\s-]*2cf/i] },
  { kind: "bag", patterns: [/bag/i, /pouch/i, /packet/i] },
  { kind: "box", patterns: [/box/i, /carton/i, /pack/i] },
  { kind: "bulk", patterns: [/bulk/i, /soil/i, /compost/i, /mix/i, /aggregate/i] },
];

const COLOR_HINTS: Array<{ color: ItemColorFamily; patterns: RegExp[] }> = [
  { color: "green", patterns: [/soil/i, /plant/i, /seed/i, /organic/i, /fertil/i] },
  { color: "blue", patterns: [/liquid/i, /water/i, /solution/i, /clean/i] },
  { color: "amber", patterns: [/grain/i, /sand/i, /mulch/i, /label/i, /packaging/i] },
  { color: "purple", patterns: [/finished/i, /product/i, /blend/i, /kit/i] },
  { color: "red", patterns: [/hazard/i, /acid/i, /chemical/i, /fragile/i] },
  { color: "slate", patterns: [/part/i, /hardware/i, /component/i, /misc/i] },
];

function haystack(input: InferItemVisualInput) {
  return [
    input.itemType,
    input.category,
    input.unitName,
    input.unitUom,
    input.sku,
    input.name,
  ]
    .filter(Boolean)
    .join(" ");
}

function firstPatternMatch<T>(
  value: string,
  options: Array<{ patterns: RegExp[] } & T>
): T | null {
  return options.find((option) =>
    option.patterns.some((pattern) => pattern.test(value))
  ) ?? null;
}

export function inferItemVisual(input: InferItemVisualInput): InferredItemVisual {
  const text = haystack(input);
  const kindMatch = firstPatternMatch(text, KIND_HINTS);
  const colorMatch = firstPatternMatch(text, COLOR_HINTS);
  const kind = kindMatch?.kind;

  const fallbackKind: ItemSpriteKind =
    input.itemType === "material" ? "bag" : input.itemType === "product" ? "box" : "generic";
  const fallbackColor: ItemColorFamily =
    input.itemType === "material" ? "green" : input.itemType === "product" ? "purple" : "slate";
  const packagingColor: ItemColorFamily | null =
    kind === "bag-1cf" || kind === "bag-2cf" ? "green" : null;

  return {
    kind: kind ?? fallbackKind,
    color: colorMatch?.color ?? packagingColor ?? fallbackColor,
  };
}
