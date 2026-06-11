---
title: Components
status: living
read_when: "before building or reaching for any UI primitive"
owns: "the catalog of reusable components and when to use each"
---

# Components

Prefer existing primitives. Props and implementation details live in the linked source files; this catalog explains selection and boundaries.

| Component | Source | Use When |
|---|---|---|
| `Button` | [components/ui/button.tsx](../../components/ui/button.tsx) | Commands, primary actions, destructive actions, icon buttons through size variants |
| `Input` / `Textarea` / `Select` / `Combobox` | [components/ui](../../components/ui) | Standard form controls |
| `Field` | [components/ui/field.tsx](../../components/ui/field.tsx) | Form label, error, hint, and accessible field grouping |
| `CardPage` | [components/card-page/card-page.tsx](../../components/card-page/card-page.tsx) | Full-page/detail-card editing surfaces |
| `CardField` / `FormCell` | [components/card-page](../../components/card-page) | Card-page field layout and inline editing |
| `AddressBookInput` / `useAddressBookDialog` | [components/card-page/address-book.tsx](../../components/card-page/address-book.tsx) | Org address-book pickers on cards: saved-address combobox plus the add/edit dialog lifecycle |
| `ERPDataGrid` | [components/erp-data-grid.tsx](../../components/erp-data-grid.tsx) | Large operational lists backed by AG Grid |
| `EditableLineDataGrid` / `MutableLines` | [components/editable-line-data-grid.tsx](../../components/editable-line-data-grid.tsx), [components/editable-lines.tsx](../../components/editable-lines.tsx) | Editable line tables inside cards |
| `StatusBlock` | [components/ui/status-block.tsx](../../components/ui/status-block.tsx) | Full-cell status states in grids and line tables |
| `StatusDetailMenuTable` | [components/status-detail-menu-table.tsx](../../components/status-detail-menu-table.tsx) | Status dropdown detail rows, shortages, coverage, or linked records |
| `WorkflowStatusFilter` / `SegmentedCountFilter` | [components/workflow-status-filter.tsx](../../components/workflow-status-filter.tsx), [components/segmented-count-filter.tsx](../../components/segmented-count-filter.tsx) | Open/done and counted view filters |
| `DashboardTopNav` | [components/dashboard-top-nav.tsx](../../components/dashboard-top-nav.tsx) | Authenticated app chrome |
| `ScrollArea` | [components/ui/scroll-area.tsx](../../components/ui/scroll-area.tsx) | Scrollable regions that need styled scrollbars and preserved rounded clipping |

## Component Rules

- Do not re-document props here. TypeScript owns props.
- Do not copy styles from old prototypes or screenshots.
- If two pages need the same local pattern, promote it to a shared component before adding a second copy.
- If a component requires page-specific data, keep business logic in domain/query code and pass display-ready props into the component.
