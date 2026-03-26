"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  insertPurchaseOrderSchema,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
import { formatPrice } from "@/lib/format";
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

function parsePositive(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

function buildLinesErrorMessage(linesError: unknown) {
  if (!linesError || typeof linesError !== "object") return null;
  if ("message" in linesError && typeof linesError.message === "string") {
    return linesError.message;
  }
  return null;
}

export function PurchaseOrderForm({
  suppliers,
  materials,
  initialData,
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  initialData?: PurchaseOrderEditData;
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
      : purchaseOrderDefaultValues,
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

  const handleCancel = () => {
    if (document.referrer.startsWith(window.location.origin)) {
      router.back();
      return;
    }

    router.push(fallbackPath);
  };

  const linesError = buildLinesErrorMessage(form.formState.errors.lines);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Purchase Order" : "Add Purchase Order"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? "Update this draft purchase order before it is sent."
              : "Create a draft material purchase order and receive it later into lots."}
          </p>
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
            <FieldDescription>
              Choose the supplier and expected arrival date for this draft PO.
            </FieldDescription>
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
                    <FieldLabel htmlFor={field.name}>Expected Date</FieldLabel>
                    <Input
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
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="gap-5">
            <FieldLegend>Materials</FieldLegend>
            <FieldDescription>
              Add each material once, then set ordered quantity and unit cost.
            </FieldDescription>
            <FieldGroup className="gap-4">
              {fields.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="w-32">Ordered Qty</TableHead>
                        <TableHead className="w-28">Unit</TableHead>
                        <TableHead className="w-40">Unit Cost</TableHead>
                        <TableHead className="w-32 text-right">Line Total</TableHead>
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
                    Add materials to build this purchase order.
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
                  <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" aria-hidden />
                  Add Material
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
            <FieldDescription>
              Capture any supplier-specific notes or receiving context for this PO.
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
        {material?.unitName ?? "\u2014"}
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
