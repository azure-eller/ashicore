"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  type InsertPurchaseOrder,
  type PurchaseOrderAdditionalCostDistributionMethod,
  type PurchaseOrderAdditionalCostType,
  insertPurchaseOrderSchema,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
import {
  formatPrice,
  getFieldArrayError,
  getFirstFormErrorMessage,
  normalizeMoney,
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
  EditableLineGridCell,
  EditableLineGridRemoveButton,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import {
  EditableLineItems,
  type EditableLineItemRowProps,
} from "@/components/editable-line-items";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  SortableDragHandle,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields, addressFieldNames } from "@/components/address-fields";
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

type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
};

const PURCHASE_ORDER_LINE_GRID_COLUMNS =
  "2.25rem 2.25rem minmax(14rem, 1.6fr) minmax(5.5rem, 0.55fr) minmax(7rem, 0.75fr) minmax(7.5rem, 0.75fr) minmax(7rem, 0.65fr) minmax(6.5rem, 0.55fr)";
const PURCHASE_ORDER_COST_GRID_COLUMNS =
  "2.25rem minmax(8rem, 0.75fr) minmax(12rem, 1.25fr) minmax(9rem, 0.8fr) minmax(8rem, 0.75fr) minmax(7rem, 0.65fr) 2.25rem";
const PURCHASE_ORDER_SHIP_FIELD_NAMES = addressFieldNames("ship");

const ADDITIONAL_COST_TYPE_LABELS: Record<PurchaseOrderAdditionalCostType, string> = {
  shipping: "Shipping",
  customs: "Customs",
  other: "Other",
};

const ADDITIONAL_COST_DISTRIBUTION_LABELS: Record<
  PurchaseOrderAdditionalCostDistributionMethod,
  string
> = {
  by_value: "By value",
  not_distributed: "Not distributed",
};

const blankPurchaseOrderLine = {
  itemId: "",
  quantityOrdered: null,
  unitCost: null,
  xeroPurchaseAccountCode: null,
};

const blankPurchaseOrderAdditionalCost = {
  costType: "shipping" as const,
  reference: null,
  distributionMethod: "by_value" as const,
  xeroPurchaseAccountCode: null,
  amount: null,
};

function isBlankPurchaseOrderLine(
  line: PurchaseOrderFormValues["lines"][number] | undefined
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  const xeroPurchaseAccountCode = line?.xeroPurchaseAccountCode?.trim() ?? "";
  return (
    itemId === "" &&
    quantityOrdered === "" &&
    unitCost === "" &&
    xeroPurchaseAccountCode === ""
  );
}

