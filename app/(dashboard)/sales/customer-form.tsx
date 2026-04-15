"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  customerDefaultValues,
  insertCustomerSchema,
  updateCustomerSchema,
} from "@/lib/schemas/customers";
import type { CustomerCategoryOption, CustomerRow } from "./types";
import { AddressFields } from "@/components/address-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type CustomerFormValues = z.input<typeof insertCustomerSchema>;
const EVERYONE_CATEGORY_VALUE = "__everyone__";
const CREATE_NEW_CATEGORY = "__create_new__";

export function CustomerForm({
  customerCategories,
  initialData,
}: {
  customerCategories: CustomerCategoryOption[];
  initialData?: CustomerRow;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/sales/customers/${initialData.id}`
    : "/sales/customers";
  const [formError, setFormError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(customerCategories);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(initialData ? updateCustomerSchema : insertCustomerSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          customerCategoryId: initialData.customerCategoryId,
          email: initialData.email,
          phone: initialData.phone,
          billingLine1: initialData.billingLine1,
          billingLine2: initialData.billingLine2,
          billingCity: initialData.billingCity,
          billingRegion: initialData.billingRegion,
          billingPostcode: initialData.billingPostcode,
          billingCountry: initialData.billingCountry,
          shipLine1: initialData.shipLine1,
          shipLine2: initialData.shipLine2,
          shipCity: initialData.shipCity,
          shipRegion: initialData.shipRegion,
          shipPostcode: initialData.shipPostcode,
          shipCountry: initialData.shipCountry,
          notes: initialData.notes,
        }
      : customerDefaultValues,
  });

  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(() => {
    if (!initialData) return true;
    const billing = [
      initialData.billingLine1,
      initialData.billingLine2,
      initialData.billingCity,
      initialData.billingRegion,
      initialData.billingPostcode,
      initialData.billingCountry,
    ];
    const shipping = [
      initialData.shipLine1,
      initialData.shipLine2,
      initialData.shipCity,
      initialData.shipRegion,
      initialData.shipPostcode,
      initialData.shipCountry,
    ];
    const allShippingBlank = shipping.every((value) => value == null || value === "");
    if (allShippingBlank) return true;
    return billing.every((value, index) => (value ?? "") === (shipping[index] ?? ""));
  });

  const categoryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/customer-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: categoryName,
          description: categoryDescription || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const fieldMsg = err?.errors
          ? Object.values(err.errors).flat()[0]
          : null;
        throw new Error(fieldMsg ?? err?.error ?? "Failed to create category.");
      }
      return res.json() as Promise<{ id: string; name: string }>;
    },
    onSuccess: (newCategory) => {
      setLocalCategories((prev) => [...prev, newCategory]);
      form.setValue("customerCategoryId", newCategory.id, { shouldDirty: true });
      setIsCategoryDialogOpen(false);
      setCategoryName("");
      setCategoryDescription("");
      setCategoryError(null);
    },
    onError: (error) => {
      setCategoryError(error.message);
    },
    onMutate: () => {
      setCategoryError(null);
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const response = await fetch(
        initialData ? `/api/customers/${initialData.id}` : "/api/customers",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to save customer.",
          errors: body?.errors,
        };
      }

      return body as { id: string };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push(initialData ? fallbackPath : `/sales/customers/${result.id}`);
    },
    onError: (error: { error?: string; errors?: Record<string, string[]> }) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as keyof CustomerFormValues, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save customer.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Customer" : "Add Customer"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? "Update this customer’s details."
              : "Create a new customer for sales orders."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Customer"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="customer-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Basics</FieldLegend>
            <FieldDescription>
              Name and contact details for this customer.
            </FieldDescription>
            <FieldGroup>
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  control={form.control}
                  name="customerCategoryId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Pricing Category</FieldLabel>
                      <Select
                        key={field.value}
                        name={field.name}
                        value={field.value ?? EVERYONE_CATEGORY_VALUE}
                        onValueChange={(value) => {
                          if (value === CREATE_NEW_CATEGORY) {
                            setIsCategoryDialogOpen(true);
                          } else {
                            field.onChange(
                              value === EVERYONE_CATEGORY_VALUE ? null : value
                            );
                          }
                        }}
                      >
                        <SelectTrigger aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Select a pricing category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EVERYONE_CATEGORY_VALUE}>
                            Everyone default pricing
                          </SelectItem>
                          {localCategories.map((customerCategory) => (
                            <SelectItem
                              key={customerCategory.id}
                              value={customerCategory.id}
                            >
                              {customerCategory.name}
                            </SelectItem>
                          ))}
                          <SelectSeparator />
                          <SelectItem value={CREATE_NEW_CATEGORY}>
                            + Create new category
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="email"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value)}
                        aria-invalid={fieldState.invalid}
                        type="email"
                        autoComplete="off"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  control={form.control}
                  name="phone"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Phone</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value)}
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

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Billing Address</FieldLegend>
            <FieldDescription>
              Mailing address used for invoices and accounting sync.
            </FieldDescription>
            <AddressFields
              control={form.control}
              idPrefix="customer-billing"
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

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Shipping Address</FieldLegend>
            <FieldDescription>
              Default ship-to address for sales orders. Each order can override it.
            </FieldDescription>
            <FieldGroup>
              <Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={shippingSameAsBilling}
                    onCheckedChange={(checked) => {
                      const isSame = checked === true;
                      setShippingSameAsBilling(isSame);
                      if (isSame) {
                        const values = form.getValues();
                        form.setValue("shipLine1", values.billingLine1, { shouldDirty: true });
                        form.setValue("shipLine2", values.billingLine2, { shouldDirty: true });
                        form.setValue("shipCity", values.billingCity, { shouldDirty: true });
                        form.setValue("shipRegion", values.billingRegion, { shouldDirty: true });
                        form.setValue("shipPostcode", values.billingPostcode, { shouldDirty: true });
                        form.setValue("shipCountry", values.billingCountry, { shouldDirty: true });
                      }
                    }}
                  />
                  Same as billing address
                </label>
              </Field>
              {!shippingSameAsBilling && (
                <AddressFields
                  control={form.control}
                  idPrefix="customer-shipping"
                  names={{
                    line1: "shipLine1",
                    line2: "shipLine2",
                    city: "shipCity",
                    region: "shipRegion",
                    postcode: "shipPostcode",
                    country: "shipCountry",
                  }}
                />
              )}
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Notes</FieldLegend>
            <FieldDescription>
              Add any internal context you want to keep with this customer.
            </FieldDescription>
            <FieldGroup>
              <Controller
                control={form.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
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
      </form>

      <Dialog
        open={isCategoryDialogOpen}
        onOpenChange={(open) => {
          setIsCategoryDialogOpen(open);
          if (!open) {
            setCategoryName("");
            setCategoryDescription("");
            setCategoryError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Category</DialogTitle>
            <DialogDescription>
              Define a new pricing category to group customers.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="category-name">Name</FieldLabel>
              <Input
                id="category-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Wholesale"
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="category-description">Description</FieldLabel>
              <Input
                id="category-description"
                value={categoryDescription}
                onChange={(e) => setCategoryDescription(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </Field>
          </FieldGroup>
          {categoryError && <FieldError>{categoryError}</FieldError>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => categoryMutation.mutate()}
              disabled={categoryMutation.isPending || !categoryName.trim()}
            >
              {categoryMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
