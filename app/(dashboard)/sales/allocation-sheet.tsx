"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Factory01Icon,
  PackageIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  SalesAllocationSheetData,
  SalesAllocationSource,
  SalesAllocationSourceType,
} from "./types";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";

type AllocationDraft = Record<string, string>;
type AllocationDraftState = {
  lineId: string | null;
  values: Record<string, AllocationDraft>;
};

type AllocationTokenData = {
  sourceKey: string;
  sourceType: SalesAllocationSourceType;
  sourceId: string | null;
  sourceLabel: string;
  sourceIndex: number;
  quantity: number;
  all: boolean;
  originLineId?: string;
};

type SourceColor = "stock" | "blue" | "purple";

type Props = {
  lineId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetLineChange: (lineId: string) => void;
};

const ORDER_BUCKET_PREFIX = "order-bucket:";
const SOURCE_BUCKET_PREFIX = "source-bucket:";

function allocationKey(sourceType: SalesAllocationSourceType, sourceId: string | null) {
  return `${sourceType}:${sourceId ?? "stock_pool"}`;
}

function parseAllocationKey(key: string) {
  const [sourceType, rawSourceId] = key.split(":") as [
    SalesAllocationSourceType,
    string,
  ];
  return {
    sourceType,
    sourceId: rawSourceId === "stock_pool" ? null : rawSourceId,
  };
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function sourceLabel(label: string, date: string | null) {
  return date ? `${label} · ${formatDate(date)}` : label;
}

function shortLabel(value: number) {
  return value > 0 ? formatQuantity(toQuantityString(value)) : "\u2014";
}

function toQuantityString(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function todayDateString() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function readQuantity(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceColor(sourceType: SalesAllocationSourceType, sourceIndex: number): SourceColor {
  if (sourceType === "stock_pool") return "stock";
  return sourceIndex % 2 === 0 ? "blue" : "purple";
}

function tokenClassName(color: SourceColor, dragging = false) {
  return cn(
    "relative inline-flex h-12 min-w-12 select-none items-center justify-center rounded-md border px-3 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    "before:absolute before:inset-x-1 before:top-1 before:h-1.5 before:rounded-sm before:bg-background/45",
    color === "stock" &&
      "border-success/30 bg-success text-primary-foreground hover:bg-success/90",
    color === "blue" &&
      "border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90",
    color === "purple" &&
      "border-warning/30 bg-warning text-primary-foreground hover:bg-warning/90",
    dragging && "scale-105 shadow-lg"
  );
}

function softSourceClassName(color: SourceColor) {
  return cn(
    color === "stock" && "bg-success/10 text-success",
    color === "blue" && "bg-primary/10 text-primary",
    color === "purple" && "bg-warning/10 text-warning"
  );
}

function buildChunks(sourceType: SalesAllocationSourceType, freeQty: number) {
  if (freeQty <= 0) return [];

  const base =
    sourceType === "stock_pool"
      ? freeQty <= 5
        ? [1]
        : freeQty <= 20
          ? [1, 5, 10]
          : [1, 5, 10, 20]
      : freeQty <= 5
        ? [1]
        : freeQty <= 20
          ? [5, 10]
          : [5, 10, 20];

  return [
    ...base.filter((value) => value <= freeQty),
    { all: true, quantity: freeQty },
  ];
}

function sourceKindLabel(source: SalesAllocationSource) {
  if (source.sourceType === "stock_pool") return "Stock";
  return source.status === "draft" ? "Draft production" : "Released production";
}

function SourceToken({
  token,
  color,
  disabled,
  onClick,
  onPointerDownToken,
}: {
  token: AllocationTokenData;
  color: SourceColor;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDownToken?: (token: AllocationTokenData) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${token.sourceKey}:${token.quantity}:${token.all ? "all" : "chunk"}`,
    data: { token },
    disabled,
  });
  const style = isDragging
    ? { opacity: 0, transition: "none" }
    : { transform: CSS.Translate.toString(transform) };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={tokenClassName(color, isDragging)}
      disabled={disabled}
      onClick={onClick}
      aria-label={`Allocate ${token.all ? "all" : toQuantityString(token.quantity)} from ${token.sourceLabel}`}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        onPointerDownToken?.(token);
      }}
    >
      {formatQuantity(toQuantityString(token.quantity))}
    </button>
  );
}

function TokenPreview({
  label,
  quantity,
  color,
  token,
  onPointerDownToken,
}: {
  label: string;
  quantity: number;
  color: SourceColor;
  token?: AllocationTokenData;
  onPointerDownToken?: (token: AllocationTokenData) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: token
      ? `allocated:${token.originLineId ?? "source"}:${token.sourceKey}`
      : `preview:${label}:${quantity}`,
    data: { token },
    disabled: !token,
  });
  const style = token
    ? isDragging
      ? { opacity: 0, transition: "none" }
      : { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        tokenClassName(color, isDragging),
        token && "cursor-grab active:cursor-grabbing"
      )}
      aria-label={
        token
          ? `Move ${formatQuantity(toQuantityString(quantity))} from ${label}`
          : undefined
      }
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        if (token) onPointerDownToken?.(token);
      }}
    >
      <span>{formatQuantity(toQuantityString(quantity))}</span>
    </div>
  );
}

function OrderBucket({
  row,
  isTarget,
  allocatedQty,
  shortQty,
  children,
  onTokenDrop,
}: {
  row: SalesAllocationSheetData["demandRows"][number];
  isTarget: boolean;
  allocatedQty: number;
  shortQty: number;
  children?: React.ReactNode;
  onTokenDrop?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${ORDER_BUCKET_PREFIX}${row.salesOrderLineId}`,
  });
  const slotCount = Math.max(4, Math.min(7, Math.ceil((allocatedQty + shortQty) / 5)));

  return (
    <div
      ref={setNodeRef}
      onPointerUp={onTokenDrop}
      onMouseUp={onTokenDrop}
      data-allocation-drop-line-id={row.salesOrderLineId}
      className={cn(
        "rounded-lg border bg-card p-3 shadow-xs transition",
        isTarget && "border-primary/20 bg-primary/5",
        isTarget && isOver && "border-primary bg-primary/10 ring-2 ring-primary/15",
        !isTarget && isOver && "border-primary/60 bg-primary/5 ring-2 ring-primary/10"
      )}
      data-testid={isTarget ? "current-allocation-bucket" : "readonly-allocation-bucket"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{row.orderNumber}</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate">{row.customerName}</span>
            {isTarget ? <Badge variant="secondary">This Order</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Ship {row.shipDate ? formatDate(row.shipDate) : "\u2014"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
        <div
          className={cn(
            "flex min-h-16 flex-wrap items-center gap-2 rounded-lg border border-dashed bg-background/70 p-2",
            isTarget ? "border-primary/25" : "border-border"
          )}
        >
          {children}
          {Array.from({ length: slotCount }).map((_, index) => (
            <div
              key={index}
              className="h-12 min-w-12 rounded-md border border-dashed bg-muted/30"
              aria-hidden
            />
          ))}
        </div>
        <div className="grid min-w-24 gap-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Allocated</span>
            <span className="font-medium text-success">
              {formatQuantity(toQuantityString(allocatedQty))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Short</span>
            <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
              {shortLabel(shortQty)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceDropCard({
  sourceKey,
  color,
  canReturn,
  children,
  onTokenDrop,
}: {
  sourceKey: string;
  color: SourceColor;
  canReturn: boolean;
  children: React.ReactNode;
  onTokenDrop?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${SOURCE_BUCKET_PREFIX}${sourceKey}`,
    disabled: !canReturn,
  });

  return (
    <div
      ref={setNodeRef}
      onPointerUp={canReturn ? onTokenDrop : undefined}
      onMouseUp={canReturn ? onTokenDrop : undefined}
      data-allocation-drop-source-key={sourceKey}
      className={cn(
        "rounded-lg border bg-card p-3 shadow-xs transition",
        canReturn && "border-dashed",
        canReturn &&
          isOver &&
          color === "stock" &&
          "border-success/50 bg-success/5 ring-2 ring-success/15",
        canReturn &&
          isOver &&
          color === "blue" &&
          "border-primary/50 bg-primary/5 ring-2 ring-primary/15",
        canReturn &&
          isOver &&
          color === "purple" &&
          "border-warning/50 bg-warning/5 ring-2 ring-warning/15"
      )}
      data-testid="source-allocation-bucket"
    >
      {children}
    </div>
  );
}

export function AllocationSheet({
  lineId,
  open,
  onOpenChange,
}: Props) {
  const queryClient = useQueryClient();
  const pointerDropHandledRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeTokenRef = useRef<AllocationTokenData | null>(null);
  const [draftState, setDraftState] = useState<AllocationDraftState>({
    lineId: null,
    values: {},
  });
  const [activeToken, setActiveToken] = useState<AllocationTokenData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor)
  );
  const query = useQuery<SalesAllocationSheetData>({
    queryKey: ["sales-line-allocation", lineId],
    queryFn: () =>
      apiJson<SalesAllocationSheetData>(
        `/api/sales-order-lines/${lineId}/allocation`,
        { fallbackError: "Failed to load allocation." }
      ),
    enabled: open && lineId != null,
  });

  useEffect(() => {
    function handlePointerMove(event: PointerEvent | MouseEvent) {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
    };
  }, []);

  const data = query.data ?? null;
  const defaultDraftsByLine = useMemo(
    () =>
      Object.fromEntries(
        data?.demandRows.map((row) => [
          row.salesOrderLineId,
          Object.fromEntries(
            row.sources.map((source) => [
              allocationKey(source.sourceType, source.sourceId),
              source.quantity,
            ])
          ),
        ]) ?? []
      ),
    [data]
  );
  const draftsByLine =
    draftState.lineId === lineId ? draftState.values : defaultDraftsByLine;

  const sourceMetaByKey = useMemo(
    () =>
      new Map(
        data?.supplySources.map((source, index) => [
          allocationKey(source.sourceType, source.sourceId),
          { source, index },
        ]) ?? []
      ),
    [data]
  );

  const targetLine = data?.targetLine ?? null;
  const targetLineId = targetLine?.salesOrderLineId ?? null;

  function getLineDraftTotal(salesOrderLineId: string) {
    return Object.values(draftsByLine[salesOrderLineId] ?? {}).reduce(
      (sum, value) => sum + readQuantity(value),
      0
    );
  }

  function getSourceDraftTotal(sourceKeyValue: string) {
    return Object.values(draftsByLine).reduce(
      (sum, lineDraft) => sum + readQuantity(lineDraft[sourceKeyValue]),
      0
    );
  }

  function getSourcePreviewFree(source: SalesAllocationSource) {
    return Math.max(
      0,
      readQuantity(source.totalQty) -
        getSourceDraftTotal(allocationKey(source.sourceType, source.sourceId))
    );
  }

  const totalOverRemaining = (data?.demandRows ?? []).some(
    (row) => getLineDraftTotal(row.salesOrderLineId) > readQuantity(row.remainingQty)
  );
  const overAllocatedSource = data?.supplySources.find((source) => {
    const key = allocationKey(source.sourceType, source.sourceId);
    return getSourceDraftTotal(key) > readQuantity(source.totalQty);
  });
  const targetDraftTotal = targetLineId ? getLineDraftTotal(targetLineId) : 0;
  const targetDraftShortQty = Math.max(
    0,
    readQuantity(targetLine?.remainingQty) - targetDraftTotal
  );
  const hasChanges =
    JSON.stringify(draftsByLine) !== JSON.stringify(defaultDraftsByLine);

  function updateDrafts(nextDrafts: Record<string, AllocationDraft>) {
    setDraftState({ lineId, values: nextDrafts });
  }

  function primePointerToken(token: AllocationTokenData) {
    pointerDropHandledRef.current = false;
    activeTokenRef.current = token;
  }

  function allocateTokenToLine(token: AllocationTokenData, salesOrderLineId: string) {
    const row = data?.demandRows.find(
      (demandRow) => demandRow.salesOrderLineId === salesOrderLineId
    );
    if (!row) return;

    const lineDraft = draftsByLine[salesOrderLineId] ?? {};
    const currentQty = readQuantity(lineDraft[token.sourceKey]);
    const lineShortQty = Math.max(
      0,
      readQuantity(row.remainingQty) - getLineDraftTotal(salesOrderLineId)
    );
    const sourceFree = Math.max(0, getSourcePreviewFreeByKey(token.sourceKey));
    const quantity = Math.min(token.quantity, lineShortQty, sourceFree);

    if (quantity <= 0) return;

    updateDrafts({
      ...draftsByLine,
      [salesOrderLineId]: {
        ...lineDraft,
        [token.sourceKey]: toQuantityString(currentQty + quantity),
      },
    });
  }

  function moveAllocatedTokenToLine(
    token: AllocationTokenData,
    targetSalesOrderLineId: string
  ) {
    const originLineId = token.originLineId;
    if (!originLineId || originLineId === targetSalesOrderLineId) return;

    const targetRow = data?.demandRows.find(
      (demandRow) => demandRow.salesOrderLineId === targetSalesOrderLineId
    );
    if (!targetRow) return;

    const originDraft = draftsByLine[originLineId] ?? {};
    const targetDraft = draftsByLine[targetSalesOrderLineId] ?? {};
    const originQty = readQuantity(originDraft[token.sourceKey]);
    const targetCurrentQty = readQuantity(targetDraft[token.sourceKey]);
    const targetShortQty = Math.max(
      0,
      readQuantity(targetRow.remainingQty) - getLineDraftTotal(targetSalesOrderLineId)
    );
    const quantity = Math.min(token.quantity, originQty, targetShortQty);

    if (quantity <= 0) return;

    updateDrafts({
      ...draftsByLine,
      [originLineId]: {
        ...originDraft,
        [token.sourceKey]: toQuantityString(originQty - quantity),
      },
      [targetSalesOrderLineId]: {
        ...targetDraft,
        [token.sourceKey]: toQuantityString(targetCurrentQty + quantity),
      },
    });
  }

  function returnAllocatedTokenToSource(token: AllocationTokenData, sourceKey: string) {
    const originLineId = token.originLineId;
    if (!originLineId || sourceKey !== token.sourceKey) return;

    const originDraft = draftsByLine[originLineId] ?? {};
    const remainingOriginDraft = { ...originDraft };
    delete remainingOriginDraft[token.sourceKey];

    updateDrafts({
      ...draftsByLine,
      [originLineId]: remainingOriginDraft,
    });
  }

  function getSourcePreviewFreeByKey(sourceKeyValue: string) {
    const source = data?.supplySources.find(
      (candidate) => allocationKey(candidate.sourceType, candidate.sourceId) === sourceKeyValue
    );
    if (!source) return 0;
    return getSourcePreviewFree(source);
  }

  function handleDragStart(event: DragStartEvent) {
    const token = event.active.data.current?.token as AllocationTokenData | undefined;
    pointerDropHandledRef.current = false;
    activeTokenRef.current = token ?? null;
    setActiveToken(token ?? null);
  }

  function getPointerDropTarget() {
    if (typeof document === "undefined" || !lastPointerRef.current) {
      return { salesOrderLineId: null, sourceKey: null };
    }

    const elements = document.elementsFromPoint(
      lastPointerRef.current.x,
      lastPointerRef.current.y
    );

    for (const element of elements) {
      const dropElement =
        element instanceof HTMLElement
          ? element.closest<HTMLElement>(
              "[data-allocation-drop-line-id], [data-allocation-drop-source-key]"
            )
          : null;

      if (dropElement?.dataset.allocationDropLineId) {
        return {
          salesOrderLineId: dropElement.dataset.allocationDropLineId,
          sourceKey: null,
        };
      }

      if (dropElement?.dataset.allocationDropSourceKey) {
        return {
          salesOrderLineId: null,
          sourceKey: dropElement.dataset.allocationDropSourceKey,
        };
      }
    }

    return { salesOrderLineId: null, sourceKey: null };
  }

  function applyTokenDrop(
    token: AllocationTokenData | undefined,
    targetSalesOrderLineId: string | null,
    targetSourceKey: string | null
  ) {
    if (token && targetSourceKey && token.originLineId) {
      returnAllocatedTokenToSource(token, targetSourceKey);
    } else if (token && targetSalesOrderLineId) {
      if (token.originLineId) {
        moveAllocatedTokenToLine(token, targetSalesOrderLineId);
      } else {
        allocateTokenToLine(token, targetSalesOrderLineId);
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (pointerDropHandledRef.current) {
      pointerDropHandledRef.current = false;
      activeTokenRef.current = null;
      setActiveToken(null);
      return;
    }

    const token = event.active.data.current?.token as AllocationTokenData | undefined;
    const overId = event.over?.id ? String(event.over.id) : null;
    const pointerTarget = getPointerDropTarget();
    const targetSalesOrderLineId =
      pointerTarget.salesOrderLineId ??
      (overId?.startsWith(ORDER_BUCKET_PREFIX)
        ? overId.slice(ORDER_BUCKET_PREFIX.length)
        : null);
    const targetSourceKey =
      token?.originLineId && pointerTarget.sourceKey
        ? pointerTarget.sourceKey
        : overId?.startsWith(SOURCE_BUCKET_PREFIX)
          ? overId.slice(SOURCE_BUCKET_PREFIX.length)
          : null;

    applyTokenDrop(token, targetSalesOrderLineId, targetSourceKey);
    activeTokenRef.current = null;
    setActiveToken(null);
  }

  useEffect(() => {
    function handlePointerUp(event: PointerEvent | MouseEvent) {
      const token = activeTokenRef.current;
      if (!token) return;

      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pointerTarget = getPointerDropTarget();
      if (!pointerTarget.salesOrderLineId && !pointerTarget.sourceKey) {
        activeTokenRef.current = null;
        return;
      }

      pointerDropHandledRef.current = true;
      activeTokenRef.current = null;
      applyTokenDrop(
        token,
        pointerTarget.salesOrderLineId,
        token.originLineId ? pointerTarget.sourceKey : null
      );
    }

    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("mouseup", handlePointerUp, true);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("mouseup", handlePointerUp, true);
    };
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const changedLineIds = Object.keys(draftsByLine).filter(
        (salesOrderLineId) =>
          JSON.stringify(draftsByLine[salesOrderLineId] ?? {}) !==
          JSON.stringify(defaultDraftsByLine[salesOrderLineId] ?? {})
      );
      const sortedLineIds = changedLineIds.toSorted((left, right) => {
        const leftDelta =
          getLineDraftTotal(left) -
          Object.values(defaultDraftsByLine[left] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        const rightDelta =
          getLineDraftTotal(right) -
          Object.values(defaultDraftsByLine[right] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        return leftDelta - rightDelta;
      });

      for (const salesOrderLineId of sortedLineIds) {
        const lineDraft = draftsByLine[salesOrderLineId] ?? {};
        await apiJson<SalesAllocationSheetData>(
          `/api/sales-order-lines/${salesOrderLineId}/allocation`,
          {
            method: "PUT",
            body: {
              allocations: Object.entries(lineDraft).flatMap(([key, value]) => {
                const quantity = readQuantity(value);
                if (quantity <= 0) return [];
                return [
                  { ...parseAllocationKey(key), quantity: toQuantityString(quantity) },
                ];
              }),
            },
            fallbackError: "Failed to save allocation.",
          }
        );
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
      setDraftState({ lineId: null, values: {} });
    },
  });

  const canSave =
    hasChanges &&
    !mutation.isPending &&
    !query.isLoading &&
    !!data &&
    !totalOverRemaining &&
    !overAllocatedSource;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-hidden bg-background text-foreground data-[side=right]:w-full data-[side=right]:sm:w-[min(94vw,76rem)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>Allocation Manager</SheetTitle>
          <SheetDescription className="sr-only">
            Allocate available stock and production to sales order lines.
          </SheetDescription>
          {targetLine ? (
            <div className="mt-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-md bg-muted">
                  <HugeiconsIcon icon={PackageIcon} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xl font-semibold text-foreground">
                      {targetLine.itemName}
                    </div>
                    <Badge variant="secondary">{targetLine.unitName}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {targetLine.orderNumber} · {targetLine.customerName} ·{" "}
                    {statusLabel(targetLine.orderStatus)}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </SheetHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            pointerDropHandledRef.current = false;
            setActiveToken(null);
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            {query.isLoading ? (
              <div className="flex min-h-48 items-center justify-center">
                <Spinner className="text-foreground" />
              </div>
            ) : query.isError ? (
              <p className="text-sm text-destructive">{query.error.message}</p>
            ) : data && targetLine ? (
              <div className="grid min-h-0 gap-4 lg:grid-cols-[0.92fr_1.25fr]">
                <section className="flex flex-col gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Available Supply</h3>
                    <p className="text-sm text-muted-foreground">
                      Drag blocks to allocate
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    {data.supplySources.map((source, sourceIndex) => {
                      const key = allocationKey(source.sourceType, source.sourceId);
                      const previewFree = getSourcePreviewFree(source);
                      const color = sourceColor(source.sourceType, sourceIndex);
                      const chunks = buildChunks(source.sourceType, previewFree);

                      return (
                        <SourceDropCard
                          key={key}
                          sourceKey={key}
                          color={color}
                          canReturn={
                            activeToken?.originLineId != null &&
                            activeToken.sourceKey === key
                          }
                          onTokenDrop={() => {
                            const token = activeTokenRef.current ?? activeToken;
                            if (token?.originLineId) {
                              pointerDropHandledRef.current = true;
                              activeTokenRef.current = null;
                              returnAllocatedTokenToSource(token, key);
                            }
                          }}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "flex size-7 items-center justify-center rounded-md",
                                  softSourceClassName(color)
                                )}
                              >
                                <HugeiconsIcon
                                  icon={
                                    source.sourceType === "stock_pool"
                                      ? PackageIcon
                                      : Factory01Icon
                                  }
                                  strokeWidth={2}
                                  className="size-4"
                                />
                              </div>
                              <div>
                                <div className="font-medium">{source.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {sourceLabel(sourceKindLabel(source), source.date)}
                                </div>
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatQuantity(toQuantityString(previewFree))} Free
                            </div>
                          </div>
                          <div className="flex min-h-14 flex-wrap items-center gap-2">
                            {chunks.length ? (
                              chunks.map((chunk) => {
                                const quantity =
                                  typeof chunk === "number" ? chunk : chunk.quantity;
                                const token: AllocationTokenData = {
                                  sourceKey: key,
                                  sourceType: source.sourceType,
                                  sourceId: source.sourceId,
                                  sourceLabel: source.label,
                                  sourceIndex,
                                  quantity,
                                  all: typeof chunk !== "number" && chunk.all,
                                };
                                return (
                                  <SourceToken
                                    key={`${key}-${token.all ? "all" : quantity}`}
                                    token={token}
                                    color={color}
                                    disabled={previewFree <= 0}
                                    onPointerDownToken={primePointerToken}
                                    onClick={() =>
                                      targetLineId
                                        ? allocateTokenToLine(token, targetLineId)
                                        : undefined
                                    }
                                  />
                                );
                              })
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                No free supply
                              </span>
                            )}
                            {Array.from({ length: Math.max(0, 4 - chunks.length) }).map(
                              (_, index) => (
                                <div
                                  key={index}
                                  className="h-12 min-w-12 rounded-md border border-dashed bg-muted/20"
                                  aria-hidden
                                />
                              )
                            )}
                          </div>
                        </SourceDropCard>
                      );
                    })}
                  </div>

                  {targetLine && targetDraftShortQty > 0 ? (
                    <CreateManufacturingOrdersDialog
                      salesOrderId={targetLine.salesOrderId}
                      salesOrderLabel={`${targetLine.orderNumber} - ${targetLine.customerName}`}
                      buttonLabel="Add MO"
                      buttonVariant="outline"
                      buttonSize="lg"
                      buttonClassName="h-24 w-full flex-col border-dashed bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground [&_svg]:size-5"
                      initialPlannedDate={todayDateString()}
                      openManufacturingOrders={data.supplySources
                        .filter(
                          (source) =>
                            source.sourceType === "manufacturing_order" &&
                            source.sourceId != null &&
                            (source.status === "draft" || source.status === "released")
                        )
                        .map((source) => ({
                          id: source.sourceId ?? source.label,
                          orderNumber: source.label,
                          itemName: targetLine.itemName,
                          quantity: `${formatQuantity(source.totalQty)} ${targetLine.unitName}`,
                          plannedDate: source.date,
                          priorityRank: source.priorityRank,
                          status: statusLabel(source.status),
                        }))}
                      initialLineQuantities={[
                        {
                          salesOrderLineId: targetLine.salesOrderLineId,
                          quantity: toQuantityString(targetDraftShortQty),
                        },
                      ]}
                    />
                  ) : null}
                </section>

                <section className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Allocate to Orders</h3>
                      <p className="text-sm text-muted-foreground">
                        Fill buckets to allocate
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" disabled>
                      Order by: Shipping Date
                    </Button>
                  </div>

                  <div className="flex flex-col gap-3">
                    {data.demandRows
                      .toSorted((a, b) => Number(b.isTarget) - Number(a.isTarget))
                      .map((row) => {
                        const isTarget = row.salesOrderLineId === targetLine.salesOrderLineId;
                        const allocatedQty = getLineDraftTotal(row.salesOrderLineId);
                        const shortQty = Math.max(
                          0,
                          readQuantity(row.remainingQty) - allocatedQty
                        );

                        return (
                          <OrderBucket
                            key={row.salesOrderLineId}
                            row={row}
                            isTarget={isTarget}
                            allocatedQty={allocatedQty}
                            shortQty={shortQty}
                            onTokenDrop={() => {
                              const token = activeTokenRef.current ?? activeToken;
                              if (!token) return;
                              pointerDropHandledRef.current = true;
                              activeTokenRef.current = null;
                              if (token.originLineId) {
                                moveAllocatedTokenToLine(
                                  token,
                                  row.salesOrderLineId
                                );
                                return;
                              }
                              allocateTokenToLine(token, row.salesOrderLineId);
                            }}
                          >
                            {Object.entries(draftsByLine[row.salesOrderLineId] ?? {}).flatMap(
                              ([key, value]) => {
                                const quantity = readQuantity(value);
                                if (quantity <= 0) return [];
                                const meta = sourceMetaByKey.get(key);
                                const parsed = parseAllocationKey(key);
                                const color = sourceColor(
                                  parsed.sourceType,
                                  meta?.index ?? 0
                                );
                                return (
                                  <TokenPreview
                                    key={key}
                                    label={meta?.source.label ?? "Source"}
                                    quantity={quantity}
                                    color={color}
                                    token={{
                                      sourceKey: key,
                                      sourceType: parsed.sourceType,
                                      sourceId: parsed.sourceId,
                                      sourceLabel: meta?.source.label ?? "Source",
                                      sourceIndex: meta?.index ?? 0,
                                      quantity,
                                      all: false,
                                      originLineId: row.salesOrderLineId,
                                    }}
                                    onPointerDownToken={primePointerToken}
                                  />
                                );
                              }
                            )}
                          </OrderBucket>
                        );
                      })}
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          <DragOverlay>
            {activeToken ? (
              <TokenPreview
                label={activeToken.sourceLabel}
                quantity={activeToken.quantity}
                color={sourceColor(activeToken.sourceType, activeToken.sourceIndex)}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <SheetFooter className="border-t">
          {mutation.error ? (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          ) : totalOverRemaining && targetLine ? (
            <p className="text-sm text-destructive">
              Allocated quantity cannot exceed {formatQuantity(targetLine.remainingQty)}{" "}
              {targetLine.unitName}.
            </p>
          ) : overAllocatedSource ? (
            <p className="text-sm text-destructive">
              {overAllocatedSource.label} only has{" "}
              {formatQuantity(overAllocatedSource.totalQty)} total.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraftState({ lineId, values: defaultDraftsByLine })}
              disabled={!hasChanges || mutation.isPending}
            >
              <HugeiconsIcon icon={ReloadIcon} strokeWidth={2} />
              Reset
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={!canSave}
              >
                {mutation.isPending ? "Saving..." : "Save allocation"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
