"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
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
import {
  formatPrice,
  getFieldArrayError,
  getFirstFormErrorMessage,
} from "@/lib/format";
import type {
  CustomerCategoryOption,
  PricingScheduleEditData,
  PricingUnitOption,
} from "./types";
import { Button } from "@/components/ui/button";
import {
  AffixedInput,
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
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
import {
  DISCOUNT_PERCENT_TOOLTIP,
  MAX_QTY_TOOLTIP,
  MIN_QTY_TOOLTIP,
  PRICING_SCOPE_TOOLTIP,
  PRICING_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";

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
  const [previewBasePrice, setPreviewBasePrice] = useState("100");

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
  const watchedBreaks = useWatch({
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
        setFormError(error.error ?? "Fix the highlighted fields.");
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
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };
  const breaksError = getFieldArrayError(form.formState.errors.breaks);
  const basePreview = Number(previewBasePrice);

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Sales · Pricing"
        title={isEditing ? "Edit Pricing Schedule" : "Add Pricing Schedule"}
        actions={
          <>
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
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid
        sidebar={
          <CreateSidebarCard
            title="Live preview"
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="pricing-preview-base">
                  Base selling price
                </FieldLabel>
                <AffixedInput
                  id="pricing-preview-base"
                  prefix="$"
                  value={previewBasePrice}
                  onChange={(event) => setPreviewBasePrice(event.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <div className="space-y-3">
                {(watchedBreaks ?? []).map((row, index) => {
                  const discount = Number(row?.discountPercent ?? 0);
                  const effective =
                    Number.isFinite(basePreview) && Number.isFinite(discount)
                      ? basePreview * (1 - discount / 100)
                      : null;
                  const range =
                    row?.maxQuantity && row.maxQuantity.trim() !== ""
                      ? `${row?.minQuantity || "0"}-${row.maxQuantity} units`
                      : `${row?.minQuantity || "0"}+ units`;
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">{range}</div>
                        <div className="text-xs text-muted-foreground">
                          {Number.isFinite(discount) ? discount : 0}% discount
                        </div>
                      </div>
                      <div className="font-mono font-medium tabular-nums">
                        {effective == null
                          ? "\u2014"
                          : formatPrice(effective.toFixed(2)) ?? "\u2014"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FieldGroup>
          </CreateSidebarCard>
        }
      >
        <form
          id="pricing-schedule-form"
          onSubmit={form.handleSubmit(
            (values) => mutation.mutate(values),
            handleInvalidSubmit
          )}
        >
        <FieldGroup className="gap-6">
          <CreateSection
            title="Schedule"
          >
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
                        <TooltipHeader label="Customer Scope" tooltip={PRICING_SCOPE_TOOLTIP} />
                      </FieldLabel>
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
                      <FieldLabel>
                        <TooltipHeader label="Unit / Package Type" tooltip={PRICING_UNIT_TOOLTIP} />
                      </FieldLabel>
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
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </CreateSection>

          <CreateSection
            title="Quantity breaks"
            action={
              <span className="text-xs text-muted-foreground">
                {fields.length} break{fields.length === 1 ? "" : "s"}
              </span>
            }
          >
            <FieldGroup className="gap-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border p-4">
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
                          <FieldLabel htmlFor={breakField.name}>
                            <TooltipHeader label="Min Qty" tooltip={MIN_QTY_TOOLTIP} />
                          </FieldLabel>
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
                          <FieldLabel htmlFor={breakField.name}>
                            <TooltipHeader label="Max Qty" tooltip={MAX_QTY_TOOLTIP} />
                          </FieldLabel>
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
                          <FieldLabel htmlFor={breakField.name}>
                            <TooltipHeader
                              label="Discount %"
                              tooltip={DISCOUNT_PERCENT_TOOLTIP}
                            />
                          </FieldLabel>
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
                  Add Break
                  <HugeiconsIcon
                    icon={Add01Icon}
                    className="h-4 w-4"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>
              </div>
            </FieldGroup>
          </CreateSection>
        </FieldGroup>
      </form>
      </CreatePageGrid>

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
