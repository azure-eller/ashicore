"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  createSalesOrder,
  fetchSalesOrderDetail,
  patchSalesOrderHeader,
  patchSalesOrderLine,
  updateSalesOrderFull,
} from "@/lib/api/clients/sales-orders";
import {
  useDraftSaveEngine,
  type DraftServerMergeContext,
  type QueuedDraftOp,
} from "@/lib/hooks/use-draft-save-engine";
import type { PatchSalesOrderHeader } from "@/lib/schemas/sales-orders";
import type {
  SalesOrderDetail,
  SalesOrderDetailLine,
} from "@/app/(dashboard)/sales/types";
import {
  calculateDiscountPercentString,
  calculateSalesLineAmounts,
} from "@/lib/sales/order-calculations";
import {
  draftToInsertPayload,
  orderToUpdatePayload,
} from "./order-draft";

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
  patchHeader: (patch: SalesOrderDraftHeaderPatch) => void;
  addLine: (line: SalesOrderDetailLine) => void;
  updateLine: (
    lineId: string,
    patch: SalesOrderLinePatch,
  ) => void;
  removeLine: (lineId: string) => void;
  reorderLines: (orderedIds: string[]) => void;
  flush: () => Promise<void>;
  resetToSaved: () => void;
  refreshFromServer: () => Promise<void>;
};

type SalesOrderDraftCreateMode = "auto-number" | "custom-number";

type SalesOrderDraftOp =
  | { type: "patchHeader"; patch: SalesOrderDraftHeaderPatch }
  | { type: "addLine"; line: SalesOrderDetailLine }
  | {
      type: "updateLine";
      lineId: string;
      patch: SalesOrderLinePatch;
    }
  | { type: "removeLine"; lineId: string }
  | { type: "reorderLines"; orderedIds: string[] };

const QUICK_FLUSH_DELAY_MS = 150;
const TEXT_FLUSH_DELAY_MS = 850;

const PERSISTED_HEADER_KEYS = [
  "orderNumber",
  "customerId",
  "customerProjectId",
  "orderDate",
  "shipDate",
  "requestedDate",
  "notes",
  "shipLine1",
  "shipLine2",
  "shipCity",
  "shipRegion",
  "shipPostcode",
  "shipCountry",
  "billingLine1",
  "billingLine2",
  "billingCity",
  "billingRegion",
  "billingPostcode",
  "billingCountry",
  "shippingFeeDescription",
  "shippingFeeAmount",
  "shippingFeeTaxAmount",
] as const satisfies ReadonlyArray<keyof PatchSalesOrderHeader>;

const HEADER_DISPLAY_KEYS = [
  "customerName",
  "customerEmail",
  "customerProjectName",
] as const satisfies ReadonlyArray<keyof SalesOrderDetail>;

const SERVER_OWNED_LINE_KEYS = [
  "shippedQuantity",
  "plannedQuantity",
  "cancelledQuantity",
  "remainingQuantity",
  "unplannedRemainingQuantity",
  "actualUnitCost",
  "actualCogs",
  "actualGrossProfit",
  "actualMarginPercent",
  "updatedAt",
  "onHandQty",
  "availableQty",
  "allocatedQty",
  "potential",
  "shortQty",
  "sourceSummary",
  "allocationStatus",
  "allocationSources",
  "demandQueuePinnedQty",
  "demandQueuePinnedDateValidQty",
  "demandQueuePinnedDateInvalidQty",
  "demandQueueQueueCoveredQty",
  "demandQueueSegments",
  "demandQueueInStockQty",
  "demandQueueExpectedQty",
  "demandQueueShortQty",
  "demandQueueExpectedDate",
  "fulfillmentSummary",
  "lotPickPlan",
] as const satisfies ReadonlyArray<keyof SalesOrderDetailLine>;

type SalesOrderHeaderKey =
  | (typeof PERSISTED_HEADER_KEYS)[number]
  | (typeof HEADER_DISPLAY_KEYS)[number];

