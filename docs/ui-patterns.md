---
read_when:
  - Writing or editing a React component
  - Working with forms, inputs, or validation display
  - Adding icons or styling
  - Working with dialogs, dropdowns, or portal components
  - Adding navigation (links, cancel buttons, redirects)
---

# UI Patterns

## Style System

Design intent lives in `docs/design/`. App-wide runtime token values live in `app/styles/theme.css`.

1. **App raw tokens** in `app/styles/theme.css` `:root` — source of truth for colors, spacing, sizing, type, motion, shadows, and radii. Names include `--color-*`, `--space-*`, `--height-*`, `--text-*`, `--leading-*`, `--weight-*`, `--radius-*`, `--shadow-*`, `--focus-ring`, `--ease-*`, and `--duration-*`.
2. **Bridge** — shadcn variable names (`--primary`, `--card`, `--muted`, `--border`, `--radius`, etc.) alias the app tokens. This keeps shadcn semantic classes working unchanged.
3. **Component code** — uses the bridge by default; reaches for raw app tokens for dimensions and for states shadcn doesn't model (e.g. `accent-hover`, `surface-sunk`).

### Rules

- **Colors:** use shadcn semantic classes (`bg-primary`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-destructive`) by default. Reach for `var(--color-*)` only when shadcn has no name for the state (`hover:bg-[var(--color-accent-hover)]`, `bg-[var(--color-surface-sunk)]`). Never hardcode Tailwind colors (`text-red-500`).
- **Spacing / sizing / type:** always raw app tokens via Tailwind arbitrary syntax — `gap-(--space-3)`, `px-(--space-6)`, `h-(--height-input-md)`, `text-[length:var(--text-sm)]`, `leading-[var(--leading-sm)]`. There is no shadcn scale for these.
- **Radii:** use shared radius tokens. Do not hard-code radii in page code.
- **Status:** use shared status primitives (`StatusBlock`, `StatusLabel`, `StatusRibbon`) rather than local chips.
- **Numerics:** order IDs, currency, counts, and dates in tabular context use `font-mono` + `tabular-nums`.
- **Font:** use the global font variables. See `docs/design/foundations.md` for roles.
- **shadcn config:** `radix-nova` style with `stone` base color — see `components.json` for component aliases.

### Canonical primitives

See `docs/design/components.md`. Compose shared primitives rather than re-styling at the page level.

## Tables

Use `ERPDataGrid` / `ERPDataGridList` for operational datasets: main list
pages, editable line grids, sorting/filtering/resizing, selection-heavy flows,
and repeated scanning workflows.

Use the framed table components in `components/table-frame.tsx` for compact HTML
tables: dialog previews, read-only summaries, report fragments, history
snapshots, and small input tables that do not need grid behavior.

Feature code must not import `@/components/ui/table` directly. That file is the
raw shadcn primitive; route product code through `TableFrame`, `FramedTable`,
`FramedTableHeaderCell`, `FramedTableCell`, and `FramedTableEmptyRow` instead.

## Dashboard Module Layouts

Module layouts own the outer dashboard gutter. Use `DashboardModuleShell` in
Sales, Manufacturing, Inventory, Purchasing, Settings, and future module
layouts. Page components should not add local `p-4`, `gap-4`, or alternate
outer wrappers to recreate the dashboard frame.

`DashboardModuleShell` is intentionally presentational. It must not fetch data,
read route state, add Suspense, or key itself by pathname. The top nav and
module shell should remain mounted while child route segments load.

Use `CreatePageShell` inside the module shell for standalone create/edit forms.
Use `CardPage` inside the module shell for editable detail cards. Use
`SettingsPanel` and `SettingsKeyValueRow` for settings surfaces.

Record-card fields should compose `components/card-page/card-field.tsx`
primitives. Card pages should not locally decide field label typography,
underline control styling, invalid/disabled treatment, or select/input height.
Use the composable `CardField` / `CardReadOnlyValue` path for unusual fields and
the focused wrappers (`CardTextField`, `CardNumberField`, `CardSelectField`,
`CardCheckboxField`) only where they remove real repetition. Raw shadcn
`Field`, `FieldLabel`, `Input`, and `Select` composition should stay inside the
shared card primitives or exceptional dialog internals. When a dialog reuses a
card field wrapper, pass `controlStyle="dialog"` so the label and validation
behavior stay standardized without forcing card underline/density styling.

Dashboard navigation state may update active nav affordances optimistically, but
it must not unmount the dashboard route tree to show loading. Segment
`loading.tsx` files and local Suspense fallbacks own loading UI.

## Icons

HugeIcons only:

```tsx
import { IconName } from "@hugeicons/react";
// or for tree-shaking:
import { IconName } from "@hugeicons/core";
```

Never use Lucide, Heroicons, or any other icon package.

## Forms

Before writing or editing any form or form field:
1. Read `docs/references/field-example.md`
2. Read `docs/references/react-hook-form-example.md`

Then follow this pattern exactly:

```tsx
<Controller
  control={form.control}
  name="fieldName"
  render={({ field, fieldState }) => (
    <Field invalid={!!fieldState.error}>
      <FieldLabel>Label</FieldLabel>
      <Input {...field} />
      <FieldError>{fieldState.error?.message}</FieldError>
    </Field>
  )}
/>
```

Canonical reference: `app/(dashboard)/inventory/item-form/index.tsx` (with `dialogs/` and `fields/` siblings)

## Standalone Form Pages

Use the shared create-page components for create/edit routes. Do not wrap the entire form in one card.

- Use `CreatePageShell` with `CreatePageHeader` for the title and actions
- Use `CreatePageGrid` when the form has live summaries or secondary controls
- Use stacked `CreateSection` panels for form groups; they already provide card borders and `shadow-sm`
- Use `CreateSidebarCard` for compact previews, totals, or live summaries
- Keep visible section text minimal: section titles, field labels, and button labels are usually enough

```tsx
<CreatePageShell>
  <CreatePageHeader
    eyebrow="Inventory · Products"
    title="Add Product"
    actions={
      <>
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="submit" form="item-form">
          Create Product
        </Button>
      </>
    }
  />

  <CreatePageGrid sidebar={<CreateSidebarCard title="Live preview">{/* summary */}</CreateSidebarCard>}>
    <form id="item-form">
      <CreateSection title="Basics">
        <FieldGroup>{/* fields */}</FieldGroup>
      </CreateSection>

      <CreateSection title="Pricing & Stock">
        <FieldGroup>{/* fields */}</FieldGroup>
      </CreateSection>
    </form>
  </CreatePageGrid>
</CreatePageShell>
```

## Error Display

- Use `<FieldError>` for validation errors — it renders nothing when empty
- Never use `<FieldDescription>` with `text-destructive` styling for errors
- `<FieldDescription>` is for help text only, and should render conditionally:
  - Show in **create** mode (where the field is empty and guidance helps)
  - Hide in **edit** mode (where the field is already populated)

```tsx
{!isEditing && (
  <FieldDescription>Helpful hint text here</FieldDescription>
)}
```

## Loading States

**Page/data loading**: use a simple spinner or concise loading label. Do not add
skeleton loaders unless the feature explicitly needs layout preservation during
loading.

For App Router list pages, keep the route shell synchronous and suspend only the slow data region. Do not make the entire page wait on a top-level `await` before returning JSX, or the previous page will linger during navigation.

```tsx
import { Suspense } from "react";
import DataTableLoading from "@/components/data-table-loading";

export default function OrdersPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <OrdersData />
    </Suspense>
  );
}

