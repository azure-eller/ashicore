"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import type { FlushOutcome } from "@/lib/card-kernel/kernel";
import {
  updateSalesOrderSchema,
  type InsertSalesOrder,
  type PatchSalesOrderHeader,
} from "@/lib/schemas/sales-orders";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderTaxRateOption,
} from "@/lib/sales/types";
import {
  calculateDiscountPercentString,
  calculateSalesLineAmounts,
} from "@/lib/sales/order-calculations";
import { makeDraftOrder, orderToUpdatePayload } from "./order-draft";

export type SalesOrderDraftHeaderPatch = PatchSalesOrderHeader &
  Partial<
    Pick<
      SalesOrderDetail,
      "customerName" | "customerEmail" | "customerProjectName"
    >
  >;

type SalesOrderLinePatch = {
  quantity?: string;
  unitPrice?: string;
  taxRateId?: string | null;
  taxRateName?: string | null;
  taxRatePercent?: string;
};

export type SalesOrderDraftController = {
  draft: SalesOrderDetail;
  currentOrderId: string | null;
  hasPersistedOrder: boolean;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  /** Line ids the server knows; everything else is a local draft line. */
  persistedLineIds: Set<string>;
  patchHeader: (patch: SalesOrderDraftHeaderPatch) => void;
  addLine: (line: SalesOrderDetailLine) => void;
  updateLine: (
    lineId: string,
    patch: SalesOrderLinePatch,
  ) => void;
  removeLine: (lineId: string) => void;
  reorderLines: (orderedIds: string[]) => void;
  flush: () => Promise<FlushOutcome>;
  resetToSaved: () => void;
  refreshFromServer: () => Promise<void>;
};

type SalesOrderDraftCreateMode = "auto-number" | "custom-number";

const QUICK_FLUSH_DELAY_MS = 150;
const TEXT_FLUSH_DELAY_MS = 850;

const LINE_PAYLOAD_KEYS = [
  "itemId",
  "quantity",
  "listUnitPrice",
  "unitPrice",
  "taxRateId",
  "discountPercent",
] as const;

function serializeSalesOrder(draft: SalesOrderDetail): {
  payload: InsertSalesOrder;
  pathAliases: Record<string, string>;
} {
  const payload = orderToUpdatePayload(draft);
  const pathAliases: Record<string, string> = {};
  payload.lines.forEach((line, index) => {
    for (const key of LINE_PAYLOAD_KEYS) {
      pathAliases[`lines.${index}.${key}`] = `lines.${line.id}.${key}`;
    }
  });
  return { payload, pathAliases };
}

