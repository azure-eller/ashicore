"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { OVERSELL_TOOLTIP_COPY } from "@/lib/tooltip-copy";
import type {
  CustomerOption,
  OversellWarningPayload,
  SalesOrderEditData,
  SalesOrderProductOption,
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

export function OrderForm({
  customers,
  products,
  initialData,
}: {
  customers: CustomerOption[];
  products: SalesOrderProductOption[];
  initialData?: SalesOrderEditData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData ? `/sales/orders/${initialData.id}` : "/sales/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [oversellWarning, setOversellWarning] = useState<OversellWarningPayload | null>(null);
  const [pendingValues, setPendingValues] = useState<OrderFormValues | null>(null);

  const customerIds = customers.map((customer) => customer.id);
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const productIds = products.map((product) => product.id);
  const productMap = new Map(products.map((product) => [product.id, product]));

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(insertSalesOrderSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          customerId: initialData.customerId,
          status: "draft",
          requestedDate: initialData.requestedDate,
          notes: initialData.notes,
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

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

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
          headers: { "Content-Type": "application/json" },
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

  return (
    <>
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">
              {isEditing ? "Edit Sales Order" : "Add Sales Order"}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {isEditing
                ? "Update this draft order and confirm it when it is ready."
                : "Create a new draft or confirmed sales order."}
            </p>
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
                        onValueChange={(value) => field.onChange(value ?? "")}
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

            <FieldSet className="gap-5">
              <FieldLegend>Items</FieldLegend>
              <FieldDescription>
                Add each product once, then set quantities and prices.
              </FieldDescription>
              <FieldGroup className="gap-4">
                {fields.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
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
                            index={index}
                            control={form.control}
                            productIds={productIds}
                            productMap={productMap}
                            onProductChange={(productId) => {
                              const product = productMap.get(productId);
                              form.setValue(`lines.${index}.itemId`, productId, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              form.setValue(
                                `lines.${index}.unitPrice`,
                                product?.defaultSellingPrice ?? null,
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
                      Add products to build this sales order.
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
                    <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" aria-hidden />
                    Add Item
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
        <AlertDialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming this order would push one or more products below calculated stock. You can still proceed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Current Committed"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentCommitted}
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
                      label="Projected Committed"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedCommitted}
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
                    <TableCell>{product.committedQty} {product.unitName}</TableCell>
                    <TableCell>{product.expectedQty} {product.unitName}</TableCell>
                    <TableCell>{product.safetyStock} {product.unitName}</TableCell>
                    <TableCell>{product.calculatedStock} {product.unitName}</TableCell>
                    <TableCell>{product.addedQty} {product.unitName}</TableCell>
                    <TableCell>
                      {product.projectedCommittedQty} {product.unitName}
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
  index,
  control,
  productIds,
  productMap,
  onProductChange,
  onRemove,
}: {
  index: number;
  control: Control<OrderFormValues>;
  productIds: string[];
  productMap: Map<string, SalesOrderProductOption>;
  onProductChange: (productId: string) => void;
  onRemove: () => void;
}) {
  const line = useWatch({
    control,
    name: `lines.${index}`,
  });

  const product = line?.itemId ? productMap.get(line.itemId) : undefined;

  return (
    <TableRow>
      <TableCell>
        <Controller
          control={control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <div>
              <Combobox
                items={productIds}
                value={field.value ?? ""}
                onValueChange={(value) => onProductChange(value ?? "")}
                itemToStringLabel={(value) => productMap.get(value)?.name ?? ""}
              >
                <ComboboxInput placeholder="Search products..." />
                <ComboboxContent>
                  <ComboboxEmpty>No products found</ComboboxEmpty>
                  <ComboboxList>
                    {(value: string) => {
                      const current = productMap.get(value);
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
        {product?.unitName ?? "\u2014"}
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
                onChange={(event) => field.onChange(event.target.value)}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : product?.defaultSellingPrice == null && product ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  No default selling price. Enter one manually.
                </p>
              ) : null}
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
