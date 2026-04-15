"use client";

import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type AddressFieldNames<Prefix extends string> = {
  line1: `${Prefix}Line1`;
  line2: `${Prefix}Line2`;
  city: `${Prefix}City`;
  region: `${Prefix}Region`;
  postcode: `${Prefix}Postcode`;
  country: `${Prefix}Country`;
};

export function addressFieldNames<Prefix extends string>(
  prefix: Prefix
): AddressFieldNames<Prefix> {
  return {
    line1: `${prefix}Line1` as AddressFieldNames<Prefix>["line1"],
    line2: `${prefix}Line2` as AddressFieldNames<Prefix>["line2"],
    city: `${prefix}City` as AddressFieldNames<Prefix>["city"],
    region: `${prefix}Region` as AddressFieldNames<Prefix>["region"],
    postcode: `${prefix}Postcode` as AddressFieldNames<Prefix>["postcode"],
    country: `${prefix}Country` as AddressFieldNames<Prefix>["country"],
  };
}

type AddressFieldsProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  names: {
    line1: FieldPath<TFieldValues>;
    line2: FieldPath<TFieldValues>;
    city: FieldPath<TFieldValues>;
    region: FieldPath<TFieldValues>;
    postcode: FieldPath<TFieldValues>;
    country: FieldPath<TFieldValues>;
  };
  idPrefix: string;
};

export function AddressFields<TFieldValues extends FieldValues>({
  control,
  names,
  idPrefix,
}: AddressFieldsProps<TFieldValues>) {
  return (
    <FieldGroup>
      <Controller
        control={control}
        name={names.line1}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${idPrefix}-line1`}>Address line 1</FieldLabel>
            <Input
              {...field}
              id={`${idPrefix}-line1`}
              value={(field.value as string | null) ?? ""}
              onChange={(event) => field.onChange(event.target.value || null)}
              aria-invalid={fieldState.invalid}
              autoComplete="address-line1"
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={control}
        name={names.line2}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${idPrefix}-line2`}>Address line 2</FieldLabel>
            <Input
              {...field}
              id={`${idPrefix}-line2`}
              value={(field.value as string | null) ?? ""}
              onChange={(event) => field.onChange(event.target.value || null)}
              aria-invalid={fieldState.invalid}
              autoComplete="address-line2"
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          control={control}
          name={names.city}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-city`}>City</FieldLabel>
              <Input
                {...field}
                id={`${idPrefix}-city`}
                value={(field.value as string | null) ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                aria-invalid={fieldState.invalid}
                autoComplete="address-level2"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={control}
          name={names.region}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-region`}>State / region</FieldLabel>
              <Input
                {...field}
                id={`${idPrefix}-region`}
                value={(field.value as string | null) ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                aria-invalid={fieldState.invalid}
                autoComplete="address-level1"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          control={control}
          name={names.postcode}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-postcode`}>Postcode</FieldLabel>
              <Input
                {...field}
                id={`${idPrefix}-postcode`}
                value={(field.value as string | null) ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                aria-invalid={fieldState.invalid}
                autoComplete="postal-code"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={control}
          name={names.country}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-country`}>Country</FieldLabel>
              <Input
                {...field}
                id={`${idPrefix}-country`}
                value={(field.value as string | null) ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                aria-invalid={fieldState.invalid}
                autoComplete="country-name"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>
    </FieldGroup>
  );
}
