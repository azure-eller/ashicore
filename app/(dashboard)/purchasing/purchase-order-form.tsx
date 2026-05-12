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
import {
  formatPrice,
  getFieldArrayError,
  getFirstFormErrorMessage,
  parsePositive,
} from "@/lib/format";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
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

const PURCHASE_ORDER_LINE_GRID_COLUMNS =
  "2.5rem minmax(18rem, 1fr) 7rem 8rem 9rem 7rem 2.5rem";

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

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        ...material,
        displayName: material.name,
        itemType: "material" as const,
        unitName: material.stockingUnitName,
      })),
    [materials]
  );
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
  const watchedSupplierId = useWatch({
    control: form.control,
    name: "supplierId",
  });

  const { fields, append, move, remove } = useFieldArray({
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
        setFormError(error.error ?? "Fix the highlighted fields.");
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
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const linesError = getFieldArrayError(form.formState.errors.lines);
  const selectedSupplier = supplierOptionsSorted.find(
    (supplier) => supplier.id === watchedSupplierId
  );

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Purchasing · Orders"
        title={isEditing ? "Edit Purchase Order" : "Add Purchase Order"}
        actions={
          <>
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
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid
        sidebar={
          <>
            <CreateSidebarCard
              title="Order summary"
              footer={
                <div className="flex w-full items-end justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">
                      Order total
                    </div>
                    <div className="text-xs text-muted-foreground">USD</div>
                  </div>
                  <div className="font-mono text-xl font-semibold tabular-nums">
                    {formatPrice(orderTotal.toFixed(4)) ?? "$0.00"}
                  </div>
                </div>
              }
            >
              <SummaryRows
                rows={[
                  {
                    label: `Subtotal (${watchedLines?.length ?? 0} item${
                      (watchedLines?.length ?? 0) === 1 ? "" : "s"
                    })`,
                    value: formatPrice(orderTotal.toFixed(4)) ?? "$0.00",
                  },
                ]}
              />
            </CreateSidebarCard>
            {selectedSupplier ? (
              <CreateSidebarCard title="Selected supplier">
                <div className="space-y-1">
                  <div className="font-medium">{selectedSupplier.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedSupplier.code ?? "No supplier code"}
                  </div>
                </div>
              </CreateSidebarCard>
            ) : null}
          </>
        }
      >
      <form
        id="purchase-order-form"
        onSubmit={form.handleSubmit(
          (values) => mutation.mutate(values),
          handleInvalidSubmit
        )}
      >
        <FieldGroup className="gap-6">
          <CreateSection
            title="Order"
          >
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
          </CreateSection>

          <CreateSection
            title="Materials"
            action={
              <span className="text-xs text-muted-foreground">
                {fields.length} item{fields.length === 1 ? "" : "s"}
              </span>
            }
          >
            <FieldGroup className="gap-4">
              {fields.length > 0 ? (
                <SortableReorder
                  ids={fields.map((field) => field.id)}
                  onMove={(fromIndex, toIndex) => move(fromIndex, toIndex)}
                >
                  <EditableLineGrid
                    columns={PURCHASE_ORDER_LINE_GRID_COLUMNS}
                    minWidth="54rem"
                    headers={[
                      <span key="reorder" />,
                      "Material",
                      <TooltipHeader
                        key="ordered-qty"
                        label="Ordered Qty"
                        tooltip={PO_ORDERED_QTY_TOOLTIP}
                      />,
                      <TooltipHeader
                        key="purchase-unit"
                        label="Purchase Unit"
                        tooltip={PURCHASE_UNIT_TOOLTIP}
                      />,
                      <TooltipHeader
                        key="unit-cost"
                        label="Unit Cost"
                        tooltip={PURCHASE_UNIT_COST_TOOLTIP}
                      />,
                      <TooltipHeader
                        key="line-total"
                        label="Line Total"
                        tooltip={LINE_TOTAL_TOOLTIP}
                      />,
                      <span key="actions" />,
                    ]}
                  >
                    {fields.map((field, index) => (
                      <PurchaseOrderLineRow
                        key={field.id}
                        lineKey={field.id}
                        index={index}
                        control={form.control}
                        materials={materialOptions}
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
                  </EditableLineGrid>
                </SortableReorder>
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
          </CreateSection>

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

function PurchaseOrderLineRow({
  lineKey,
  index,
  control,
  materials,
  materialMap,
  onMaterialChange,
  onRemove,
}: {
  lineKey: string;
  index: number;
  control: Control<PurchaseOrderFormValues>;
  materials: Array<
    PurchaseOrderMaterialOption & {
      displayName: string;
      itemType: "material";
      unitName: string;
    }
  >;
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  onMaterialChange: (materialId: string) => void;
  onRemove: () => void;
}) {
  const line = useWatch({
    control,
    name: `lines.${index}`,
  });

  const material = line?.itemId ? materialMap.get(line.itemId) : undefined;
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(lineKey);

  return (
    <EditableLineGridRow ref={setNodeRef} style={style}>
      <EditableLineGridCell align="center">
        <SortableDragHandle
          attributes={attributes}
          listeners={listeners}
          label={`Reorder line ${index + 1}`}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-material`}>
                Material
              </FieldLabel>
              <InventoryItemCombobox
                options={materials}
                value={field.value ?? ""}
                onValueChange={(value) => onMaterialChange(value ?? "")}
                inputId={`${lineKey}-material`}
                inputAriaInvalid={fieldState.invalid}
                inputClassName="w-full min-w-0"
                placeholder="Search materials..."
                emptyMessage="No materials found"
                contentClassName="w-[min(32rem,calc(100vw-2rem))]"
                createLinks={[
                  {
                    href: "/inventory/materials/new",
                    label: "Create material",
                  },
                ]}
                getSecondaryText={(current) =>
                  [current.sku, current.stockingUnitName]
                    .filter((part): part is string => part != null && part !== "")
                    .join(" · ")
                }
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.quantityOrdered`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-quantity`}>
                Ordered Qty
              </FieldLabel>
              <Input
                {...field}
                id={`${lineKey}-quantity`}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="0"
                autoComplete="off"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell className="text-sm text-muted-foreground">
        <div className="space-y-1">
          <div>{material?.purchaseUnitName ?? material?.stockingUnitName ?? "\u2014"}</div>
          {material?.purchaseUnitName ? (
            <p className="text-xs text-muted-foreground">
              Stocked as {material.stockingUnitName}
            </p>
          ) : null}
        </div>
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.unitCost`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-unit-cost`}>
                Unit Cost
              </FieldLabel>
              <Input
                {...field}
                id={`${lineKey}-unit-cost`}
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
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="text-sm font-medium">
        {lineTotalLabel(line?.quantityOrdered, line?.unitCost)}
      </EditableLineGridCell>

      <EditableLineGridCell>
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
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}
