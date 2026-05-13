"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Download01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import {
  type InsertPurchaseOrder,
  type PurchaseOrderAdditionalCostDistributionMethod,
  type PurchaseOrderAdditionalCostType,
  insertPurchaseOrderSchema,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
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
import { AutosaveStatus } from "@/components/autosave-status";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  SortableDragHandle,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/address-fields";
import { useAutosaveForm } from "@/lib/hooks/use-autosave-form";
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

const PURCHASE_ORDER_LINE_GRID_COLUMNS =
  "2.25rem 2.25rem minmax(14rem, 1.4fr) minmax(5.5rem, 0.5fr) minmax(7rem, 0.65fr) minmax(7.5rem, 0.65fr) minmax(12rem, 1fr) minmax(7rem, 0.6fr) minmax(6.5rem, 0.5fr) minmax(6.5rem, 0.55fr) minmax(6.5rem, 0.55fr) minmax(7.5rem, 0.7fr)";
const PURCHASE_ORDER_COST_GRID_COLUMNS =
  "2.25rem minmax(8rem, 0.75fr) minmax(12rem, 1.25fr) minmax(9rem, 0.8fr) minmax(8rem, 0.75fr) minmax(7rem, 0.65fr) 2.25rem";
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
  ...EMPTY_DELIVERY_ADDRESS,
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
  const address = normalizeDeliveryAddress(line);
  return (
    itemId === "" &&
    quantityOrdered === "" &&
    unitCost === "" &&
    xeroPurchaseAccountCode === "" &&
    deliveryAddressKey(address) === ""
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
  address: DeliveryAddressFields | undefined
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
  if (normalized.shipAddressEntryId) return `address:${normalized.shipAddressEntryId}`;
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
  notes?: string | null
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

function addressEntryToOption(entry: AddressEntry): DeliveryAddressOption | null {
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
    entry.notes
  );
}

function collectDeliveryAddressOptions(values: PurchaseOrderFormValues) {
  const options = new Map<string, DeliveryAddressOption>();
  const candidates: DeliveryAddressFields[] = [
    values,
    ...(values.lines ?? []),
  ];

  for (const candidate of candidates) {
    const option = makeDeliveryAddressOption(candidate);
    if (option) options.set(option.id, option);
  }

  return [...options.values()];
}

function moneyLabel(value: number | null | undefined) {
  if (value == null) return "\u2014";
  return formatPrice(value.toFixed(4)) ?? "\u2014";
}