async function OrdersData() {
  const orders = await getSalesOrders();
  return <OrdersTable initialData={orders} />;
}
```

Route-level `loading.tsx` only appears after parent layouts start rendering. Keep `app/layout.tsx` and shared dashboard layouts free of non-essential auth, DB, or preference reads, or those parent awaits will block the fallback and make navigation look frozen.

For create/edit routes that share the same form, reuse one route-level loading component per item type instead of duplicating a separate loader for `new` and `edit`.

For detail routes, add a local `[id]/loading.tsx` per item type and point it at a shared spinner/loader. Do not let `/products/[id]` or `/materials/[id]` inherit the parent list/table fallback from the segment above.

## Card Page Bodies

Card body structure is static. Do not conditionally mount or unmount normal sections, tables, tabs, notes, or totals because a record is new, draft, empty, persisted, locked, or missing related data. Keep the section mounted and change only field values, disabled/read-only state, empty rows/messages, and save status. Dialogs, destructive confirmations, and transient error banners may still be conditional because they are overlays or feedback, not the card's structural body.

**Button/form loading**: use `mutation.isPending`.

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending ? "Saving..." : "Save"}
</Button>
```

No optimistic updates. No complex loading state machines.

## ERP Tables

Use AG Grid for ERP tables by default: list pages, detail grids, read-only operational tables, and editable line editors. shadcn `Table` is only for narrow non-ERP layout tables or legacy code awaiting AG Grid migration.

