"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Attachment01Icon,
  Delete02Icon,
  Download01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
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
  normalizeLandedDisplayNumber,
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { DetailHeaderTitle } from "@/components/card-page/detail-header-title";
import { NotesField } from "@/components/card-page/notes-field";
import { TotalsSummary } from "@/components/card-page/totals-summary";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { underlineControlClass } from "@/components/card-page/form-cell";
import {
  PO_LINE_TOTAL_TOOLTIP,
  PURCHASE_ACCOUNT_TOOLTIP,
  PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
  PURCHASE_COST_AMOUNT_TOOLTIP,
  PURCHASE_COST_DISTRIBUTION_TOOLTIP,
  PURCHASE_COST_REFERENCE_TOOLTIP,
  PURCHASE_LANDED_UNIT_TOOLTIP,
  PURCHASE_MATERIAL_TOOLTIP,
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
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { purchaseOrderStatusConfig } from "@/components/card-page/order-status-configs";
import styles from "@/components/card-page/card-page.module.css";

type PurchaseOrderFormValues = z.input<typeof insertPurchaseOrderSchema>;
type PurchaseOrderDraftOp = {
  type: "patch";
  patch: Partial<PurchaseOrderFormValues>;
};

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
type PurchaseOrderAdditionalCostGridRow =
  PurchaseOrderAdditionalCostPayloadRow & {
    clientRowId: string;
  };
type PurchaseOrderAdditionalCostColumnKey =
  keyof PurchaseOrderAdditionalCostPayloadRow;
type PurchaseOrderLinePayloadRow = PurchaseOrderFormValues["lines"][number];
type PurchaseOrderLineGridRow = PurchaseOrderLinePayloadRow & {
  clientRowId: string;
};
type PurchaseOrderLineColumnKey =
  | "itemId"
  | "quantityOrdered"
  | "unitCost"
  | "accountingPurchaseAccountCode";

function isBlankPurchaseOrderLine(
  line: PurchaseOrderFormValues["lines"][number] | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  const accountingPurchaseAccountCode =
    line?.accountingPurchaseAccountCode?.trim() ?? "";
  return (
    itemId === "" &&
    quantityOrdered === "" &&
    unitCost === "" &&
    accountingPurchaseAccountCode === ""
  );
}

function createPurchaseOrderLineRow(
  values?: Partial<PurchaseOrderLinePayloadRow>,
): PurchaseOrderLineGridRow {
  return {
    ...blankPurchaseOrderLine,
    ...values,
    itemId: values?.itemId ?? "",
    clientRowId: crypto.randomUUID(),
  };
}

function toPurchaseOrderLineGridRows(
  rows: PurchaseOrderFormValues["lines"] | undefined,
) {
  return (rows ?? [])
    .filter((row) => !isBlankPurchaseOrderLine(row))
    .map((row) => createPurchaseOrderLineRow(row));
}

function toPurchaseOrderLinePayloadRows(
  rows: PurchaseOrderLineGridRow[],
): PurchaseOrderLinePayloadRow[] {
  return rows
    .filter((row) => !isBlankPurchaseOrderLine(row))
    .map((row) => ({
      itemId: row.itemId,
      quantityOrdered: row.quantityOrdered,
      unitCost: row.unitCost,
      accountingPurchaseAccountCode: row.accountingPurchaseAccountCode,
      shipAddressEntryId: row.shipAddressEntryId,
      shipContactName: row.shipContactName,
      shipContactPhone: row.shipContactPhone,
      shipLine1: row.shipLine1,
      shipLine2: row.shipLine2,
      shipCity: row.shipCity,
      shipRegion: row.shipRegion,
      shipPostcode: row.shipPostcode,
      shipCountry: row.shipCountry,
      shipDeliveryInstructions: row.shipDeliveryInstructions,
    }));
}

function isBlankPurchaseOrderAdditionalCost(
  cost:
    | NonNullable<PurchaseOrderFormValues["additionalCosts"]>[number]
    | undefined,
) {
  const reference = cost?.reference?.trim() ?? "";
  const accountingPurchaseAccountCode =
    cost?.accountingPurchaseAccountCode?.trim() ?? "";
  const amount = cost?.amount?.trim() ?? "";
  return (
    (cost?.costType == null || cost.costType === "shipping") &&
    (cost?.distributionMethod == null ||
      cost.distributionMethod === "by_value") &&
    reference === "" &&
    accountingPurchaseAccountCode === "" &&
    amount === ""
  );
}

function createPurchaseOrderAdditionalCostRow(
  values?: Partial<PurchaseOrderAdditionalCostPayloadRow>,
): PurchaseOrderAdditionalCostGridRow {
  return {
    clientRowId: crypto.randomUUID(),
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

function toPurchaseOrderAdditionalCostGridRows(
  rows: PurchaseOrderFormValues["additionalCosts"] | undefined,
) {
  return (rows ?? []).map((row) => createPurchaseOrderAdditionalCostRow(row));
}

function toPurchaseOrderAdditionalCostPayloadRows(
  rows: PurchaseOrderAdditionalCostGridRow[],
): PurchaseOrderAdditionalCostPayloadRow[] {
  return rows
    .filter((row) => !isBlankPurchaseOrderAdditionalCost(row))
    .map(
      ({
        costType,
        reference,
        distributionMethod,
        accountingPurchaseAccountCode,
        amount,
      }) => ({
        costType,
        reference,
        distributionMethod,
        accountingPurchaseAccountCode,
        amount,
      }),
    );
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
) {
  const quantity = parsePositive(quantityOrdered);
  const cost = parseNonNegative(unitCost);
  if (quantity == null || cost == null) return "\u2014";
  return formatPrice((quantity * cost).toFixed(4)) ?? "\u2014";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeBadge({ file }: { file: PurchaseOrderFormAttachment }) {
  const type = file.contentType.includes("pdf")
    ? "PDF"
    : file.contentType.startsWith("image/")
      ? "IMG"
      : file.filename.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";

  return <Badge variant="outline">{type}</Badge>;
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

function landedStockUnitCostLabel(
  value: number | null | undefined,
  stockingUnitName: string | null | undefined,
) {
  if (value == null) return "\u2014";
  return `${formatPrice(normalizeLandedDisplayNumber(value)) ?? "\u2014"} / ${
    stockingUnitName ?? "stock unit"
  }`;
}

function purchaseUnitDisplay(
  purchaseUnitName: string | null | undefined,
  stockingUnitName: string | null | undefined,
) {
  if (
    purchaseUnitName &&
    stockingUnitName &&
    purchaseUnitName !== stockingUnitName
  ) {
    return {
      label: `${purchaseUnitName} -> ${stockingUnitName}`,
      tooltip: "Purchase unit converts to stocking unit.",
    };
  }

  return {
    label: purchaseUnitName ?? stockingUnitName ?? "\u2014",
    tooltip: null,
  };
}

function PurchaseMaterialCell({
  data,
  materialMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
}) {
  if (!data?.itemId) {
    return <span className="text-muted-foreground">Search materials...</span>;
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
  const unitDisplay = purchaseUnitDisplay(
    material?.purchaseUnitName,
    material?.stockingUnitName,
  );

  return <span className="text-muted-foreground">{unitDisplay.label}</span>;
}

function PurchaseLandedUnitCell({
  data,
  node,
  materialMap,
  landedCosts,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  landedCosts: LandedCostLineResult[];
}) {
  const material = data?.itemId ? materialMap.get(data.itemId) : undefined;
  return (
    <span className="font-medium">
      {landedStockUnitCostLabel(
        node.rowIndex == null
          ? null
          : landedCosts[node.rowIndex]?.landedStockUnitCost,
        material?.stockingUnitName,
      )}
    </span>
  );
}

function PurchaseLineTotalCell({
  data,
}: ICellRendererParams<PurchaseOrderLineGridRow>) {
  return (
    <span className="font-medium">
      {lineTotalLabel(data?.quantityOrdered, data?.unitCost)}
    </span>
  );
}

function hasAutosaveMinimum(values: PurchaseOrderFormValues) {
  return Boolean(values.supplierId?.trim());
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
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  addresses: AddressEntry[];
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
  orderTitle?: string | null;
  canWrite?: boolean;
  canViewLedger?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackPath = initialData
    ? `/purchasing/order/${initialData.id}`
    : "/purchasing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorState>({});
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
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
  const xeroAccountsQuery = useQuery({
    queryKey: ["xero-accounts"],
    queryFn: async () => {
      const response = await fetch("/api/xero/accounts");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load Xero accounts.");
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
        itemType: "material" as const,
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
  const supplierOptionsSorted = [...suppliers].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const initialFormValues: PurchaseOrderFormValues = initialData
    ? {
        supplierId: initialData.supplierId,
        expectedDate: initialData.expectedDate,
        shippingCost: initialData.shippingCost,
        notes: initialData.notes,
        accountingPurchaseAccountCode: null,
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
          accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
          ...EMPTY_DELIVERY_ADDRESS,
        })),
        additionalCosts: initialData.additionalCosts,
      }
    : {
        ...(defaultValues ?? purchaseOrderDefaultValues),
        accountingPurchaseAccountCode: null,
        shipLine1: defaultValues?.shipLine1 ?? null,
        shipLine2: defaultValues?.shipLine2 ?? null,
        shipCity: defaultValues?.shipCity ?? null,
        shipRegion: defaultValues?.shipRegion ?? null,
        shipPostcode: defaultValues?.shipPostcode ?? null,
        shipCountry: defaultValues?.shipCountry ?? null,
        lines: (defaultValues ?? purchaseOrderDefaultValues).lines.map(
          (line) => ({
            ...line,
            ...EMPTY_DELIVERY_ADDRESS,
          }),
        ),
      };

  const persistPurchaseOrder = useCallback(
    async (orderId: string | null, values: PurchaseOrderFormValues) => {
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

      return body as { id: string; orderNumber: string };
    },
    [],
  );

  const purchaseOrderEngine = useDraftSaveEngine<
    PurchaseOrderFormValues,
    PurchaseOrderDraftOp,
    { id: string; orderNumber: string }
  >({
    initialDraft: initialFormValues,
    initialId: initialData?.id ?? null,
    isSaveable: hasAutosaveMinimum,
    applyOp: (draft, op) => ({ ...draft, ...op.patch }),
    coalesceOps: (existing, next) => [
      {
        op: {
          type: "patch",
          patch: existing.reduce<Partial<PurchaseOrderFormValues>>(
            (patch, queued) => ({ ...patch, ...queued.op.patch }),
            next.op.patch,
          ),
        },
        revision: next.revision,
      },
    ],
    create: (draft) => persistPurchaseOrder(null, draft),
    save: (orderId, draft, ops) => {
      if (ops.length === 0) return Promise.resolve(null);
      return persistPurchaseOrder(orderId, draft);
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft) => draft,
    mergeServerOwnedFields: (draft) => draft,
    onPersisted: (id) => {
      savedOrderIdRef.current = id;
      setSavedOrderId(id);
      reflectPersistedCardUrlWithoutNavigation(`/purchasing/order/${id}`);
    },
    onResult: (result) => {
      savedOrderIdRef.current = result.id;
      setSavedOrderId(result.id);
      setSavedOrderNumber(result.orderNumber);
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    getErrorMessage: (error) =>
      (error as ApiError)?.error ??
      (error instanceof Error ? error.message : "Failed to save purchase order."),
  });
  const draftValues = purchaseOrderEngine.draft;
  const commitPurchaseOrderDraft = useCallback(
    (patch: Partial<PurchaseOrderFormValues>, delayMs = 1200) => {
      setFormError(null);
      purchaseOrderEngine.applyLocalOp({ type: "patch", patch }, delayMs);
    },
    [purchaseOrderEngine],
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
    for (const option of collectDeliveryAddressOptions(initialFormValues)) {
      byId.set(option.id, option);
    }
    return [...byId.values()];
  });
  const [addressDialogState, setAddressDialogState] = useState<{
    option: DeliveryAddressOption | null;
  } | null>(null);
  const [initialLineRows] = useState(() =>
    toPurchaseOrderLineGridRows(initialFormValues.lines),
  );
  const [lineGridRows, setLineGridRows] =
    useState<PurchaseOrderLineGridRow[]>(initialLineRows);
  const [initialAdditionalCostRows] = useState(() =>
    toPurchaseOrderAdditionalCostGridRows(initialFormValues.additionalCosts),
  );
  const [additionalCostGridRows, setAdditionalCostGridRows] = useState<
    PurchaseOrderAdditionalCostGridRow[]
  >(initialAdditionalCostRows);

  const watchedSupplierId = draftValues.supplierId;
  const watchedShippingCost = draftValues.shippingCost;
  const watchedAdditionalCosts = draftValues.additionalCosts;
  const watchedNotes = draftValues.notes;
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
        legacyShippingCost: watchedShippingCost,
      }),
    [lineGridRows, materialMap, watchedAdditionalCosts, watchedShippingCost],
  );
  const materialsTotal = landedCostPreview.materialSubtotal;
  const distributedAdditionalCostTotal =
    landedCostPreview.distributedAdditionalCostTotal;
  const nonDistributedAdditionalCostTotal =
    landedCostPreview.nonDistributedAdditionalCostTotal;
  const orderTotal = landedCostPreview.orderTotal;
  const lineCount = lineGridRows.filter(
    (line) => !isBlankPurchaseOrderLine(line),
  ).length;
  const additionalCostCount = additionalCostRows.filter(
    (cost) => !isBlankPurchaseOrderAdditionalCost(cost),
  ).length;
  const canAutosaveDraft = Boolean(watchedSupplierId?.trim());
  const xeroAccountsByCode = useMemo(
    () => new Map(xeroAccounts.map((account) => [account.code, account])),
    [xeroAccounts],
  );
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

    return [
      {
        field: "itemId",
        kind: "inventory-item",
        headerName: "Material",
        headerTooltip: PURCHASE_MATERIAL_TOOLTIP,
        minWidth: 220,
        flex: 1.55,
        editable: (data) => !readOnly && !receivedMaterialIds.has(data?.itemId ?? ""),
        options: materialOptions,
        placeholder: "Search materials...",
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
        ],
        getSecondaryText: (current) =>
          [current.sku, (current as PurchaseOrderMaterialOption).stockingUnitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          const materialId = normalizeGridText(params.newValue);
          const material = materialMap.get(materialId);
          params.data.itemId = materialId;
          params.data.unitCost = material?.defaultPurchasePrice ?? "0";
          params.data.accountingPurchaseAccountCode =
            material?.accountingPurchaseAccountCode ?? null;
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
        field: "quantityOrdered",
        kind: "number",
        headerName: "Ordered Qty",
        headerTooltip: PO_ORDERED_QTY_TOOLTIP,
        minWidth: 116,
        flex: 0.5,
        editable: !readOnly,
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
        minWidth: 118,
        flex: 0.55,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseUnitCell {...params} materialMap={materialMap} />,
      },
      {
        field: "unitCost",
        kind: "number",
        headerName: "Unit Cost",
        headerTooltip: PURCHASE_UNIT_COST_TOOLTIP,
        minWidth: 128,
        flex: 0.55,
        editable: !readOnly,
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
        colId: "landedUnit",
        kind: "display",
        headerName: "Landed/Unit",
        headerTooltip: PURCHASE_LANDED_UNIT_TOOLTIP,
        minWidth: 136,
        flex: 0.7,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => (
          <PurchaseLandedUnitCell
            {...params}
            materialMap={materialMap}
            landedCosts={landedCostPreview.lines}
          />
        ),
      },
      {
        field: "accountingPurchaseAccountCode",
        kind: "select",
        headerName: "Account",
        headerTooltip: PURCHASE_ACCOUNT_TOOLTIP,
        minWidth: 132,
        flex: 0.55,
        editable: !readOnly,
        values: ["", ...xeroAccounts.map((account) => account.code)],
        valueFormatter: ({ value }) => {
          if (!value) return "";
          const account = xeroAccountsByCode.get(value);
          return account ? `${account.code} - ${account.name}` : value;
        },
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.accountingPurchaseAccountCode = normalizeNullableGridText(
            params.newValue,
          );
          return true;
        },
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError(
            "accountingPurchaseAccountCode",
          ),
        },
        tooltipValueGetter: cellTooltip("accountingPurchaseAccountCode"),
      },
      {
        colId: "lineTotal",
        kind: "display",
        headerName: "Line Total",
        headerTooltip: PO_LINE_TOTAL_TOOLTIP,
        minWidth: 128,
        flex: 0.55,
        cellRenderer: PurchaseLineTotalCell,
      },
    ];
  }, [
    fieldErrors.lines,
    landedCostPreview.lines,
    lineGridRows,
    materialMap,
    materialOptions,
    receivedMaterialIds,
    readOnly,
    xeroAccounts,
    xeroAccountsByCode,
  ]);
  const handleLineRowsChange = useCallback(
    (rows: PurchaseOrderLineGridRow[]) => {
      setLineGridRows(rows);
      commitPurchaseOrderDraft({
        lines: toPurchaseOrderLinePayloadRows(rows),
      });
    },
    [commitPurchaseOrderDraft],
  );
  const createLineRow = useCallback(() => createPurchaseOrderLineRow(), []);
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
        editable: !readOnly,
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
        editable: !readOnly,
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
        editable: !readOnly,
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
        field: "accountingPurchaseAccountCode",
        kind: "select",
        headerName: "Accounting Account",
        headerTooltip: PURCHASE_ACCOUNT_TOOLTIP,
        minWidth: 164,
        flex: 0.95,
        editable: !readOnly,
        values: ["", ...xeroAccounts.map((account) => account.code)],
        valueFormatter: ({ value }) => {
          if (!value) return "";
          const account = xeroAccountsByCode.get(value);
          return account ? `${account.code} - ${account.name}` : value;
        },
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          params.data.accountingPurchaseAccountCode = normalizeNullableGridText(
            params.newValue,
          );
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
        editable: !readOnly,
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
    readOnly,
    xeroAccounts,
    xeroAccountsByCode,
  ]);
  const handleAdditionalCostRowsChange = useCallback(
    (rows: PurchaseOrderAdditionalCostGridRow[]) => {
      setAdditionalCostGridRows(rows);
      commitPurchaseOrderDraft({
        additionalCosts: toPurchaseOrderAdditionalCostPayloadRows(rows),
      });
    },
    [commitPurchaseOrderDraft],
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
      if (!savedOrderId) throw new Error("Save the purchase order first.");
      const response = await fetch(
        `/api/purchase-orders/${savedOrderId}/status`,
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

  const ensureSavedOrder = async () => {
    await purchaseOrderEngine.flush();
    const orderId = savedOrderIdRef.current;
    if (!orderId) {
      const message =
        purchaseOrderEngine.error ??
        firstFieldErrorMessage(fieldErrors) ??
        "Choose a supplier before uploading files.";
      setFormError(message);
      throw new Error(message);
    }
    return orderId;
  };

  const handleFileInput = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      const orderId = await ensureSavedOrder();
      for (const file of Array.from(files)) {
        uploadFileMutation.mutate({ orderId, file });
      }
    } catch (error) {
      setFileActionError(
        error instanceof Error
          ? error.message
          : "Save the purchase order before uploading files.",
      );
    }
  };

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
    commitPurchaseOrderDraft(nextAddress);
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
  const currentDeliveryAddress: DeliveryAddressFields = {
    shipLine1: draftValues.shipLine1,
    shipLine2: draftValues.shipLine2,
    shipCity: draftValues.shipCity,
    shipRegion: draftValues.shipRegion,
    shipPostcode: draftValues.shipPostcode,
    shipCountry: draftValues.shipCountry,
  };
  const autosaveState = canAutosaveDraft ? purchaseOrderEngine.status : "idle";
  const autosaveMessage = canAutosaveDraft
    ? purchaseOrderEngine.status === "saved" || purchaseOrderEngine.status === "idle"
      ? "All changes saved"
      : purchaseOrderEngine.error
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
      recordNumber={savedOrderNumber ?? ""}
      name={selectedSupplier?.name ?? null}
    />
  ) : (
    "New purchase order"
  );
  const materialColumns = lineColumns.map((column) => {
    if (column.field === "itemId") return { ...column, headerName: "Item" };
    if (column.field === "quantityOrdered")
      return { ...column, headerName: "Quantity" };
    if (column.field === "unitCost")
      return { ...column, headerName: "Price per unit" };
    if (column.colId === "lineTotal")
      return { ...column, headerName: "Total price" };
    if (column.colId === "landedUnit")
      return { ...column, headerName: "Landed cost" };
    return column;
  });
  const totalUnits = lineGridRows.reduce((sum, line) => {
    const quantity = parsePositive(line.quantityOrdered);
    return sum + (quantity ?? 0);
  }, 0);

  return (
    <>
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
          saveState={cardSaveState}
          saveMessage={cardSaveMessage}
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
          {xeroAccountsQuery.error ? (
            <CardSection>
              <FieldError>
                {xeroAccountsQuery.error instanceof Error
                  ? xeroAccountsQuery.error.message
                  : "Failed to load Xero accounts."}
              </FieldError>
            </CardSection>
          ) : null}

          <>
            <CardSection title="Order details">
              <div className={`${styles.formRow} ${styles.formRowPo}`}>
                <div className={styles.formField}>
                  <SupplierSelect
                    suppliers={supplierOptionsSorted}
                    value={draftValues.supplierId}
                    onValueChange={(nextValue) =>
                      commitPurchaseOrderDraft({ supplierId: nextValue ?? "" })
                    }
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
                  <Field data-invalid={Boolean(fieldErrors.expectedDate)}>
                    <FieldLabel className={styles.formLabel} htmlFor="expectedDate">
                      Expected arrival <span className={styles.requiredMark}>*</span>
                    </FieldLabel>
                    {readOnly ? (
                      <div className={`${styles.readOnlyFieldValue} ${styles.mono}`}>
                        {draftValues.expectedDate ? formatDate(draftValues.expectedDate) : "—"}
                      </div>
                    ) : (
                      <DatePicker
                        id="expectedDate"
                        value={draftValues.expectedDate ?? ""}
                        onChange={(value) => commitPurchaseOrderDraft({ expectedDate: value || null })}
                        aria-invalid={Boolean(fieldErrors.expectedDate)}
                        className={styles.underlineControl}
                      />
                    )}
                    {fieldErrors.expectedDate ? (
                      <FieldError>{fieldErrorMessage(fieldErrors.expectedDate)}</FieldError>
                    ) : null}
                  </Field>
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
                    readOnly={readOnly}
                  />
                </div>
              </div>
            </CardSection>

            <CardSection title="Materials" count={`· ${lineCount}`}>
              <MutableLines
                rows={lineGridRows}
                fields={materialColumns}
                getRowId={getLineRowId}
                createRow={createLineRow}
                onRowsChange={handleLineRowsChange}
                addLabel="Add material"
                readOnly={readOnly}
                canDeleteRow={(row) => !receivedMaterialIds.has(row.itemId ?? "")}
                getDeleteDisabledReason={(row) =>
                  receivedMaterialIds.has(row.itemId ?? "")
                    ? "Received material lines cannot be removed. Increase or reduce the ordered quantity instead."
                    : null
                }
                emptyMessage="No materials yet."
                error={linesError}
              />
            </CardSection>

            <CardSection title="Additional costs" count={`· ${additionalCostCount}`}>
              <MutableLines
                rows={additionalCostGridRows}
                fields={additionalCostColumns}
                getRowId={getAdditionalCostRowId}
                createRow={createAdditionalCostRow}
                onRowsChange={handleAdditionalCostRowsChange}
                addLabel="Add cost"
                readOnly={readOnly}
                emptyMessage="No additional costs yet."
                error={additionalCostsError}
              />
            </CardSection>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <CardSection
                title="Notes"
                actions={
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Attachments"
                    title="Attachments"
                    onClick={() => setAttachmentsOpen(true)}
                  >
                    <HugeiconsIcon icon={Attachment01Icon} size={14} />
                  </button>
                }
              >
                <NotesField
                  label="Notes"
                  value={watchedNotes ?? ""}
                  disabled={readOnly}
                  readOnlyValue={readOnly}
                  rows={6}
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
                      label: "Total",
                      value: formatPrice(orderTotal.toFixed(4)) ?? "$0.00",
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
      <Dialog open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>Attachments</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleFileInput(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {!readOnly ? (
              <div
                className="flex items-center justify-center gap-2 border border-dashed bg-muted/30 px-3 py-5 text-sm text-muted-foreground"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFileInput(event.dataTransfer.files);
                }}
              >
                <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden />
                <button
                  type="button"
                  className="font-medium text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    uploadFileMutation.isPending || purchaseOrderEngine.status === "saving"
                  }
                >
                  Upload or drop files
                </button>
              </div>
            ) : null}
            {fileActionError ? (
              <p className="text-sm text-destructive">{fileActionError}</p>
            ) : null}
            <div className="divide-y border">
              {attachments.length > 0 ? (
                attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 px-3 py-2.5"
                  >
                    <FileTypeBadge file={file} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {file.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(file.sizeBytes)}
                      </p>
                    </div>
                    {savedOrderId ? (
                      <Button variant="ghost" size="icon-sm" asChild>
                        <a
                          href={`/api/purchase-orders/${savedOrderId}/files/${file.id}`}
                          aria-label={`Download ${file.filename}`}
                        >
                          <HugeiconsIcon icon={Download01Icon} />
                        </a>
                      </Button>
                    ) : null}
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${file.filename}`}
                        onClick={() => deleteFileMutation.mutate(file.id)}
                        disabled={deleteFileMutation.isPending}
                      >
                        <HugeiconsIcon icon={Delete02Icon} />
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="px-3 py-5 text-center text-sm text-muted-foreground">
                  No attachments.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
                      Delivery Instructions
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
        <div className={styles.readOnlyAddress}>
          {addressLines.length > 0
            ? addressLines.map((line) => <div key={line}>{line}</div>)
            : "No delivery address set"}
        </div>
      ) : (
      <Combobox
        items={items}
        value={currentAddressId}
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
            const option = optionMap.get(currentAddressId);
            if (option) onEdit(option);
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
