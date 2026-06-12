"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import {
  type InsertPurchaseOrder,
  type PurchaseOrderStatus,
  purchaseOrderDefaultValues,
} from "@/lib/schemas/purchase-orders";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { fieldErrorAt, firstFieldErrorMessage } from "@/lib/api/field-errors";
import { formatAddressLines } from "@/lib/addresses";
import {
  formatPrice,
  formatDate,
  parsePositive,
} from "@/lib/format";
import {
  calculatePurchaseOrderLandedCosts,
  type LandedCostLineResult,
} from "@/lib/purchasing/landed-cost";
import { groupPurchaseOrderByResolvedSupplier } from "@/lib/purchasing/resolved-supplier-groups";
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
import { useCardEntityActions } from "@/components/card-page/use-card-entity-actions";
import {
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CardField } from "@/components/card-page/card-field";
import type {
  PurchaseOrderAccountingGroupState,
  PurchaseOrderDetail,
  PurchaseOrderEditData,
  PurchaseOrderMaterialOption,
  PurchaseOrderTaxRateOption,
  SupplierOption,
} from "@/lib/purchasing/types";
import { SupplierSelect } from "./supplier-select";
import {
  PurchaseBillDialog,
  PurchaseOrderEmailDialog,
  type PurchaseBillDialogGroupValues,
  type PurchaseBillDialogValues,
  type PurchaseOrderEmailDialogGroupValues,
  type PurchaseOrderEmailDialogValues,
} from "./purchase-order-workflow-dialogs";
import { PurchaseBillActionControl } from "./purchase-order-workflow-actions";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { purchaseOrderStatusConfig } from "@/components/card-page/order-status-configs";
import {
  purchaseOrderDefaultDraft,
  purchaseOrderEditDataToDraft,
  usePurchaseOrderDraftController,
  type PurchaseOrderDraft,
  type PurchaseOrderFormValues,
} from "./use-purchase-order-draft-controller";
import styles from "@/components/card-page/card-page.module.css";
import { ApiJsonError, apiJson } from "@/lib/client/api";
import { useApiMutation } from "@/lib/client/use-api-mutation";
import { queryKeys } from "@/lib/client/query-keys";

