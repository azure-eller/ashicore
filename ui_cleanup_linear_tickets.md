# UI Cleanup Linear Ticket Drafts

These are paste-ready Linear issue drafts based on `ui_cleanup.md`. They are
intentionally scoped as sequenced implementation tickets rather than one broad
UI cleanup issue.

## 1. Standardize Dashboard Shells And Panel Primitives

Priority: High

Description:

Create the first layer of shared layout primitives for dashboard, list, detail,
and settings pages.

Scope:

- Standardize module/page shells for Sales, Manufacturing, Inventory,
  Purchasing, and Settings.
- Decide ownership between `CreatePageShell`, `CardPageHeader`,
  `DetailPageActions`, `CreateSection`, shadcn `Card`, and any new dense panel
  primitive.
- Migrate a small representative set of pages.
- Update `docs/reusable-components.md` with the blessed page/header/panel
  patterns.

Reference audit sections:

- 1. Dashboard Module Layout Shell
- 2. Detail Page Header / Actions
- 3. Section Card / Panel Surface
- 36. Card Page And Settings Panel Primitives
- 51. Settings Key-Value Rows

Acceptance criteria:

- New shared shell/panel primitives exist only where needed.
- Sales, Manufacturing, Inventory, and Purchasing module layouts use the same
  page gutter/density convention.
- Settings panel pattern is documented.
- No unrelated UI restyling.
- Browser verification covers representative pages with seeded data.

## 2. Define Compact Table Primitives And Migrate Small Tables

Priority: High

Description:

Create a clear split between large operational grids and small read-only,
dialog, and report tables.

Scope:

- Keep `ERPDataGrid` / `ERPDataGridList` as the default for large operational
  datasets.
- Add a compact table primitive for read-only summaries, dialog selections, and
  report/import tables.
- Standardize header density, numeric alignment, empty rows, overflow handling,
  and optional sticky header behavior.
- Migrate two to four obvious call sites only.

Reference audit sections:

- 4. Read-Only Operational Tables
- 9. Dropdown Mini Tables / Coverage Popovers
- 53. Native Compact Tables And Table Fragments
- 23. Accounting / Xero Sync UI
- 41. Settings And Integration Local Components

Candidate call sites:

- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`

Acceptance criteria:

- Compact table primitive is documented.
- Migrated tables preserve behavior and data.
- AG Grid usage guidance is not weakened.
- Browser verification covers at least one migrated table.

## 3. Create Shared Grid Cell And Column Helpers

Priority: High

Description:

Reduce bespoke AG Grid renderers and formatting helpers by adding shared cell
and column utilities.

Scope:

- Add shared helpers for entity links, date/date-time, money, quantities, mono
  text, and truncated tooltip text.
- Prefer existing `lib/format.ts` and `DateTimeText` where appropriate.
- Migrate a small representative set of columns across Sales, Manufacturing,
  Purchasing, and Inventory.
- Keep behavior stable: sorting, filtering, and quick-filter text should not
  regress.

Reference audit sections:

- 5. AG Grid Link / Identity Cells
- 6. AG Grid Date / Number / Money Columns
- 10. Notes / Long Text Tooltip Cell
- 11. Filter Header / Toolbar Controls
- 37. Date And Date-Time Field Variants

Candidate helpers:

- `GridEntityLinkCell`
- `GridTooltipTextCell`
- `dateColumn`
- `dateTimeColumn`
- `moneyColumn`
- `quantityColumn`
- `monoTextColumn`

Acceptance criteria:

- Shared helpers live beside existing grid components/toolbox.
- At least three repeated local renderers/formatters are removed.
- Quick-filter text and value formatting still work.
- Docs explain when to use each helper.

## 4. Standardize Status Labels, Tags, And Action Menus

Priority: High

Description:

Clarify status, tag, and action semantics and reduce raw `Badge` / local
dropdown menu drift.

Scope:

- Define the standard for true domain status labels using `StatusLabel`.
- Separate metadata tags/chips from workflow statuses.
- Add or standardize access/role/permission badge primitives for Settings.
- Add shared row/detail action menu primitives with destructive ordering and
  disabled behavior.
- Migrate a narrow but representative set of call sites.

Reference audit sections:

- 7. Status Labels / Badges
- 8. Status Block Cells / Actionable Fulfillment Cells
- 16. Dropdown Action Menus
- 26. Button And Link Action Types
- 42. Attribute And Metadata Tags
- 50. Access, Role, And Permission Badges

Acceptance criteria:

- Docs distinguish status labels, tags, and access badges.
- Raw `Badge` is removed from at least a few true-status call sites.
- Row action menus share sizing, alignment, and destructive placement.
- No business mutation behavior changes.

## 5. Consolidate Address, Entity, Select, And Date Field Patterns

Priority: Medium-High

Description:

Reduce form and inline field divergence across card pages, purchasing, sales,
and settings.

Scope:

- Extend existing shared components before creating new ones.
- Broaden `DeliveryAddressInput` or rename/extract into a canonical
  address-book combobox.
- Extend `EntityCombobox` for common option slots, popup widths, create links,
  secondary text, and clear behavior.
- Add form-bound and inline select/date field wrappers if needed.
- Audit route-level native `<input>` / `<select>` usage and move through shared
  primitives where appropriate.

Reference audit sections:

- 12. Editable Line Field Types
- 13. Address Comboboxes
- 14. Generic Entity Comboboxes
- 15. Select Fields
- 28. Form Field Composition And Validation Errors
- 37. Date And Date-Time Field Variants
- 62. Native Form Element Escape Hatches

Candidate call sites:

- `components/delivery-address-input.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/purchasing/supplier-card.tsx`
- `components/entity-combobox.tsx`

Acceptance criteria:

- Shared field path is documented.
- Purchase order, customer, and supplier address selection no longer duplicate
  core combobox behavior.
- Focus, disabled, validation, and density states are consistent.
- Browser verification covers create/edit flows using migrated fields.

## 6. Standardize Bulk Selection, Reorder, And Persisted View Controls

Priority: Medium

Description:

Create shared visible controls for grid selection, bulk actions,
priority/reorder, and view preferences.

Scope:

- Keep `ERPDataGrid` as the selection foundation.
- Extract visible bulk toolbar/count/confirm/select-all pieces.
- Define a first-class reorder/priority handle pattern for grid and
  editable-line use.
- Standardize column visibility/view preference controls around
  `lib/view-preferences.ts`.
- Add a small keyboard/gesture hint primitive if needed.

Reference audit sections:

- 58. Bulk Selection And Bulk Action Bars
- 59. Reorder, Priority, And Drag Handles
- 60. View Preferences, Column Visibility, And Persistent View State
- 61. Keyboard Shortcuts And Multi-Select Interaction Hints
- 57. Under-Adopted Shared Primitives

Acceptance criteria:

- Bulk action UI is shared by at least two list pages or dialogs.
- Reorder handle behavior has one documented pattern.
- View preference controls use the existing preference foundation.
- Multi-select/reorder copy is consistent across migrated surfaces.

## 7. Decide Under-Adopted Shared Primitives

Priority: Medium

Description:

Review existing shared UI primitives with low adoption and decide whether each
should be promoted, extended, or removed.

Scope:

- Inspect current usage and intended purpose.
- For each primitive, choose one outcome: promote/document, extend/migrate, or
  delete.
- Avoid adding new components in this ticket unless required to finish the
  decision.
- Update `docs/reusable-components.md`.

Reference audit sections:

- 54. Local Duplicates Of Existing Shared Utilities
- 57. Under-Adopted Shared Primitives

Components to review:

- `components/disabled-tooltip-button.tsx`
- `components/detail-page-actions.tsx`
- `components/data-table-status-filter.tsx`
- `components/sortable-reorder.tsx`
- `components/tooltip-header.tsx`
- `components/sortable-header.tsx`
- `components/filterable-header.tsx`

Acceptance criteria:

- Each reviewed primitive has a documented decision.
- Dead primitives are removed only if no current/future owner exists.
- Promoted primitives have at least one migrated or confirmed call site.
- Future agents can tell which component to use.

## 8. Standardize Feedback States, Confirmations, And Save Indicators

Priority: Medium

Description:

Unify loading, empty, error, destructive confirmation, browser alert, and
save-status patterns.

Scope:

- Add or standardize inline/panel empty states.
- Add or standardize notice/error/result surfaces.
- Replace browser-native alerts/confirms where appropriate.
- Standardize save/pending indicators for card/detail workflows.
- Keep copy concise and avoid introducing new instructional UI text.

Reference audit sections:

- 17. Empty / Loading / Error States
- 27. Destructive Confirmation Patterns
- 30. Loading And Pending States
- 35. Browser-Native Alerts And Blocking Warnings
- 46. Error, Notice, And Result Surfaces
- 47. Save Status Indicators

Acceptance criteria:

- At least one browser-native confirmation/alert flow is migrated to the
  standard pattern.
- Empty/loading/error states use shared primitives on migrated surfaces.
- Save status has one documented visual pattern.
- Destructive copy/order is consistent.

## 9. Clean Up Settings, Xero, And Integration Workflow UI

Priority: Medium

Description:

Treat Settings, Xero, and integration screens as a coherent workflow area
instead of isolated local components.

Scope:

- Standardize settings key-value rows, provider/integration cards, import
  preview tables, sync panels, and report rows.
- Reuse compact table and panel primitives from earlier tickets.
- Avoid changing OAuth, sync, import, or accounting behavior.
- Migrate only after shell/panel/table primitives exist.

Reference audit sections:

- 23. Accounting / Xero Sync UI
- 41. Settings And Integration Local Components
- 46. Error, Notice, And Result Surfaces
- 50. Access, Role, And Permission Badges
- 51. Settings Key-Value Rows

Candidate call sites:

- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/agent-access-section.tsx`
- `components/accounting-sync-status.tsx`

