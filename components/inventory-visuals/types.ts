export const ITEM_SPRITE_KINDS = [
  "bag-1cf",
  "bag-2cf",
  "bag",
  "box",
  "crate",
  "tote",
  "pallet",
  "drum",
  "bucket",
  "sack",
  "bulk",
  "roll",
  "generic",
] as const;

export type ItemSpriteKind = (typeof ITEM_SPRITE_KINDS)[number];

export const ITEM_VISUAL_STATES = [
  "available",
  "allocated",
  "inbound",
  "reserved",
  "hold",
  "quarantine",
  "shortage",
  "selected",
] as const;

export type ItemVisualState = (typeof ITEM_VISUAL_STATES)[number];

export const ITEM_COLOR_FAMILIES = [
  "amber",
  "green",
  "blue",
  "slate",
  "purple",
  "red",
] as const;

export type ItemColorFamily = (typeof ITEM_COLOR_FAMILIES)[number];

export const ITEM_VISUAL_SIZES = ["xs", "sm", "md", "lg"] as const;

export type ItemVisualSize = (typeof ITEM_VISUAL_SIZES)[number];

export type InferredItemVisual = {
  kind: ItemSpriteKind;
  color: ItemColorFamily;
};
