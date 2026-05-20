"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type {
  CellClassParams,
  ICellEditorParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import type { CustomCellEditorProps } from "ag-grid-react";
import { useGridCellEditor } from "ag-grid-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Attachment01Icon,
  Delete02Icon,
  Download01Icon,
  Cancel01Icon,
  MoreVerticalIcon,
  PrinterIcon,
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
  formatAddressLines,
  getFieldArrayError,
  getFirstFormErrorMessage,
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
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import {
  EditableLineDataGrid,
  type ColDef,
} from "@/components/editable-line-data-grid";
import { EditableInfoGrid } from "@/components/editable-info-grid";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { AutosaveStatus } from "@/components/autosave-status";
import { TooltipHeader } from "@/components/tooltip-header";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import { useAutosaveForm } from "@/lib/hooks/use-autosave-form";
import {
  EXPECTED_DELIVERY_DATE_TOOLTIP,
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
import { PurchaseOrderStatusBadge } from "./status-badge";
import styles from "@/components/card-page/card-page.module.css";

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
  const gridRows = (rows ?? []).map((row) => createPurchaseOrderLineRow(row));
  return gridRows.length > 0 ? gridRows : [createPurchaseOrderLineRow()];
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

function comparablePurchaseOrderLines(rows: PurchaseOrderLineGridRow[]) {
  return JSON.stringify(toPurchaseOrderLinePayloadRows(rows));
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

function comparablePurchaseOrderAdditionalCosts(
  rows: PurchaseOrderAdditionalCostGridRow[],
) {
  return JSON.stringify(toPurchaseOrderAdditionalCostPayloadRows(rows));
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

function PurchaseMaterialCellEditor(
  props: CustomCellEditorProps<PurchaseOrderLineGridRow, string | null> & {
    options: Array<
      PurchaseOrderMaterialOption & {
        displayName: string;
        itemType: "material";
        unitName: string;
      }
    >;
  },
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<string | null>(props.value ?? null);

  useGridCellEditor({
    getValidationElement: () => editorRef.current ?? props.eGridCell,
    getValidationErrors: () => {
      const row = {
        ...props.data,
        itemId: valueRef.current ?? "",
      };
      if (isBlankPurchaseOrderLine(row)) return null;
      return valueRef.current ? null : ["Material is required"];
    },
  });

  return (
    <div ref={editorRef} className="flex h-full w-full items-center">
      <InventoryItemCombobox
        options={props.options}
        value={props.value ?? ""}
        defaultOpen
        onValueChange={(id) => {
          valueRef.current = id ?? "";
          props.onValueChange(id ?? "");
          if (id) {
            props.stopEditing(true);
          }
        }}
        inputAriaInvalid={false}
        inputClassName="h-full w-full min-w-0 border-0 bg-transparent shadow-none"
        placeholder="Search materials..."
        emptyMessage="No materials found"
        contentClassName="w-[min(32rem,calc(100vw-2rem))]"
        createLinks={[
          {
            href: "/inventory/material",
            label: "Create material",
          },
        ]}
        getSecondaryText={(current) =>
          [current.sku, current.stockingUnitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · ")
        }
      />
    </div>
  );
}

function hasAutosaveMinimum(values: PurchaseOrderFormValues) {
  if (!values.supplierId?.trim()) return false;

  return (values.lines ?? []).some((line) => {
    if (!line?.itemId?.trim()) return false;
    if (parsePositive(line.quantityOrdered) == null) return false;
    return parseNonNegative(line.unitCost) != null;
  });
}

export function PurchaseOrderForm({
  suppliers,
  materials,
  addresses,
  initialData,
  defaultValues,
  orderTitle,
  canWrite = true,
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  addresses: AddressEntry[];
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
  orderTitle?: string | null;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackPath = initialData
    ? `/purchasing/orders/${initialData.id}`
    : "/purchasing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const savedOrderIdRef = useRef<string | null>(initialData?.id ?? null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(
    initialData?.id ?? null,
  );
  const [attachments, setAttachments] = useState<PurchaseOrderFormAttachment[]>(
    initialData?.attachments ?? [],
  );
  const xeroAccountsQuery = useQuery({
    queryKey: ["xero-accounts"],
    queryFn: async () => {
      const response = await fetch("/api/xero/accounts");
      if (!response.ok) return { accounts: [] as XeroAccountOption[] };
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
  const displayStatus = initialData?.status ?? "draft";
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

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(insertPurchaseOrderSchema),
    mode: "onBlur",
    defaultValues: initialFormValues,
  });
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
  const [initialLineComparable] = useState(() =>
    comparablePurchaseOrderLines(
      toPurchaseOrderLineGridRows(initialFormValues.lines),
    ),
  );
  const [lineGridRows, setLineGridRows] =
    useState<PurchaseOrderLineGridRow[]>(initialLineRows);
  const [initialAdditionalCostRows] = useState(() =>
    toPurchaseOrderAdditionalCostGridRows(initialFormValues.additionalCosts),
  );
  const [initialAdditionalCostComparable] = useState(() =>
    comparablePurchaseOrderAdditionalCosts(
      toPurchaseOrderAdditionalCostGridRows(initialFormValues.additionalCosts),
    ),
  );
  const [additionalCostGridRows, setAdditionalCostGridRows] = useState<
    PurchaseOrderAdditionalCostGridRow[]
  >(initialAdditionalCostRows);

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
  const watchedDeliveryAddress = useWatch({
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
  const canAutosaveDraft = hasAutosaveMinimum(form.getValues());
  const xeroAccountsByCode = useMemo(
    () => new Map(xeroAccounts.map((account) => [account.code, account])),
    [xeroAccounts],
  );
  const lineColumns = useMemo<ColDef<PurchaseOrderLineGridRow>[]>(() => {
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
                form.formState.errors.lines,
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
        const index = rowErrorIndex(data);
        return index >= 0
          ? getPurchaseOrderLineCellError(
              form.formState.errors.lines,
              index,
              key,
            )
          : null;
      };

    return [
      {
        field: "itemId",
        headerName: "Material",
        headerTooltip: PURCHASE_MATERIAL_TOOLTIP,
        minWidth: 220,
        flex: 1.55,
        editable: !readOnly,
        cellEditor: PurchaseMaterialCellEditor,
        cellEditorParams: {
          options: materialOptions,
        },
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
        headerName: "Ordered Qty",
        headerTooltip: PO_ORDERED_QTY_TOOLTIP,
        minWidth: 116,
        flex: 0.5,
        editable: !readOnly,
        cellEditor: "agTextCellEditor",
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.quantityOrdered = normalizeNullableGridText(
            params.newValue,
          );
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<PurchaseOrderLineGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              quantityOrdered: normalizeNullableGridText(value),
            };
            if (isBlankPurchaseOrderLine(row)) return null;
            const parsed = Number(row.quantityOrdered);
            return Number.isFinite(parsed) && parsed > 0
              ? null
              : ["Quantity must be greater than 0"];
          },
        },
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("quantityOrdered"),
        },
        tooltipValueGetter: cellTooltip("quantityOrdered"),
      },
      {
        colId: "purchaseUnit",
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
        headerName: "Unit Cost",
        headerTooltip: PURCHASE_UNIT_COST_TOOLTIP,
        minWidth: 128,
        flex: 0.55,
        editable: !readOnly,
        cellEditor: "agTextCellEditor",
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.unitCost = normalizeNullableGridText(params.newValue);
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<PurchaseOrderLineGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              unitCost: normalizeNullableGridText(value),
            };
            if (isBlankPurchaseOrderLine(row)) return null;
            const text = row.unitCost?.trim() ?? "";
            if (!text) return ["Unit cost is required"];
            const parsed = Number(text);
            return Number.isFinite(parsed) && parsed >= 0
              ? null
              : ["Unit cost must be 0 or greater"];
          },
        },
        valueFormatter: ({ value }) =>
          value == null || value === "" ? "" : (formatPrice(value) ?? value),
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("unitCost"),
        },
        tooltipValueGetter: cellTooltip("unitCost"),
      },
      {
        colId: "landedUnit",
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
        headerName: "Account",
        headerTooltip: PURCHASE_ACCOUNT_TOOLTIP,
        minWidth: 132,
        flex: 0.55,
        editable: !readOnly,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["", ...xeroAccounts.map((account) => account.code)],
          openEditorOnStart: true,
        },
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
        headerName: "Line Total",
        headerTooltip: PO_LINE_TOTAL_TOOLTIP,
        minWidth: 128,
        flex: 0.55,
        cellRenderer: PurchaseLineTotalCell,
      },
    ];
  }, [
    form.formState.errors.lines,
    landedCostPreview.lines,
    lineGridRows,
    materialMap,
    materialOptions,
    readOnly,
    xeroAccounts,
    xeroAccountsByCode,
  ]);
  const handleLineRowsChange = useCallback(
    (rows: PurchaseOrderLineGridRow[]) => {
      setLineGridRows(rows);
      const dirty =
        comparablePurchaseOrderLines(rows) !== initialLineComparable;
      form.setValue("lines", toPurchaseOrderLinePayloadRows(rows), {
        shouldDirty: dirty,
        shouldTouch: false,
        shouldValidate: false,
      });
    },
    [form, initialLineComparable],
  );
  const createLineRow = useCallback(() => createPurchaseOrderLineRow(), []);
  const getLineRowId = useCallback(
    (row: PurchaseOrderLineGridRow) => row.clientRowId,
    [],
  );
  const additionalCostColumns = useMemo<
    ColDef<PurchaseOrderAdditionalCostGridRow>[]
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
                form.formState.errors.additionalCosts,
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
              form.formState.errors.additionalCosts,
              index,
              key,
            )
          : null;
      };

    return [
      {
        field: "costType",
        headerName: "Cost",
        headerTooltip: PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
        minWidth: 128,
        flex: 0.75,
        editable: !readOnly,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: Object.keys(ADDITIONAL_COST_TYPE_LABELS),
          openEditorOnStart: true,
        },
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
        headerName: "Reference",
        headerTooltip: PURCHASE_COST_REFERENCE_TOOLTIP,
        minWidth: 172,
        flex: 1.25,
        editable: !readOnly,
        cellEditor: "agTextCellEditor",
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
        headerName: "Distribution",
        headerTooltip: PURCHASE_COST_DISTRIBUTION_TOOLTIP,
        minWidth: 148,
        flex: 0.8,
        editable: !readOnly,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: Object.keys(ADDITIONAL_COST_DISTRIBUTION_LABELS),
          openEditorOnStart: true,
        },
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
        headerName: "Accounting Account",
        headerTooltip: PURCHASE_ACCOUNT_TOOLTIP,
        minWidth: 164,
        flex: 0.95,
        editable: !readOnly,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["", ...xeroAccounts.map((account) => account.code)],
          openEditorOnStart: true,
        },
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
        headerName: "Amount",
        headerTooltip: PURCHASE_COST_AMOUNT_TOOLTIP,
        minWidth: 128,
        flex: 0.65,
        editable: !readOnly,
        cellEditor: "agTextCellEditor",
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
        cellEditorParams: {
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<PurchaseOrderAdditionalCostGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              amount: normalizeNullableGridText(value),
            };
            if (isBlankPurchaseOrderAdditionalCost(row)) return null;
            return validateNonNegativeMoneyCell(
              value,
              row.amount ? "Amount must be 0 or greater" : "Amount is required",
            );
          },
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
    form.formState.errors.additionalCosts,
    readOnly,
    xeroAccounts,
    xeroAccountsByCode,
  ]);
  const handleAdditionalCostRowsChange = useCallback(
    (rows: PurchaseOrderAdditionalCostGridRow[]) => {
      setAdditionalCostGridRows(rows);
      const dirty =
        comparablePurchaseOrderAdditionalCosts(rows) !==
        initialAdditionalCostComparable;
      form.setValue(
        "additionalCosts",
        toPurchaseOrderAdditionalCostPayloadRows(rows),
        {
          shouldDirty: dirty,
          shouldTouch: false,
          shouldValidate: false,
        },
      );
    },
    [form, initialAdditionalCostComparable],
  );
  const createAdditionalCostRow = useCallback(
    () => createPurchaseOrderAdditionalCostRow(),
    [],
  );
  const getAdditionalCostRowId = useCallback(
    (row: PurchaseOrderAdditionalCostGridRow) => row.clientRowId,
    [],
  );

  const savePurchaseOrder = useCallback(
    async (values: PurchaseOrderFormValues) => {
      const orderId = savedOrderIdRef.current;
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
        throw {
          error: body?.error ?? "Failed to save purchase order.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      const result = body as { id: string };
      savedOrderIdRef.current = result.id;
      setSavedOrderId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      return result;
    },
    [queryClient],
  );

  const mutation = useMutation({
    mutationFn: savePurchaseOrder,
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: (result) => {
      router.push(`/purchasing/orders/${result.id}`);
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

  const autosave = useAutosaveForm<
    PurchaseOrderFormValues,
    PurchaseOrderFormValues
  >({
    form,
    buildPayload: (values) => (hasAutosaveMinimum(values) ? values : null),
    save: async (values) => {
      setFormError(null);
      form.clearErrors();
      await savePurchaseOrder(values);
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

  const uploadFileMutation = useMutation({
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
      router.push(`/purchasing/orders/${order.id}`);
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const statusMutation = useMutation({
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      router.refresh();
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const ensureSavedOrder = async () => {
    const valid = await form.trigger();
    if (!valid) {
      const message =
        getFirstFormErrorMessage(form.formState.errors) ??
        "Complete the supplier and at least one line before uploading files.";
      setFormError(message);
      throw new Error(message);
    }

    const result = await savePurchaseOrder(form.getValues());
    return result.id;
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
  });

  const handleCancel = useSmartBack(fallbackPath);
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields.",
    );
  };

  const applyDeliveryAddress = (address: DeliveryAddressFields | null) => {
    const nextAddress = address
      ? normalizeDeliveryAddress(address)
      : EMPTY_DELIVERY_ADDRESS;
    form.setValue("shipLine1", nextAddress.shipLine1, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("shipLine2", nextAddress.shipLine2, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("shipCity", nextAddress.shipCity, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("shipRegion", nextAddress.shipRegion, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("shipPostcode", nextAddress.shipPostcode, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("shipCountry", nextAddress.shipCountry, {
      shouldDirty: true,
      shouldValidate: true,
    });
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

  const linesError = getFieldArrayError(form.formState.errors.lines);
  const additionalCostsError = getFieldArrayError(
    form.formState.errors.additionalCosts,
  );
  const selectedSupplier = supplierOptionsSorted.find(
    (supplier) => supplier.id === watchedSupplierId,
  );
  const currentDeliveryAddress: DeliveryAddressFields = {
    shipLine1: watchedDeliveryAddress?.[0] ?? null,
    shipLine2: watchedDeliveryAddress?.[1] ?? null,
    shipCity: watchedDeliveryAddress?.[2] ?? null,
    shipRegion: watchedDeliveryAddress?.[3] ?? null,
    shipPostcode: watchedDeliveryAddress?.[4] ?? null,
    shipCountry: watchedDeliveryAddress?.[5] ?? null,
  };
  const autosaveState = canAutosaveDraft ? autosave.state : "blocked";
  const autosaveMessage = canAutosaveDraft
    ? autosave.state === "saved" || autosave.state === "idle"
      ? "All changes saved"
      : autosave.message
    : "All changes saved";
  const displayTitle =
    orderTitle ??
    selectedSupplier?.name ??
    (isEditing
      ? `Purchase Order ${savedOrderId?.slice(0, 8) ?? ""}`
      : "New purchase order");
  const statusEyebrow =
    displayStatus === "draft" ? "New purchase order" : "Purchase order";
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
    <div className={styles.stage}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerIdentity}>
            <div className={styles.eyebrow}>{statusEyebrow}</div>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{displayTitle}</h1>
            </div>
            <div className={styles.meta}>
              <span>Supplier {selectedSupplier?.code ?? "not selected"}</span>
              <span className={styles.metaDot} />
              <span>
                Expected {form.getValues("expectedDate") ?? "not set"}
              </span>
              <span className={styles.metaDot} />
              <span className={styles.mono}>
                Total {formatPrice(orderTotal.toFixed(4)) ?? "$0.00"}
              </span>
            </div>
          </div>
          <div className={styles.headerRight}>
            <AutosaveStatus state={autosaveState} message={autosaveMessage} />
            <PurchaseOrderStatusBadge
              status={displayStatus}
              className="w-[230px]"
              disabled={!canWrite || !savedOrderId || statusMutation.isPending}
              onStatusChange={(status) => statusMutation.mutate(status)}
            />
            <Button
              type="submit"
              form="purchase-order-form"
              disabled={
                mutation.isPending ||
                readOnly ||
                autosave.state === "saving" ||
                autosave.state === "dirty"
              }
            >
              {mutation.isPending ? "Saving..." : "Save changes"}
            </Button>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Print"
              title="Print"
              onClick={() => window.print()}
            >
              <HugeiconsIcon icon={PrinterIcon} size={14} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label="More actions"
                  title="More actions"
                >
                  <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-popover text-popover-foreground"
              >
                <DropdownMenuItem
                  disabled={!savedOrderId || duplicateMutation.isPending}
                  onSelect={() => duplicateMutation.mutate()}
                >
                  Duplicate
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Close"
              onClick={handleCancel}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {formError && (
            <div className={styles.section}>
              <FieldError>{formError}</FieldError>
            </div>
          )}

          <form
            id="purchase-order-form"
            onSubmit={form.handleSubmit(
              (values) => mutation.mutate(values),
              handleInvalidSubmit,
            )}
          >
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Order details</h2>
              <EditableInfoGrid
                fields={[
                  {
                    id: "supplier",
                    label: "Supplier",
                    editable: !readOnly,
                    renderValue: () => selectedSupplier?.name ?? "-",
                    renderEditor: readOnly
                      ? undefined
                      : () => (
                          <Controller
                            control={form.control}
                            name="supplierId"
                            render={({ field, fieldState }) => (
                              <SupplierSelect
                                suppliers={supplierOptionsSorted}
                                value={field.value}
                                onValueChange={(nextValue) =>
                                  field.onChange(nextValue ?? "")
                                }
                                errorMessage={fieldState.error?.message}
                              />
                            )}
                          />
                        ),
                  },
                  {
                    id: "expected-arrival",
                    label: "Expected arrival",
                    editable: !readOnly,
                    renderValue: () => form.getValues("expectedDate") ?? "-",
                    renderEditor: readOnly
                      ? undefined
                      : () => (
                          <Controller
                            control={form.control}
                            name="expectedDate"
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel
                                  className={styles.compactLabel}
                                  htmlFor={field.name}
                                >
                                  <TooltipHeader
                                    label="Expected arrival"
                                    tooltip={EXPECTED_DELIVERY_DATE_TOOLTIP}
                                  />
                                </FieldLabel>
                                <DatePicker
                                  id={field.name}
                                  value={field.value ?? ""}
                                  onChange={(value) =>
                                    field.onChange(value || null)
                                  }
                                  onBlur={field.onBlur}
                                  aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                  <FieldError errors={[fieldState.error]} />
                                )}
                              </Field>
                            )}
                          />
                        ),
                  },
                  {
                    id: "order-total",
                    label: "Order total",
                    renderValue: () =>
                      formatPrice(orderTotal.toFixed(4)) ?? "$0.00",
                  },
                  {
                    id: "ship-to",
                    label: "Ship-to",
                    editable: !readOnly,
                    renderValue: () =>
                      formatAddressLines({
                        line1: currentDeliveryAddress.shipLine1,
                        line2: currentDeliveryAddress.shipLine2,
                        city: currentDeliveryAddress.shipCity,
                        region: currentDeliveryAddress.shipRegion,
                        postcode: currentDeliveryAddress.shipPostcode,
                        country: currentDeliveryAddress.shipCountry,
                      }).join(", ") || "-",
                    renderEditor: readOnly
                      ? undefined
                      : () => (
                          <DeliveryAddressInput
                            id="purchase-order-delivery-address"
                            value={currentDeliveryAddress}
                            options={deliveryAddressOptions}
                            onChange={applyDeliveryAddress}
                            onAddNew={openAddressDialog}
                            onEdit={openEditAddressDialog}
                          />
                        ),
                  },
                  {
                    id: "ordered",
                    label: "Ordered",
                    renderValue: () =>
                      displayStatus === "draft" ? "-" : "Recorded",
                  },
                  {
                    id: "received",
                    label: "Received",
                    renderValue: () =>
                      displayStatus === "received"
                        ? "Complete"
                        : displayStatus === "partial"
                          ? "Partial"
                          : "-",
                  },
                ]}
                columns={3}
              />
              <input type="hidden" {...form.register("shippingCost")} />
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>
                Materials
                <span className={styles.count}>· {lineCount}</span>
              </h2>
              <EditableLineDataGrid
                rows={lineGridRows}
                columns={materialColumns}
                getRowId={getLineRowId}
                createRow={createLineRow}
                onRowsChange={handleLineRowsChange}
                addLabel="Add material"
                rowHeight={42}
                enableAddRow={!readOnly}
                enableDelete={!readOnly}
                emptyMessage="No materials yet."
                isBlankRow={isBlankPurchaseOrderLine}
                error={linesError}
              />
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>
                Additional costs
                <span className={styles.count}>· {additionalCostCount}</span>
              </h2>
              <EditableLineDataGrid
                rows={additionalCostGridRows}
                columns={additionalCostColumns}
                getRowId={getAdditionalCostRowId}
                createRow={createAdditionalCostRow}
                onRowsChange={handleAdditionalCostRowsChange}
                addLabel="Add cost"
                rowHeight={42}
                enableAddRow={!readOnly}
                enableDelete={!readOnly}
                emptyMessage="No additional costs yet."
                isBlankRow={isBlankPurchaseOrderAdditionalCost}
                error={additionalCostsError}
              />
            </section>

            <section className={styles.section}>
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className={styles.sectionHeading}>Notes</h2>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="Attachments"
                      title="Attachments"
                      onClick={() => setAttachmentsOpen(true)}
                    >
                      <HugeiconsIcon icon={Attachment01Icon} size={14} />
                    </button>
                  </div>
                  <Controller
                    control={form.control}
                    name="notes"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel
                          className={styles.compactLabel}
                          htmlFor={field.name}
                        >
                          Notes
                        </FieldLabel>
                        <Textarea
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          onChange={(event) =>
                            field.onChange(event.target.value || null)
                          }
                          disabled={readOnly}
                          aria-invalid={fieldState.invalid}
                          rows={6}
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                </div>
                <div className="border-l border-border pl-6">
                  <h2 className={styles.sectionHeading}>Totals</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Total units</span>
                      <span className={styles.mono}>
                        {Number.isInteger(totalUnits)
                          ? totalUnits.toString()
                          : totalUnits.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className={styles.mono}>
                        {formatPrice(materialsTotal.toFixed(4)) ?? "$0.00"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        Additional costs
                      </span>
                      <span className={styles.mono}>
                        {formatPrice(
                          (
                            distributedAdditionalCostTotal +
                            nonDistributedAdditionalCostTotal
                          ).toFixed(4),
                        ) ?? "$0.00"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
                      <span>Total</span>
                      <span className={styles.mono}>
                        {formatPrice(orderTotal.toFixed(4)) ?? "$0.00"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </form>
        </div>
      </div>
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
                    uploadFileMutation.isPending || autosave.state === "saving"
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
    </div>
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
}: {
  id: string;
  label?: ReactNode;
  value: DeliveryAddressFields | undefined;
  options: DeliveryAddressOption[];
  onChange: (address: DeliveryAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (address: DeliveryAddressOption) => void;
}) {
  const currentAddressId = deliveryAddressKey(value);
  const canEditCurrent = currentAddressId !== "";
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = canEditCurrent
    ? [...optionIds, EDIT_DELIVERY_ADDRESS_VALUE, ADD_DELIVERY_ADDRESS_VALUE]
    : [...optionIds, ADD_DELIVERY_ADDRESS_VALUE];

  return (
    <Field>
      <FieldLabel className={label ? undefined : "sr-only"} htmlFor={id}>
        {label ?? "Delivery Address"}
      </FieldLabel>
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
          className="w-full min-w-0"
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
    </Field>
  );
}