Acceptance criteria:

- Settings rows/cards share primitives.
- Import/report/sync panels preserve behavior.
- Settings UI is visually consistent with dashboard/card patterns.
- Browser verification covers settings integrations and Xero import surfaces.

## 10. Extract Sales Allocation Matrix Primitives

Priority: Medium-Low

Description:

Perform a focused second pass on the sales allocation UI and extract reusable
matrix/progress controls.

Scope:

- Audit sales allocation CSS modules and related components.
- Identify reusable allocation grid/matrix, progress/meter, legend, and view
  toggle patterns.
- Extract only the controls that have clear reuse or major local complexity.
- Preserve allocation behavior and persisted preferences.

Reference audit sections:

- 39. Progress Bars, Timelines, And Legends
- 40. Sales Allocation Matrix Controls
- 52. Inline Style And Hardcoded Layout Exceptions
- 60. View Preferences, Column Visibility, And Persistent View State

Candidate call sites:

- `app/(dashboard)/sales/sales-allocation-table.tsx`
- `app/(dashboard)/sales/sales-order-allocator.tsx`
- `app/api/preferences/sales-orders-allocator/route.ts`

Acceptance criteria:

- Allocation-specific visual primitives are separated from generic grid/table
  primitives.
- Dynamic progress widths/styles are hidden behind named components where
  appropriate.
- Existing allocation interactions and preferences continue to work.
- Browser verification covers allocator and allocation table.

## 11. Establish Browser/PDF/Email Renderer Boundaries

Priority: Low

Description:

Document and begin separating browser UI primitives from PDF and email component
systems.

Scope:

- Do not try to reuse shadcn/browser UI in PDF or email renderers.
- Define when PDF-only primitives should be created.
- Define the email template component direction around existing `EmailLayout`.
- Migrate only if there is an obvious duplicate with low risk.

Reference audit sections:

- 55. Generated Document Templates
- 56. Email Template Systems

Candidate files:

- `lib/pdf/bol-document.tsx`
- `lib/email/components/layout.tsx`
- `lib/email/components/daily-manufacturing-report.tsx`
- `lib/email/accounting-documents.ts`

Acceptance criteria:

- Docs explain browser vs PDF vs email primitive boundaries.
- Existing BOL/email rendering remains unchanged unless safely migrated.
- Accounting raw HTML email cleanup is planned or partially migrated only after
  shared email primitives exist.

## 12. CSS Module, Inline Style, And Hardcoded Layout Audit

Priority: Low

Description:

Do a focused cleanup of remaining raw styling exceptions after shared primitives
exist.

Scope:

- Review CSS modules and inline styles called out in the audit.
- Keep legitimate dynamic visualization styles, but hide them behind named
  components where possible.
- Replace static spacing/color/z-index/margin style objects with token-backed
  classes or component props.
- Avoid broad visual redesign.

Reference audit sections:

- 20. Raw CSS Modules For Card/Workflow Styling
- 21. Rounded / Shadow / Hardcoded Color Drift
- 22. Inventory Visual Components
- 52. Inline Style And Hardcoded Layout Exceptions
- 48. Unclassified Imported UI Primitives

Acceptance criteria:

- Static inline style exceptions are reduced.
- Remaining dynamic styles are intentional and documented by component
  ownership.
- No hardcoded Tailwind color drift is introduced.
- Browser verification covers affected visual surfaces.
