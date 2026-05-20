"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CUSTOMER_ACCOUNT_PRIORITIES,
  CUSTOMER_ACCOUNT_STATES,
  customerDefaultValues,
  insertCustomerSchema,
  updateCustomerSchema,
} from "@/lib/schemas/customers";
import type { CustomerCategoryOption, CustomerRow } from "./types";
import { AddressFields } from "@/components/address-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
} from "@/components/create-page";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { Textarea } from "@/components/ui/textarea";
import { TooltipHeader } from "@/components/tooltip-header";
import { PRICING_CATEGORY_TOOLTIP } from "@/lib/tooltip-copy";
import { getFirstFormErrorMessage, normalizeAddressFields } from "@/lib/format";

type CustomerFormValues = z.input<typeof insertCustomerSchema>;
const EVERYONE_CATEGORY_VALUE = "__everyone__";
const CREATE_NEW_CATEGORY = "__create_new__";
const accountStateLabels = {
  active: "Active",
  growth: "Growth",
  at_risk: "At risk",
  former: "Former",
} as const;
const accountPriorityLabels = {
  strategic: "Strategic",
  high: "High",
  standard: "Standard",
  low: "Low",
} as const;

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
  const initialBillingAddress = normalizeAddressFields({
    line1: initialData?.billingLine1,
    line2: initialData?.billingLine2,
    city: initialData?.billingCity,
    region: initialData?.billingRegion,
    postcode: initialData?.billingPostcode,
    country: initialData?.billingCountry,
  });
  const initialShippingAddress = normalizeAddressFields({
    line1: initialData?.shipLine1,
    line2: initialData?.shipLine2,
    city: initialData?.shipCity,
    region: initialData?.shipRegion,
    postcode: initialData?.shipPostcode,
    country: initialData?.shipCountry,
  });

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(initialData ? updateCustomerSchema : insertCustomerSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          customerCategoryId: initialData.customerCategoryId,
          accountState: initialData.accountState,
          accountPriority: initialData.accountPriority,
          email: initialData.email,
          phone: initialData.phone,
          billingLine1: initialBillingAddress.line1,
          billingLine2: initialBillingAddress.line2,
          billingCity: initialBillingAddress.city,
          billingRegion: initialBillingAddress.region,
          billingPostcode: initialBillingAddress.postcode,
          billingCountry: initialBillingAddress.country,
          shipLine1: initialShippingAddress.line1,
          shipLine2: initialShippingAddress.line2,
          shipCity: initialShippingAddress.city,
          shipRegion: initialShippingAddress.region,
          shipPostcode: initialShippingAddress.postcode,
          shipCountry: initialShippingAddress.country,
          notes: initialData.notes,
        }
      : customerDefaultValues,
  });

  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(() => {
    if (!initialData) return true;
    const billing = [
      initialBillingAddress.line1,
      initialBillingAddress.line2,
      initialBillingAddress.city,
      initialBillingAddress.region,
      initialBillingAddress.postcode,
      initialBillingAddress.country,
    ];
    const shipping = [
      initialShippingAddress.line1,
      initialShippingAddress.line2,
      initialShippingAddress.city,
      initialShippingAddress.region,
      initialShippingAddress.postcode,
      initialShippingAddress.country,
    ];
    const allShippingBlank = shipping.every((value) => value == null || value === "");
    if (allShippingBlank) return true;
    return billing.every((value, index) => (value ?? "") === (shipping[index] ?? ""));
  });
  const billingAddress = useWatch({
    control: form.control,
    name: [
      "billingLine1",
      "billingLine2",
      "billingCity",
      "billingRegion",
      "billingPostcode",
      "billingCountry",
    ],
  });
  const hasInitializedShippingSync = useRef(false);

  useEffect(() => {
    if (!shippingSameAsBilling) {
      hasInitializedShippingSync.current = true;
      return;
    }

    const [
      billingLine1,
      billingLine2,
      billingCity,
      billingRegion,
      billingPostcode,
      billingCountry,
    ] = billingAddress;
    const currentShipping = form.getValues([
      "shipLine1",
      "shipLine2",
      "shipCity",
      "shipRegion",
      "shipPostcode",
      "shipCountry",
    ]);
    const nextShipping = [
      billingLine1 ?? null,
      billingLine2 ?? null,
      billingCity ?? null,
      billingRegion ?? null,
      billingPostcode ?? null,
      billingCountry ?? null,
    ];

    if (
      currentShipping.every(
        (value, index) => (value ?? null) === (nextShipping[index] ?? null)
      )
    ) {
      hasInitializedShippingSync.current = true;
      return;
    }

    const shouldDirty = hasInitializedShippingSync.current;
    form.setValue("shipLine1", billingLine1 ?? null, { shouldDirty });
    form.setValue("shipLine2", billingLine2 ?? null, { shouldDirty });
    form.setValue("shipCity", billingCity ?? null, { shouldDirty });
    form.setValue("shipRegion", billingRegion ?? null, { shouldDirty });
    form.setValue("shipPostcode", billingPostcode ?? null, { shouldDirty });
    form.setValue("shipCountry", billingCountry ?? null, { shouldDirty });
    hasInitializedShippingSync.current = true;
  }, [billingAddress, form, shippingSameAsBilling]);

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
        setFormError(error.error ?? "Fix the highlighted fields.");
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
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  return (
    <CreatePageShell className="max-w-4xl">
      <CreatePageHeader
        eyebrow="Sales · Customers"
        title={isEditing ? "Edit Customer" : "Add Customer"}
        actions={
          <>
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
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="customer-form"
        className="space-y-0"
        onSubmit={form.handleSubmit(
          (values) => mutation.mutate(values),
          handleInvalidSubmit
        )}
      >
        <FieldGroup className="gap-6">
          <CreateSection title="Basics">
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
                      <FieldLabel>
                        <TooltipHeader
                          label="Pricing Category"
                          tooltip={PRICING_CATEGORY_TOOLTIP}
                        />
                      </FieldLabel>
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
                  name="accountPriority"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Priority</FieldLabel>
                      <Select
                        name={field.name}
                        value={field.value ?? "standard"}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                        <SelectContent>
                          {CUSTOMER_ACCOUNT_PRIORITIES.map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {accountPriorityLabels[priority]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  control={form.control}
                  name="accountState"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Account State</FieldLabel>
                      <Select
                        name={field.name}
                        value={field.value ?? "active"}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {CUSTOMER_ACCOUNT_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {accountStateLabels[state]}
                            </SelectItem>
                          ))}
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
          </CreateSection>

          <CreateSection
            title="Billing address"
          >
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
          </CreateSection>

          <CreateSection
            title="Shipping address"
            action={
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={shippingSameAsBilling}
                  onCheckedChange={(checked) => {
                    setShippingSameAsBilling(checked === true);
                  }}
                />
                Same as billing
              </label>
            }
          >
            <FieldGroup>
              {shippingSameAsBilling ? (
                <p className="border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  Shipping address mirrors the billing address above.
                </p>
              ) : (
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
          </CreateSection>

          <CreateSection title="Notes">
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
          </CreateSection>
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
    </CreatePageShell>
  );
}
