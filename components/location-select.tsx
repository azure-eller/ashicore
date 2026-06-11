"use client";

import { EntityCombobox } from "@/components/entity-combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import styles from "@/components/card-page/card-page.module.css";
import { cn } from "@/lib/utils";

export type LocationOption = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
};

export function LocationSelect({
  label,
  locations,
  value,
  onValueChange,
  errorMessage,
  inputId,
  required,
}: {
  label: string;
  locations: LocationOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  errorMessage?: string;
  inputId?: string;
  required?: boolean;
}) {
  const isInvalid = Boolean(errorMessage);

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel className={cn(isInvalid && styles.formLabelInvalid)}>
        {label}
        {required ? <span className={styles.requiredMark}> *</span> : null}
      </FieldLabel>
      <EntityCombobox
        inputId={inputId}
        options={locations}
        value={value ?? null}
        onValueChange={onValueChange}
        placeholder="Search locations..."
        emptyMessage="No locations found"
        renderSecondary={(location) => (
          <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-faint)]">
            {location.isDefault ? "Default" : location.code}
          </span>
        )}
      />
      {errorMessage && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
}
