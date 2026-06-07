---
title: Patterns
status: living
read_when: "before composing forms, tables, cards, dialogs, status cells, or loading states"
owns: "shared UI composition patterns"
---

# Patterns

## Forms

Use `Field` for label, hint, and error structure. Use React Hook Form where the surrounding feature already uses it. Keep business rules in API/domain code, not form components.

Use visible labels for ambiguous numeric fields. Placeholders are examples, not labels.

## Tables And Grids

Use `ERPDataGrid` for large operational lists. Use editable line-grid primitives for line items inside card pages.

Tables should prioritize scanning:

- Important names and totals can use stronger weight.
- IDs, dates, money, quantities, and row counts use mono.
- Status columns should use shared status blocks, not bespoke chips.
- Grid footers should contain useful state such as row count, sync, sort, filter, and version when available.

## Cards

Use `CardPage` for detail pages. Keep the card body scrollable when content can exceed the viewport. Do not add page-specific scroll containers unless the shared card primitive cannot express the layout.

## Dialogs And Menus

Use dialogs for decisions or complex edits. Use dropdown menus for compact state changes, linked-record drilldowns, and secondary commands.

## Status

Use `StatusBlock` for full-cell status in grids and line tables. Use `StatusDetailMenuTable` when a status needs supporting detail. Status colors are semantic; do not use them as decorative accents.

## Empty And Loading States

Prefer simple spinners or concise empty states. Do not add skeleton loaders unless a feature explicitly needs layout preservation during loading.

Empty grid states should explain what is missing and, where useful, provide the next action.
