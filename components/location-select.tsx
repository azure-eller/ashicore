"use client";

import { useQuery } from "@tanstack/react-query";
import { EntityCombobox } from "@/components/entity-combobox";
import { apiJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import styles from "@/components/card-page/card-page.module.css";
import { cn } from "@/lib/utils";

export type LocationOption = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
};

export function useActiveLocations() {
  return useQuery({
    queryKey: queryKeys.locations.root,
    queryFn: () => apiJson<LocationOption[]>("/api/locations"),
    staleTime: 60_000,
  });
}

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

// Self-contained dialog field: renders nothing for single-location orgs,
// shows the org default when no explicit choice has been made (a null value
// means "omit locationId from the request" — the server resolves the
// default, which keeps single-location and legacy clients byte-identical).
export function LocationPickerField({
  label = "Location",
  value,
  onValueChange,
}: {
  label?: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
}) {
  const locationsQuery = useActiveLocations();
  const locations = locationsQuery.data ?? [];
  // A failed fetch with no cached data must not pass for a single-location
  // org: say explicitly that the default will be used instead of silently
  // hiding the picker.
  if (locationsQuery.isError && locations.length === 0) {
    return (
      <p className="text-xs text-destructive">
        Couldn&apos;t load locations — the default location will be used.
      </p>
    );
  }
  if (locations.length < 2) {
    return null;
  }
  const defaultLocation = locations.find((location) => location.isDefault);

  return (
    <LocationSelect
      label={label}
      locations={locations}
      value={value ?? defaultLocation?.id ?? null}
      onValueChange={(next) =>
        onValueChange(next === defaultLocation?.id ? null : next)
      }
    />
  );
}