function landedStockUnitCostLabel(
  value: number | null | undefined,
  stockingUnitName: string | null | undefined
) {
  if (value == null) return "\u2014";
  return `${formatPrice(normalizeLandedDisplayNumber(value)) ?? "\u2014"} / ${
    stockingUnitName ?? "stock unit"
  }`;
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
}: {
  suppliers: SupplierOption[];
  materials: PurchaseOrderMaterialOption[];
  addresses: AddressEntry[];
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
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
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const savedOrderIdRef = useRef<string | null>(initialData?.id ?? null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(
    initialData?.id ?? null
  );
  const [attachments, setAttachments] = useState<PurchaseOrderFormAttachment[]>(
    initialData?.attachments ?? []
  );
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
  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials]
  );
  const supplierOptionsSorted = [...supplierOptions].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const initialFormValues: PurchaseOrderFormValues = initialData
    ? {
          supplierId: initialData.supplierId,
          expectedDate: initialData.expectedDate,
          shippingCost: initialData.shippingCost,
          notes: initialData.notes,
          xeroPurchaseAccountCode: null,
          ...EMPTY_DELIVERY_ADDRESS,
          lines: initialData.lines.map((line) => ({
            itemId: line.itemId,
            quantityOrdered: line.quantityOrdered,
            unitCost: line.unitCost,
            xeroPurchaseAccountCode: line.xeroPurchaseAccountCode,
            shipAddressEntryId: line.shipAddressEntryId,
            shipContactName: line.shipContactName,
            shipContactPhone: line.shipContactPhone,
            shipLine1: line.shipLine1,
            shipLine2: line.shipLine2,
            shipCity: line.shipCity,
            shipRegion: line.shipRegion,
            shipPostcode: line.shipPostcode,
            shipCountry: line.shipCountry,
            shipDeliveryInstructions: line.shipDeliveryInstructions,
          })),
          additionalCosts: initialData.additionalCosts,
        }
    : {
        ...(defaultValues ?? purchaseOrderDefaultValues),
        xeroPurchaseAccountCode: null,
        ...EMPTY_DELIVERY_ADDRESS,
        lines: (defaultValues ?? purchaseOrderDefaultValues).lines.map((line) => ({
          ...line,
          ...normalizeDeliveryAddress(line),
        })),
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
    lineIndex: number;
    option: DeliveryAddressOption | null;
  } | null>(null);

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

  const additionalCostRows = watchedAdditionalCosts ?? [];
  const landedCostPreview = useMemo(
    () =>
      calculatePurchaseOrderLandedCosts({
        lines: (watchedLines ?? []).map((line) => ({
          quantityOrdered: line?.quantityOrdered,
          unitCost: line?.unitCost,
          purchaseToStockFactor:
            (line?.itemId ? materialMap.get(line.itemId)?.purchaseToStockFactor : null) ??
            "1",
        })),
        additionalCosts: watchedAdditionalCosts ?? [],
        legacyShippingCost: watchedShippingCost,
      }),
    [materialMap, watchedAdditionalCosts, watchedLines, watchedShippingCost]
  );
  const materialsTotal = landedCostPreview.materialSubtotal;
  const additionalCostTotal = landedCostPreview.additionalCostTotal;
  const distributedAdditionalCostTotal =
    landedCostPreview.distributedAdditionalCostTotal;
  const nonDistributedAdditionalCostTotal =
    landedCostPreview.nonDistributedAdditionalCostTotal;
  const orderTotal = landedCostPreview.orderTotal;
  const lineCount = (watchedLines ?? []).filter(
    (line) => !isBlankPurchaseOrderLine(line)
  ).length;
  const additionalCostCount = additionalCostRows.filter(
    (cost) => !isBlankPurchaseOrderAdditionalCost(cost)
  ).length;
  const canAutosaveDraft = hasAutosaveMinimum(form.getValues());

  const savePurchaseOrder = useCallback(
    async (values: PurchaseOrderFormValues) => {
      const orderId = savedOrderIdRef.current;
      const response = await fetch(
        orderId ? `/api/purchase-orders/${orderId}` : "/api/purchase-orders",
        {
          method: orderId ? "PUT" : "POST",
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

      const result = body as { id: string };
      savedOrderIdRef.current = result.id;
      setSavedOrderId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      return result;
    },
    [queryClient]
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
    mutationFn: async ({
      orderId,
      file,
    }: {
      orderId: string;
      file: File;
    }) => {
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
        { method: "DELETE" }
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
          : "Save the purchase order before uploading files."
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
      const option = addressEntryToOption(entry);
      if (!option || addressDialogState == null) return;

      setDeliveryAddressOptions((current) => {
        const existing = current.filter((row) => row.id !== option.id);
        return [...existing, option].sort((a, b) => a.label.localeCompare(b.label));
      });
      applyDeliveryAddress(addressDialogState.lineIndex, option);
      setAddressDialogState(null);
      addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    },
  });

  const handleCancel = useSmartBack(fallbackPath);
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const applyDeliveryAddress = (
    index: number,
    address: DeliveryAddressFields | null
  ) => {
    const nextAddress = address ? normalizeDeliveryAddress(address) : EMPTY_DELIVERY_ADDRESS;
    form.setValue(`lines.${index}.shipAddressEntryId`, nextAddress.shipAddressEntryId, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipContactName`, nextAddress.shipContactName, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipContactPhone`, nextAddress.shipContactPhone, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipLine1`, nextAddress.shipLine1, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipLine2`, nextAddress.shipLine2, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipCity`, nextAddress.shipCity, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipRegion`, nextAddress.shipRegion, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipPostcode`, nextAddress.shipPostcode, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(`lines.${index}.shipCountry`, nextAddress.shipCountry, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue(
      `lines.${index}.shipDeliveryInstructions`,
      nextAddress.shipDeliveryInstructions,
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    );
  };

  const openAddressDialog = (index: number) => {
    addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    setAddressDialogState({ lineIndex: index, option: null });
  };

  const openEditAddressDialog = (index: number, option: DeliveryAddressOption) => {
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
    setAddressDialogState({ lineIndex: index, option });
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
      const labels = new Set(deliveryAddressOptions.map((option) => option.label));
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
    form.formState.errors.additionalCosts
  );
  const selectedSupplier = supplierOptionsSorted.find(
    (supplier) => supplier.id === watchedSupplierId
  );
  const autosaveState = canAutosaveDraft ? autosave.state : "blocked";
  const autosaveMessage = canAutosaveDraft
    ? autosave.state === "saved" || autosave.state === "idle"
      ? savedOrderId
        ? "Draft saved"
        : "Draft will auto-save"
      : autosave.message
    : "Add supplier and line to auto-save";

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Purchasing · Orders"
        title={isEditing ? "Edit Purchase Order" : "Add Purchase Order"}
        actions={
          <>
            <AutosaveStatus state={autosaveState} message={autosaveMessage} />
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="purchase-order-form"
              disabled={
                mutation.isPending ||
                autosave.state === "saving" ||
                autosave.state === "dirty"
              }
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
                  {
                    label: "Not distributed",
                    value:
                      formatPrice(nonDistributedAdditionalCostTotal.toFixed(4)) ??
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
            <CreateSidebarCard
              title={
                <div className="flex items-center justify-between gap-3">
                  <span>Attachments</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={
                      uploadFileMutation.isPending || autosave.state === "saving"
                    }
                  >
                    <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />
                    Upload
                  </Button>
                </div>
              }
            >
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
                <div
                  className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-5 text-sm text-muted-foreground"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleFileInput(event.dataTransfer.files);
                  }}
                >
                  <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden />
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload or drop files
                  </button>
                </div>
                {fileActionError ? (
                  <p className="text-sm text-destructive">{fileActionError}</p>
                ) : null}
                <div className="divide-y rounded-md border">
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
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-5 text-center text-sm text-muted-foreground">
                      No attachments.
                    </div>
                  )}
                </div>
              </div>
            </CreateSidebarCard>
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
                  minWidth="66rem"
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
                    "Delivery Address",
                    "Accounting Account",
                    <TooltipHeader
                      key="line-total"
                      label="Line Total"
                      tooltip={LINE_TOTAL_TOOLTIP}
                    />,
                    "Allocated",
                    "Landed Total",
                    "Landed / Stock Unit",
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
                        deliveryAddressOptions={deliveryAddressOptions}
                        onDeliveryAddressChange={(address) =>
                          applyDeliveryAddress(index, address)
                        }
                        onAddDeliveryAddress={() => openAddressDialog(index)}
                        onEditDeliveryAddress={(address) =>
                          openEditAddressDialog(index, address)
                        }
                        landedCost={landedCostPreview.lines[index]}
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
                      <span className="text-muted-foreground">Material Subtotal</span>
                      <div className="font-medium">
                        {formatPrice(materialsTotal.toFixed(4)) ?? "$0.00"}
                      </div>
                    </div>
                  }
                />
            </FieldGroup>
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
                  "Accounting Account",
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
                {(addressMutation.error as ApiError).error ?? "Failed to save address."}
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
                      <FieldLabel htmlFor="address-contact-name">
                        Contact Name
                      </FieldLabel>
                      <Input
                        {...field}
                        id="address-contact-name"
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
                      <FieldLabel htmlFor="address-contact-phone">
                        Contact Phone
                      </FieldLabel>
                      <Input
                        {...field}
                        id="address-contact-phone"
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
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                      rows={3}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <Controller
                control={addressForm.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address-notes">Notes</FieldLabel>
                    <Textarea
                      {...field}
                      id="address-notes"
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
  deliveryAddressOptions,
  onDeliveryAddressChange,
  onAddDeliveryAddress,
  onEditDeliveryAddress,
  landedCost,
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
  deliveryAddressOptions: DeliveryAddressOption[];
  onDeliveryAddressChange: (address: DeliveryAddressFields | null) => void;
  onAddDeliveryAddress: () => void;
  onEditDeliveryAddress: (address: DeliveryAddressOption) => void;
  landedCost: LandedCostLineResult | undefined;
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
        <DeliveryAddressInput
          id={`${lineKey}-delivery-address`}
          value={line}
          options={deliveryAddressOptions}
          onChange={onDeliveryAddressChange}
          onAddNew={onAddDeliveryAddress}
          onEdit={onEditDeliveryAddress}
        />
      </EditableLineGridCell>

      <EditableLineGridCell>
        <Controller
          control={control}
          name={`lines.${index}.xeroPurchaseAccountCode`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-xero-account`}>
                Accounting Account
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

      <EditableLineGridCell align="right" className="text-sm font-medium">
        {moneyLabel(landedCost?.allocatedAdditionalCost)}
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="text-sm font-medium">
        {moneyLabel(landedCost?.landedLineTotal)}
      </EditableLineGridCell>

      <EditableLineGridCell align="right" className="text-sm font-medium">
        {landedStockUnitCostLabel(
          landedCost?.landedStockUnitCost,
          material?.stockingUnitName
        )}
      </EditableLineGridCell>

    </EditableLineGridRow>
  );
}

function DeliveryAddressInput({
  id,
  value,
  options,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
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
      <FieldLabel className="sr-only" htmlFor={id}>
        Delivery Address
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
          if (itemId === EDIT_DELIVERY_ADDRESS_VALUE) return "Edit selected address";
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
                    <span className="truncate">{optionMap.get(itemId)?.label}</span>
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
                Accounting Account
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
