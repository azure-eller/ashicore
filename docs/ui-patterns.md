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

**Button/form loading**: use `mutation.isPending`.

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending ? "Saving..." : "Save"}
</Button>
```

No optimistic updates. No complex loading state machines.

## Portal Components (Dialogs, Dropdowns, Popovers, Tooltips)

Portal-rendered components escape the component tree and lose Tailwind dark mode context. Always add the `dark` class to the container:

```tsx
<DialogContent className="dark">
  ...
</DialogContent>

<DropdownMenuContent className="dark">
  ...
</DropdownMenuContent>
```

Without this, dark mode will not apply inside the portal.

## Navigation

**Cancel buttons**: always use `router.back()`. Never hardcode a destination path.

```tsx
// ✓ Correct
<Button variant="ghost" onClick={() => router.back()}>Cancel</Button>

// ✗ Wrong — breaks when page is reached from different contexts
<Button variant="ghost" onClick={() => router.push("/inventory/materials")}>Cancel</Button>
```

**Dynamic column links**: table cell links must use the row's actual ID, not a static path.

```tsx
// ✓ Correct
<Link href={`/inventory/materials/${row.original.id}`}>{row.original.name}</Link>

// ✗ Wrong
<Link href="/inventory/materials/123">{row.original.name}</Link>
```
