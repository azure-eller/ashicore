---
title: Foundations
status: living
read_when: "before changing the visual language or introducing a new UI convention"
owns: "design intent for density, color semantics, typography roles, corners, and motion"
---

# Foundations

## Values

The ERP UI should feel operational, dense, calm, and durable. Users scan rows, compare statuses, edit forms, and repeat workflows all day. The interface should reduce visual noise without hiding important state.

## Density

Use readable density by default. The system intentionally favors more rows and less ceremony than marketing UI, but it must remain scannable for real customer, order, inventory, and manufacturing data.

Use shared height and spacing tokens from [app/styles/theme.css](../../app/styles/theme.css). Do not tune row height, toolbar height, or input height per page unless a new shared token or component variant is warranted.

## Color Semantics

Use color to encode state and hierarchy, not decoration.

- Raw color values are limited to the primitive paint palette in `app/styles/theme.css`: white, ink, chrome grey, table/header grey, accent yellow, success green, and danger red.
- Components use semantic aliases (`--color-*`, `--status-*`, `--chrome-*`, shadcn bridge tokens) instead of referencing primitive paints directly.
- `--color-accent` is the single product accent for primary actions, active navigation, focus, and selected controls.
- Success means ready, complete, available, shipped, or healthy.
- Warning means expected, partial, in progress, or needs attention.
- Danger means blocked, missing, destructive, or failed.
- Muted means inactive, not applicable, not started, or not shipped.

Do not invent local palettes. If a state does not fit the existing semantic set, clarify the state model before adding color.

## Typography Roles

Use the shared font variables from [app/styles/theme.css](../../app/styles/theme.css).

- Display font: brand wordmark only.
- Body/UI font: prose, nav, controls, labels, customer names, notes, and readable words.
- Mono font: IDs, totals, dates, counts, quantities, and other tabular data.

If a component needs a new size, add a named token in `app/styles/theme.css` and reference the token. Do not scatter one-off text sizes.

## Corners

Use radius tokens. Do not hard-code corner radii in page code. Circles and dots use circular geometry; everything else follows the shared token system.

## Motion And Shadow

Motion should clarify state changes and focus, not decorate. Shadows are reserved for overlays and elevation that affects interaction. Tables and cards should rely primarily on surfaces, borders, and contrast.
