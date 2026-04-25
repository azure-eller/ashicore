"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  insertSalesOrderSchema,
  salesOrderDefaultValues,
} from "@/lib/schemas/sales-orders";
import { formatPrice, getFieldArrayError, parsePositive } from "@/lib/format";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import { OVERSELL_TOOLTIP_COPY } from "@/lib/tooltip-copy";
import type {
  CustomerOption,
  OversellWarningPayload,
  SalesOrderEditData,
  SalesLinePricingResult,
  SalesOrderItemOption,
} from "./types";

function lineTotalLabel(quantity: string | null | undefined, unitPrice: string | null | undefined) {
  const qty = parsePositive(quantity);
  const price = parsePositive(unitPrice);
  if (qty == null || price == null) return "\u2014";
  return formatPrice((qty * price).toFixed(2)) ?? "\u2014";
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

  const hasShippingAddress = Boolean(
    customer.shipLine1 ||
      customer.shipLine2 ||
      customer.shipCity ||
      customer.shipRegion ||
      customer.shipPostcode ||
      customer.shipCountry
  );

  return hasShippingAddress
    ? {
        line1: customer.shipLine1,
        line2: customer.shipLine2,
        city: customer.shipCity,
        region: customer.shipRegion,
        postcode: customer.shipPostcode,
        country: customer.shipCountry,
      }
    : {
        line1: customer.billingLine1,
        line2: customer.billingLine2,
        city: customer.billingCity,
        region: customer.billingRegion,
        postcode: customer.billingPostcode,
        country: customer.billingCountry,
      };
}