function isBlankPurchaseOrderAdditionalCost(
  cost:
    | NonNullable<PurchaseOrderFormValues["additionalCosts"]>[number]
    | undefined
) {
  const reference = cost?.reference?.trim() ?? "";
  const xeroPurchaseAccountCode = cost?.xeroPurchaseAccountCode?.trim() ?? "";
  const amount = cost?.amount?.trim() ?? "";
  return (
    (cost?.costType == null || cost.costType === "shipping") &&
    (cost?.distributionMethod == null || cost.distributionMethod === "by_value") &&
    reference === "" &&
    xeroPurchaseAccountCode === "" &&
    amount === ""
  );
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
  const xeroAccountsQuery = useQuery({
    queryKey: ["xero-accounts"],
    queryFn: async () => {
      const response = await fetch("/api/xero/accounts");
      if (!response.ok) return { accounts: [] as XeroAccountOption[] };
      return response.json() as Promise<{ accounts: XeroAccountOption[] }>;
    },
  });
  const xeroAccounts = xeroAccountsQuery.data?.accounts ?? [];

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
          shippingCost: initialData.shippingCost,
          notes: initialData.notes,
          xeroPurchaseAccountCode: initialData.xeroPurchaseAccountCode,
          shipLine1: initialData.shipLine1,
          shipLine2: initialData.shipLine2,
          shipCity: initialData.shipCity,
          shipRegion: initialData.shipRegion,
          shipPostcode: initialData.shipPostcode,
          shipCountry: initialData.shipCountry,
          lines: initialData.lines.map((line) => ({
            itemId: line.itemId,
            quantityOrdered: line.quantityOrdered,
            unitCost: line.unitCost,
            xeroPurchaseAccountCode: line.xeroPurchaseAccountCode,
          })),
          additionalCosts: initialData.additionalCosts,
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
  const watchedShippingCost = useWatch({
    control: form.control,
    name: "shippingCost",
  });
  const watchedAdditionalCosts = useWatch({
    control: form.control,
    name: "additionalCosts",
  });

  const materialsTotal = useMemo(() => {
    return (watchedLines ?? []).reduce((sum, line) => {
      const quantity = parsePositive(line?.quantityOrdered);
      const cost = parseNonNegative(line?.unitCost);
      if (quantity == null || cost == null) return sum;
      return sum + quantity * cost;
    }, 0);
  }, [watchedLines]);
  const additionalCostRows = watchedAdditionalCosts ?? [];
  const legacyShippingCost =
    additionalCostRows.length === 0 ? (parseNonNegative(watchedShippingCost) ?? 0) : 0;
  const additionalCostTotal = (watchedAdditionalCosts ?? []).reduce((sum, cost) => {
    const amount = parseNonNegative(cost?.amount);
    return sum + (amount ?? 0);
  }, legacyShippingCost);
  const distributedAdditionalCostTotal = (watchedAdditionalCosts ?? []).reduce(
    (sum, cost) => {
      if (cost?.distributionMethod !== "by_value") return sum;
      const amount = parseNonNegative(cost?.amount);
      return sum + (amount ?? 0);
    },
    legacyShippingCost
  );
  const nonDistributedAdditionalCostTotal =
    additionalCostTotal - distributedAdditionalCostTotal;
  const orderTotal = materialsTotal + nonDistributedAdditionalCostTotal;
  const lineCount = (watchedLines ?? []).filter(
    (line) => !isBlankPurchaseOrderLine(line)
  ).length;
  const additionalCostCount = additionalCostRows.filter(
    (cost) => !isBlankPurchaseOrderAdditionalCost(cost)
  ).length;

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
  const additionalCostsError = getFieldArrayError(
    form.formState.errors.additionalCosts
  );
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
                    label: `Subtotal (${lineCount} item${
                      lineCount === 1 ? "" : "s"
                    })`,
                    value: formatPrice(materialsTotal.toFixed(4)) ?? "$0.00",
                  },
                  {
                    label: "Additional costs",
                    value: formatPrice(additionalCostTotal.toFixed(4)) ?? "$0.00",
                  },
                  {
                    label: "Landed into inventory",
                    value:
                      formatPrice(distributedAdditionalCostTotal.toFixed(4)) ??
                      "$0.00",
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

              <Controller
                control={form.control}
                name="xeroPurchaseAccountCode"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>
                      Xero Default Purchase Account
                    </FieldLabel>
                    <XeroAccountInput
                      id={field.name}
                      name={field.name}
                      value={field.value ?? ""}
                      accounts={xeroAccounts}
                      placeholder="Use Xero setting"
                      ariaInvalid={fieldState.invalid}
                      onChange={(value) => field.onChange(value || null)}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <input type="hidden" {...form.register("shippingCost")} />
            </FieldGroup>
          </CreateSection>

          <CreateSection
            title="Materials"
            action={
              <span className="text-xs text-muted-foreground">
                {lineCount} item{lineCount === 1 ? "" : "s"}
              </span>
            }
          >
            <FieldGroup className="gap-4">
                <EditableLineItems<PurchaseOrderFormValues, "lines">
                  control={form.control}
                  name="lines"
                  columns={PURCHASE_ORDER_LINE_GRID_COLUMNS}
                  minWidth="52rem"
                  blankLine={blankPurchaseOrderLine}
                  isBlankLine={isBlankPurchaseOrderLine}
                  error={linesError}
                  headers={[
                    <span key="actions" />,
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
                    "Xero Account",
                    <TooltipHeader
                      key="line-total"
                      label="Line Total"
                      tooltip={LINE_TOTAL_TOOLTIP}
                    />,
                  ]}
                  renderRow={({ field, index, remove, rowProps }) => (
                      <PurchaseOrderLineRow
                        key={field.id}
                        lineKey={field.id}
                        index={index}
                        rowProps={rowProps}
                        control={form.control}
                        materials={materialOptions}
                        materialMap={materialMap}
                        xeroAccounts={xeroAccounts}
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
                          form.setValue(
                            `lines.${index}.xeroPurchaseAccountCode`,
                            material?.xeroPurchaseAccountCode ?? null,
                            {
                              shouldDirty: true,
                              shouldValidate: true,
                            }
                          );
                        }}
                        onRemove={remove}
                      />
                    )}
                  footer={
                    <div className="rounded-md border px-4 py-2 text-sm">
                      <span className="text-muted-foreground">Order Total</span>
                      <div className="font-medium">
                        {formatPrice(materialsTotal.toFixed(4)) ?? "$0.00"}
                      </div>
                    </div>
                  }
                />
            </FieldGroup>
          </CreateSection>

          <CreateSection title="Delivery Address">
            <AddressFields
              control={form.control}
              names={PURCHASE_ORDER_SHIP_FIELD_NAMES}
              idPrefix="po-ship"
            />
          </CreateSection>

          <CreateSection
            title="Additional Costs"
            action={
              <span className="text-xs text-muted-foreground">
                {additionalCostCount} cost
                {additionalCostCount === 1 ? "" : "s"}
              </span>
            }
          >
            <FieldGroup className="gap-4">
              <EditableLineItems<PurchaseOrderFormValues, "additionalCosts">
                control={form.control}
                name="additionalCosts"
                columns={PURCHASE_ORDER_COST_GRID_COLUMNS}
                minWidth="50rem"
                blankLine={blankPurchaseOrderAdditionalCost}
                isBlankLine={isBlankPurchaseOrderAdditionalCost}
                error={additionalCostsError}
                headers={[
                  <span key="reorder" />,
                  "Cost",
                  "Reference",
                  "Distribution",
                  "Xero Account",
                  "Amount",
                  <span key="actions" />,
                ]}
                renderRow={({ field, index, remove, rowProps }) => (
                  <PurchaseOrderAdditionalCostRow
                    key={field.id}
                    lineKey={field.id}
                    index={index}
                    rowProps={rowProps}
                    control={form.control}
                    xeroAccounts={xeroAccounts}
                    onRemove={remove}
                  />
                )}
                footer={
                  <div className="rounded-md border px-4 py-2 text-sm">
                    <span className="text-muted-foreground">
                      Additional Costs
                    </span>
                    <div className="font-medium">
                      {formatPrice(additionalCostTotal.toFixed(4)) ?? "$0.00"}
                    </div>
                  </div>
                }
              />
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

