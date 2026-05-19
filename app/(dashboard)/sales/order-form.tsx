"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  insertSalesOrderSchema,
  salesOrderDefaultValues,
} from "@/lib/schemas/sales-orders";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import {
  formatAddressLines,
  formatPrice,
  getFieldArrayError,
  getFirstFormErrorMessage,
  normalizeAddressFields,
  parsePositive,
  todayInTimeZone,
} from "@/lib/format";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { calculateMarginMetrics, calculateUnitMarginMetrics } from "@/lib/margin";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRemoveButton,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { EditableLineItems } from "@/components/editable-line-items";
import { EntityCombobox } from "@/components/entity-combobox";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddressFields } from "@/components/address-fields";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import {
  REQUESTED_DATE_TOOLTIP,
  SALES_ORDER_DATE_TOOLTIP,
  ESTIMATED_MARGIN_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  CustomerOption,
  SalesOrderEditData,
  SalesLinePricingResult,
  SalesOrderItemOption,
} from "./types";
import {
  clampShipmentQuantity,
  formatShipmentQuantityCapacity,
  getOrderFormShipmentLineCapacity,
} from "./shipment-quantity";

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

function LineCellHint({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto mt-1 h-5 max-w-full justify-end gap-1 px-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          <span className="truncate">{label}</span>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-balance">
        {tooltip}
      </TooltipContent>
    </Tooltip>
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
    <Card className="border shadow-none ring-0">
      <CardHeader className="border-b bg-muted px-(--space-10) pb-(--space-8)">
        <div>
          <CardTitle className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold tracking-[var(--tracking-normal)]">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="text-[length:var(--text-sm)] leading-[var(--leading-sm)]">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-(--space-10)">{children}</CardContent>
      {footer ? (
        <CardFooter className="border-t bg-muted px-(--space-10)">{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

const SALES_ORDER_LINE_GRID_COLUMNS =
  "minmax(13rem, 1.7fr) minmax(4.75rem, 0.45fr) minmax(7rem, 0.75fr) minmax(6rem, 0.6fr) minmax(5.75rem, 0.5fr) minmax(5.25rem, 0.45fr)";
const SALES_ORDER_SHIPMENT_GRID_COLUMNS =
  "minmax(7.5rem, 0.75fr) minmax(7.5rem, 0.75fr) minmax(6rem, 0.55fr) minmax(18rem, 1.7fr) minmax(8rem, 0.8fr) 2.25rem";

type OrderFormValues = z.input<typeof insertSalesOrderSchema>;
type OrderFormShipment = NonNullable<OrderFormValues["shipments"]>[number];
type AddressDialogValues = z.input<typeof createAddressEntrySchema>;
const NO_PROJECT_VALUE = "__no_project__";
const ADD_SHIPPING_ADDRESS_VALUE = "__add_shipping_address__";
const EDIT_SHIPPING_ADDRESS_VALUE = "__edit_shipping_address__";
const ADDRESS_DIALOG_FIELD_NAMES = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;
const EMPTY_ADDRESS_DIALOG_VALUES: AddressDialogValues = {
  label: "",
  contactName: null,
  contactPhone: null,
  line1: null,
  line2: null,
  city: null,
  region: null,
  postcode: null,
  country: null,
  deliveryInstructions: null,
  notes: null,
};

type AddressEntry = {
  id: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

type ShippingAddressOption = ShipAddress & {
  id: string;
  label: string;
  addressEntryId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

function isBlankSalesOrderLine(line: OrderFormValues["lines"][number] | undefined) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantity = line?.quantity?.trim() ?? "";
  const unitPrice = line?.unitPrice?.trim() ?? "";
  return itemId === "" && quantity === "" && unitPrice === "";
}

function createBlankShipment(): OrderFormShipment {
  return {
    fulfillmentType: "delivery",
    scheduledDate: null,
    deliveryDate: null,
    notes: null,
    lines: [],
  };
}

function getShipmentLineQuantity(
  shipment: OrderFormShipment | undefined,
  itemId: string
) {
  return shipment?.lines?.find((line) => line.itemId === itemId)?.quantity ?? "";
}

function setShipmentLineQuantityInForm(
  form: ReturnType<typeof useForm<OrderFormValues>>,
  shipmentIndex: number,
  itemId: string,
  quantity: string,
  maxQuantity?: number
) {
  const currentLines = form.getValues(`shipments.${shipmentIndex}.lines`) ?? [];
  const nextQuantity =
    maxQuantity == null ? quantity.trim() : clampShipmentQuantity(quantity, maxQuantity);
  const existingIndex = currentLines.findIndex((line) => line.itemId === itemId);
  const nextLines = [...currentLines];

  if (nextQuantity === "") {
    if (existingIndex >= 0) {
      nextLines.splice(existingIndex, 1);
    }
  } else if (existingIndex >= 0) {
    nextLines[existingIndex] = {
      ...nextLines[existingIndex],
      quantity: nextQuantity,
    };
  } else {
    nextLines.push({ itemId, quantity: nextQuantity });
  }

  form.setValue(`shipments.${shipmentIndex}.lines`, nextLines, {
    shouldDirty: true,
    shouldValidate: true,
  });
}

type ApiError = {
  status?: number;
  error?: string;
  errors?: Record<string, string[]>;
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

function shippingAddressKey(address: ShipAddress | null | undefined) {
  const normalized = normalizeAddressFields({
    line1: address?.line1,
    line2: address?.line2,
    city: address?.city,
    region: address?.region,
    postcode: address?.postcode,
    country: address?.country,
  });

  return [
    normalized.line1,
    normalized.line2,
    normalized.city,
    normalized.region,
    normalized.postcode,
    normalized.country,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

function shippingAddressLabel(address: ShipAddress) {
  return formatAddressLines({
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    country: address.country,
  }).join(", ");
}

function makeShippingAddressOption({
  address,
  label,
  addressEntryId = null,
  contactName = null,
  contactPhone = null,
  deliveryInstructions = null,
  notes = null,
}: {
  address: ShipAddress | null | undefined;
  label?: string | null;
  addressEntryId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryInstructions?: string | null;
  notes?: string | null;
}): ShippingAddressOption | null {
  if (!address || isShipAddressBlank(address) || isShipAddressDefaultOnly(address)) {
    return null;
  }

  const normalized = normalizeAddressFields(address);
  const id = shippingAddressKey(normalized);
  if (!id) return null;

  return {
    ...normalized,
    id,
    label: label?.trim() || shippingAddressLabel(normalized),
    addressEntryId,
    contactName,
    contactPhone,
    deliveryInstructions,
    notes,
  };
}

function addressEntryToShippingOption(entry: AddressEntry) {
  return makeShippingAddressOption({
    address: normalizeAddressFields({
      line1: entry.line1,
      line2: entry.line2,
      city: entry.city,
      region: entry.region,
      postcode: entry.postcode,
      country: entry.country,
    }),
    label: entry.label,
    addressEntryId: entry.id,
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
    deliveryInstructions: entry.deliveryInstructions,
    notes: entry.notes,
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
  addresses,
  initialData,
  initialCustomerId,
  initialCustomerProjectId,
}: {
  customers: CustomerOption[];
  items: SalesOrderItemOption[];
  addresses: AddressEntry[];
  initialData?: SalesOrderEditData;
  initialCustomerId?: string | null;
  initialCustomerProjectId?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData ? `/sales/orders/${initialData.id}` : "/sales/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [addressBookOptions, setAddressBookOptions] = useState(() =>
    addresses
      .map(addressEntryToShippingOption)
      .filter((option): option is ShippingAddressOption => option != null)
      .sort((a, b) => a.label.localeCompare(b.label))
  );
  const [addressDialogState, setAddressDialogState] = useState<{
    option: ShippingAddressOption | null;
  } | null>(null);
  const [lineFieldIds, setLineFieldIds] = useState<string[]>([]);
  const isHydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );

  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
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
          orderNumber: initialData.orderNumber,
          customerId: initialData.customerId,
          customerProjectId: initialData.customerProjectId,
          status: initialData.status,
          orderDate: initialData.orderDate,
          shipDate: null,
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
          shipments: initialData.shipments.map((shipment) => ({
            fulfillmentType: shipment.fulfillmentType,
            scheduledDate: shipment.scheduledDate,
            deliveryDate: shipment.deliveryDate,
            notes: shipment.notes,
            lines: shipment.lines.map((line) => ({
              itemId: line.itemId,
              quantity: line.quantity,
            })),
          })),
          confirmOversell: false,
        }
      : {
          ...salesOrderDefaultValues,
          customerId: initialCustomerId ?? "",
          customerProjectId: initialCustomerProjectId ?? null,
          orderDate: todayInTimeZone(timeZone),
        },
  });
  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: EMPTY_ADDRESS_DIALOG_VALUES,
  });

  const watchedLines = useWatch({
    control: form.control,
    name: "lines",
  });
  const watchedShipments = useWatch({
    control: form.control,
    name: "shipments",
  });
  const shipmentFields = useFieldArray({
    control: form.control,
    name: "shipments",
  });
  const watchedShipAddress = useWatch({
    control: form.control,
    name: [
      "shipLine1",
      "shipLine2",
      "shipCity",
      "shipRegion",
      "shipPostcode",
      "shipCountry",
    ],
  });
  const customerId = useWatch({
    control: form.control,
    name: "customerId",
  });
  const customerProjectId = useWatch({
    control: form.control,
    name: "customerProjectId",
  });
  const selectedCustomer = customerId ? customerMap.get(customerId) : undefined;
  const projectOptions = useMemo(
    () => selectedCustomer?.projects ?? [],
    [selectedCustomer]
  );
  const [linePricingState, setLinePricingState] = useState<
    Record<string, LinePricingState>
  >({});
  const currentShipAddress = useMemo(
    () =>
      normalizeAddressFields({
        line1: watchedShipAddress?.[0] ?? null,
        line2: watchedShipAddress?.[1] ?? null,
        city: watchedShipAddress?.[2] ?? null,
        region: watchedShipAddress?.[3] ?? null,
        postcode: watchedShipAddress?.[4] ?? null,
        country: watchedShipAddress?.[5] ?? null,
      }),
    [watchedShipAddress]
  );
  const shippingAddressOptions = useMemo(() => {
    const options = new Map(
      addressBookOptions.map((option) => [option.id, option])
    );
    const customerOption = makeShippingAddressOption({
      address: getShipAddressFromCustomer(selectedCustomer),
      label: selectedCustomer ? `${selectedCustomer.name} shipping` : null,
    });
    const currentOption = makeShippingAddressOption({
      address: currentShipAddress,
      label: "Current address",
    });

    if (customerOption && !options.has(customerOption.id)) {
      options.set(customerOption.id, customerOption);
    }
    if (currentOption && !options.has(currentOption.id)) {
      options.set(currentOption.id, currentOption);
    }

    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [addressBookOptions, currentShipAddress, selectedCustomer]);

  useEffect(() => {
    if (!customerProjectId) return;
    const projectBelongsToCustomer = projectOptions.some(
      (project) => project.id === customerProjectId
    );
    if (!projectBelongsToCustomer) {
      form.setValue("customerProjectId", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [customerProjectId, form, projectOptions]);

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

  function getLinePricingState(
    lineKey: string,
    index: number,
    initialIndex: number | null
  ) {
    const currentState = linePricingState[lineKey];
    const line =
      initialIndex == null ? undefined : initialData?.lines[initialIndex];
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
  const lineCount = (watchedLines ?? []).filter(
    (line) => !isBlankSalesOrderLine(line)
  ).length;
  const shipmentOrderLines = useMemo(
    () =>
      (watchedLines ?? [])
        .map((line, index) => ({
          index,
          itemId: line?.itemId?.trim() ?? "",
          label:
            line?.itemId && itemMap.get(line.itemId)
              ? itemMap.get(line.itemId)?.displayName ?? `Line ${index + 1}`
              : `Line ${index + 1}`,
          orderedQty: line?.quantity ?? null,
        }))
        .filter((line) => line.itemId && parsePositive(line.orderedQty) != null),
    [itemMap, watchedLines]
  );
  const createShipmentWithRemainingQuantities = useCallback(() => {
    const lines = shipmentOrderLines.flatMap((line) => {
      const quantity = getOrderFormShipmentLineCapacity({
        shipments: watchedShipments,
        itemId: line.itemId,
        orderedQuantity: line.orderedQty,
      });

      return quantity > 0
        ? [{ itemId: line.itemId, quantity: formatShipmentQuantityCapacity(quantity) }]
        : [];
    });

    return {
      ...createBlankShipment(),
      lines,
    };
  }, [shipmentOrderLines, watchedShipments]);
  const shipmentCount = (watchedShipments ?? []).filter((shipment) => {
    if (!shipment) return false;
    return Boolean(
      shipment.scheduledDate ||
        shipment.deliveryDate ||
        shipment.notes ||
        shipment.lines?.some((line) => line.quantity)
    );
  }).length;

  const orderSummary = useMemo(() => {
    let cogs = 0;
    let resolvedLineCount = 0;

    (watchedLines ?? []).forEach((line, index) => {
      const qty = parsePositive(line?.quantity);
      if (qty == null) return;

      if (line?.itemId) {
        resolvedLineCount += 1;
      }

      const item = line?.itemId ? itemMap.get(line.itemId) : undefined;
      const lineKey = lineFieldIds[index];
      const unitCost =
        (lineKey ? linePricingState[lineKey]?.estimatedUnitCost : null) ??
        item?.estimatedUnitCost;
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
  }, [itemMap, lineFieldIds, linePricingState, orderTotal, watchedLines]);

  const handleLineFieldsChange = useCallback(
    (fields: Array<{ id: string }>) => {
      setLineFieldIds((currentIds) => {
        const nextIds = fields.map((field) => field.id);
        if (
          currentIds.length === nextIds.length &&
          currentIds.every((id, index) => id === nextIds[index])
        ) {
          return currentIds;
        }

        return nextIds;
      });

    },
    []
  );

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

      setFormError(error.error ?? "Failed to save sales order.");
    },
  });
  const addressMutation = useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string | null;
      values: AddressDialogValues;
    }) => {
      const response = await fetch(id ? `/api/addresses/${id}` : "/api/addresses", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save address.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      return body as AddressEntry;
    },
    onSuccess: (entry) => {
      const option = addressEntryToShippingOption(entry);
      if (!option) return;

      setAddressBookOptions((current) => {
        const existing = current.filter((row) => row.id !== option.id);
        return [...existing, option].sort((a, b) => a.label.localeCompare(b.label));
      });
      setShipAddress(form.setValue, option);
      setAddressDialogState(null);
      addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    },
  });

  const applyShippingAddress = (address: ShipAddress | null) => {
    if (!address) {
      setShipAddress(form.setValue, {
        line1: null,
        line2: null,
        city: null,
        region: null,
        postcode: null,
        country: null,
      });
      return;
    }

    setShipAddress(form.setValue, address);
  };

  const openAddressDialog = () => {
    addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    setAddressDialogState({ option: null });
  };

  const openEditAddressDialog = (option: ShippingAddressOption) => {
    addressForm.reset({
      label: option.label,
      contactName: option.contactName,
      contactPhone: option.contactPhone,
      line1: option.line1,
      line2: option.line2,
      city: option.city,
      region: option.region,
      postcode: option.postcode,
      country: option.country,
      deliveryInstructions: option.deliveryInstructions,
      notes: option.notes,
    });
    setAddressDialogState({ option });
  };

  const handleAddressDialogSubmit = (values: AddressDialogValues) => {
    if (addressDialogState == null) return;
    const baseLabel =
      values.label.trim() ||
      formatAddressLines({
        line1: values.line1,
        line2: values.line2,
        city: values.city,
        region: values.region,
        postcode: values.postcode,
        country: values.country,
      }).join(", ") ||
      "Address";
    let label = baseLabel;
    if (!values.label.trim()) {
      const labels = new Set(shippingAddressOptions.map((option) => option.label));
      let suffix = 2;
      while (labels.has(label)) {
        label = `${baseLabel} (${suffix})`;
        suffix += 1;
      }
    }

    addressMutation.mutate({
      id: addressDialogState.option?.addressEntryId ?? null,
      values: { ...values, label },
    });
  };

  const handleCancel = useSmartBack(fallbackPath);
  const primaryActionLabel = mutation.isPending
    ? isEditing
      ? "Saving..."
      : "Creating..."
    : isEditing
      ? "Save Changes"
      : "Create Order";
  const submitOrder = form.handleSubmit(
    (values) => mutation.mutate(values),
    (errors) => {
      setFormError(
        getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
      );
    }
  );

  const linesError = getFieldArrayError(form.formState.errors.lines);
  const shipmentsError = getFieldArrayError(form.formState.errors.shipments);

  if (!isHydrated) {
    return (
      <div className="w-full space-y-8">
        <div className="space-y-(--space-3)">
          <div className="h-(--height-input-lg) w-56 bg-muted" />
          <div className="h-(--space-8) w-80 bg-muted" />
        </div>
        <Separator />
        <div className="space-y-8">
          <div className="h-48 border bg-card" />
          <div className="h-64 border bg-card" />
          <div className="h-40 border bg-card" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto w-full max-w-[1480px] space-y-(--space-12)">
        <div className="sticky top-0 z-10 border-b bg-background/90 py-(--space-6) backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-col gap-(--space-6) md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-(--space-6)">
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
                <div className="flex flex-wrap items-center gap-(--space-4)">
                  <h1 className="text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)]">
                    {isEditing ? "Edit Sales Order" : "Add Sales Order"}
                  </h1>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-(--space-4) sm:flex-row">
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

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            id="sales-order-form"
            className="space-y-5"
            onSubmit={submitOrder}
          >
            <SalesOrderSection title="Order details">
              <FieldGroup className="gap-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(13rem,0.55fr)_minmax(0,1.45fr)]">
                  <Controller
                    control={form.control}
                    name="orderNumber"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} className="w-full">
                          Sales order #
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          placeholder="Assigned on save"
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />

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
                        <EntityCombobox
                          options={customers}
                          value={field.value ?? ""}
                          onValueChange={(value) => {
                            const nextValue = value ?? "";
                            field.onChange(nextValue);
                            form.setValue("customerProjectId", null, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
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
                          placeholder="Search customers..."
                          emptyMessage="No customers found"
                          createLinks={[
                            {
                              href: "/sales/customers/new",
                              label: "Create customer",
                            },
                          ]}
                        />
                        {field.value ? (
                          <Button variant="link" size="sm" className="h-auto px-0" asChild>
                            <Link href={`/sales/customers/${field.value}`} target="_blank">
                              Open customer
                            </Link>
                          </Button>
                        ) : null}
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                </div>

                <Controller
                  control={form.control}
                  name="customerProjectId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Project / Job</FieldLabel>
                      <Select
                        key={`${customerId ?? "none"}-${field.value ?? "none"}`}
                        name={field.name}
                        value={field.value ?? NO_PROJECT_VALUE}
                        onValueChange={(value) =>
                          field.onChange(value === NO_PROJECT_VALUE ? null : value)
                        }
                        disabled={!customerId || projectOptions.length === 0}
                      >
                        <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                          <SelectValue
                            placeholder={
                              customerId ? "No project" : "Select a customer first"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
                          {projectOptions.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.value ? (
                        <Button variant="link" size="sm" className="h-auto px-0" asChild>
                          <Link
                            href={`/sales/customers/${customerId}?project=${field.value}#projects`}
                            target="_blank"
                          >
                            Open project
                          </Link>
                        </Button>
                      ) : null}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />

                <ShippingAddressInput
                  id="order-shipping-address"
                  value={currentShipAddress}
                  options={shippingAddressOptions}
                  onChange={applyShippingAddress}
                  onAddNew={openAddressDialog}
                  onEdit={openEditAddressDialog}
                />

                <div className="grid gap-4 md:grid-cols-2">
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
                    name="requestedDate"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} className="w-full">
                          <TooltipHeader
                            label="Requested Date"
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

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 px-1">
                <h2 className="text-base font-semibold">Items</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {lineCount} {lineCount === 1 ? "item" : "items"}
                </span>
              </div>
              <EditableLineItems
                control={form.control}
                name="lines"
                columns={SALES_ORDER_LINE_GRID_COLUMNS}
                minWidth="0"
                headers={[
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
                ]}
                createLine={() => ({
                  itemId: "",
                  quantity: null,
                  unitPrice: null,
                })}
                addLabel="Add item"
                error={linesError}
                onFieldsChange={handleLineFieldsChange}
                renderRow={({ field, index, initialIndex, appendLineAfterCommit }) => (
                  <OrderLineRow
                    key={field.id}
                    lineKey={field.id}
                    index={index}
                    control={form.control}
                    customerId={customerId}
                    initialCustomerId={initialData?.customerId}
                    initialLine={
                      initialIndex == null
                        ? undefined
                        : initialData?.lines[initialIndex]
                    }
                    setValue={form.setValue}
                    items={items}
                    itemMap={itemMap}
                    pricingState={getLinePricingState(field.id, index, initialIndex)}
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
                      if (itemId) appendLineAfterCommit();
                    }}
                  />
                )}
              />
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 px-1">
                <h2 className="text-base font-semibold">Shipments</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {shipmentCount} planned
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <EditableLineGrid
                  columns={SALES_ORDER_SHIPMENT_GRID_COLUMNS}
                  minWidth="64rem"
                  headers={[
                    <TableHeaderLabel key="ship-date" label="Ship Date" required />,
                    <TableHeaderLabel
                      key="delivery-date"
                      label="Delivery Date"
                      required
                    />,
                    "Type",
                    "Quantities",
                    "Notes",
                    <span key="actions" />,
                  ]}
                >
                  {shipmentFields.fields.length === 0 ? (
                    <div
                      role="row"
                      className="grid min-w-0 grid-cols-(--editable-line-grid-columns)"
                    >
                      <div
                        role="cell"
                        className="col-span-full px-[var(--table-cell-px)] py-8 text-center text-sm text-muted-foreground"
                      >
                        No shipments planned
                      </div>
                    </div>
                  ) : (
                    shipmentFields.fields.map((field, shipmentIndex) => {
                      const shipment = watchedShipments?.[shipmentIndex];
                      return (
                        <EditableLineGridRow key={field.id}>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`shipments.${shipmentIndex}.scheduledDate`}
                              render={({ field: dateField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <DatePicker
                                    id={dateField.name}
                                    value={dateField.value ?? ""}
                                    onChange={(value) => dateField.onChange(value || null)}
                                    onBlur={dateField.onBlur}
                                    aria-label={`Ship date for shipment ${shipmentIndex + 1}`}
                                    aria-invalid={fieldState.invalid}
                                  />
                                  {fieldState.invalid ? (
                                    <FieldError errors={[fieldState.error]} />
                                  ) : null}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`shipments.${shipmentIndex}.deliveryDate`}
                              render={({ field: dateField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <DatePicker
                                    id={dateField.name}
                                    value={dateField.value ?? ""}
                                    onChange={(value) => dateField.onChange(value || null)}
                                    onBlur={dateField.onBlur}
                                    aria-label={`Delivery date for shipment ${shipmentIndex + 1}`}
                                    aria-invalid={fieldState.invalid}
                                  />
                                  {fieldState.invalid ? (
                                    <FieldError errors={[fieldState.error]} />
                                  ) : null}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`shipments.${shipmentIndex}.fulfillmentType`}
                              render={({ field: typeField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <Select
                                    value={typeField.value ?? "delivery"}
                                    onValueChange={typeField.onChange}
                                  >
                                    <SelectTrigger aria-invalid={fieldState.invalid}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="delivery">Delivery</SelectItem>
                                      <SelectItem value="pickup">Pickup</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {fieldState.invalid ? (
                                    <FieldError errors={[fieldState.error]} />
                                  ) : null}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell className="items-start">
                            <div className="grid w-full gap-2">
                              {shipmentOrderLines.length === 0 ? (
                                <span className="text-sm text-muted-foreground">
                                  Add items first
                                </span>
                              ) : (
                                shipmentOrderLines.map((line) => {
                                  const maxQuantity = getOrderFormShipmentLineCapacity({
                                    shipments: watchedShipments,
                                    shipmentIndex,
                                    itemId: line.itemId,
                                    orderedQuantity: line.orderedQty,
                                  });
                                  const shipmentQuantityDescriptionId = `shipment-${shipmentIndex}-${line.itemId}-quantity-description`;

                                  return (
                                    <label
                                      key={line.itemId}
                                      className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1"
                                    >
                                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                                        {line.label}
                                      </span>
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        max={maxQuantity}
                                        step="0.0001"
                                        value={getShipmentLineQuantity(
                                          shipment,
                                          line.itemId
                                        )}
                                        aria-describedby={shipmentQuantityDescriptionId}
                                        onChange={(event) =>
                                          setShipmentLineQuantityInForm(
                                            form,
                                            shipmentIndex,
                                            line.itemId,
                                            event.target.value,
                                            maxQuantity
                                          )
                                        }
                                        aria-label={`Shipment quantity for ${line.label}`}
                                      />
                                      <span
                                        id={shipmentQuantityDescriptionId}
                                        className="col-start-2 text-xs text-muted-foreground"
                                      >
                                        Max {formatShipmentQuantityCapacity(maxQuantity)}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`shipments.${shipmentIndex}.notes`}
                              render={({ field: notesField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <Input
                                    {...notesField}
                                    value={notesField.value ?? ""}
                                    aria-invalid={fieldState.invalid}
                                  />
                                  {fieldState.invalid ? (
                                    <FieldError errors={[fieldState.error]} />
                                  ) : null}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell align="center">
                            <EditableLineGridRemoveButton
                              label="Delete shipment"
                              onClick={() => shipmentFields.remove(shipmentIndex)}
                            />
                          </EditableLineGridCell>
                        </EditableLineGridRow>
                      );
                    })
                  )}
                </EditableLineGrid>
                {shipmentsError ? <FieldError>{shipmentsError}</FieldError> : null}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      shipmentFields.append(createShipmentWithRemainingQuantities())
                    }
                  >
                    <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                    Add shipment
                  </Button>
                </div>
              </div>
            </section>

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

          <aside className="space-y-(--space-8) self-start 2xl:sticky 2xl:top-(--space-12)">
            <Card className="border shadow-none ring-0">
              <CardHeader className="border-b bg-muted px-(--space-10) pb-(--space-8)">
                <CardTitle className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold tracking-[var(--tracking-normal)]">
                  Order summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-(--space-6) px-(--space-10) text-[length:var(--text-sm)]">
                <div className="flex items-center justify-between gap-(--space-8)">
                  <span className="text-muted-foreground">
                    Subtotal ({orderSummary.resolvedLineCount}{" "}
                    {orderSummary.resolvedLineCount === 1 ? "item" : "items"})
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                  </span>
                </div>
              </CardContent>
              <CardFooter className="justify-between border-t bg-muted px-(--space-10)">
                <div>
                  <div className="text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
                    Total
                  </div>
                  <div className="text-[length:var(--text-xs)] text-muted-foreground">USD</div>
                </div>
                <div className="font-mono text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)] tabular-nums">
                  {formatPrice(orderTotal.toFixed(2)) ?? "$0.00"}
                </div>
              </CardFooter>
            </Card>

            <Card className="border shadow-none ring-0" size="sm">
              <CardContent className="grid grid-cols-2 gap-(--space-8) px-(--space-10)">
                <div>
                  <div className="text-[length:var(--text-xs)] text-muted-foreground">Estimated margin</div>
                  <div
                    className={`text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold ${marginToneClass(
                      orderSummary.marginMetrics?.marginPercent
                    )}`}
                  >
                    {marginPercentLabel(orderSummary.marginMetrics?.marginPercent)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[length:var(--text-xs)] text-muted-foreground">COGS</div>
                  <div className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
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

      <Dialog
        open={addressDialogState != null}
        onOpenChange={(open) => {
          if (!open) setAddressDialogState(null);
        }}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>
              {addressDialogState?.option ? "Edit Address" : "Add Address"}
            </DialogTitle>
          </DialogHeader>
          <form
            id="sales-shipping-address-form"
            onSubmit={addressForm.handleSubmit(handleAddressDialogSubmit)}
          >
            {addressMutation.error ? (
              <FieldError>
                {(addressMutation.error as ApiError).error ?? "Failed to save address."}
              </FieldError>
            ) : null}
            <FieldGroup className="gap-4">
              <Controller
                control={addressForm.control}
                name="label"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="shipping-address-label">Label</FieldLabel>
                    <Input
                      {...field}
                      id="shipping-address-label"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                      autoComplete="organization"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={addressForm.control}
                  name="contactName"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="shipping-address-contact-name">
                        Contact Name
                      </FieldLabel>
                      <Input
                        {...field}
                        id="shipping-address-contact-name"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                        autoComplete="name"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
                <Controller
                  control={addressForm.control}
                  name="contactPhone"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="shipping-address-contact-phone">
                        Contact Phone
                      </FieldLabel>
                      <Input
                        {...field}
                        id="shipping-address-contact-phone"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                        autoComplete="tel"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldGroup>
            <AddressFields
              control={addressForm.control}
              names={ADDRESS_DIALOG_FIELD_NAMES}
              idPrefix="sales-ship-address"
            />
            <FieldGroup className="mt-4 gap-4">
              <Controller
                control={addressForm.control}
                name="deliveryInstructions"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="shipping-address-delivery-instructions">
                      Delivery Instructions
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="shipping-address-delivery-instructions"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                      rows={3}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddressDialogState(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="sales-shipping-address-form"
              disabled={addressMutation.isPending}
            >
              {addressMutation.isPending
                ? "Saving..."
                : addressDialogState?.option
                  ? "Save Address"
                  : "Add Address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function ShippingAddressInput({
  id,
  value,
  options,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
  value: ShipAddress;
  options: ShippingAddressOption[];
  onChange: (address: ShipAddress | null) => void;
  onAddNew: () => void;
  onEdit: (option: ShippingAddressOption) => void;
}) {
  const currentAddressId = shippingAddressKey(value);
  const canEditCurrent = currentAddressId !== "";
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = canEditCurrent
    ? [...optionIds, EDIT_SHIPPING_ADDRESS_VALUE, ADD_SHIPPING_ADDRESS_VALUE]
    : [...optionIds, ADD_SHIPPING_ADDRESS_VALUE];

  return (
    <Field>
      <FieldLabel htmlFor={id}>Shipping Address</FieldLabel>
      <Combobox
        items={items}
        value={currentAddressId}
        onValueChange={(nextValue) => {
          if (!nextValue) {
            onChange(null);
            return;
          }
          if (nextValue === ADD_SHIPPING_ADDRESS_VALUE) {
            onAddNew();
            return;
          }
          if (nextValue === EDIT_SHIPPING_ADDRESS_VALUE) {
            const option = optionMap.get(currentAddressId);
            if (option) onEdit(option);
            return;
          }

          onChange(optionMap.get(nextValue) ?? null);
        }}
        itemToStringLabel={(itemId) => {
          if (itemId === ADD_SHIPPING_ADDRESS_VALUE) return "Add new address";
          if (itemId === EDIT_SHIPPING_ADDRESS_VALUE) return "Edit selected address";
          return optionMap.get(itemId)?.label ?? "";
        }}
      >
        <ComboboxInput
          id={id}
          placeholder="Address"
          showClear={currentAddressId !== ""}
          className="w-full min-w-0"
        />
        <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
          <ComboboxEmpty>No addresses found</ComboboxEmpty>
          <ComboboxList>
            {(itemId: string) => {
              if (itemId === ADD_SHIPPING_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Add new address
                  </ComboboxItem>
                );
              }
              if (itemId === EDIT_SHIPPING_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Edit selected address
                  </ComboboxItem>
                );
              }

              const option = optionMap.get(itemId);

              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option?.label}</span>
                    {option?.contactName ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {option.contactName}
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              );
            }}
          </ComboboxList>
          {optionIds.length > 0 ? <ComboboxSeparator /> : null}
        </ComboboxContent>
      </Combobox>
    </Field>
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
  items,
  itemMap,
  pricingState,
  onPricingStateChange,
  onItemChange,
}: {
  lineKey: string;
  index: number;
  control: Control<OrderFormValues>;
  customerId: string | null | undefined;
  initialCustomerId?: string | null;
  initialLine?: SalesOrderEditData["lines"][number];
  setValue: UseFormSetValue<OrderFormValues>;
  items: SalesOrderItemOption[];
  itemMap: Map<string, SalesOrderItemOption>;
  pricingState: LinePricingState | undefined;
  onPricingStateChange: (
    lineKey: string,
    nextState: Partial<LinePricingState>
  ) => void;
  onItemChange: (itemId: string) => void;
}) {
  const rowDomId = useId();
  const line = useWatch({
    control,
    name: `lines.${index}`,
  });

  const item = line?.itemId ? itemMap.get(line.itemId) : undefined;
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
    <>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-item`}>
                Item
              </FieldLabel>
              <InventoryItemCombobox
                options={items}
                value={field.value ?? ""}
                onValueChange={(value) => onItemChange(value ?? "")}
                inputId={`${rowDomId}-item`}
                inputAriaInvalid={fieldState.invalid}
                inputPrimaryFocus
                inputClassName="w-full min-w-0"
                placeholder="Search items..."
                emptyMessage="No items found"
                contentClassName="w-[min(36rem,calc(100vw-2rem))]"
                showTypeBadge
                createLinks={[
                  {
                    href: "/inventory/products/new",
                    label: "Create product",
                  },
                  {
                    href: "/inventory/materials/new",
                    label: "Create material",
                  },
                ]}
                getSecondaryText={(current) =>
                  [
                    current.sku,
                    current.unitName,
                    current.defaultSellingPrice
                      ? formatPrice(current.defaultSellingPrice) ?? "\u2014"
                      : null,
                    `Available ${current.availableQty}`,
                  ]
                    .filter((part): part is string => part != null && part !== "")
                    .join(" · ")
                }
              />
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
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-quantity`}>
                Quantity
              </FieldLabel>
              <Input
                {...field}
                id={`${rowDomId}-quantity`}
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
        <span className="block truncate">
          {item?.unitName ?? "\u2014"}
        </span>
      </EditableLineGridCell>

      <EditableLineGridCell align="right">
        <Controller
          control={control}
          name={`lines.${index}.unitPrice`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-unit-price`}>
                Unit Price
              </FieldLabel>
              <Input
                {...field}
                id={`${rowDomId}-unit-price`}
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
                    <LineCellHint
                      label="Pricing unavailable"
                      tooltip="Suggested pricing could not load; enter the unit price manually."
                    />
                  ) : pricingState?.suggestedUnitPrice != null ? (
                    <>
                      <LineCellHint
                        label={`Suggested ${
                          formatPrice(pricingState.suggestedUnitPrice) ?? "\u2014"
                        }`}
                        tooltip={
                          pricingState.pricingSourceType === "schedule_break" &&
                          pricingState.pricingScheduleName
                            ? `Suggested from ${pricingState.pricingScheduleName}${
                                pricingState.pricingBreakLabel
                                  ? `, ${pricingState.pricingBreakLabel}`
                                  : ""
                              }.`
                            : "Suggested from the base price."
                        }
                      />
                      {isPriceOverridden && (
                        <LineCellHint
                          label="Manual override"
                          tooltip="The entered unit price differs from the suggestion."
                        />
                      )}
                    </>
                  ) : item?.defaultSellingPrice == null && item ? (
                    <LineCellHint
                      label="No default price"
                      tooltip="This item has no default selling price; enter one manually."
                    />
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
    </>
  );
}
