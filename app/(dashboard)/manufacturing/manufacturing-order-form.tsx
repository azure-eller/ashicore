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
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
  SummaryRows,
} from "@/components/create-page";
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
} from "@/components/ui/field";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
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
import { TooltipHeader } from "@/components/tooltip-header";
import {
  formatQuantity,
  getFieldArrayError,
  normalizeNumeric,
  parsePositive,
} from "@/lib/format";
import {
  BOM_QTY_PER_BATCH_TOOLTIP,
  BOM_QTY_PER_UNIT_TOOLTIP,
  MANUFACTURING_PLANNED_TOTAL_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
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
    defaultItemId?: string | null;
    defaultItemName?: string | null;
    defaultItemSku?: string | null;
    defaultUnitName?: string | null;
    defaultQuantityPerUnit: string;
    alternates: Array<{
      itemId: string;
      itemName: string;
      itemSku: string | null;
      itemType: string;
      unitName: string;
      quantityFactor: string;
      sortOrder: number;
    }>;
  }>;
};

type ManufacturingOrderFormValues = ManufacturingOrderCreateFormValues;

const MANUFACTURING_INGREDIENT_GRID_COLUMNS =
  "minmax(18rem, 1fr) 9rem 9rem 6rem";

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

  return `${line.salesOrderNumber} - ${line.customerName} - ${line.quantity} ${line.unitName}`;
}

