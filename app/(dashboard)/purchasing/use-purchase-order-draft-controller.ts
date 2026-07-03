"use client";

import { useCallback, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { queryKeys } from "@/lib/client/query-keys";
import { apiJson } from "@/lib/client/api";
import type { FieldErrorRecord } from "@/lib/api/field-errors";
import {
  insertPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  type InsertPurchaseOrder,
} from "@/lib/schemas/purchase-orders";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import type {
  PurchaseOrderDetail,
  PurchaseOrderEditData,
} from "@/lib/purchasing/types";
import { hasPurchaseOrderAdditionalCostAmount } from "./purchase-order-card-shared";

export type PurchaseOrderFormValues = z.input<typeof insertPurchaseOrderSchema>;

type PurchaseOrderLinePayloadRow = InsertPurchaseOrder["lines"][number];
type PurchaseOrderAdditionalCostPayloadRow = NonNullable<
  InsertPurchaseOrder["additionalCosts"]
>[number];

export type PurchaseOrderLineDraftRow = Omit<PurchaseOrderLinePayloadRow, "id"> & {
  id: string | null;
  clientRowId: string;
  quantityReceived?: string | null;
  stockQuantityReceived?: string | null;
};

export type PurchaseOrderAdditionalCostDraftRow = Omit<
  PurchaseOrderAdditionalCostPayloadRow,
  "id"
> & {
  id: string | null;
  clientRowId: string;
};

export type PurchaseOrderDraft = Omit<
  PurchaseOrderFormValues,
  "id" | "lines" | "additionalCosts"
> & {
  version: number;
  lines: PurchaseOrderLineDraftRow[];
  additionalCosts: PurchaseOrderAdditionalCostDraftRow[];
};

export type PurchaseOrderDraftController = {
  draft: PurchaseOrderDraft;
  currentOrderId: string | null;
  hasPersistedOrder: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  fieldErrors: FieldErrorRecord | null;
  patchHeader: (
    patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">>,
    delayMs?: number,
  ) => void;
  replaceLines: (rows: PurchaseOrderLineDraftRow[], delayMs?: number) => void;
  replaceAdditionalCosts: (
    rows: PurchaseOrderAdditionalCostDraftRow[],
    delayMs?: number,
  ) => void;
  flush: () => Promise<FlushOutcome>;
  resetToSaved: () => void;
};

const QUICK_FLUSH_DELAY_MS = 150;
const TEXT_FLUSH_DELAY_MS = 1200;

const blankPurchaseOrderLine = {
  itemId: "",
  quantityOrdered: null,
  unitCost: null,
  taxRateId: null,
  accountingPurchaseAccountCode: null,
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

const blankPurchaseOrderAdditionalCost = {
  costType: "shipping" as const,
  reference: null,
  supplierId: null,
  distributionMethod: "by_value" as const,
  accountingPurchaseAccountCode: null,
  amount: null,
};

export function isBlankPurchaseOrderLine(
  line: Omit<PurchaseOrderLinePayloadRow, "id"> | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
}

function hasCompletePurchaseOrderMaterialLine(
  line: Omit<PurchaseOrderLinePayloadRow, "id"> | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  const quantity = Number(quantityOrdered);
  const cost = Number(unitCost);
  return (
    itemId !== "" &&
    quantityOrdered !== "" &&
    unitCost !== "" &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(cost) &&
    cost >= 0
  );
}

export function createPurchaseOrderLineRow(
  values?: Partial<PurchaseOrderLineDraftRow>,
): PurchaseOrderLineDraftRow {
  return {
    ...blankPurchaseOrderLine,
    ...values,
    id: values?.id ?? null,
    itemId: values?.itemId ?? "",
    clientRowId: values?.clientRowId ?? crypto.randomUUID(),
  };
}

const LINE_PAYLOAD_KEYS = [
  "itemId",
  "quantityOrdered",
  "unitCost",
  "taxRateId",
  "shipAddressEntryId",
  "shipContactName",
  "shipContactPhone",
  "shipLine1",
  "shipLine2",
  "shipCity",
  "shipRegion",
  "shipPostcode",
  "shipCountry",
  "shipDeliveryInstructions",
] as const;

const ADDITIONAL_COST_PAYLOAD_KEYS = [
  "costType",
  "reference",
  "supplierId",
  "distributionMethod",
  "amount",
] as const;

export function toPurchaseOrderLinePayloadRows(
  rows: PurchaseOrderLineDraftRow[],
): PurchaseOrderLinePayloadRow[] {
  return rows
    .filter((row) => !isBlankPurchaseOrderLine(row))
    .map((row) => ({
      // The row id is the persisted line id: existing rows carry their DB id,
      // new rows mint one the server persists, so identity survives saves.
      id: row.clientRowId,
      itemId: row.itemId ?? "",
      quantityOrdered: row.quantityOrdered ?? null,
      unitCost: row.unitCost ?? null,
      taxRateId: row.taxRateId ?? null,
      accountingPurchaseAccountCode: null,
      shipAddressEntryId: row.shipAddressEntryId ?? null,
      shipContactName: row.shipContactName ?? null,
      shipContactPhone: row.shipContactPhone ?? null,
      shipLine1: row.shipLine1 ?? null,
      shipLine2: row.shipLine2 ?? null,
      shipCity: row.shipCity ?? null,
      shipRegion: row.shipRegion ?? null,
      shipPostcode: row.shipPostcode ?? null,
      shipCountry: row.shipCountry ?? null,
      shipDeliveryInstructions: row.shipDeliveryInstructions ?? null,
    }));
}

export function isBlankPurchaseOrderAdditionalCost(
  cost: Omit<PurchaseOrderAdditionalCostPayloadRow, "id"> | undefined,
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

export function createPurchaseOrderAdditionalCostRow(
  values?: Partial<PurchaseOrderAdditionalCostDraftRow>,
): PurchaseOrderAdditionalCostDraftRow {
  return {
    clientRowId: values?.clientRowId ?? crypto.randomUUID(),
    id: values?.id ?? null,
    costType: values?.costType ?? blankPurchaseOrderAdditionalCost.costType,
    reference: values?.reference ?? blankPurchaseOrderAdditionalCost.reference,
    distributionMethod:
      values?.distributionMethod ??
      blankPurchaseOrderAdditionalCost.distributionMethod,
    supplierId:
      values?.supplierId ??
      blankPurchaseOrderAdditionalCost.supplierId,
    accountingPurchaseAccountCode:
      values?.accountingPurchaseAccountCode ??
      blankPurchaseOrderAdditionalCost.accountingPurchaseAccountCode,
    amount: values?.amount ?? blankPurchaseOrderAdditionalCost.amount,
  };
}

export function toPurchaseOrderAdditionalCostPayloadRows(
  rows: PurchaseOrderAdditionalCostDraftRow[],
): PurchaseOrderAdditionalCostPayloadRow[] {
  return rows
    .filter(hasPurchaseOrderAdditionalCostAmount)
    .map((row) => ({
      id: row.clientRowId,
      costType: row.costType ?? "shipping",
      reference: row.reference ?? null,
      supplierId: row.supplierId ?? null,
      distributionMethod: row.distributionMethod ?? "by_value",
      accountingPurchaseAccountCode: null,
      amount: row.amount ?? null,
    }));
}

export function purchaseOrderDraftToPayload(
  draft: PurchaseOrderDraft,
): Omit<InsertPurchaseOrder, "id"> {
  return {
    orderNumber: draft.orderNumber ?? null,
    supplierId: draft.supplierId,
    expectedDate: draft.expectedDate ?? null,
    shippingCost: draft.shippingCost ?? "0",
    notes: draft.notes ?? null,
    accountingPurchaseAccountCode: draft.accountingPurchaseAccountCode ?? null,
    shipLine1: draft.shipLine1 ?? null,
    shipLine2: draft.shipLine2 ?? null,
    shipCity: draft.shipCity ?? null,
    shipRegion: draft.shipRegion ?? null,
    shipPostcode: draft.shipPostcode ?? null,
    shipCountry: draft.shipCountry ?? null,
    lines: toPurchaseOrderLinePayloadRows(draft.lines),
    additionalCosts: toPurchaseOrderAdditionalCostPayloadRows(draft.additionalCosts),
  };
}

function serializePurchaseOrder(draft: PurchaseOrderDraft): {
  payload: Omit<InsertPurchaseOrder, "id">;
  pathAliases: Record<string, string>;
} {
  const payload = purchaseOrderDraftToPayload(draft);
  const pathAliases: Record<string, string> = {};
  payload.lines.forEach((line, index) => {
    for (const key of LINE_PAYLOAD_KEYS) {
      pathAliases[`lines.${index}.${key}`] = `lines.${line.id}.${key}`;
    }
  });
  (payload.additionalCosts ?? []).forEach((cost, index) => {
    for (const key of ADDITIONAL_COST_PAYLOAD_KEYS) {
      pathAliases[`additionalCosts.${index}.${key}`] =
        `additionalCosts.${cost.id}.${key}`;
    }
  });
  return { payload, pathAliases };
}

export function purchaseOrderDefaultDraft({
  defaultValues,
  defaultTaxRateId,
}: {
  defaultValues?: InsertPurchaseOrder;
  defaultTaxRateId: string | null;
}): PurchaseOrderDraft {
  const values = defaultValues ?? purchaseOrderDefaultValuesFallback;
  return {
    ...values,
    version: 0,
    orderNumber: values.orderNumber ?? null,
    accountingPurchaseAccountCode: null,
    lines: values.lines.map((line) =>
      createPurchaseOrderLineRow({
        ...line,
        id: null,
        taxRateId: line.taxRateId ?? defaultTaxRateId,
      }),
    ),
    additionalCosts: (values.additionalCosts ?? []).map((cost) =>
      createPurchaseOrderAdditionalCostRow({ ...cost, id: null }),
    ),
  };
}

export function purchaseOrderEditDataToDraft(
  data: PurchaseOrderEditData,
): PurchaseOrderDraft {
  return {
    orderNumber: data.orderNumber,
    supplierId: data.supplierId,
    expectedDate: data.expectedDate,
    shippingCost: data.shippingCost,
    notes: data.notes,
    accountingPurchaseAccountCode: null,
    version: data.version,
    shipLine1: data.shipLine1,
    shipLine2: data.shipLine2,
    shipCity: data.shipCity,
    shipRegion: data.shipRegion,
    shipPostcode: data.shipPostcode,
    shipCountry: data.shipCountry,
    lines: data.lines.map((line) =>
      createPurchaseOrderLineRow({
        id: line.id ?? null,
        clientRowId: line.id ?? undefined,
        itemId: line.itemId,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
        stockQuantityReceived: line.stockQuantityReceived,
        unitCost: line.unitCost,
        taxRateId: line.taxRateId,
        accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
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
      }),
    ),
    additionalCosts: data.additionalCosts.map((cost) =>
      createPurchaseOrderAdditionalCostRow({
        id: cost.id ?? null,
        clientRowId: cost.id ?? undefined,
        costType: cost.costType,
        reference: cost.reference,
        supplierId: cost.supplierId,
        distributionMethod: cost.distributionMethod,
        accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
        amount: cost.amount,
      }),
    ),
  };
}

export function purchaseOrderDetailToDraft(
  detail: PurchaseOrderDetail,
): PurchaseOrderDraft {
  return {
    orderNumber: detail.orderNumber,
    supplierId: detail.supplierId,
    expectedDate: detail.expectedDate,
    shippingCost: detail.shippingCost,
    notes: detail.notes,
    accountingPurchaseAccountCode: detail.accountingPurchaseAccountCode,
    version: detail.version,
    shipLine1: detail.shipLine1,
    shipLine2: detail.shipLine2,
    shipCity: detail.shipCity,
    shipRegion: detail.shipRegion,
    shipPostcode: detail.shipPostcode,
    shipCountry: detail.shipCountry,
    lines: detail.lines.map((line) =>
      createPurchaseOrderLineRow({
        id: line.id,
        clientRowId: line.id,
        itemId: line.itemId,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
        stockQuantityReceived: line.stockQuantityReceived,
        unitCost: line.unitCost,
        taxRateId: line.taxRateId,
        accountingPurchaseAccountCode: line.accountingPurchaseAccountCode,
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
      }),
    ),
    additionalCosts: detail.additionalCosts.map((cost) =>
      createPurchaseOrderAdditionalCostRow({
        id: cost.id,
        clientRowId: cost.id,
        costType: cost.costType,
        reference: cost.reference,
        supplierId: cost.supplierId,
        distributionMethod: cost.distributionMethod,
        accountingPurchaseAccountCode: cost.accountingPurchaseAccountCode,
        amount: cost.amount,
      }),
    ),
  };
}

export function usePurchaseOrderDraftController({
  initialData,
  defaultValues,
  defaultTaxRateId,
  queryClient,
  onPersisted,
  onResult,
}: {
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
  defaultTaxRateId: string | null;
  queryClient: QueryClient;
  onPersisted?: (id: string) => void;
  onResult?: (result: PurchaseOrderDetail, draft: PurchaseOrderDraft) => void;
}): PurchaseOrderDraftController {
  const [newOrderId] = useState(() => crypto.randomUUID());
  const orderId = initialData?.id ?? newOrderId;
  const initialServerDoc = useMemo(
    () => (initialData ? purchaseOrderEditDataToDraft(initialData) : null),
    [initialData],
  );

  const handleDetail = useCallback(
    (detail: PurchaseOrderDetail) => {
      const draft = purchaseOrderDetailToDraft(detail);
      queryClient.setQueryData(queryKeys.purchaseOrders.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.root });
      onResult?.(detail, draft);
      return draft;
    },
    [onResult, queryClient],
  );

  const kernel = useCardKernel<PurchaseOrderDraft, Omit<InsertPurchaseOrder, "id">>({
    entityType: "purchase-order",
    id: orderId,
    initialServerDoc,
    makeNewDoc: () =>
      purchaseOrderDefaultDraft({ defaultValues, defaultTaxRateId }),
    collections: {
      lines: { idKey: "clientRowId" },
      additionalCosts: { idKey: "clientRowId" },
    },
    schema: updatePurchaseOrderSchema,
    serialize: serializePurchaseOrder,
    readVersion: (doc) => (doc.version > 0 ? doc.version : null),
    readConflictDoc: (current) =>
      purchaseOrderDetailToDraft(current as PurchaseOrderDetail),
    create: async (payload, opts) =>
      handleDetail(
        await apiJson<PurchaseOrderDetail>("/api/purchase-orders", {
          method: "POST",
          body: { ...payload, id: orderId },
          idempotencyKey: opts.idempotencyKey,
          keepalive: opts.keepalive,
          fallbackError: "Failed to save purchase order.",
        }),
      ),
    update: async (id, payload, opts) =>
      handleDetail(
        await apiJson<PurchaseOrderDetail>(`/api/purchase-orders/${id}`, {
          method: "PUT",
          body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
          idempotencyKey: opts.idempotencyKey,
          keepalive: opts.keepalive,
          fallbackError: "Failed to save purchase order.",
        }),
      ),
    onCreated: () => {
      onPersisted?.(orderId);
    },
  });

  const update = kernel.update;
  const deferFirstSave = useCallback(
    ({
      supplierId = kernel.draft.supplierId,
      lines = kernel.draft.lines,
    }: {
      supplierId?: string | null;
      lines?: PurchaseOrderLineDraftRow[];
    } = {}) =>
      !kernel.isPersisted &&
      (!(supplierId ?? "").trim() ||
        !lines.some(hasCompletePurchaseOrderMaterialLine)),
    [kernel.draft.lines, kernel.draft.supplierId, kernel.isPersisted],
  );
  const patchHeader = useCallback(
    (
      patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">>,
      delayMs = TEXT_FLUSH_DELAY_MS,
    ) => {
      update((draft) => ({ ...draft, ...patch }), {
        debounceMs: deferFirstSave({ supplierId: patch.supplierId ?? undefined })
          ? Number.POSITIVE_INFINITY
          : delayMs,
      });
    },
    [deferFirstSave, update],
  );

  const replaceLines = useCallback(
    (rows: PurchaseOrderLineDraftRow[], delayMs = QUICK_FLUSH_DELAY_MS) => {
      update((draft) => ({ ...draft, lines: rows }), {
        debounceMs: deferFirstSave({ lines: rows })
          ? Number.POSITIVE_INFINITY
          : delayMs,
      });
    },
    [deferFirstSave, update],
  );

  const replaceAdditionalCosts = useCallback(
    (
      rows: PurchaseOrderAdditionalCostDraftRow[],
      delayMs = QUICK_FLUSH_DELAY_MS,
    ) => {
      update((draft) => ({ ...draft, additionalCosts: rows }), {
        debounceMs: deferFirstSave() ? Number.POSITIVE_INFINITY : delayMs,
      });
    },
    [deferFirstSave, update],
  );

  return useMemo(
    () => ({
      draft: kernel.draft,
      currentOrderId: kernel.isPersisted ? orderId : null,
      hasPersistedOrder: kernel.isPersisted,
      status:
        kernel.status === "blocked"
          ? "error"
          : kernel.status === "idle"
            ? kernel.isPersisted
              ? "saved"
              : "idle"
            : kernel.status,
      error: kernel.error,
      fieldErrors: kernel.fieldErrors,
      patchHeader,
      replaceLines,
      replaceAdditionalCosts,
      flush: kernel.flush,
      resetToSaved: kernel.resetToServer,
    }),
    [kernel, orderId, patchHeader, replaceAdditionalCosts, replaceLines],
  );
}

const purchaseOrderDefaultValuesFallback: InsertPurchaseOrder = {
  orderNumber: null,
  supplierId: "",
  expectedDate: null,
  shippingCost: "0",
  notes: null,
  accountingPurchaseAccountCode: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostcode: null,
  shipCountry: null,
  lines: [],
  additionalCosts: [],
};
