"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type {
  CellClassParams,
  ICellEditorParams,
  ValueSetterParams,
} from "ag-grid-community";
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
  EditableLineDataGrid,
  type ColDef,
} from "@/components/editable-line-data-grid";
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
type PricingBreakPayloadRow = PricingScheduleFormValues["breaks"][number];
type PricingBreakGridRow = PricingBreakPayloadRow & {
  clientRowId: string;
};
type PricingBreakColumnKey = keyof PricingBreakPayloadRow;

function createPricingBreakRow(values?: Partial<PricingBreakPayloadRow>): PricingBreakGridRow {
  return {
    clientRowId: crypto.randomUUID(),
    minQuantity: values?.minQuantity ?? "",
    maxQuantity: values?.maxQuantity ?? null,
    discountPercent: values?.discountPercent ?? "0",
  };
}

function normalizePricingBreakRows(
  rows: PricingBreakPayloadRow[] | undefined
): PricingBreakGridRow[] {
  const source =
    rows && rows.length > 0
      ? rows
      : pricingScheduleDefaultValues.breaks;
  return source.map((row) => createPricingBreakRow(row));
}

function toPricingBreakPayloadRows(rows: PricingBreakGridRow[]): PricingBreakPayloadRow[] {
  return rows.map(({ minQuantity, maxQuantity, discountPercent }) => ({
    minQuantity,
    maxQuantity,
    discountPercent,
  }));
}

function comparablePricingBreakRows(rows: PricingBreakGridRow[]) {
  return JSON.stringify(toPricingBreakPayloadRows(rows));
}

function normalizeGridText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeNullableGridText(value: unknown) {
  const text = normalizeGridText(value);
  return text === "" ? null : text;
}

function validatePositiveGridNumber(value: unknown, message: string) {
  const text = normalizeGridText(value);
  if (text === "") return [message];
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? null : [message];
}

function validateDiscountPercent(value: unknown) {
  const text = normalizeGridText(value);
  if (text === "") return ["Discount percent is required"];
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return ["Discount percent must be 0 or greater"];
  }
  if (parsed > 100) {
    return ["Discount percent cannot exceed 100"];
  }
  return null;
}

function getPricingBreakCellError(
  error: unknown,
  rowIndex: number,
  key: PricingBreakColumnKey
) {
  if (!error || typeof error !== "object") return null;
  const rowError = (error as Record<string, unknown>)[rowIndex];
  if (!rowError || typeof rowError !== "object") return null;
  const cellError = (rowError as Record<string, unknown>)[key];
  if (!cellError || typeof cellError !== "object") return null;
  return "message" in cellError && typeof cellError.message === "string"
    ? cellError.message
    : null;
}