export function useSalesOrderDraftController({
  initialOrder,
  initialDraft,
  queryClient,
  createMode = "custom-number",
  onPersisted,
}: {
  initialOrder: SalesOrderDetail | null;
  initialDraft: SalesOrderDetail;
  queryClient: QueryClient;
  createMode?: SalesOrderDraftCreateMode;
  onPersisted?: (id: string) => void;
}): SalesOrderDraftController {
  const headerRevisionRef = useRef<
    Partial<Record<keyof SalesOrderDraftHeaderPatch, number>>
  >({});
  const latestLineRevisionRef = useRef(0);
  const initialDraftFlushRef = useRef(false);

  const applyOp = useCallback(
    (current: SalesOrderDetail, op: SalesOrderDraftOp, revision: number) => {
      switch (op.type) {
        case "patchHeader":
          for (const key of [...PERSISTED_HEADER_KEYS, ...HEADER_DISPLAY_KEYS]) {
            if (key in op.patch) {
              headerRevisionRef.current[key] = revision;
            }
          }
          return recomputeDraftTotals({
            ...current,
            ...op.patch,
          } as SalesOrderDetail);
        case "addLine":
          latestLineRevisionRef.current = revision;
          return recomputeDraftTotals({
            ...current,
            lines: [...current.lines, op.line],
          });
        case "updateLine":
          latestLineRevisionRef.current = revision;
          return recomputeDraftTotals({
            ...current,
            lines: current.lines.map((line) =>
              line.id === op.lineId ? patchLine(line, op.patch) : line,
            ),
          });
        case "removeLine":
          latestLineRevisionRef.current = revision;
          return recomputeDraftTotals({
            ...current,
            lines: current.lines.filter((line) => line.id !== op.lineId),
          });
        case "reorderLines":
          latestLineRevisionRef.current = revision;
          return recomputeDraftTotals({
            ...current,
            lines: op.orderedIds
              .map((id) => current.lines.find((line) => line.id === id))
              .filter((line): line is SalesOrderDetailLine => line != null),
          });
      }
    },
    [],
  );

  const engine = useDraftSaveEngine<SalesOrderDetail, SalesOrderDraftOp, SalesOrderDetail>({
    initialDraft: initialOrder ?? initialDraft,
    initialServerSnapshot: initialOrder,
    initialId: initialOrder?.id ?? null,
    isSaveable,
    applyOp,
    create: async (draft) => {
      const created = await createSalesOrder(
        draftToInsertPayload(draft, {
          useServerOrderNumber:
            createMode === "auto-number" && !draft.orderNumber.trim(),
        }),
      );
      return fetchSalesOrderDetail(created.id);
    },
    save: async (orderId, draft, ops) => {
      if (ops.length === 0) return null;
      return saveSalesOrderOps(orderId, draft, ops);
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      id: draft.id || result.id,
      orderNumber: draft.orderNumber || result.orderNumber,
    }),
    mergeServerOwnedFields: (draft, result, context) =>
      mergeSalesOrderServerResult(draft, result, context, {
        headerRevisionRef,
        latestLineRevisionRef,
      }),
    onPersisted,
    onResult: (result, draft) => {
      queryClient.setQueryData(["sales-order", result.id], draft);
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
  });

  useEffect(() => {
    if (initialOrder || initialDraftFlushRef.current || !isSaveable(initialDraft)) return;
    initialDraftFlushRef.current = true;
    void engine.flush();
  }, [engine, initialDraft, initialOrder]);

  const patchHeader = useCallback(
    (patch: SalesOrderDraftHeaderPatch) => {
      engine.applyLocalOp(
        { type: "patchHeader", patch },
        isQuickHeaderPatch(patch) ? QUICK_FLUSH_DELAY_MS : TEXT_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const addLine = useCallback(
    (line: SalesOrderDetailLine) => {
      engine.applyLocalOp({ type: "addLine", line }, QUICK_FLUSH_DELAY_MS);
    },
    [engine],
  );

  const updateLine = useCallback(
    (lineId: string, patch: SalesOrderLinePatch) => {
      engine.applyLocalOp(
        { type: "updateLine", lineId, patch },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      engine.applyLocalOp({ type: "removeLine", lineId }, QUICK_FLUSH_DELAY_MS);
    },
    [engine],
  );

  const reorderLines = useCallback(
    (orderedIds: string[]) => {
      engine.applyLocalOp(
        { type: "reorderLines", orderedIds },
        QUICK_FLUSH_DELAY_MS,
      );
    },
    [engine],
  );

  const refreshFromServer = useCallback(async () => {
    const orderId = engine.currentId;
    if (!orderId || engine.hasPendingOps()) return;
    const next = await fetchSalesOrderDetail(orderId);
    engine.mergeServerResult(next);
  }, [engine]);

  return useMemo(
    () => ({
      draft: engine.draft,
      currentOrderId: engine.currentId,
      hasPersistedOrder: engine.hasPersistedEntity,
      status: engine.status,
      error: engine.error,
      patchHeader,
      addLine,
      updateLine,
      removeLine,
      reorderLines,
      flush: engine.flush,
      resetToSaved: engine.resetToServer,
      refreshFromServer,
    }),
    [
      addLine,
      engine,
      patchHeader,
      refreshFromServer,
      removeLine,
      reorderLines,
      updateLine,
    ],
  );
}

async function saveSalesOrderOps(
  orderId: string,
  draft: SalesOrderDetail,
  queuedOps: Array<QueuedDraftOp<SalesOrderDraftOp>>,
) {
  let latest: SalesOrderDetail | null = null;
  const headerPatch = persistedHeaderPatch(mergeHeaderPatches(queuedOps));
  if (Object.keys(headerPatch).length > 0) {
    latest = await patchSalesOrderHeader(orderId, headerPatch);
    removeQueuedOps(queuedOps, (queued) => queued.op.type === "patchHeader");
  }

  const lineOps = queuedOps.filter((queued) => queued.op.type !== "patchHeader");
  if (lineOps.length === 0) return latest;

  if (lineOps.some((queued) => queued.op.type !== "updateLine")) {
    await updateSalesOrderFull(orderId, orderToUpdatePayload(draft));
    latest = await fetchSalesOrderDetail(orderId);
    removeQueuedOps(queuedOps, (queued) => queued.op.type !== "patchHeader");
    return latest;
  }

  for (const op of collapseLineUpdates(lineOps)) {
    latest = await patchSalesOrderLine(orderId, op.lineId, op.patch);
    removeQueuedOps(
      queuedOps,
      (queued) =>
        queued.op.type === "updateLine" && queued.op.lineId === op.lineId,
    );
  }
  return latest;
}

function isSaveable(order: SalesOrderDetail) {
  return order.customerId.trim().length > 0;
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

function mergeSalesOrderServerResult(
  draft: SalesOrderDetail,
  server: SalesOrderDetail,
  context: DraftServerMergeContext<SalesOrderDraftOp>,
  refs: {
    headerRevisionRef: RefObject<
      Partial<Record<keyof SalesOrderDraftHeaderPatch, number>>
    >;
    latestLineRevisionRef: RefObject<number>;
  },
): SalesOrderDetail {
  let next = mergeServerOwnedFields(draft, server);
  const hasNewerLineEdits =
    refs.latestLineRevisionRef.current > context.saveStartedRevision;

  if (context.source === "create" && !hasNewerLineEdits) {
    next = {
      ...next,
      orderNumber: server.orderNumber,
      lines: server.lines,
    };
  }

  if (context.hasNewerLocalEdits) {
    next = {
      ...next,
      id: draft.id || server.id,
      orderNumber: server.orderNumber,
    };
    for (const key of [...PERSISTED_HEADER_KEYS, ...HEADER_DISPLAY_KEYS]) {
      const changedAt = refs.headerRevisionRef.current[key] ?? 0;
      if (changedAt > context.saveStartedRevision) {
        (next as unknown as Record<string, unknown>)[key] = draft[key];
      }
    }
    if (hasNewerLineEdits) {
      next.lines = draft.lines;
    }
  } else if (context.source === "save") {
    const savedLineOps = context.savedOps.filter(
      (queued) => queued.op.type !== "patchHeader",
    );
    if (savedLineOps.length === 0) {
      next = {
        ...next,
        lines: mergeServerOwnedLineFields(draft.lines, server.lines),
      };
    } else if (!hasNewerLineEdits) {
      next = { ...next, lines: server.lines };
    }
  }

  for (const key of savedHeaderKeys(context.savedOps)) {
    const changedAt = refs.headerRevisionRef.current[key] ?? 0;
    if (changedAt >= context.saveStartedRevision) {
      (next as unknown as Record<string, unknown>)[key] = draft[key];
    }
  }

  return recomputeDraftTotals(next);
}

function mergeServerOwnedFields(
  draft: SalesOrderDetail,
  server: SalesOrderDetail,
): SalesOrderDetail {
  return {
    ...draft,
    id: draft.id || server.id,
    status: server.status,
    shippedAt: server.shippedAt,
    xeroInvoiceId: server.xeroInvoiceId,
    xeroInvoiceNumber: server.xeroInvoiceNumber,
    xeroPushStatus: server.xeroPushStatus,
    xeroPushError: server.xeroPushError,
    xeroPushedAt: server.xeroPushedAt,
    xeroPushPayloadHash: server.xeroPushPayloadHash,
    xeroLastPushAttemptAt: server.xeroLastPushAttemptAt,
    xeroRetryCount: server.xeroRetryCount,
    xeroEmailStatus: server.xeroEmailStatus,
    xeroEmailError: server.xeroEmailError,
    xeroEmailedAt: server.xeroEmailedAt,
    requestedDate: server.requestedDate,
    totalAmount: server.totalAmount,
    hasManufacturableLines: server.hasManufacturableLines,
    manufacturableLineCount: server.manufacturableLineCount,
    manufacturableDisabledReason: server.manufacturableDisabledReason,
    fulfillmentSummary: server.fulfillmentSummary,
    shippingReadiness: server.shippingReadiness,
    deletedAt: server.deletedAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    marginSummary: server.marginSummary,
    lines: mergeServerOwnedLineFields(draft.lines, server.lines),
    shipments: server.shipments,
    linkedManufacturingOrders: server.linkedManufacturingOrders,
  };
}

function mergeServerOwnedLineFields(
  draftLines: SalesOrderDetailLine[],
  serverLines: SalesOrderDetailLine[],
) {
  const serverById = new Map(serverLines.map((line) => [line.id, line]));
  return draftLines.map((draftLine) => {
    const serverLine = serverById.get(draftLine.id);
    if (!serverLine) return draftLine;
    const next = { ...draftLine };
    for (const key of SERVER_OWNED_LINE_KEYS) {
      next[key] = serverLine[key] as never;
    }
    return next;
  });
}

function mergeHeaderPatches(ops: Array<QueuedDraftOp<SalesOrderDraftOp>>) {
  return ops.reduce<Partial<SalesOrderDraftHeaderPatch>>((patch, queued) => {
    if (queued.op.type !== "patchHeader") return patch;
    return { ...patch, ...queued.op.patch };
  }, {});
}

function persistedHeaderPatch(
  patch: Partial<SalesOrderDraftHeaderPatch>,
): PatchSalesOrderHeader {
  const persisted: Partial<PatchSalesOrderHeader> = {};
  for (const key of PERSISTED_HEADER_KEYS) {
    if (key in patch) {
      (persisted as Record<string, unknown>)[key] = patch[key];
    }
  }
  return persisted as PatchSalesOrderHeader;
}

function savedHeaderKeys(ops: Array<QueuedDraftOp<SalesOrderDraftOp>>) {
  const keys = new Set<SalesOrderHeaderKey>();
  for (const queued of ops) {
    if (queued.op.type !== "patchHeader") continue;
    for (const key of [...PERSISTED_HEADER_KEYS, ...HEADER_DISPLAY_KEYS]) {
      if (key in queued.op.patch) keys.add(key);
    }
  }
  return keys;
}

function collapseLineUpdates(ops: Array<QueuedDraftOp<SalesOrderDraftOp>>) {
  const patches = new Map<string, SalesOrderLinePatch>();
  for (const queued of ops) {
    if (queued.op.type !== "updateLine") continue;
    patches.set(queued.op.lineId, {
      ...(patches.get(queued.op.lineId) ?? {}),
      ...queued.op.patch,
    });
  }
  return [...patches.entries()].map(([lineId, patch]) => ({ lineId, patch }));
}

function removeQueuedOps<TOp>(
  ops: Array<QueuedDraftOp<TOp>>,
  predicate: (queued: QueuedDraftOp<TOp>) => boolean,
) {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    if (predicate(ops[index])) ops.splice(index, 1);
  }
}
