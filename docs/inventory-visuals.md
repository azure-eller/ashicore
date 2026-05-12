---
read_when:
  - Adding or changing inventory visual sprites
  - Using ItemSprite, ItemToken, or ItemTokenStack
  - Reviewing allocation visual language
---

# Inventory Visuals

## Components

- `ItemSprite` draws the object only. Use it for plain item identity.
- `ItemToken` adds UI chrome: state ring, quantity, lot code, and overlays.
- `ItemTokenStack` shows repeated compact tokens with `+N` overflow.

Import public APIs from the barrel:

```tsx
import {
  ItemSprite,
  ItemToken,
  ItemTokenStack,
  inferItemVisual,
} from "@/components/inventory-visuals";
```

## Sprite Kinds

- `bag`, `sack`, `bulk`: loose materials and bagged inputs.
- `box`, `crate`, `tote`: packaged goods, cases, bins, and reusable containers.
- `pallet`: palletized supply or large grouped stock.
- `drum`, `bucket`: liquids, pails, and cylindrical containers.
- `roll`: labels, film, stickers, and rolled packaging.
- `generic`: fallback when no stronger identity is known.

## Color And State

`inferItemVisual()` only infers stable identity: `kind` and `color`. Callers pass `state` separately so the same item remains recognizable when it is inbound, held, allocated, or short.

Wrapper UI uses semantic tokens. SVG art colors live in the sprite component palette map; do not scatter raw colors through individual paths.

Prefer explicit visuals when a workflow already knows the container type. Use inference for search results, tables, and transitional read models where no curated visual has been stored yet.

Examples:

```tsx
<ItemSprite kind="drum" color="blue" size="sm" />
<ItemToken kind="bag" color="green" state="reserved" quantity="12" lotCode="L-24" />
<ItemToken kind="bag" color="green" state="reserved" selected quantity="12" />
<ItemToken kind="drum" color="red" state="shortage" selected quantity="2" />
<ItemTokenStack count={9} maxVisible={4} kind="box" color="amber" state="allocated" />
```

## State Semantics

- `available`: identity only, no operational warning.
- `allocated`: assigned to a demand path.
- `reserved`: committed or protected from free stock.
- `inbound`: expected supply; keep base identity unchanged.
- `hold`: temporarily unavailable, muted but still identifiable.
- `quarantine`: isolated/caution stock, stronger than hold.
- `shortage`: urgent exception state; do not rely on red item color alone.
- `selected`: interaction focus, not an inventory condition.

Operational state and selection are separate. Prefer `state="reserved" selected` over `state="selected"` so reserved, shortage, hold, and quarantine cues remain visible when a token is focused. `state="selected"` is accepted for older call sites and behaves like `state="available" selected`.

## Small Sizes

At `xs` and `sm`, silhouette matters more than interior detail. Lot codes are hidden at those sizes so quantity and object shape remain readable. A kind should still be recognizable at `sm` with a quantity badge.

## Contribution Rules

- Keep the shared `viewBox`, stroke style, lighting direction, and isometric-ish angle.
- Build new sprites from shared primitives where practical.
- Check every kind at `xs`, `sm`, `md`, and `lg`.
- Check every visual state in the demo matrix before integrating into product UI.
- Check light and dark screenshots before product integration.
- Verify `reserved`, `hold`, `quarantine`, and `shortage` without relying on color alone.
- Verify selected operational tokens such as selected reserved and selected shortage.
- Verify red sprites in both normal and shortage states.
- Do not add external image assets, emoji, icon-pack product shapes, or runtime dependencies.
