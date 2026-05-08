"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import {
  insertSalesOrderSchema,
  salesOrderDefaultValues,
} from "@/lib/schemas/sales-orders";
import {
  formatPrice,
  getFieldArrayError,
  normalizeAddressFields,
  parsePositive,
} from "@/lib/format";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { calculateMarginMetrics, calculateUnitMarginMetrics } from "@/lib/margin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "@/components/ui/field";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import {
  REQUESTED_DATE_TOOLTIP,
  SALES_ORDER_SHIP_DATE_TOOLTIP,
  SALES_ORDER_DATE_TOOLTIP,
  ESTIMATED_MARGIN_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  CustomerOption,
  OversellWarningPayload,
  SalesOrderEditData,
  SalesLinePricingResult,
  SalesOrderItemOption,
} from "./types";
import {
  OVERSELL_WARNING_DESCRIPTION,
  OversellWarningTable,
} from "./oversell-warning-table";

function lineTotalLabel(quantity: string | null | undefined, unitPrice: string | null | undefined) {
  const qty = parsePositive(quantity);
  const price = parsePositive(unitPrice);
  if (qty == null || price == null) return "\u2014";
  return formatPrice((qty * price).toFixed(2)) ?? "\u2014";
}

function marginPercentLabel(value: string | null | undefined) {
  return value == null ? "\u2014" : `${value}%`;
}

function RequiredMarker() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  );
}

function FieldLabelWithMarker({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {children}
      {required ? <RequiredMarker /> : null}
    </span>
  );
}

function TableHeaderLabel({
  label,
  required = false,
  tooltip,
}: {
  label: string;
  required?: boolean;
  tooltip?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {tooltip ? <TooltipHeader label={label} tooltip={tooltip} /> : label}
      {required ? <RequiredMarker /> : null}
    </span>
  );
}

function marginToneClass(value: string | null | undefined) {
  if (value == null) return "text-muted-foreground";

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "text-muted-foreground";
  if (parsed < 20) return "text-destructive";
  if (parsed >= 40) return "text-success";
  return "text-foreground";
}

function statusLabel(value: string | null | undefined) {
  return value === "confirmed" ? "Confirmed" : "Draft";
}

function statusBadgeVariant(value: string | null | undefined) {
  return value === "confirmed" ? "default" : "secondary";
}

function SalesOrderSection({
  title,
  description,
  action,
  children,
  footer,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="rounded-lg border shadow-sm ring-0">
      <CardHeader className="border-b bg-muted/20 px-5 pb-4">
        <div>
          <CardTitle className="text-[15px] font-semibold tracking-normal">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="text-[13px]">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
      {footer ? <CardFooter className="bg-muted/25 px-5">{footer}</CardFooter> : null}
    </Card>
  );
}

const SALES_ORDER_LINE_GRID_COLUMNS =
  "2.5rem minmax(18rem, 1fr) 6rem 4.5rem 10rem 7rem 6rem 2.5rem";

function salesItemSearchLabel(item: SalesOrderItemOption | undefined) {
  if (!item) return "";

  return [
    item.displayName,
    item.name !== item.displayName ? item.name : null,
    item.sku,
    item.itemType === "material" ? "material" : "product",
    item.unitName,
  ]
    .filter((part): part is string => part != null && part.trim() !== "")
    .join(" ");
}

type OrderFormValues = z.input<typeof insertSalesOrderSchema>;

type ApiError = {
  status?: number;
  error?: string;
  errors?: Record<string, string[]>;
  oversell?: OversellWarningPayload;
};

type LinePricingState = SalesLinePricingResult & {
  isPriceOverridden: boolean;
};

const DEFAULT_LINE_PRICING_STATE: LinePricingState = {
  baseUnitPrice: null,
  suggestedUnitPrice: null,
  estimatedUnitCost: null,
  pricingSourceType: "base_price",
  pricingScheduleName: null,
  pricingBreakLabel: null,
  customerCategoryName: null,
  isPriceOverridden: false,
};

type ShipAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};

function getShipAddressFromCustomer(customer: CustomerOption | undefined): ShipAddress | null {
  if (!customer) return null;

  const shippingAddress = normalizeAddressFields({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  });

  if (!isShipAddressBlank(shippingAddress) && !isShipAddressDefaultOnly(shippingAddress)) {
    return shippingAddress;
  }

  return normalizeAddressFields({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  });
}