For standard dashboard list pages, use the shared AG Grid list shell instead of rebuilding query state, search, add actions, bulk delete, grid markup, and delete dialogs in each route file.

- Keep column definitions local to the domain file
- Pass `queryKey`, `queryFn`, `addHref`, empty-state copy, and optional `deleteAction` config into `ERPDataGridList`
- Use `ERPDataGrid` directly only when the page needs custom list behavior such as persisted row drag
- Main operational lists should use bounded internal scrolling and AG Grid column resizing.

```tsx
<ERPDataGridList
  columns={columns}
  rows={initialData}
  queryKey={["customers"]}
  queryFn={fetchCustomers}
  searchAriaLabel="Search customers"
  addHref="/sales/customer"
  addAriaLabel="Add customer"
  emptyMessage="No customers yet."
  deleteAction={{
    endpoint: "/api/customers",
    invalidateQueryKeys: [["customers"]],
    defaultErrorMessage: "Failed to delete customer.",
    confirmTitle: (count) => `Delete ${count} customer${count !== 1 ? "s" : ""}?`,
    confirmDescription: (count) =>
      `The selected customer${count !== 1 ? "s" : ""} will be soft-deleted.`,
  }}
/>
```

## Editable Line Items

Dense spreadsheet-style ERP line sections should use the named wrappers from `components/editable-lines.tsx`, not raw `EditableLineDataGrid`, unless the grid is a custom workflow surface.

- `MutableLines`: add, edit, delete, and reorder rows. Use for normal repeated business lines such as PO materials, PO costs, BOM ingredients, operation costs, and contacts.
- `ManagedEditableLines`: edit, delete, and reorder source-backed rows, but no add row. Use when another entity generates the rows, such as MO ingredients populated from a BOM.
- `FixedEditableLines`: edit existing rows only. No add, delete, or reorder.
- `ReadOnlyLines`: dense read-only row display with the same grid visual.

Named line wrappers accept `fields`, not raw AG Grid column definitions. Pages choose a field kind (`text`, `number`, `select`, `date`, `inventory-item`, or `display`) and the shared wrapper maps that to AG Grid. Do not define page-local AG Grid cell editor components or pass `cellEditor` / `cellEditorParams` from app code. If a line needs a new field type, promote that field editor into the shared line toolbox first, then use it from the page. `pnpm lint` runs `verify:editable-lines` and fails normal app code that imports raw `EditableLineDataGrid`, defines local `*CellEditor`, or configures AG Grid editors directly.

Current shared line field editors:

- `InventoryItemLineCellEditor`: item/material/product combobox editor.
- `TextLineCellEditor`: text or numeric text editor, with optional suffix and validation.
- Shared select/date mapping inside `LineField`.
- `AgGridDateCellEditor` for date cells.

`EditableLineDataGrid` is the low-level AG Grid engine under those wrappers. Use it directly only for custom workflow grids whose behavior does not match the named wrappers, such as variants, lots, and stocktakes. It wraps AG Grid's native editing model: row data lives in React state, columns use `field` / `valueSetter` / custom cell editors, and committed edit events update the row array. Do not register grid cells with React Hook Form. Use Zod/API schemas as the final save contract, and keep sorting/filtering off unless row-order semantics are explicit.

`EditableLineItems` and `EditableLineGrid` are legacy staging components. Do not add new use sites. Existing mutable repeated rows should migrate to one of the named `*Lines` wrappers first; only drop to `EditableLineDataGrid` when the wrapper names do not describe the workflow.

- Define explicit flexible grid tracks for every column, e.g. `minmax(14rem, 1.7fr) minmax(5rem, 0.45fr) minmax(7rem, 0.7fr) minmax(7rem, 0.7fr)`.
- Give numeric inputs stable but compact columns; use `fr` tracks so empty cells do not force a small horizontal scroll.
- Do not put a control `min-w-*` inside a padded cell unless the column track includes that padding.
- Put the row group in horizontal overflow when the total minimum width exceeds the card.
- Use `createLine` and `addLabel`; clicking Add row focuses the new row's first control.
- Do not include reorder/remove tracks in `columns` or `headers`; the component owns them.
- Mark the first editable control in each row with `data-editable-line-primary`.
- Call `appendLineAfterCommit()` only after a committed picker selection, not while a user is typing search text.
- Keep combobox result popups readable; long item/customer labels may use a width wider than the trigger.
- Keep each editable control wrapped in shadcn `Field`, with a label relationship and `aria-invalid` state.
- Keep array validation under the grid, using `FieldError` or the existing field-array error helper.
- Do not create rows from focus or Tab. Tab should only move through existing fields.

