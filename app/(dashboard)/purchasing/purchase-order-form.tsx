"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  type InsertPurchaseOrder,
  insertPurchaseOrderSchema,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
import { formatPrice, getFieldArrayError, parsePositive } from "@/lib/format";
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
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  PO_ORDERED_QTY_TOOLTIP,
  PURCHASE_UNIT_COST_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  PurchaseOrderEditData,
  PurchaseOrderMaterialOption,
  SupplierOption,
} from "./types";
import { SupplierSelect } from "./supplier-select";

type PurchaseOrderFormValues = z.input<typeof insertPurchaseOrderSchema>;

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

function parseNonNegative(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function lineTotalLabel(
  quantityOrdered: string | null | undefined,
  unitCost: string | null | undefined
) {
  const quantity = parsePositive(quantityOrdered);
  const cost = parseNonNegative(unitCost);
  if (quantity == null || cost == null) return "\u2014";
  return formatPrice((quantity * cost).toFixed(4)) ?? "\u2014";
}

export function PurchaseOrderForm({
  suppliers,
  materials,
  initialData,
  defaultValues,
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/purchasing/orders/${initialData.id}`
    : "/purchasing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [supplierOptions, setSupplierOptions] = useState(suppliers);

  const materialIds = materials.map((material) => material.id);
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const supplierOptionsSorted = [...supplierOptions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(insertPurchaseOrderSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          supplierId: initialData.supplierId,
          expectedDate: initialData.expectedDate,
          notes: initialData.notes,
          lines: initialData.lines.map((line) => ({
            itemId: line.itemId,
            quantityOrdered: line.quantityOrdered,
            unitCost: line.unitCost,
          })),
        }
      : (defaultValues ?? purchaseOrderDefaultValues),
  });

  const watchedLines = useWatch({
    control: form.control,
    name: "lines",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const orderTotal = useMemo(() => {
    return (watchedLines ?? []).reduce((sum, line) => {
      const quantity = parsePositive(line?.quantityOrdered);
      const cost = parseNonNegative(line?.unitCost);
      if (quantity == null || cost == null) return sum;
      return sum + quantity * cost;
    }, 0);
  }, [watchedLines]);

  const mutation = useMutation({
    mutationFn: async (values: PurchaseOrderFormValues) => {
      const response = await fetch(
        initialData ? `/api/purchase-orders/${initialData.id}` : "/api/purchase-orders",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save purchase order.",
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
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.push(initialData ? fallbackPath : `/purchasing/orders/${result.id}`);
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

      setFormError(error.error ?? "Failed to save purchase order.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);

  const linesError = getFieldArrayError(form.formState.errors.lines);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Purchase Order" : "Add Purchase Order"}
          </h1>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="purchase-order-form"
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
        id="purchase-order-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Order</FieldLegend>
            <FieldGroup>
              <Controller
                control={form.control}
                name="supplierId"
                render={({ field, fieldState }) => (
                  <SupplierSelect
                    suppliers={supplierOptionsSorted}
                    value={field.value}
                    onValueChange={(nextValue) => field.onChange(nextValue ?? "")}
                    onSupplierCreated={(supplier) => {
                      setSupplierOptions((current) => {
                        const existing = current.filter((row) => row.id !== supplier.id);
                        return [...existing, supplier];
                      });
                    }}
                    errorMessage={fieldState.error?.message}
                  />
                )}
              />

              <Controller
                control={form.control}
                name="expectedDate"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>
                      <TooltipHeader label="Expected Date" tooltip={EXPECTED_DELIVERY_DATE_TOOLTIP} />
                    </FieldLabel>
                    <DatePicker
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(value) => field.onChange(value || null)}
                      onBlur={field.onBlur}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="gap-5">
            <FieldLegend>Materials</FieldLegend>
            <FieldGroup className="gap-4">
              {fields.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-32">
                          <TooltipHeader label="Ordered Qty" tooltip={PO_ORDERED_QTY_TOOLTIP} />
                        </TableHead>
                        <TableHead className="w-32">
                          <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
                        </TableHead>
                        <TableHead className="w-40">
                          <TooltipHeader label="Unit Cost" tooltip={PURCHASE_UNIT_COST_TOOLTIP} />
                        </TableHead>
                        <TableHead className="w-32 text-right">
                          <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
                        </TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.map((field, index) => (
                        <PurchaseOrderLineRow
                          key={field.id}
                          index={index}
                          control={form.control}
                          materialIds={materialIds}
                          materialMap={materialMap}
                          onMaterialChange={(materialId) => {
                            const material = materialMap.get(materialId);
                            form.setValue(`lines.${index}.itemId`, materialId, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            form.setValue(
                              `lines.${index}.unitCost`,
                              material?.defaultPurchasePrice ?? "0",
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              }
                            );
                          }}
                          onRemove={() => remove(index)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-6">
                  <p className="text-sm text-muted-foreground">
                    No materials added.
                  </p>
                </div>
              )}

              {linesError && <p className="text-sm text-destructive">{linesError}</p>}

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      itemId: "",
                      quantityOrdered: null,
                      unitCost: null,
                    })
                  }
                >
                  Add Material
                  <HugeiconsIcon
                    icon={Add01Icon}
                    className="h-4 w-4"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>

                <div className="rounded-md border px-4 py-2 text-sm">
                  <span className="text-muted-foreground">Order Total</span>
                  <div className="font-medium">
                    {formatPrice(orderTotal.toFixed(4)) ?? "$0.00"}
                  </div>
                </div>
              </div>
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Notes</FieldLegend>
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

function PurchaseOrderLineRow({
  index,
  control,
  materialIds,
  materialMap,
  onMaterialChange,
  onRemove,
}: {
  index: number;
  control: Control<PurchaseOrderFormValues>;
  materialIds: string[];
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  onMaterialChange: (materialId: string) => void;
  onRemove: () => void;
}) {
  const line = useWatch({
    control,
    name: `lines.${index}`,
  });

  const material = line?.itemId ? materialMap.get(line.itemId) : undefined;

  return (
    <TableRow>
      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <div>
              <Combobox
                items={materialIds}
                value={field.value ?? ""}
                onValueChange={(value) => onMaterialChange(value ?? "")}
                itemToStringLabel={(value) => materialMap.get(value)?.name ?? ""}
              >
                <ComboboxInput placeholder="Search materials..." />
                <ComboboxContent className="bg-popover text-popover-foreground">
                  <ComboboxEmpty>No materials found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => {
                      const current = materialMap.get(value);
                      return (
                        <ComboboxItem key={value} value={value}>
                          <span>{current?.name ?? value}</span>
                          {current?.sku && (
                            <span className="ml-auto text-xs text-muted-foreground">
                              {current.sku}
                            </span>
                          )}
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </div>
          )}
        />
      </TableCell>

      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.quantityOrdered`}
          render={({ field, fieldState }) => (
            <div>
              <Input
                {...field}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="0"
                autoComplete="off"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </div>
          )}
        />
      </TableCell>

      <TableCell className="text-sm text-muted-foreground">
        <div className="space-y-1">
          <div>{material?.purchaseUnitName ?? material?.stockingUnitName ?? "\u2014"}</div>
          {material?.purchaseUnitName ? (
            <p className="text-xs text-muted-foreground">
              Stocked as {material.stockingUnitName}
            </p>
          ) : null}
        </div>
      </TableCell>

      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.unitCost`}
          render={({ field, fieldState }) => (
            <div>
              <Input
                {...field}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : material?.defaultPurchasePrice == null && material ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  No default purchase price. Enter one manually.
                </p>
              ) : null}
            </div>
          )}
        />
      </TableCell>

      <TableCell className="text-right text-sm font-medium">
        {lineTotalLabel(line?.quantityOrdered, line?.unitCost)}
      </TableCell>

      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          className="text-muted-foreground"
          aria-label={`Remove line ${index + 1}`}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </TableCell>
    </TableRow>
  );
}
