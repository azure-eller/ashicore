"use client";

import { Controller, type Control } from "react-hook-form";
import { z } from "zod";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";
import { AddressFields } from "@/components/address-fields";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  PAYMENT_TERMS_TOOLTIP,
  SUPPLIER_CODE_TOOLTIP,
} from "@/lib/tooltip-copy";

export type SupplierFormValues = z.input<typeof insertSupplierSchema>;

export function SupplierFieldGroups({
  control,
}: {
  control: Control<SupplierFormValues>;
}) {
  return (
    <FieldGroup className="gap-8">
      <FieldSet className="gap-5">
        <FieldLegend>Basics</FieldLegend>
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={control}
              name="code"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    <TooltipHeader label="Code" tooltip={SUPPLIER_CODE_TOOLTIP} />
                  </FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="contactName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Contact Name</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={control}
              name="paymentTerms"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    <TooltipHeader label="Payment Terms" tooltip={PAYMENT_TERMS_TOOLTIP} />
                  </FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              control={control}
              name="phone"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Phone</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet className="gap-5">
        <FieldLegend>Billing Address</FieldLegend>
        <FieldDescription>
          Used for purchase orders and invoices.
        </FieldDescription>
        <AddressFields
          control={control}
          idPrefix="supplier-billing"
          names={{
            line1: "billingLine1",
            line2: "billingLine2",
            city: "billingCity",
            region: "billingRegion",
            postcode: "billingPostcode",
            country: "billingCountry",
          }}
        />
      </FieldSet>

      <FieldSeparator />

      <FieldSet className="gap-5">
        <FieldLegend>Notes</FieldLegend>
        <FieldGroup>
          <Controller
            control={control}
            name="notes"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                <Textarea
                  {...field}
                  id={field.name}
                  value={field.value ?? ""}
                  onChange={(event) => field.onChange(event.target.value || null)}
                  aria-invalid={fieldState.invalid}
                  rows={6}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  );
}
