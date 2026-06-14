---
title: React Hook Form
description: How this repo builds forms — useForm + Controller + Zod, submitting through an API mutation.
read_when:
  - Writing or editing any form
  - Setting up useForm, Controller, or zodResolver
  - Wiring form submission to a mutation
---

# React Hook Form

Every form here uses React Hook Form with a Zod schema for validation and the
shared `Field` primitives for markup. Read `docs/references/field-example.md`
first for the field building blocks. Business rules live in API/domain code, not
in the form.

## Shape of a form

```tsx
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  reorderPoint: z.coerce.number().min(0).nullable(),
});

type FormValues = z.infer<typeof schema>;

export function MaterialForm({ defaultValues }: { defaultValues: FormValues }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to save material");
        return r.json();
      }),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <FieldGroup>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input id={field.name} {...field} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
```

## Conventions

- **Validate with Zod.** Prefer the shared schema from `lib/schemas/*` when one
  exists so the form and the API agree on the contract. Use `z.coerce.number()`
  for numeric inputs and `.nullable()` for optional numerics.
- **Controlled fields via `Controller`.** Spread `field` onto the control and
  pass `fieldState` to `Field`/`FieldError`. Match `FieldLabel htmlFor` to the
  control `id` (`field.name` is a convenient stable id).
- **Submit through an API route**, never a server action. Drive the request with
  a TanStack Query mutation and gate the button on `mutation.isPending`.
- **No optimistic updates and no complex loading state machines.**
- For date/datetime fields use `DatePicker` / `DateTimePicker`, never
  `<input type="date">` — see `docs/ui-patterns.md`.
- For card-page detail editing, use the `CardField` family and the card kernel
  instead of a standalone `useForm` — see `docs/card-kernel.md`.
