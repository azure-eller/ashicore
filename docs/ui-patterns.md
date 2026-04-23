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

Use a dedicated page layout for create/edit routes. Do not center the entire form in a single card.

- Use a centered page shell such as `mx-auto w-full max-w-5xl py-8` or `max-w-6xl` for wider product/BOM flows
- Put the page title, description, and primary actions in the page header
- Use stacked `FieldSet` sections and place `FieldSeparator` only between sections, not between a section title and its own fields
- Keep text fields in a readable column inside each section, e.g. `FieldSet className="max-w-4xl"`
- Use wider/full-width sections only where the content needs it, such as tables or BOM editors

```tsx
<div className="mx-auto w-full max-w-4xl py-8">
  <div className="space-y-8">
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Add Product</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create a new product in your inventory.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="submit" form="item-form">
          Create Product
        </Button>
      </div>
    </div>

    <Separator />

    <form id="item-form" className="space-y-0">
      <FieldGroup className="gap-8">
        <FieldSet className="max-w-4xl gap-5">
          <FieldLegend>Basics</FieldLegend>
          <FieldDescription>
            Name, category, and unit details for this product.
          </FieldDescription>
          <FieldGroup>{/* fields */}</FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet className="max-w-4xl gap-5">
          <FieldLegend>Pricing & Stock</FieldLegend>
          <FieldDescription>
            Set the default pricing and starting inventory.
          </FieldDescription>
          <FieldGroup>{/* fields */}</FieldGroup>
        </FieldSet>
      </FieldGroup>
    </form>
  </div>
</div>
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

Route-level `loading.tsx` only appears after parent layouts start rendering. Keep `app/layout.tsx` and shared dashboard layouts free of non-essential auth/DB preference reads, or those parent awaits will block the fallback and make navigation look frozen. For UI preferences like readability, initialize SSR from a cookie and let the settings API keep that cookie in sync.

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

Use tooltips sparingly. They are for short clarifications on computed terms, condensed labels, or alert indicators that need one extra sentence of context.

- Prefer the existing label, link, or status marker as the trigger
- Do not add extra info icons if the UI already has a natural hover target
- Keep tooltip copy to one short line
- Skip tooltips on obvious labels and actions

```tsx
<SortableHeader
  column={column}
  label="Calculated Stock"
  tooltip="Stock - committed + expected - safety stock."
/>

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
```

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
