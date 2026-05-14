"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import {
  inferItemVisual,
  ItemSprite,
} from "@/components/inventory-visuals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { apiJson } from "@/lib/client/api";
import {
  formatCompactUnitLabel,
  formatDate,
  formatDateTime,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AllocationDemandRef,
  AllocationDemandType,
  AllocationSourceType,
  AllocationWorkspace,
} from "@/lib/inventory/allocation/types";
import type {
  ItemColorFamily,
  ItemSpriteKind,
  ItemVisualSize,
} from "@/components/inventory-visuals";

type AllocationCoverageKind = "explicit";

type AllocationSource = {
  sourceType: AllocationSourceType;
  sourceId: string | null;
  label: string;
  status: "available" | "draft" | "released" | "completed";
  date: string | null;
  receivedAt?: string | null;
  createdAt?: string | null;
  priorityRank: number | null;
  lotNumber?: string | null;
  totalQty: string;
  allocatedQty: string;
  freeQty: string;
  currentTargetQty: string;
  maxQty: string;
  canAllocate: boolean;
};

type AllocationDemandRow = {
  demandType: AllocationDemandType;
  demandId: string;
  parentDemandId: string | null;
  label: string;
  status: string;
  contextLabel: string;
  requiredDate: string | null;
  itemId: string;
  itemName: string;
  unitName: string;
  orderedQty: string;
  fulfilledQty: string;
  cancelledQty: string;
  remainingQty: string;
  allocatedQty: string;
  shortQty: string;
  sourceSummary: string;
  sources: Array<{
    sourceType: AllocationSourceType;
    sourceId: string | null;
    label: string;
    quantity: string;
    coverageKind: AllocationCoverageKind;
  }>;
  isTarget: boolean;
};

type AllocationVariantOption = {
  itemId: string;
  itemName: string;
  unitName: string;
  demandId: string | null;
  isCurrent: boolean;
};

type AllocationSheetData = {
  targetItem: {
    itemId: string;
    itemName: string;
    unitName: string;
  };
  targetDemand: AllocationDemandRow | null;
  variantOptions: AllocationVariantOption[];
  relatedItems: Array<{
    itemId: string;
    itemName: string;
    unitName: string;
    demandId: string;
    allocatedQty: string;
    remainingQty: string;
    shortQty: string;
    isCurrent: boolean;
    variantOptions: AllocationVariantOption[];
  }>;
  editableAllocations: Array<{
    sourceType: AllocationSourceType;
    sourceId: string | null;
    sourceLabel: string;
    quantity: string;
    freeQuantity: string;
    maxQuantity: string;
    coverageKind: AllocationCoverageKind;
  }>;
  supplySources: AllocationSource[];
  demandRows: AllocationDemandRow[];
  uncoveredDemandQty: string;
};

function workspaceToAllocationSheetData(workspace: AllocationWorkspace): AllocationSheetData {
  const demandRows = workspace.demands.map((demand) => {
    const sources = demand.assignments.map((assignment) => ({
      sourceType: assignment.sourceType,
      sourceId: assignment.sourceId,
      label: assignment.sourceLabel,
      quantity: assignment.quantity,
      coverageKind: "explicit" as const,
    }));
    const sourceSummary =
      sources.length === 0
        ? "\u2014"
        : sources
            .map((source) => `${formatQuantity(source.quantity)} ${source.label}`)
            .join(", ");
    return {
      demandType: demand.demandType,
      demandId: demand.demandId,
      parentDemandId: demand.parentDemandId,
      label: demand.label,
      status: "draft",
      contextLabel: demand.contextLabel ?? "",
      requiredDate: demand.requiredDate,
      itemId: demand.itemId,
      itemName: demand.itemName,
      unitName: demand.unitName,
      orderedQty: demand.openQty,
      fulfilledQty: "0",
      cancelledQty: "0",
      remainingQty: demand.openQty,
      allocatedQty: demand.allocatedQty,
      shortQty: demand.shortQty,
      sourceSummary,
      sources,
      isTarget: demand.isPrimary,
    };
  });
  const primary = demandRows.find((demand) => demand.isTarget) ?? null;
  return {
    targetItem: workspace.item,
    targetDemand: primary,
    variantOptions: [],
    relatedItems: [],
    editableAllocations: workspace.sources.map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLabel: source.label,
      quantity: source.currentPrimaryQty,
      freeQuantity: source.freeQty,
      maxQuantity: source.maxQtyForPrimaryDemand,
      coverageKind: "explicit" as const,
    })),
    supplySources: workspace.sources.map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      label: source.label,
      status:
        source.status === "draft" ||
        source.status === "released" ||
        source.status === "completed"
          ? source.status
          : "available",
      date: source.date,
      receivedAt: source.sourceType === "inventory_lot" ? source.date : null,
      createdAt: null,
      priorityRank: source.priorityRank,
      lotNumber: source.sourceType === "inventory_lot" ? source.label : null,
      totalQty: source.totalQty,
      allocatedQty: source.allocatedQty,
      freeQty: source.freeQty,
      currentTargetQty: source.currentPrimaryQty,
      maxQty: source.maxQtyForPrimaryDemand,
      canAllocate: source.canAllocate,
    })),
    demandRows,
    uncoveredDemandQty: workspace.totals.shortQty,
  };
}

type AllocationDraft = Record<string, string>;
type AllocationDraftState = {
  workspaceKey: string | null;
  values: Record<string, AllocationDraft>;
};

type AllocationTokenData = {
  sourceKey: string;
  sourceType: AllocationSourceType;
  sourceId: string | null;
  sourceLabel: string;
  sourceIndex: number;
  quantity: number;
  itemName?: string | null;
  unitName?: string | null;
  originDemandId?: string;
  originLabel?: string;
  originContext?: string | null;
};

type AllocationEvent = {
  id: number;
  tone: "success" | "warning" | "danger";
  message: string;
};

type OutputAllocationData = {
  sourceMo: {
    id: string;
    orderNumber: string;
    productName: string;
    plannedQuantity: string;
    actualQuantity: string;
    status: string;
  };
  productionDestinations: Array<{
    ingredientId: string;
    manufacturingOrderId: string;
    orderNumber: string;
    productName: string;
    outputProductName?: string;
    outputPlannedQuantity?: string;
    outputUnitName?: string;
    plannedDate?: string | null;
    salesOrderNumber?: string | null;
    salesCustomerName?: string | null;
    status: string;
    remainingNeed: string;
    assignedQty: string;
    shortQty: string;
  }>;
  salesDestinations: Array<{
    demandId: string;
    salesOrderId: string;
    orderNumber: string;
    customerName: string | null;
    shipDate?: string | null;
    remainingQty: string;
    assignedQty: string;
    shortQty: string;
  }>;
  assignedSalesQty: string;
  assignedProductionQty: string;
  unassignedQty: string;
};

type OutputAllocationWire = Omit<OutputAllocationData, "salesDestinations"> & {
  salesDestinations: Array<
    Omit<OutputAllocationData["salesDestinations"][number], "demandId"> & {
      salesOrderLineId: string;
    }
  >;
};

function outputWireToOutputData(data: OutputAllocationWire): OutputAllocationData {
  return {
    ...data,
    salesDestinations: data.salesDestinations.map((destination) => ({
      ...destination,
      demandId: destination.salesOrderLineId,
    })),
  };
}

type CreateManufacturingOrderActionProps = {
  parentDemandId: string;
  parentDemandLabel: string;
  initialPlannedDate: string;
  openManufacturingOrders: Array<{
    id: string;
    orderNumber: string;
    itemName: string;
    quantity: string;
    plannedDate: string | null;
    priorityRank: number | null;
    status: string;
  }>;
  initialDemandQuantities: Array<{
    demandId: string;
    quantity: string;
  }>;
};

type Props = {
  lineId?: string | null;
  demandRef?: AllocationDemandRef | null;
  itemId?: string | null;
  titleOverride?: string;
  onSaved?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetDemandChange?: (demandId: string) => void;
  onTargetLineChange?: (lineId: string) => void;
  outputManufacturingOrderId?: string | null;
  onOutputManufacturingOrderChange?: (id: string | null) => void;
  renderCreateManufacturingOrderAction?: (
    props: CreateManufacturingOrderActionProps
  ) => ReactNode;
};

type CarryState = AllocationTokenData | null;

type OutputCarryState = {
  quantity: number;
  originIngredientId?: string;
  originLabel?: string;
} | null;

type SpriteTransferAnimation = {
  id: string;
  kind: ItemSpriteKind;
  color: ItemColorFamily;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delayMs: number;
};

function allocationKey(sourceType: AllocationSourceType, sourceId: string | null) {
  return `${sourceType}:${sourceId ?? ""}`;
}

export const AllocationSheet = AllocationManagerSheet;

