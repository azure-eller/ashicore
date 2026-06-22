import {
  type PurchaseOrderAdditionalCostDistributionMethod,
  type PurchaseOrderAdditionalCostType,
} from "@/lib/schemas/purchase-orders";
import { formatAddressLines, normalizeAddressFields } from "@/lib/addresses";
import {
  formatPrice,
  parsePositive,
} from "@/lib/format";
import type {
  PurchaseOrderTaxRateOption,
} from "@/lib/purchasing/types";
import {
  type PurchaseOrderAdditionalCostDraftRow,
  type PurchaseOrderFormValues,
  type PurchaseOrderLineDraftRow,
} from "./use-purchase-order-draft-controller";

export type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

export type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
  class: string | null;
};

export type PurchaseOrderFormAttachment = {
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

export const ACCOUNTING_NOT_CONNECTED_MESSAGE =
  "Connect accounting software before creating supplier bills.";
export const ADD_DELIVERY_ADDRESS_VALUE = "__add_delivery_address__";
export const EDIT_DELIVERY_ADDRESS_VALUE = "__edit_delivery_address__";
export const EMPTY_DELIVERY_ADDRESS = {
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
export const LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY =
  "purchasing.purchaseOrder.lastSupplierByMaterial";
export const LEGACY_LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY =
  "purchasing.purchaseOrder.lastCarrierByMaterial";

export const ADDITIONAL_COST_TYPE_LABELS: Record<
  PurchaseOrderAdditionalCostType,
  string
> = {
  shipping: "Shipping",
  customs: "Customs",
  other: "Other",
};

export const ADDITIONAL_COST_DISTRIBUTION_LABELS: Record<
  PurchaseOrderAdditionalCostDistributionMethod,
  string
> = {
  by_value: "By value",
  not_distributed: "Not distributed",
};

export const blankPurchaseOrderLine = {
  itemId: "",
  quantityOrdered: null,
  unitCost: null,
  taxRateId: null,
  accountingPurchaseAccountCode: null,
  ...EMPTY_DELIVERY_ADDRESS,
};

export const blankPurchaseOrderAdditionalCost = {
  costType: "shipping" as const,
  reference: null,
  supplierId: null,
  distributionMethod: "by_value" as const,
  accountingPurchaseAccountCode: null,
  amount: null,
};

export type PurchaseOrderAdditionalCostPayloadRow = NonNullable<
  PurchaseOrderFormValues["additionalCosts"]
>[number];
export type PurchaseOrderAdditionalCostGridRow = PurchaseOrderAdditionalCostDraftRow;
export type PurchaseOrderAdditionalCostColumnKey =
  keyof PurchaseOrderAdditionalCostPayloadRow;
export type PurchaseOrderLinePayloadRow = PurchaseOrderFormValues["lines"][number];
export type PurchaseOrderLineGridRow = PurchaseOrderLineDraftRow;
export type PurchaseOrderLineColumnKey =
  | "itemId"
  | "quantityOrdered"
  | "unitCost";

export function isBlankPurchaseOrderLine(
  line: Omit<PurchaseOrderFormValues["lines"][number], "id"> | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
}

export function createPurchaseOrderLineRow(
  values?: Partial<PurchaseOrderLineGridRow>,
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

export function isBlankPurchaseOrderAdditionalCost(
  cost:
    | Omit<NonNullable<PurchaseOrderFormValues["additionalCosts"]>[number], "id">
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

// Mirrors the payload filter in toPurchaseOrderAdditionalCostPayloadRows, so
// error paths (additionalCosts.N.*) index the same rows the validator saw.
export function hasPurchaseOrderAdditionalCostAmount(
  cost: { amount?: string | null } | null | undefined,
) {
  return Boolean(cost?.amount?.trim());
}

export function createPurchaseOrderAdditionalCostRow(
  values?: Partial<PurchaseOrderAdditionalCostGridRow>,
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
    supplierId:
      values?.supplierId ??
      blankPurchaseOrderAdditionalCost.supplierId,
    distributionMethod:
      values?.distributionMethod ??
      blankPurchaseOrderAdditionalCost.distributionMethod,
    accountingPurchaseAccountCode:
      values?.accountingPurchaseAccountCode ??
      blankPurchaseOrderAdditionalCost.accountingPurchaseAccountCode,
    amount: values?.amount ?? blankPurchaseOrderAdditionalCost.amount,
  };
}

export function normalizeGridText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

export function normalizeNullableGridText(value: unknown) {
  const text = normalizeGridText(value);
  return text === "" ? null : text;
}

export function validateNonNegativeMoneyCell(value: unknown, message: string) {
  const text = normalizeGridText(value);
  if (text === "") return [message];
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? null : [message];
}

export function parseNonNegative(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function lineTotalLabel(
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

export function lineTotalBeforeTax(
  quantityOrdered: string | null | undefined,
  unitCost: string | null | undefined,
) {
  const quantity = parsePositive(quantityOrdered);
  const cost = parseNonNegative(unitCost);
  if (quantity == null || cost == null) return null;
  return quantity * cost;
}

export function todayIsoDate() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

export type DeliveryAddressFields = {
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

export type DeliveryAddressOption = Required<DeliveryAddressFields> & {
  id: string;
  label: string;
  addressEntryId: string | null;
  notes: string | null;
};

export type AddressEntry = {
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

export type AddressDialogValues = {
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

export type AdditionalCostSupplierDialogValues = {
  name: string;
  contactName: string | null;
  email: string | null;
};

export const ADDRESS_DIALOG_FIELD_NAMES = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;

export const EMPTY_ADDRESS_DIALOG_VALUES: AddressDialogValues = {
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

export const EMPTY_ADDITIONAL_COST_SUPPLIER_DIALOG_VALUES: AdditionalCostSupplierDialogValues = {
  name: "",
  contactName: null,
  email: null,
};

export function normalizeDeliveryAddress(
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

export function deliveryAddressKey(address: DeliveryAddressFields | undefined) {
  const normalized = normalizeDeliveryAddress(address);
  if (normalized.shipAddressEntryId)
    return `address:${normalized.shipAddressEntryId}`;
  return deliveryAddressContentKey(normalized);
}

/**
 * Stable key for matching nonblank copied PO addresses to saved address entries.
 * An empty result means the PO has no delivery address and must stay unmatched.
 */
export function deliveryAddressContentKey(address: DeliveryAddressFields | undefined) {
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

export function deliveryAddressLabel(address: DeliveryAddressFields) {
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

export function makeDeliveryAddressOption(
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

export function addressEntryToOption(
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

export function collectDeliveryAddressOptions(values: {
  shipAddressEntryId?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
  lines?: Array<DeliveryAddressFields>;
}) {
  const options = new Map<string, DeliveryAddressOption>();
  const candidates: DeliveryAddressFields[] = [values, ...(values.lines ?? [])];

  for (const candidate of candidates) {
    const option = makeDeliveryAddressOption(candidate);
    if (option) options.set(option.id, option);
  }

  return [...options.values()];
}

export function deliveryInfoNote(instructions: string) {
  const value = instructions.trim();
  if (!value) return null;
  if (/^delivery info:/i.test(value)) return value;
  return `Delivery info:\n${value}`;
}
