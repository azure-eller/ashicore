"use client";

import type { SupplierOption } from "./types";
import { EntityCombobox } from "@/components/entity-combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

export function SupplierSelect({
  suppliers,
  value,
  onValueChange,
  errorMessage,
  inputClassName,
  labelClassName,
}: {
  suppliers: SupplierOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  errorMessage?: string;
  inputClassName?: string;
  labelClassName?: string;
}) {
  return (
    <Field data-invalid={Boolean(errorMessage)}>
      <FieldLabel className={labelClassName}>Supplier</FieldLabel>
      <EntityCombobox
        options={suppliers}
        value={value ?? null}
        onValueChange={onValueChange}
        placeholder="Search suppliers..."
        emptyMessage="No suppliers found"
        inputClassName={inputClassName}
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
