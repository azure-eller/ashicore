---
title: UI cleanup pass
date: 2026-04-21
status: approved
---

# UI cleanup pass

Focused cleanup of recurring UI inconsistencies across inventory, manufacturing, sales, and shared surfaces. Scope is deliberately narrow — no schema or API changes unless a UI fix requires one.

## Tasks

### 1. Remove "Used On" column from inventory tables

- Drop the column from `app/(dashboard)/inventory/columns.tsx` (and any other list columns that include it).
- Keep the Used On data on the item detail page — that's where it belongs.

### 2. Clickable variant rows inside family expandable rows

- In the products/materials expandable row, variant rows should navigate to `/inventory/{segment}/{variantId}` on click (or via a linked cell).
- Match existing row-link pattern from the list table so hover/keyboard focus is consistent.

### 3. Sub-Assemblies in the Inventory sidebar

- Insert `Sub-Assemblies` entry in `components/app-sidebar.tsx`, between `Materials` and `Stocktakes`, pointing at `/inventory/sub-assemblies`.

### 4. Remove Manufacturing "Execution" top-nav tab and landing page

- Drop the `Execution` tab from `app/(dashboard)/manufacturing/manufacturing-header.tsx`.
- Delete `app/(dashboard)/manufacturing/execution/page.tsx`, `manufacturing-execution.tsx`, and `execution-queue.tsx` if nothing else imports them.
- Keep `app/(dashboard)/manufacturing/orders/[id]/execute/*` — that's where actual field execution lives.

### 5. Remove "Execution" (pick progress) column from the MO orders table

- Drop the `pickProgressStatus` column from `orders-table.tsx`.
- Update the MO status badge copy: `released` now renders as `In Progress` instead of `Released`. All other statuses unchanged.
- Delete `pick-progress-badge.tsx` if no other caller remains.

### 6. Inline stage-transition action in MO and SO tables

- Add an `Action` column (right-most, before the status column or at the end — TBD during impl) with a single primary button whose label and behavior depend on current status.

**MO button matrix:**
- `draft` → `Release` — inline POST to release endpoint. On 409 shortage, opens the existing shortage dialog; user confirms to continue. Invalidates `manufacturing-orders` query.
- `released` → `Execute` — navigates to `/manufacturing/orders/{id}/execute`.
- `completed` / `cancelled` → no button.

**SO button matrix:**
- `draft` → `Confirm` — inline POST to the confirm endpoint. Invalidates `sales-orders`.
- `confirmed` → `Ship` — opens a confirmation dialog (carries any oversell warnings). On confirm, POSTs ship endpoint.
- `shipped` / `cancelled` → no button.

Extract shared logic so the same helper drives the detail-page primary button.

### 7. Responsive dialogs

- Add a `size` prop to `DialogContent` in `components/ui/dialog.tsx`. Variants: `sm | md | lg | xl | 2xl | content`. Default stays `lg` to preserve existing widths.
- `content` = `w-fit max-w-[min(90vw,72rem)]` for content-sized dialogs (e.g. the shortage dialog with a table inside).
- Fix the known offender — the manufacturing shortage dialog — to use `size="xl"` (or `size="content"` if the table is wide).
- Document the pattern in CLAUDE.md under Coding Patterns.

### 8. Standardize detail page action bars

Three-zone action bar per detail page, in this order (right-aligned):

1. **Primary button** — next-stage action (same logic as the table button).
2. **Edit icon** — pencil icon with tooltip `Edit`. Hidden when record isn't editable.
3. **Kebab (⋮) menu** — secondary/destructive actions. Destructive styled destructive, at the bottom of the menu.

Per-page mapping:

| Page | Primary | Edit | Kebab |
|---|---|---|---|
| MO draft | Release | ✓ | Cancel, Delete |
| MO released | Execute | — | Cancel |
| MO completed/cancelled | — | — | Delete |
| SO draft | Confirm | ✓ | Cancel, Delete |
| SO confirmed | Ship | ✓ | Cancel |
| SO shipped/cancelled | — | — | — |
| PO ordered | Receive | ✓ | Cancel, Delete |
| Product / Material | — | ✓ | Delete |
| Customer / Supplier | — | ✓ | Delete |
| Stocktake draft | Complete | ✓ | Cancel, Delete |

Sub-assembly detail page follows the Product pattern.

## Out of scope

- Drawer-on-mobile dialog pattern (separate task if we want it).
- Packing slip / dedicated ship page for SO (currently a confirmation dialog).
- Any schema, DAL, or API changes beyond what's required to read current status for the buttons.

## Verification per task

- UI changes: `pnpm build` + `pnpm test`.
- Anything that mutates stock (MO release/execute, SO ship): `pnpm verify:inventory` after the relevant slow spec refreshes `test/.test-env.json`.
- Screenshot the before/after of the shortage dialog and the detail page action bars for the PR.
