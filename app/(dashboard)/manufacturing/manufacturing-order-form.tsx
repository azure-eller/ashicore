"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  Controller,
  type Resolver,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  manufacturingOrderCreateFormSchema,
  manufacturingOrderDefaultValues,
  updateManufacturingOrderSchema,
  type ManufacturingOrderCreateFormValues,
} from "@/lib/schemas/manufacturing-orders";
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
import { DatePicker } from "@/components/ui/date-picker";
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
import { getFieldArrayError, parsePositive } from "@/lib/format";
import type {
  ManufacturingOrderEditData,
  ManufacturingProductOption,
  ManufacturingSalesLineOption,
  ManufacturingSalesOrderOption,
  ManufacturingSalesOrderPreview,
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

type ManufacturingOrderFormValues = ManufacturingOrderCreateFormValues;

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

function formatSalesOrderLabel(
  value: string,
  salesOrderMap: Map<string, ManufacturingSalesOrderOption>
) {
  const order = salesOrderMap.get(value);
  if (!order) return "";
  return `${order.orderNumber} - ${order.customerName}`;
}

function formatSalesLineLabel(
  value: string,
  salesLineMap: Map<string, ManufacturingSalesLineOption>
) {
  const line = salesLineMap.get(value);
  if (!line) return "";

  const quantity = parseFloat(line.quantity);
  const quantityLabel = Number.isFinite(quantity) ? quantity : line.quantity;
  return `${line.salesOrderNumber} - ${line.customerName} - ${quantityLabel} ${line.unitName}`;
}

export function ManufacturingOrderForm({
  productTemplates = [],
  salesLineOptions = [],
  salesOrderOptions = [],
  initialData,
  initialSalesOrderId,
  initialSalesOrderPreview,
}: {
  productTemplates?: ManufacturingProductTemplate[];
  salesLineOptions?: ManufacturingSalesLineOption[];
  salesOrderOptions?: ManufacturingSalesOrderOption[];
  initialData?: ManufacturingOrderEditData;
  initialSalesOrderId?: string | null;
  initialSalesOrderPreview?: ManufacturingSalesOrderPreview | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/manufacturing/orders/${initialData.id}`
    : "/manufacturing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const formResolver = zodResolver(
    isEditing ? updateManufacturingOrderSchema : manufacturingOrderCreateFormSchema
  ) as Resolver<ManufacturingOrderFormValues>;

  const form = useForm<ManufacturingOrderFormValues>({
    resolver: formResolver,
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
      : {
          ...manufacturingOrderDefaultValues,
          salesOrderId: initialSalesOrderId ?? null,
          plannedDate: initialSalesOrderPreview?.requestedDate ?? null,
        },
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
  const watchedSalesOrderId = useWatch({
    control: form.control,
    name: "salesOrderId",
  });

  const productIds = productTemplates.map((product) => product.id);
  const productMap = new Map(productTemplates.map((product) => [product.id, product]));
  const salesOrderIds = salesOrderOptions.map((order) => order.id);
  const salesOrderMap = new Map(salesOrderOptions.map((order) => [order.id, order]));
  const editSalesLineOptions =
    isEditing &&
    initialData?.salesOrderId &&
    initialData.salesOrderLineId &&
    !salesLineOptions.some(
      (option) => option.salesOrderLineId === initialData.salesOrderLineId
    )
      ? [
          {
            salesOrderId: initialData.salesOrderId,
            salesOrderLineId: initialData.salesOrderLineId,
            salesOrderNumber: initialData.salesOrderNumber ?? "Linked sales order",
            customerName: initialData.salesCustomerName ?? "Unknown customer",
            itemId: initialData.productId,
            itemName: initialData.productName,
            itemSku: initialData.productSku,
            quantity: initialData.plannedQuantity,
            unitName: initialData.unitName,
            status: "confirmed" as const,
          },
          ...salesLineOptions,
        ]
      : salesLineOptions;
  const salesLineIds = editSalesLineOptions.map((line) => line.salesOrderLineId);
  const salesLineMap = new Map(
    editSalesLineOptions.map((line) => [line.salesOrderLineId, line])
  );
  const selectedProduct = productMap.get(watchedProductId ?? "");
  const selectedSalesOrder = salesOrderMap.get(watchedSalesOrderId ?? "");
  const isSalesOrderMode = !isEditing && watchedSalesOrderId != null;

  // For editing, use the snapshotted batch info from the MO
  const isBatchMode = isEditing
    ? initialData?.manufacturingMode === "batch"
    : selectedProduct?.manufacturingMode === "batch";
  const batchYield = isEditing
    ? initialData?.expectedBatchYield != null ? parseFloat(initialData.expectedBatchYield) : null
    : selectedProduct?.expectedBatchYield != null ? parseFloat(selectedProduct.expectedBatchYield) : null;

  // Batch calculation from the desired quantity
  const batchCalc = (() => {
    if (!isBatchMode || batchYield == null || batchYield <= 0) return null;
    const desired = parseFloat(watchedPlannedQuantity ?? "");
    if (!Number.isFinite(desired) || desired <= 0) return null;
    const numberOfBatches = Math.ceil(desired / batchYield);
    const plannedOutput = numberOfBatches * batchYield;
    const excess = plannedOutput - desired;
    return { numberOfBatches, plannedOutput, excess };
  })();

  const previewQuery = useQuery<ManufacturingSalesOrderPreview>({
    queryKey: ["manufacturing-sales-order-preview", watchedSalesOrderId],
    queryFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${watchedSalesOrderId}/manufacturing-orders`
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load sales order preview.");
      }

      return body as ManufacturingSalesOrderPreview;
    },
    enabled: isSalesOrderMode,
    initialData:
      watchedSalesOrderId != null && watchedSalesOrderId === initialSalesOrderId
        ? initialSalesOrderPreview ?? undefined
        : undefined,
  });

  const salesOrderPreview =
    isSalesOrderMode && watchedSalesOrderId != null
      ? previewQuery.data ?? null
      : null;

  const mutation = useMutation({
    mutationFn: async (values: ManufacturingOrderFormValues) => {
      if (!isEditing && values.salesOrderId) {
        const response = await fetch(
          `/api/sales-orders/${values.salesOrderId}/manufacturing-orders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plannedDate: values.plannedDate,
              notes: values.notes,
            }),
          }
        );

        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw {
            error: body?.error ?? "Failed to create manufacturing orders.",
            errors: body?.errors,
          } satisfies ApiError;
        }

        return {
          kind: "sales-order" as const,
          salesOrderId: values.salesOrderId,
        };
      }

      const payload = initialData
        ? {
            salesOrderId: values.salesOrderId,
            salesOrderLineId: values.salesOrderLineId,
            plannedQuantity: values.plannedQuantity ?? "",
            plannedDate: values.plannedDate,
            notes: values.notes,
            ingredients: values.ingredients,
          }
        : {
            productId: values.productId ?? "",
            salesOrderId: null,
            salesOrderLineId: null,
            plannedQuantity: values.plannedQuantity ?? "",
            plannedDate: values.plannedDate,
            notes: values.notes,
            ingredients: values.ingredients,
            confirmShortage: false,
          };

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

      return {
        kind: "single" as const,
        id: body.id as string,
      };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      ]);

      if (result.kind === "sales-order") {
        router.push(`/sales/orders/${result.salesOrderId}`);
        return;
      }

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

  const handleCancel = useSmartBack(fallbackPath);

  const handleSalesOrderChange = (salesOrderId: string) => {
    const selected = salesOrderMap.get(salesOrderId);

    if (!selected) {
      form.setValue("salesOrderId", null, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("salesOrderLineId", null);
      form.setValue("productId", "");
      form.setValue("plannedQuantity", "");
      form.setValue("ingredients", []);
      return;
    }

    form.setValue("salesOrderId", selected.id, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("salesOrderLineId", null);
    form.setValue("productId", "");
    form.setValue("plannedQuantity", "");
    form.setValue("ingredients", []);
    form.setValue("plannedDate", selected.requestedDate ?? null, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const handleProductChange = (productId: string) => {
    const template = productMap.get(productId);
    form.setValue("productId", productId, { shouldValidate: true });
    form.setValue("salesOrderId", null);
    form.setValue("salesOrderLineId", null);
    form.setValue("plannedQuantity", "");
    form.setValue(
      "ingredients",
      (template?.bom ?? []).map((ingredient) => ({
        itemId: ingredient.itemId,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
      { shouldValidate: true, shouldDirty: true }
    );
  };

  const handleSalesLineChange = (salesOrderLineId: string) => {
    const selected = salesLineMap.get(salesOrderLineId);

    if (!selected) {
      form.setValue("salesOrderId", null, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("salesOrderLineId", null, {
        shouldValidate: true,
        shouldDirty: true,
      });
      return;
    }

    form.setValue("salesOrderId", selected.salesOrderId, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("salesOrderLineId", selected.salesOrderLineId, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const ingredientsError = getFieldArrayError(form.formState.errors.ingredients);
  const salesOrderModeDisabled =
    isSalesOrderMode &&
    (!salesOrderPreview?.hasManufacturableLines || previewQuery.isLoading);
  const createButtonLabel = isEditing
    ? mutation.isPending
      ? "Saving..."
      : "Save Changes"
    : isSalesOrderMode
      ? mutation.isPending
        ? "Creating..."
        : `Create ${salesOrderPreview?.manufacturableLineCount ?? 0} Order${
            (salesOrderPreview?.manufacturableLineCount ?? 0) === 1 ? "" : "s"
          }`
      : mutation.isPending
        ? "Creating..."
        : "Create Order";

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
              : "Leave sales order empty for a standalone build, or select a confirmed order to create draft MOs for the whole order."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="manufacturing-order-form"
            disabled={mutation.isPending || salesOrderModeDisabled}
          >
            {createButtonLabel}
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
              {isEditing
                ? "Adjust details for this draft order."
                : "Select a confirmed sales order to auto-fill batch creation, or choose a product directly for a standalone order."}
            </FieldDescription>
            <FieldGroup>
              {!isEditing && (
                <Controller
                  control={form.control}
                  name="salesOrderId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Sales Order</FieldLabel>
                      <Combobox
                        items={salesOrderIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => handleSalesOrderChange(value ?? "")}
                        itemToStringLabel={(value) =>
                          formatSalesOrderLabel(value, salesOrderMap)
                        }
                      >
                        <ComboboxInput
                          placeholder="Search confirmed sales orders..."
                          showClear
                        />
                        <ComboboxContent className="bg-popover text-popover-foreground">
                          <ComboboxEmpty>No confirmed sales orders found</ComboboxEmpty>
                          <ComboboxList>
                            {(id: string) => {
                              const order = salesOrderMap.get(id);
                              return (
                                <ComboboxItem
                                  key={id}
                                  value={id}
                                  disabled={!order?.hasManufacturableLines}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <span className="truncate">
                                      {order?.orderNumber} - {order?.customerName}
                                    </span>
                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                      {order?.manufacturableLineCount ?? 0} manufacturable
                                    </span>
                                  </div>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      <FieldDescription>
                        Optional. Selecting an order switches this form to whole-order MO creation.
                      </FieldDescription>
                      {selectedSalesOrder?.disabledReason && (
                        <p className="text-xs text-muted-foreground">
                          {selectedSalesOrder.disabledReason}
                        </p>
                      )}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}

              {!isSalesOrderMode &&
                (isEditing ? (
                  <>
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

                    <Controller
                      control={form.control}
                      name="salesOrderLineId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>Sales Order Line</FieldLabel>
                          <Combobox
                            items={salesLineIds}
                            value={field.value ?? ""}
                            onValueChange={(value) =>
                              handleSalesLineChange(value ?? "")
                            }
                            itemToStringLabel={(value) =>
                              formatSalesLineLabel(value, salesLineMap)
                            }
                          >
                            <ComboboxInput
                              id={field.name}
                              placeholder="Search active sales lines..."
                              showClear
                            />
                            <ComboboxContent className="bg-popover text-popover-foreground">
                              <ComboboxEmpty>No matching sales lines found</ComboboxEmpty>
                              <ComboboxList>
                                {(id: string) => {
                                  const line = salesLineMap.get(id);
                                  return (
                                    <ComboboxItem key={id} value={id}>
                                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate">
                                          {line?.salesOrderNumber} - {line?.customerName}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {line
                                            ? `${parseFloat(line.quantity)} ${line.unitName} • ${line.status}`
                                            : ""}
                                        </span>
                                      </div>
                                    </ComboboxItem>
                                  );
                                }}
                              </ComboboxList>
                            </ComboboxContent>
                          </Combobox>
                          <FieldDescription>
                            Optional. Update or clear the sales link for this draft
                            order.
                          </FieldDescription>
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />
                  </>
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
                        <FieldDescription>
                          {watchedProductId
                            ? "Change the product to reset ingredients."
                            : "Only products with an active BOM can be manufactured."}
                        </FieldDescription>
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                ))}

              <div className="grid gap-4 md:grid-cols-2">
                {!isSalesOrderMode && (
                  <Controller
                    control={form.control}
                    name="plannedQuantity"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Planned Quantity</FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                )}

                {!isSalesOrderMode && isBatchMode && batchCalc && (
                  <div className="col-span-full rounded-lg border border-dashed px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{batchCalc.numberOfBatches} batch{batchCalc.numberOfBatches === 1 ? "" : "es"}</span>
                      {" \u00d7 "}
                      {batchYield} {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}/batch
                      {" = "}
                      <span className="font-medium text-foreground">{batchCalc.plannedOutput} {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}</span>
                      {batchCalc.excess > 0 && (
                        <span className="text-muted-foreground"> ({batchCalc.excess} excess)</span>
                      )}
                    </p>
                  </div>
                )}

                <Controller
                  control={form.control}
                  name="plannedDate"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        {isSalesOrderMode ? "Batch Planned Date" : "Planned Date"}
                      </FieldLabel>
                      <DatePicker
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(value) => field.onChange(value || null)}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldDescription>
                        {isSalesOrderMode
                          ? "Applies to every manufacturing order created from this sales order."
                          : "Optional target date for this order."}
                      </FieldDescription>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          {isSalesOrderMode ? (
            <FieldSet className="gap-5">
              <FieldLegend>Sales Order Preview</FieldLegend>
              <FieldDescription>
                The system will create one draft manufacturing order for every
                line marked as will create.
              </FieldDescription>
              <FieldGroup>
                {previewQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      Loading sales order preview...
                    </p>
                  </div>
                ) : salesOrderPreview ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-lg border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Sales Order
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.salesOrderNumber}
                        </p>
                      </div>
                      <div className="rounded-lg border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Customer
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.customerName}
                        </p>
                      </div>
                      <div className="rounded-lg border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Will Create
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.manufacturableLineCount} order
                          {salesOrderPreview.manufacturableLineCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="w-32 text-right">Qty</TableHead>
                            <TableHead className="w-28">Unit</TableHead>
                            <TableHead className="w-40">Status</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {salesOrderPreview.lines.map((line) => (
                            <TableRow key={line.salesOrderLineId}>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="font-medium">{line.itemName}</div>
                                  {line.itemSku && (
                                    <p className="text-xs text-muted-foreground">
                                      {line.itemSku}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                {parseFloat(line.quantity)}
                              </TableCell>
                              <TableCell>{line.unitName}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    line.status === "will_create"
                                      ? "secondary"
                                      : "outline"
                                  }
                                >
                                  {line.status === "will_create"
                                    ? "Will create"
                                    : "Skipped"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {line.skipMessage ?? "\u2014"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {!salesOrderPreview.hasManufacturableLines && (
                      <FieldError>
                        {salesOrderPreview.disabledReason ??
                          "No manufacturable lines remain on this order."}
                      </FieldError>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      Select a confirmed sales order to preview the batch.
                    </p>
                  </div>
                )}
              </FieldGroup>
            </FieldSet>
          ) : (
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
                          <TableHead className="w-40">{isBatchMode ? "Qty / Batch" : "Qty / Unit"}</TableHead>
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
                          const perUnit = parsePositive(quantityPerUnit);
                          // For batch products, multiply per-batch qty by number of batches
                          const multiplier = isBatchMode && batchCalc
                            ? batchCalc.numberOfBatches
                            : parsePositive(watchedPlannedQuantity);
                          const plannedTotal =
                            multiplier != null && perUnit != null
                              ? (multiplier * perUnit)
                                  .toFixed(4)
                                  .replace(/\.?0+$/, "")
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
                              <TableCell>
                                {templateIngredient?.unitName ?? "\u2014"}
                              </TableCell>
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
          )}

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Notes</FieldLegend>
            <FieldDescription>
              Add any internal context you want to keep with this order.
              {isSalesOrderMode
                ? " The same note will be copied to every created manufacturing order."
                : ""}
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
