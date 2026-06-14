---
title: Field
description: The repo's accessible form-field building blocks and how we compose them.
read_when:
  - Writing or editing form fields
  - Adding labels, help text, or error display to inputs
---

# Field

`Field` is the shared wrapper that gives every form control a label, optional
help text, accessible error display, and consistent spacing. Compose it — do not
hand-roll `<label>` + control + error markup.

Source of truth for the full API (props, variants): `components/ui/field.tsx`.
TypeScript owns the prop types; this doc owns how we use them.

## Import

```tsx
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
```

`FieldSet` / `FieldLegend` / `FieldContent` / `FieldTitle` / `FieldSeparator`
also exist for grouped and horizontal layouts — reach for them only when a plain
stacked field is not enough.

## Anatomy

```tsx
<Field data-invalid={fieldState.invalid}>
  <FieldLabel htmlFor="sku">SKU</FieldLabel>
  <Input id="sku" {...field} />
  <FieldError errors={[fieldState.error]} />
</Field>
```

- One `Field` per control. Stack related fields inside a `FieldGroup`.
- `FieldLabel htmlFor` must match the control `id` for accessibility.
- `FieldError` renders nothing when there is no error — keep it mounted; do not
  conditionally render it.
- `FieldDescription` is help text only. Show it in **create** mode where an
  empty field benefits from guidance; hide it in **edit** mode. Never style a
  `FieldDescription` as an error.

## Error state

Drive the whole block into its error treatment with `data-invalid` on `Field`
and `aria-invalid` on the control; let `FieldError` render the message.

```tsx
<Field data-invalid={fieldState.invalid}>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" type="email" aria-invalid={fieldState.invalid} {...field} />
  <FieldError errors={[fieldState.error]} />
</Field>
```

`FieldError` accepts an `errors` array (e.g. from react-hook-form) or plain
children, and renders Standard Schema issues (Zod, Valibot, ArkType) directly.

For wiring a full form with `useForm` + `Controller` + `zodResolver`, see
`docs/references/react-hook-form-example.md`. For card-page fields, use the
`CardField` family instead — see `docs/card-kernel.md`.