export function useSalesOrderDraftController({
  initialOrder,
  initialDraft,
  timeZone,
  taxRates,
  defaultTaxRateId,
  queryClient,
  createMode = "custom-number",
  onPersisted,
}: {
  initialOrder: SalesOrderDetail | null;
  initialDraft: SalesOrderDetail;
  timeZone: string;
  taxRates: SalesOrderTaxRateOption[];
  defaultTaxRateId: string | null;
  queryClient: QueryClient;
  createMode?: SalesOrderDraftCreateMode;
  onPersisted?: (id: string) => void;
}): SalesOrderDraftController {
  const [newOrderId] = useState(() => crypto.randomUUID());
  const orderId = initialOrder?.id ?? newOrderId;
  const initialDraftFlushRef = useRef(false);

  const handleDetail = useCallback(
    (detail: SalesOrderDetail) => {
      queryClient.setQueryData(queryKeys.salesOrders.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.salesOrders.root });
      return detail;
    },
    [queryClient],
  );

  const kernel = useCardKernel<SalesOrderDetail, InsertSalesOrder>({
    entityType: "sales-order",
    id: orderId,
    initialServerDoc: initialOrder,
    initialDraft,
    makeNewDoc: () => ({
      ...makeDraftOrder(timeZone),
      taxRates,
      defaultTaxRateId,
    }),
    collections: { lines: { idKey: "id" } },
    schema: updateSalesOrderSchema,
    serialize: serializeSalesOrder,
    derive: recomputeDraftTotals,
    readVersion: (doc) => (doc.version > 0 ? doc.version : null),
    readId: (doc) => doc.id,
    create: async (payload, opts) => {
      const body: InsertSalesOrder = {
        ...payload,
        orderNumber:
          createMode === "auto-number" && !(payload.orderNumber ?? "").trim()
            ? null
            : payload.orderNumber,
      };
      const created = await apiJson<{ id: string }>("/api/sales-orders", {
        method: "POST",
        body,
        idempotencyKey: opts.idempotencyKey,
        keepalive: opts.keepalive,
        fallbackError: "Failed to save order.",
      });
      return handleDetail(
        await apiJson<SalesOrderDetail>(`/api/sales-orders/${created.id}`, {
          fallbackError: "Failed to load order.",
        }),
      );
    },
    update: async (id, payload, opts) =>
      handleDetail(
        await apiJson<SalesOrderDetail>(`/api/sales-orders/${id}`, {
          method: "PUT",
          body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
          idempotencyKey: opts.idempotencyKey,
          keepalive: opts.keepalive,
          fallbackError: "Failed to save order.",
        }),
      ),
    onCreated: (doc) => {
      onPersisted?.(doc.id);
    },
  });

  const update = kernel.update;
  const flush = kernel.flush;
  const adoptServerDoc = kernel.adoptServerDoc;
  const getPersistedId = kernel.getPersistedId;

  // Make-to-order prefills land with a saveable draft; persist it right away.
  useEffect(() => {
    if (initialOrder || initialDraftFlushRef.current) return;
    if (!initialDraft.customerId.trim()) return;
    initialDraftFlushRef.current = true;
    void flush();
  }, [flush, initialDraft, initialOrder]);

  const patchHeader = useCallback(
    (patch: SalesOrderDraftHeaderPatch) => {
      update((draft) => ({ ...draft, ...patch }) as SalesOrderDetail, {
        debounceMs: isQuickHeaderPatch(patch)
          ? QUICK_FLUSH_DELAY_MS
          : TEXT_FLUSH_DELAY_MS,
      });
    },
    [update],
  );

  const addLine = useCallback(
    (line: SalesOrderDetailLine) => {
      update((draft) => ({ ...draft, lines: [...draft.lines, line] }), {
        debounceMs: QUICK_FLUSH_DELAY_MS,
      });
    },
    [update],
  );

  const updateLine = useCallback(
    (lineId: string, patch: SalesOrderLinePatch) => {
      update(
        (draft) => ({
          ...draft,
          lines: draft.lines.map((line) =>
            line.id === lineId ? patchLine(line, patch) : line,
          ),
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      update(
        (draft) => ({
          ...draft,
          lines: draft.lines.filter((line) => line.id !== lineId),
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const reorderLines = useCallback(
    (orderedIds: string[]) => {
      update(
        (draft) => ({
          ...draft,
          lines: orderedIds
            .map((id) => draft.lines.find((line) => line.id === id))
            .filter((line): line is SalesOrderDetailLine => line != null),
        }),
        { debounceMs: QUICK_FLUSH_DELAY_MS },
      );
    },
    [update],
  );

  const refreshFromServer = useCallback(async () => {
    const persistedId = getPersistedId();
    if (!persistedId) return;
    const next = await apiJson<SalesOrderDetail>(
      `/api/sales-orders/${persistedId}`,
      { fallbackError: "Failed to load order." },
    );
    adoptServerDoc(next);
  }, [adoptServerDoc, getPersistedId]);

  const persistedLineIds = useMemo(
    () => new Set((kernel.serverDoc?.lines ?? []).map((line) => line.id)),
    [kernel.serverDoc],
  );

  return useMemo(
    () => ({
      draft: kernel.draft,
      currentOrderId: kernel.persistedId,
      hasPersistedOrder: kernel.isPersisted,
      status:
        kernel.status === "blocked"
          ? kernel.isPersisted
            ? "error"
            : "idle"
          : kernel.status === "idle"
            ? kernel.isPersisted
              ? "saved"
              : "idle"
            : kernel.status,
      error: kernel.error,
      persistedLineIds,
      patchHeader,
      addLine,
      updateLine,
      removeLine,
      reorderLines,
      flush,
      resetToSaved: kernel.resetToServer,
      refreshFromServer,
    }),
    [
      addLine,
      flush,
      kernel,
      patchHeader,
      persistedLineIds,
      refreshFromServer,
      removeLine,
      reorderLines,
      updateLine,
    ],
  );
}

function isQuickHeaderPatch(patch: SalesOrderDraftHeaderPatch) {
  return Object.keys(patch).some((key) => key !== "notes" && key !== "orderNumber");
}

function patchLine(
  line: SalesOrderDetailLine,
  patch: SalesOrderLinePatch,
): SalesOrderDetailLine {
  const quantity = patch.quantity ?? line.quantity;
  const unitPrice = patch.unitPrice ?? line.unitPrice;
  const taxRate =
    patch.taxRateId === undefined
      ? line.taxRateId
      : patch.taxRateId;
  const taxPercent = patch.taxRatePercent ?? line.taxRatePercent;
  const amounts = calculateSalesLineAmounts({
    quantity,
    unitPrice,
    taxRatePercent: taxPercent,
  });
  const listUnitPrice =
    line.listUnitPrice == null ? NaN : Number(line.listUnitPrice);
  const nextUnitPrice = Number(unitPrice);
  const discountPercent =
    patch.unitPrice == null ||
    !Number.isFinite(listUnitPrice) ||
    !Number.isFinite(nextUnitPrice) ||
    listUnitPrice <= 0
      ? line.discountPercent
      : calculateDiscountPercentString(listUnitPrice, nextUnitPrice);
  return {
    ...line,
    quantity,
    unitPrice,
    taxRateId: taxRate,
    taxRateName:
      patch.taxRateName === undefined ? line.taxRateName : patch.taxRateName,
    taxRatePercent: taxPercent,
    discountPercent,
    ...amounts,
  };
}

function recomputeDraftTotals(order: SalesOrderDetail): SalesOrderDetail {
  const productRevenue = order.lines
    .reduce((sum, line) => sum + Number(line.lineSubtotal || 0), 0)
    .toFixed(2);
  const lineTax = order.lines
    .reduce((sum, line) => sum + Number(line.lineTaxAmount || 0), 0)
    .toFixed(2);
  const subtotalAmount = (
    Number(productRevenue) + Number(order.shippingFeeAmount || 0)
  ).toFixed(2);
  const taxAmount = (
    Number(lineTax) + Number(order.shippingFeeTaxAmount || 0)
  ).toFixed(2);
  const totalAmount = (
    Number(subtotalAmount) +
    Number(taxAmount)
  ).toFixed(2);
  return {
    ...order,
    subtotalAmount,
    taxAmount,
    totalAmount,
    marginSummary: {
      ...order.marginSummary,
      productRevenue,
      freightRecovery: (
        Number(order.shippingFeeAmount || 0) +
        Number(order.shippingFeeTaxAmount || 0)
      ).toFixed(2),
    },
  };
}
