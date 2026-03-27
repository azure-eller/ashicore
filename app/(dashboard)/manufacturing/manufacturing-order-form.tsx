"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  insertManufacturingOrderSchema,
  manufacturingOrderDefaultValues,
} from "@/lib/schemas/manufacturing-orders";
import { getFieldArrayError, parsePositive } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type {
  ManufacturingOrderEditData,
  ManufacturingProductOption,
  ManufacturingSalesLineOption,
} from "./types";

type ManufacturingProductTemplate = ManufacturingProductOption & {
  bom: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
  }>;
};

type ManufacturingOrderFormValues = z.input<
  typeof insertManufacturingOrderSchema
>;

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

function formatSalesLineLabel(
  value: string,
  salesLineMap: Map<string, ManufacturingSalesLineOption>,
  initialData?: ManufacturingOrderEditData
) {
  const line = salesLineMap.get(value);
  if (line) {
    return `${line.salesOrderNumber} - ${line.customerName}`;
  }

  if (
    initialData?.salesOrderLineId === value &&
    initialData.salesOrderNumber
  ) {
    return `${initialData.salesOrderNumber} - ${initialData.salesCustomerName ?? "\u2014"}`;
  }

  return "";
}

export function ManufacturingOrderForm({
  productTemplates = [],
  salesLineOptions,
  initialData,
}: {
  productTemplates?: ManufacturingProductTemplate[];
  salesLineOptions: ManufacturingSalesLineOption[];
  initialData?: ManufacturingOrderEditData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/manufacturing/orders/${initialData.id}`
    : "/manufacturing/orders";
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ManufacturingOrderFormValues>({
    resolver: zodResolver(insertManufacturingOrderSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          productId: initialData.productId,
          salesOrderId: initialData.salesOrderId,
          salesOrderLineId: initialData.salesOrderLineId,
          plannedQuantity: initialData.plannedQuantity,
          plannedDate: initialData.plannedDate,
          notes: initialData.notes,
          ingredients: initialData.ingredients.map((ingredient) => ({
            itemId: ingredient.itemId,
            quantityPerUnit: ingredient.quantityPerUnit,
          })),
          confirmShortage: false,
        }
      : manufacturingOrderDefaultValues,
  });

  const { fields } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const watchedProductId = useWatch({
    control: form.control,
    name: "productId",
  });
  const watchedPlannedQuantity = useWatch({
    control: form.control,
    name: "plannedQuantity",
  });
  const watchedIngredients = useWatch({
    control: form.control,
    name: "ingredients",
  });

  const productIds = productTemplates.map((product) => product.id);
  const productMap = new Map(productTemplates.map((product) => [product.id, product]));
  const selectedProduct = productMap.get(watchedProductId ?? "");

  const filteredSalesLines = useMemo(() => {
    if (!watchedProductId) return [];
    return salesLineOptions.filter((line) => line.itemId === watchedProductId);
  }, [salesLineOptions, watchedProductId]);

  const salesLineIds = filteredSalesLines.map((line) => line.salesOrderLineId);
  const salesLineMap = new Map(
    filteredSalesLines.map((line) => [line.salesOrderLineId, line])
  );

  const mutation = useMutation({
    mutationFn: async (values: ManufacturingOrderFormValues) => {
      const payload = initialData
        ? {
            salesOrderId: values.salesOrderId,
            salesOrderLineId: values.salesOrderLineId,
            plannedQuantity: values.plannedQuantity,
            plannedDate: values.plannedDate,
            notes: values.notes,
            ingredients: values.ingredients,
          }
        : values;

      const response = await fetch(
        initialData
          ? `/api/manufacturing-orders/${initialData.id}`
          : "/api/manufacturing-orders",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save manufacturing order.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      return body as { id: string };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.push(initialData ? fallbackPath : `/manufacturing/orders/${result.id}`);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save manufacturing order.");
    },
  });

  const handleCancel = () => {
    if (document.referrer.startsWith(window.location.origin)) {
      router.back();
      return;
    }

    router.push(fallbackPath);
  };

  const handleProductChange = (productId: string) => {
    const template = productMap.get(productId);
    form.setValue("productId", productId, { shouldValidate: true });
    form.setValue("salesOrderId", null);
    form.setValue("salesOrderLineId", null);
    form.setValue(
      "ingredients",
      (template?.bom ?? []).map((ingredient) => ({
        itemId: ingredient.itemId,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
      { shouldValidate: true, shouldDirty: true }
    );
  };

  const ingredientsError = getFieldArrayError(
    form.formState.errors.ingredients
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Manufacturing Order" : "Add Manufacturing Order"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? "Update this draft order before it is released."
              : "Create a draft manufacturing order from an existing product BOM."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="manufacturing-order-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Order"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="manufacturing-order-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Order Basics</FieldLegend>
            <FieldDescription>
              Choose a BOM-backed product, set the target quantity, and optionally
              link the order to a sales line.
            </FieldDescription>
            <FieldGroup>
              {isEditing ? (
                <Field>
                  <FieldLabel htmlFor="productName">Product</FieldLabel>
                  <Input
                    id="productName"
                    value={
                      initialData?.productSku
                        ? `${initialData.productName} (${initialData.productSku})`
                        : initialData?.productName ?? ""
                    }
                    disabled
                  />
                </Field>
              ) : (
                <Controller
                  control={form.control}
                  name="productId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Product</FieldLabel>
                      <Combobox
                        items={productIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => handleProductChange(value ?? "")}
                        itemToStringLabel={(value) => productMap.get(value)?.name ?? ""}
                      >
                        <ComboboxInput placeholder="Search products..." />
                        <ComboboxContent className="bg-popover text-popover-foreground">
                          <ComboboxEmpty>No products found</ComboboxEmpty>
                          <ComboboxList>
                            {(id: string) => {
                              const product = productMap.get(id);
                              return (
                                <ComboboxItem key={id} value={id}>
                                  <span>
                                    {product?.sku
                                      ? `${product.name} (${product.sku})`
                                      : product?.name ?? id}
                                  </span>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {!isEditing && (
                        <FieldDescription>
                          Only products with an active BOM can be manufactured.
                        </FieldDescription>
                      )}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Controller
                  control={form.control}
                  name="plannedQuantity"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Planned Quantity</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        aria-invalid={fieldState.invalid}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="plannedDate"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Planned Date</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        type="date"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>

              <Controller
                control={form.control}
                name="salesOrderLineId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>Sales Order Line</FieldLabel>
                    <Combobox
                      items={salesLineIds}
                      value={field.value ?? ""}
                      onValueChange={(value) => {
                        const selected = salesLineMap.get(value ?? "");
                        form.setValue("salesOrderLineId", selected?.salesOrderLineId ?? null, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                        form.setValue("salesOrderId", selected?.salesOrderId ?? null, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                      }}
                      itemToStringLabel={(value) =>
                        formatSalesLineLabel(value, salesLineMap, initialData)
                      }
                    >
                      <ComboboxInput
                        placeholder={
                          watchedProductId
                            ? "Search sales lines..."
                            : "Choose a product first..."
                        }
                        disabled={!watchedProductId}
                      />
                      <ComboboxContent className="bg-popover text-popover-foreground">
                        <ComboboxEmpty>
                          {watchedProductId
                            ? "No sales lines found"
                            : "Choose a product first"}
                        </ComboboxEmpty>
                        <ComboboxList>
                          {(id: string) => {
                            const line = salesLineMap.get(id);
                            return (
                              <ComboboxItem key={id} value={id}>
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <span className="truncate">
                                    {line?.salesOrderNumber} - {line?.customerName}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {line ? `${parseFloat(line.quantity)} ${line.unitName}` : ""}
                                  </span>
                                </div>
                              </ComboboxItem>
                            );
                          }}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    <FieldDescription>
                      Optional traceability link. Manufacturing still remains a standalone flow.
                    </FieldDescription>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="gap-5">
            <FieldLegend>Ingredients</FieldLegend>
            <FieldDescription>
              These rows are copied from the product BOM. Draft orders can adjust
              quantity per unit, but rows cannot be added or removed.
            </FieldDescription>
            <FieldGroup>
              {fields.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead className="w-40">Qty / Unit</TableHead>
                        <TableHead className="w-40">Planned Total</TableHead>
                        <TableHead className="w-28">Unit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((field, index) => {
                        const templateIngredient = isEditing
                          ? initialData?.ingredients[index]
                          : selectedProduct?.bom[index];
                        const quantityPerUnit =
                          watchedIngredients?.[index]?.quantityPerUnit ?? "";
                        const plannedQuantity = parsePositive(watchedPlannedQuantity);
                        const perUnit = parsePositive(quantityPerUnit);
                        const plannedTotal =
                          plannedQuantity != null && perUnit != null
                            ? (plannedQuantity * perUnit).toFixed(4).replace(/\.?0+$/, "")
                            : "\u2014";

                        return (
                          <TableRow key={field.id}>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {templateIngredient?.itemName ?? field.itemId}
                                  </span>
                                  <Badge variant="outline">
                                    {templateIngredient?.itemType ?? "item"}
                                  </Badge>
                                </div>
                                {templateIngredient?.itemSku && (
                                  <p className="text-xs text-muted-foreground">
                                    {templateIngredient.itemSku}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Controller
                                control={form.control}
                                name={`ingredients.${index}.quantityPerUnit`}
                                render={({ field: quantityField, fieldState }) => (
                                  <div>
                                    <Input
                                      {...quantityField}
                                      aria-invalid={fieldState.invalid}
                                      inputMode="decimal"
                                      autoComplete="off"
                                      className="w-full"
                                    />
                                    {fieldState.invalid && (
                                      <FieldError errors={[fieldState.error]} />
                                    )}
                                  </div>
                                )}
                              />
                              <input
                                type="hidden"
                                value={field.itemId}
                                {...form.register(`ingredients.${index}.itemId`)}
                              />
                            </TableCell>
                            <TableCell>{plannedTotal}</TableCell>
                            <TableCell>{templateIngredient?.unitName ?? "\u2014"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-6">
                  <p className="text-sm text-muted-foreground">
                    {watchedProductId
                      ? "This product does not currently have any eligible BOM ingredients."
                      : "Choose a product to load its BOM ingredients."}
                  </p>
                </div>
              )}

              {ingredientsError && <FieldError>{ingredientsError}</FieldError>}
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Notes</FieldLegend>
            <FieldDescription>
              Add any internal context you want to keep with this order.
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
      </form>
    </div>
  );
}
