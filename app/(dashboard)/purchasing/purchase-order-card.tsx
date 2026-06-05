"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import {
  type InsertPurchaseOrder,
  type PurchaseOrderStatus,
  type PurchaseOrderAdditionalCostDistributionMethod,
  type PurchaseOrderAdditionalCostType,
  insertPurchaseOrderSchema,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  formatPrice,
  formatDate,
  formatAddressLines,
  getFieldArrayError,
  normalizeAddressFields,
  normalizeMoney,
  parsePositive,
} from "@/lib/format";
import {
  calculatePurchaseOrderLandedCosts,
  normalizeLandedStockUnitCost,
  type LandedCostLineResult,
} from "@/lib/purchasing/landed-cost";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  MutableLines,
  type LineField,
} from "@/components/editable-lines";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import { NotesField } from "@/components/card-page/notes-field";
import { TotalsSummary } from "@/components/card-page/totals-summary";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import {
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CardField } from "@/components/card-page/card-field";
import {
  PO_LINE_TOTAL_TOOLTIP,
  PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
  PURCHASE_COST_AMOUNT_TOOLTIP,
  PURCHASE_COST_DISTRIBUTION_TOOLTIP,
  PURCHASE_COST_REFERENCE_TOOLTIP,
  PURCHASE_MATERIAL_TOOLTIP,
  PO_ORDERED_QTY_TOOLTIP,
  PURCHASE_UNIT_COST_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  PurchaseOrderDetail,
  PurchaseOrderEditData,
  PurchaseOrderMaterialOption,
  PurchaseOrderTaxRateOption,
  SupplierOption,
} from "./types";
import { SupplierSelect } from "./supplier-select";
import {
  PurchaseBillDialog,
  PurchaseOrderEmailDialog,
  type PurchaseBillDialogValues,
  type PurchaseOrderEmailDialogValues,
} from "./purchase-order-workflow-dialogs";
import { PurchaseBillActionControl } from "./purchase-order-workflow-actions";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { purchaseOrderStatusConfig } from "@/components/card-page/order-status-configs";
import {
  purchaseOrderDefaultDraft,
  purchaseOrderEditDataToDraft,
  usePurchaseOrderDraftController,
  type PurchaseOrderAdditionalCostDraftRow,
  type PurchaseOrderDraft,
  type PurchaseOrderFormValues,
  type PurchaseOrderLineDraftRow,
} from "./use-purchase-order-draft-controller";
import styles from "@/components/card-page/card-page.module.css";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

type FieldErrorState = Record<string, unknown>;
type FieldErrorShape = { message: string };

type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
  class: string | null;
};

type PurchaseOrderFormAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: Date | string;
  syncStatus: "synced" | "failed" | null;
  syncError: string | null;
  syncedAt: Date | string | null;
};

export type XeroBillSetupStatus =
  | "not_connected"
  | "provider_conflict"
  | "ready";

const ACCOUNTING_NOT_CONNECTED_MESSAGE =
  "Connect accounting software before creating supplier bills.";
const ADD_DELIVERY_ADDRESS_VALUE = "__add_delivery_address__";
const EDIT_DELIVERY_ADDRESS_VALUE = "__edit_delivery_address__";
const EMPTY_DELIVERY_ADDRESS = {
  shipAddressEntryId: null,
  shipContactName: null,
  shipContactPhone: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostcode: null,
  shipCountry: null,
  shipDeliveryInstructions: null,
};

const ADDITIONAL_COST_TYPE_LABELS: Record<
  PurchaseOrderAdditionalCostType,
  string
> = {
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
  taxRateId: null,
  accountingPurchaseAccountCode: null,
  ...EMPTY_DELIVERY_ADDRESS,
};

const blankPurchaseOrderAdditionalCost = {
  costType: "shipping" as const,
  reference: null,
  distributionMethod: "by_value" as const,
  accountingPurchaseAccountCode: null,
  amount: null,
};

type PurchaseOrderAdditionalCostPayloadRow = NonNullable<
  PurchaseOrderFormValues["additionalCosts"]
>[number];
type PurchaseOrderAdditionalCostGridRow = PurchaseOrderAdditionalCostDraftRow;
type PurchaseOrderAdditionalCostColumnKey =
  keyof PurchaseOrderAdditionalCostPayloadRow;
type PurchaseOrderLinePayloadRow = PurchaseOrderFormValues["lines"][number];
type PurchaseOrderLineGridRow = PurchaseOrderLineDraftRow;
type PurchaseOrderLineColumnKey =
  | "itemId"
  | "quantityOrdered"
  | "unitCost";

function isBlankPurchaseOrderLine(
  line: PurchaseOrderFormValues["lines"][number] | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
}

function createPurchaseOrderLineRow(
  values?: Partial<PurchaseOrderLinePayloadRow>,
): PurchaseOrderLineGridRow {
  return {
    ...blankPurchaseOrderLine,
    ...values,
    id: "id" in (values ?? {}) ? ((values as PurchaseOrderLineGridRow).id ?? null) : null,
    itemId: values?.itemId ?? "",
    clientRowId:
      "clientRowId" in (values ?? {})
        ? ((values as PurchaseOrderLineGridRow).clientRowId ?? crypto.randomUUID())
        : crypto.randomUUID(),
  };
}

function isBlankPurchaseOrderAdditionalCost(
  cost:
    | NonNullable<PurchaseOrderFormValues["additionalCosts"]>[number]
    | undefined,
) {
  const reference = cost?.reference?.trim() ?? "";
  const amount = cost?.amount?.trim() ?? "";
  return (
    (cost?.costType == null || cost.costType === "shipping") &&
    (cost?.distributionMethod == null ||
      cost.distributionMethod === "by_value") &&
    reference === "" &&
    amount === ""
  );
}

function createPurchaseOrderAdditionalCostRow(
  values?: Partial<PurchaseOrderAdditionalCostPayloadRow>,
): PurchaseOrderAdditionalCostGridRow {
  return {
    clientRowId:
      "clientRowId" in (values ?? {})
        ? ((values as PurchaseOrderAdditionalCostGridRow).clientRowId ??
          crypto.randomUUID())
        : crypto.randomUUID(),
    id:
      "id" in (values ?? {})
        ? ((values as PurchaseOrderAdditionalCostGridRow).id ?? null)
        : null,
    costType: values?.costType ?? blankPurchaseOrderAdditionalCost.costType,
    reference: values?.reference ?? blankPurchaseOrderAdditionalCost.reference,
    distributionMethod:
      values?.distributionMethod ??
      blankPurchaseOrderAdditionalCost.distributionMethod,
    accountingPurchaseAccountCode:
      values?.accountingPurchaseAccountCode ??
      blankPurchaseOrderAdditionalCost.accountingPurchaseAccountCode,
    amount: values?.amount ?? blankPurchaseOrderAdditionalCost.amount,
  };
}

function normalizeGridText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeNullableGridText(value: unknown) {
  const text = normalizeGridText(value);
  return text === "" ? null : text;
}

function validateNonNegativeMoneyCell(value: unknown, message: string) {
  const text = normalizeGridText(value);
  if (text === "") return [message];
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? null : [message];
}

