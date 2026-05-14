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

- shadcn/ui with `radix-nova` style and `stone` base color
- Semantic tokens only — never hardcode Tailwind colors (e.g. `text-red-500`)
- Check `components.json` for component aliases and token names
- Font: Figtree (configured globally)

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

Canonical reference: `app/(dashboard)/inventory/materials/material-form.tsx`

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

**Page/data loading**: use skeleton components matching the page layout.

```tsx
// In the page component, while data is loading:
if (isLoading) return <MaterialFormSkeleton />;
```

For App Router list pages, keep the route shell synchronous and suspend only the slow data region. Do not make the entire page wait on a top-level `await` before returning JSX, or the previous page will linger during navigation.

```tsx
import { Suspense } from "react";
import OrdersTableSkeleton from "../orders-table-skeleton";

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersTableSkeleton />}>
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

For detail routes, add a local `[id]/loading.tsx` per item type and point it at a shared detail loader. Do not let `/products/[id]` or `/materials/[id]` inherit the parent list/table skeleton from the segment above.

**Button/form loading**: use `mutation.isPending`.

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending ? "Saving..." : "Save"}
</Button>
```

No optimistic updates. No complex loading state machines.

## Dashboard List Tables

For standard dashboard list pages, use the shared `DashboardDataTable` shell instead of rebuilding query state, search, add actions, bulk delete, table markup, pagination, and delete dialogs in each route file.

- Keep column definitions local to the domain file
- Pass `queryKey`, `queryFn`, `addHref`, empty-state copy, and optional `deleteAction` config into the shared shell
- Use `deleteAction.trackDeletingRows` only when rows should dim during delete, like inventory items
- Main list table headers are sticky by default under the dashboard top nav; pass `stickyHeader={false}` only for an unusual embedded table.

```tsx
<DashboardDataTable
  columns={columns}
  initialData={initialData}
  queryKey={["customers"]}
  queryFn={fetchCustomers}
  searchAriaLabel="Search customers"
  addHref="/sales/customers/new"
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

Use `EditableLineItems` from `components/editable-line-items.tsx` for mutable repeated rows such as PO lines, BOM ingredients, stocktake preview rows, and simple cost rows. It wraps `EditableLineGrid`, owns row chrome (drag handle, right-side remove, add button), always creates one initial blank row, and adds rows through its Add row button. Pass only data columns/headers. Pass `isLineBlank` when a grid should append one blank row after the last row becomes nonblank. Focus and Tab must not create rows. Use bare `EditableLineGrid` only for fixed editable grids, such as stocktake counts, or for complex legacy rows that need a staged migration.

- Define explicit flexible grid tracks for every column, e.g. `minmax(14rem, 1.7fr) minmax(5rem, 0.45fr) minmax(7rem, 0.7fr) minmax(7rem, 0.7fr)`.
- Give numeric inputs stable but compact columns; use `fr` tracks so empty cells do not force a small horizontal scroll.
- Do not put a control `min-w-*` inside a padded cell unless the column track includes that padding.
- Put the row group in horizontal overflow when the total minimum width exceeds the card.
- Use `createLine` and `addLabel`; clicking Add row focuses the new row's first control.
- Do not include reorder/remove tracks in `columns` or `headers`; the component owns them.
- Mark the first editable control in each row with `data-editable-line-primary`.
- Use `isLineBlank` for auto-append behavior; do not hand-code append/remove/reorder logic inside row controls.
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
  isLineBlank={(line) =>
    (line?.itemId?.trim() ?? "") === "" &&
    (line?.quantity?.trim() ?? "") === "" &&
    (line?.unitPrice?.trim() ?? "") === ""
  }
  addLabel="Add item"
  renderRow={({ field, index }) => (
    <>
      <EditableLineGridCell>
        <Field>
          <FieldLabel className="sr-only" htmlFor={`${field.id}-item`}>
            Item
          </FieldLabel>
          {/* item combobox with data-editable-line-primary on its input */}
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
- `Reservable stock after existing hard reservations.`
- `Quantity expected from active released manufacturing orders.`
- `Buffer stock intentionally held back.`

Bad (rewrite if seen):

- ✗ `How many units could be manufactured from current ingredient stock.` → ✓ `Units producible from current ingredient stock.`
- ✗ `This shows the available stock you can sell to customers right now.` → ✓ `Reservable stock after existing hard reservations.`
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
<TooltipHeader label="Available" tooltip="Reservable stock after demand and reservations." />

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
