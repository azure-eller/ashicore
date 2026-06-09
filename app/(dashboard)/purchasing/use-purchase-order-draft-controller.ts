"use client";

import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  insertPurchaseOrderSchema,
  type InsertPurchaseOrder,
} from "@/lib/schemas/purchase-orders";
import {
  useDraftSaveEngine,
  type DraftServerMergeContext,
} from "@/lib/hooks/use-draft-save-engine";
import type {
  PurchaseOrderDetail,
  PurchaseOrderEditData,
} from "./types";

export type PurchaseOrderFormValues = z.input<typeof insertPurchaseOrderSchema>;

type PurchaseOrderLinePayloadRow = InsertPurchaseOrder["lines"][number];
type PurchaseOrderAdditionalCostPayloadRow = NonNullable<
  InsertPurchaseOrder["additionalCosts"]
>[number];

export type PurchaseOrderLineDraftRow = PurchaseOrderLinePayloadRow & {
  id: string | null;
  clientRowId: string;
  quantityReceived?: string | null;
  stockQuantityReceived?: string | null;
};

export type PurchaseOrderAdditionalCostDraftRow =
  PurchaseOrderAdditionalCostPayloadRow & {
    id: string | null;
    clientRowId: string;
  };

export type PurchaseOrderDraft = Omit<
  PurchaseOrderFormValues,
  "lines" | "additionalCosts"
> & {
  lines: PurchaseOrderLineDraftRow[];
  additionalCosts: PurchaseOrderAdditionalCostDraftRow[];
};