function getShipAddressFromValues(values: {
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
}): ShipAddress {
  return normalizeAddressFields({
    line1: values.shipLine1 ?? null,
    line2: values.shipLine2 ?? null,
    city: values.shipCity ?? null,
    region: values.shipRegion ?? null,
    postcode: values.shipPostcode ?? null,
    country: values.shipCountry ?? null,
  });
}

function isShipAddressBlank(address: ShipAddress | null) {
  if (!address) return true;

  return !address.line1 &&
    !address.line2 &&
    !address.city &&
    !address.region &&
    !address.postcode &&
    !address.country;
}

function isShipAddressDefaultOnly(address: ShipAddress | null) {
  if (!address) return false;

  return !address.line1 &&
    !address.line2 &&
    !address.city &&
    !address.region &&
    !address.postcode &&
    address.country === DEFAULT_COUNTRY;
}

function shipAddressesEqual(left: ShipAddress | null, right: ShipAddress | null) {
  if (!left || !right) {
    return left === right;
  }

  return left.line1 === right.line1 &&
    left.line2 === right.line2 &&
    left.city === right.city &&
    left.region === right.region &&
    left.postcode === right.postcode &&
    left.country === right.country;
}

function setShipAddress(
  setValue: UseFormSetValue<OrderFormValues>,
  address: ShipAddress,
  shouldDirty = true
) {
  setValue("shipLine1", address.line1, { shouldDirty });
  setValue("shipLine2", address.line2, { shouldDirty });
  setValue("shipCity", address.city, { shouldDirty });
  setValue("shipRegion", address.region, { shouldDirty });
  setValue("shipPostcode", address.postcode, { shouldDirty });
  setValue("shipCountry", address.country, { shouldDirty });
}

