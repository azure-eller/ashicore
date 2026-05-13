"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import {
  inferItemVisual,
  ItemToken,
} from "@/components/inventory-visuals";
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
import type { AllocationWorkspace } from "@/lib/inventory/allocation/types";
import type {
  SalesAllocationSheetData,
  SalesAllocationSource,
  SalesAllocationSourceType,
} from "@/app/(dashboard)/sales/types";
import { CreateManufacturingOrdersDialog } from "@/app/(dashboard)/sales/create-manufacturing-orders-dialog";

function workspaceToSheetData(workspace: AllocationWorkspace): SalesAllocationSheetData {
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
      salesOrderLineId: demand.demandId,
      salesOrderId: "",
      orderNumber: demand.label,
      orderStatus: "draft" as const,
      customerName: demand.contextLabel ?? "",
      shipDate: demand.requiredDate,
      itemId: demand.itemId,
      itemName: demand.itemName,
      unitName: demand.unitName,
      orderedQty: demand.openQty,
      shippedQty: "0",
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
    targetLine: primary == null ? null : { ...primary, allocationManagedAt: null },
    variantOptions: [],
    salesOrderItems: [],
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
      priorityRank: null,
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
  sourceType: SalesAllocationSourceType;
  sourceId: string | null;
  sourceLabel: string;
  sourceIndex: number;
  quantity: number;
  itemName?: string | null;
  unitName?: string | null;
  originLineId?: string;
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
    salesOrderLineId: string;
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

type Props = {
  lineId?: string | null;
  demandRef?: { demandType: "sales_order_line" | "manufacturing_order_ingredient"; demandId: string };
  itemId?: string | null;
  titleOverride?: string;
  onSaved?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetLineChange?: (lineId: string) => void;
  outputManufacturingOrderId?: string | null;
  onOutputManufacturingOrderChange?: (id: string | null) => void;
};

type CarryState = AllocationTokenData | null;

function allocationKey(sourceType: SalesAllocationSourceType, sourceId: string | null) {
  return `${sourceType}:${sourceId ?? ""}`;
}

export const AllocationSheet = AllocationManagerSheet;

function parseAllocationKey(key: string) {
  const [sourceType, rawSourceId] = key.split(":") as [
    SalesAllocationSourceType,
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

function compactUnitName(unitName: string | null | undefined) {
  return formatCompactUnitLabel({ name: unitName }) ?? unitName ?? "units";
}

function itemVisual(name: string | null | undefined, unitName: string | null | undefined) {
  return inferItemVisual({ name, unitName });
}

function demandStackSize(quantity: number) {
  if (quantity >= 50) return 50;
  if (quantity >= 20) return 10;
  if (quantity >= 5) return 5;
  return 1;
}

function splitQuantityStacks(quantity: number, stackSize: number) {
  const normalized = readQuantity(toQuantityString(quantity));
  if (normalized <= 0) return [];

  const fullStackCount = Math.floor(normalized / stackSize);
  const remainder = readQuantity(toQuantityString(normalized - fullStackCount * stackSize));
  const stacks = Array.from({ length: fullStackCount }, () => stackSize);
  if (remainder > 0) stacks.push(remainder);
  return stacks;
}

function clampQuantity(value: number, max: number) {
  return Math.max(0, Math.min(readQuantity(toQuantityString(value)), max));
}

function sourceKindLabel(source: SalesAllocationSource) {
  if (source.sourceType === "inventory_lot") return "Lot";
  return source.status === "draft" ? "Draft production" : "Released production";
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
    <div className="h-2 overflow-hidden rounded-sm bg-muted">
      <div
        className={cn(
          "h-full rounded-sm transition-all",
          tone === "success" && "bg-success",
          tone === "primary" && "bg-primary",
          tone === "warning" && "bg-warning"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
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
}: {
  title: string;
  count?: string;
  accent?: "default" | "supply" | "production";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-[calc(100vh-14rem)] flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        className
      )}
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
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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
}: {
  total: number;
  allocated: number;
  visual: ReturnType<typeof itemVisual>;
}) {
  const stackSize = demandStackSize(Math.max(total, allocated));
  const allocatedStacks = splitQuantityStacks(allocated, stackSize);
  const totalStacks = splitQuantityStacks(total, stackSize);
  const emptyCount = Math.max(0, totalStacks.length - allocatedStacks.length);

  if (total <= 0 && allocated <= 0) {
    return <div className="h-12" />;
  }

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-1.5">
      {allocatedStacks.map((quantity, index) => (
        <ItemToken
          key={`filled-${index}-${quantity}`}
          kind={visual.kind}
          color={visual.color}
          state="available"
          size="sm"
          quantity={formatQuantity(toQuantityString(quantity))}
          className="shadow-xs"
        />
      ))}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <span
          key={`empty-${index}`}
          className="flex h-12 w-12 shrink-0 rounded-md border border-dashed bg-muted/15"
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
  salesOrderItems = [],
  fallbackItemName,
  fallbackUnitLabel,
  onSelectLine,
  onSelectItem,
}: {
  options: SalesAllocationSheetData["variantOptions"];
  salesOrderItems?: SalesAllocationSheetData["salesOrderItems"];
  fallbackItemName: string;
  fallbackUnitLabel: string;
  onSelectLine: (lineId: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  if (salesOrderItems.length > 0) {
    return (
      <div className="flex items-center gap-1.5">
        {salesOrderItems.map((item) => {
          const remaining = readQuantity(item.remainingQty);
          const short = readQuantity(item.shortQty);
          const isComplete = remaining > 0 && short <= 0;
          const unitLabel = compactUnitName(item.unitName);
          const visual = itemVisual(item.itemName, item.unitName);

          return (
            <div key={item.salesOrderLineId} className="group relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      item.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20",
                      !item.isCurrent && isComplete && "border-success/70 bg-success/5",
                      !item.isCurrent && !isComplete && short > 0 && "border-warning/70 bg-warning/5"
                    )}
                    aria-label={`${item.itemName} · ${unitLabel}`}
                      onClick={() => onSelectLine(item.salesOrderLineId)}
                    >
                      <ItemToken
                        kind={visual.kind}
                        color={visual.color}
                        state={isComplete ? "reserved" : short > 0 ? "shortage" : "available"}
                        selected={item.isCurrent}
                        size="xs"
                        className="border-0 bg-transparent p-0 shadow-none ring-0"
                      />
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-background/95 px-0.5 text-[9px] font-semibold tabular-nums shadow-xs">
                        {formatQuantity(item.allocatedQty)}/{formatQuantity(item.remainingQty)}
                      </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {item.itemName} · {unitLabel} · {formatQuantity(item.allocatedQty)}/
                  {formatQuantity(item.remainingQty)} allocated.
                </TooltipContent>
              </Tooltip>
              <div className="invisible absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-md border bg-popover p-1 text-popover-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {item.variantOptions.map((option) => {
                    const optionUnitLabel = compactUnitName(option.unitName);
                    const optionVisual = itemVisual(option.itemName, option.unitName);
                    return (
                    <Tooltip key={option.itemId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            option.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20"
                          )}
                          aria-label={`${option.itemName} · ${optionUnitLabel}`}
                          onClick={() => {
                            if (option.salesOrderLineId) {
                              onSelectLine(option.salesOrderLineId);
                              return;
                            }
                            onSelectItem(option.itemId);
                            }}
                          >
                            <ItemToken
                              kind={optionVisual.kind}
                              color={optionVisual.color}
                              selected={option.isCurrent}
                              size="xs"
                              className="border-0 bg-transparent p-0 shadow-none ring-0"
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
            salesOrderLineId: null,
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
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  option.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20"
                )}
                aria-label={`${option.itemName} · ${unitLabel}`}
                onClick={() => {
                  if (option.salesOrderLineId && !option.isCurrent) {
                    onSelectLine(option.salesOrderLineId);
                    return;
                  }
                    onSelectItem(option.itemId);
                  }}
                >
                  <ItemToken
                    kind={visual.kind}
                    color={visual.color}
                    selected={option.isCurrent}
                    size="xs"
                    className="border-0 bg-transparent p-0 shadow-none ring-0"
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
}: {
  carried: CarryState;
  className?: string;
}) {
  if (!carried) return null;

  const isProduction = carried.sourceType === "manufacturing_order";
  const visual = itemVisual(carried.itemName ?? carried.sourceLabel, carried.unitName);

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 z-20 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-popover/95 p-2 text-popover-foreground shadow-xl ring-1 ring-primary/15 backdrop-blur">
        <span className="sr-only">Picked up</span>
        <div className="flex min-w-0 items-center gap-2">
          <ItemToken
            kind={visual.kind}
            color={visual.color}
            state={isProduction ? "inbound" : "available"}
            selected
            size="sm"
            quantity={formatQuantity(toQuantityString(carried.quantity))}
          />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Picked up
            </div>
            <div className="truncate text-sm font-medium">{carried.sourceLabel}</div>
          </div>
        </div>
        <div className="grid shrink-0 gap-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">X</kbd>
            <span>split</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">wheel</kbd>
            <span>adjust</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">Esc</kbd>
            <span>drop</span>
          </div>
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
  onReturn,
  onOpenOutput,
}: {
  source: SalesAllocationSource;
  itemName: string | null | undefined;
  unitName: string | null | undefined;
  sourceKeyValue: string;
  sourceIndex: number;
  previewFree: number;
  isSelected: boolean;
  carried: CarryState;
  onPick: (token: AllocationTokenData) => void;
  onSelect: (sourceKeyValue: string) => boolean;
  onReturn: (sourceKeyValue: string) => void;
  onOpenOutput: (id: string) => void;
}) {
  const isMo = source.sourceType === "manufacturing_order";
  const isLot = source.sourceType === "inventory_lot";
  const quantityLabel = formatQuantity(toQuantityString(previewFree));
  const visual = itemVisual(itemName, unitName);
  const canPick = previewFree > 0 && source.canAllocate;
  const canReturn =
    carried?.originLineId != null && carried.sourceKey === sourceKeyValue;
  const toneClasses = isMo
    ? {
        selected: "border-primary/70 bg-primary/5 ring-2 ring-primary/25 shadow-md",
        base: "border-primary/35 bg-primary/5",
        hover: "hover:border-primary/50 hover:bg-primary/10",
        icon: "bg-primary/10 text-primary",
        label: "text-primary",
      }
    : {
        selected: "border-success/70 bg-success/5 ring-2 ring-success/25 shadow-md",
        base: "border-border bg-background",
        hover: "hover:border-success/50 hover:bg-success/5",
        icon: "bg-success/10 text-success",
        label: "text-muted-foreground",
      };
  const stackClassName = cn(
    "group relative flex h-24 w-20 flex-col items-center justify-center rounded-md border text-left shadow-xs transition",
    toneClasses.base,
    toneClasses.hover,
    "focus-within:ring-2 focus-within:ring-ring",
    isSelected && toneClasses.selected,
    canReturn && "border-success/60 bg-success/5",
    !canPick && "opacity-70"
  );

  if (isMo) {
    return (
      <div className="flex w-20 flex-col items-center gap-1">
        <button
          type="button"
          className={cn(stackClassName, "focus-visible:outline-none")}
          onClick={() => {
            if (!onSelect(sourceKeyValue)) return;
            if (canReturn) {
              onReturn(sourceKeyValue);
              return;
            }
            if (!canPick) return;
            onPick({
              sourceKey: sourceKeyValue,
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              sourceLabel: source.label,
              sourceIndex,
              quantity: previewFree,
              itemName,
              unitName,
            });
          }}
          aria-label={`Allocate all from ${source.label}`}
        >
          <ItemToken
            kind={visual.kind}
            color={visual.color}
            state="inbound"
            selected={isSelected}
            size="md"
            quantity={quantityLabel}
            className="border-0 bg-transparent p-0 shadow-none ring-0"
          />
        </button>
        <button
          type="button"
          className="max-w-full truncate text-[11px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (source.sourceId) onOpenOutput(source.sourceId);
          }}
          aria-label={`Open output allocation for ${source.label}`}
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
    <div className="flex w-20 flex-col items-center gap-1">
      <button
        type="button"
        className={cn(stackClassName, "focus-visible:outline-none focus-visible:ring-2")}
        onClick={() => {
          if (!onSelect(sourceKeyValue)) return;
          if (canReturn) {
            onReturn(sourceKeyValue);
            return;
          }
          if (!canPick) return;
          onPick({
            sourceKey: sourceKeyValue,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourceLabel: source.label,
            sourceIndex,
            quantity: previewFree,
            itemName,
            unitName,
          });
        }}
        aria-label={`Allocate all from ${source.label}`}
      >
        <ItemToken
          kind={visual.kind}
          color={visual.color}
          state="available"
          selected={isSelected}
          size="md"
          quantity={quantityLabel}
          className="border-0 bg-transparent p-0 shadow-none ring-0"
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
}: {
  source: SalesAllocationSource | null;
  itemName: string | null | undefined;
  unitName: string | null | undefined;
  destinations: Array<{ label: string; quantity: number; kind: "sales" | "production" }>;
}) {
  const organizationTimeZone = useOrganizationTimeZone();

  if (!source) return null;

  const total = readQuantity(source.totalQty);
  const allocated = readQuantity(source.allocatedQty);
  const free = readQuantity(source.freeQty);
  const visual = itemVisual(itemName, unitName);

  return (
    <div className="rounded-md border bg-background p-3 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ItemToken
              kind={visual.kind}
              color={visual.color}
              state={source.sourceType === "manufacturing_order" ? "inbound" : "available"}
              size="xs"
              className="size-5 rounded-sm"
            />
            <h3 className="truncate text-sm font-semibold">{source.label}</h3>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {source.sourceType === "inventory_lot" ? (
              <>
                Received {formatInstantDate(source.receivedAt ?? source.date, organizationTimeZone)} · Created{" "}
                {formatInstantDate(source.createdAt, organizationTimeZone)}
              </>
            ) : source.sourceType === "manufacturing_order" ? (
              <>
                {statusLabel(source.status)}
                {source.date ? ` · ${formatDate(source.date)}` : ""}
              </>
            ) : (
              "Available stock pool"
            )}
          </div>
        </div>
        <Badge variant="secondary">{sourceKindLabel(source)}</Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Allocated</span>
          <ProgressBar value={allocated} max={Math.max(total, allocated + free)} tone="warning" />
          <span className="text-right font-medium tabular-nums">{formatQuantity(source.allocatedQty)}</span>
        </div>
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Free</span>
          <ProgressBar value={free} max={Math.max(total, allocated + free)} />
          <span className="text-right font-medium tabular-nums">{formatQuantity(source.freeQty)}</span>
        </div>
      </div>

      <div className="mt-3 border-t pt-3">
        {destinations.length === 0 ? (
          <div className="text-sm text-muted-foreground">No allocations from this source.</div>
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

function OutputSourceDetailPanel({
  data,
  assignedSales,
  assignedProduction,
  outputFree,
}: {
  data: OutputAllocationData;
  assignedSales: number;
  assignedProduction: number;
  outputFree: number;
}) {
  const planned = readQuantity(data.sourceMo.plannedQuantity);
  const allocated = assignedSales + assignedProduction;
  const visual = itemVisual(data.sourceMo.productName, null);
  const destinations = [
    assignedSales > 0
      ? { label: "Sales allocations", quantity: assignedSales, kind: "sales" as const }
      : null,
    ...data.productionDestinations
      .map((destination) => ({
        label: destination.orderNumber,
        quantity: readQuantity(destination.assignedQty),
        kind: "production" as const,
      }))
      .filter((destination) => destination.quantity > 0),
  ].filter(Boolean) as Array<{ label: string; quantity: number; kind: "sales" | "production" }>;

  return (
    <div className="rounded-md border bg-background p-3 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ItemToken
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
  carried,
  onPlace,
  onPick,
}: {
  row: SalesAllocationSheetData["demandRows"][number];
  isTarget: boolean;
  allocatedQty: number;
  shortQty: number;
  carried: CarryState;
  onPlace: () => void;
  onPick: () => void;
}) {
  const remaining = readQuantity(row.remainingQty);
  const canPlace = carried != null && shortQty > 0;
  const visual = itemVisual(row.itemName, row.unitName);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Allocate to ${row.orderNumber}`}
      data-testid={isTarget ? "current-allocation-bucket" : "readonly-allocation-bucket"}
      className={cn(
        "cursor-pointer",
        "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isTarget && "border-primary/25 bg-primary/5",
        canPlace && "hover:border-primary/50 hover:bg-primary/5"
      )}
      onClick={() => {
        if (carried) {
          onPlace();
          return;
        }
        onPick();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (carried) {
            onPlace();
          } else {
            onPick();
          }
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Badge className="rounded-sm bg-warning/10 text-warning">SO</Badge>
          <span className="font-semibold">{row.orderNumber}</span>
          <span className="truncate text-muted-foreground">{row.customerName}</span>
          {isTarget ? <Badge variant="outline">This order</Badge> : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Ship {row.shipDate ? formatDate(row.shipDate) : "\u2014"}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <DemandQuantityStacks
          total={remaining}
          allocated={allocatedQty}
          visual={visual}
        />
        <ProgressBar value={allocatedQty} max={remaining} />
        <div className="flex justify-end gap-4 text-sm">
          <span>
            <span className="text-muted-foreground">Allocated </span>
            <span className="font-medium text-success">{formatQuantity(toQuantityString(allocatedQty))}</span>
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
}

function OutputAllocationWorkspace({
  manufacturingOrderId,
  onBack,
  onOpenOutput,
}: {
  manufacturingOrderId: string;
  onBack: () => void;
  onOpenOutput: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [outputSelected, setOutputSelected] = useState(true);
  const [carriedQty, setCarriedQty] = useState<number | null>(null);
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
    queryFn: () =>
      apiJson<OutputAllocationData>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        { fallbackError: "Failed to load output allocation." }
      ),
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
          destination.salesOrderLineId,
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
  const outputVisual = data
    ? itemVisual(data.sourceMo.productName, null)
    : itemVisual(null, null);

  const mutation = useMutation({
    mutationFn: () =>
      apiJson<OutputAllocationData>(
        `/api/manufacturing-orders/${manufacturingOrderId}/output-allocation`,
        {
          method: "PUT",
          body: {
            salesAllocations: Object.entries(salesDraft)
              .map(([salesOrderLineId, quantity]) => ({
                salesOrderLineId,
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
    onSuccess: async (nextData) => {
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
            destination.salesOrderLineId,
            formatQuantity(destination.assignedQty),
          ])
        ),
      });
      setCarriedQty(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["manufacturing-output-allocation", manufacturingOrderId],
        }),
        queryClient.invalidateQueries({ queryKey: ["sales-line-allocation"] }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      ]);
    },
  });

  const canSave =
    !!data &&
    !outputQuery.isLoading &&
    !mutation.isPending &&
    (JSON.stringify(draft) !== JSON.stringify(defaultDraft) ||
      JSON.stringify(salesDraft) !== JSON.stringify(defaultSalesDraft));

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (carriedQty == null) return;
      if (event.key === "Escape") {
        setCarriedQty(null);
      } else if (event.key.toLowerCase() === "x") {
        setCarriedQty((current) =>
          current == null ? null : Math.max(1, Math.floor(current / 2))
        );
      } else if (event.key === "+" || event.key === "=") {
        setCarriedQty((current) =>
          current == null ? null : clampQuantity(current + (event.shiftKey ? 5 : 1), outputFree)
        );
      } else if (event.key === "-") {
        setCarriedQty((current) =>
          current == null ? null : Math.max(1, current - (event.shiftKey ? 5 : 1))
        );
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [carriedQty, outputFree]);

  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (carriedQty == null) return;
      event.preventDefault();
      setCarriedQty((current) =>
        current == null
          ? null
          : Math.max(1, clampQuantity(current + (event.deltaY < 0 ? 1 : -1), outputFree))
      );
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [carriedQty, outputFree]);

  function updateDestination(ingredientId: string, quantity: number) {
    setDraftState((current) => ({
      manufacturingOrderId,
      values: {
        ...(current.manufacturingOrderId === manufacturingOrderId
          ? current.values
          : defaultDraft),
        [ingredientId]: toQuantityString(quantity),
      },
    }));
  }

  function updateSalesDestination(salesOrderLineId: string, quantity: number) {
    setSalesDraftState((current) => ({
      manufacturingOrderId,
      values: {
        ...(current.manufacturingOrderId === manufacturingOrderId
          ? current.values
          : defaultSalesDraft),
        [salesOrderLineId]: toQuantityString(quantity),
      },
    }));
  }

  function placeOnDestination(ingredientId: string) {
    if (carriedQty == null || !data) return;
    const destination = data.productionDestinations.find(
      (candidate) => candidate.ingredientId === ingredientId
    );
    if (!destination) return;
    const current = readQuantity(draft[ingredientId]);
    const remaining = Math.max(0, readQuantity(destination.remainingNeed) - current);
    const quantity = Math.min(carriedQty, remaining, outputFree);
    if (quantity <= 0) return;
    updateDestination(ingredientId, current + quantity);
    setCarriedQty((currentCarry) =>
      currentCarry == null || currentCarry <= quantity
        ? null
        : readQuantity(toQuantityString(currentCarry - quantity))
    );
    setSelectedIngredientId(ingredientId);
  }

  function placeOnSalesDestination(salesOrderLineId: string) {
    if (carriedQty == null || !data) return;
    const destination = data.salesDestinations.find(
      (candidate) => candidate.salesOrderLineId === salesOrderLineId
    );
    if (!destination) return;
    const current = readQuantity(salesDraft[salesOrderLineId]);
    const remaining = Math.max(0, readQuantity(destination.remainingQty) - current);
    const quantity = Math.min(carriedQty, remaining, outputFree);
    if (quantity <= 0) return;
    updateSalesDestination(salesOrderLineId, current + quantity);
    setCarriedQty((currentCarry) =>
      currentCarry == null || currentCarry <= quantity
        ? null
        : readQuantity(toQuantityString(currentCarry - quantity))
    );
    setSelectedIngredientId(salesOrderLineId);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
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
              <ItemToken
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
              free={outputFree}
              total={readQuantity(data.sourceMo.plannedQuantity)}
              tone="primary"
            />
          </div>
          <div className="grid min-h-0 gap-4 xl:grid-cols-2">
            <WorkspacePanel
              title="Supply · Output"
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
                          "group relative flex h-24 w-20 flex-col items-center justify-center rounded-md border bg-primary/5 text-left shadow-xs transition",
                          "hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          outputSelected && "border-primary/60 ring-2 ring-primary/25 shadow-md",
                          outputFree <= 0 && "opacity-70"
                        )}
                        onClick={() => {
                          if (outputSelected && carriedQty != null) {
                            setOutputSelected(false);
                            setCarriedQty(null);
                            return;
                          }
                          setOutputSelected(true);
                          setCarriedQty(outputFree > 0 ? outputFree : null);
                        }}
                        aria-label={`Pick up output from ${data.sourceMo.orderNumber}`}
                      >
                        <ItemToken
                          kind={outputVisual.kind}
                          color={outputVisual.color}
                          state="inbound"
                          selected={outputSelected}
                          size="md"
                          quantity={formatQuantity(toQuantityString(outputFree))}
                          className="border-0 bg-transparent p-0 shadow-none ring-0"
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
                    outputFree={outputFree}
                  />
                ) : null}
              </div>
            </WorkspacePanel>

            <WorkspacePanel
              title="Demand · Orders"
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
                const allocated = readQuantity(salesDraft[destination.salesOrderLineId]);
                const remaining = readQuantity(destination.remainingQty);
                const shortQty = Math.max(0, remaining - allocated);
                const selected = selectedIngredientId === destination.salesOrderLineId;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={destination.salesOrderLineId}
                    aria-label={`Allocate output to ${destination.orderNumber}`}
                    onClick={() => placeOnSalesDestination(destination.salesOrderLineId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        placeOnSalesDestination(destination.salesOrderLineId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "border-success/30 bg-success/5",
                      selected && "ring-2 ring-success/25"
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
                const remaining = readQuantity(destination.remainingNeed);
                const shortQty = Math.max(0, remaining - allocated);
                const selected = selectedIngredientId === destination.ingredientId;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={destination.ingredientId}
                    aria-label={`Allocate output to ${destination.orderNumber}`}
                    onClick={() => placeOnDestination(destination.ingredientId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        placeOnDestination(destination.ingredientId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      "w-full rounded-md border bg-background p-3 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "border-primary/30 bg-primary/5",
                      selected && "ring-2 ring-primary/25"
                    )}
                  >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <Badge className="rounded-sm bg-primary/10 text-primary">MO</Badge>
                            <span className="font-semibold">{destination.orderNumber}</span>
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
                            onOpenOutput(destination.manufacturingOrderId);
                          }}
                        >
                          Open output
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <DemandQuantityStacks
                        total={remaining}
                        allocated={allocated}
                        visual={outputVisual}
                      />
                        <ProgressBar value={allocated} max={remaining} tone="primary" />
                      <div className="flex justify-end gap-4 text-sm">
                        <span>
                          <span className="text-muted-foreground">Allocated </span>
                          <span className="font-medium text-success">{formatQuantity(toQuantityString(allocated))}</span>
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
              </>
            )}
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : null}
            </WorkspacePanel>
          </div>
          <CarryPanel
            carried={
              carriedQty == null
                ? null
                : {
                    sourceKey: "output",
                    sourceType: "manufacturing_order",
                    sourceId: manufacturingOrderId,
                      sourceLabel: data.sourceMo.orderNumber,
                      sourceIndex: 0,
                      quantity: carriedQty,
                      itemName: data.sourceMo.productName,
                  }
            }
            className="bottom-6"
          />
        </>
      ) : null}
    </div>
  );
}

export function AllocationManagerSheet({
  lineId: legacyLineId,
  demandRef,
  itemId,
  open,
  onOpenChange,
  onTargetLineChange,
  outputManufacturingOrderId,
  onOutputManufacturingOrderChange,
  onSaved,
}: Props) {
  const lineId =
    demandRef?.demandType === "sales_order_line"
      ? demandRef.demandId
      : legacyLineId ?? null;
  const genericDemandRef =
    demandRef?.demandType === "manufacturing_order_ingredient" ? demandRef : null;
  const queryClient = useQueryClient();
  const [internalOutputMoId, setInternalOutputMoId] = useState<string | null>(null);
  const isOutputMoControlled = outputManufacturingOrderId !== undefined;
  const outputMoId = isOutputMoControlled
    ? outputManufacturingOrderId
    : internalOutputMoId;
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [carried, setCarried] = useState<CarryState>(null);
  const [browseTarget, setBrowseTarget] = useState<{
    itemId: string;
    lineId: string | null;
  } | null>(null);
  const [draftState, setDraftState] = useState<AllocationDraftState>({
    workspaceKey: null,
    values: {},
  });
  const activeItemId = itemId ?? (browseTarget?.lineId === lineId ? browseTarget.itemId : null);
  const draftWorkspaceKey = genericDemandRef
    ? `${genericDemandRef.demandType}:${genericDemandRef.demandId}`
    : lineId != null
      ? `sales_order_line:${lineId}`
      : activeItemId != null
        ? `item:${activeItemId}`
        : null;
  const query = useQuery<SalesAllocationSheetData>({
    queryKey: ["allocation-workspace", lineId, activeItemId, genericDemandRef],
    queryFn: async () => {
      if (genericDemandRef) {
        const workspace = await apiJson<AllocationWorkspace>(
          `/api/allocation/workspace?demandType=${genericDemandRef.demandType}&demandId=${genericDemandRef.demandId}`,
          { fallbackError: "Failed to load allocation." }
        );
        return workspaceToSheetData(workspace);
      }
      if (activeItemId) {
        return apiJson<SalesAllocationSheetData>(
          `/api/items/${activeItemId}/allocation`,
          { fallbackError: "Failed to load allocation." }
        );
      }
      return apiJson<SalesAllocationSheetData>(
        `/api/sales-order-lines/${lineId}/allocation`,
        { fallbackError: "Failed to load allocation." }
      );
    },
    enabled:
      open &&
      (lineId != null || activeItemId != null || genericDemandRef != null) &&
      outputMoId == null,
  });

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
    draftWorkspaceKey != null && draftState.workspaceKey === draftWorkspaceKey
      ? draftState.values
      : defaultDraftsByLine;
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
  const targetItem = data?.targetItem ?? null;
  const targetUnitLabel = compactUnitName(targetLine?.unitName ?? targetItem?.unitName);
  const targetVisual = itemVisual(targetItem?.itemName, targetItem?.unitName);

  function setOutputMoId(id: string | null) {
    if (isOutputMoControlled) {
      onOutputManufacturingOrderChange?.(id);
      return;
    }
    setInternalOutputMoId(id);
  }

  function openOutputMo(id: string) {
    setCarried(null);
    setOutputMoId(id);
  }

  function updateDrafts(nextDrafts: Record<string, AllocationDraft>) {
    setDraftState({ workspaceKey: draftWorkspaceKey, values: nextDrafts });
  }

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

  function getSourcePreviewFreeByKey(sourceKeyValue: string) {
    const source = data?.supplySources.find(
      (candidate) => allocationKey(candidate.sourceType, candidate.sourceId) === sourceKeyValue
    );
    if (!source) return 0;
    return getSourcePreviewFree(source);
  }

  function pickToken(token: AllocationTokenData) {
    setCarried(token);
    setSelectedSourceKey(token.sourceKey);
  }

  function selectSource(sourceKeyValue: string) {
    if (
      selectedSourceKey === sourceKeyValue &&
      carried?.sourceKey === sourceKeyValue &&
      !carried.originLineId
    ) {
      setSelectedSourceKey(null);
      setCarried(null);
      return false;
    }

    setSelectedSourceKey(sourceKeyValue);
    if (carried?.sourceKey !== sourceKeyValue) {
      setCarried(null);
    }
    return true;
  }

  function pickFirstTokenFromLine(salesOrderLineId: string) {
    const entries = Object.entries(draftsByLine[salesOrderLineId] ?? {});
    const entry = entries.find(([, value]) => readQuantity(value) > 0);
    if (!entry) return;
    const [key, value] = entry;
    const meta = sourceMetaByKey.get(key);
    const parsed = parseAllocationKey(key);
    const row = data?.demandRows.find(
      (demandRow) => demandRow.salesOrderLineId === salesOrderLineId
    );
    pickToken({
      sourceKey: key,
      sourceType: parsed.sourceType,
      sourceId: parsed.sourceId,
      sourceLabel: meta?.source.label ?? "Source",
      sourceIndex: meta?.index ?? 0,
      quantity: readQuantity(value),
      itemName: row?.itemName,
      unitName: row?.unitName,
      originLineId: salesOrderLineId,
    });
  }

  function returnTokenToSource(sourceKeyValue: string) {
    if (!carried?.originLineId || carried.sourceKey !== sourceKeyValue) return;
    const originDraft = draftsByLine[carried.originLineId] ?? {};
    const originQty = readQuantity(originDraft[carried.sourceKey]);
    const quantity = Math.min(carried.quantity, originQty);
    if (quantity <= 0) return;

    updateDrafts({
      ...draftsByLine,
      [carried.originLineId]: {
        ...originDraft,
        [carried.sourceKey]: toQuantityString(originQty - quantity),
      },
    });
    setCarried(
      carried.quantity <= quantity
        ? null
        : {
            ...carried,
            quantity: readQuantity(toQuantityString(carried.quantity - quantity)),
          }
    );
  }

  function returnCarriedTokenToSource() {
    if (!carried?.originLineId) return;
    returnTokenToSource(carried.sourceKey);
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
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
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
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
  }

  function placeOnLine(salesOrderLineId: string) {
    if (!carried) return;
    if (carried.originLineId) {
      moveAllocatedTokenToLine(carried, salesOrderLineId);
      return;
    }
    allocateTokenToLine(carried, salesOrderLineId);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!carried) return;
      if (event.key === "Escape") {
        setCarried(null);
      } else if (event.key.toLowerCase() === "a") {
        setCarried((current) =>
          current
            ? { ...current, quantity: getSourcePreviewFreeByKey(current.sourceKey) }
            : null
        );
      } else if (event.key.toLowerCase() === "x") {
        setCarried((current) =>
          current ? { ...current, quantity: Math.max(1, Math.floor(current.quantity / 2)) } : null
        );
      } else if (event.key === "+" || event.key === "=") {
        setCarried((current) =>
          current
            ? {
                ...current,
                quantity: clampQuantity(
                  current.quantity + (event.shiftKey ? 5 : 1),
                  Math.max(current.quantity, getSourcePreviewFreeByKey(current.sourceKey))
                ),
              }
            : null
        );
      } else if (event.key === "-") {
        setCarried((current) =>
          current
            ? { ...current, quantity: Math.max(1, current.quantity - (event.shiftKey ? 5 : 1)) }
            : null
        );
      } else if (event.key === "Enter" && targetLineId) {
        placeOnLine(targetLineId);
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
      setCarried((current) =>
        current
          ? {
              ...current,
              quantity: Math.max(
                1,
                clampQuantity(
                  current.quantity + (event.deltaY < 0 ? 1 : -1),
                  Math.max(current.quantity, getSourcePreviewFreeByKey(current.sourceKey))
                )
              ),
            }
          : null
      );
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  });

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
        if (genericDemandRef) {
          const row = data?.demandRows.find(
            (candidate) => candidate.salesOrderLineId === salesOrderLineId
          ) as (SalesAllocationSheetData["demandRows"][number] & {
            demandType?: "sales_order_line" | "manufacturing_order_ingredient";
          }) | undefined;
          await apiJson<AllocationWorkspace>("/api/allocation/save", {
            method: "POST",
            body: {
              demandType: row?.demandType ?? genericDemandRef.demandType,
              demandId: salesOrderLineId,
              itemId: row?.itemId ?? data?.targetItem.itemId,
              allocations: Object.entries(lineDraft).flatMap(([key, value]) => {
                const quantity = readQuantity(value);
                if (quantity <= 0) return [];
                const source = parseAllocationKey(key);
                if (!source.sourceId) return [];
                return [{ ...source, sourceId: source.sourceId, quantity: toQuantityString(quantity) }];
              }),
            },
            fallbackError: "Failed to save allocation.",
          });
          continue;
        }
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
      setDraftState({ workspaceKey: null, values: {} });
      setCarried(null);
      onSaved?.();
    },
  });

  const canSave =
    hasChanges &&
    !mutation.isPending &&
    !query.isLoading &&
    !!data &&
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
    (sum, source) => sum + getSourcePreviewFree(source),
    0
  );
  const productionTotal = manufacturingSources.reduce(
    (sum, source) => sum + readQuantity(source.totalQty),
    0
  );
  const productionFree = manufacturingSources.reduce(
    (sum, source) => sum + getSourcePreviewFree(source),
    0
  );
  const supplyPanelCount =
    manufacturingSources.length > 0
      ? `${onHandSources.length} on hand · ${manufacturingSources.length} inbound`
      : `${onHandSources.length} on hand`;
  const selectedSource =
    selectedSourceKey ? sourceMetaByKey.get(selectedSourceKey)?.source ?? null : null;

  const sourceDestinations = selectedSource
    ? data?.demandRows.flatMap((row) => {
        const key = allocationKey(selectedSource.sourceType, selectedSource.sourceId);
        const quantity = readQuantity(draftsByLine[row.salesOrderLineId]?.[key]);
        if (quantity <= 0) return [];
        return [{ label: row.orderNumber, quantity, kind: "sales" as const }];
      }) ?? []
    : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOutputMoId(null);
          setCarried(null);
          setBrowseTarget(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent className="overflow-hidden bg-background text-foreground data-[side=right]:w-full data-[side=right]:sm:w-[min(96vw,92rem)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>Allocation Manager</SheetTitle>
          <SheetDescription className="sr-only">
            Allocate available stock and production to demand.
          </SheetDescription>
          {targetItem ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <ItemToken
                  kind={targetVisual.kind}
                  color={targetVisual.color}
                  state="available"
                  size="xs"
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                    <span className="truncate">
                      {targetLine
                        ? `${targetLine.orderNumber} · ${targetLine.customerName}`
                        : targetItem.itemName}
                    </span>
                    {targetLine ? <Badge variant="outline">Sales order</Badge> : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate">
                      {targetLine ? targetItem.itemName : "Item allocation"}
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
                  salesOrderItems={data?.salesOrderItems ?? []}
                  fallbackItemName={targetItem.itemName}
                  fallbackUnitLabel={targetUnitLabel}
                  onSelectLine={(nextLineId) => {
                    setCarried(null);
                    setSelectedSourceKey(null);
                    setBrowseTarget(null);
                    setOutputMoId(null);
                    onTargetLineChange?.(nextLineId);
                  }}
                  onSelectItem={(itemId) => {
                    setCarried(null);
                    setSelectedSourceKey(null);
                    setBrowseTarget({ itemId, lineId });
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
          <OutputAllocationWorkspace
            manufacturingOrderId={outputMoId}
            onBack={() => {
              if (lineId == null) {
                onOpenChange(false);
                return;
              }
              setOutputMoId(null);
            }}
            onOpenOutput={openOutputMo}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            {lineId == null && activeItemId == null ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">Choose a sales line or MO output first.</p>
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
              <div className="grid min-h-0 gap-4 xl:grid-cols-2">
                <WorkspacePanel
                  title="Supply · Storage"
                  count={supplyPanelCount}
                  accent="supply"
                >
                  <div className="flex min-h-0 flex-col gap-4">
                    <div className="space-y-3">
                      <SectionTitle
                        title="On hand"
                        count={`${onHandSources.length} sources`}
                        onClick={returnCarriedTokenToSource}
                      />
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
                              previewFree={getSourcePreviewFree(source)}
                              isSelected={selectedSourceKey === key}
                              carried={carried}
                              onPick={pickToken}
                              onSelect={selectSource}
                              onReturn={returnTokenToSource}
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
                          count={`${manufacturingSources.length} MOs`}
                          className="text-primary"
                          onClick={returnCarriedTokenToSource}
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
                                previewFree={getSourcePreviewFree(source)}
                                isSelected={selectedSourceKey === key}
                                carried={carried}
                                onPick={pickToken}
                                onSelect={selectSource}
                                onReturn={returnTokenToSource}
                                onOpenOutput={openOutputMo}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {targetLine && targetDraftShortQty > 0 ? (
                    <CreateManufacturingOrdersDialog
                      salesOrderId={targetLine.salesOrderId}
                      salesOrderLabel={`${targetLine.orderNumber} - ${targetLine.customerName}`}
                      buttonLabel="Add MO"
                      buttonVariant="outline"
                      buttonSize="lg"
                      buttonClassName="h-20 w-full flex-col border-dashed bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground [&_svg]:size-5"
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
                          quantity: `${formatQuantity(source.totalQty)} ${targetUnitLabel}`,
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

                  {selectedSource ? (
                    <SourceDetailPanel
                      source={selectedSource}
                      itemName={targetItem.itemName}
                      unitName={targetItem.unitName}
                      destinations={sourceDestinations}
                    />
                  ) : null}
                </WorkspacePanel>

                <WorkspacePanel
                  title="Demand · Orders"
                  count={`${data.demandRows.length} SO · shipping date`}
                  accent="default"
                >
                  <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                    {data.demandRows
                      .toSorted((a, b) => Number(b.isTarget) - Number(a.isTarget))
                      .map((row) => {
                        const isTarget = row.salesOrderLineId === targetLineId;
                        const allocatedQty = getLineDraftTotal(row.salesOrderLineId);
                        const shortQty = Math.max(
                          0,
                          readQuantity(row.remainingQty) - allocatedQty
                        );

                        return (
                          <DemandCard
                            key={row.salesOrderLineId}
                            row={row}
                            isTarget={isTarget}
                            allocatedQty={allocatedQty}
                            shortQty={shortQty}
                            carried={carried}
                            onPlace={() => placeOnLine(row.salesOrderLineId)}
                            onPick={() => pickFirstTokenFromLine(row.salesOrderLineId)}
                          />
                        );
                      })}
                  </div>
                </WorkspacePanel>
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">No allocatable line found.</p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            )}
            <CarryPanel
              carried={carried}
              className="bottom-20"
            />
          </div>
        )}

        {!outputMoId ? (
          <SheetFooter className="border-t">
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : totalOverRemaining && targetLine ? (
              <p className="text-sm text-destructive">
                Allocated quantity cannot exceed {formatQuantity(targetLine.remainingQty)}{" "}
                {targetUnitLabel}.
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
                onClick={() => {
                  setDraftState({
                    workspaceKey: draftWorkspaceKey,
                    values: defaultDraftsByLine,
                  });
                  setCarried(null);
                }}
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
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
