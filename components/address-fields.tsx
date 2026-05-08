"use client";

import {
  Controller,
  useWatch,
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  getRegionOptions,
  normalizeCountry,
  normalizeRegion,
} from "@/lib/address-options";

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
  const watchedCountry = useWatch({ control, name: names.country }) as
    | string
    | null
    | undefined;
  const selectedCountry = normalizeCountry(watchedCountry) ?? DEFAULT_COUNTRY;
  const regionOptions = getRegionOptions(selectedCountry);
  const regionValues = regionOptions.map((option) => option.value);
  const countryValues = COUNTRY_OPTIONS.map((option) => option.value);

  return (
    <FieldGroup>
      <Controller
        control={control}
        name={names.line1}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${idPrefix}-line1`}>Street Address</FieldLabel>
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
            <FieldLabel htmlFor={`${idPrefix}-line2`}>
              Apartment, Suite, Unit
            </FieldLabel>
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

      <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_7rem_9rem_10rem]">
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
              <FieldLabel htmlFor={`${idPrefix}-region`}>
                {selectedCountry === DEFAULT_COUNTRY ? "State" : "State / Province"}
              </FieldLabel>
              <Combobox
                items={regionValues}
                value={normalizeRegion(selectedCountry, field.value as string | null) ?? ""}
                onValueChange={(value) =>
                  field.onChange(normalizeRegion(selectedCountry, value))
                }
                itemToStringLabel={(value) => {
                  const option = regionOptions.find((region) => region.value === value);
                  return option?.label ?? value;
                }}
              >
                <ComboboxInput
                  id={`${idPrefix}-region`}
                  placeholder="State"
                  aria-invalid={fieldState.invalid}
                />
                <ComboboxContent>
                  <ComboboxEmpty>No states found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => {
                      const option = regionOptions.find((region) => region.value === value);
                      return (
                        <ComboboxItem key={value} value={value}>
                          {option?.label ?? value}
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={control}
          name={names.postcode}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-postcode`}>Postal Code</FieldLabel>
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
              <Combobox
                items={countryValues}
                value={normalizeCountry(field.value as string | null) ?? ""}
                onValueChange={(value) => field.onChange(normalizeCountry(value))}
                itemToStringLabel={(value) => value}
              >
                <ComboboxInput
                  id={`${idPrefix}-country`}
                  placeholder="Country"
                  aria-invalid={fieldState.invalid}
                />
                <ComboboxContent>
                  <ComboboxEmpty>No countries found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => (
                      <ComboboxItem key={value} value={value}>
                        {value}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
    </FieldGroup>
  );
}