function parsePositiveQuantity(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatQuantityInput(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function nextBreakStart(value: string | null | undefined) {
  const parsed = parsePositiveQuantity(value);
  return parsed == null ? "" : formatQuantityInput(parsed + 1);
}

function previousBreakEnd(value: string | null | undefined) {
  const parsed = parsePositiveQuantity(value);
  if (parsed == null || parsed <= 1) return "1";
  return formatQuantityInput(parsed - 1);
}

function normalizePricingBreakSequence(rows: PricingBreakGridRow[]) {
  const normalized = rows.map((row) => ({ ...row }));

  for (let index = 0; index < normalized.length; index += 1) {
    const row = normalized[index];

    if (index > 0) {
      const previous = normalized[index - 1];

      if (previous.maxQuantity == null || previous.maxQuantity.trim() === "") {
        previous.maxQuantity = previousBreakEnd(row.minQuantity);
      }

      row.minQuantity = nextBreakStart(previous.maxQuantity);
    }

    if (index === 0 && parsePositiveQuantity(row.minQuantity) == null) {
      row.minQuantity = "1";
    }

    const minQuantity = parsePositiveQuantity(row.minQuantity);
    const maxQuantity = parsePositiveQuantity(row.maxQuantity);
    if (
      row.maxQuantity != null &&
      minQuantity != null &&
      maxQuantity != null &&
      maxQuantity < minQuantity
    ) {
      row.maxQuantity = formatQuantityInput(minQuantity);
    }
  }

  return normalized;
}

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

  const [initialBreakRows] = useState(() =>
    normalizePricingBreakSequence(
      normalizePricingBreakRows(
        initialData?.breaks ?? pricingScheduleDefaultValues.breaks
      )
    )
  );
  const [initialBreakComparable] = useState(() =>
    comparablePricingBreakRows(
      normalizePricingBreakSequence(
        normalizePricingBreakRows(
          initialData?.breaks ?? pricingScheduleDefaultValues.breaks
        )
      )
    )
  );
  const [breakRows, setBreakRows] = useState<PricingBreakGridRow[]>(initialBreakRows);

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
  const breakColumns = useMemo<ColDef<PricingBreakGridRow>[]>(
    () => {
      const hasCellError =
        (key: PricingBreakColumnKey) =>
        (params: CellClassParams<PricingBreakGridRow>) => {
          if (!params.data) return false;
          const rowIndex = breakRows.findIndex(
            (row) => row.clientRowId === params.data?.clientRowId
          );
          return rowIndex >= 0
            ? Boolean(getPricingBreakCellError(form.formState.errors.breaks, rowIndex, key))
            : false;
        };

      const cellTooltip =
        (key: PricingBreakColumnKey) =>
        ({ data }: { data?: PricingBreakGridRow }) => {
          if (!data) return null;
          const rowIndex = breakRows.findIndex(
            (row) => row.clientRowId === data.clientRowId
          );
          return rowIndex >= 0
            ? getPricingBreakCellError(form.formState.errors.breaks, rowIndex, key)
            : null;
        };

      return [
        {
          field: "minQuantity",
          headerName: "Min Qty",
          headerTooltip: MIN_QTY_TOOLTIP,
          minWidth: 132,
          flex: 1,
          editable: (params) => params.node.rowIndex === 0,
          cellEditor: "agTextCellEditor",
          valueSetter: (params: ValueSetterParams<PricingBreakGridRow, string | null>) => {
            params.data.minQuantity = normalizeGridText(params.newValue);
            return true;
          },
          cellEditorParams: {
            getValidationErrors: ({ value }: { value: string | null | undefined }) =>
              validatePositiveGridNumber(value, "Minimum quantity must be greater than 0"),
          },
          cellClass: "num",
          cellClassRules: {
            "erp-editable-grid-cell-error": hasCellError("minQuantity"),
          },
          tooltipValueGetter: cellTooltip("minQuantity"),
        },
        {
          field: "maxQuantity",
          headerName: "Max Qty",
          headerTooltip: MAX_QTY_TOOLTIP,
          minWidth: 132,
          flex: 1,
          editable: true,
          cellEditor: "agTextCellEditor",
          valueSetter: (params: ValueSetterParams<PricingBreakGridRow, string | null>) => {
            params.data.maxQuantity = normalizeNullableGridText(params.newValue);
            return true;
          },
          cellEditorParams: {
            getValidationErrors: ({
              value,
              cellEditorParams,
            }: {
              value: string | null | undefined;
              cellEditorParams: ICellEditorParams<PricingBreakGridRow>;
            }) => {
              const text = normalizeNullableGridText(value);
              if (text == null) return null;
              const positiveError = validatePositiveGridNumber(
                text,
                "Maximum quantity must be greater than 0"
              );
              if (positiveError) return positiveError;
              return Number(text) >= Number(cellEditorParams.data.minQuantity)
                ? null
                : ["Maximum quantity must be greater than or equal to the minimum quantity"];
            },
          },
          valueFormatter: ({ value }) => value ?? "",
          cellClass: "num",
          cellClassRules: {
            "erp-editable-grid-cell-error": hasCellError("maxQuantity"),
          },
          tooltipValueGetter: cellTooltip("maxQuantity"),
        },
        {
          field: "discountPercent",
          headerName: "Discount %",
          headerTooltip: DISCOUNT_PERCENT_TOOLTIP,
          minWidth: 144,
          flex: 1,
          editable: true,
          cellEditor: "agTextCellEditor",
          valueSetter: (params: ValueSetterParams<PricingBreakGridRow, string | null>) => {
            params.data.discountPercent = normalizeGridText(params.newValue);
            return true;
          },
          cellEditorParams: {
            getValidationErrors: ({ value }: { value: string | null | undefined }) =>
              validateDiscountPercent(value),
          },
          cellClass: "num",
          cellClassRules: {
            "erp-editable-grid-cell-error": hasCellError("discountPercent"),
          },
          tooltipValueGetter: cellTooltip("discountPercent"),
        },
      ];
    },
    [breakRows, form.formState.errors.breaks]
  );
  const handleBreakRowsChange = useCallback(
    (rows: PricingBreakGridRow[]) => {
      const normalizedRows = normalizePricingBreakSequence(rows);
      setBreakRows(normalizedRows);
      const dirty =
        comparablePricingBreakRows(normalizedRows) !== initialBreakComparable;
      form.setValue("breaks", toPricingBreakPayloadRows(normalizedRows), {
        shouldDirty: dirty,
        shouldTouch: false,
        shouldValidate: false,
      });
    },
    [form, initialBreakComparable]
  );
  const createBreakRow = useCallback(() => {
    const lastBreak = breakRows.at(-1);
    return createPricingBreakRow({
      minQuantity:
        lastBreak?.maxQuantity != null
          ? nextBreakStart(lastBreak.maxQuantity)
          : nextBreakStart(lastBreak?.minQuantity ?? "1"),
      maxQuantity: null,
      discountPercent: "0",
    });
  }, [breakRows]);
  const getBreakRowId = useCallback((row: PricingBreakGridRow) => row.clientRowId, []);

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
              <div className="space-y-(--space-4)">
                {breakRows.map((row, index) => {
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
                      className="grid gap-(--space-3) border border-border bg-muted p-(--space-4)"
                    >
                      <div className="flex items-center justify-between gap-(--space-4) text-[length:var(--text-xs)] text-muted-foreground">
                        <span>{range}</span>
                        <span>{Number.isFinite(discount) ? discount : 0}% discount</span>
                      </div>
                      <AffixedInput
                        prefix="$"
                        value={
                          effective == null
                            ? ""
                            : (formatPrice(effective.toFixed(2)) ?? "").replace(/^\$/, "")
                        }
                        readOnly
                        aria-label={`${range} effective price`}
                      />
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

              <FieldGroup className="grid gap-4 md:grid-cols-2">
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
              </FieldGroup>

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
                {breakRows.length} break{breakRows.length === 1 ? "" : "s"}
              </span>
            }
          >
            <EditableLineDataGrid
              rows={breakRows}
              columns={breakColumns}
              getRowId={getBreakRowId}
              createRow={createBreakRow}
              onRowsChange={handleBreakRowsChange}
              addLabel="Add break"
              emptyMessage="No quantity breaks yet."
              enableReorder={false}
              error={breaksError}
            />
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