export function OrderForm({
  customers,
  items,
  initialData,
}: {
  customers: CustomerOption[];
  items: SalesOrderItemOption[];
  initialData?: SalesOrderEditData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData ? `/sales/orders/${initialData.id}` : "/sales/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [oversellWarning, setOversellWarning] = useState<OversellWarningPayload | null>(null);
  const [pendingValues, setPendingValues] = useState<OrderFormValues | null>(null);
  const isHydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  const customerIds = useMemo(
    () => customers.map((customer) => customer.id),
    [customers]
  );
  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );
  const itemIds = useMemo(
    () => items.map((item) => item.id),
    [items]
  );
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const initialAutoFilledShipAddress =
    initialData?.customerId != null
      ? (() => {
          const customer = customerMap.get(initialData.customerId);
          const customerShipAddress = getShipAddressFromCustomer(customer);
          const orderShipAddress = getShipAddressFromValues({
            shipLine1: initialData.shipLine1,
            shipLine2: initialData.shipLine2,
            shipCity: initialData.shipCity,
            shipRegion: initialData.shipRegion,
            shipPostcode: initialData.shipPostcode,
            shipCountry: initialData.shipCountry,
          });

          return shipAddressesEqual(orderShipAddress, customerShipAddress)
            ? customerShipAddress
            : null;
        })()
      : null;
  const lastAutoFilledShipAddressRef = useRef<ShipAddress | null>(
    initialAutoFilledShipAddress
  );

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(insertSalesOrderSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          customerId: initialData.customerId,
          status: initialData.status,
          orderDate: initialData.orderDate,
          shipDate: initialData.shipDate,
          requestedDate: initialData.requestedDate,
          notes: initialData.notes,
          shipLine1: initialData.shipLine1,
          shipLine2: initialData.shipLine2,
          shipCity: initialData.shipCity,
          shipRegion: initialData.shipRegion,
          shipPostcode: initialData.shipPostcode,
          shipCountry: initialData.shipCountry,
          lines: initialData.lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
          confirmOversell: false,
        }
      : salesOrderDefaultValues,
  });

  const watchedLines = useWatch({
    control: form.control,
    name: "lines",
  });
  const customerId = useWatch({
    control: form.control,
    name: "customerId",
  });
  const status = useWatch({
    control: form.control,
    name: "status",
  });

  const { fields, append, move, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });
  const [initialLineByFieldId] = useState(() => {
    const lineByFieldId = new Map<string, SalesOrderEditData["lines"][number]>();
    fields.forEach((field, index) => {
      const initialLine = initialData?.lines[index];
      if (initialLine) {
        lineByFieldId.set(field.id, initialLine);
      }
    });
    return lineByFieldId;
  });
  const [linePricingState, setLinePricingState] = useState<
    Record<string, LinePricingState>
  >({});

  function updateLinePricingState(
    lineKey: string,
    nextState: Partial<LinePricingState>
  ) {
    setLinePricingState((currentState) => {
      const previousState = currentState[lineKey] ?? DEFAULT_LINE_PRICING_STATE;
      const mergedState = {
        ...previousState,
        ...nextState,
      };

      if (
        previousState.baseUnitPrice === mergedState.baseUnitPrice &&
        previousState.suggestedUnitPrice === mergedState.suggestedUnitPrice &&
        previousState.pricingSourceType === mergedState.pricingSourceType &&
        previousState.pricingScheduleName === mergedState.pricingScheduleName &&
        previousState.pricingBreakLabel === mergedState.pricingBreakLabel &&
        previousState.customerCategoryName === mergedState.customerCategoryName &&
        previousState.estimatedUnitCost === mergedState.estimatedUnitCost &&
        previousState.isPriceOverridden === mergedState.isPriceOverridden
      ) {
        return currentState;
      }

      return {
        ...currentState,
        [lineKey]: mergedState,
      };
    });
  }

  function getLinePricingState(lineKey: string, index: number) {
    const currentState = linePricingState[lineKey];
    const line = initialData?.lines[index];
    const itemId = form.getValues(`lines.${index}.itemId`);
    const baseUnitPrice = itemId
      ? itemMap.get(itemId)?.defaultSellingPrice ?? null
      : null;

    return {
      baseUnitPrice: currentState?.baseUnitPrice ?? baseUnitPrice,
      suggestedUnitPrice:
        currentState?.suggestedUnitPrice ??
        line?.suggestedUnitPrice ??
        baseUnitPrice,
      pricingSourceType:
        currentState?.pricingSourceType ??
        line?.pricingSourceType ??
        DEFAULT_LINE_PRICING_STATE.pricingSourceType,
      pricingScheduleName:
        currentState?.pricingScheduleName ??
        line?.pricingScheduleName ??
        DEFAULT_LINE_PRICING_STATE.pricingScheduleName,
      pricingBreakLabel:
        currentState?.pricingBreakLabel ??
        line?.pricingBreakLabel ??
        DEFAULT_LINE_PRICING_STATE.pricingBreakLabel,
      estimatedUnitCost:
        currentState?.estimatedUnitCost ??
        (itemId ? itemMap.get(itemId)?.estimatedUnitCost ?? null : null),
      customerCategoryName:
        currentState?.customerCategoryName ??
        DEFAULT_LINE_PRICING_STATE.customerCategoryName,
      isPriceOverridden:
        currentState?.isPriceOverridden ??
        line?.isPriceOverridden ??
        DEFAULT_LINE_PRICING_STATE.isPriceOverridden,
    };
  }

  const orderTotal = useMemo(() => {
    return (watchedLines ?? []).reduce((sum, line) => {
      const qty = parsePositive(line?.quantity);
      const price = parsePositive(line?.unitPrice);
      if (qty == null || price == null) return sum;
      return sum + qty * price;
    }, 0);
  }, [watchedLines]);

  const orderSummary = useMemo(() => {
    let cogs = 0;
    let resolvedLineCount = 0;

    (watchedLines ?? []).forEach((line, index) => {
      const qty = parsePositive(line?.quantity);
      if (qty == null) return;

      if (line?.itemId) {
        resolvedLineCount += 1;
      }

      const lineKey = fields[index]?.id;
      const item = line?.itemId ? itemMap.get(line.itemId) : undefined;
      const unitCost = lineKey
        ? linePricingState[lineKey]?.estimatedUnitCost ?? item?.estimatedUnitCost
        : item?.estimatedUnitCost;
      const parsedCost = parsePositive(unitCost ?? null);

      if (parsedCost != null) {
        cogs += qty * parsedCost;
      }
    });

    const marginMetrics =
      orderTotal > 0 && cogs > 0
        ? calculateMarginMetrics({
            revenue: orderTotal,
            cogs,
          })
        : null;

    return {
      cogs,
      marginMetrics,
      resolvedLineCount,
    };
  }, [fields, itemMap, linePricingState, orderTotal, watchedLines]);

  const mutation = useMutation({
    mutationFn: async (values: OrderFormValues) => {
      const response = await fetch(
        initialData ? `/api/sales-orders/${initialData.id}` : "/api/sales-orders",
        {
          method: initialData ? "PUT" : "POST",
          headers: createIdempotencyHeaders("sales-order-save", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(values),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to save sales order.",
          errors: body?.errors,
          oversell: body?.oversell,
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
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.push(initialData ? fallbackPath : `/sales/orders/${result.id}`);
    },
    onError: (error: ApiError, values) => {
      if (error.status === 409 && error.oversell) {
        setPendingValues(values);
        setOversellWarning(error.oversell);
        return;
      }

      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save sales order.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);
  const primaryActionLabel = mutation.isPending
    ? isEditing
      ? "Saving..."
      : "Creating..."
    : isEditing
      ? "Save Changes"
      : "Create Order";
  const submitOrder = form.handleSubmit((values) => mutation.mutate(values));

  const handleSaveDraft = () => {
    form.setValue("status", "draft", {
      shouldDirty: true,
      shouldValidate: true,
    });
    void submitOrder();
  };

  const linesError = getFieldArrayError(form.formState.errors.lines);

  if (!isHydrated) {
    return (
      <div className="w-full space-y-8">
        <div className="space-y-1.5">
          <div className="h-9 w-56 rounded-md bg-muted" />
          <div className="h-4 w-80 rounded-md bg-muted" />
        </div>
        <Separator />
        <div className="space-y-8">
          <div className="h-48 rounded-lg border bg-card" />
          <div className="h-64 rounded-lg border bg-card" />
          <div className="h-40 rounded-lg border bg-card" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full space-y-6">
        <div className="sticky top-0 z-10 border-b bg-background/90 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCancel}
                aria-label="Back to sales orders"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[22px] font-bold leading-tight tracking-tight">
                    {isEditing ? "Edit Sales Order" : "Add Sales Order"}
                  </h1>
                  <Badge variant={statusBadgeVariant(status)}>
                    {statusLabel(status)}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {!isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveDraft}
                  disabled={mutation.isPending}
                >
                  Save Draft
                </Button>
              )}
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit" form="sales-order-form" disabled={mutation.isPending}>
                {primaryActionLabel}
              </Button>
            </div>
          </div>
        </div>

        {formError && <FieldError>{formError}</FieldError>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            id="sales-order-form"
            className="space-y-5"
            onSubmit={submitOrder}
          >
            <SalesOrderSection title="Order details">
              <FieldGroup className="gap-5">
                <Controller
                  control={form.control}
                  name="customerId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel className="w-full">
                        <FieldLabelWithMarker required>
                          Customer
                        </FieldLabelWithMarker>
                      </FieldLabel>
                      <Combobox
                        items={customerIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => {
                          const nextValue = value ?? "";
                          field.onChange(nextValue);
                          if (!nextValue) return;

                          const nextShipAddress = getShipAddressFromCustomer(
                            customerMap.get(nextValue)
                          );
                          if (
                            !nextShipAddress ||
                            isShipAddressBlank(nextShipAddress) ||
                            isShipAddressDefaultOnly(nextShipAddress)
                          ) {
                            return;
                          }

                          const currentShipAddress = getShipAddressFromValues(
                            form.getValues()
                          );
                          const canReplaceShipAddress =
                            isShipAddressBlank(currentShipAddress) ||
                            isShipAddressDefaultOnly(currentShipAddress) ||
                            shipAddressesEqual(
                              currentShipAddress,
                              lastAutoFilledShipAddressRef.current
                            );

                          if (!canReplaceShipAddress) {
                            return;
                          }

                          setShipAddress(form.setValue, nextShipAddress);
                          lastAutoFilledShipAddressRef.current = nextShipAddress;
                        }}
                        itemToStringLabel={(value) => customerMap.get(value)?.name ?? ""}
                      >
                        <ComboboxInput placeholder="Search customers..." />
                        <ComboboxContent>
                          <ComboboxEmpty>No customers found</ComboboxEmpty>
                          <ComboboxList>
                            {(value: string) => (
                              <ComboboxItem key={value} value={value}>
                                {customerMap.get(value)?.name ?? value}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel className="w-full">
                          <FieldLabelWithMarker required>
                            Status
                          </FieldLabelWithMarker>
                        </FieldLabel>
                        <Select
                          name={field.name}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger aria-invalid={fieldState.invalid}>
                            <SelectValue placeholder="Select a status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="confirmed">Confirmed</SelectItem>
                          </SelectContent>
                        </Select>
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />

                  <Controller
                    control={form.control}
                    name="orderDate"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} className="w-full">
                          <FieldLabelWithMarker required>
                            <TooltipHeader label="Order Date" tooltip={SALES_ORDER_DATE_TOOLTIP} />
                          </FieldLabelWithMarker>
                        </FieldLabel>
                        <DatePicker
                          id={field.name}
                          value={field.value ?? ""}
                          onChange={(value) => field.onChange(value)}
                          onBlur={field.onBlur}
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />

                  <Controller
                    control={form.control}
                    name="shipDate"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} className="w-full">
                          <FieldLabelWithMarker required={status === "confirmed"}>
                            <TooltipHeader
                              label="Ship Date"
                              tooltip={SALES_ORDER_SHIP_DATE_TOOLTIP}
                            />
                          </FieldLabelWithMarker>
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
                    name="requestedDate"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} className="w-full">
                          <TooltipHeader
                            label="Delivery Date"
                            tooltip={REQUESTED_DATE_TOOLTIP}
                          />
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
                </div>
              </FieldGroup>
            </SalesOrderSection>

            <SalesOrderSection
              title="Items"
              action={
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fields.length} {fields.length === 1 ? "item" : "items"}
                </span>
              }
              footer={
                <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({
                        itemId: "",
                        quantity: null,
                        unitPrice: null,
                      })
                    }
                  >
                    Add Item
                    <HugeiconsIcon
                      icon={Add01Icon}
                      className="h-4 w-4"
                      data-icon="inline-end"
                      aria-hidden
                    />
                  </Button>

                  <div className="text-sm">
                    <span className="text-muted-foreground">Subtotal</span>{" "}
                    <span className="font-mono font-medium tabular-nums">
                      {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                    </span>
                  </div>
                </div>
              }
            >
              <FieldGroup className="gap-4">
                {fields.length > 0 ? (
                  <SortableReorder
                    ids={fields.map((field) => field.id)}
                    onMove={(fromIndex, toIndex) => move(fromIndex, toIndex)}
                  >
                    <EditableLineGrid
                      columns={SALES_ORDER_LINE_GRID_COLUMNS}
                      minWidth="56rem"
                      headers={[
                        <span key="reorder" />,
                        <TableHeaderLabel key="item" label="Item" required />,
                        <TableHeaderLabel
                          key="qty"
                          label="Qty"
                          tooltip={SALES_LINE_QTY_TOOLTIP}
                          required
                        />,
                        <TooltipHeader key="unit" label="Unit" tooltip={UNIT_TOOLTIP} />,
                        <TableHeaderLabel
                          key="unit-price"
                          label="Unit Price"
                          tooltip={SALES_UNIT_PRICE_TOOLTIP}
                          required
                        />,
                        <TooltipHeader
                          key="line-total"
                          label="Line Total"
                          tooltip={LINE_TOTAL_TOOLTIP}
                        />,
                        <TooltipHeader
                          key="margin"
                          label="Margin"
                          tooltip={ESTIMATED_MARGIN_TOOLTIP}
                        />,
                        <span key="actions" />,
                      ]}
                    >
                      {fields.map((field, index) => (
                        <OrderLineRow
                          key={field.id}
                          lineKey={field.id}
                          index={index}
                          control={form.control}
                          customerId={customerId}
                          initialCustomerId={initialData?.customerId}
                          initialLine={initialLineByFieldId.get(field.id)}
                          setValue={form.setValue}
                          itemIds={itemIds}
                          itemMap={itemMap}
                          pricingState={getLinePricingState(field.id, index)}
                          onPricingStateChange={updateLinePricingState}
                          onItemChange={(itemId) => {
                            const item = itemMap.get(itemId);
                            form.setValue(`lines.${index}.itemId`, itemId, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            form.setValue(
                              `lines.${index}.unitPrice`,
                              item?.defaultSellingPrice ?? null,
                              {
                                shouldDirty: true,
                                shouldValidate: true,
                              }
                            );
                            updateLinePricingState(field.id, {
                              ...DEFAULT_LINE_PRICING_STATE,
                              baseUnitPrice: item?.defaultSellingPrice ?? null,
                              suggestedUnitPrice: item?.defaultSellingPrice ?? null,
                              estimatedUnitCost: item?.estimatedUnitCost ?? null,
                              isPriceOverridden: false,
                            });
                          }}
                          onRemove={() => {
                            setLinePricingState((currentState) => {
                              if (!(field.id in currentState)) {
                                return currentState;
                              }

                              const nextState = { ...currentState };
                              delete nextState[field.id];
                              return nextState;
                            });
                            remove(index);
                          }}
                        />
                      ))}
                    </EditableLineGrid>
                  </SortableReorder>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No items yet.
                    </p>
                  </div>
                )}

                {linesError && (
                  <p className="text-sm text-destructive">{linesError}</p>
                )}
              </FieldGroup>
            </SalesOrderSection>

            <SalesOrderSection title="Shipping address">
              <AddressFields
                control={form.control}
                idPrefix="order-ship"
                names={{
                  line1: "shipLine1",
                  line2: "shipLine2",
                  city: "shipCity",
                  region: "shipRegion",
                  postcode: "shipPostcode",
                  country: "shipCountry",
                }}
              />
            </SalesOrderSection>

            <SalesOrderSection title="Notes">
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="notes"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name} className="w-full">
                        Notes
                      </FieldLabel>
                      <Textarea
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value)}
                        aria-invalid={fieldState.invalid}
                        rows={5}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </FieldGroup>
            </SalesOrderSection>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <Card className="rounded-lg border shadow-sm ring-0">
              <CardHeader className="border-b bg-muted/20 px-5 pb-4">
                <CardTitle className="text-[15px] font-semibold tracking-normal">
                  Order summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    Subtotal ({orderSummary.resolvedLineCount}{" "}
                    {orderSummary.resolvedLineCount === 1 ? "item" : "items"})
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={statusBadgeVariant(status)}>
                    {statusLabel(status)}
                  </Badge>
                </div>
              </CardContent>
              <CardFooter className="justify-between bg-muted/25 px-5">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total
                  </div>
                  <div className="text-xs text-muted-foreground">USD</div>
                </div>
                <div className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
                  {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                </div>
              </CardFooter>
            </Card>

            <Card className="rounded-lg border shadow-sm ring-0" size="sm">
              <CardContent className="grid grid-cols-2 gap-4 px-5">
                <div>
                  <div className="text-xs text-muted-foreground">Estimated margin</div>
                  <div
                    className={`text-lg font-semibold ${marginToneClass(
                      orderSummary.marginMetrics?.marginPercent
                    )}`}
                  >
                    {marginPercentLabel(orderSummary.marginMetrics?.marginPercent)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">COGS</div>
                  <div className="font-mono text-sm font-medium tabular-nums">
                    {formatPrice(orderSummary.cogs.toFixed(2)) ?? "$0.00"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="sales-order-form"
                disabled={mutation.isPending}
                aria-label={isEditing ? "Submit changes from summary" : "Submit order from summary"}
              >
                {primaryActionLabel}
              </Button>
            </div>
          </aside>
        </div>
      </div>

      <AlertDialog
        open={oversellWarning != null}
        onOpenChange={(open) => {
          if (!open) {
            setOversellWarning(null);
            setPendingValues(null);
          }
        }}
      >
        <AlertDialogContent
          size="2xl"
          className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              {OVERSELL_WARNING_DESCRIPTION}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <OversellWarningTable products={oversellWarning?.products ?? []} />

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (!pendingValues) return;
                mutation.mutate({
                  ...pendingValues,
                  confirmOversell: true,
                });
                setOversellWarning(null);
                setPendingValues(null);
              }}
            >
              {mutation.isPending ? "Confirming..." : "Confirm Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OrderLineRow({
  lineKey,
  index,
  control,
  customerId,
  initialCustomerId,
  initialLine,
  setValue,
  itemIds,
  itemMap,
  pricingState,
  onPricingStateChange,
  onItemChange,
  onRemove,
}: {
  lineKey: string;
  index: number;
  control: Control<OrderFormValues>;
  customerId: string | null | undefined;
  initialCustomerId?: string | null;
  initialLine?: SalesOrderEditData["lines"][number];
  setValue: UseFormSetValue<OrderFormValues>;
  itemIds: string[];
  itemMap: Map<string, SalesOrderItemOption>;
  pricingState: LinePricingState | undefined;
  onPricingStateChange: (
    lineKey: string,
    nextState: Partial<LinePricingState>
  ) => void;
  onItemChange: (itemId: string) => void;
  onRemove: () => void;
}) {
  const line = useWatch({
    control,
    name: `lines.${index}`,
  });

  const item = line?.itemId ? itemMap.get(line.itemId) : undefined;
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(lineKey);
  const estimatedUnitCost = pricingState?.estimatedUnitCost ?? item?.estimatedUnitCost ?? null;
  const estimatedMargin = item
    ? calculateUnitMarginMetrics({
        quantity: line?.quantity,
        unitPrice: line?.unitPrice,
        unitCost: estimatedUnitCost,
      })
    : null;
  const shouldResolveLivePricing =
    (customerId ?? "") !== "" &&
    (line?.itemId ?? "") !== "" &&
    (!initialLine ||
      (initialCustomerId ?? "") !== (customerId ?? "") ||
      initialLine.itemId !== (line?.itemId ?? "") ||
      initialLine.quantity !== (line?.quantity ?? ""));
  const pricingQuery = useQuery<SalesLinePricingResult>({
    queryKey: [
      "sales-order-line-price",
      customerId ?? "",
      line?.itemId ?? "",
      line?.quantity ?? null,
    ],
    enabled: shouldResolveLivePricing,
    queryFn: async () => {
      const response = await fetch("/api/sales-orders/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          itemId: line?.itemId ?? "",
          quantity: line?.quantity ?? null,
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to calculate suggested pricing.");
      }

      return body as SalesLinePricingResult;
    },
  });
  const suggestedPricing = pricingQuery.data;
  const isPriceOverridden = pricingState?.isPriceOverridden ?? false;

  useEffect(() => {
    if (!item) {
      onPricingStateChange(lineKey, {
        ...DEFAULT_LINE_PRICING_STATE,
        isPriceOverridden,
      });
      return;
    }

    if (!shouldResolveLivePricing) {
      onPricingStateChange(lineKey, {
        baseUnitPrice: item.defaultSellingPrice ?? null,
        suggestedUnitPrice:
          initialLine?.suggestedUnitPrice ?? item.defaultSellingPrice ?? null,
        pricingSourceType:
          initialLine?.pricingSourceType ??
          DEFAULT_LINE_PRICING_STATE.pricingSourceType,
        pricingScheduleName: initialLine?.pricingScheduleName ?? null,
        pricingBreakLabel: initialLine?.pricingBreakLabel ?? null,
        customerCategoryName: null,
        estimatedUnitCost: item.estimatedUnitCost,
        isPriceOverridden: initialLine?.isPriceOverridden ?? isPriceOverridden,
      });
      return;
    }

    if (pricingQuery.isPending || pricingQuery.isFetching) {
      return;
    }

    if (suggestedPricing) {
      onPricingStateChange(lineKey, {
        baseUnitPrice: suggestedPricing.baseUnitPrice,
        suggestedUnitPrice: suggestedPricing.suggestedUnitPrice,
        pricingSourceType: suggestedPricing.pricingSourceType,
        pricingScheduleName: suggestedPricing.pricingScheduleName,
        pricingBreakLabel: suggestedPricing.pricingBreakLabel,
        customerCategoryName: suggestedPricing.customerCategoryName,
        estimatedUnitCost: suggestedPricing.estimatedUnitCost,
      });

      if (
        !isPriceOverridden &&
        suggestedPricing.suggestedUnitPrice !== (line?.unitPrice ?? null)
      ) {
        setValue(`lines.${index}.unitPrice`, suggestedPricing.suggestedUnitPrice, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }

      return;
    }

    const baseUnitPrice = item.defaultSellingPrice ?? null;
    onPricingStateChange(lineKey, {
      baseUnitPrice,
      suggestedUnitPrice: baseUnitPrice,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: null,
      estimatedUnitCost: item.estimatedUnitCost,
    });

    if (!isPriceOverridden && baseUnitPrice !== (line?.unitPrice ?? null)) {
      setValue(`lines.${index}.unitPrice`, baseUnitPrice, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [
    index,
    initialLine,
    isPriceOverridden,
    line?.unitPrice,
    lineKey,
    onPricingStateChange,
    item,
    pricingQuery.isFetching,
    pricingQuery.isPending,
    setValue,
    suggestedPricing,
    shouldResolveLivePricing,
  ]);

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
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-item`}>
                Item
              </FieldLabel>
              <Combobox
                items={itemIds}
                value={field.value ?? ""}
                onValueChange={(value) => onItemChange(value ?? "")}
                itemToStringLabel={(value) => salesItemSearchLabel(itemMap.get(value))}
              >
                <ComboboxInput
                  id={`${lineKey}-item`}
                  aria-invalid={fieldState.invalid}
                  className="w-full min-w-0"
                  placeholder="Search items..."
                />
                <ComboboxContent className="w-[min(36rem,calc(100vw-2rem))]">
                  <ComboboxEmpty>No items found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => {
                      const current = itemMap.get(value);
                      const metadata = [
                        current ? (current.itemType === "material" ? "Material" : "Product") : null,
                      ]
                        .filter((part): part is string => part != null)
                        .join(" · ");

                      return (
                        <ComboboxItem key={value} value={value}>
                          <span className="min-w-0">
                            <span className="block truncate">
                              {current?.displayName ?? value}
                            </span>
                            {current ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {current.sku ? `${current.sku} · ` : ""}
                                {current.unitName}
                                {current.defaultSellingPrice
                                  ? ` · ${formatPrice(current.defaultSellingPrice) ?? "\u2014"}`
                                  : ""}
                                {` · Available ${current.availableQty}`}
                              </span>
                            ) : null}
                          </span>
                          {metadata && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {metadata}
                            </span>
                          )}
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {item ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {item.sku ? `${item.sku} · ` : ""}
                  {item.itemType === "material" ? "Material" : "Product"} · Available{" "}
                  {item.availableQty}
                </p>
              ) : null}
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell align="right">
        <Controller
          control={control}
          name={`lines.${index}.quantity`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-quantity`}>
                Quantity
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
                className="text-right tabular-nums"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell className="font-mono text-sm text-muted-foreground">
        {item?.unitName ?? "\u2014"}
      </EditableLineGridCell>

      <EditableLineGridCell align="right">
        <Controller
          control={control}
          name={`lines.${index}.unitPrice`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-unit-price`}>
                Unit Price
              </FieldLabel>
              <Input
                {...field}
                id={`${lineKey}-unit-price`}
                value={field.value ?? ""}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const parsedNextValue =
                    nextValue.trim() === "" ? null : Number(nextValue);
                  const parsedSuggestedValue =
                    pricingState?.suggestedUnitPrice == null
                      ? null
                      : Number(pricingState.suggestedUnitPrice);
                  field.onChange(nextValue);
                  onPricingStateChange(lineKey, {
                    isPriceOverridden:
                      parsedNextValue != null &&
                      parsedSuggestedValue != null &&
                      Number.isFinite(parsedNextValue) &&
                      Number.isFinite(parsedSuggestedValue) &&
                      parsedNextValue.toFixed(2) !==
                        parsedSuggestedValue.toFixed(2),
                  });
                }}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="text-right tabular-nums"
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <>
                  {pricingQuery.isError ? (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Unable to load suggested pricing. You can still enter a price manually.
                    </p>
                  ) : pricingState?.suggestedUnitPrice != null ? (
                    <>
                      <p className="pt-1 text-xs text-muted-foreground">
                        Suggested {formatPrice(pricingState.suggestedUnitPrice) ?? "\u2014"}
                        {pricingState.pricingSourceType === "schedule_break" &&
                        pricingState.pricingScheduleName
                          ? ` from ${pricingState.pricingScheduleName}${
                              pricingState.pricingBreakLabel
                                ? `, ${pricingState.pricingBreakLabel}`
                                : ""
                            }`
                          : " from base price"}
                      </p>
                      {isPriceOverridden && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          Final price is a manual override.
                        </p>
                      )}
                    </>
                  ) : item?.defaultSellingPrice == null && item ? (
                    <p className="pt-1 text-xs text-muted-foreground">
                      No default selling price. Enter one manually.
                    </p>
                  ) : null}
                </>
              )}
            </Field>
          )}
        />
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="font-mono text-sm font-medium tabular-nums">
        {lineTotalLabel(line?.quantity, line?.unitPrice)}
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="text-sm">
        <div className={`font-medium ${marginToneClass(estimatedMargin?.marginPercent)}`}>
          {marginPercentLabel(estimatedMargin?.marginPercent)}
        </div>
        {estimatedMargin ? (
          <div className="text-xs text-muted-foreground">
            {formatPrice(estimatedMargin.grossProfit) ?? "\u2014"} profit
          </div>
        ) : null}
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove line ${index + 1}`}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}