import {
  buildPurchaseOrderAdditionalCostColumns,
  buildPurchaseOrderLineColumns,
  DeliveryAddressInput,
} from "./purchase-order-card-grids";
import {
  ACCOUNTING_NOT_CONNECTED_MESSAGE,
  ADDRESS_DIALOG_FIELD_NAMES,
  EMPTY_ADDITIONAL_COST_SUPPLIER_DIALOG_VALUES,
  EMPTY_ADDRESS_DIALOG_VALUES,
  EMPTY_DELIVERY_ADDRESS,
  LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY,
  LEGACY_LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY,
  addressEntryToOption,
  collectDeliveryAddressOptions,
  createPurchaseOrderAdditionalCostRow,
  createPurchaseOrderLineRow,
  deliveryInfoNote,
  isBlankPurchaseOrderAdditionalCost,
  isBlankPurchaseOrderLine,
  lineTotalBeforeTax,
  normalizeDeliveryAddress,
  parseNonNegative,
  purchaseOrderValidationErrors,
  todayIsoDate,
  type AdditionalCostSupplierDialogValues,
  type AddressDialogValues,
  type AddressEntry,
  type ApiError,
  type DeliveryAddressFields,
  type DeliveryAddressOption,
  type PurchaseOrderAdditionalCostGridRow,
  type PurchaseOrderLineGridRow,
  type XeroAccountOption,
  type PurchaseOrderFormAttachment,
  type XeroBillSetupStatus,
} from "./purchase-order-card-shared";
export type { XeroBillSetupStatus } from "./purchase-order-card-shared";

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
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detachFileInputRef = useRef<(() => void) | null>(null);
  const emailAttachmentUploadGroupKeyRef = useRef<string | null>(null);
  const attachmentInputId = useId();
  const fallbackPath = initialData
    ? `/purchasing/order/${initialData.id}`
    : "/purchasing/orders";
  const [formError, setFormError] = useState<string | null>(null);
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
  const [accountingGroupStates, setAccountingGroupStates] = useState<
    PurchaseOrderAccountingGroupState[]
  >(initialData?.accountingGroupStates ?? []);
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
  const [purchaseBillManualStatus, setPurchaseBillManualStatus] = useState(
    initialData?.purchaseBillManualStatus ?? null,
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
    queryKey: queryKeys.accountingAccounts.byProvider(accountingProviderLabel),
    enabled: xeroBillSetupStatus === "ready",
    queryFn: async () => {
      const provider =
        accountingProviderLabel === "QuickBooks" ? "quickbooks" : "xero";
      return apiJson<{ accounts: XeroAccountOption[] }>(
        `/api/accounting/connections/${provider}/accounts`,
        { fallbackError: "Failed to load accounting accounts." },
      );
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
  const readOnly = !canWrite || displayStatus === "received";
  const canDeletePurchaseOrder =
    canWrite && (displayStatus === "draft" || displayStatus === "ordered");
  const materialLinesReadOnly = readOnly || purchaseBillStatus === "pushed";
  const additionalCostsReadOnly = !canWrite || purchaseBillStatus === "pushed";
  const [purchaseOrderSupplierOptions, setPurchaseOrderSupplierOptions] =
    useState<SupplierOption[]>(suppliers);
  useEffect(() => {
    setPurchaseOrderSupplierOptions((current) => {
      const byId = new Map(current.map((supplier) => [supplier.id, supplier]));
      for (const supplier of suppliers) byId.set(supplier.id, supplier);
      return [...byId.values()];
    });
  }, [suppliers]);
  const supplierOptionsSorted = useMemo(
    () =>
      [...purchaseOrderSupplierOptions].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [purchaseOrderSupplierOptions],
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
        const message = firstFieldErrorMessage(validationErrors, "Fix highlighted fields.");
        throw new ApiJsonError(message, 400, {
          error: message,
          errors: validationErrors,
        });
      }

      setFormError(null);
      try {
        return await apiJson<PurchaseOrderDetail>(
          orderId ? `/api/purchase-orders/${orderId}` : "/api/purchase-orders",
          {
            method: orderId ? "PUT" : "POST",
            headers: createIdempotencyHeaders("savePurchaseOrder"),
            body: values,
            fallbackError: "Failed to save purchase order.",
          },
        );
      } catch (error) {
        if (error instanceof ApiJsonError) setFormError(error.message);
        throw error;
      }
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
      setAccountingGroupStates(result.accountingGroupStates);
    },
  });
  const draftValues = purchaseOrderController.draft;
  const fieldErrors = purchaseOrderController.fieldErrors;
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
  const flushBeforeStatusTransition = useCallback(async () => {
    await purchaseOrderController.flush();
    if (purchaseOrderController.hasPendingOps()) {
      throw new Error("Save changes before changing status.");
    }
  }, [purchaseOrderController]);
  const addressForm = useForm<AddressDialogValues>({
    defaultValues: EMPTY_ADDRESS_DIALOG_VALUES,
  });
  const additionalCostSupplierForm = useForm<AdditionalCostSupplierDialogValues>({
    defaultValues: EMPTY_ADDITIONAL_COST_SUPPLIER_DIALOG_VALUES,
  });
  const additionalCostSupplierDialogResolverRef = useRef<
    ((result: { value: string } | null) => void) | null
  >(null);
  const [additionalCostSupplierDialogOpen, setAdditionalCostSupplierDialogOpen] = useState(false);
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
  const lastSupplierByMaterialRef = useRef<Map<string, string>>(new Map());
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
  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") return;
      lastSupplierByMaterialRef.current = new Map(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" && typeof entry[1] === "string",
        ),
      );
      if (raw && !window.localStorage.getItem(LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY)) {
        window.localStorage.setItem(LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY, raw);
      }
    } catch {
      lastSupplierByMaterialRef.current = new Map();
    }
  }, []);

  const watchedSupplierId = draftValues.supplierId;
  const watchedAdditionalCosts = draftValues.additionalCosts;
  const watchedAdditionalInfo = draftValues.notes;
  const additionalCostRows = draftValues.additionalCosts;
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
  const rememberSupplierForCurrentMaterials = useCallback(
    (supplierId: string | null) => {
      if (!supplierId) return;
      const materialIds = lineGridRows
        .map((line) => line.itemId?.trim() ?? "")
        .filter(Boolean);
      if (materialIds.length === 0) return;
      for (const materialId of materialIds) {
        lastSupplierByMaterialRef.current.set(materialId, supplierId);
      }
      try {
          window.localStorage.setItem(
          LAST_SUPPLIER_BY_MATERIAL_STORAGE_KEY,
          JSON.stringify(
            Object.fromEntries(lastSupplierByMaterialRef.current.entries()),
          ),
        );
      } catch {
        // Best-effort editor memory only.
      }
    },
    [lineGridRows],
  );
  const lastSupplierForCurrentMaterials = useCallback(() => {
    for (const line of lineGridRows) {
      const materialId = line.itemId?.trim();
      if (!materialId) continue;
      const supplierId = lastSupplierByMaterialRef.current.get(materialId);
      if (supplierId) return supplierId;
    }
    return null;
  }, [lineGridRows]);
  const createAdditionalCostSupplier = useCallback(async () => {
    return new Promise<{ value: string } | null>((resolve) => {
      additionalCostSupplierDialogResolverRef.current = resolve;
      additionalCostSupplierForm.reset(EMPTY_ADDITIONAL_COST_SUPPLIER_DIALOG_VALUES);
      setAdditionalCostSupplierDialogOpen(true);
    });
  }, [additionalCostSupplierForm]);
  const lineColumns = useMemo<LineField<PurchaseOrderLineGridRow>[]>(
    () =>
      buildPurchaseOrderLineColumns({
        additionalCostsExpanded,
        fieldErrors,
        landedCostByRowId,
        lineGridRows,
        materialMap,
        materialOptions,
        receivedMaterialIds,
        materialLinesReadOnly,
        taxRates,
        taxRateMap,
      }),
    [
      additionalCostsExpanded,
      fieldErrors,
      landedCostByRowId,
      lineGridRows,
      materialMap,
      materialOptions,
      receivedMaterialIds,
      materialLinesReadOnly,
      taxRates,
      taxRateMap,
    ],
  );
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
  >(
    () =>
      buildPurchaseOrderAdditionalCostColumns({
        additionalCostGridRows,
        fieldErrors,
        additionalCostsReadOnly,
        createAdditionalCostSupplier,
        rememberSupplierForCurrentMaterials,
        supplierOptionsSorted,
      }),
    [
      additionalCostGridRows,
      fieldErrors,
      additionalCostsReadOnly,
      createAdditionalCostSupplier,
      rememberSupplierForCurrentMaterials,
      supplierOptionsSorted,
    ],
  );
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
    () =>
      createPurchaseOrderAdditionalCostRow({
        supplierId: lastSupplierForCurrentMaterials(),
      }),
    [lastSupplierForCurrentMaterials],
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
      return apiJson<PurchaseOrderFormAttachment>(
        `/api/purchase-orders/${orderId}/files`,
        {
          method: "POST",
          body: formData,
          fallbackError: "Failed to upload file.",
        },
      );
    },
    onMutate: () => setFileActionError(null),
    onSuccess: (file) => {
      setAttachments((current) => [file, ...current]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
    },
    onError: (error: Error) => setFileActionError(error.message),
  });

  const actions = useCardEntityActions({
    entity: "purchase-order-action",
    getId: () => savedOrderIdRef.current,
    flush: purchaseOrderController.flush,
    hasPendingOps: purchaseOrderController.hasPendingOps,
    invalidateQueryKeys: [queryKeys.purchaseOrders.root],
    missingIdError: "Save the purchase order first.",
    onMutate: () => setFormError(null),
    onError: (error) => setFormError(error.message),
    duplicate: {
      run: (id) =>
        apiJson<{ id: string }>(`/api/purchase-orders/${id}/duplicate`, {
          method: "POST",
          fallbackError: "Failed to duplicate purchase order.",
        }),
      navigateTo: (id) => `/purchasing/order/${id}`,
    },
    delete: {
      label: "Delete purchase order",
      run: (id) =>
        apiJson<void>(`/api/purchase-orders/${id}`, {
          method: "DELETE",
          fallbackError: "Failed to delete purchase order.",
        }),
      navigateTo: "/purchasing/orders",
      confirm: {
        title: "Delete purchase order?",
        description: (
          <>
            Purchase order {savedOrderNumber ?? "this order"} will be removed. This
            cannot be undone.
          </>
        ),
      },
    },
  });
  const statusMutation = useApiMutation({
    invalidates: [queryKeys.purchaseOrders.root],
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "status"],
    mutationFn: async (status: PurchaseOrderStatus) => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      return apiJson<{ id: string }>(
        `/api/purchase-orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: createIdempotencyHeaders("purchase-order-status"),
          body: { status },
          fallbackError: "Failed to update purchase order status.",
        },
      );
    },
    onSuccess: (_result, status) => {
      setDisplayStatus(status);
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const purchaseBillMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "purchase-bill"],
    mutationFn: async (values: PurchaseBillDialogValues) => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      return apiJson<{
        xeroBillId: string | null;
        xeroBillNumber: string | null;
        status: "pushed";
        created: boolean;
        adopted: boolean;
        bills?: Array<{
          groupKey: string;
          xeroBillId: string;
          xeroBillNumber: string;
        }>;
      }>(`/api/purchase-orders/${orderId}/accounting-bill`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-bill"),
        body: values,
        fallbackError: "Failed to create supplier bill.",
        mapError: (_status, body) => {
          const message =
            typeof (body as { error?: unknown } | null)?.error === "string" &&
            (body as { error: string }).error.toLowerCase().includes("not connected")
              ? ACCOUNTING_NOT_CONNECTED_MESSAGE
              : undefined;
          return message ? new Error(message) : undefined;
        },
      });
    },
    onMutate: () => {
      setFormError(null);
      setPurchaseBillStatus("pending");
      return { previousStatus: purchaseBillStatus };
    },
    onSuccess: async (result) => {
      setPurchaseBillStatus("pushed");
      setPurchaseBillExternalId(result.xeroBillId ?? null);
      setPurchaseBillExternalNumber(result.xeroBillNumber ?? null);
      setPurchaseBillDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
    },
    onError: (error: Error, _values, context) => {
      setPurchaseBillStatus(context?.previousStatus ?? null);
    },
  });
  const purchaseBillManualStatusMutation = useApiMutation({
    invalidates: [queryKeys.purchaseOrders.root],
    mutationKey: [
      "purchase-order-action",
      savedOrderId ?? "__draft__",
      "purchase-bill-manual-status",
    ],
    mutationFn: async (
      status: "not_billed" | "partly_billed" | "billed",
    ) => {
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");
      return apiJson<{
        purchaseBillManualStatus: "not_billed" | "partly_billed" | "billed" | null;
      }>(`/api/purchase-orders/${orderId}/bill-status`, {
        method: "PATCH",
        headers: createIdempotencyHeaders("purchase-order-bill-status"),
        body: { status },
        fallbackError: "Failed to update bill status.",
      });
    },
    onSuccess: (result) => {
      setPurchaseBillManualStatus(result.purchaseBillManualStatus);
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const purchaseOrderEmailMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "email"],
    mutationFn: async () => {
      await purchaseOrderController.flush();
      const orderId = savedOrderIdRef.current;
      if (!orderId) throw new Error("Save the purchase order first.");

      return apiJson<{
        status: "sent";
        sent: Array<{ groupKey: string; recipientEmail: string }>;
      }>(`/api/purchase-orders/${orderId}/email`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-email"),
        body: {
          groups: (poEmailDialogValues.groups ?? []).map((group) => ({
            groupKey: group.groupKey,
            include: group.include,
            resend: group.status === "sent" && group.include,
            includePdf: group.includePdf,
            to: group.to,
            replyTo: group.replyTo || null,
            bcc: group.bcc || null,
            subject: group.subject,
            message: group.message || null,
            attachmentFileIds: group.attachmentFileIds ?? [],
          })),
        },
        fallbackError: "Failed to send purchase order.",
      });
    },
    onMutate: () => {
      setFormError(null);
      setPoEmailError(null);
      setPoEmailStatus("pending");
      return { previousStatus: poEmailStatus };
    },
    onSuccess: async (result) => {
      const emailedAt = new Date();
      setAccountingGroupStates((current) => {
        const byKey = new Map(current.map((state) => [state.groupKey, state]));
        for (const sent of result.sent) {
          const existing = byKey.get(sent.groupKey);
          byKey.set(sent.groupKey, {
            groupKey: sent.groupKey,
            pushStatus: existing?.pushStatus ?? null,
            pushError: existing?.pushError ?? null,
            externalDocumentId: existing?.externalDocumentId ?? null,
            externalDocumentNumber: existing?.externalDocumentNumber ?? null,
            pushedAt: existing?.pushedAt ?? null,
            emailStatus: "sent",
            emailError: null,
            emailedAt,
          });
        }
        return [...byKey.values()];
      });
      setPoEmailStatus("sent");
      setPoEmailDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
    },
    onError: (error: Error) => {
      setPoEmailStatus("failed");
      setPoEmailError(error.message);
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
    },
  });

  const saveSupplierEmailMutation = useApiMutation({
    invalidates: [queryKeys.purchaseOrders.root],
    mutationKey: ["supplier-email", savedOrderId ?? "__draft__"],
    mutationFn: async (input: {
      groupKey: string;
      supplierId: string;
      email: string;
    }) => {
      await apiJson<void>(`/api/suppliers/${input.supplierId}`, {
        method: "PATCH",
        body: { email: input.email },
        fallbackError: "Failed to save supplier email.",
      });
      return input;
    },
    onSuccess: (input) => {
      setPoEmailDialogValues((current) => ({
        ...current,
        groups: (current.groups ?? []).map((group) =>
          group.groupKey === input.groupKey
            ? { ...group, to: input.email }
            : group,
        ),
      }));
    },
    onError: (error: Error) => setPoEmailError(error.message),
  });

  const ensureSavedOrder = useCallback(async () => {
    await purchaseOrderController.flush();
    const orderId = savedOrderIdRef.current;
    if (!orderId) {
      const firstError = fieldErrors ? firstFieldErrorMessage(fieldErrors, "") : "";
      const message =
        purchaseOrderController.error ??
        (firstError || "Choose a supplier before uploading files.");
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
      const targetGroupKey = emailAttachmentUploadGroupKeyRef.current;
      for (const file of filesToUpload) {
        const uploaded = await uploadFileMutation.mutateAsync({ orderId, file });
        if (targetGroupKey) {
          setPoEmailDialogValues((current) => ({
            ...current,
            groups: (current.groups ?? []).map((group) =>
              group.groupKey === targetGroupKey
                ? {
                    ...group,
                    attachmentFileIds: Array.from(
                      new Set([...(group.attachmentFileIds ?? []), uploaded.id]),
                    ),
                  }
                : group,
            ),
          }));
        }
      }
    } catch (error) {
      setFileActionError(
        error instanceof Error
          ? error.message
        : "Save the purchase order before uploading files.",
      );
    } finally {
      emailAttachmentUploadGroupKeyRef.current = null;
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
      try {
        return await apiJson<AddressEntry>(
          id ? `/api/addresses/${id}` : "/api/addresses",
          {
            method: id ? "PUT" : "POST",
            body: values,
            fallbackError: "Failed to save address.",
          },
        );
      } catch (error) {
        if (!(error instanceof ApiJsonError)) throw error;
        throw {
          error: error.message,
          errors: error.errors,
        } satisfies ApiError;
      }
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

  const closeAdditionalCostSupplierDialog = useCallback((result: { value: string } | null) => {
    additionalCostSupplierDialogResolverRef.current?.(result);
    additionalCostSupplierDialogResolverRef.current = null;
    setAdditionalCostSupplierDialogOpen(false);
    additionalCostSupplierForm.reset(EMPTY_ADDITIONAL_COST_SUPPLIER_DIALOG_VALUES);
  }, [additionalCostSupplierForm]);

  const additionalCostSupplierMutation = useMutation({
    mutationKey: ["purchase-order-action", savedOrderId ?? "__draft__", "supplier"],
    mutationFn: async (values: AdditionalCostSupplierDialogValues) => {
      try {
        const body = await apiJson<{ id: unknown; name?: unknown }>("/api/suppliers", {
          method: "POST",
          body: {
            name: values.name,
            contactName: values.contactName,
            email: values.email,
          },
          fallbackError: "Failed to create supplier.",
        });
        return {
          id: String(body.id),
          name: String(body.name ?? values.name),
          code: null,
          email: values.email,
        } satisfies SupplierOption;
      } catch (error) {
        if (!(error instanceof ApiJsonError)) throw error;
        throw {
          error: error.message,
          errors: error.errors,
        } satisfies ApiError;
      }
    },
    onSuccess: (created) => {
      setPurchaseOrderSupplierOptions((current) => {
        const byId = new Map(current.map((supplier) => [supplier.id, supplier]));
        byId.set(created.id, created);
        return [...byId.values()];
      });
      rememberSupplierForCurrentMaterials(created.id);
      closeAdditionalCostSupplierDialog({ value: created.id });
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          additionalCostSupplierForm.setError(field as keyof AdditionalCostSupplierDialogValues, {
            type: "server",
            message: messages[0],
          });
        });
      }
      setFormError(error.error ?? "Failed to create supplier.");
    },
  });

  const handleAdditionalCostSupplierDialogSubmit = (values: AdditionalCostSupplierDialogValues) => {
    const name = values.name.trim();
    if (!name) {
      additionalCostSupplierForm.setError("name", {
        type: "required",
        message: "Name is required",
      });
      return;
    }
    const email = values.email?.trim() ?? "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      additionalCostSupplierForm.setError("email", {
        type: "validate",
        message: "Email must be a valid email address",
      });
      return;
    }
    additionalCostSupplierMutation.mutate({
      name,
      contactName: values.contactName?.trim() || null,
      email: email || null,
    });
  };

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

  const linesError = fieldErrorAt(fieldErrors, "lines");
  const additionalCostsError = fieldErrorAt(fieldErrors, "additionalCosts");
  const supplierIdError = fieldErrorAt(fieldErrors, "supplierId");
  const orderNumberError = fieldErrorAt(fieldErrors, "orderNumber");
  const expectedDateError = fieldErrorAt(fieldErrors, "expectedDate");
  const notesError = fieldErrorAt(fieldErrors, "notes");
  const selectedSupplier = supplierOptionsSorted.find(
    (supplier) => supplier.id === watchedSupplierId,
  );
  const currentSupplierEmail =
    initialData?.supplierId === watchedSupplierId
      ? initialData.supplierEmail
      : selectedSupplier?.email ?? null;
  const accountingGroupStateByKey = useMemo(() => {
    const rows = accountingGroupStates;
    return new Map(rows.map((state) => [state.groupKey, state]));
  }, [accountingGroupStates]);
  const resolvedSupplierGroups = useMemo(() => {
    if (!watchedSupplierId) return [];
    const supplier = selectedSupplier ?? {
      id: watchedSupplierId,
      name: "PO supplier",
      email: currentSupplierEmail,
    };
    const suppliersById = new Map(
      supplierOptionsSorted.map((row) => [
        row.id,
        { id: row.id, name: row.name, email: row.email ?? null },
      ]),
    );
    return groupPurchaseOrderByResolvedSupplier({
      purchaseOrderSupplier: {
        id: supplier.id,
        name: supplier.name,
        email: supplier.email ?? null,
      },
      suppliersById,
      lines: lineGridRows
        .filter((line) => !isBlankPurchaseOrderLine(line))
        .map((line) => ({ ...line, id: line.id ?? line.clientRowId })),
      additionalCosts: additionalCostRows
        .filter((cost) => !isBlankPurchaseOrderAdditionalCost(cost))
        .map((cost) => ({
          ...cost,
          id: cost.id ?? cost.clientRowId,
          persistedId: cost.id,
        })),
    });
  }, [
    additionalCostRows,
    currentSupplierEmail,
    lineGridRows,
    selectedSupplier,
    supplierOptionsSorted,
    watchedSupplierId,
  ]);
  const emailDialogGroups = useCallback((): PurchaseOrderEmailDialogGroupValues[] => {
    return resolvedSupplierGroups.map((group) => {
      const state =
        accountingGroupStateByKey.get(group.key) ??
        (group.isPurchaseOrderSupplier
          ? accountingGroupStateByKey.get("default")
          : undefined);
      const subjectPrefix = savedOrderNumber ?? "Purchase order";
      const subject = group.isPurchaseOrderSupplier
        ? `${subjectPrefix} from ${organizationName}`
        : `${subjectPrefix} - ${group.supplier.name} from ${organizationName}`;
      return {
        groupKey: group.key,
        supplierId: group.supplier.id,
        label: group.isPurchaseOrderSupplier
          ? selectedSupplier?.name ?? "PO supplier"
          : group.supplier.name,
        include: state?.emailStatus !== "sent",
        isAdditionalCost: !group.isPurchaseOrderSupplier,
        to: group.supplier.email ?? "",
        replyTo: userEmail,
        bcc: userEmail,
        subject,
        message: `Hi,\n\nYou should find the necessary documents for ${savedOrderNumber ?? "this order"} attached to this email.\nPlease let me know if anything is missing.\n\nBest regards,\n${userName || userEmail}\n${organizationName}`,
        includePdf: true,
        attachmentFileIds: [],
        sentAt: state?.emailedAt ?? null,
        status: state?.emailStatus ?? null,
      };
    });
  }, [
    accountingGroupStateByKey,
    organizationName,
    resolvedSupplierGroups,
    savedOrderNumber,
    selectedSupplier?.name,
    userEmail,
    userName,
  ]);
  const billDialogGroups = useCallback((): PurchaseBillDialogGroupValues[] => {
    return resolvedSupplierGroups.map((group) => {
      const state =
        accountingGroupStateByKey.get(group.key) ??
        (group.isPurchaseOrderSupplier
          ? accountingGroupStateByKey.get("default")
          : undefined);
      const amount =
        group.lines.reduce((sum, line) => {
          const quantity = parsePositive(line.quantityOrdered);
          const unitCost = parsePositive(line.unitCost);
          return sum + (quantity != null && unitCost != null ? quantity * unitCost : 0);
        }, 0) +
        group.additionalCosts.reduce((sum, cost) => {
          const amountValue = parseNonNegative(cost.amount);
          return sum + (amountValue ?? 0);
        }, 0);
      const persistedCostIds = group.additionalCosts
        .map((cost) => cost.persistedId)
        .filter((id): id is string => Boolean(id));
      return {
        groupKey: group.key,
        label: group.isPurchaseOrderSupplier
          ? selectedSupplier?.name ?? "PO supplier"
          : group.supplier.name,
        include: state?.pushStatus !== "pushed",
        invoiceNumber: "",
        accountingPurchaseAccountCode:
          initialData?.accountingPurchaseAccountCode ??
          xeroPurchaseBillDefaultAccountCode ??
          "",
        amount: amount.toFixed(4),
        additionalCostIds:
          persistedCostIds.length === group.additionalCosts.length
            ? persistedCostIds
            : undefined,
        pushedAt: state?.pushedAt ?? null,
        status: state?.pushStatus ?? null,
        externalNumber: state?.externalDocumentNumber ?? null,
      };
    });
  }, [
    accountingGroupStateByKey,
    initialData?.accountingPurchaseAccountCode,
    resolvedSupplierGroups,
    selectedSupplier?.name,
    xeroPurchaseBillDefaultAccountCode,
  ]);
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
    if (readOnly && additionalCostsReadOnly) return "readonly";
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
      : purchaseBillStatus === "pending"
        ? "Bill sync is already running."
        : null;
  const openPurchaseOrderEmailDialog = () => {
    setPoEmailError(null);
    const groups = emailDialogGroups();
    const first = groups[0];
    setPoEmailDialogValues({
      groups,
      to: first?.to ?? currentSupplierEmail ?? "",
      replyTo: userEmail,
      bcc: userEmail,
      subject:
        first?.subject ??
        `${savedOrderNumber ?? "Purchase order"} from ${organizationName}`,
      message:
        first?.message ??
        `Hi,\n\nYou should find the necessary documents for ${savedOrderNumber ?? "this order"} attached to this email.\nPlease let me know if anything is missing.\n\nBest regards,\n${userName || userEmail}\n${organizationName}`,
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
    const groups = billDialogGroups();
    const first = groups[0];
    setPurchaseBillDialogValues((current) => ({
      ...current,
      groups,
      invoiceNumber: first?.invoiceNumber ?? "",
      accountingPurchaseAccountCode:
        first?.accountingPurchaseAccountCode ??
        current.accountingPurchaseAccountCode,
    }));
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
                beforeTransition={flushBeforeStatusTransition}
                onTransitionError={(error) => setFormError(error.message)}
                onChanged={(next) => {
                  setDisplayStatus(next as PurchaseOrderStatus);
                  void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
                }}
              />
            ) : null
          }
          workflowControls={
            savedOrderId ? (
              <PurchaseBillActionControl
                status={purchaseBillStatus}
                manualStatus={purchaseBillManualStatus}
                groupStates={resolvedSupplierGroups.map((group) => {
                  const state =
                    accountingGroupStateByKey.get(group.key) ??
                    (group.isPurchaseOrderSupplier
                      ? accountingGroupStateByKey.get("default")
                      : undefined);
                  return { pushStatus: state?.pushStatus ?? null };
                })}
                billableGroupCount={Math.max(resolvedSupplierGroups.length, 1)}
                busy={purchaseBillMutation.isPending}
                externalId={purchaseBillExternalId}
                externalNumber={purchaseBillExternalNumber}
                disabled={!canWrite || Boolean(billActionDisabledReason)}
                disabledReason={billActionDisabledReason}
                onSetManualStatus={(status) =>
                  purchaseBillManualStatusMutation.mutate(status)
                }
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
                      resolvedSupplierGroups.length === 0,
                    tooltip: poEmailError ?? "",
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
            ...(savedOrderId && actions.duplicateAction ? [actions.duplicateAction] : []),
            ...(savedOrderId
              ? [
                  {
                    label: "Print",
                    onClick: () => window.print(),
                  },
                ]
              : []),
            ...(savedOrderId && canDeletePurchaseOrder && actions.deleteAction
              ? [actions.deleteAction]
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
                    errorMessage={supplierIdError ?? undefined}
                    inputClassName={underlineControlClass(
                      !savedOrderId && !draftValues.supplierId,
                    )}
                    labelClassName={styles.formLabel}
                    required
                    invalid={!savedOrderId && !draftValues.supplierId}
                  />
                </div>
                <div className={styles.formField}>
                  <Field data-invalid={orderNumberError != null}>
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
                    {orderNumberError ? <FieldError>{orderNumberError}</FieldError> : null}
                  </Field>
                </div>
                <div className={styles.formField}>
                  <CardField
                    label="Expected arrival"
                    htmlFor="expectedDate"
                    required
                    invalid={expectedDateError != null}
                    error={expectedDateError}
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
                        aria-invalid={expectedDateError != null}
                        className={underlineControlClass(expectedDateError != null)}
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
                    readOnly={materialLinesReadOnly}
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
                readOnly={materialLinesReadOnly}
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
                      className="inline-flex min-h-7 items-center gap-(--space-1) rounded-[var(--radius-md)] border-0 bg-transparent px-(--space-3) py-0 text-[length:var(--text-sm)] font-medium text-[var(--color-accent-ink)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) hover:bg-[var(--color-accent-soft)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={additionalCostsReadOnly}
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
                  readOnly={additionalCostsReadOnly}
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
                {notesError ? <FieldError>{notesError}</FieldError> : null}
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
        fileError={fileActionError}
        onValuesChange={setPoEmailDialogValues}
        onOpenChange={(open) => setPoEmailDialogOpen(open)}
        onAddDocuments={(groupKey) => {
          emailAttachmentUploadGroupKeyRef.current = groupKey;
          fileInputRef.current?.click();
        }}
        onRemoveDocument={(groupKey, fileId) => {
          setPoEmailDialogValues((current) => ({
            ...current,
            groups: (current.groups ?? []).map((group) =>
              group.groupKey === groupKey
                ? {
                    ...group,
                    attachmentFileIds: (group.attachmentFileIds ?? []).filter(
                      (id) => id !== fileId,
                    ),
                  }
                : group,
            ),
          }));
        }}
        onSaveRecipientEmail={(groupKey, supplierId, email) =>
          saveSupplierEmailMutation.mutate({
            groupKey,
            supplierId,
            email,
          })
        }
        onSend={() => purchaseOrderEmailMutation.mutate()}
      />
      {actions.dialogs}
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
        open={additionalCostSupplierDialogOpen}
        onOpenChange={(open) => {
          if (!open && !additionalCostSupplierMutation.isPending) closeAdditionalCostSupplierDialog(null);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
          </DialogHeader>
          <form
            id="add-supplier-form"
            onSubmit={additionalCostSupplierForm.handleSubmit(handleAdditionalCostSupplierDialogSubmit)}
          >
            {additionalCostSupplierMutation.error ? (
              <FieldError>
                {(additionalCostSupplierMutation.error as ApiError).error ??
                  "Failed to create supplier."}
              </FieldError>
            ) : null}
            <FieldGroup className="gap-4">
              <Controller
                control={additionalCostSupplierForm.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="supplier-name">
                      Name<span className={styles.requiredMark}> *</span>
                    </FieldLabel>
                    <Input
                      {...field}
                      id="supplier-name"
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
              <Controller
                control={additionalCostSupplierForm.control}
                name="contactName"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="supplier-contact-name">
                      Contact Name
                    </FieldLabel>
                    <Input
                      {...field}
                      id="supplier-contact-name"
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
                control={additionalCostSupplierForm.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="supplier-email">Email</FieldLabel>
                    <Input
                      {...field}
                      id="supplier-email"
                      type="email"
                      value={field.value ?? ""}
                      onChange={(event) =>
                        field.onChange(event.target.value || null)
                      }
                      aria-invalid={fieldState.invalid}
                      autoComplete="email"
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
              disabled={additionalCostSupplierMutation.isPending}
              onClick={() => closeAdditionalCostSupplierDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-supplier-form"
              disabled={additionalCostSupplierMutation.isPending}
            >
              {additionalCostSupplierMutation.isPending ? "Saving..." : "Add Supplier"}
            </Button>
          </DialogFooter>
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