function multiplyQuantityString(quantity: string, factor: string) {
  const quantityNumber = Number(quantity);
  const factorNumber = Number(factor);
  if (!Number.isFinite(quantityNumber) || !Number.isFinite(factorNumber)) {
    return quantity;
  }

  return normalizeNumeric(quantityNumber * factorNumber);
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const todayDate = getTodayDateString();
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
          plannedQuantity: initialData.requestedQuantity,
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
          plannedDate: todayDate,
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
            quantity: initialData.requestedQuantity,
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
  const isManualBatchCreate = !isEditing && !isSalesOrderMode && isBatchMode;

  // Manual batch creation enters batch count; existing/edit flows enter output quantity.
  const batchCalc = (() => {
    if (!isBatchMode || batchYield == null || batchYield <= 0) return null;
    const entered = parseFloat(watchedPlannedQuantity ?? "");
    if (!Number.isFinite(entered) || entered <= 0) return null;
    const numberOfBatches = isManualBatchCreate
      ? entered
      : Math.ceil(entered / batchYield);
    const plannedOutput = numberOfBatches * batchYield;
    const excess = isManualBatchCreate ? 0 : plannedOutput - entered;
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
              salesOrderLineIds:
                salesOrderPreview?.lines
                  .filter((line) => line.status === "will_create")
                  .map((line) => line.salesOrderLineId) ?? [],
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

      const plannedQuantity = (() => {
        if (!isManualBatchCreate) return values.plannedQuantity ?? "";

        const batchCount = Number(values.plannedQuantity ?? "");
        if (
          !Number.isFinite(batchCount) ||
          batchCount <= 0 ||
          !Number.isInteger(batchCount) ||
          batchYield == null ||
          batchYield <= 0
        ) {
          throw {
            errors: {
              plannedQuantity: ["Enter a whole number of batches."],
            },
          } satisfies ApiError;
        }

        return normalizeNumeric(batchCount * batchYield);
      })();
      const manualBatchCount = isManualBatchCreate
        ? Number(values.plannedQuantity ?? "")
        : null;

      const payload = initialData
        ? {
            salesOrderId: values.salesOrderId,
            salesOrderLineId: values.salesOrderLineId,
            plannedQuantity,
            plannedDate: values.plannedDate,
            notes: values.notes,
            ingredients: values.ingredients,
          }
        : {
            productId: values.productId ?? "",
            salesOrderId: null,
            salesOrderLineId: null,
            plannedQuantity,
            numberOfBatches: manualBatchCount,
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
    form.setValue("plannedDate", selected.shipDate ?? selected.requestedDate ?? todayDate, {
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
  const runOutputQuantity = batchCalc
    ? formatQuantity(String(batchCalc.plannedOutput))
    : formatQuantity(watchedPlannedQuantity);
  const runIngredientCount = isSalesOrderMode
    ? salesOrderPreview?.manufacturableLineCount ?? 0
    : fields.length;

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Manufacturing · Orders"
        title={isEditing ? "Edit Manufacturing Order" : "Add Manufacturing Order"}
        actions={
          <>
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
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid
        sidebar={
          <CreateSidebarCard
            title="Run summary"
            footer={
              <div className="w-full rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {watchedProductId || isSalesOrderMode
                  ? "Review ingredients before creating the order."
                  : "Pick a product to check the run."}
              </div>
            }
          >
            <SummaryRows
              rows={[
                {
                  label: "Output",
                  value: runOutputQuantity,
                },
                {
                  label: isSalesOrderMode ? "Orders" : "Ingredients",
                  value: runIngredientCount,
                },
                {
                  label: "Mode",
                  value: isBatchMode ? "Batch" : "Discrete",
                },
              ]}
            />
          </CreateSidebarCard>
        }
      >
      <form
        id="manufacturing-order-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-6">
          <CreateSection
            title="Order basics"
          >
            <FieldGroup>
              {!isEditing && (
                <Controller
                  control={form.control}
                  name="salesOrderId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>
                        <TooltipHeader
                          label="Sales Order"
                          tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                        />
                      </FieldLabel>
                      <Combobox
                        items={salesOrderIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => handleSalesOrderChange(value ?? "")}
                        itemToStringLabel={(value) =>
                          formatSalesOrderLabel(value, salesOrderMap)
                        }
                      >
                        <ComboboxInput
                          placeholder="Search open sales orders..."
                          showClear
                        />
                        <ComboboxContent className="bg-popover text-popover-foreground">
                          <ComboboxEmpty>No open sales orders found</ComboboxEmpty>
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
                          <FieldLabel htmlFor={field.name}>
                            <TooltipHeader
                              label="Sales Order Line"
                              tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                            />
                          </FieldLabel>
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
                                            ? `${line.quantity} ${line.unitName} • ${line.status}`
                                            : ""}
                                        </span>
                                      </div>
                                    </ComboboxItem>
                                  );
                                }}
                              </ComboboxList>
                            </ComboboxContent>
                          </Combobox>
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
                        <FieldLabel htmlFor={field.name}>
                          {isManualBatchCreate ? (
                            "Batches"
                          ) : (
                            <TooltipHeader
                              label="Planned Quantity"
                              tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP}
                            />
                          )}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          inputMode={isManualBatchCreate ? "numeric" : "decimal"}
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
                      {formatQuantity(String(batchYield))} {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}/batch
                      {" = "}
                      <span className="font-medium text-foreground">{formatQuantity(String(batchCalc.plannedOutput))} {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}</span>
                      {batchCalc.excess > 0 && (
                        <span className="text-muted-foreground"> ({formatQuantity(String(batchCalc.excess))} excess)</span>
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
                      {isSalesOrderMode && (
                        <FieldDescription>
                          Shared by every created order.
                        </FieldDescription>
                      )}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </CreateSection>

          {isSalesOrderMode ? (
            <CreateSection
              title="Sales order preview"
            >
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
                            <TableHead className="w-32 text-right">
                              <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
                            </TableHead>
                            <TableHead className="w-28">
                              <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />
                            </TableHead>
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
                                {line.quantity}
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
                      Select an open sales order.
                    </p>
                  </div>
                )}
              </FieldGroup>
            </CreateSection>
          ) : (
            <CreateSection
              title="Ingredients"
              action={
                <Badge variant={fields.length > 0 ? "secondary" : "outline"}>
                  {fields.length > 0 ? "BOM loaded" : "No product"}
                </Badge>
              }
            >
              <FieldGroup>
                {fields.length > 0 ? (
                  <EditableLineGrid
                    columns={MANUFACTURING_INGREDIENT_GRID_COLUMNS}
                    minWidth="42rem"
                    headers={[
                      "Ingredient",
                      <TooltipHeader
                        key="quantity"
                        label={isBatchMode ? "Qty / Batch" : "Qty / Unit"}
                        tooltip={
                          isBatchMode
                            ? BOM_QTY_PER_BATCH_TOOLTIP
                            : BOM_QTY_PER_UNIT_TOOLTIP
                        }
                      />,
                      <TooltipHeader
                        key="planned-total"
                        label="Planned Total"
                        tooltip={MANUFACTURING_PLANNED_TOTAL_TOOLTIP}
                      />,
                      <TooltipHeader key="unit" label="Unit" tooltip={UNIT_TOOLTIP} />,
                    ]}
                  >
                    {fields.map((field, index) => {
                      const templateIngredient = isEditing
                        ? initialData?.ingredients[index]
                        : selectedProduct?.bom[index];
                      const selectedIngredientId =
                        watchedIngredients?.[index]?.itemId ?? field.itemId;
                      const materialOptions = templateIngredient
                        ? [
                            {
                              itemId:
                                templateIngredient.defaultItemId ??
                                templateIngredient.itemId,
                              itemName:
                                templateIngredient.defaultItemName ??
                                templateIngredient.itemName,
                              itemSku:
                                templateIngredient.defaultItemSku ??
                                templateIngredient.itemSku,
                              itemType: templateIngredient.itemType,
                              unitName:
                                templateIngredient.defaultUnitName ??
                                templateIngredient.unitName,
                              quantityFactor: "1",
                            },
                            ...templateIngredient.alternates,
                          ]
                        : [];
                      const selectedMaterial =
                        materialOptions.find(
                          (option) => option.itemId === selectedIngredientId
                        ) ?? materialOptions[0];
                      const quantityPerUnit =
                        watchedIngredients?.[index]?.quantityPerUnit ?? "";
                      const perUnit = parsePositive(quantityPerUnit);
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
                        <EditableLineGridRow key={field.id}>
                          <EditableLineGridCell>
                            <div className="space-y-1">
                              {materialOptions.length > 1 ? (
                                <Field>
                                  <FieldLabel
                                    className="sr-only"
                                    htmlFor={`${field.id}-ingredient`}
                                  >
                                    Ingredient
                                  </FieldLabel>
                                  <Combobox
                                    items={materialOptions.map((option) => option.itemId)}
                                    value={selectedIngredientId}
                                    onValueChange={(value) => {
                                      const option = materialOptions.find(
                                        (candidate) => candidate.itemId === value
                                      );
                                      if (!option || !templateIngredient) return;

                                      form.setValue(
                                        `ingredients.${index}.itemId`,
                                        option.itemId,
                                        { shouldValidate: true, shouldDirty: true }
                                      );
                                      form.setValue(
                                        `ingredients.${index}.quantityPerUnit`,
                                        multiplyQuantityString(
                                          templateIngredient.defaultQuantityPerUnit,
                                          option.quantityFactor
                                        ),
                                        { shouldValidate: true, shouldDirty: true }
                                      );
                                    }}
                                    itemToStringLabel={(value) =>
                                      materialOptions.find(
                                        (option) => option.itemId === value
                                      )?.itemName ?? ""
                                    }
                                  >
                                    <ComboboxInput
                                      id={`${field.id}-ingredient`}
                                      className="w-full min-w-0"
                                      placeholder="Select material..."
                                    />
                                    <ComboboxContent className="w-[min(32rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
                                      <ComboboxEmpty>No materials found</ComboboxEmpty>
                                      <ComboboxList>
                                        {(id: string) => {
                                          const option = materialOptions.find(
                                            (candidate) => candidate.itemId === id
                                          );
                                          return (
                                            <ComboboxItem key={id} value={id}>
                                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                                <span className="truncate">
                                                  {option?.itemName}
                                                </span>
                                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                                  {option?.unitName}
                                                </span>
                                              </div>
                                            </ComboboxItem>
                                          );
                                        }}
                                      </ComboboxList>
                                    </ComboboxContent>
                                  </Combobox>
                                </Field>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {selectedMaterial?.itemName ?? field.itemId}
                                  </span>
                                  <Badge variant="outline">
                                    {selectedMaterial?.itemType ?? "item"}
                                  </Badge>
                                </div>
                              )}
                              {selectedMaterial?.itemSku && (
                                <p className="text-xs text-muted-foreground">
                                  {selectedMaterial.itemSku}
                                </p>
                              )}
                            </div>
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`ingredients.${index}.quantityPerUnit`}
                              render={({ field: quantityField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <FieldLabel
                                    className="sr-only"
                                    htmlFor={`${field.id}-quantity-per-unit`}
                                  >
                                    {isBatchMode ? "Qty / Batch" : "Qty / Unit"}
                                  </FieldLabel>
                                  <Input
                                    {...quantityField}
                                    id={`${field.id}-quantity-per-unit`}
                                    aria-invalid={fieldState.invalid}
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className="w-full min-w-0"
                                  />
                                  {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                  )}
                                </Field>
                              )}
                            />
                            <input
                              type="hidden"
                              value={selectedIngredientId}
                              {...form.register(`ingredients.${index}.itemId`)}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell>{plannedTotal}</EditableLineGridCell>
                          <EditableLineGridCell>
                            {selectedMaterial?.unitName ?? "\u2014"}
                          </EditableLineGridCell>
                        </EditableLineGridRow>
                      );
                    })}
                  </EditableLineGrid>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      {watchedProductId
                        ? "No eligible BOM ingredients."
                        : "Select a product."}
                    </p>
                  </div>
                )}

                {ingredientsError && <FieldError>{ingredientsError}</FieldError>}
              </FieldGroup>
            </CreateSection>
          )}

          <CreateSection
            title="Notes"
          >
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
          </CreateSection>
        </FieldGroup>
      </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}
