"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { z } from "zod";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  insertPricingScheduleSchema,
  pricingScheduleDefaultValues,
} from "@/lib/schemas/pricing-schedules";
import { getFieldArrayError } from "@/lib/format";
import type {
  CustomerCategoryOption,
  PricingScheduleEditData,
  PricingUnitOption,
} from "./types";
import { Button } from "@/components/ui/button";
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

const EVERYONE_SCOPE_VALUE = "__everyone__";
const CREATE_NEW_CATEGORY = "__create_new__";

type PricingScheduleFormValues = z.input<typeof insertPricingScheduleSchema>;

export function PricingScheduleForm({
  customerCategories,
  units,
  initialData,
}: {
  customerCategories: CustomerCategoryOption[];
  units: PricingUnitOption[];
  initialData?: PricingScheduleEditData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = "/sales/pricing";
  const [formError, setFormError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(customerCategories);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const form = useForm<PricingScheduleFormValues>({
    resolver: zodResolver(insertPricingScheduleSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          customerCategoryId: initialData.customerCategoryId,
          unitDefinitionId: initialData.unitDefinitionId,
          notes: initialData.notes,
          breaks: initialData.breaks,
        }
      : pricingScheduleDefaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "breaks",
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
    mutationFn: async (values: PricingScheduleFormValues) => {
      const response = await fetch(
        initialData
          ? `/api/pricing-schedules/${initialData.id}`
          : "/api/pricing-schedules",
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
          error: body?.error ?? "Failed to save pricing schedule.",
          errors: body?.errors,
        };
      }

      return body as { id: string };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pricing-schedules"] });
      router.push(fallbackPath);
    },
    onError: (error: { error?: string; errors?: Record<string, string[]> }) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save pricing schedule.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);
  const breaksError = getFieldArrayError(form.formState.errors.breaks);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Pricing Schedule" : "Add Pricing Schedule"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? "Update the customer scope, unit, and quantity discounts for this pricing schedule."
              : "Create a single quantity-discount curve for one customer scope and unit."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="pricing-schedule-form" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Schedule"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="pricing-schedule-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Schedule</FieldLegend>
            <FieldDescription>
              Choose who this schedule applies to and which unit/package type it controls.
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
                      <FieldLabel>Customer Scope</FieldLabel>
                      <Select
                        key={field.value}
                        name={field.name}
                        value={field.value ?? EVERYONE_SCOPE_VALUE}
                        onValueChange={(value) => {
                          if (value === CREATE_NEW_CATEGORY) {
                            setIsCategoryDialogOpen(true);
                          } else {
                            field.onChange(
                              value === EVERYONE_SCOPE_VALUE ? null : value
                            );
                          }
                        }}
                      >
                        <SelectTrigger aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Select a customer scope" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EVERYONE_SCOPE_VALUE}>
                            Everyone
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
                  name="unitDefinitionId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Unit / Package Type</FieldLabel>
                      <Select
                        name={field.name}
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Select a unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>

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
                      rows={4}
                    />
                    <FieldDescription>
                      Optional internal notes about when this discount curve should be used.
                    </FieldDescription>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="gap-5">
            <FieldLegend>Quantity Breaks</FieldLegend>
            <FieldDescription>
              Breaks apply one discount percent to the item’s base selling price.
            </FieldDescription>
            <FieldGroup className="gap-4">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded-lg border p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Break {index + 1}</p>
                      <p className="text-xs text-muted-foreground">
                        Leave max quantity blank for an open-ended final break.
                      </p>
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => remove(index)}
                        aria-label={`Remove break ${index + 1}`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Controller
                      control={form.control}
                      name={`breaks.${index}.minQuantity`}
                      render={({ field: breakField, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={breakField.name}>Min Qty</FieldLabel>
                          <Input
                            {...breakField}
                            id={breakField.name}
                            value={breakField.value ?? ""}
                            onChange={(event) => breakField.onChange(event.target.value)}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                          />
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />

                    <Controller
                      control={form.control}
                      name={`breaks.${index}.maxQuantity`}
                      render={({ field: breakField, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={breakField.name}>Max Qty</FieldLabel>
                          <Input
                            {...breakField}
                            id={breakField.name}
                            value={breakField.value ?? ""}
                            onChange={(event) => breakField.onChange(event.target.value)}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="Open-ended"
                          />
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />

                    <Controller
                      control={form.control}
                      name={`breaks.${index}.discountPercent`}
                      render={({ field: breakField, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={breakField.name}>Discount %</FieldLabel>
                          <Input
                            {...breakField}
                            id={breakField.name}
                            value={breakField.value ?? ""}
                            onChange={(event) => breakField.onChange(event.target.value)}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                          />
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />
                  </div>
                </div>
              ))}

              {breaksError && <FieldError>{breaksError}</FieldError>}

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const lastBreak = form.getValues("breaks").at(-1);
                    append({
                      minQuantity: lastBreak?.maxQuantity ?? "",
                      maxQuantity: null,
                      discountPercent: "0",
                    });
                  }}
                >
                  <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" aria-hidden />
                  Add Break
                </Button>
              </div>
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