type PurchaseOrderDraftOp =
  | { type: "patchHeader"; patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">> }
  | { type: "replaceLines"; rows: PurchaseOrderLineDraftRow[] }
  | { type: "replaceAdditionalCosts"; rows: PurchaseOrderAdditionalCostDraftRow[] };

export type PurchaseOrderDraftController = {
  draft: PurchaseOrderDraft;
  currentOrderId: string | null;
  hasPersistedOrder: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  patchHeader: (
    patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">>,
    delayMs?: number,
  ) => void;
  replaceLines: (rows: PurchaseOrderLineDraftRow[], delayMs?: number) => void;
  replaceAdditionalCosts: (
    rows: PurchaseOrderAdditionalCostDraftRow[],
    delayMs?: number,
  ) => void;
  flush: () => Promise<void>;
  resetToSaved: () => void;
  hasPendingOps: () => boolean;
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
  line: PurchaseOrderLinePayloadRow | undefined,
) {
  const itemId = line?.itemId?.trim() ?? "";
  const quantityOrdered = line?.quantityOrdered?.trim() ?? "";
  const unitCost = line?.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
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

export function toPurchaseOrderLinePayloadRows(
  rows: PurchaseOrderLineDraftRow[],
): PurchaseOrderLinePayloadRow[] {
  return rows
    .filter((row) => !isBlankPurchaseOrderLine(row))
    .map((row) => ({
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
  cost: PurchaseOrderAdditionalCostPayloadRow | undefined,
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

function hasPurchaseOrderAdditionalCostAmount(
  cost: PurchaseOrderAdditionalCostPayloadRow | undefined,
) {
  return Boolean(cost?.amount?.trim());
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
    .map(({ costType, reference, supplierId, distributionMethod, amount }) => ({
      costType: costType ?? "shipping",
      reference: reference ?? null,
      supplierId: supplierId ?? null,
      distributionMethod: distributionMethod ?? "by_value",
      accountingPurchaseAccountCode: null,
      amount: amount ?? null,
    }));
}

export function purchaseOrderDraftToPayload(
  draft: PurchaseOrderDraft,
): InsertPurchaseOrder {
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
    orderNumber: values.orderNumber ?? null,
    accountingPurchaseAccountCode: null,
    lines: values.lines.map((line) =>
      createPurchaseOrderLineRow({
        ...line,
        taxRateId: line.taxRateId ?? defaultTaxRateId,
      }),
    ),
    additionalCosts: (values.additionalCosts ?? []).map((cost) =>
      createPurchaseOrderAdditionalCostRow(cost),
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
    shipLine1: data.shipLine1,
    shipLine2: data.shipLine2,
    shipCity: data.shipCity,
    shipRegion: data.shipRegion,
    shipPostcode: data.shipPostcode,
    shipCountry: data.shipCountry,
    lines: data.lines.map((line) =>
      createPurchaseOrderLineRow({
        id: line.id ?? null,
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
  previous?: PurchaseOrderDraft,
): PurchaseOrderDraft {
  const previousLineIdByItem = new Map(
    previous?.lines.map((line) => [line.itemId, line.clientRowId]) ?? [],
  );
  const previousCostIdById = new Map(
    previous?.additionalCosts
      .filter((cost) => cost.id)
      .map((cost) => [cost.id, cost.clientRowId]) ?? [],
  );

  return {
    orderNumber: detail.orderNumber,
    supplierId: detail.supplierId,
    expectedDate: detail.expectedDate,
    shippingCost: detail.shippingCost,
    notes: detail.notes,
    accountingPurchaseAccountCode: detail.accountingPurchaseAccountCode,
    shipLine1: detail.shipLine1,
    shipLine2: detail.shipLine2,
    shipCity: detail.shipCity,
    shipRegion: detail.shipRegion,
    shipPostcode: detail.shipPostcode,
    shipCountry: detail.shipCountry,
    lines: detail.lines.map((line) =>
      createPurchaseOrderLineRow({
        id: line.id,
        clientRowId: previousLineIdByItem.get(line.itemId),
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
        clientRowId: previousCostIdById.get(cost.id),
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
  persist,
  queryClient,
  onPersisted,
  onResult,
}: {
  initialData?: PurchaseOrderEditData;
  defaultValues?: InsertPurchaseOrder;
  defaultTaxRateId: string | null;
  persist: (
    orderId: string | null,
    values: InsertPurchaseOrder,
  ) => Promise<PurchaseOrderDetail>;
  queryClient: QueryClient;
  onPersisted?: (id: string) => void;
  onResult?: (result: PurchaseOrderDetail, draft: PurchaseOrderDraft) => void;
}): PurchaseOrderDraftController {
  const headerRevisionRef = useRef<Partial<Record<keyof PurchaseOrderDraft, number>>>({});
  const latestLineRevisionRef = useRef(0);
  const latestAdditionalCostRevisionRef = useRef(0);
  const initialDraft = useMemo(
    () =>
      initialData
        ? purchaseOrderEditDataToDraft(initialData)
        : purchaseOrderDefaultDraft({ defaultValues, defaultTaxRateId }),
    [defaultTaxRateId, defaultValues, initialData],
  );

  const applyOp = useCallback(
    (current: PurchaseOrderDraft, op: PurchaseOrderDraftOp, revision: number) => {
      switch (op.type) {
        case "patchHeader":
          for (const key of Object.keys(op.patch) as Array<keyof PurchaseOrderDraft>) {
            headerRevisionRef.current[key] = revision;
          }
          return { ...current, ...op.patch };
        case "replaceLines":
          latestLineRevisionRef.current = revision;
          return { ...current, lines: op.rows };
        case "replaceAdditionalCosts":
          latestAdditionalCostRevisionRef.current = revision;
          return { ...current, additionalCosts: op.rows };
      }
    },
    [],
  );

  const engine = useDraftSaveEngine<PurchaseOrderDraft, PurchaseOrderDraftOp, PurchaseOrderDetail>({
    initialDraft,
    initialServerSnapshot: initialData ? purchaseOrderEditDataToDraft(initialData) : null,
    initialId: initialData?.id ?? null,
    isSaveable: (draft) => Boolean(draft.supplierId?.trim()),
    applyOp,
    create: async (draft) => persist(null, purchaseOrderDraftToPayload(draft)),
    save: async (orderId, draft, ops) => {
      if (ops.length === 0) return null;
      return persist(orderId, purchaseOrderDraftToPayload(draft));
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      orderNumber: draft.orderNumber ?? result.orderNumber,
    }),
    mergeServerOwnedFields: (draft, result, context) =>
      mergePurchaseOrderServerResult(draft, result, context, {
        headerRevisionRef,
        latestLineRevisionRef,
        latestAdditionalCostRevisionRef,
      }),
    onPersisted,
    onResult: (result, draft) => {
      queryClient.setQueryData(["purchase-order", result.id], result);
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      onResult?.(result, draft);
    },
    getErrorMessage: (error) =>
      (error as { error?: string })?.error ??
      (error instanceof Error ? error.message : "Failed to save purchase order."),
  });

  const patchHeader = useCallback(
    (
      patch: Partial<Omit<PurchaseOrderDraft, "lines" | "additionalCosts">>,
      delayMs = TEXT_FLUSH_DELAY_MS,
    ) => {
      engine.applyLocalOp({ type: "patchHeader", patch }, delayMs);
    },
    [engine],
  );

  const replaceLines = useCallback(
    (rows: PurchaseOrderLineDraftRow[], delayMs = QUICK_FLUSH_DELAY_MS) => {
      engine.applyLocalOp({ type: "replaceLines", rows }, delayMs);
    },
    [engine],
  );

  const replaceAdditionalCosts = useCallback(
    (
      rows: PurchaseOrderAdditionalCostDraftRow[],
      delayMs = QUICK_FLUSH_DELAY_MS,
    ) => {
      engine.applyLocalOp({ type: "replaceAdditionalCosts", rows }, delayMs);
    },
    [engine],
  );

  return useMemo(
    () => ({
      draft: engine.draft,
      currentOrderId: engine.currentId,
      hasPersistedOrder: engine.hasPersistedEntity,
      status: engine.status,
      error: engine.error,
      patchHeader,
      replaceLines,
      replaceAdditionalCosts,
      flush: engine.flush,
      resetToSaved: engine.resetToServer,
      hasPendingOps: engine.hasPendingOps,
    }),
    [engine, patchHeader, replaceAdditionalCosts, replaceLines],
  );
}

function mergePurchaseOrderServerResult(
  draft: PurchaseOrderDraft,
  server: PurchaseOrderDetail,
  context: DraftServerMergeContext<PurchaseOrderDraftOp>,
  refs: {
    headerRevisionRef: RefObject<Partial<Record<keyof PurchaseOrderDraft, number>>>;
    latestLineRevisionRef: RefObject<number>;
    latestAdditionalCostRevisionRef: RefObject<number>;
  },
): PurchaseOrderDraft {
  const next = purchaseOrderDetailToDraft(server, draft);
  const hasNewerLineEdits =
    refs.latestLineRevisionRef.current > context.saveStartedRevision;
  const hasNewerAdditionalCostEdits =
    refs.latestAdditionalCostRevisionRef.current > context.saveStartedRevision;

  if (context.hasNewerLocalEdits) {
    for (const key of Object.keys(draft) as Array<keyof PurchaseOrderDraft>) {
      if (key === "lines" || key === "additionalCosts") continue;
      const changedAt = refs.headerRevisionRef.current[key] ?? 0;
      if (changedAt > context.saveStartedRevision) {
        (next as unknown as Record<string, unknown>)[key] = draft[key];
      }
    }
    if (hasNewerLineEdits) next.lines = draft.lines;
    if (hasNewerAdditionalCostEdits) next.additionalCosts = draft.additionalCosts;
  }

  if (!hasNewerLineEdits) {
    next.lines = appendBlankPurchaseOrderLineRows(next.lines, draft.lines);
  }
  if (!hasNewerAdditionalCostEdits) {
    next.additionalCosts = appendIncompletePurchaseOrderAdditionalCostRows(
      next.additionalCosts,
      draft.additionalCosts,
    );
  }

  return next;
}

function appendBlankPurchaseOrderLineRows(
  serverRows: PurchaseOrderLineDraftRow[],
  draftRows: PurchaseOrderLineDraftRow[],
) {
  const blankDraftRows = draftRows.filter(
    (row) => !row.id && isBlankPurchaseOrderLine(row),
  );
  return blankDraftRows.length === 0 ? serverRows : [...serverRows, ...blankDraftRows];
}

function appendIncompletePurchaseOrderAdditionalCostRows(
  serverRows: PurchaseOrderAdditionalCostDraftRow[],
  draftRows: PurchaseOrderAdditionalCostDraftRow[],
) {
  const incompleteDraftRows = draftRows.filter(
    (row) => !row.id && !hasPurchaseOrderAdditionalCostAmount(row),
  );
  return incompleteDraftRows.length === 0
    ? serverRows
    : [...serverRows, ...incompleteDraftRows];
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