function getPurchaseOrderAdditionalCostCellError(
  error: unknown,
  rowIndex: number,
  key: PurchaseOrderAdditionalCostColumnKey,
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

function getPurchaseOrderLineCellError(
  error: unknown,
  rowIndex: number,
  key: PurchaseOrderLineColumnKey,
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

function parseNonNegative(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function lineTotalLabel(
  quantityOrdered: string | null | undefined,
  unitCost: string | null | undefined,
  taxRateId: string | null | undefined,
  taxRateMap: Map<string, PurchaseOrderTaxRateOption>,
) {
  const subtotal = lineTotalBeforeTax(quantityOrdered, unitCost);
  if (subtotal == null) return "\u2014";
  const taxRate = taxRateId ? taxRateMap.get(taxRateId) : null;
  const taxAmount = subtotal * (Number(taxRate?.ratePercent ?? 0) / 100);
  return formatPrice((subtotal + taxAmount).toFixed(4)) ?? "\u2014";
}

function lineTotalBeforeTax(
  quantityOrdered: string | null | undefined,
  unitCost: string | null | undefined,
) {
  const quantity = parsePositive(quantityOrdered);
  const cost = parseNonNegative(unitCost);
  if (quantity == null || cost == null) return null;
  return quantity * cost;
}

function todayIsoDate() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

type DeliveryAddressFields = {
  shipAddressEntryId?: string | null;
  shipContactName?: string | null;
  shipContactPhone?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
  shipDeliveryInstructions?: string | null;
};

type DeliveryAddressOption = Required<DeliveryAddressFields> & {
  id: string;
  label: string;
  addressEntryId: string | null;
  notes: string | null;
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

type AddressDialogValues = {
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

function normalizeDeliveryAddress(
  address: DeliveryAddressFields | undefined,
): Required<DeliveryAddressFields> {
  const normalized = normalizeAddressFields({
    line1: address?.shipLine1,
    line2: address?.shipLine2,
    city: address?.shipCity,
    region: address?.shipRegion,
    postcode: address?.shipPostcode,
    country: address?.shipCountry,
  });

  return {
    shipAddressEntryId: address?.shipAddressEntryId ?? null,
    shipContactName: address?.shipContactName?.trim() || null,
    shipContactPhone: address?.shipContactPhone?.trim() || null,
    shipLine1: normalized.line1,
    shipLine2: normalized.line2,
    shipCity: normalized.city,
    shipRegion: normalized.region,
    shipPostcode: normalized.postcode,
    shipCountry: normalized.country,
    shipDeliveryInstructions: address?.shipDeliveryInstructions?.trim() || null,
  };
}

function deliveryAddressKey(address: DeliveryAddressFields | undefined) {
  const normalized = normalizeDeliveryAddress(address);
  if (normalized.shipAddressEntryId)
    return `address:${normalized.shipAddressEntryId}`;
  return deliveryAddressContentKey(normalized);
}

function deliveryAddressContentKey(address: DeliveryAddressFields | undefined) {
  const normalized = normalizeDeliveryAddress(address);
  return [
    normalized.shipLine1,
    normalized.shipLine2,
    normalized.shipCity,
    normalized.shipRegion,
    normalized.shipPostcode,
    normalized.shipCountry,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

function deliveryAddressLabel(address: DeliveryAddressFields) {
  const lines = formatAddressLines({
    line1: address.shipLine1,
    line2: address.shipLine2,
    city: address.shipCity,
    region: address.shipRegion,
    postcode: address.shipPostcode,
    country: address.shipCountry,
  });
  return lines.join(", ");
}

function makeDeliveryAddressOption(
  address: DeliveryAddressFields | undefined,
  label?: string | null,
  notes?: string | null,
): DeliveryAddressOption | null {
  const normalized = normalizeDeliveryAddress(address);
  const id = deliveryAddressKey(normalized);
  if (id === "") return null;

  return {
    ...normalized,
    id,
    addressEntryId: normalized.shipAddressEntryId,
    label: label?.trim() || deliveryAddressLabel(normalized),
    notes: notes ?? null,
  };
}

function addressEntryToOption(
  entry: AddressEntry,
): DeliveryAddressOption | null {
  return makeDeliveryAddressOption(
    {
      shipAddressEntryId: entry.id,
      shipContactName: entry.contactName,
      shipContactPhone: entry.contactPhone,
      shipLine1: entry.line1,
      shipLine2: entry.line2,
      shipCity: entry.city,
      shipRegion: entry.region,
      shipPostcode: entry.postcode,
      shipCountry: entry.country,
      shipDeliveryInstructions: entry.deliveryInstructions,
    },
    entry.label,
    entry.notes,
  );
}

function collectDeliveryAddressOptions(values: PurchaseOrderFormValues) {
  const options = new Map<string, DeliveryAddressOption>();
  const candidates: DeliveryAddressFields[] = [values, ...(values.lines ?? [])];

  for (const candidate of candidates) {
    const option = makeDeliveryAddressOption(candidate);
    if (option) options.set(option.id, option);
  }

  return [...options.values()];
}

function deliveryInfoNote(instructions: string) {
  const value = instructions.trim();
  if (!value) return null;
  if (/^delivery info:/i.test(value)) return value;
  return `Delivery info:\n${value}`;
}

function PurchaseMaterialCell({
  data,
  materialMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
}) {
  if (!data?.itemId) {
    return <span className="text-muted-foreground">Search items...</span>;
  }

  return (
    <span className="block truncate">
      {materialMap.get(data.itemId)?.name ?? data.itemId}
    </span>
  );
}

function PurchaseUnitCell({
  data,
  materialMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
}) {
  const material = data?.itemId ? materialMap.get(data.itemId) : undefined;

  return (
    <span className="text-muted-foreground">
      {material?.purchaseUnitName ?? material?.stockingUnitName ?? "\u2014"}
    </span>
  );
}

function PurchaseLineTotalCell({
  data,
  taxRateMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  taxRateMap: Map<string, PurchaseOrderTaxRateOption>;
}) {
  return (
    <span className="font-medium">
      {lineTotalLabel(
        data?.quantityOrdered,
        data?.unitCost,
        data?.taxRateId,
        taxRateMap,
      )}
    </span>
  );
}

function PurchaseLandedCostCell({
  data,
  materialMap,
  landedCostByRowId,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  landedCostByRowId: Map<string, LandedCostLineResult>;
}) {
  const result = data?.clientRowId
    ? landedCostByRowId.get(data.clientRowId)
    : null;
  const unitCost = normalizeLandedStockUnitCost(result?.landedStockUnitCost ?? null);
  const material = data?.itemId ? materialMap.get(data.itemId) : undefined;

  if (!unitCost) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="block truncate font-medium">
      {formatPrice(unitCost) ?? "$0.00"}
      <span className="text-muted-foreground">
        {" / "}
        {material?.stockingUnitName ?? "unit"}
      </span>
    </span>
  );
}

function setFieldErrorPath(
  target: FieldErrorState,
  path: Array<string | number>,
  message: string,
) {
  let current: Record<string, unknown> = target;
  path.forEach((part, index) => {
    const key = String(part);
    if (index === path.length - 1) {
      current[key] = { message } satisfies FieldErrorShape;
      return;
    }
    const next = current[key];
    if (!next || typeof next !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
}

function purchaseOrderValidationErrors(values: PurchaseOrderFormValues) {
  const parsed = insertPurchaseOrderSchema.safeParse(values);
  if (parsed.success) return null;

  const errors: FieldErrorState = {};
  parsed.error.issues.forEach((issue) => {
    setFieldErrorPath(
      errors,
      issue.path.filter((part): part is string | number => typeof part !== "symbol"),
      issue.message,
    );
  });
  return errors;
}

function purchaseOrderApiFieldErrors(error: ApiError) {
  if (!error.errors) return {};
  const errors: FieldErrorState = {};
  Object.entries(error.errors).forEach(([field, messages]) => {
    setFieldErrorPath(errors, field.split("."), messages[0] ?? "Invalid value");
  });
  return errors;
}

function fieldErrorMessage(error: unknown) {
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : null;
}

function firstFieldErrorMessage(errors: FieldErrorState): string | null {
  for (const value of Object.values(errors)) {
    const message = fieldErrorMessage(value);
    if (message) return message;
    if (value && typeof value === "object") {
      const nested = firstFieldErrorMessage(value as FieldErrorState);
      if (nested) return nested;
    }
  }
  return null;
}

export function PurchaseOrderCard({
  suppliers,
  materials,
  addresses,
  initialData,
  defaultValues,
  orderTitle,
  canWrite = true,
  canViewLedger = false,
  userEmail = "",
  userName = "",
  organizationName = "Ashicore",
  xeroBillSetupStatus = "not_connected",
  xeroPurchaseBillDefaultAccountCode = null,
  accountingProviderLabel = null,
  taxRates = initialData?.taxRates ?? [],
  defaultTaxRateId = initialData?.defaultTaxRateId ?? null,
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  addresses: AddressEntry[];
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
  orderTitle?: string | null;
  canWrite?: boolean;
  canViewLedger?: boolean;
  userEmail?: string;
  userName?: string;
  organizationName?: string;
  xeroBillSetupStatus?: XeroBillSetupStatus;
  xeroPurchaseBillDefaultAccountCode?: string | null;
  accountingProviderLabel?: string | null;
  taxRates?: PurchaseOrderTaxRateOption[];
  defaultTaxRateId?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detachFileInputRef = useRef<(() => void) | null>(null);
  const attachmentInputId = useId();
  const fallbackPath = initialData
    ? `/purchasing/order/${initialData.id}`
    : "/purchasing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorState>({});
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const savedOrderIdRef = useRef<string | null>(initialData?.id ?? null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(
    initialData?.id ?? null,
  );
  const [savedOrderNumber, setSavedOrderNumber] = useState<string | null>(
    orderTitle ?? initialData?.orderNumber ?? null,
  );
  const [displayStatus, setDisplayStatus] = useState<PurchaseOrderStatus>(
    initialData?.status ?? "draft",
  );
  const [attachments, setAttachments] = useState<PurchaseOrderFormAttachment[]>(
    initialData?.attachments ?? [],
  );
  const [poEmailStatus, setPoEmailStatus] = useState<
    "sent" | "failed" | "skipped" | "pending" | null
  >(initialData?.xeroPoEmailStatus ?? null);
  const [poEmailError, setPoEmailError] = useState(
    initialData?.xeroPoEmailError ?? null,
  );
  const [poEmailDialogOpen, setPoEmailDialogOpen] = useState(false);
  const [poEmailDialogValues, setPoEmailDialogValues] =
    useState<PurchaseOrderEmailDialogValues>(() => ({
      to: initialData?.supplierEmail ?? "",
      replyTo: userEmail,
      bcc: userEmail,
      subject: `${initialData?.orderNumber ?? "Purchase order"} from ${organizationName}`,
      message: "",
    }));
  const [purchaseBillStatus, setPurchaseBillStatus] = useState(
    initialData?.purchaseBillStatus ?? null,
  );
  const [purchaseBillExternalNumber, setPurchaseBillExternalNumber] = useState(
    initialData?.purchaseBillExternalNumber ?? null,
  );
  const [purchaseBillExternalId, setPurchaseBillExternalId] = useState(
    initialData?.purchaseBillExternalId ?? null,
  );
  const [purchaseBillDialogOpen, setPurchaseBillDialogOpen] = useState(false);
  const [purchaseBillDialogValues, setPurchaseBillDialogValues] =
    useState<PurchaseBillDialogValues>(() => {
      const today = todayIsoDate();
      return {
        invoiceNumber: "",
        billDate: today,
        dueDate: today,
        accountingPurchaseAccountCode:
          initialData?.accountingPurchaseAccountCode ??
          xeroPurchaseBillDefaultAccountCode ??
          "",
        confirmAdditionalCostsOmitted: false,
      };
    });
  const xeroAccountsQuery = useQuery({
    queryKey: ["accounting-accounts", accountingProviderLabel],
    enabled: xeroBillSetupStatus === "ready",
    queryFn: async () => {
      const provider =
        accountingProviderLabel === "QuickBooks" ? "quickbooks" : "xero";
      const response = await fetch(
        `/api/accounting/connections/${provider}/accounts`
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load accounting accounts.");
      }
      return response.json() as Promise<{ accounts: XeroAccountOption[] }>;
    },
  });
  const xeroAccounts = useMemo(
    () => xeroAccountsQuery.data?.accounts ?? [],
    [xeroAccountsQuery.data?.accounts],
  );

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        ...material,
        displayName: material.name,
        unitName: material.stockingUnitName,
      })),
    [materials],
  );
  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );
  const receivedMaterialIds = useMemo(
    () =>
      new Set(
        (initialData?.lines ?? [])
          .filter(
            (line) =>
              Number(line.quantityReceived) > 0 ||
              Number(line.stockQuantityReceived) > 0,
          )
          .map((line) => line.itemId),
      ),
    [initialData?.lines],
  );
  const readOnly =
    !canWrite || displayStatus === "received" || displayStatus === "cancelled";
  const billAffectingReadOnly = readOnly || purchaseBillStatus === "pushed";
  const supplierOptionsSorted = [...suppliers].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const taxRateMap = useMemo(
    () => new Map(taxRates.map((rate) => [rate.id, rate])),
    [taxRates],
  );
  const defaultTaxRate =
    defaultTaxRateId != null ? taxRateMap.get(defaultTaxRateId) ?? null : null;
  const initialDraft = useMemo(
    () =>
      initialData
        ? purchaseOrderEditDataToDraft(initialData)
        : purchaseOrderDefaultDraft({
            defaultValues: defaultValues ?? purchaseOrderDefaultValues,
            defaultTaxRateId: defaultTaxRate?.id ?? null,
          }),
    [defaultTaxRate?.id, defaultValues, initialData],
  );

  const persistPurchaseOrder = useCallback(
    async (orderId: string | null, values: InsertPurchaseOrder) => {
      const validationErrors = purchaseOrderValidationErrors(values);
      if (validationErrors) {
        setFieldErrors(validationErrors);
        throw {
          error: firstFieldErrorMessage(validationErrors) ?? "Fix highlighted fields.",
        } satisfies ApiError;
      }

      setFormError(null);
      setFieldErrors({});
      const response = await fetch(
        orderId ? `/api/purchase-orders/${orderId}` : "/api/purchase-orders",
        {
          method: orderId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const error = {
          error: body?.error ?? "Failed to save purchase order.",
          errors: body?.errors,
        } satisfies ApiError;
        setFieldErrors(purchaseOrderApiFieldErrors(error));
        setFormError(error.error);
        throw error;
      }

      return body as PurchaseOrderDetail;
    },
    [],
  );

  const purchaseOrderController = usePurchaseOrderDraftController({
    initialData,
    defaultValues: defaultValues ?? purchaseOrderDefaultValues,
    defaultTaxRateId: defaultTaxRate?.id ?? null,
    persist: persistPurchaseOrder,
    queryClient,
    onPersisted: (id) => {
      savedOrderIdRef.current = id;
      setSavedOrderId(id);
      reflectPersistedCardUrlWithoutNavigation(`/purchasing/order/${id}`);
    },
    onResult: (result) => {
      savedOrderIdRef.current = result.id;
      setSavedOrderId(result.id);
      setSavedOrderNumber(result.orderNumber);
      setDisplayStatus(result.status);
    },
  });
  const draftValues = purchaseOrderController.draft;
  const commitPurchaseOrderDraft = useCallback(
    (
      patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">>,
      delayMs = 1200,
    ) => {
      setFormError(null);
      purchaseOrderController.patchHeader(patch, delayMs);
    },
    [purchaseOrderController],
  );
  const addressForm = useForm<AddressDialogValues>({
    defaultValues: EMPTY_ADDRESS_DIALOG_VALUES,
  });
  const [deliveryAddressOptions, setDeliveryAddressOptions] = useState<
    DeliveryAddressOption[]
  >(() => {
    const entries = addresses
      .map(addressEntryToOption)
      .filter((option): option is DeliveryAddressOption => Boolean(option));
    const byId = new Map(entries.map((option) => [option.id, option]));
    for (const option of collectDeliveryAddressOptions(initialDraft)) {
      byId.set(option.id, option);
    }
    return [...byId.values()];
  });
  const [addressDialogState, setAddressDialogState] = useState<{
    option: DeliveryAddressOption | null;
  } | null>(null);
  const lineGridRows = draftValues.lines;
  const additionalCostGridRows = draftValues.additionalCosts;
  const [additionalCostsExpanded, setAdditionalCostsExpanded] = useState(
    () =>
      initialDraft.additionalCosts.some(
        (row) => !isBlankPurchaseOrderAdditionalCost(row),
      ),
  );

  useEffect(() => {
    if (additionalCostsExpanded && additionalCostGridRows.length === 0) {
      setAdditionalCostsExpanded(false);
    }
  }, [additionalCostGridRows.length, additionalCostsExpanded]);

  const watchedSupplierId = draftValues.supplierId;
  const watchedAdditionalCosts = draftValues.additionalCosts;
  const watchedAdditionalInfo = draftValues.notes;
  const additionalCostRows = watchedAdditionalCosts ?? [];
  const landedCostPreview = useMemo(
    () =>
      calculatePurchaseOrderLandedCosts({
        lines: lineGridRows.map((line) => ({
          quantityOrdered: line?.quantityOrdered,
          unitCost: line?.unitCost,
          purchaseToStockFactor:
            (line?.itemId
              ? materialMap.get(line.itemId)?.purchaseToStockFactor
              : null) ?? "1",
        })),
        additionalCosts: watchedAdditionalCosts ?? [],
      }),
    [lineGridRows, materialMap, watchedAdditionalCosts],
  );
  const landedCostByRowId = useMemo(() => {
    return new Map(
      lineGridRows.map((row, index) => [
        row.clientRowId,
        landedCostPreview.lines[index],
      ]).filter((entry): entry is [string, LandedCostLineResult] =>
        Boolean(entry[1]),
      ),
    );
  }, [landedCostPreview.lines, lineGridRows]);
  const materialsTotal = landedCostPreview.materialSubtotal;
  const distributedAdditionalCostTotal =
    landedCostPreview.distributedAdditionalCostTotal;
  const nonDistributedAdditionalCostTotal =
    landedCostPreview.nonDistributedAdditionalCostTotal;
  const orderTotal = landedCostPreview.orderTotal;
  const taxTotal = lineGridRows.reduce((sum, line) => {
    const lineSubtotal = lineTotalBeforeTax(line.quantityOrdered, line.unitCost);
    if (lineSubtotal == null) return sum;
    const taxRate = line.taxRateId ? taxRateMap.get(line.taxRateId) : null;
    return sum + lineSubtotal * (Number(taxRate?.ratePercent ?? 0) / 100);
  }, 0);
  const hasAdditionalCostsForBill = additionalCostRows.some(
    (cost) => !isBlankPurchaseOrderAdditionalCost(cost),
  );
  const additionalCostsForBillTotal = additionalCostRows.reduce((sum, cost) => {
    if (isBlankPurchaseOrderAdditionalCost(cost)) return sum;
    const amount = parseNonNegative(cost.amount);
    return sum + (amount ?? 0);
  }, 0);
  const lineCount = lineGridRows.filter(
    (line) => !isBlankPurchaseOrderLine(line),
  ).length;
  const additionalCostCount = additionalCostRows.filter(
    (cost) => !isBlankPurchaseOrderAdditionalCost(cost),
  ).length;
  const canAutosaveDraft = Boolean(watchedSupplierId?.trim());
  const lineColumns = useMemo<LineField<PurchaseOrderLineGridRow>[]>(() => {
    const nonBlankRows = lineGridRows.filter(
      (row) => !isBlankPurchaseOrderLine(row),
    );
    const rowErrorIndex = (row: PurchaseOrderLineGridRow) =>
      nonBlankRows.findIndex(
        (current) => current.clientRowId === row.clientRowId,
      );
    const hasCellError =
      (key: PurchaseOrderLineColumnKey) =>
      (params: CellClassParams<PurchaseOrderLineGridRow>) => {
        if (!params.data) return false;
        const index = rowErrorIndex(params.data);
        return index >= 0
          ? Boolean(
              getPurchaseOrderLineCellError(
                fieldErrors.lines,
                index,
                key,
              ),
            )
          : false;
      };
    const cellTooltip =
      (key: PurchaseOrderLineColumnKey) =>
      ({ data }: { data?: PurchaseOrderLineGridRow }) => {
        if (!data) return null;
        if (key === "itemId" && receivedMaterialIds.has(data.itemId ?? "")) {
          return "Received material lines cannot change item. Add another line for a different material.";
        }
        const index = rowErrorIndex(data);
        return index >= 0
          ? getPurchaseOrderLineCellError(
              fieldErrors.lines,
              index,
              key,
            )
          : null;
      };

    const columns: LineField<PurchaseOrderLineGridRow>[] = [
      {
        field: "itemId",
        kind: "inventory-item",
        headerName: "Item",
        headerTooltip: PURCHASE_MATERIAL_TOOLTIP,
        minWidth: 300,
        flex: 1.6,
        editable: (data) => !billAffectingReadOnly && !receivedMaterialIds.has(data?.itemId ?? ""),
        options: materialOptions,
        placeholder: "Search or create item",
        emptyMessage: "No materials found",
        requiredMessage: "Material is required",
        isRowBlank: isBlankPurchaseOrderLine,
        getDraftRow: (row: PurchaseOrderLineGridRow, itemId: string) => ({
          ...row,
          itemId,
        }),
        createLinks: [
          {
            href: "/inventory/material",
            label: "Create material",
          },
          {
            href: "/inventory/product",
            label: "Create product",
          },
        ],
        getSecondaryText: (current) =>
          [current.sku, (current as PurchaseOrderMaterialOption).stockingUnitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          const materialId = normalizeGridText(params.newValue);
          params.data.itemId = materialId;
          params.data.unitCost =
            materialMap.get(materialId)?.defaultPurchasePrice ?? "0";
          return true;
        },
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseMaterialCell {...params} materialMap={materialMap} />,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("itemId"),
        },
        tooltipValueGetter: cellTooltip("itemId"),
      },
      {
        colId: "supplierItemCode",
        kind: "display",
        headerName: "Supplier item code",
        minWidth: 160,
        flex: 0.8,
        cellRenderer: () => <span className="text-muted-foreground">—</span>,
      },
      {
        colId: "internalBarcode",
        kind: "display",
        headerName: "Internal barcode",
        minWidth: 160,
        flex: 0.8,
        cellRenderer: () => <span className="text-muted-foreground">—</span>,
      },
      {
        field: "quantityOrdered",
        kind: "number",
        headerName: "Quantity",
        headerTooltip: PO_ORDERED_QTY_TOOLTIP,
        minWidth: 104,
        flex: 0.5,
        editable: !billAffectingReadOnly,
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.quantityOrdered = normalizeNullableGridText(
            params.newValue,
          );
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            quantityOrdered: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderLine(nextRow)) return null;
          const parsed = Number(nextRow.quantityOrdered);
          return Number.isFinite(parsed) && parsed > 0
            ? null
            : ["Quantity must be greater than 0"];
        },
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("quantityOrdered"),
        },
        tooltipValueGetter: cellTooltip("quantityOrdered"),
      },
      {
        colId: "purchaseUnit",
        kind: "display",
        headerName: "UoM",
        headerTooltip: PURCHASE_UNIT_TOOLTIP,
        minWidth: 96,
        flex: 0.4,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseUnitCell {...params} materialMap={materialMap} />,
      },
      {
        field: "unitCost",
        kind: "number",
        headerName: "Price per unit",
        headerTooltip: PURCHASE_UNIT_COST_TOOLTIP,
        minWidth: 132,
        flex: 0.65,
        editable: !billAffectingReadOnly,
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.unitCost = normalizeNullableGridText(params.newValue);
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            unitCost: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderLine(nextRow)) return null;
          const text = nextRow.unitCost?.trim() ?? "";
          if (!text) return ["Unit cost is required"];
          const parsed = Number(text);
          return Number.isFinite(parsed) && parsed >= 0
            ? null
            : ["Unit cost must be 0 or greater"];
        },
        valueFormatter: ({ value }) =>
          value == null || value === "" ? "" : (formatPrice(value) ?? value),
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("unitCost"),
        },
        tooltipValueGetter: cellTooltip("unitCost"),
      },
      {
        colId: "lineTotal",
        kind: "display",
        headerName: "Total price",
        headerTooltip: PO_LINE_TOTAL_TOOLTIP,
        minWidth: 136,
        flex: 0.65,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseLineTotalCell {...params} taxRateMap={taxRateMap} />,
      },
      {
        field: "taxRateId",
        kind: "select",
        headerName: "Tax",
        minWidth: 128,
        flex: 0.5,
        editable: !billAffectingReadOnly,
        values: ["", ...taxRates.map((rate) => rate.id)],
        valueFormatter: ({ value }) => {
          if (!value) return "0%";
          const rate = taxRateMap.get(String(value));
          return rate ? `${rate.ratePercent}% - ${rate.name}` : "0%";
        },
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.taxRateId = params.newValue ? String(params.newValue) : null;
          return true;
        },
      },
    ];

    if (additionalCostsExpanded) {
      columns.push({
        colId: "landedCost",
        kind: "display",
        headerName: "Landed cost",
        minWidth: 156,
        flex: 0.7,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => (
          <PurchaseLandedCostCell
            {...params}
            materialMap={materialMap}
            landedCostByRowId={landedCostByRowId}
          />
        ),
      });
    }

    return columns;
  }, [
    additionalCostsExpanded,
    fieldErrors.lines,
    landedCostByRowId,
    lineGridRows,
    materialMap,
    materialOptions,
    receivedMaterialIds,
    billAffectingReadOnly,
    taxRates,
    taxRateMap,
  ]);
  const handleLineRowsChange = useCallback(
    (rows: PurchaseOrderLineGridRow[]) => {
      purchaseOrderController.replaceLines(rows);
    },
    [purchaseOrderController],
  );
  const createLineRow = useCallback(
    () => createPurchaseOrderLineRow({ taxRateId: defaultTaxRate?.id ?? null }),
    [defaultTaxRate],
  );
  const getLineRowId = useCallback(
    (row: PurchaseOrderLineGridRow) => row.clientRowId,
    [],
  );
  const additionalCostColumns = useMemo<
    LineField<PurchaseOrderAdditionalCostGridRow>[]
  >(() => {
    const nonBlankRows = additionalCostGridRows.filter(
      (row) => !isBlankPurchaseOrderAdditionalCost(row),
    );
    const rowErrorIndex = (row: PurchaseOrderAdditionalCostGridRow) =>
      nonBlankRows.findIndex(
        (current) => current.clientRowId === row.clientRowId,
      );
    const hasCellError =
      (key: PurchaseOrderAdditionalCostColumnKey) =>
      (params: CellClassParams<PurchaseOrderAdditionalCostGridRow>) => {
        if (!params.data) return false;
        const index = rowErrorIndex(params.data);
        return index >= 0
          ? Boolean(
              getPurchaseOrderAdditionalCostCellError(
                fieldErrors.additionalCosts,
                index,
                key,
              ),
            )
          : false;
      };
    const cellTooltip =
      (key: PurchaseOrderAdditionalCostColumnKey) =>
      ({ data }: { data?: PurchaseOrderAdditionalCostGridRow }) => {
        if (!data) return null;
        const index = rowErrorIndex(data);
        return index >= 0
          ? getPurchaseOrderAdditionalCostCellError(
              fieldErrors.additionalCosts,
              index,
              key,
            )
          : null;
      };

    return [
      {
        field: "costType",
        kind: "select",
        headerName: "Cost",
        headerTooltip: PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
        minWidth: 128,
        flex: 0.75,
        editable: !billAffectingReadOnly,
        values: Object.keys(ADDITIONAL_COST_TYPE_LABELS),
        valueFormatter: ({
          value,
        }: ValueFormatterParams<
          PurchaseOrderAdditionalCostGridRow,
          PurchaseOrderAdditionalCostType
        >) => ADDITIONAL_COST_TYPE_LABELS[value ?? "shipping"],
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            PurchaseOrderAdditionalCostType
          >,
        ) => {
          params.data.costType = params.newValue ?? "shipping";
          return true;
        },
      },
      {
        field: "reference",
        kind: "text",
        headerName: "Reference",
        headerTooltip: PURCHASE_COST_REFERENCE_TOOLTIP,
        minWidth: 172,
        flex: 1.25,
        editable: !billAffectingReadOnly,
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          params.data.reference = normalizeNullableGridText(params.newValue);
          return true;
        },
        valueFormatter: ({ value }) => value ?? "",
      },
      {
        field: "distributionMethod",
        kind: "select",
        headerName: "Distribution",
        headerTooltip: PURCHASE_COST_DISTRIBUTION_TOOLTIP,
        minWidth: 148,
        flex: 0.8,
        editable: !billAffectingReadOnly,
        values: Object.keys(ADDITIONAL_COST_DISTRIBUTION_LABELS),
        valueFormatter: ({
          value,
        }: ValueFormatterParams<
          PurchaseOrderAdditionalCostGridRow,
          PurchaseOrderAdditionalCostDistributionMethod
        >) => ADDITIONAL_COST_DISTRIBUTION_LABELS[value ?? "by_value"],
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            PurchaseOrderAdditionalCostDistributionMethod
          >,
        ) => {
          params.data.distributionMethod = params.newValue ?? "by_value";
          return true;
        },
      },
      {
        field: "amount",
        kind: "number",
        headerName: "Amount",
        headerTooltip: PURCHASE_COST_AMOUNT_TOOLTIP,
        minWidth: 128,
        flex: 0.65,
        editable: !billAffectingReadOnly,
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          const parsed = parseNonNegative(normalizeGridText(params.newValue));
          params.data.amount =
            parsed == null
              ? normalizeNullableGridText(params.newValue)
              : normalizeMoney(parsed);
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            amount: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderAdditionalCost(nextRow)) return null;
          return validateNonNegativeMoneyCell(
            value,
            nextRow.amount ? "Amount must be 0 or greater" : "Amount is required",
          );
        },
        valueFormatter: ({ value }) =>
          value == null || value === "" ? "" : (formatPrice(value) ?? value),
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("amount"),
        },
        tooltipValueGetter: cellTooltip("amount"),
      },
    ];
  }, [
    additionalCostGridRows,
    fieldErrors.additionalCosts,
    billAffectingReadOnly,
  ]);
  const handleAdditionalCostRowsChange = useCallback(
    (
      rows: PurchaseOrderAdditionalCostGridRow[],
      change?: { type?: string },
    ) => {
      if (
        change?.type === "row_deleted" &&
        rows.every((row) => isBlankPurchaseOrderAdditionalCost(row))
      ) {
        setAdditionalCostsExpanded(false);
      }
      purchaseOrderController.replaceAdditionalCosts(rows);
    },
    [purchaseOrderController],
  );
  const createAdditionalCostRow = useCallback(
    () => createPurchaseOrderAdditionalCostRow(),
    [],
  );
  const getAdditionalCostRowId = useCallback(
    (row: PurchaseOrderAdditionalCostGridRow) => row.clientRowId,
    [],
  );

  const uploadFileMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "file-upload"],
    mutationFn: async ({ orderId, file }: { orderId: string; file: File }) => {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/purchase-orders/${orderId}/files`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to upload file.");
      }

      return body as PurchaseOrderFormAttachment;
    },
    onMutate: () => setFileActionError(null),
    onSuccess: (file) => {
      setAttachments((current) => [file, ...current]);
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (error: Error) => setFileActionError(error.message),
  });

  const deleteFileMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "file-delete"],
    mutationFn: async (fileId: string) => {
      if (!savedOrderId) throw new Error("Save the purchase order first.");
      const response = await fetch(
        `/api/purchase-orders/${savedOrderId}/files/${fileId}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete file.");
      }

      return fileId;
    },
    onMutate: () => setFileActionError(null),
    onSuccess: (fileId) => {
      setAttachments((current) => current.filter((file) => file.id !== fileId));
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (error: Error) => setFileActionError(error.message),
  });
  const duplicateMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "duplicate"],
    mutationFn: async () => {
      if (!savedOrderId) throw new Error("Save the purchase order first.");
      const response = await fetch(
        `/api/purchase-orders/${savedOrderId}/duplicate`,
        {
          method: "POST",
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to duplicate purchase order.");
      }

      return body as { id: string };
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.push(`/purchasing/order/${order.id}`);
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const statusMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "status"],
    mutationFn: async (status: PurchaseOrderStatus) => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      const response = await fetch(
        `/api/purchase-orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: createIdempotencyHeaders("purchase-order-status", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ status }),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error ?? "Failed to update purchase order status.",
        );
      }

      return body as { id: string };
    },
    onSuccess: async (_result, status) => {
      setDisplayStatus(status);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const purchaseBillMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "purchase-bill"],
    mutationFn: async (values: PurchaseBillDialogValues) => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      const response = await fetch(
        `/api/purchase-orders/${orderId}/accounting-bill`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("purchase-order-bill", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(values),
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof body?.error === "string" &&
          body.error.toLowerCase().includes("not connected")
            ? ACCOUNTING_NOT_CONNECTED_MESSAGE
            : body?.error ?? "Failed to create supplier bill.";
        throw new Error(message);
      }

      return body as {
        xeroBillId: string;
        xeroBillNumber: string;
        status: "pushed";
        created: boolean;
        adopted: boolean;
      };
    },
    onMutate: () => {
      setFormError(null);
      setPurchaseBillStatus("pending");
      return { previousStatus: purchaseBillStatus };
    },
    onSuccess: async (result) => {
      setPurchaseBillStatus("pushed");
      setPurchaseBillExternalId(result.xeroBillId);
      setPurchaseBillExternalNumber(result.xeroBillNumber);
      setPurchaseBillDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (error: Error, _values, context) => {
      setPurchaseBillStatus(context?.previousStatus ?? null);
    },
  });
  const purchaseOrderEmailMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "email"],
    mutationFn: async () => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      if (displayStatus === "draft") {
        const statusResponse = await fetch(
          `/api/purchase-orders/${orderId}/status`,
          {
            method: "PATCH",
            headers: createIdempotencyHeaders("purchase-order-status", {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ status: "ordered" }),
          },
        );
        const statusBody = await statusResponse.json().catch(() => null);

        if (!statusResponse.ok) {
          throw new Error(
            statusBody?.error ?? "Failed to set purchase order to Ordered.",
          );
        }

        setDisplayStatus("ordered");
      }

      const response = await fetch(`/api/purchase-orders/${orderId}/email`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-email", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          to: poEmailDialogValues.to,
          replyTo: poEmailDialogValues.replyTo || null,
          bcc: poEmailDialogValues.bcc || null,
          subject: poEmailDialogValues.subject,
          message: poEmailDialogValues.message || null,
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to send purchase order.");
      }

      return body as { status: "sent"; recipientEmail: string };
    },
    onMutate: () => {
      setFormError(null);
      setPoEmailError(null);
      setPoEmailStatus("pending");
      return { previousStatus: poEmailStatus };
    },
    onSuccess: async () => {
      setPoEmailStatus("sent");
      setPoEmailDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (error: Error) => {
      setPoEmailStatus("failed");
      setPoEmailError(error.message);
    },
  });

  const ensureSavedOrder = useCallback(async () => {
    await purchaseOrderController.flush();
    const orderId = savedOrderIdRef.current;
    if (!orderId) {
      const message =
        purchaseOrderController.error ??
        firstFieldErrorMessage(fieldErrors) ??
        "Choose a supplier before uploading files.";
      setFormError(message);
      throw new Error(message);
    }
    return orderId;
  }, [fieldErrors, purchaseOrderController]);

  const handleFileInput = useCallback(async (files: FileList | File[] | null) => {
    const filesToUpload = files ? Array.from(files) : [];
    if (filesToUpload.length === 0) return;

    try {
      const orderId = await ensureSavedOrder();
      for (const file of filesToUpload) {
        uploadFileMutation.mutate({ orderId, file });
      }
    } catch (error) {
      setFileActionError(
        error instanceof Error
          ? error.message
        : "Save the purchase order before uploading files.",
      );
    }
  }, [ensureSavedOrder, uploadFileMutation]);
  const attachFileInput = useCallback(
    (input: HTMLInputElement | null) => {
      detachFileInputRef.current?.();
      detachFileInputRef.current = null;
      fileInputRef.current = input;

      if (!input) return;
      const handleNativeFileInput = () => {
        const files = Array.from(input.files ?? []);
        void handleFileInput(files);
        input.value = "";
      };

      input.addEventListener("change", handleNativeFileInput);
      detachFileInputRef.current = () => {
        input.removeEventListener("change", handleNativeFileInput);
      };
    },
    [handleFileInput],
  );

  const addressMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "delivery-address"],
    mutationFn: async ({
      id,
      values,
    }: {
      id: string | null;
      values: AddressDialogValues;
    }) => {
      const response = await fetch(
        id ? `/api/addresses/${id}` : "/api/addresses",
        {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
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
      const option = addressEntryToOption(entry);
      if (!option || addressDialogState == null) return;

      setDeliveryAddressOptions((current) => {
        const existing = current.filter((row) => row.id !== option.id);
        return [...existing, option].sort((a, b) =>
          a.label.localeCompare(b.label),
        );
      });
      applyDeliveryAddress(option);
      setAddressDialogState(null);
      addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          addressForm.setError(field as keyof AddressDialogValues, {
            type: "server",
            message: messages[0],
          });
        });
      }
      setFormError(error.error ?? "Failed to save address.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);
  const applyDeliveryAddress = (address: DeliveryAddressFields | null) => {
    const nextAddress = address
      ? normalizeDeliveryAddress(address)
      : EMPTY_DELIVERY_ADDRESS;
    const patch: Partial<PurchaseOrderFormValues> = {
      ...nextAddress,
    };
    const nextDeliveryInstructions = nextAddress.shipDeliveryInstructions;
    const nextDeliveryNote = nextDeliveryInstructions
      ? deliveryInfoNote(nextDeliveryInstructions)
      : null;
    const currentNotes = draftValues.notes?.trim() ?? "";
    if (nextDeliveryNote && !currentNotes) {
      patch.notes = nextDeliveryNote;
    } else if (
      nextDeliveryNote &&
      nextDeliveryInstructions &&
      !currentNotes.includes(nextDeliveryInstructions)
    ) {
      patch.notes = `${currentNotes}\n\n${nextDeliveryNote}`;
    }
    commitPurchaseOrderDraft(patch);
  };

  const openAddressDialog = () => {
    addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    setAddressDialogState({ option: null });
  };

  const openEditAddressDialog = (option: DeliveryAddressOption) => {
    addressForm.reset({
      label: option.label,
      contactName: option.shipContactName,
      contactPhone: option.shipContactPhone,
      line1: option.shipLine1,
      line2: option.shipLine2,
      city: option.shipCity,
      region: option.shipRegion,
      postcode: option.shipPostcode,
      country: option.shipCountry,
      deliveryInstructions: option.shipDeliveryInstructions,
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
      const labels = new Set(
        deliveryAddressOptions.map((option) => option.label),
      );
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

  const linesError = getFieldArrayError(fieldErrors.lines);
  const additionalCostsError = getFieldArrayError(
    fieldErrors.additionalCosts,
  );
  const selectedSupplier = supplierOptionsSorted.find(
    (supplier) => supplier.id === watchedSupplierId,
  );
  const currentSupplierEmail =
    initialData?.supplierId === watchedSupplierId
      ? initialData.supplierEmail
      : selectedSupplier?.email ?? null;
  const currentDeliveryAddress: DeliveryAddressFields = {
    shipAddressEntryId: null,
    shipContactName: null,
    shipContactPhone: null,
    shipLine1: draftValues.shipLine1,
    shipLine2: draftValues.shipLine2,
    shipCity: draftValues.shipCity,
    shipRegion: draftValues.shipRegion,
    shipPostcode: draftValues.shipPostcode,
    shipCountry: draftValues.shipCountry,
    shipDeliveryInstructions: null,
  };
  const autosaveState = canAutosaveDraft ? purchaseOrderController.status : "idle";
  const autosaveMessage = canAutosaveDraft
    ? purchaseOrderController.status === "saved" || purchaseOrderController.status === "idle"
      ? "All changes saved"
      : purchaseOrderController.error
    : "All changes saved";
  const cardSaveState: CardSaveState = (() => {
    if (readOnly) return "readonly";
    if (autosaveState === "saving") return "saving";
    if (autosaveState === "error") return "failed";
    if (!savedOrderId || autosaveState === "dirty") {
      return "not_saved";
    }
    return "saved";
  })();
  const cardSaveMessage =
    cardSaveState === "saved"
      ? "Saved"
      : cardSaveState === "failed"
        ? autosaveMessage
        : null;
  const displayTitle = savedOrderId ? (
    <DetailHeaderTitle
      recordNumber={draftValues.orderNumber ?? savedOrderNumber ?? ""}
      name={selectedSupplier?.name ?? null}
    />
  ) : (
    "New purchase order"
  );
  const totalUnits = lineGridRows.reduce((sum, line) => {
    const quantity = parsePositive(line.quantityOrdered);
    return sum + (quantity ?? 0);
  }, 0);
  const billActionDisabledReason =
    cardSaveState === "saving" ||
    cardSaveState === "not_saved" ||
    cardSaveState === "failed"
      ? "Save changes before creating a supplier bill."
      : displayStatus === "draft"
        ? "Set this PO to Ordered before creating a supplier bill."
        : displayStatus === "cancelled"
          ? "Cancelled purchase orders cannot be billed."
          : purchaseBillStatus === "pending"
            ? "Bill sync is already running."
            : null;
  const openPurchaseOrderEmailDialog = () => {
    setPoEmailError(null);
    setPoEmailDialogValues({
      to: currentSupplierEmail ?? "",
      replyTo: userEmail,
      bcc: userEmail,
      subject: `${savedOrderNumber ?? "Purchase order"} from ${organizationName}`,
      message: `Hi,\n\nYou should find the necessary documents for ${savedOrderNumber ?? "this order"} attached to this email.\nPlease let me know if anything is missing.\n\nBest regards,\n${userName || userEmail}\n${organizationName}`,
    });
    setPoEmailDialogOpen(true);
  };
  const openPurchaseBillDialog = () => {
    if (xeroBillSetupStatus === "not_connected") {
      setFormError(ACCOUNTING_NOT_CONNECTED_MESSAGE);
      return;
    }
    if (xeroBillSetupStatus === "provider_conflict") {
      setFormError("Disconnect either Xero or QuickBooks before creating supplier bills.");
      return;
    }

    setFormError(null);
    setPurchaseBillDialogOpen(true);
  };

  return (
    <>
      <input
        id={attachmentInputId}
        ref={attachFileInput}
        type="file"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
      <CardPage>
        <CardPageHeader
          title={displayTitle}
          statusControl={
            savedOrderId ? (
              <OrderStatusControl
                config={purchaseOrderStatusConfig}
                ctx={{ orderId: savedOrderId, status: displayStatus }}
                disabled={!canWrite || statusMutation.isPending}
                onChanged={(next) => {
                  setDisplayStatus(next as PurchaseOrderStatus);
                  void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
                }}
              />
            ) : null
          }
          workflowControls={
            savedOrderId ? (
              <PurchaseBillActionControl
                status={purchaseBillStatus}
                busy={purchaseBillMutation.isPending}
                externalId={purchaseBillExternalId}
                externalNumber={purchaseBillExternalNumber}
                disabled={!canWrite || Boolean(billActionDisabledReason)}
                disabledReason={billActionDisabledReason}
                onCreate={openPurchaseBillDialog}
              />
            ) : null
          }
          saveState={cardSaveState}
          saveMessage={cardSaveMessage}
          iconActions={
            savedOrderId
              ? [
                  {
                    label:
                      purchaseOrderEmailMutation.isPending
                        ? "Sending PO email"
                        : poEmailStatus === "sent"
                          ? "Resend PO email"
                          : poEmailStatus === "failed"
                            ? "Retry PO email"
                            : "Send PO email",
                    icon: Mail01Icon,
                    status: purchaseOrderEmailMutation.isPending
                      ? "pending"
                      : poEmailStatus === "sent"
                        ? "success"
                        : poEmailStatus === "failed"
                          ? "failed"
                          : "idle",
                    onClick: openPurchaseOrderEmailDialog,
                    disabled:
                      !canWrite ||
                      purchaseOrderEmailMutation.isPending ||
                      !currentSupplierEmail,
                    tooltip:
                      poEmailError ??
                      (displayStatus === "draft"
                        ? "Sending this email will set the PO to Ordered."
                        : ""),
                  },
                ]
              : []
          }
          showPrint={false}
          menuActions={[
            ...(savedOrderId && canViewLedger
              ? [
                  {
                    label: "View inventory activity",
                    href: buildInventoryLedgerHref({
                      documentType: "purchase_order",
                      documentId: savedOrderId,
                    }),
                  },
                ]
              : []),
            ...(savedOrderId
              ? [
                  {
                    label: "Duplicate",
                    onClick: () => duplicateMutation.mutate(),
                    disabled: duplicateMutation.isPending,
                  },
                ]
              : []),
            ...(savedOrderId
              ? [
                  {
                    label: "Print",
                    onClick: () => window.print(),
                  },
                ]
              : []),
            ...(savedOrderId &&
            canWrite &&
            (displayStatus === "draft" || displayStatus === "ordered")
              ? [
                  {
                    label: "Cancel purchase order",
                    destructive: true,
                    onClick: () => {
                      if (window.confirm("Cancel this PO? You can't reactivate it.")) {
                        statusMutation.mutate("cancelled");
                      }
                    },
                    disabled: statusMutation.isPending,
                  },
                ]
              : []),
          ]}
          onClose={handleCancel}
          fallbackHref={fallbackPath}
        />

        <CardPageBody>
          {formError && (
            <CardSection>
              <FieldError>{formError}</FieldError>
            </CardSection>
          )}
          {xeroBillSetupStatus === "ready" && xeroAccountsQuery.error ? (
            <CardSection>
              <FieldError>
                {xeroAccountsQuery.error instanceof Error
                  ? xeroAccountsQuery.error.message
                  : "Failed to load accounting accounts."}
              </FieldError>
            </CardSection>
          ) : null}

          <>
            <CardSection title="Order details">
              <div className={`${styles.formRow} ${styles.formRowFour}`}>
                <div className={styles.formField}>
                  <SupplierSelect
                    suppliers={supplierOptionsSorted}
                    value={draftValues.supplierId}
                    onValueChange={(nextValue) => {
                      if ((nextValue ?? "") !== draftValues.supplierId) {
                        setPoEmailStatus(null);
                        setPoEmailError(null);
                      }
                      commitPurchaseOrderDraft({ supplierId: nextValue ?? "" });
                    }}
                    errorMessage={fieldErrorMessage(fieldErrors.supplierId) ?? undefined}
                    inputClassName={underlineControlClass(
                      !savedOrderId && !draftValues.supplierId,
                    )}
                    labelClassName={styles.formLabel}
                    required
                    invalid={!savedOrderId && !draftValues.supplierId}
                  />
                </div>
                <div className={styles.formField}>
                  <Field data-invalid={Boolean(fieldErrors.orderNumber)}>
                    <FieldLabel className={styles.formLabel} htmlFor="purchaseOrderNumber">
                      Purchase order
                    </FieldLabel>
                    {readOnly ? (
                      <div className={styles.readOnlyFieldValue}>
                        {draftValues.orderNumber ?? savedOrderNumber ?? "—"}
                      </div>
                    ) : (
                      <Input
                        id="purchaseOrderNumber"
                        value={draftValues.orderNumber ?? savedOrderNumber ?? ""}
                        disabled={!savedOrderId}
                        onChange={(event) =>
                          commitPurchaseOrderDraft({
                            orderNumber: event.target.value,
                          })
                        }
                        className={styles.underlineControl}
                      />
                    )}
                    {fieldErrors.orderNumber ? (
                      <FieldError>{fieldErrorMessage(fieldErrors.orderNumber)}</FieldError>
                    ) : null}
                  </Field>
                </div>
                <div className={styles.formField}>
                  <CardField
                    label="Expected arrival"
                    htmlFor="expectedDate"
                    required
                    invalid={Boolean(fieldErrors.expectedDate)}
                    error={fieldErrorMessage(fieldErrors.expectedDate)}
                  >
                    {readOnly ? (
                      <ReadOnlyFieldValue mono>
                        {draftValues.expectedDate ? formatDate(draftValues.expectedDate) : "—"}
                      </ReadOnlyFieldValue>
                    ) : (
                      <DatePicker
                        id="expectedDate"
                        value={draftValues.expectedDate ?? ""}
                        onChange={(value) => commitPurchaseOrderDraft({ expectedDate: value || null })}
                        aria-invalid={Boolean(fieldErrors.expectedDate)}
                        className={underlineControlClass(Boolean(fieldErrors.expectedDate))}
                      />
                    )}
                  </CardField>
                </div>
                <div className={styles.formField}>
                  <DeliveryAddressInput
                    id="purchase-order-delivery-address"
                    label="Delivery address"
                    value={currentDeliveryAddress}
                    options={deliveryAddressOptions}
                    onChange={applyDeliveryAddress}
                    onAddNew={openAddressDialog}
                    onEdit={openEditAddressDialog}
                    inputClassName={styles.underlineControl}
                    labelClassName={styles.formLabel}
                    readOnly={billAffectingReadOnly}
                  />
                </div>
              </div>
            </CardSection>

            <CardSection title="Materials" count={`· ${lineCount}`}>
              <MutableLines
                rows={lineGridRows}
                fields={lineColumns}
                getRowId={getLineRowId}
                createRow={createLineRow}
                onRowsChange={handleLineRowsChange}
                addLabel="Add material"
                readOnly={billAffectingReadOnly}
                canDeleteRow={(row) => !receivedMaterialIds.has(row.itemId ?? "")}
                getDeleteDisabledReason={(row) =>
                  receivedMaterialIds.has(row.itemId ?? "")
                    ? "Received material lines cannot be removed. Increase or reduce the ordered quantity instead."
                    : null
                }
                emptyMessage="No materials yet."
                error={linesError}
                footerActions={
                  !additionalCostsExpanded ? (
                    <button
                      type="button"
                      className="inline-flex min-h-7 items-center gap-(--space-1) rounded-(--radius-none) border-0 bg-transparent px-(--space-3) py-0 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={billAffectingReadOnly}
                      onClick={() => {
                        setAdditionalCostsExpanded(true);
                        if (additionalCostGridRows.length === 0) {
                          purchaseOrderController.replaceAdditionalCosts([
                            createAdditionalCostRow(),
                          ]);
                        }
                      }}
                    >
                      <span aria-hidden="true">+</span>
                      Additional costs
                    </button>
                  ) : null
                }
              />
            </CardSection>

            {additionalCostsExpanded ? (
              <CardSection title="Additional costs" count={`· ${additionalCostCount}`}>
                <MutableLines
                  rows={additionalCostGridRows}
                  fields={additionalCostColumns}
                  getRowId={getAdditionalCostRowId}
                  createRow={createAdditionalCostRow}
                  onRowsChange={handleAdditionalCostRowsChange}
                  addLabel="Add cost"
                  readOnly={billAffectingReadOnly}
                  emptyMessage="No additional costs yet."
                  error={additionalCostsError}
                />
              </CardSection>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <CardSection aria-label="Additional info">
                <NotesField
                  label="Additional info"
                  value={watchedAdditionalInfo ?? ""}
                  disabled={readOnly}
                  readOnlyValue={readOnly}
                  rows={3}
                  className="min-h-24"
                  readOnlyClassName="min-h-24"
                  placeholder="Supplier-facing notes shown on the purchase order."
                  onCommit={(next) => {
                    commitPurchaseOrderDraft({ notes: next });
                  }}
                />
                {fieldErrors.notes ? <FieldError>{fieldErrorMessage(fieldErrors.notes)}</FieldError> : null}
              </CardSection>
              <CardSection title="Totals">
                <TotalsSummary
                  rows={[
                    {
                      label: "Total units",
                      value: Number.isInteger(totalUnits)
                        ? totalUnits.toString()
                        : totalUnits.toFixed(4),
                    },
                    {
                      label: "Subtotal",
                      value: formatPrice(materialsTotal.toFixed(4)) ?? "$0.00",
                    },
                    {
                      label: "Additional costs",
                      value:
                        formatPrice(
                          (
                            distributedAdditionalCostTotal +
                            nonDistributedAdditionalCostTotal
                          ).toFixed(4),
                        ) ?? "$0.00",
                    },
                    {
                      label: "Tax",
                      value: formatPrice(taxTotal.toFixed(4)) ?? "$0.00",
                    },
                    {
                      label: "Total",
                      value:
                        formatPrice((orderTotal + taxTotal).toFixed(4)) ??
                        "$0.00",
                      rule: true,
                      emphasis: "total",
                    },
                  ]}
                />
              </CardSection>
            </div>
          </>
        </CardPageBody>
      </CardPage>
      <PurchaseOrderEmailDialog
        open={poEmailDialogOpen}
        orderId={savedOrderId}
        orderNumber={savedOrderNumber}
        attachments={attachments}
        values={poEmailDialogValues}
        error={poEmailError}
        pending={purchaseOrderEmailMutation.isPending}
        uploadPending={uploadFileMutation.isPending}
        deletePending={deleteFileMutation.isPending}
        fileError={fileActionError}
        onValuesChange={setPoEmailDialogValues}
        onOpenChange={(open) => setPoEmailDialogOpen(open)}
        onAddDocuments={() => fileInputRef.current?.click()}
        onDeleteDocument={(fileId) => deleteFileMutation.mutate(fileId)}
        onSend={() => purchaseOrderEmailMutation.mutate()}
      />
      <PurchaseBillDialog
        open={purchaseBillDialogOpen}
        values={purchaseBillDialogValues}
        hasAdditionalCosts={hasAdditionalCostsForBill}
        additionalCostTotal={additionalCostsForBillTotal.toFixed(4)}
        xeroAccounts={xeroAccounts}
        providerLabel={accountingProviderLabel ?? "Xero"}
        error={
          purchaseBillMutation.error instanceof Error
            ? purchaseBillMutation.error.message
            : null
        }
        pending={purchaseBillMutation.isPending}
        onValuesChange={setPurchaseBillDialogValues}
        onOpenChange={(open) => setPurchaseBillDialogOpen(open)}
        onCreate={() => purchaseBillMutation.mutate(purchaseBillDialogValues)}
      />
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
            id="add-delivery-address-form"
            onSubmit={addressForm.handleSubmit(handleAddressDialogSubmit)}
          >
            {addressMutation.error ? (
              <FieldError>
                {(addressMutation.error as ApiError).error ??
                  "Failed to save address."}
              </FieldError>
            ) : null}
            <FieldGroup className="gap-4">
              <Controller
                control={addressForm.control}
                name="label"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-label">Label</FieldLabel>
                    <Input
                      {...field}
                      id="address-label"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                      autoComplete="organization"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={addressForm.control}
                  name="contactName"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="address-contact-name">
                        Contact Name
                      </FieldLabel>
                      <Input
                        {...field}
                        id="address-contact-name"
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(event.target.value || null)
                        }
                        aria-invalid={fieldState.invalid}
                        autoComplete="name"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
                <Controller
                  control={addressForm.control}
                  name="contactPhone"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="address-contact-phone">
                        Contact Phone
                      </FieldLabel>
                      <Input
                        {...field}
                        id="address-contact-phone"
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(event.target.value || null)
                        }
                        aria-invalid={fieldState.invalid}
                        autoComplete="tel"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldGroup>
            <AddressFields
              control={addressForm.control}
              names={ADDRESS_DIALOG_FIELD_NAMES}
              idPrefix="po-line-ship"
            />
            <FieldGroup className="mt-4 gap-4">
              <Controller
                control={addressForm.control}
                name="deliveryInstructions"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-delivery-instructions">
                      Default delivery instructions
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="address-delivery-instructions"
                      value={field.value ?? ""}
                      onChange={(event) =>
                        field.onChange(event.target.value || null)
                      }
                      aria-invalid={fieldState.invalid}
                      rows={3}
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
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
              form="add-delivery-address-form"
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

function DeliveryAddressInput({
  id,
  label,
  value,
  options,
  onChange,
  onAddNew,
  onEdit,
  inputClassName,
  labelClassName,
  readOnly = false,
}: {
  id: string;
  label?: ReactNode;
  value: DeliveryAddressFields | undefined;
  options: DeliveryAddressOption[];
  onChange: (address: DeliveryAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (address: DeliveryAddressOption) => void;
  inputClassName?: string;
  labelClassName?: string;
  readOnly?: boolean;
}) {
  const currentAddressId = deliveryAddressKey(value);
  const canEditCurrent = currentAddressId !== "";
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const optionByContent = new Map(
    options.map((option) => [deliveryAddressContentKey(option), option]),
  );
  const currentContentKey = deliveryAddressContentKey(value);
  const matchedCurrentOption =
    optionMap.get(currentAddressId) ?? optionByContent.get(currentContentKey) ?? null;
  const currentComboboxValue = matchedCurrentOption?.id ?? currentAddressId;
  const items = canEditCurrent
    ? [...optionIds, EDIT_DELIVERY_ADDRESS_VALUE, ADD_DELIVERY_ADDRESS_VALUE]
    : [...optionIds, ADD_DELIVERY_ADDRESS_VALUE];
  const addressLines = formatAddressLines({
    line1: value?.shipLine1 ?? null,
    line2: value?.shipLine2 ?? null,
    city: value?.shipCity ?? null,
    region: value?.shipRegion ?? null,
    postcode: value?.shipPostcode ?? null,
    country: value?.shipCountry ?? null,
  });

  return (
    <Field>
      <FieldLabel className={labelClassName ?? (label ? undefined : "sr-only")} htmlFor={id}>
        {label ?? "Delivery Address"}
      </FieldLabel>
      {readOnly ? (
        <div className={styles.readOnlyFieldValue}>
          {addressLines.length > 0
            ? addressLines.map((line) => <div key={line}>{line}</div>)
            : "No delivery address set"}
        </div>
      ) : (
      <Combobox
        items={items}
        value={currentComboboxValue}
        onValueChange={(nextValue) => {
          if (!nextValue) {
            onChange(null);
            return;
          }
          if (nextValue === ADD_DELIVERY_ADDRESS_VALUE) {
            onAddNew();
            return;
          }
          if (nextValue === EDIT_DELIVERY_ADDRESS_VALUE) {
            if (matchedCurrentOption) onEdit(matchedCurrentOption);
            return;
          }

          onChange(optionMap.get(nextValue) ?? null);
        }}
        itemToStringLabel={(itemId) => {
          if (itemId === ADD_DELIVERY_ADDRESS_VALUE) return "Add new address";
          if (itemId === EDIT_DELIVERY_ADDRESS_VALUE)
            return "Edit selected address";
          return optionMap.get(itemId)?.label ?? "";
        }}
      >
        <ComboboxInput
          id={id}
          placeholder="Address"
          showClear={currentAddressId !== ""}
          className={inputClassName ?? "w-full min-w-0"}
        />
        <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
          <ComboboxEmpty>No addresses found</ComboboxEmpty>
          <ComboboxList>
            {(itemId: string) => {
              if (itemId === ADD_DELIVERY_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Add new address
                  </ComboboxItem>
                );
              }
              if (itemId === EDIT_DELIVERY_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Edit selected address
                  </ComboboxItem>
                );
              }

              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {optionMap.get(itemId)?.label}
                    </span>
                    {optionMap.get(itemId)?.shipContactName ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {optionMap.get(itemId)?.shipContactName}
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
      )}
    </Field>
  );
}
