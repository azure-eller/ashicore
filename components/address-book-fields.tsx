"use client";

import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  AddressFields,
} from "@/components/address-fields";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type AddressBookFieldsProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  idPrefix: string;
  addressNames: {
    line1: FieldPath<TFieldValues>;
    line2: FieldPath<TFieldValues>;
    city: FieldPath<TFieldValues>;
    region: FieldPath<TFieldValues>;
    postcode: FieldPath<TFieldValues>;
    country: FieldPath<TFieldValues>;
  };
  labelName: FieldPath<TFieldValues>;
  contactNameName: FieldPath<TFieldValues>;
  contactPhoneName: FieldPath<TFieldValues>;
  notesName?: FieldPath<TFieldValues>;
  notesLabel?: string;
  contactNameLabel?: string;
  contactPhoneLabel?: string;
};

export function AddressBookFields<TFieldValues extends FieldValues>({
  control,
  idPrefix,
  addressNames,
  labelName,
  contactNameName,
  contactPhoneName,
  notesName,
  notesLabel = "Notes",
  contactNameLabel = "Contact name",
  contactPhoneLabel = "Contact phone",
}: AddressBookFieldsProps<TFieldValues>) {
  return (
    <>
      <FieldGroup className="gap-(--space-8)">
        <Controller
          control={control}
          name={labelName}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-label`}>Label</FieldLabel>
              <Input
                {...field}
                id={`${idPrefix}-label`}
                value={(field.value as string | null) ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                aria-invalid={fieldState.invalid}
                autoComplete="organization"
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <FieldGroup className="grid gap-(--space-8) sm:grid-cols-2">
          <Controller
            control={control}
            name={contactNameName}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-contact-name`}>
                  {contactNameLabel}
                </FieldLabel>
                <Input
                  {...field}
                  id={`${idPrefix}-contact-name`}
                  value={(field.value as string | null) ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  aria-invalid={fieldState.invalid}
                  autoComplete="name"
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            control={control}
            name={contactPhoneName}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-contact-phone`}>
                  {contactPhoneLabel}
                </FieldLabel>
                <Input
                  {...field}
                  id={`${idPrefix}-contact-phone`}
                  value={(field.value as string | null) ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  aria-invalid={fieldState.invalid}
                  autoComplete="tel"
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </FieldGroup>
      </FieldGroup>
      <AddressFields
        control={control}
        names={addressNames}
        idPrefix={idPrefix}
      />
      {notesName ? (
        <FieldGroup className="mt-(--space-8) gap-(--space-8)">
          <Controller
            control={control}
            name={notesName}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-notes`}>{notesLabel}</FieldLabel>
                <Textarea
                  {...field}
                  id={`${idPrefix}-notes`}
                  value={(field.value as string | null) ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  aria-invalid={fieldState.invalid}
                  rows={3}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </FieldGroup>
      ) : null}
    </>
  );
}