function parseAllocationKey(key: string) {
  const [sourceType, rawSourceId] = key.split(":") as [
    AllocationSourceType,
    string,
  ];
  return {
    sourceType,
    sourceId: rawSourceId || null,
  };
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function toQuantityString(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function readQuantity(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayDateString() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function shortLabel(value: number) {
  return value > 0 ? formatQuantity(toQuantityString(value)) : "\u2014";
}

function quantityLabel(value: number) {
  return formatQuantity(toQuantityString(value));
}

function compactChangeLabel(count: number) {
  return `Unsaved · ${count} ${count === 1 ? "change" : "changes"}`;
}

function compactUnitName(unitName: string | null | undefined) {
  return formatCompactUnitLabel({ name: unitName }) ?? unitName ?? "units";
}

function itemVisual(name: string | null | undefined, unitName: string | null | undefined) {
  return inferItemVisual({ name, unitName });
}

function getSpriteTransferTargetRect(container: Element) {
  const target = container.querySelector<HTMLElement>(
    '[data-testid="allocation-empty-slot"], [data-testid="allocation-ghost-slot"], [data-slot="allocation-sprite-tile"]'
  );
  return (target ?? container).getBoundingClientRect();
}

function clampQuantity(value: number, max: number) {
  return Math.max(0, Math.min(readQuantity(toQuantityString(value)), max));
}

function demandContextLabel(row: AllocationSheetData["demandRows"][number]) {
  return row.contextLabel ? `${row.label} · ${row.contextLabel}` : row.label;
}

function demandTypeOf(row: AllocationSheetData["demandRows"][number]) {
  return (row as { demandType?: "sales_order_line" | "manufacturing_order_ingredient" })
    .demandType;
}

function demandDateLabel(row: AllocationSheetData["demandRows"][number]) {
  return demandTypeOf(row) === "manufacturing_order_ingredient" ? "Need" : "Ship";
}

function targetDemandLabel(row: AllocationSheetData["demandRows"][number] | null) {
  if (!row) return null;
  return demandTypeOf(row) === "manufacturing_order_ingredient" ? "Manufacturing demand" : "Sales order";
}

function formatInstantDate(value: string | null | undefined, organizationTimeZone: string) {
  if (!value) return "\u2014";
  return formatDateTime(value, organizationTimeZone).split(",")[0] ?? "\u2014";
}

function ProgressBar({
  value,
  max,
  tone = "success",
}: {
  value: number;
  max: number;
  tone?: "success" | "primary" | "warning";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="alloc-progress-track h-2 rounded-sm">
      <div
        className={cn(
          "h-full rounded-sm transition-all duration-300 motion-reduce:transition-none",
          tone === "success" && "alloc-progress-fill-supply",
          tone === "primary" && "alloc-progress-fill-held",
          tone === "warning" && "alloc-progress-fill-allocated"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AllocationEventLog({ events }: { events: AllocationEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div
      data-testid="allocation-event-log"
      className="pointer-events-none absolute bottom-3 left-3 z-30 flex w-[min(16rem,calc(100%-1.5rem))] flex-col gap-1"
      aria-live="polite"
      aria-atomic="false"
    >
      <style>{`
        @keyframes allocation-log-fade {
          0% {
            opacity: 0;
          }
          12% {
            opacity: 1;
          }
          78% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
      {events.slice(-2).map((event) => (
        <div
          key={event.id}
          data-testid="allocation-event-message"
          className={cn(
            "dark w-fit rounded-full border border-border bg-popover/95 px-3 py-1.5 text-[11px] font-medium text-popover-foreground shadow-lg backdrop-blur",
            "[animation:allocation-log-fade_1800ms_ease-out_both] motion-reduce:animate-none",
            event.tone === "success" && "border-success/45",
            event.tone === "warning" && "border-warning/45",
            event.tone === "danger" && "border-destructive/45"
          )}
        >
          {event.message}
        </div>
      ))}
    </div>
  );
}

type AllocationSpriteTileState =
  | "available"
  | "allocated"
  | "inbound"
  | "hold"
  | "reserved"
  | "shortage";

const ALLOCATION_TILE_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "size-8 rounded-md",
  sm: "size-12 rounded-md",
  md: "size-16 rounded-lg",
  lg: "size-22 rounded-lg",
};

const ALLOCATION_SPRITE_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "scale-90",
  sm: "scale-100",
  md: "scale-105",
  lg: "scale-110",
};

const ALLOCATION_TILE_STATE_CLASS: Record<AllocationSpriteTileState, string> = {
  available: "border-border bg-card",
  allocated: "border-[var(--alloc-demand)] bg-warning/10",
  inbound: "border-[var(--alloc-supply)] bg-success/5",
  hold: "alloc-glow-held border-dashed opacity-65",
  reserved: "border-[var(--alloc-disabled)] bg-muted text-muted-foreground",
  shortage: "alloc-glow-short bg-destructive/5",
};

function AllocationSpriteTile({
  kind,
  color,
  state = "available",
  selected = false,
  size = "md",
  quantity,
  className,
  spriteClassName,
}: {
  kind: ItemSpriteKind;
  color: ItemColorFamily;
  state?: AllocationSpriteTileState;
  selected?: boolean;
  size?: ItemVisualSize;
  quantity?: ReactNode;
  className?: string;
  spriteClassName?: string;
}) {
  return (
    <span
      data-slot="allocation-sprite-tile"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border transition-colors motion-reduce:transition-none",
        ALLOCATION_TILE_SIZE_CLASS[size],
        ALLOCATION_TILE_STATE_CLASS[state],
        selected && "border-border bg-muted/20",
        className
      )}
      aria-hidden
    >
      <ItemSprite
        kind={kind}
        color={color}
        size={size}
        className={cn(ALLOCATION_SPRITE_SIZE_CLASS[size], spriteClassName)}
      />
      {quantity != null ? (
        <span
          className={cn(
            "pointer-events-none absolute right-1 top-1 font-semibold leading-none tabular-nums text-foreground",
            size === "xs" && "text-[0.58rem]",
            size === "sm" && "text-[0.65rem]",
            size === "md" && "text-xs",
            size === "lg" && "text-sm"
          )}
          aria-hidden
        >
          {quantity}
        </span>
      ) : null}
    </span>
  );
}

function SpriteTransferOverlay({
  animations,
  onDone,
}: {
  animations: SpriteTransferAnimation[];
  onDone: (id: string) => void;
}) {
  if (animations.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-hidden>
      <style>{`
        @keyframes allocation-pickup-fly {
          0% {
            opacity: 0.95;
            transform: translate3d(var(--from-x), var(--from-y), 0) scale(0.96);
          }
          100% {
            opacity: 0.15;
            transform: translate3d(var(--to-x), var(--to-y), 0) scale(0.58);
          }
        }
      `}</style>
      {animations.map((animation) => {
        const style = {
          "--from-x": `${animation.fromX}px`,
          "--from-y": `${animation.fromY}px`,
          "--to-x": `${animation.toX}px`,
          "--to-y": `${animation.toY}px`,
          animation: "allocation-pickup-fly 560ms cubic-bezier(0.2, 0.9, 0.2, 1) both",
          animationDelay: `${animation.delayMs}ms`,
        } as CSSProperties;

        return (
          <span
            key={animation.id}
            className="absolute left-0 top-0"
            style={style}
            onAnimationEnd={() => onDone(animation.id)}
          >
            <AllocationSpriteTile
              kind={animation.kind}
              color={animation.color}
              size="md"
              className="shadow-xl shadow-foreground/15"
            />
          </span>
        );
      })}
    </div>
  );
}

function useSpriteTransferAnimations() {
  const [animations, setAnimations] = useState<SpriteTransferAnimation[]>([]);
  const [hudQuantityOverride, setHudQuantityOverride] = useState<number | null>(null);
  const countTimersRef = useRef<number[]>([]);

  const clearCountTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    countTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    countTimersRef.current = [];
  }, []);

  const removeSpriteTransfer = useCallback((id: string) => {
    setAnimations((current) => current.filter((animation) => animation.id !== id));
  }, []);

  const animateTransfer = useCallback(
    ({
      quantity,
      fromRect,
      toRect,
      visual,
      countIntoHud = false,
    }: {
      quantity: number;
      fromRect: DOMRect;
      toRect: DOMRect;
      visual: ReturnType<typeof itemVisual>;
      countIntoHud?: boolean;
    }) => {
      if (
        typeof window === "undefined" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      window.requestAnimationFrame(() => {
        const fromX = fromRect.left + fromRect.width / 2 - 32;
        const fromY = fromRect.top + fromRect.height / 2 - 32;
        const toX = toRect.left + toRect.width / 2 - 32;
        const toY = toRect.top + toRect.height / 2 - 32;
        const cloneCount = Math.max(1, Math.min(5, Math.ceil(quantity)));
        const batchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        clearCountTimers();
        if (countIntoHud) setHudQuantityOverride(0);
        else setHudQuantityOverride(null);

        if (countIntoHud) {
          countTimersRef.current = Array.from({ length: cloneCount }, (_, index) => {
            const isLast = index === cloneCount - 1;
            const nextQuantity = isLast
              ? quantity
              : Math.max(1, Math.round((quantity * (index + 1)) / cloneCount));

            return window.setTimeout(() => {
              setHudQuantityOverride(nextQuantity);
            }, 420 + index * 42);
          });

          countTimersRef.current.push(
            window.setTimeout(() => {
              setHudQuantityOverride(null);
              countTimersRef.current = [];
            }, 420 + (cloneCount - 1) * 42 + 220)
          );
        }

        setAnimations((current) => [
          ...current.slice(-10),
          ...Array.from({ length: cloneCount }, (_, index) => ({
            id: `${batchId}-${index}`,
            kind: visual.kind,
            color: visual.color,
            fromX: fromX + index * 3,
            fromY: fromY - index * 2,
            toX: toX + index * 2,
            toY: toY - index,
            delayMs: index * 42,
          })),
        ]);
      });
    },
    [clearCountTimers]
  );

  const getHudTileRect = useCallback(() => {
    if (typeof document === "undefined") return null;
    return document
      .querySelector<HTMLElement>(
        '[data-testid="allocation-holding-hud"] [data-slot="allocation-sprite-tile"]'
      )
      ?.getBoundingClientRect() ?? null;
  }, []);

  const animatePickupToHud = useCallback(
    ({
      quantity,
      sourceRect,
      visual,
      countIntoHud = true,
    }: {
      quantity: number;
      sourceRect: DOMRect;
      visual: ReturnType<typeof itemVisual>;
      countIntoHud?: boolean;
    }) => {
      const hudRect = getHudTileRect();
      const fallbackRect = new DOMRect(window.innerWidth / 2 - 32, window.innerHeight - 128, 64, 64);
      animateTransfer({
        quantity,
        fromRect: sourceRect,
        toRect: hudRect ?? fallbackRect,
        visual,
        countIntoHud,
      });
    },
    [animateTransfer, getHudTileRect]
  );

  const animateFromHud = useCallback(
    ({
      quantity,
      targetRect,
      visual,
    }: {
      quantity: number;
      targetRect: DOMRect;
      visual: ReturnType<typeof itemVisual>;
    }) => {
      const hudRect = getHudTileRect();
      if (!hudRect) return;
      animateTransfer({ quantity, fromRect: hudRect, toRect: targetRect, visual });
    },
    [animateTransfer, getHudTileRect]
  );

  useEffect(() => clearCountTimers, [clearCountTimers]);

  return {
    animations,
    animateFromHud,
    animatePickupToHud,
    hudQuantityOverride,
    removeSpriteTransfer,
  };
}

function AffordanceChip({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "source" | "success" | "warning";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone === "default" && "border-border bg-muted/40 text-muted-foreground",
        tone === "source" && "border-warning/45 bg-warning/10 text-warning",
        tone === "success" && "border-success/45 bg-success/10 text-success",
        tone === "warning" && "border-destructive/45 bg-destructive/10 text-destructive",
        className
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({
  title,
  count,
  icon,
  className,
  onClick,
}: {
  title: string;
  count?: string;
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2">
        {icon}
        <span>{title}</span>
      </div>
      {count ? <span className="font-medium normal-case tracking-normal">{count}</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className
      )}
    >
      {content}
    </div>
  );
}

function WorkspacePanel({
  title,
  count,
  accent = "default",
  children,
  footer,
  className,
  testId,
}: {
  title: string;
  count?: string;
  accent?: "default" | "supply" | "production";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        className
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-[2px]",
              accent === "supply" && "bg-success shadow-md",
              accent === "production" && "bg-primary shadow-md",
              accent === "default" && "bg-warning shadow-md"
            )}
          />
          <h3 className="truncate text-sm font-semibold uppercase tracking-wide">
            {title}
          </h3>
        </div>
        {count ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {children}
      </div>
      {footer ? <div className="border-t bg-muted/20 p-3">{footer}</div> : null}
    </section>
  );
}

function DemandQuantityStacks({
  total,
  allocated,
  visual,
  allocations,
  held,
  demandLabel,
  emptySlotClassName,
  onPick,
}: {
  total: number;
  allocated: number;
  visual: ReturnType<typeof itemVisual>;
  allocations?: Array<{
    sourceKey: string;
    sourceType: AllocationSourceType;
    sourceId: string | null;
    sourceLabel: string;
    sourceIndex: number;
    quantity: number;
  }>;
  held?: { sourceKey: string; quantity: number } | null;
  demandLabel?: string;
  emptySlotClassName?: string;
  onPick?: (token: AllocationTokenData, sourceRect?: DOMRect) => void;
}) {
  const sourceAllocations =
    allocations && allocations.length > 0
      ? allocations
      : [
          {
            sourceKey: "allocated",
            sourceType: "inventory_lot" as AllocationSourceType,
            sourceId: null,
            sourceLabel: "Allocated",
            sourceIndex: 0,
            quantity: allocated,
          },
        ];
  const allocatedStacks = sourceAllocations.flatMap((allocation) => {
    const heldQty = held?.sourceKey === allocation.sourceKey ? held.quantity : 0;
    const visibleQty = Math.max(0, allocation.quantity - heldQty);
    if (visibleQty <= 0) return [];
    return [
      {
        ...allocation,
        quantity: visibleQty,
        stackIndex: 0,
        isHeldGhost: false,
      },
    ];
  });
  const heldSource = held
    ? sourceAllocations.find((allocation) => allocation.sourceKey === held.sourceKey)
    : null;
  const heldStacks =
    held && held.quantity > 0
      ? [
          {
            sourceKey: held.sourceKey,
            sourceType: heldSource?.sourceType ?? ("inventory_lot" as AllocationSourceType),
            sourceId: heldSource?.sourceId ?? null,
            sourceLabel: heldSource?.sourceLabel ?? "Source",
            sourceIndex: heldSource?.sourceIndex ?? 0,
            quantity: held.quantity,
            stackIndex: 0,
            isHeldGhost: true,
          },
        ]
      : [];
  const visibleQuantity = allocatedStacks.reduce((sum, stack) => sum + stack.quantity, 0);
  const heldQuantity = heldStacks.reduce((sum, stack) => sum + stack.quantity, 0);
  const emptyCount = total > visibleQuantity + heldQuantity ? 1 : 0;

  if (total <= 0 && allocated <= 0) {
    return <div className="h-12" />;
  }

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-1.5" data-testid="allocation-rail">
      {[...allocatedStacks, ...heldStacks].map((stack) => {
        const label = `${stack.isHeldGhost ? "Holding" : "Move"} ${quantityLabel(stack.quantity)} from ${stack.sourceLabel}${demandLabel ? ` on ${demandLabel}` : ""}`;
        const token = (
          <AllocationSpriteTile
            kind={visual.kind}
            color={visual.color}
            state={stack.isHeldGhost ? "hold" : "allocated"}
            selected={stack.isHeldGhost}
            size="sm"
            quantity={quantityLabel(stack.quantity)}
            className={cn(
              "transition-transform duration-150 motion-reduce:transition-none",
              !stack.isHeldGhost && "hover:scale-105 focus-visible:scale-105 motion-reduce:hover:scale-100 motion-reduce:focus-visible:scale-100",
              stack.isHeldGhost && "opacity-65"
            )}
          />
        );

        if (stack.isHeldGhost || !onPick) {
          return (
            <span
              key={`${stack.isHeldGhost ? "held" : "filled"}-${stack.sourceKey}-${stack.stackIndex}-${stack.quantity}`}
              data-testid={stack.isHeldGhost ? "allocation-ghost-slot" : undefined}
              aria-label={label}
              className="inline-flex"
            >
              {token}
            </span>
          );
        }

        return (
          <button
            type="button"
            key={`filled-${stack.sourceKey}-${stack.stackIndex}-${stack.quantity}`}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              onPick(
                {
                  sourceKey: stack.sourceKey,
                  sourceType: stack.sourceType,
                  sourceId: stack.sourceId,
                  sourceLabel: stack.sourceLabel,
                  sourceIndex: stack.sourceIndex,
                  quantity: stack.quantity,
                },
                getSpriteTransferTargetRect(event.currentTarget)
              );
            }}
          >
            {token}
          </button>
        );
      })}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <span
          key={`empty-${index}`}
          className={cn(
            "flex h-12 w-12 shrink-0 rounded-md border border-dashed bg-muted/15",
            emptySlotClassName
          )}
          data-testid="allocation-empty-slot"
          aria-hidden
        />
      ))}
    </div>
  );
}

function HeaderMetric({
  label,
  free,
  total,
  tone,
}: {
  label: string;
  free: number;
  total: number;
  tone: "success" | "primary";
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "primary" && "text-primary"
        )}
      >
        {formatQuantity(toQuantityString(free))}/{formatQuantity(toQuantityString(total))}
      </span>
    </div>
  );
}

function VariantSwitcher({
  options,
  relatedItems = [],
  fallbackItemName,
  fallbackUnitLabel,
  onSelectDemand,
  onSelectItem,
}: {
  options: AllocationSheetData["variantOptions"];
  relatedItems?: AllocationSheetData["relatedItems"];
  fallbackItemName: string;
  fallbackUnitLabel: string;
  onSelectDemand: (demandId: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  if (relatedItems.length > 0) {
    return (
      <div className="flex items-center gap-1.5">
        {relatedItems.map((item) => {
          const remaining = readQuantity(item.remainingQty);
          const short = readQuantity(item.shortQty);
          const isComplete = remaining > 0 && short <= 0;
          const unitLabel = compactUnitName(item.unitName);
          const visual = itemVisual(item.itemName, item.unitName);

          return (
            <div key={item.demandId} className="group relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-md text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                    )}
                    aria-label={`${item.itemName} · ${unitLabel}`}
                      onClick={() => onSelectDemand(item.demandId)}
                    >
                      <AllocationSpriteTile
                        kind={visual.kind}
                        color={visual.color}
                        state={isComplete ? "reserved" : short > 0 ? "shortage" : "available"}
                        selected={item.isCurrent}
                        size="xs"
                      />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {item.itemName} · {unitLabel} · {formatQuantity(item.allocatedQty)}/
                  {formatQuantity(item.remainingQty)} allocated.
                </TooltipContent>
              </Tooltip>
              <div className="invisible absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-md border bg-popover p-1 text-popover-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none">
                  {item.variantOptions.map((option) => {
                    const optionUnitLabel = compactUnitName(option.unitName);
                    const optionVisual = itemVisual(option.itemName, option.unitName);
                    return (
                    <Tooltip key={option.itemId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-md text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                          aria-label={`${option.itemName} · ${optionUnitLabel}`}
                          onClick={() => {
                            if (option.demandId) {
                              onSelectDemand(option.demandId);
                              return;
                            }
                            onSelectItem(option.itemId);
                            }}
                          >
                            <AllocationSpriteTile
                              kind={optionVisual.kind}
                              color={optionVisual.color}
                              selected={option.isCurrent}
                              size="xs"
                            />
                          </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {option.itemName} · {optionUnitLabel}.
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const visibleOptions =
    options.length > 0
      ? options
      : [
          {
            itemId: "current",
            itemName: fallbackItemName,
            unitName: fallbackUnitLabel,
            demandId: null,
            isCurrent: true,
          },
        ];

  return (
    <div className="flex items-center gap-1.5">
      {visibleOptions.map((option) => {
        const unitLabel = compactUnitName(option.unitName);
        const visual = itemVisual(option.itemName, option.unitName);
        return (
          <Tooltip key={option.itemId}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-md text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label={`${option.itemName} · ${unitLabel}`}
                onClick={() => {
                  if (option.demandId && !option.isCurrent) {
                    onSelectDemand(option.demandId);
                    return;
                  }
                    onSelectItem(option.itemId);
                  }}
                >
                  <AllocationSpriteTile
                    kind={visual.kind}
                    color={visual.color}
                    selected={option.isCurrent}
                    size="xs"
                  />
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {option.itemName} · {unitLabel}.
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function CarryPanel({
  carried,
  className,
  displayQuantity,
}: {
  carried: CarryState;
  className?: string;
  displayQuantity?: number | null;
}) {
  if (!carried) return null;

  const isProduction = carried.sourceType === "manufacturing_order";
  const shownQuantity = displayQuantity ?? carried.quantity;
  const visual = itemVisual(carried.itemName ?? carried.sourceLabel, carried.unitName);

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 z-20 w-fit max-w-[calc(100%-2rem)] -translate-x-1/2",
        className
      )}
      data-testid="allocation-holding-hud"
    >
      <div className="alloc-glow-held flex items-center gap-2 rounded-xl border bg-popover/95 p-2 text-popover-foreground shadow-xl backdrop-blur">
        <span className="sr-only">Holding</span>
        <AllocationSpriteTile
          kind={visual.kind}
          color={visual.color}
          state={isProduction ? "inbound" : "available"}
          selected
          size="md"
          quantity={quantityLabel(shownQuantity)}
        />
        <div className="grid shrink-0 gap-1 text-[10px] text-muted-foreground">
          <kbd className="min-w-10 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">Esc</kbd>
          <kbd className="min-w-10 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">X</kbd>
          <kbd className="min-w-10 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">wheel</kbd>
        </div>
      </div>
    </div>
  );
}

function SupplyStack({
  source,
  itemName,
  unitName,
  sourceKeyValue,
  sourceIndex,
  previewFree,
  isSelected,
  carried,
  onPick,
  onSelect,
  onInvalid,
  onOpenOutput,
}: {
  source: AllocationSource;
  itemName: string | null | undefined;
  unitName: string | null | undefined;
  sourceKeyValue: string;
  sourceIndex: number;
  previewFree: number;
  isSelected: boolean;
  carried: CarryState;
  onPick: (token: AllocationTokenData, sourceRect?: DOMRect) => void;
  onSelect: (sourceKeyValue: string) => boolean;
  onInvalid: (message: string) => void;
  onOpenOutput: (id: string) => void;
}) {
  const isMo = source.sourceType === "manufacturing_order";
  const isLot = source.sourceType === "inventory_lot";
  const visual = itemVisual(itemName, unitName);
  const canPick = previewFree > 0 && source.canAllocate;
  const isHeldSource =
    carried?.originDemandId != null && carried.sourceKey === sourceKeyValue;
  const toneClasses = isMo
    ? {
        selected: "",
        base: "",
        hover: "",
        icon: "bg-primary/10 text-primary",
        label: "text-primary",
      }
    : {
        selected: "",
        base: "",
        hover: "",
        icon: "bg-success/10 text-success",
        label: "text-muted-foreground",
      };
  const stackClassName = cn(
    "group relative flex h-[4.5rem] w-20 flex-col items-center justify-center rounded-md text-left transition motion-reduce:transition-none",
    toneClasses.base,
    toneClasses.hover,
    "focus-visible:outline-none focus-visible:[&>[data-slot=allocation-sprite-tile]]:border-ring",
    isSelected && toneClasses.selected,
    !canPick && "opacity-70"
  );

  if (isMo) {
    return (
      <div className="flex w-20 flex-col items-center gap-1">
        <button
          type="button"
          className={stackClassName}
          onClick={(event) => {
            if (!onSelect(sourceKeyValue)) return;
            if (!canPick) {
              onInvalid(source.canAllocate ? "No available quantity" : "Source is not allocatable");
              return;
            }
            onPick(
              {
                sourceKey: sourceKeyValue,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                sourceLabel: source.label,
                sourceIndex,
                quantity: previewFree,
                itemName,
                unitName,
              },
              getSpriteTransferTargetRect(event.currentTarget)
            );
          }}
          aria-label={`Allocate all from ${source.label}`}
          data-allocation-interactive
          data-allocation-source-key={sourceKeyValue}
        >
          <AllocationSpriteTile
            kind={visual.kind}
            color={visual.color}
            state={isHeldSource ? "hold" : "inbound"}
            selected={isSelected}
            size="md"
            quantity={quantityLabel(previewFree)}
            className={!carried && canPick ? "alloc-glow-demand" : undefined}
          />
        </button>
        <button
          type="button"
          className="max-w-full truncate text-[11px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (source.sourceId) onOpenOutput(source.sourceId);
          }}
          aria-label={`Open output allocation for ${source.label}`}
          data-allocation-interactive
        >
          {source.label}
        </button>
        {source.sourceId ? (
          <div className="max-w-full truncate text-[11px] text-muted-foreground">
            {statusLabel(source.status)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex w-20 flex-col items-center gap-0.5">
      <button
        type="button"
        className={stackClassName}
        onClick={(event) => {
          if (!onSelect(sourceKeyValue)) return;
          if (!canPick) {
            onInvalid(source.canAllocate ? "No available quantity" : "Source is not allocatable");
            return;
          }
          onPick(
            {
              sourceKey: sourceKeyValue,
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              sourceLabel: source.label,
              sourceIndex,
              quantity: previewFree,
              itemName,
              unitName,
            },
            getSpriteTransferTargetRect(event.currentTarget)
          );
        }}
        aria-label={`Allocate all from ${source.label}`}
        data-allocation-interactive
        data-allocation-source-key={sourceKeyValue}
      >
          <AllocationSpriteTile
            kind={visual.kind}
            color={visual.color}
            state={isHeldSource ? "hold" : "available"}
            selected={isSelected}
            size="md"
            quantity={quantityLabel(previewFree)}
            className={!carried && canPick ? "alloc-glow-supply" : undefined}
          />
      </button>
      <div className="max-w-full truncate text-center text-[11px] font-medium text-muted-foreground">
        {isLot ? source.lotNumber ?? source.label : source.label}
      </div>
    </div>
  );
}

function SourceDetailPanel({
  source,
  itemName,
  unitName,
  destinations,
  previewAllocated,
  previewFree,
}: {
  source: AllocationSource | null;
  itemName: string | null | undefined;
  unitName: string | null | undefined;
  destinations: Array<{ label: string; quantity: number; kind: "sales" | "production" }>;
  previewAllocated?: number;
  previewFree?: number;
}) {
  const organizationTimeZone = useOrganizationTimeZone();

  if (!source) return null;

  const total = readQuantity(source.totalQty);
  const allocated = previewAllocated ?? readQuantity(source.allocatedQty);
  const free = previewFree ?? readQuantity(source.freeQty);
  const visual = itemVisual(itemName, unitName);
  const sourceMeta =
    source.sourceType === "inventory_lot" ? (
      <>
        Received {formatInstantDate(source.receivedAt ?? source.date, organizationTimeZone)}
      </>
    ) : source.sourceType === "manufacturing_order" ? (
      <>
        {statusLabel(source.status)}
        {source.date ? ` · ${formatDate(source.date)}` : ""}
      </>
    ) : (
      "Available stock pool"
    );

  return (
    <div className="rounded-md border bg-background p-2.5 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AllocationSpriteTile
              kind={visual.kind}
              color={visual.color}
              state={source.sourceType === "manufacturing_order" ? "inbound" : "available"}
              size="xs"
              className="size-5 rounded-sm"
            />
            <h3 className="truncate text-sm font-semibold">{source.label}</h3>
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">{sourceMeta}</div>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Allocated</span>
          <ProgressBar value={allocated} max={Math.max(total, allocated + free)} tone="warning" />
          <span className="text-right font-medium tabular-nums">{quantityLabel(allocated)}</span>
        </div>
        <div className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Free</span>
          <ProgressBar value={free} max={Math.max(total, allocated + free)} />
          <span className="text-right font-medium tabular-nums">{quantityLabel(free)}</span>
        </div>
      </div>

      <div className="mt-2 border-t pt-2">
        {destinations.length === 0 ? (
          <div className="text-xs text-muted-foreground">No allocations from this source.</div>
        ) : (
          <div className="space-y-0.5">
            {destinations.map((destination) => (
              <div
                key={`${destination.kind}:${destination.label}`}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="truncate text-muted-foreground">
                  {destination.kind === "production" ? "Production" : "Sales"} ·{" "}
                  {destination.label}
                </span>
                <span className="font-medium tabular-nums">
                  {formatQuantity(toQuantityString(destination.quantity))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutputSourceDetailPanel({
  data,
  assignedSales,
  assignedProduction,
  outputFree,
  draft,
  heldIngredientId,
  heldQuantity,
}: {
  data: OutputAllocationData;
  assignedSales: number;
  assignedProduction: number;
  outputFree: number;
  draft: Record<string, string>;
  heldIngredientId?: string;
  heldQuantity?: number;
}) {
  const planned = readQuantity(data.sourceMo.plannedQuantity);
  const heldQty = heldQuantity ?? 0;
  const allocated = Math.max(0, assignedSales + assignedProduction - heldQty);
  const visual = itemVisual(data.sourceMo.productName, null);
  const destinations = [
    assignedSales > 0
      ? { label: "Sales allocations", quantity: assignedSales, kind: "sales" as const }
      : null,
    ...data.productionDestinations
      .map((destination) => ({
        label: destination.orderNumber,
        quantity: Math.max(
          0,
          readQuantity(draft[destination.ingredientId]) -
            (heldIngredientId === destination.ingredientId ? heldQuantity ?? 0 : 0)
        ),
        kind: "production" as const,
      }))
      .filter((destination) => destination.quantity > 0),
  ].filter(Boolean) as Array<{ label: string; quantity: number; kind: "sales" | "production" }>;

  return (
    <div className="rounded-md border bg-background p-3 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AllocationSpriteTile
              kind={visual.kind}
              color={visual.color}
              state="inbound"
              size="xs"
              className="size-5 rounded-sm"
            />
            <h3 className="truncate text-sm font-semibold">{data.sourceMo.orderNumber}</h3>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {data.sourceMo.productName} · {statusLabel(data.sourceMo.status)}
          </div>
        </div>
        <Badge variant="secondary">MO output</Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Assigned</span>
          <ProgressBar value={allocated} max={Math.max(planned, allocated + outputFree)} tone="warning" />
          <span className="text-right font-medium tabular-nums">
            {formatQuantity(toQuantityString(allocated))}
          </span>
        </div>
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Free</span>
          <ProgressBar value={outputFree} max={Math.max(planned, allocated + outputFree)} />
          <span className="text-right font-medium tabular-nums">
            {formatQuantity(toQuantityString(outputFree))}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t pt-3">
        {destinations.length === 0 ? (
          <div className="text-sm text-muted-foreground">No output assignments yet.</div>
        ) : (
          <div className="space-y-1">
            {destinations.map((destination) => (
              <div
                key={`${destination.kind}:${destination.label}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-muted-foreground">
                  {destination.kind === "production" ? "Production" : "Sales"} ·{" "}
                  {destination.label}
                </span>
                <span className="font-medium tabular-nums">
                  {formatQuantity(toQuantityString(destination.quantity))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DemandCard({
  row,
  isTarget,
  allocatedQty,
  shortQty,
  draftAllocations,
  held,
  pendingPreview,
  lastPlacedDemandId,
  carried,
  onPlace,
  onPickToken,
  onInvalid,
}: {
  row: AllocationSheetData["demandRows"][number];
  isTarget: boolean;
  allocatedQty: number;
  shortQty: number;
  draftAllocations: Array<{
    sourceKey: string;
    sourceType: AllocationSourceType;
    sourceId: string | null;
    sourceLabel: string;
    sourceIndex: number;
    quantity: number;
  }>;
  held: { sourceKey: string; quantity: number } | null;
  pendingPreview: number;
  lastPlacedDemandId: string | null;
  carried: CarryState;
  onPlace: (targetRect?: DOMRect) => void;
  onPickToken: (token: AllocationTokenData, sourceRect?: DOMRect) => void;
  onInvalid: (message: string) => void;
}) {
  const [isHovering, setIsHovering] = useState(false);
  const dropSlotRef = useRef<HTMLDivElement | null>(null);
  const remaining = readQuantity(row.remainingQty);
  const canPlace = carried != null && shortQty > 0;
  const isInvalidWhileHolding = carried != null && shortQty <= 0;
  const previewAllocated = canPlace ? allocatedQty + pendingPreview : allocatedQty;
  const previewShort = canPlace ? Math.max(0, remaining - previewAllocated) : shortQty;
  const showPreview = canPlace && isHovering && pendingPreview > 0;
  const visual = itemVisual(row.itemName, row.unitName);
  const demandLabel = demandContextLabel(row);
  const canPickFromSameSourceWhileHolding =
    carried != null &&
    draftAllocations.some((allocation) => allocation.sourceKey === carried.sourceKey);
  const canPickAllocatedToken = carried == null || canPickFromSameSourceWhileHolding;
  const sameSourceAllocation = carried
    ? draftAllocations.find(
        (allocation) =>
          allocation.sourceKey === carried.sourceKey && allocation.quantity > 0
      )
    : null;
  const slotTargetClassName =
    canPlace &&
    (demandTypeOf(row) === "manufacturing_order_ingredient"
      ? "alloc-glow-demand border-2 border-solid border-[var(--alloc-demand)]"
      : "alloc-glow-drop border-2 border-solid border-[var(--alloc-drop)]");
  const getDropTargetRect = (fallback: Element) =>
    dropSlotRef.current
      ? getSpriteTransferTargetRect(dropSlotRef.current)
      : getSpriteTransferTargetRect(fallback);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Allocate to ${row.label}`}
      data-testid={isTarget ? "current-allocation-bucket" : "readonly-allocation-bucket"}
      data-allocation-interactive
      data-allocation-state={
        canPlace ? "valid-target" : isInvalidWhileHolding ? "invalid-target" : "idle"
      }
      className={cn(
        "cursor-pointer",
        "w-full rounded-md border bg-background p-2.5 text-left shadow-xs transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        isInvalidWhileHolding && "opacity-65",
        lastPlacedDemandId === row.demandId &&
          "animate-in zoom-in-95 motion-reduce:animate-none"
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
      onClick={(event) => {
        if (carried) {
          if (sameSourceAllocation) {
            onPickToken(
              {
                ...sameSourceAllocation,
                quantity: sameSourceAllocation.quantity,
              },
              getSpriteTransferTargetRect(event.currentTarget)
            );
            return;
          }
          if (!canPlace) {
            onInvalid(shortQty <= 0 ? "Order already full" : "Cannot place stock here");
            return;
          }
          onPlace(getDropTargetRect(event.currentTarget));
          return;
        }
        if (allocatedQty <= 0) {
          onInvalid("Pick up stock first");
          return;
        }
        const firstAllocation = draftAllocations.find((allocation) => allocation.quantity > 0);
        if (!firstAllocation) {
          onInvalid("Pick up stock first");
          return;
        }
        onPickToken(
          {
            ...firstAllocation,
            quantity: firstAllocation.quantity,
          },
          getSpriteTransferTargetRect(event.currentTarget)
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (carried) {
            if (sameSourceAllocation) {
              onPickToken({
                ...sameSourceAllocation,
                quantity: sameSourceAllocation.quantity,
              });
              return;
            }
            if (!canPlace) {
              onInvalid(shortQty <= 0 ? "Order already full" : "Cannot place stock here");
              return;
            }
            onPlace();
          } else {
            const firstAllocation = draftAllocations.find(
              (allocation) => allocation.quantity > 0
            );
            if (!firstAllocation) {
              onInvalid("Pick up stock first");
              return;
            }
            onPickToken(firstAllocation);
          }
        }
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Badge className="rounded-sm bg-warning/10 text-warning">{row.label}</Badge>
            <span className="truncate text-muted-foreground">{row.contextLabel}</span>
            {isTarget ? <Badge variant="outline">This order</Badge> : null}
            {isInvalidWhileHolding ? <AffordanceChip tone="warning">Full</AffordanceChip> : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          {demandDateLabel(row)} {row.requiredDate ? formatDate(row.requiredDate) : "\u2014"}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <div ref={dropSlotRef}>
          <DemandQuantityStacks
            total={remaining}
            allocated={allocatedQty}
            visual={visual}
            allocations={draftAllocations}
            held={held}
            demandLabel={demandLabel}
            emptySlotClassName={slotTargetClassName || undefined}
            onPick={
              canPickAllocatedToken
                ? (token, sourceRect) =>
                    onPickToken(
                      {
                        ...token,
                        itemName: row.itemName,
                        unitName: row.unitName,
                        originDemandId: row.demandId,
                        originLabel: row.label,
                        originContext: row.contextLabel,
                      },
                      sourceRect
                    )
                : undefined
            }
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-16 flex-1">
            <ProgressBar value={allocatedQty} max={remaining} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 text-sm">
            {showPreview ? (
              <AffordanceChip tone="success">
                Allocated {quantityLabel(allocatedQty)} → {quantityLabel(previewAllocated)}
              </AffordanceChip>
            ) : null}
            <span>
              <span className="text-muted-foreground">Allocated </span>
              <span className="font-medium text-success">
                {formatQuantity(toQuantityString(allocatedQty))}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Short </span>
              <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
                {shortLabel(shortQty)}
              </span>
            </span>
            {showPreview ? (
              <span>
                <span className="text-muted-foreground">Preview short </span>
                <span className={cn("font-medium", previewShort > 0 && "text-destructive")}>
                  {shortLabel(previewShort)}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputAllocationWorkspace({
  manufacturingOrderId,
  onBack,
  onOpenOutput,
  onDirtyChange,
  onHoldingChange,
}: {
  manufacturingOrderId: string;
  onBack: (options?: { dirtyHandled?: boolean }) => void;
  onOpenOutput: (id: string, options?: { dirtyHandled?: boolean }) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHoldingChange: (holding: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [hoveredIngredientId, setHoveredIngredientId] = useState<string | null>(null);
  const [outputSelected, setOutputSelected] = useState(true);
  const [outputCarry, setOutputCarry] = useState<OutputCarryState>(null);
  const [events, setEvents] = useState<AllocationEvent[]>([]);
  const outputCarryOriginRectRef = useRef<DOMRect | null>(null);
  const productionSlotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const {
    animations: spriteTransfers,
    animateFromHud,
    animatePickupToHud,
    hudQuantityOverride,
    removeSpriteTransfer,
  } = useSpriteTransferAnimations();
  const [draftState, setDraftState] = useState<{
    manufacturingOrderId: string | null;
    values: Record<string, string>;
  }>({ manufacturingOrderId: null, values: {} });
  const [salesDraftState, setSalesDraftState] = useState<{
    manufacturingOrderId: string | null;
    values: Record<string, string>;
  }>({ manufacturingOrderId: null, values: {} });
  const outputQuery = useQuery<OutputAllocationData>({
    queryKey: ["manufacturing-output-allocation", manufacturingOrderId],
    queryFn: async () => {
      const outputData = await apiJson<OutputAllocationWire>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        { fallbackError: "Failed to load output allocation." }
      );
      return outputWireToOutputData(outputData);
    },
  });
  const data = outputQuery.data ?? null;
  const defaultDraft = useMemo(
    () =>
      Object.fromEntries(
        data?.productionDestinations.map((destination) => [
          destination.ingredientId,
          formatQuantity(destination.assignedQty),
        ]) ?? []
      ),
    [data]
  );
  const draft =
    draftState.manufacturingOrderId === manufacturingOrderId
      ? draftState.values
      : defaultDraft;
  const defaultSalesDraft = useMemo(
    () =>
      Object.fromEntries(
        data?.salesDestinations.map((destination) => [
          destination.demandId,
          formatQuantity(destination.assignedQty),
        ]) ?? []
      ),
    [data]
  );
  const salesDraft =
    salesDraftState.manufacturingOrderId === manufacturingOrderId
      ? salesDraftState.values
      : defaultSalesDraft;
  const assignedProduction = Object.values(draft).reduce(
    (sum, value) => sum + readQuantity(value),
    0
  );
  const assignedSales = Object.values(salesDraft).reduce(
    (sum, value) => sum + readQuantity(value),
    0
  );
  const outputFree = data
    ? Math.max(
        0,
        readQuantity(data.sourceMo.plannedQuantity) -
          assignedSales -
          assignedProduction
      )
    : 0;
  const carriedQty = outputCarry?.quantity ?? null;
  const visibleOutputFree =
    outputCarry == null || outputCarry.originIngredientId
      ? outputFree
      : Math.max(0, outputFree - outputCarry.quantity);
  const outputVisual = data
    ? itemVisual(data.sourceMo.productName, null)
    : itemVisual(null, null);

  const animateOutputCarryFromHud = useCallback((quantity: number, targetRect?: DOMRect | null) => {
    if (!targetRect) return;
    animateFromHud({ quantity, targetRect, visual: outputVisual });
  }, [animateFromHud, outputVisual]);

  const animateOutputQuantityChange = useCallback((currentQty: number, nextQty: number) => {
    const delta = readQuantity(toQuantityString(nextQty - currentQty));
    if (delta > 0 && outputCarryOriginRectRef.current) {
      animatePickupToHud({
        quantity: delta,
        sourceRect: outputCarryOriginRectRef.current,
        visual: outputVisual,
        countIntoHud: false,
      });
      return;
    }
    if (delta < 0) {
      animateOutputCarryFromHud(Math.abs(delta), outputCarryOriginRectRef.current);
    }
  }, [animateOutputCarryFromHud, animatePickupToHud, outputVisual]);

  function pushOutputEvent(message: string, tone: AllocationEvent["tone"] = "success") {
    setEvents((current) => [
      ...current.slice(-2),
      { id: Date.now() + Math.random(), tone, message },
    ]);
  }

  useEffect(() => {
    if (events.length === 0) return;
    const timeout = window.setTimeout(() => setEvents((current) => current.slice(1)), 1800);
    return () => window.clearTimeout(timeout);
  }, [events]);

  const mutation = useMutation({
    mutationFn: () =>
      apiJson<OutputAllocationWire>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        {
          method: "PUT",
          body: {
            salesAllocations: Object.entries(salesDraft)
              .map(([demandId, quantity]) => ({
                salesOrderLineId: demandId,
                quantity,
              }))
              .filter((allocation) => readQuantity(allocation.quantity) > 0),
            productionAllocations: Object.entries(draft)
              .map(([ingredientId, quantity]) => ({ ingredientId, quantity }))
              .filter((allocation) => readQuantity(allocation.quantity) > 0),
          },
          fallbackError: "Failed to save output allocation.",
        }
      ),
    onSuccess: async (nextWireData) => {
      const nextData = outputWireToOutputData(nextWireData);
      setDraftState({
        manufacturingOrderId,
        values: Object.fromEntries(
          nextData.productionDestinations.map((destination) => [
            destination.ingredientId,
            formatQuantity(destination.assignedQty),
          ])
        ),
      });
      setSalesDraftState({
        manufacturingOrderId,
        values: Object.fromEntries(
          nextData.salesDestinations.map((destination) => [
            destination.demandId,
            formatQuantity(destination.assignedQty),
          ])
        ),
      });
      setOutputCarry(null);
      pushOutputEvent("Allocation saved");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["manufacturing-output-allocation", manufacturingOrderId],
        }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
    },
    onError: (error) => {
      pushOutputEvent(
        error instanceof Error ? error.message : "Failed to save allocation.",
        "danger"
      );
    },
  });

  const canSave =
    !!data &&
    !outputQuery.isLoading &&
    !mutation.isPending &&
    outputCarry == null &&
    (JSON.stringify(draft) !== JSON.stringify(defaultDraft) ||
      JSON.stringify(salesDraft) !== JSON.stringify(defaultSalesDraft));
  const hasOutputChanges =
    JSON.stringify(draft) !== JSON.stringify(defaultDraft) ||
    JSON.stringify(salesDraft) !== JSON.stringify(defaultSalesDraft);

  useEffect(() => {
    onDirtyChange(hasOutputChanges);
    return () => onDirtyChange(false);
  }, [hasOutputChanges, onDirtyChange]);

  useEffect(() => {
    onHoldingChange(outputCarry != null);
    return () => onHoldingChange(false);
  }, [onHoldingChange, outputCarry]);

  function requestBack() {
    if (outputCarry != null) {
      pushOutputEvent("Place held stock or press Esc to cancel", "warning");
      return;
    }
    if (hasOutputChanges) {
      const shouldLeave = window.confirm("Discard unsaved allocation changes?");
      if (!shouldLeave) return;
      setDraftState({ manufacturingOrderId, values: defaultDraft });
      setSalesDraftState({ manufacturingOrderId, values: defaultSalesDraft });
    }
    setOutputCarry(null);
    onDirtyChange(false);
    onBack({ dirtyHandled: hasOutputChanges });
  }

  function requestOpenOutput(id: string) {
    if (outputCarry != null) {
      pushOutputEvent("Place held stock or press Esc to cancel", "warning");
      return;
    }
    if (hasOutputChanges) {
      const shouldLeave = window.confirm("Discard unsaved allocation changes?");
      if (!shouldLeave) return;
      setDraftState({ manufacturingOrderId, values: defaultDraft });
      setSalesDraftState({ manufacturingOrderId, values: defaultSalesDraft });
    }
    onDirtyChange(false);
    onOpenOutput(id, { dirtyHandled: hasOutputChanges });
  }

  const getOutputCarryMax = useCallback((carry: NonNullable<OutputCarryState>) => {
    if (!carry.originIngredientId) return outputFree;
    return Math.max(1, readQuantity(draft[carry.originIngredientId]));
  }, [draft, outputFree]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (outputCarry == null) return;
      if (event.key === "Escape") {
        animateOutputCarryFromHud(outputCarry.quantity, outputCarryOriginRectRef.current);
        outputCarryOriginRectRef.current = null;
        setOutputCarry(null);
      } else if (event.key.toLowerCase() === "x") {
        const nextQty = Math.max(1, Math.floor(outputCarry.quantity / 2));
        animateOutputQuantityChange(outputCarry.quantity, nextQty);
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
      } else if (event.key === "+" || event.key === "=") {
        const nextQty = clampQuantity(
          outputCarry.quantity + (event.shiftKey ? 5 : 1),
          getOutputCarryMax(outputCarry)
        );
        animateOutputQuantityChange(outputCarry.quantity, nextQty);
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
      } else if (event.key === "-") {
        const nextQty = Math.max(1, outputCarry.quantity - (event.shiftKey ? 5 : 1));
        animateOutputQuantityChange(outputCarry.quantity, nextQty);
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [animateOutputCarryFromHud, animateOutputQuantityChange, getOutputCarryMax, outputCarry]);

  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (outputCarry == null) return;
      event.preventDefault();
      const nextQty = Math.max(
        1,
        clampQuantity(
          outputCarry.quantity + (event.deltaY < 0 ? 1 : -1),
          getOutputCarryMax(outputCarry)
        )
      );
      animateOutputQuantityChange(outputCarry.quantity, nextQty);
      setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [animateOutputQuantityChange, getOutputCarryMax, outputCarry]);

  function updateSalesDestination(demandId: string, quantity: number) {
    setSalesDraftState((current) => ({
      manufacturingOrderId,
      values: {
        ...(current.manufacturingOrderId === manufacturingOrderId
          ? current.values
          : defaultSalesDraft),
        [demandId]: toQuantityString(quantity),
      },
    }));
  }

  function placeOnDestination(ingredientId: string, targetRect?: DOMRect) {
    if (outputCarry == null) {
      pushOutputEvent("Pick up output first", "warning");
      return;
    }
    if (!data) return;
    const destination = data.productionDestinations.find(
      (candidate) => candidate.ingredientId === ingredientId
    );
    if (!destination) return;
    const current = readQuantity(draft[ingredientId]);
    if (outputCarry.originIngredientId === ingredientId) {
      if (targetRect) {
        animateFromHud({ quantity: outputCarry.quantity, targetRect, visual: outputVisual });
      }
      setOutputCarry(null);
      setSelectedIngredientId(ingredientId);
      return;
    }
    const visibleCurrent =
      outputCarry.originIngredientId === ingredientId
        ? Math.max(0, current - outputCarry.quantity)
        : current;
    const remaining = Math.max(0, readQuantity(destination.remainingNeed) - visibleCurrent);
    const availableToPlace = outputCarry.originIngredientId ? outputCarry.quantity : outputFree;
    const quantity = Math.min(outputCarry.quantity, remaining, availableToPlace);
    if (quantity <= 0) {
      pushOutputEvent(remaining <= 0 ? "Order already full" : "Cannot place stock here", "warning");
      return;
    }
    if (targetRect) {
      animateFromHud({ quantity, targetRect, visual: outputVisual });
    }
    setDraftState((currentDraftState) => {
      const values =
        currentDraftState.manufacturingOrderId === manufacturingOrderId
          ? currentDraftState.values
          : defaultDraft;
      const nextValues = { ...values };
      if (outputCarry.originIngredientId) {
        const originCurrent = readQuantity(nextValues[outputCarry.originIngredientId]);
        nextValues[outputCarry.originIngredientId] = toQuantityString(originCurrent - quantity);
      }
      nextValues[ingredientId] = toQuantityString(readQuantity(nextValues[ingredientId]) + quantity);
      return { manufacturingOrderId, values: nextValues };
    });
    setOutputCarry((currentCarry) =>
      currentCarry == null || currentCarry.quantity <= quantity
        ? null
        : {
            ...currentCarry,
            quantity: readQuantity(toQuantityString(currentCarry.quantity - quantity)),
          }
    );
    setSelectedIngredientId(ingredientId);
  }

  function placeOnSalesDestination(demandId: string, targetRect?: DOMRect) {
    if (outputCarry == null) {
      pushOutputEvent("Pick up output first", "warning");
      return;
    }
    if (!data) return;
    const destination = data.salesDestinations.find(
      (candidate) => candidate.demandId === demandId
    );
    if (!destination) return;
    const current = readQuantity(salesDraft[demandId]);
    const remaining = Math.max(0, readQuantity(destination.remainingQty) - current);
    const availableToPlace = outputCarry.originIngredientId ? outputCarry.quantity : outputFree;
    const quantity = Math.min(outputCarry.quantity, remaining, availableToPlace);
    if (quantity <= 0) {
      pushOutputEvent(remaining <= 0 ? "Order already full" : "Cannot place stock here", "warning");
      return;
    }
    if (targetRect) {
      animateFromHud({ quantity, targetRect, visual: outputVisual });
    }
    if (outputCarry.originIngredientId) {
      const originIngredientId = outputCarry.originIngredientId;
      setDraftState((currentDraftState) => {
        const values =
          currentDraftState.manufacturingOrderId === manufacturingOrderId
            ? currentDraftState.values
            : defaultDraft;
        const originCurrent = readQuantity(values[originIngredientId]);
        return {
          manufacturingOrderId,
          values: {
            ...values,
            [originIngredientId]: toQuantityString(originCurrent - quantity),
          },
        };
      });
    }
    updateSalesDestination(demandId, current + quantity);
    setOutputCarry((currentCarry) =>
      currentCarry == null || currentCarry.quantity <= quantity
        ? null
        : {
            ...currentCarry,
            quantity: readQuantity(toQuantityString(currentCarry.quantity - quantity)),
          }
    );
    setSelectedIngredientId(demandId);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4"
      onClick={(event) => {
        if (carriedQty == null) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-allocation-interactive]")) return;
        pushOutputEvent("Choose a highlighted target or press Esc to cancel", "warning");
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={requestBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          Back
        </Button>
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canSave}>
          {mutation.isPending ? "Saving..." : "Save allocation"}
        </Button>
      </div>

      {outputQuery.isLoading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="text-foreground" />
        </div>
      ) : outputQuery.isError ? (
        <p className="text-sm text-destructive">{outputQuery.error.message}</p>
      ) : data ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <AllocationSpriteTile
                kind={outputVisual.kind}
                color={outputVisual.color}
                state="inbound"
                size="xs"
              />
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {data.sourceMo.orderNumber}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="truncate">{data.sourceMo.productName}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {statusLabel(data.sourceMo.status)}
                  </Badge>
                </div>
              </div>
            </div>
            <HeaderMetric
              label="output"
              free={visibleOutputFree}
              total={readQuantity(data.sourceMo.plannedQuantity)}
              tone="primary"
            />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,0.9fr)_minmax(20rem,1.1fr)] gap-4 overflow-x-auto overflow-y-hidden">
            <WorkspacePanel
              title="Supply"
              count="1 source"
              accent="supply"
            >
              <div className="flex min-h-0 flex-col gap-4">
                <div className="space-y-3">
                  <SectionTitle title="Manufacturing output" count="1 MO" />
                  <div className="flex flex-wrap gap-2">
                    <div className="flex w-20 flex-col items-center gap-1">
                      <button
                        type="button"
                        className={cn(
                          "group relative flex h-24 w-20 flex-col items-center justify-center rounded-md text-left transition motion-reduce:transition-none",
                          "focus-visible:outline-none focus-visible:[&>[data-slot=allocation-sprite-tile]]:border-ring",
                          outputFree <= 0 && "opacity-70"
                        )}
                        onClick={(event) => {
                          if (outputCarry != null) {
                            if (!outputCarry.originIngredientId) {
                              setOutputSelected(false);
                              animateOutputCarryFromHud(
                                outputCarry.quantity,
                                outputCarryOriginRectRef.current
                              );
                              outputCarryOriginRectRef.current = null;
                              setOutputCarry(null);
                              return;
                            }
                            pushOutputEvent("Place held stock or press Esc to cancel", "warning");
                            return;
                          }
                          setOutputSelected(true);
                          if (outputFree > 0) {
                            outputCarryOriginRectRef.current = getSpriteTransferTargetRect(
                              event.currentTarget
                            );
                            animatePickupToHud({
                              quantity: outputFree,
                              sourceRect: outputCarryOriginRectRef.current,
                              visual: outputVisual,
                            });
                            setOutputCarry({ quantity: outputFree });
                            pushOutputEvent("Click to allocate", "warning");
                          } else {
                            setOutputCarry(null);
                            pushOutputEvent("No available quantity", "warning");
                          }
                        }}
                        aria-label={`Pick up output from ${data.sourceMo.orderNumber}`}
                        data-testid="output-allocation-source"
                        data-allocation-interactive
                        data-allocation-state={
                          carriedQty == null
                            ? "idle"
                            : outputCarry?.originIngredientId
                              ? "invalid-target"
                              : "origin"
                        }
                      >
                        <AllocationSpriteTile
                          kind={outputVisual.kind}
                          color={outputVisual.color}
                          state="inbound"
                          selected={outputSelected}
                          size="md"
                          quantity={quantityLabel(visibleOutputFree)}
                        />
                      </button>
                      <div className="max-w-full truncate text-center text-xs font-medium text-primary">
                        {data.sourceMo.orderNumber}
                      </div>
                    </div>
                  </div>
                </div>

                {outputSelected ? (
                  <OutputSourceDetailPanel
                    data={data}
                    assignedSales={assignedSales}
                    assignedProduction={assignedProduction}
                    outputFree={visibleOutputFree}
                    draft={draft}
                    heldIngredientId={outputCarry?.originIngredientId}
                    heldQuantity={outputCarry?.originIngredientId ? outputCarry.quantity : 0}
                  />
                ) : null}
              </div>
            </WorkspacePanel>

            <WorkspacePanel
              title="Demand"
              count={`${data.salesDestinations.length + data.productionDestinations.length} destinations`}
              accent="production"
            >
            {data.salesDestinations.length === 0 && data.productionDestinations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No open orders currently need this output.
              </div>
            ) : (
              <>
              {data.salesDestinations.map((destination) => {
                const allocated = readQuantity(salesDraft[destination.demandId]);
                const remaining = readQuantity(destination.remainingQty);
                const shortQty = Math.max(0, remaining - allocated);
                const selected = selectedIngredientId === destination.demandId;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={destination.demandId}
                    aria-label={`Allocate output to ${destination.orderNumber}`}
                    onClick={(event) =>
                      placeOnSalesDestination(
                        destination.demandId,
                        getSpriteTransferTargetRect(event.currentTarget)
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        placeOnSalesDestination(destination.demandId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "border-success/30 bg-success/5",
                      selected && "alloc-glow-supply"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <Badge className="rounded-sm bg-success/10 text-success">SO</Badge>
                          <span className="font-semibold">{destination.orderNumber}</span>
                          <span className="truncate text-muted-foreground">
                            {destination.customerName ?? "Sales order"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          needs {data.sourceMo.productName}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{destination.shipDate ? formatDate(destination.shipDate) : "\u2014"}</div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <DemandQuantityStacks
                        total={remaining}
                        allocated={allocated}
                        visual={outputVisual}
                      />
                      <ProgressBar value={allocated} max={remaining} tone="success" />
                      <div className="flex justify-end gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">Allocated </span>
                          <span className="font-medium text-success">
                            {formatQuantity(toQuantityString(allocated))}
                          </span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Short </span>
                          <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
                            {shortLabel(shortQty)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {data.productionDestinations.map((destination) => {
                const allocated = readQuantity(draft[destination.ingredientId]);
                const heldFromDestination =
                  outputCarry?.originIngredientId === destination.ingredientId
                    ? outputCarry.quantity
                    : 0;
                const visibleAllocated = Math.max(0, allocated - heldFromDestination);
                const remaining = readQuantity(destination.remainingNeed);
                const shortQty = Math.max(0, remaining - visibleAllocated);
                const selected = selectedIngredientId === destination.ingredientId;
                const isOrigin = outputCarry?.originIngredientId === destination.ingredientId;
                const canPlace = outputCarry != null && !isOrigin && shortQty > 0;
                const previewQty =
                  canPlace
                    ? Math.min(
                        outputCarry.quantity,
                        shortQty,
                        outputCarry.originIngredientId ? outputCarry.quantity : outputFree
                      )
                    : 0;
                const showPreview =
                  hoveredIngredientId === destination.ingredientId && previewQty > 0;
                const previewAllocated = visibleAllocated + previewQty;
                const previewShort = Math.max(0, remaining - previewAllocated);
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={destination.ingredientId}
                    aria-label={`Allocate output to ${destination.orderNumber}`}
                    data-testid="output-allocation-destination"
                    data-allocation-interactive
                    data-allocation-state={
                      carriedQty == null
                        ? "idle"
                        : isOrigin
                          ? "origin"
                        : canPlace
                          ? "valid-target"
                          : "invalid-target"
                    }
                    onClick={(event) =>
                      placeOnDestination(
                        destination.ingredientId,
                        productionSlotRefs.current[destination.ingredientId]
                          ? getSpriteTransferTargetRect(
                              productionSlotRefs.current[destination.ingredientId]!
                            )
                          : getSpriteTransferTargetRect(event.currentTarget)
                      )
                    }
                    onMouseEnter={() => setHoveredIngredientId(destination.ingredientId)}
                    onMouseLeave={() => setHoveredIngredientId(null)}
                    onFocus={() => setHoveredIngredientId(destination.ingredientId)}
                    onBlur={() => setHoveredIngredientId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        placeOnDestination(destination.ingredientId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                      "border-primary/30 bg-primary/5",
                      isOrigin && "alloc-glow-demand bg-warning/10",
                      carriedQty != null && !isOrigin && shortQty <= 0 && "opacity-65",
                      selected && "alloc-glow-demand"
                    )}
                  >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <Badge className="rounded-sm bg-primary/10 text-primary">MO</Badge>
                            <span className="font-semibold">{destination.orderNumber}</span>
                            {isOrigin ? (
                              <AffordanceChip tone="source">Return here</AffordanceChip>
                            ) : null}
                            {carriedQty != null && !isOrigin && shortQty <= 0 ? (
                              <AffordanceChip tone="warning">Full</AffordanceChip>
                            ) : null}
                            <span className="truncate text-muted-foreground">
                              produces {formatQuantity(destination.outputPlannedQuantity ?? "")}{" "}
                              {destination.outputProductName ?? destination.productName}
                              {destination.salesOrderNumber
                                ? ` \u2192 ${destination.salesOrderNumber}`
                                : ""}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            consumes {data.sourceMo.productName}
                            {destination.salesCustomerName
                              ? ` · ${destination.salesCustomerName}`
                              : ""}
                          </div>
                        </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{destination.plannedDate ? formatDate(destination.plannedDate) : "\u2014"}</div>
                        <div>{statusLabel(destination.status)}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 px-2 text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestOpenOutput(destination.manufacturingOrderId);
                          }}
                        >
                          Open output
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div
                        ref={(node) => {
                          productionSlotRefs.current[destination.ingredientId] = node;
                        }}
                      >
                        <DemandQuantityStacks
                          total={remaining}
                          allocated={visibleAllocated}
                          visual={outputVisual}
                          allocations={[
                            {
                              sourceKey: "output",
                              sourceType: "manufacturing_order",
                              sourceId: manufacturingOrderId,
                              sourceLabel: data.sourceMo.orderNumber,
                              sourceIndex: 0,
                              quantity: allocated,
                            },
                          ]}
                          held={
                            heldFromDestination > 0
                              ? { sourceKey: "output", quantity: heldFromDestination }
                              : null
                          }
                          demandLabel={destination.orderNumber}
                          emptySlotClassName={
                            canPlace
                              ? "alloc-glow-demand border-2 border-solid border-[var(--alloc-demand)]"
                              : undefined
                          }
                          onPick={
                            outputCarry == null
                              ? (token, sourceRect) => {
                                  if (sourceRect) {
                                    outputCarryOriginRectRef.current = sourceRect;
                                    animatePickupToHud({
                                      quantity: token.quantity,
                                      sourceRect,
                                      visual: outputVisual,
                                    });
                                  }
                                  setOutputCarry({
                                    quantity: token.quantity,
                                    originIngredientId: destination.ingredientId,
                                    originLabel: destination.orderNumber,
                                  });
                                  setSelectedIngredientId(destination.ingredientId);
                                  pushOutputEvent("Click to allocate", "warning");
                                }
                              : undefined
                          }
                        />
                      </div>
                        <ProgressBar value={visibleAllocated} max={remaining} tone="primary" />
                      <div className="flex flex-wrap justify-end gap-3 text-sm">
                        {showPreview ? (
                          <AffordanceChip tone="success">
                            Allocated {quantityLabel(visibleAllocated)} → {quantityLabel(previewAllocated)}
                          </AffordanceChip>
                        ) : null}
                        <span>
                          <span className="text-muted-foreground">Allocated </span>
                          <span className="font-medium text-success">{quantityLabel(visibleAllocated)}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Short </span>
                          <span className={cn("font-medium", shortQty > 0 && "text-destructive")}>
                            {shortLabel(shortQty)}
                          </span>
                        </span>
                        {showPreview ? (
                          <span>
                            <span className="text-muted-foreground">Preview short </span>
                            <span className={cn("font-medium", previewShort > 0 && "text-destructive")}>
                              {shortLabel(previewShort)}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              </>
            )}
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : null}
            </WorkspacePanel>
          </div>
          <CarryPanel
            carried={
              outputCarry == null
                ? null
                : {
                    sourceKey: "output",
                    sourceType: "manufacturing_order",
                    sourceId: manufacturingOrderId,
                      sourceLabel: data.sourceMo.orderNumber,
                      sourceIndex: 0,
                      quantity: outputCarry.quantity,
                      itemName: data.sourceMo.productName,
                      originDemandId: outputCarry.originIngredientId,
                      originLabel: outputCarry.originLabel,
                  }
            }
            className="bottom-6"
            displayQuantity={hudQuantityOverride}
          />
          <SpriteTransferOverlay
            animations={spriteTransfers}
            onDone={removeSpriteTransfer}
          />
          <AllocationEventLog events={events} />
        </>
      ) : null}
    </div>
  );
}

export function AllocationManagerSheet({
  lineId: legacyDemandId,
  demandRef,
  itemId,
  open,
  onOpenChange,
  onTargetDemandChange,
  onTargetLineChange,
  outputManufacturingOrderId,
  onOutputManufacturingOrderChange,
  onSaved,
  renderCreateManufacturingOrderAction,
}: Props) {
  const notifyTargetDemandChange = onTargetDemandChange ?? onTargetLineChange;
  const activeDemandRef =
    demandRef ?? (legacyDemandId ? { demandType: "sales_order_line", demandId: legacyDemandId } : null);
  const activeDemandId = activeDemandRef?.demandId ?? null;
  const queryClient = useQueryClient();
  const [internalOutputMoId, setInternalOutputMoId] = useState<string | null>(null);
  const isOutputMoControlled = outputManufacturingOrderId !== undefined;
  const outputMoId = isOutputMoControlled
    ? outputManufacturingOrderId
    : internalOutputMoId;
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [carried, setCarried] = useState<CarryState>(null);
  const [events, setEvents] = useState<AllocationEvent[]>([]);
  const carryOriginRectRef = useRef<DOMRect | null>(null);
  const {
    animations: spriteTransfers,
    animateFromHud,
    animatePickupToHud,
    hudQuantityOverride,
    removeSpriteTransfer,
  } = useSpriteTransferAnimations();
  const [lastPlacedDemandId, setLastPlacedDemandId] = useState<string | null>(null);
  const [outputHasChanges, setOutputHasChanges] = useState(false);
  const [outputIsHolding, setOutputIsHolding] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<{
    itemId: string;
    demandId: string | null;
  } | null>(null);
  const [draftState, setDraftState] = useState<AllocationDraftState>({
    workspaceKey: null,
    values: {},
  });
  const activeItemId = itemId ?? (browseTarget?.demandId === activeDemandId ? browseTarget.itemId : null);
  const draftWorkspaceKey = activeDemandRef
    ? `${activeDemandRef.demandType}:${activeDemandRef.demandId}`
      : activeItemId != null
        ? `item:${activeItemId}`
        : null;
  const query = useQuery<AllocationSheetData>({
    queryKey: ["allocation-workspace", activeDemandRef, activeItemId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeDemandRef) {
        params.set("demandType", activeDemandRef.demandType);
        params.set("demandId", activeDemandRef.demandId);
      } else if (activeItemId) {
        params.set("itemId", activeItemId);
      }
      const workspace = await apiJson<AllocationWorkspace>(
        `/api/allocation/workspace?${params.toString()}`,
        { fallbackError: "Failed to load allocation." }
      );
      return workspaceToAllocationSheetData(workspace);
    },
    enabled:
      open &&
      (activeDemandRef != null || activeItemId != null) &&
      outputMoId == null,
  });

  const data = query.data ?? null;
  const defaultDraftsByDemand = useMemo(
    () =>
      Object.fromEntries(
        data?.demandRows.map((row) => [
          row.demandId,
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
  const draftsByDemand =
    draftWorkspaceKey != null && draftState.workspaceKey === draftWorkspaceKey
      ? draftState.values
      : defaultDraftsByDemand;
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
  const targetDemand = data?.targetDemand ?? null;
  const targetDemandId = targetDemand?.demandId ?? null;
  const targetItem = data?.targetItem ?? null;
  const targetUnitLabel = compactUnitName(targetDemand?.unitName ?? targetItem?.unitName);
  const targetVisual = itemVisual(targetItem?.itemName, targetItem?.unitName);

  function pushEvent(message: string, tone: AllocationEvent["tone"] = "success") {
    setEvents((current) => [
      ...current.slice(-2),
      { id: Date.now() + Math.random(), tone, message },
    ]);
  }

  useEffect(() => {
    if (events.length === 0) return;
    const timeout = window.setTimeout(() => {
      setEvents((current) => current.slice(1));
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [events]);

  useEffect(() => {
    if (!lastPlacedDemandId) return;
    const timeout = window.setTimeout(() => setLastPlacedDemandId(null), 900);
    return () => window.clearTimeout(timeout);
  }, [lastPlacedDemandId]);

  function setOutputMoId(id: string | null) {
    if (isOutputMoControlled) {
      onOutputManufacturingOrderChange?.(id);
      return;
    }
    setInternalOutputMoId(id);
  }

  function canLeaveCurrentWorkspace(options: { outputDirtyHandled?: boolean } = {}) {
    if (carried) {
      pushEvent("Place held stock or press Esc to cancel", "warning");
      return false;
    }
    if (outputIsHolding) {
      pushEvent("Place held stock or press Esc to cancel", "warning");
      return false;
    }
    const hasUnhandledOutputChanges = outputHasChanges && !options.outputDirtyHandled;
    if (hasChanges || hasUnhandledOutputChanges) {
      const shouldLeave = window.confirm("Discard unsaved allocation changes?");
      return shouldLeave;
    }
    return true;
  }

  function discardCurrentWorkspaceDrafts() {
    setDraftState({ workspaceKey: draftWorkspaceKey, values: defaultDraftsByDemand });
    setOutputHasChanges(false);
  }

  function openOutputMo(id: string, options: { dirtyHandled?: boolean } = {}) {
    if (!canLeaveCurrentWorkspace({ outputDirtyHandled: options.dirtyHandled })) return;
    if (hasChanges || (outputHasChanges && !options.dirtyHandled)) discardCurrentWorkspaceDrafts();
    if (options.dirtyHandled) setOutputHasChanges(false);
    setCarried(null);
    setSelectedSourceKey(null);
    setOutputMoId(id);
  }

  function updateDrafts(nextDrafts: Record<string, AllocationDraft>) {
    setDraftState({ workspaceKey: draftWorkspaceKey, values: nextDrafts });
  }

  function getDemandDraftTotal(demandId: string) {
    return Object.values(draftsByDemand[demandId] ?? {}).reduce(
      (sum, value) => sum + readQuantity(value),
      0
    );
  }

  function getSourceDraftTotal(sourceKeyValue: string) {
    return Object.values(draftsByDemand).reduce(
      (sum, demandDraft) => sum + readQuantity(demandDraft[sourceKeyValue]),
      0
    );
  }

  function getSourcePreviewFree(source: AllocationSource) {
    return Math.max(
      0,
      readQuantity(source.totalQty) -
        getSourceDraftTotal(allocationKey(source.sourceType, source.sourceId))
    );
  }

  function getVisibleSourcePreviewFree(source: AllocationSource) {
    const key = allocationKey(source.sourceType, source.sourceId);
    const baseFree = getSourcePreviewFree(source);
    if (carried?.sourceKey === key && carried.originDemandId == null) {
      return Math.max(0, baseFree - carried.quantity);
    }
    return baseFree;
  }

  function getSourcePreviewFreeByKey(sourceKeyValue: string) {
    const source = data?.supplySources.find(
      (candidate) => allocationKey(candidate.sourceType, candidate.sourceId) === sourceKeyValue
    );
    if (!source) return 0;
    return getSourcePreviewFree(source);
  }

  function getCarryMax(token: NonNullable<CarryState>) {
    if (!token.originDemandId) return getSourcePreviewFreeByKey(token.sourceKey);
    return Math.max(1, readQuantity(draftsByDemand[token.originDemandId]?.[token.sourceKey]));
  }

  function getSourceSpriteRect(sourceKeyValue: string) {
    if (typeof document === "undefined") return null;
    const sources = document.querySelectorAll<HTMLElement>("[data-allocation-source-key]");
    for (const source of sources) {
      if (source.dataset.allocationSourceKey === sourceKeyValue) {
        return getSpriteTransferTargetRect(source);
      }
    }
    return null;
  }

  function pickToken(token: AllocationTokenData, sourceRect?: DOMRect) {
    if (token.quantity <= 0) {
      pushEvent("No available quantity", "warning");
      return;
    }
    if (token.originDemandId) {
      if (carried && carried.sourceKey !== token.sourceKey) {
        pushEvent("Place held stock or press Esc to cancel", "warning");
        return;
      }
      const originDraft = draftsByDemand[token.originDemandId] ?? {};
      const originQty = readQuantity(originDraft[token.sourceKey]);
      const quantity = Math.min(token.quantity, originQty);
      if (quantity <= 0) {
        pushEvent("No available quantity", "warning");
        return;
      }
      if (sourceRect) {
        animatePickupToHud({
          quantity,
          sourceRect,
          visual: itemVisual(token.itemName ?? token.sourceLabel, token.unitName),
          countIntoHud: false,
        });
      }
      carryOriginRectRef.current ??= getSourceSpriteRect(token.sourceKey);
      updateDrafts({
        ...draftsByDemand,
        [token.originDemandId]: {
          ...originDraft,
          [token.sourceKey]: toQuantityString(originQty - quantity),
        },
      });
      const nextQuantity = readQuantity(toQuantityString((carried?.quantity ?? 0) + quantity));
      setCarried({
        sourceKey: token.sourceKey,
        sourceType: token.sourceType,
        sourceId: token.sourceId,
        sourceLabel: token.sourceLabel,
        sourceIndex: token.sourceIndex,
        quantity: nextQuantity,
        itemName: token.itemName,
        unitName: token.unitName,
      });
      setSelectedSourceKey(token.sourceKey);
      pushEvent("Click to allocate", "warning");
      return;
    }
    if (carried) {
      pushEvent("Place held stock or press Esc to cancel", "warning");
      return;
    }
    if (sourceRect) {
      carryOriginRectRef.current = sourceRect;
      animatePickupToHud({
        quantity: token.quantity,
        sourceRect,
        visual: itemVisual(token.itemName ?? token.sourceLabel, token.unitName),
      });
    }
    setCarried(token);
    setSelectedSourceKey(token.sourceKey);
    pushEvent("Click to allocate", "warning");
  }

  function selectSource(sourceKeyValue: string) {
    if (carried && (carried.sourceKey !== sourceKeyValue || carried.originDemandId)) {
      pushEvent(
        carried.originDemandId && carried.sourceKey === sourceKeyValue
          ? "Click the origin demand to return"
          : "Place held stock or press Esc to cancel",
        "warning"
      );
      return false;
    }
    if (
      selectedSourceKey === sourceKeyValue &&
      carried?.sourceKey === sourceKeyValue &&
      !carried.originDemandId
    ) {
      cancelCarry();
      return false;
    }

    setSelectedSourceKey(sourceKeyValue);
    return true;
  }

  function cancelCarry() {
    if (!carried) return;
    animateCarriedFromHud(carried.quantity, carryOriginRectRef.current ?? undefined);
    carryOriginRectRef.current = null;
    setCarried(null);
  }

  function animateCarriedFromHud(quantity: number, targetRect?: DOMRect) {
    if (!carried || !targetRect) return;
    animateFromHud({
      quantity,
      targetRect,
      visual: itemVisual(carried.itemName ?? carried.sourceLabel, carried.unitName),
    });
  }

  function animateCarryQuantityChange(currentQty: number, nextQty: number) {
    if (!carried) return;
    const delta = readQuantity(toQuantityString(nextQty - currentQty));
    if (delta > 0 && carryOriginRectRef.current) {
      animatePickupToHud({
        quantity: delta,
        sourceRect: carryOriginRectRef.current,
        visual: itemVisual(carried.itemName ?? carried.sourceLabel, carried.unitName),
        countIntoHud: false,
      });
      return;
    }
    if (delta < 0) {
      animateCarriedFromHud(Math.abs(delta), carryOriginRectRef.current ?? undefined);
    }
  }

  function allocateTokenToDemand(token: AllocationTokenData, demandId: string, targetRect?: DOMRect) {
    const row = data?.demandRows.find(
      (demandRow) => demandRow.demandId === demandId
    );
    if (!row) return;

    const demandDraft = draftsByDemand[demandId] ?? {};
    const currentQty = readQuantity(demandDraft[token.sourceKey]);
    const demandShortQty = Math.max(
      0,
      readQuantity(row.remainingQty) - getDemandDraftTotal(demandId)
    );
    const sourceFree = Math.max(0, getSourcePreviewFreeByKey(token.sourceKey));
    const quantity = Math.min(token.quantity, demandShortQty, sourceFree);
    if (quantity <= 0) {
      pushEvent(demandShortQty <= 0 ? "Order already full" : "Cannot place stock here", "warning");
      return;
    }
    animateCarriedFromHud(quantity, targetRect);

    updateDrafts({
      ...draftsByDemand,
      [demandId]: {
        ...demandDraft,
        [token.sourceKey]: toQuantityString(currentQty + quantity),
      },
    });
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
    setLastPlacedDemandId(demandId);
  }

  function moveAllocatedTokenToDemand(
    token: AllocationTokenData,
    targetDemandId: string,
    targetRect?: DOMRect
  ) {
    const originDemandId = token.originDemandId;
    if (!originDemandId) return;
    if (originDemandId === targetDemandId) {
      animateCarriedFromHud(token.quantity, targetRect);
      setCarried(null);
      return;
    }

    const targetRow = data?.demandRows.find(
      (demandRow) => demandRow.demandId === targetDemandId
    );
    if (!targetRow) return;

    const originDraft = draftsByDemand[originDemandId] ?? {};
    const targetDraft = draftsByDemand[targetDemandId] ?? {};
    const originQty = readQuantity(originDraft[token.sourceKey]);
    const targetCurrentQty = readQuantity(targetDraft[token.sourceKey]);
    const targetShortQty = Math.max(
      0,
      readQuantity(targetRow.remainingQty) - getDemandDraftTotal(targetDemandId)
    );
    const quantity = Math.min(token.quantity, originQty, targetShortQty);
    if (quantity <= 0) {
      pushEvent(targetShortQty <= 0 ? "Order already full" : "Cannot place stock here", "warning");
      return;
    }
    animateCarriedFromHud(quantity, targetRect);

    updateDrafts({
      ...draftsByDemand,
      [originDemandId]: {
        ...originDraft,
        [token.sourceKey]: toQuantityString(originQty - quantity),
      },
      [targetDemandId]: {
        ...targetDraft,
        [token.sourceKey]: toQuantityString(targetCurrentQty + quantity),
      },
    });
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
    setLastPlacedDemandId(targetDemandId);
  }

  function placeOnDemand(demandId: string, targetRect?: DOMRect) {
    if (!carried) return;
    if (carried.originDemandId) {
      moveAllocatedTokenToDemand(carried, demandId, targetRect);
      return;
    }
    allocateTokenToDemand(carried, demandId, targetRect);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!carried) return;
      if (event.key === "Escape") {
        cancelCarry();
      } else if (event.key.toLowerCase() === "x") {
        const nextQty = Math.max(1, Math.floor(carried.quantity / 2));
        animateCarryQuantityChange(carried.quantity, nextQty);
        setCarried((current) =>
          current ? { ...current, quantity: nextQty } : null
        );
      } else if (event.key === "+" || event.key === "=") {
        const nextQty = clampQuantity(
          carried.quantity + (event.shiftKey ? 5 : 1),
          getCarryMax(carried)
        );
        animateCarryQuantityChange(carried.quantity, nextQty);
        setCarried((current) =>
          current
            ? {
                ...current,
                quantity: nextQty,
              }
            : null
        );
      } else if (event.key === "-") {
        const nextQty = Math.max(1, carried.quantity - (event.shiftKey ? 5 : 1));
        animateCarryQuantityChange(carried.quantity, nextQty);
        setCarried((current) =>
          current
            ? { ...current, quantity: nextQty }
            : null
        );
      } else if (event.key === "Enter" && targetDemandId) {
        placeOnDemand(targetDemandId);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (!carried) return;
      event.preventDefault();
      const nextQty = Math.max(
        1,
        clampQuantity(
          carried.quantity + (event.deltaY < 0 ? 1 : -1),
          getCarryMax(carried)
        )
      );
      animateCarryQuantityChange(carried.quantity, nextQty);
      setCarried((current) =>
        current
          ? {
              ...current,
              quantity: nextQty,
            }
          : null
      );
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  });

  const totalOverRemaining = (data?.demandRows ?? []).some(
    (row) => getDemandDraftTotal(row.demandId) > readQuantity(row.remainingQty)
  );
  const overAllocatedSource = data?.supplySources.find((source) => {
    const key = allocationKey(source.sourceType, source.sourceId);
    return getSourceDraftTotal(key) > readQuantity(source.totalQty);
  });
  const targetDraftTotal = targetDemandId ? getDemandDraftTotal(targetDemandId) : 0;
  const targetDraftShortQty = Math.max(
    0,
    readQuantity(targetDemand?.remainingQty) - targetDraftTotal
  );
  const hasChanges =
    JSON.stringify(draftsByDemand) !== JSON.stringify(defaultDraftsByDemand);
  const changedDemandCount = Object.keys(draftsByDemand).filter(
    (demandId) =>
      JSON.stringify(draftsByDemand[demandId] ?? {}) !==
      JSON.stringify(defaultDraftsByDemand[demandId] ?? {})
  ).length;

  function getHeldForDemand(demandId: string) {
    if (!carried?.originDemandId || carried.originDemandId !== demandId) return null;
    return { sourceKey: carried.sourceKey, quantity: carried.quantity };
  }

  function getVisibleDemandAllocated(demandId: string) {
    const total = getDemandDraftTotal(demandId);
    const held = getHeldForDemand(demandId);
    return Math.max(0, total - (held?.quantity ?? 0));
  }

  function getDemandDraftAllocations(demandId: string) {
    return Object.entries(draftsByDemand[demandId] ?? {}).flatMap(([key, value]) => {
      const quantity = readQuantity(value);
      if (quantity <= 0) return [];
      const meta = sourceMetaByKey.get(key);
      const parsed = parseAllocationKey(key);
      return [
        {
          sourceKey: key,
          sourceType: parsed.sourceType,
          sourceId: parsed.sourceId,
          sourceLabel: meta?.source.label ?? "Source",
          sourceIndex: meta?.index ?? 0,
          quantity,
        },
      ];
    });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const changedDemandIds = Object.keys(draftsByDemand).filter(
        (demandId) =>
          JSON.stringify(draftsByDemand[demandId] ?? {}) !==
          JSON.stringify(defaultDraftsByDemand[demandId] ?? {})
      );
      const sortedDemandIds = changedDemandIds.toSorted((left, right) => {
        const leftDelta =
          getDemandDraftTotal(left) -
          Object.values(defaultDraftsByDemand[left] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        const rightDelta =
          getDemandDraftTotal(right) -
          Object.values(defaultDraftsByDemand[right] ?? {}).reduce(
            (sum, value) => sum + readQuantity(value),
            0
          );
        return leftDelta - rightDelta;
      });

      for (const demandId of sortedDemandIds) {
        const demandDraft = draftsByDemand[demandId] ?? {};
        const row = data?.demandRows.find((candidate) => candidate.demandId === demandId);
        if (!row) {
          throw new Error("Allocation demand is no longer available.");
        }
        await apiJson<AllocationWorkspace>("/api/allocation/save", {
          method: "POST",
          body: {
            demandType: row.demandType,
            demandId,
            itemId: row.itemId,
            allocations: Object.entries(demandDraft).flatMap(([key, value]) => {
              const quantity = readQuantity(value);
              if (quantity <= 0) return [];
              const source = parseAllocationKey(key);
              if (!source.sourceId) return [];
              return [
                {
                  ...source,
                  sourceId: source.sourceId,
                  quantity: toQuantityString(quantity),
                },
              ];
            }),
          },
          fallbackError: "Failed to save allocation.",
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
      setDraftState({ workspaceKey: null, values: {} });
      setCarried(null);
      pushEvent("Allocation saved");
      onSaved?.();
    },
    onError: (error) => {
      pushEvent(error instanceof Error ? error.message : "Failed to save allocation.", "danger");
    },
  });

  const canSave =
    hasChanges &&
    !mutation.isPending &&
    !query.isLoading &&
    !!data &&
    carried == null &&
    !totalOverRemaining &&
    !overAllocatedSource;

  const onHandSources = (data?.supplySources ?? []).filter(
    (source) => source.sourceType === "inventory_lot"
  );
  const manufacturingSources = (data?.supplySources ?? []).filter(
    (source) => source.sourceType === "manufacturing_order"
  );
  const onHandTotal = onHandSources.reduce(
    (sum, source) => sum + readQuantity(source.totalQty),
    0
  );
  const onHandFree = onHandSources.reduce(
    (sum, source) => sum + getVisibleSourcePreviewFree(source),
    0
  );
  const productionTotal = manufacturingSources.reduce(
    (sum, source) => sum + readQuantity(source.totalQty),
    0
  );
  const productionFree = manufacturingSources.reduce(
    (sum, source) => sum + getVisibleSourcePreviewFree(source),
    0
  );
  const selectedSource =
    selectedSourceKey ? sourceMetaByKey.get(selectedSourceKey)?.source ?? null : null;
  const selectedSourceKeyValue = selectedSource
    ? allocationKey(selectedSource.sourceType, selectedSource.sourceId)
    : null;
  const selectedSourceHeldQty =
    selectedSourceKeyValue &&
    carried?.sourceKey === selectedSourceKeyValue &&
    carried.originDemandId
      ? carried.quantity
      : 0;
  const selectedSourcePreview = selectedSource
    ? {
        key: selectedSourceKeyValue ?? allocationKey(selectedSource.sourceType, selectedSource.sourceId),
        allocated: Math.max(
          0,
          getSourceDraftTotal(
            selectedSourceKeyValue ?? allocationKey(selectedSource.sourceType, selectedSource.sourceId)
          ) - selectedSourceHeldQty
        ),
        free: getVisibleSourcePreviewFree(selectedSource),
      }
    : null;

  const sourceDestinations = selectedSource
    ? data?.demandRows.flatMap((row) => {
        const key = selectedSourcePreview?.key ?? allocationKey(selectedSource.sourceType, selectedSource.sourceId);
        const heldFromThisDestination =
          carried?.originDemandId === row.demandId && carried.sourceKey === key
            ? carried.quantity
            : 0;
        const quantity = Math.max(
          0,
          readQuantity(draftsByDemand[row.demandId]?.[key]) - heldFromThisDestination
        );
        if (quantity <= 0) return [];
        return [
          {
            label: row.label,
            quantity,
            kind:
              demandTypeOf(row) === "manufacturing_order_ingredient"
                ? ("production" as const)
                : ("sales" as const),
          },
        ];
      }) ?? []
    : [];

  function requestSheetClose() {
    if (hasChanges || outputHasChanges) {
      const shouldClose = window.confirm("Discard unsaved allocation changes?");
      if (!shouldClose) return;
      discardCurrentWorkspaceDrafts();
    }
    setOutputMoId(null);
    setOutputHasChanges(false);
    setOutputIsHolding(false);
    setCarried(null);
    setBrowseTarget(null);
    onOpenChange(false);
  }

  const pendingChangeLabel = outputMoId
    ? outputHasChanges
      ? "Unsaved · 1 change"
      : null
    : hasChanges
      ? compactChangeLabel(changedDemandCount)
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestSheetClose();
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="flex h-svh flex-col overflow-hidden bg-background text-foreground data-[side=right]:w-full data-[side=right]:sm:w-[min(96vw,92rem)] data-[side=right]:sm:max-w-none">
        {pendingChangeLabel ? (
          <div
            data-testid="allocation-pending-changes"
            className="absolute right-12 top-4 z-50 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
          >
            {pendingChangeLabel}
          </div>
        ) : null}
        <SheetHeader className="border-b">
          <SheetTitle>Allocation Manager</SheetTitle>
          <SheetDescription className="sr-only">
            Allocate available stock and production to demand.
          </SheetDescription>
          {targetItem ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <AllocationSpriteTile
                  kind={targetVisual.kind}
                  color={targetVisual.color}
                  state="available"
                  size="xs"
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                    <span className="truncate">
                      {targetDemand
                        ? `${targetDemand.label} · ${targetDemand.contextLabel}`
                        : targetItem.itemName}
                    </span>
                    {targetDemand ? (
                      <Badge variant="outline">{targetDemandLabel(targetDemand)}</Badge>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate">
                      {targetDemand ? targetItem.itemName : "Item allocation"}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {targetUnitLabel}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <VariantSwitcher
                  options={data?.variantOptions ?? []}
                  relatedItems={data?.relatedItems ?? []}
                  fallbackItemName={targetItem.itemName}
                  fallbackUnitLabel={targetUnitLabel}
                  onSelectDemand={(nextDemandId) => {
                    if (!canLeaveCurrentWorkspace()) return;
                    if (hasChanges || outputHasChanges) discardCurrentWorkspaceDrafts();
                    setCarried(null);
                    setSelectedSourceKey(null);
                    setBrowseTarget(null);
                    setOutputMoId(null);
                    notifyTargetDemandChange?.(nextDemandId);
                  }}
                  onSelectItem={(itemId) => {
                    if (!canLeaveCurrentWorkspace()) return;
                    if (hasChanges || outputHasChanges) discardCurrentWorkspaceDrafts();
                    setCarried(null);
                    setSelectedSourceKey(null);
                    setBrowseTarget({ itemId, demandId: activeDemandId });
                    setOutputMoId(null);
                  }}
                />
                <HeaderMetric
                  label="stock"
                  free={onHandFree}
                  total={onHandTotal}
                  tone="success"
                />
                {productionTotal > 0 ? (
                  <HeaderMetric
                    label="production"
                    free={productionFree}
                    total={productionTotal}
                    tone="primary"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </SheetHeader>

        {outputMoId ? (
          <>
            <OutputAllocationWorkspace
              manufacturingOrderId={outputMoId}
              onBack={(options) => {
                if (activeDemandId == null) {
                  if (options?.dirtyHandled) setOutputHasChanges(false);
                  setOutputMoId(null);
                  setOutputHasChanges(false);
                  setOutputIsHolding(false);
                  setCarried(null);
                  setBrowseTarget(null);
                  onOpenChange(false);
                  return;
                }
                setOutputHasChanges(false);
                setOutputMoId(null);
              }}
              onOpenOutput={openOutputMo}
              onDirtyChange={setOutputHasChanges}
              onHoldingChange={setOutputIsHolding}
            />
            <AllocationEventLog events={events} />
          </>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4"
            onClick={(event) => {
              if (!carried) return;
              const target = event.target instanceof Element ? event.target : null;
              if (target?.closest("[data-allocation-interactive]")) return;
              pushEvent("Choose a highlighted target or press Esc to cancel", "warning");
            }}
          >
            {activeDemandId == null && activeItemId == null ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">Choose a demand or MO output first.</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            ) : query.isLoading ? (
              <div className="flex min-h-48 items-center justify-center">
                <Spinner className="text-foreground" />
              </div>
            ) : query.isError ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm text-destructive">{query.error.message}</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            ) : data && targetItem ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,0.9fr)_minmax(20rem,1.1fr)] gap-4 overflow-x-auto overflow-y-hidden">
                <WorkspacePanel
                  title="Supply"
                  accent="supply"
                  testId="allocation-supply-panel"
                >
                  <div className="flex min-h-0 flex-col gap-4">
                    <div className="space-y-3">
                      <SectionTitle title="On hand" />
                      <div className="flex flex-wrap gap-2">
                        {onHandSources.map((source, sourceIndex) => {
                          const key = allocationKey(source.sourceType, source.sourceId);
                          return (
                            <SupplyStack
                              key={key}
                              source={source}
                              itemName={targetItem.itemName}
                              unitName={targetItem.unitName}
                              sourceKeyValue={key}
                              sourceIndex={sourceIndex}
                              previewFree={getVisibleSourcePreviewFree(source)}
                              isSelected={selectedSourceKey === key}
                              carried={carried}
                              onPick={pickToken}
                              onSelect={selectSource}
                              onInvalid={(message) => pushEvent(message, "warning")}
                              onOpenOutput={openOutputMo}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {manufacturingSources.length > 0 ? (
                      <div className="border-t pt-3">
                        <SectionTitle
                          title="Inbound from MFG"
                          className="text-primary"
                          icon={
                            <HugeiconsIcon
                              icon={ArrowDown01Icon}
                              strokeWidth={2}
                              className="size-3.5"
                            />
                          }
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          {manufacturingSources.map((source, index) => {
                            const key = allocationKey(source.sourceType, source.sourceId);
                            return (
                              <SupplyStack
                                key={key}
                                source={source}
                                itemName={targetItem.itemName}
                                unitName={targetItem.unitName}
                                sourceKeyValue={key}
                                sourceIndex={onHandSources.length + index}
                                previewFree={getVisibleSourcePreviewFree(source)}
                                isSelected={selectedSourceKey === key}
                                carried={carried}
                                onPick={pickToken}
                                onSelect={selectSource}
                                onInvalid={(message) => pushEvent(message, "warning")}
                                onOpenOutput={openOutputMo}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {targetDemand &&
                  targetDemand.parentDemandId &&
                  targetDemand.demandType === "sales_order_line" &&
                  targetDraftShortQty > 0 &&
                  carried == null &&
                  renderCreateManufacturingOrderAction
                    ? (
                        <div className="flex justify-end">
                          {renderCreateManufacturingOrderAction({
                            parentDemandId: targetDemand.parentDemandId,
                            parentDemandLabel: `${targetDemand.label} - ${targetDemand.contextLabel}`,
                            initialPlannedDate: todayDateString(),
                            openManufacturingOrders: data.supplySources
                              .filter(
                                (source) =>
                                  source.sourceType === "manufacturing_order" &&
                                  source.sourceId != null &&
                                  (source.status === "draft" || source.status === "released")
                              )
                              .map((source) => ({
                                id: source.sourceId ?? source.label,
                                orderNumber: source.label,
                                itemName: targetDemand.itemName,
                                quantity: `${formatQuantity(source.totalQty)} ${targetUnitLabel}`,
                                plannedDate: source.date,
                                priorityRank: source.priorityRank,
                                status: statusLabel(source.status),
                              })),
                            initialDemandQuantities: [
                              {
                                demandId: targetDemand.demandId,
                                quantity: toQuantityString(targetDraftShortQty),
                              },
                            ],
                          })}
                        </div>
                      )
                    : null}

                  {selectedSource ? (
                    <div className="mt-auto pt-2">
                      <SourceDetailPanel
                        source={selectedSource}
                        itemName={targetItem.itemName}
                        unitName={targetItem.unitName}
                        destinations={sourceDestinations}
                        previewAllocated={selectedSourcePreview?.allocated}
                        previewFree={selectedSourcePreview?.free}
                      />
                    </div>
                  ) : null}
                </WorkspacePanel>

                <WorkspacePanel
                  title="Demand"
                  accent="default"
                >
                  <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
                    {data.demandRows
                      .toSorted((a, b) => Number(b.isTarget) - Number(a.isTarget))
                      .map((row) => {
                        const isTarget = row.demandId === targetDemandId;
                        const held = getHeldForDemand(row.demandId);
                        const allocatedQty = getVisibleDemandAllocated(row.demandId);
                        const shortQty = Math.max(
                          0,
                          readQuantity(row.remainingQty) - allocatedQty
                        );
                        const pendingPreview =
                          carried == null
                            ? 0
                            : Math.min(carried.quantity, shortQty);

                        return (
                          <DemandCard
                            key={row.demandId}
                            row={row}
                            isTarget={isTarget}
                            allocatedQty={allocatedQty}
                            shortQty={shortQty}
                            draftAllocations={getDemandDraftAllocations(row.demandId)}
                            held={held}
                            pendingPreview={pendingPreview}
                            lastPlacedDemandId={lastPlacedDemandId}
                            carried={carried}
                            onPlace={(targetRect) => placeOnDemand(row.demandId, targetRect)}
                            onPickToken={(token, sourceRect) =>
                              pickToken(
                                {
                                  ...token,
                                  itemName: row.itemName,
                                  unitName: row.unitName,
                                  originDemandId: row.demandId,
                                  originLabel: row.label,
                                  originContext: row.contextLabel,
                                },
                                sourceRect
                              )
                            }
                            onInvalid={(message) => pushEvent(message, "warning")}
                          />
                        );
                      })}
                  </div>
                </WorkspacePanel>
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">No allocatable demand found.</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            )}
            <CarryPanel
              carried={carried}
              className="bottom-20"
              displayQuantity={hudQuantityOverride}
            />
            <SpriteTransferOverlay
              animations={spriteTransfers}
              onDone={removeSpriteTransfer}
            />
            <AllocationEventLog events={events} />
          </div>
        )}

        {!outputMoId ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-3 z-40 flex items-end justify-between gap-3">
            {mutation.error ? (
              <p className="pointer-events-auto max-w-md rounded-full border bg-background/95 px-3 py-2 text-sm text-destructive shadow-lg backdrop-blur">
                {mutation.error.message}
              </p>
            ) : totalOverRemaining && targetDemand ? (
              <p className="pointer-events-auto max-w-md rounded-full border bg-background/95 px-3 py-2 text-sm text-destructive shadow-lg backdrop-blur">
                Allocated quantity cannot exceed {formatQuantity(targetDemand.remainingQty)}{" "}
                {targetUnitLabel}.
              </p>
            ) : overAllocatedSource ? (
              <p className="pointer-events-auto max-w-md rounded-full border bg-background/95 px-3 py-2 text-sm text-destructive shadow-lg backdrop-blur">
                {overAllocatedSource.label} only has{" "}
                {formatQuantity(overAllocatedSource.totalQty)} total.
              </p>
            ) : (
              <div />
            )}
            <div className="pointer-events-auto flex shrink-0 gap-2 rounded-full border bg-background/95 p-1 shadow-xl backdrop-blur">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  if (carried) {
                    pushEvent("Place held stock or press Esc to cancel", "warning");
                    return;
                  }
                  setDraftState({
                    workspaceKey: draftWorkspaceKey,
                    values: defaultDraftsByDemand,
                  });
                  setOutputIsHolding(false);
                  pushEvent("Allocation reset", "warning");
                }}
                disabled={!hasChanges || mutation.isPending || carried != null}
              >
                <HugeiconsIcon icon={ReloadIcon} strokeWidth={2} />
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => mutation.mutate()}
                disabled={!canSave}
                className={cn("rounded-full", canSave && "shadow-sm")}
              >
                {mutation.isPending ? "Saving..." : "Save allocation"}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
