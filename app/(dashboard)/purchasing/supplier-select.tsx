"use client";

import type { SupplierOption } from "./types";
import { EntityCombobox } from "@/components/entity-combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

export function SupplierSelect({
  suppliers,
  value,
  onValueChange,
  errorMessage,
}: {
  suppliers: SupplierOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  errorMessage?: string;
}) {
  return (
    <Field data-invalid={Boolean(errorMessage)}>
      <FieldLabel>Supplier</FieldLabel>
      <EntityCombobox
        options={suppliers}
        value={value ?? null}
        onValueChange={onValueChange}
        placeholder="Search suppliers..."
        emptyMessage="No suppliers found"
        createLinks={[
          {
            href: "/purchasing/suppliers/new",
            label: "Create supplier",
          },
        ]}
        renderSecondary={(supplier) =>
          supplier.code ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {supplier.code}
            </span>
          ) : null
        }
      />
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
}
