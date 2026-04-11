"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  insertVariantSchema,
  type InsertVariantFormValues,
} from "@/lib/schemas/items";
import { formatVariantDisplay } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Separator } from "@/components/ui/separator";

interface VariantFormProps {
  masterId: string;
  masterName: string;
  masterAxes: string[];
  units: { id: string; name: string; size: string; uom: string }[];
}

export function VariantForm({ masterId, masterName, masterAxes, units }: VariantFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fallbackPath = `/inventory/products/${masterId}`;
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<InsertVariantFormValues>({
    resolver: zodResolver(insertVariantSchema),
    mode: "onBlur",
    defaultValues: {
      unitDefinitionId: "",
      variantAttrs: Object.fromEntries(masterAxes.map((axis) => [axis, ""])),
      sku: null,
      description: null,
      defaultSellingPrice: null,
      defaultPurchasePrice: null,
      safetyStock: "0",
      manufacturingMode: "discrete" as const,
      expectedBatchYield: null,
    },
  });
  const watchedVariantAttrs = useWatch({
    control: form.control,
    name: "variantAttrs",
  });
  const variantTitle = useMemo(
    () =>
      formatVariantDisplay(
        masterName,
        (watchedVariantAttrs as Record<string, string> | undefined) ?? {},
        masterAxes,
      ),
    [masterAxes, masterName, watchedVariantAttrs],
  );

  const mutation = useMutation({
    mutationFn: async (data: InsertVariantFormValues) => {
      const res = await fetch(`/api/items/${masterId}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        if (err?.errors) {
          const messages = Object.entries(err.errors)
            .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
            .join("; ");
          throw new Error(messages);
        }
        throw new Error(err?.error ?? "Failed to create variant.");
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items", "product"] });
      await queryClient.invalidateQueries({ queryKey: ["variants", masterId] });
      router.push(fallbackPath);
    },
    onError: (error) => {
      setFormError(error.message);
    },
    onMutate: () => {
      setFormError(null);
    },
  });

  const handleCancel = useSmartBack(fallbackPath);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Add Variant</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Add a variant to the <span className="font-medium">{masterName}</span> family.
            Category and BOM are inherited from the family.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="variant-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Creating..." : "Create Variant"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="variant-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((data) => {
          if (!mutation.isPending) mutation.mutate(data);
        })}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Variant Identity</FieldLegend>
            <FieldDescription>
              Values for each variant dimension of <span className="font-medium">{masterName}</span>.
            </FieldDescription>
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="variant-family-name">Family Name</FieldLabel>
                  <Input
                    id="variant-family-name"
                    value={masterName}
                    readOnly
                    className="bg-muted/40 text-muted-foreground"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="variant-title">Variant Title</FieldLabel>
                  <Input
                    id="variant-title"
                    value={variantTitle}
                    readOnly
                    className="bg-muted/40 font-medium"
                  />
                  <FieldDescription>
                    Derived from the family name and variant dimensions.
                  </FieldDescription>
                </Field>
              </div>

              {masterAxes.map((axis) => (
                <Controller
                  key={axis}
                  name={`variantAttrs.${axis}`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>{axis}</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={typeof field.value === "string" ? field.value : ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="e.g. 2 Cubic Foot Bag"
                        autoComplete="off"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              ))}

              {/* Stocking Unit — variants have their own unit */}
              <Controller
                name="unitDefinitionId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Stocking Unit</FieldLabel>
                    <Select
                      key={field.value as string}
                      name={field.name}
                      value={field.value as string}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id={field.name}
                        aria-invalid={fieldState.invalid}
                        className="w-full"
                      >
                        <SelectValue placeholder="Select a stocking unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.size} {u.uom})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              {/* SKU */}
              <Controller
                name="sku"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>SKU</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder="BMB-2CF"
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                name="description"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder="Optional notes about this variant"
                      rows={3}
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Pricing & Stock</FieldLegend>
            <FieldDescription>
              Set variant-specific pricing and safety stock.
            </FieldDescription>
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  name="defaultSellingPrice"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Selling Price</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="0.00"
                        inputMode="decimal"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
                <Controller
                  name="defaultPurchasePrice"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Purchase Price</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="0.00"
                        inputMode="decimal"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  name="safetyStock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Safety Stock</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? "0"}
                        aria-invalid={fieldState.invalid}
                        placeholder="0"
                        inputMode="decimal"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </form>
    </div>
  );
}