function XeroAccountInput({
  id,
  name,
  value,
  accounts,
  placeholder,
  ariaInvalid,
  onChange,
}: {
  id: string;
  name?: string;
  value: string;
  accounts: XeroAccountOption[];
  placeholder: string;
  ariaInvalid: boolean;
  onChange: (value: string) => void;
}) {
  if (accounts.length > 0) {
    return (
      <Select
        value={value || "__default__"}
        onValueChange={(nextValue) =>
          onChange(nextValue === "__default__" ? "" : nextValue)
        }
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={ariaInvalid}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">{placeholder}</SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account.code} value={account.code}>
              {account.code} · {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      id={id}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={ariaInvalid}
      placeholder={placeholder}
      autoComplete="off"
    />
  );
}

function PurchaseOrderLineRow({
  lineKey,
  index,
  control,
  materials,
  materialMap,
  xeroAccounts,
  onMaterialChange,
  onRemove,
  rowProps,
}: {
  lineKey: string;
  index: number;
  rowProps: EditableLineItemRowProps;
  control: Control<PurchaseOrderFormValues>;
  materials: Array<
    PurchaseOrderMaterialOption & {
      displayName: string;
      itemType: "material";
      unitName: string;
    }
  >;
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  xeroAccounts: XeroAccountOption[];
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
    <EditableLineGridRow ref={setNodeRef} style={style} {...rowProps}>
      <EditableLineGridCell>
        <EditableLineGridRemoveButton
          onClick={onRemove}
          label={`Remove line ${index + 1}`}
          className="opacity-100"
        />
      </EditableLineGridCell>

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
        <div className="flex flex-col gap-1">
          <div className="truncate">
            {material?.purchaseUnitName ?? material?.stockingUnitName ?? "\u2014"}
          </div>
          {material?.purchaseUnitName && material.stockingUnitName !== material.purchaseUnitName ? (
            <p className="truncate text-xs text-muted-foreground">
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

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.xeroPurchaseAccountCode`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-xero-account`}>
                Xero Account
              </FieldLabel>
              <XeroAccountInput
                id={`${lineKey}-xero-account`}
                name={field.name}
                value={field.value ?? ""}
                accounts={xeroAccounts}
                placeholder={material?.xeroPurchaseAccountCode ?? "Account"}
                ariaInvalid={fieldState.invalid}
                onChange={(value) => field.onChange(value || null)}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="text-sm font-medium">
        {lineTotalLabel(line?.quantityOrdered, line?.unitCost)}
      </EditableLineGridCell>

    </EditableLineGridRow>
  );
}

function PurchaseOrderAdditionalCostRow({
  lineKey,
  index,
  control,
  xeroAccounts,
  onRemove,
  rowProps,
}: {
  lineKey: string;
  index: number;
  rowProps: EditableLineItemRowProps;
  control: Control<PurchaseOrderFormValues>;
  xeroAccounts: XeroAccountOption[];
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(lineKey);

  return (
    <EditableLineGridRow ref={setNodeRef} style={style} {...rowProps}>
      <EditableLineGridCell align="center">
        <SortableDragHandle
          attributes={attributes}
          listeners={listeners}
          label={`Reorder additional cost ${index + 1}`}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`additionalCosts.${index}.costType`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only">Cost</FieldLabel>
              <Select
                value={field.value}
                onValueChange={(value) =>
                  field.onChange(value as PurchaseOrderAdditionalCostType)
                }
              >
                <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ADDITIONAL_COST_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`additionalCosts.${index}.reference`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-reference`}>
                Reference
              </FieldLabel>
              <Input
                {...field}
                id={`${lineKey}-reference`}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value || null)}
                aria-invalid={fieldState.invalid}
                placeholder="Reference"
                autoComplete="off"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`additionalCosts.${index}.distributionMethod`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only">Distribution</FieldLabel>
              <Select
                value={field.value}
                onValueChange={(value) =>
                  field.onChange(
                    value as PurchaseOrderAdditionalCostDistributionMethod
                  )
                }
              >
                <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ADDITIONAL_COST_DISTRIBUTION_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`additionalCosts.${index}.xeroPurchaseAccountCode`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-xero-account`}>
                Xero Account
              </FieldLabel>
              <XeroAccountInput
                id={`${lineKey}-xero-account`}
                name={field.name}
                value={field.value ?? ""}
                accounts={xeroAccounts}
                placeholder="PO default"
                ariaInvalid={fieldState.invalid}
                onChange={(value) => field.onChange(value || null)}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`additionalCosts.${index}.amount`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-amount`}>
                Amount
              </FieldLabel>
              <Input
                {...field}
                id={`${lineKey}-amount`}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.value)}
                onBlur={(event) => {
                  field.onBlur();
                  const parsed = parseNonNegative(event.target.value);
                  field.onChange(parsed == null ? "" : normalizeMoney(parsed));
                }}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="Amount"
                autoComplete="off"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <EditableLineGridRemoveButton
          onClick={onRemove}
          label={`Remove additional cost ${index + 1}`}
        />
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}
