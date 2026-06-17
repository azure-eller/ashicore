---
title: Foundations
status: living
read_when: "before changing the visual language, introducing a new UI convention, or adding/referencing a design token"
owns: "design intent and the token source-of-truth rule: density, color semantics, typography roles, corners, motion, and tokens"
---

# Foundations

## Tokens

App-wide runtime token values live only in [app/styles/theme.css](../../app/styles/theme.css). Docs name tokens and explain when to use them; they must not restate raw values. Need an exact color, size, radius, height, font, shadow, or duration? Read `app/styles/theme.css`.

Raw color literals belong only in `app/styles/theme.css`. Prefer the primitive `--paint-*` palette and semantic aliases; handoff-calibrated neutrals and chip tones may also live there as named semantic tokens. When a component needs a new surface, state, border, or text treatment, add a semantic alias or derive it with `color-mix()`. When a token is missing, add it to `app/styles/theme.css`, use it in code, and update the relevant intent doc only if the meaning changed.

## Values

The ERP UI should feel operational, dense, calm, and durable. Users scan rows, compare statuses, edit forms, and repeat workflows all day. The interface should reduce visual noise without hiding important state.

## Density

Use readable density by default. The system intentionally favors more rows and less ceremony than marketing UI, but it must remain scannable for real customer, order, inventory, and manufacturing data.

Use shared height and spacing tokens from [app/styles/theme.css](../../app/styles/theme.css). Do not tune row height, toolbar height, or input height per page unless a new shared token or component variant is warranted.

The current scale is deliberately larger than the small-canvas handoff while keeping the same proportions. Do not shrink type, icons, nav, or table rows locally to recover the older compact density.

## Color Semantics

Use color to encode state and hierarchy, not decoration.

- Raw color values are centralized in `app/styles/theme.css`; component and page code must consume named tokens, not literals.
- Components use semantic aliases (`--color-*`, `--status-*`, `--chrome-*`, shadcn bridge tokens) instead of referencing primitive paints directly.
- The app frame uses a neutral hierarchy: light canvas, white operational cells, grey table headers, and steel chrome/subnav surfaces. Use the semantic surface and chrome tokens that encode those roles.
- `--color-accent` is the single product accent for primary actions, active navigation, focus, and selected controls.
- Success means ready, complete, available, shipped, or healthy.
- Warning means expected, partial, in progress, or needs attention.
- Danger means blocked, missing, destructive, or failed.
- Muted means inactive, not applicable, not started, or not shipped.
- Inline status chips and labels use the soft chip tokens consistently; framed status cells use the stronger status tokens.

Do not invent local palettes. If a state does not fit the existing semantic set, clarify the state model before adding color.

## Typography Roles

Use the shared font variables from [app/styles/theme.css](../../app/styles/theme.css).

- Display role: brand wordmark and page-level display moments.
- Body/UI role: prose, nav, controls, labels, customer names, notes, and readable words.
- Mono role: IDs, totals, dates, counts, quantities, and other tabular data.

All three roles currently resolve to Space Grotesk. Keep using the role variables and `font-mono` for tabular/numeric semantics; do not import a separate monospace face locally.

If a component needs a new size, add a named token in `app/styles/theme.css` and reference the token. Do not scatter one-off text sizes.

## Corners

Use radius tokens. Do not hard-code corner radii in page code. Circles and dots use circular geometry; everything else follows the shared token system.

## Motion And Shadow

Motion should clarify state changes and focus, not decorate. Shadows are reserved for overlays and elevation that affects interaction. Tables and cards should rely primarily on surfaces, borders, and contrast.