```tsx
<EditableLineItems
  control={form.control}
  name="lines"
  columns="minmax(14rem, 1.7fr) minmax(5rem, 0.45fr) minmax(7rem, 0.7fr) minmax(7rem, 0.7fr)"
  minWidth="40rem"
  headers={[itemHeader, qtyHeader, unitHeader, priceHeader, totalHeader, marginHeader]}
  createLine={() => ({ itemId: "", quantity: null, unitPrice: null })}
  addLabel="Add item"
  renderRow={({ field, index, appendLineAfterCommit }) => (
    <>
      <EditableLineGridCell>
        <Field>
          <FieldLabel className="sr-only" htmlFor={`${field.id}-item`}>
            Item
          </FieldLabel>
          {/* item combobox with data-editable-line-primary on its input */}
          {/* call appendLineAfterCommit() after a real item selection */}
        </Field>
      </EditableLineGridCell>
      <EditableLineGridCell align="right">
        <Field>
          <FieldLabel className="sr-only" htmlFor={`${field.id}-quantity`}>
            Quantity
          </FieldLabel>
          {/* quantity input */}
        </Field>
      </EditableLineGridCell>
      <EditableLineGridCell>{/* unit */}</EditableLineGridCell>
    </>
  )}
/>
```

## Portal Components (Dialogs, Dropdowns, Popovers, Tooltips)

Use semantic surface and text tokens on portal content. Do not hardcode `dark` on individual dialogs, menus, or popovers.

```tsx
<DialogContent className="bg-background text-foreground">
  ...
</DialogContent>

<DropdownMenuContent className="bg-popover text-popover-foreground">
  ...
</DropdownMenuContent>
```

## Dialog sizes

`DialogContent` and `AlertDialogContent` take a `size` prop. Default is `default` (~24rem), right for short confirmations. Dialogs with tables or wider content should declare a wider size explicitly rather than reaching for a one-off `className="max-w-*"`.

Variants: `sm | default | md | lg | xl | 2xl | 3xl | content`. `content` sizes to fit the content (`w-fit` capped at 90vw / 72rem) and is the right choice when an inner table determines width.

```tsx
// ✓ Correct — use the size prop to pick an appropriate width
<AlertDialogContent size="2xl">{/* shortage table */}</AlertDialogContent>
<DialogContent size="content">{/* width-driven by content */}</DialogContent>

// ✗ Wrong — one-off max-width override for a recurring width
<AlertDialogContent className="max-w-5xl">...</AlertDialogContent>
```

## Inverted Surfaces

The authenticated ERP app is a light-mode design system. Do not introduce local
`.dark` token branches or hardcoded inverted palettes. If a surface needs an
inverted treatment, add named semantic tokens in `app/styles/theme.css` and compose
them through the shared component that owns that surface.

## Tooltips

Use tooltips sparingly. They clarify computed terms, domain jargon, alert indicators, and ambiguous icon-only actions — nothing else. Plain-English labels and self-evident actions stay tooltip-free.

### When to add a tooltip

Add one only if the trigger meets at least one of these:

- **Computed term** — output of a formula or aggregation (Calculated Stock, Available, Reserved, Backorder, Expected, Potential, Committed, ATP, projected variants).
- **Domain jargon** — an ERP term of art (Disposition, FIFO, Lot, Safety Stock, Released, Picked, Snapshot).
- **Alert indicator** — a small visual marker (red dot, warning chip) whose meaning isn't textual.
- **Disabled action** — a control is disabled and the reason isn't visible. Use `DisabledTooltipButton`.
- **Icon-only button** — keep an `aria-label` always; add a tooltip only when the icon is ambiguous to sighted users.

### When NOT to add a tooltip

- The label is plain English and self-evident (Name, SKU, Email, Notes, Address, Created).
- The tooltip would just restate or expand the label ("Edit" → "Edit this item", "New chat" → "Start a new chat").
- It's marketing-style help text — that goes in `FieldDescription` under a form field, or nowhere.
- It's long instructions — those go in docs, not a hover bubble.

### Copy style

One line. Definition or formula. Period.