function getShipAddressFromValues(values: {
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
}): ShipAddress {
  return {
    line1: values.shipLine1 ?? null,
    line2: values.shipLine2 ?? null,
    city: values.shipCity ?? null,
    region: values.shipRegion ?? null,
    postcode: values.shipPostcode ?? null,
    country: values.shipCountry ?? null,
  };
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
          status: "draft",
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

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
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

  const linesError = getFieldArrayError(form.formState.errors.lines);

  if (!isHydrated) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-8">
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
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">
              {isEditing ? "Edit Sales Order" : "Add Sales Order"}
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" form="sales-order-form" disabled={mutation.isPending}>
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
          id="sales-order-form"
          className="space-y-0"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FieldGroup className="gap-8">
            <FieldSet className="max-w-4xl gap-5">
              <FieldLegend>Order</FieldLegend>
              <FieldDescription>
                Choose the customer and whether this order stays in draft or moves to confirmed.
              </FieldDescription>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="customerId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Customer</FieldLabel>
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
                          if (!nextShipAddress) return;

                          const currentShipAddress = getShipAddressFromValues(
                            form.getValues()
                          );
                          const canReplaceShipAddress =
                            isShipAddressBlank(currentShipAddress) ||
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

                <div className="grid gap-4 md:grid-cols-2">
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel>Status</FieldLabel>
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
                    name="requestedDate"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Requested Date</FieldLabel>
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
            </FieldSet>

            <FieldSeparator />

            <FieldSet className="max-w-4xl gap-5">
              <FieldLegend>Ship To</FieldLegend>
              <FieldDescription>
                Defaults from the customer&apos;s shipping address. Override for
                this order if it&apos;s going somewhere else.
              </FieldDescription>
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
            </FieldSet>

            <FieldSeparator />

            <FieldSet className="gap-5">
              <FieldLegend>Items</FieldLegend>
              <FieldDescription>
                Add each item once, then set quantities and prices.
              </FieldDescription>
              <FieldGroup className="gap-4">
                {fields.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="w-32">Qty</TableHead>
                          <TableHead className="w-28">Unit</TableHead>
                          <TableHead className="w-40">Unit Price</TableHead>
                          <TableHead className="w-32 text-right">Line Total</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fields.map((field, index) => (
                          <OrderLineRow
                            key={field.id}
                            lineKey={field.id}
                            index={index}
                            control={form.control}
                            customerId={customerId}
                            initialCustomerId={initialData?.customerId}
                            initialLine={initialData?.lines[index]}
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
                                suggestedUnitPrice:
                                  item?.defaultSellingPrice ?? null,
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
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      Add items to build this sales order.
                    </p>
                  </div>
                )}

                {linesError && (
                  <p className="text-sm text-destructive">{linesError}</p>
                )}

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

                  <div className="rounded-md border px-4 py-2 text-sm">
                    <span className="text-muted-foreground">Order Total</span>
                    <div className="font-medium">
                      {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                    </div>
                  </div>
                </div>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet className="max-w-4xl gap-5">
              <FieldLegend>Notes</FieldLegend>
              <FieldDescription>
                Capture any order-specific notes you want to keep with the record.
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
                        onChange={(event) => field.onChange(event.target.value)}
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
          size="3xl"
          className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming this order would push one or more items below calculated stock. You can still proceed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Available"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentAvailable}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Reserved"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentReserved}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Demand"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentDemand}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Backorder"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentShortage}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Expected"
                      tooltip={OVERSELL_TOOLTIP_COPY.expected}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Safety"
                      tooltip={OVERSELL_TOOLTIP_COPY.safety}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Current Calculated"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentCalculated}
                    />
                  </TableHead>
                  <TableHead>Added Qty</TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Projected Demand"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedDemand}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Projected Backorder"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedShortage}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Projected Calculated"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedCalculated}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oversellWarning?.products.map((product) => (
                  <TableRow key={product.itemId}>
                    <TableCell>
                      <div className="font-medium">{product.itemName}</div>
                      {product.itemSku && (
                        <div className="text-xs text-muted-foreground">{product.itemSku}</div>
                      )}
                    </TableCell>
                    <TableCell>{product.inStock} {product.unitName}</TableCell>
                    <TableCell>{product.availableQty} {product.unitName}</TableCell>
                    <TableCell>{product.committedQty} {product.unitName}</TableCell>
                    <TableCell>{product.demandQty} {product.unitName}</TableCell>
                    <TableCell>{product.shortageQty} {product.unitName}</TableCell>
                    <TableCell>{product.expectedQty} {product.unitName}</TableCell>
                    <TableCell>{product.safetyStock} {product.unitName}</TableCell>
                    <TableCell>{product.calculatedStock} {product.unitName}</TableCell>
                    <TableCell>{product.addedQty} {product.unitName}</TableCell>
                    <TableCell>
                      {product.projectedDemandQty} {product.unitName}
                    </TableCell>
                    <TableCell className={product.projectedShortageQty > 0 ? "text-destructive" : undefined}>
                      {product.projectedShortageQty} {product.unitName}
                    </TableCell>
                    <TableCell className="text-destructive">
                      {product.projectedCalculatedStock} {product.unitName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

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
    <TableRow>
      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <div>
              <Combobox
                items={itemIds}
                value={field.value ?? ""}
                onValueChange={(value) => onItemChange(value ?? "")}
                itemToStringLabel={(value) => itemMap.get(value)?.displayName ?? ""}
              >
                <ComboboxInput placeholder="Search items..." />
                <ComboboxContent>
                  <ComboboxEmpty>No items found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => {
                      const current = itemMap.get(value);
                      const metadata = [
                        current?.sku,
                        current ? (current.itemType === "material" ? "Material" : "Product") : null,
                      ]
                        .filter((part): part is string => part != null)
                        .join(" · ");

                      return (
                        <ComboboxItem key={value} value={value}>
                          <span>{current?.displayName ?? value}</span>
                          {metadata && (
                            <span className="ml-auto text-xs text-muted-foreground">
                              {metadata}
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
          name={`lines.${index}.quantity`}
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
        {item?.unitName ?? "\u2014"}
      </TableCell>

      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.unitPrice`}
          render={({ field, fieldState }) => (
            <div>
              <Input
                {...field}
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
            </div>
          )}
        />
      </TableCell>

      <TableCell className="text-right text-sm font-medium">
        {lineTotalLabel(line?.quantity, line?.unitPrice)}
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
