"use client";

import type { SupplierOption } from "@/lib/purchasing/types";
import { EntityCombobox } from "@/components/entity-combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import styles from "@/components/card-page/card-page.module.css";
import { cn } from "@/lib/utils";

export function SupplierSelect({
  suppliers,
  value,
  onValueChange,
  errorMessage,
  inputClassName,
  labelClassName,
  required,
  invalid,
}: {
  suppliers: SupplierOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  errorMessage?: string;
  inputClassName?: string;
  labelClassName?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  const isInvalid = invalid || Boolean(errorMessage);

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel
        className={cn(labelClassName, isInvalid && styles.formLabelInvalid)}
      >
        Supplier{required ? <span className={styles.requiredMark}> *</span> : null}
      </FieldLabel>
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
            <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-faint)]">
              {supplier.code}
            </span>
          ) : null
        }
      />
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
}