- ≤ 80 characters, single sentence, ends with a period.
- Lead with the definition or formula. No "this shows…", "the…", "click to…", "hover to…".
- Prefer a formula (`Stock - demand + expected - safety stock.`) when one exists.
- Use the same vocabulary as elsewhere in the UI — don't say "items" if the column says "units".
- Don't repeat the trigger label: a tooltip on **Available** should not start with "Available is…".
- No questions, no emoji, no exclamation points.

Good (already in `lib/tooltip-copy.ts`):

- `Stock - demand + expected - safety stock.`
- `Physical stock available on hand.`
- `Quantity expected from active released manufacturing orders.`
- `Buffer stock intentionally held back.`

Bad (rewrite if seen):

- ✗ `How many units could be manufactured from current ingredient stock.` → ✓ `Units producible from current ingredient stock.`
- ✗ `This shows the available stock you can sell to customers right now.` → ✓ `Physical stock available on hand.`
- ✗ Tooltip text matching the trigger label exactly (e.g. "Edit" on a button labelled Edit) → ✓ drop the tooltip.

### Where the copy lives

Tooltip strings used in more than one place go in `lib/tooltip-copy.ts`. New shared strings should be added there, not duplicated inline.

### Trigger style — never `cursor-help`

The cursor stays the default arrow. Don't use the `cursor-help` Tailwind class anywhere — it produces a question-mark cursor that we've removed from the codebase. The dotted underline on `TooltipHeader` is enough visual signal.

Pick the trigger that's already on screen:

```tsx
// Sortable column header — the button is the trigger
<SortableHeader column={column} label="Calculated Stock" tooltip="Stock - demand + expected - safety stock." />

// Non-sortable header or inline label — dotted underline, default cursor
<TooltipHeader label="Available" tooltip="Physical stock available on hand." />

// Status pill, badge, or alert dot — wrap the existing element
<Tooltip>
  <TooltipTrigger asChild>
    <Badge variant="secondary">Not Sellable</Badge>
  </TooltipTrigger>
  <TooltipContent side="top">Item is hidden from sales orders.</TooltipContent>
</Tooltip>

// Alert indicator
<Tooltip>
  <TooltipTrigger asChild>
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full bg-destructive" aria-label="Below safety stock" />
      {name}
    </span>
  </TooltipTrigger>
  <TooltipContent side="top">
    Calculated stock is below zero, so this item is below its safety stock threshold.
  </TooltipContent>
</Tooltip>

// Disabled action — explains why the action is unavailable
<DisabledTooltipButton label="Confirm" tooltip="Confirm requires at least one line." />
```

✗ Never add a standalone `<HelpCircle />` or `ⓘ` icon as the trigger. Re-use the label, link, badge, or status marker that's already there.

## Navigation

**Cancel buttons**: keep in-app back navigation when possible, but include a known fallback route for direct URLs and external referrers.

```tsx
const handleCancel = () => {
  if (document.referrer.startsWith(window.location.origin)) {
    router.back()
    return
  }

  router.push("/inventory/materials")
}

// ✓ Correct
<Button variant="ghost" onClick={handleCancel}>Cancel</Button>

// ✗ Wrong — always discards the previous in-app context
<Button variant="ghost" onClick={() => router.push("/inventory/materials")}>Cancel</Button>
```

**Dynamic column links**: table cell links must use the row's actual ID, not a static path.

```tsx
// ✓ Correct
<Link href={`/inventory/materials/${row.original.id}`}>{row.original.name}</Link>

// ✗ Wrong
<Link href="/inventory/materials/123">{row.original.name}</Link>
```

## Date & DateTime Pickers

Both pickers use string values matching their Postgres column types. Never use `<input type="date">` — use these components instead.

### DatePicker — date-only fields (`YYYY-MM-DD`)

For Postgres `date` columns. Button trigger with calendar popover.

```tsx
import { DatePicker } from "@/components/ui/date-picker"

<Controller
  control={form.control}
  name="requestedDate"
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Requested Date</FieldLabel>
      <DatePicker
        id={field.name}
        value={field.value ?? ""}
        onChange={(value) => field.onChange(value || null)}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid}
      />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

### DateTimePicker — datetime fields (`YYYY-MM-DDTHH:mm:ss`)

For Postgres `timestamp` columns. Button trigger with two-step popover: calendar then hour/minute wheel picker.

```tsx
import { DateTimePicker } from "@/components/ui/date-time-picker"

<Controller
  control={form.control}
  name="deliveryTime"
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Delivery Time</FieldLabel>
      <DateTimePicker
        id={field.name}
        value={field.value ?? ""}
        onChange={(value) => field.onChange(value || null)}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid}
      />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```
