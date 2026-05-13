"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import type {
  AllocationDemandType,
  AllocationSourceType,
  AllocationWorkspace,
} from "@/lib/inventory/allocation/types";

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
  parentId: string | null;
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
  targetDemand:
    | (AllocationDemandRow & {
        allocationManagedAt: Date | null;
      })
    | null;
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

type SalesAllocationSheetWire = {
  targetItem: AllocationSheetData["targetItem"];
  targetLine:
    | (Omit<AllocationDemandRow, "demandId" | "parentId" | "label" | "status" | "contextLabel" | "requiredDate" | "fulfilledQty"> & {
        salesOrderLineId: string;
        salesOrderId: string;
        orderNumber: string;
        orderStatus: string;
        customerName: string;
        shipDate: string | null;
        shippedQty: string;
        allocationManagedAt: Date | null;
      })
    | null;
  variantOptions: Array<Omit<AllocationVariantOption, "demandId"> & { salesOrderLineId: string | null }>;
  salesOrderItems: Array<
    Omit<AllocationSheetData["relatedItems"][number], "demandId" | "variantOptions"> & {
      salesOrderLineId: string;
      variantOptions: Array<Omit<AllocationVariantOption, "demandId"> & { salesOrderLineId: string | null }>;
    }
  >;
  editableAllocations: AllocationSheetData["editableAllocations"];
  supplySources: AllocationSource[];
  demandRows: Array<
    Omit<AllocationDemandRow, "demandId" | "parentId" | "label" | "status" | "contextLabel" | "requiredDate" | "fulfilledQty"> & {
      salesOrderLineId: string;
      salesOrderId: string;
      orderNumber: string;
      orderStatus: string;
      customerName: string;
      shipDate: string | null;
      shippedQty: string;
    }
  >;
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
      parentId: null,
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
    targetDemand: primary == null ? null : { ...primary, allocationManagedAt: null },
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

function salesVariantToAllocationVariant(
  option: SalesAllocationSheetWire["variantOptions"][number]
): AllocationVariantOption {
  return {
    itemId: option.itemId,
    itemName: option.itemName,
    unitName: option.unitName,
    demandId: option.salesOrderLineId,
    isCurrent: option.isCurrent,
  };
}

function salesDemandToAllocationDemand(
  row: SalesAllocationSheetWire["demandRows"][number]
): AllocationDemandRow {
  return {
    demandType: "sales_order_line",
    demandId: row.salesOrderLineId,
    parentId: row.salesOrderId,
    label: row.orderNumber,
    status: row.orderStatus,
    contextLabel: row.customerName,
    requiredDate: row.shipDate,
    itemId: row.itemId,
    itemName: row.itemName,
    unitName: row.unitName,
    orderedQty: row.orderedQty,
    fulfilledQty: row.shippedQty,
    cancelledQty: row.cancelledQty,
    remainingQty: row.remainingQty,
    allocatedQty: row.allocatedQty,
    shortQty: row.shortQty,
    sourceSummary: row.sourceSummary,
    sources: row.sources,
    isTarget: row.isTarget,
  };
}

function salesWireToAllocationSheetData(data: SalesAllocationSheetWire): AllocationSheetData {
  const demandRows = data.demandRows.map(salesDemandToAllocationDemand);
  return {
    targetItem: data.targetItem,
    targetDemand:
      data.targetLine == null
        ? null
        : {
            ...salesDemandToAllocationDemand(data.targetLine),
            allocationManagedAt: data.targetLine.allocationManagedAt,
          },
    variantOptions: data.variantOptions.map(salesVariantToAllocationVariant),
    relatedItems: data.salesOrderItems.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      unitName: item.unitName,
      demandId: item.salesOrderLineId,
      allocatedQty: item.allocatedQty,
      remainingQty: item.remainingQty,
      shortQty: item.shortQty,
      isCurrent: item.isCurrent,
      variantOptions: item.variantOptions.map(salesVariantToAllocationVariant),
    })),
    editableAllocations: data.editableAllocations,
    supplySources: data.supplySources,
    demandRows,
    uncoveredDemandQty: data.uncoveredDemandQty,
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
  demandRef?: { demandType: "sales_order_line" | "manufacturing_order_ingredient"; demandId: string };
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

function sourceKindLabel(source: AllocationSource) {
  if (source.sourceType === "inventory_lot") return "Lot";
  return source.status === "draft" ? "Draft production" : "Released production";
}

function demandContextLabel(row: AllocationSheetData["demandRows"][number]) {
  return row.contextLabel ? `${row.label} · ${row.contextLabel}` : row.label;
}

function demandTypeOf(row: AllocationSheetData["demandRows"][number]) {
  return (row as { demandType?: "sales_order_line" | "manufacturing_order_ingredient" })
    .demandType;
}

function demandTypeShortLabel(row: AllocationSheetData["demandRows"][number]) {
  return demandTypeOf(row) === "manufacturing_order_ingredient" ? "MO" : "SO";
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
    <div className="h-2 overflow-hidden rounded-sm bg-muted">
      <div
        className={cn(
          "h-full rounded-sm transition-all duration-300 motion-reduce:transition-none",
          tone === "success" && "bg-success",
          tone === "primary" && "bg-primary",
          tone === "warning" && "bg-warning"
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
      className="pointer-events-none absolute bottom-4 left-4 z-30 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-1.5"
      aria-live="polite"
      aria-atomic="false"
    >
      {events.slice(-3).map((event) => (
        <div
          key={event.id}
          data-testid="allocation-event-message"
          className={cn(
            "rounded-md border bg-popover/95 px-3 py-2 text-xs font-medium text-popover-foreground shadow-lg backdrop-blur",
            "animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
            event.tone === "success" && "border-success/45 text-success",
            event.tone === "warning" && "border-warning/45 text-warning",
            event.tone === "danger" && "border-destructive/45 text-destructive"
          )}
        >
          {event.message}
        </div>
      ))}
    </div>
  );
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
  allocations,
  held,
  demandLabel,
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
  onPick?: (token: AllocationTokenData) => void;
}) {
  const stackSize = demandStackSize(Math.max(total, allocated));
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
    return splitQuantityStacks(visibleQty, stackSize).map((quantity, index) => ({
      ...allocation,
      quantity,
      stackIndex: index,
      isHeldGhost: false,
    }));
  });
  const heldStacks =
    held && held.quantity > 0
      ? splitQuantityStacks(held.quantity, stackSize).map((quantity, index) => {
          const source = sourceAllocations.find(
            (allocation) => allocation.sourceKey === held.sourceKey
          );
          return {
            sourceKey: held.sourceKey,
            sourceType: source?.sourceType ?? ("inventory_lot" as AllocationSourceType),
            sourceId: source?.sourceId ?? null,
            sourceLabel: source?.sourceLabel ?? "Source",
            sourceIndex: source?.sourceIndex ?? 0,
            quantity,
            stackIndex: index,
            isHeldGhost: true,
          };
        })
      : [];
  const totalStacks = splitQuantityStacks(total, stackSize);
  const emptyCount = Math.max(
    0,
    totalStacks.length - allocatedStacks.length - heldStacks.length
  );

  if (total <= 0 && allocated <= 0) {
    return <div className="h-12" />;
  }

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-1.5" data-testid="allocation-rail">
      {[...allocatedStacks, ...heldStacks].map((stack) => {
        const label = `${stack.isHeldGhost ? "Holding" : "Move"} ${quantityLabel(stack.quantity)} from ${stack.sourceLabel}${demandLabel ? ` on ${demandLabel}` : ""}`;
        const token = (
          <ItemToken
            kind={visual.kind}
            color={visual.color}
            state={stack.isHeldGhost ? "hold" : "allocated"}
            selected={stack.isHeldGhost}
            size="sm"
            quantity={quantityLabel(stack.quantity)}
            className={cn(
              "shadow-xs transition-transform duration-150 motion-reduce:transition-none",
              !stack.isHeldGhost && "hover:scale-105 focus-visible:scale-105 motion-reduce:hover:scale-100 motion-reduce:focus-visible:scale-100",
              stack.isHeldGhost && "border-dashed opacity-65"
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
              onPick({
                sourceKey: stack.sourceKey,
                sourceType: stack.sourceType,
                sourceId: stack.sourceId,
                sourceLabel: stack.sourceLabel,
                sourceIndex: stack.sourceIndex,
                quantity: stack.quantity,
              });
            }}
          >
            {token}
          </button>
        );
      })}
      {Array.from({ length: emptyCount }).map((_, index) => (
        <span
          key={`empty-${index}`}
          className="flex h-12 w-12 shrink-0 rounded-md border border-dashed bg-muted/15"
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
                      "relative flex size-10 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                      item.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20",
                      !item.isCurrent && isComplete && "border-success/70 bg-success/5",
                      !item.isCurrent && !isComplete && short > 0 && "border-warning/70 bg-warning/5"
                    )}
                    aria-label={`${item.itemName} · ${unitLabel}`}
                      onClick={() => onSelectDemand(item.demandId)}
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
              <div className="invisible absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-md border bg-popover p-1 text-popover-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none">
                  {item.variantOptions.map((option) => {
                    const optionUnitLabel = compactUnitName(option.unitName);
                    const optionVisual = itemVisual(option.itemName, option.unitName);
                    return (
                    <Tooltip key={option.itemId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                            option.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20"
                          )}
                          aria-label={`${option.itemName} · ${optionUnitLabel}`}
                          onClick={() => {
                            if (option.demandId) {
                              onSelectDemand(option.demandId);
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
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  option.isCurrent && "border-primary/70 bg-primary/5 ring-2 ring-primary/20"
                )}
                aria-label={`${option.itemName} · ${unitLabel}`}
                onClick={() => {
                  if (option.demandId && !option.isCurrent) {
                    onSelectDemand(option.demandId);
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
  const sourceText = carried.originDemandId
    ? `Reallocating from ${carried.originLabel ?? "demand"}`
    : carried.sourceType === "inventory_lot"
      ? `From ${carried.sourceLabel}`
      : `From ${carried.sourceLabel}`;
  const unitLabel = compactUnitName(carried.unitName);

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 z-20 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2",
        className
      )}
      data-testid="allocation-holding-hud"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/35 bg-popover/95 p-2.5 text-popover-foreground shadow-xl ring-2 ring-primary/20 backdrop-blur">
        <span className="sr-only">Holding</span>
        <div className="flex min-w-0 items-center gap-3">
          <ItemToken
            kind={visual.kind}
            color={visual.color}
            state={isProduction ? "inbound" : "available"}
            selected
            size="md"
            quantity={quantityLabel(carried.quantity)}
          />
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wide text-primary">
              Holding
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums leading-none">
                {quantityLabel(carried.quantity)}
              </span>
              <span className="text-xs font-medium text-muted-foreground">{unitLabel}</span>
            </div>
            <div className="truncate text-sm font-medium">
              {carried.itemName ?? carried.sourceLabel}
            </div>
            <div className="truncate text-xs text-muted-foreground">{sourceText}</div>
          </div>
        </div>
        <div className="grid shrink-0 gap-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">Esc</kbd>
            <span>cancel</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">X</kbd>
            <span>split</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="w-12 rounded border bg-muted px-1.5 py-0.5 text-center font-mono">wheel</kbd>
            <span>adjust</span>
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
  onPick: (token: AllocationTokenData) => void;
  onSelect: (sourceKeyValue: string) => boolean;
  onInvalid: (message: string) => void;
  onOpenOutput: (id: string) => void;
}) {
  const isMo = source.sourceType === "manufacturing_order";
  const isLot = source.sourceType === "inventory_lot";
  const sourceHeldQty =
    carried?.sourceKey === sourceKeyValue && carried.originDemandId == null
      ? carried.quantity
      : 0;
  const quantityLabel = formatQuantity(toQuantityString(previewFree));
  const visual = itemVisual(itemName, unitName);
  const canPick = previewFree > 0 && source.canAllocate;
  const isHeldSource =
    carried?.originDemandId != null && carried.sourceKey === sourceKeyValue;
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
    "group relative flex h-24 w-20 flex-col items-center justify-center rounded-md border text-left shadow-xs transition motion-reduce:transition-none",
    toneClasses.base,
    toneClasses.hover,
    "focus-within:ring-2 focus-within:ring-ring",
    isSelected && toneClasses.selected,
    isHeldSource && "border-warning/60 bg-warning/10",
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
            if (!canPick) {
              onInvalid(source.canAllocate ? "No available quantity" : "Source is not allocatable");
              return;
            }
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
          data-allocation-interactive
        >
          {sourceHeldQty > 0 ? (
            <AffordanceChip tone="source" className="absolute left-1 top-1">
              Holding
            </AffordanceChip>
          ) : null}
          {isHeldSource ? (
            <AffordanceChip tone="source" className="absolute left-1 top-1">
              Source
            </AffordanceChip>
          ) : null}
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
    <div className="flex w-20 flex-col items-center gap-1">
      <button
        type="button"
        className={cn(stackClassName, "focus-visible:outline-none focus-visible:ring-2")}
        onClick={() => {
          if (!onSelect(sourceKeyValue)) return;
          if (!canPick) {
            onInvalid(source.canAllocate ? "No available quantity" : "Source is not allocatable");
            return;
          }
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
        data-allocation-interactive
      >
        {sourceHeldQty > 0 ? (
          <AffordanceChip tone="source" className="absolute left-1 top-1">
            Holding
          </AffordanceChip>
        ) : null}
        {isHeldSource ? (
          <AffordanceChip tone="source" className="absolute left-1 top-1">
            Source
          </AffordanceChip>
        ) : null}
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
  previewAllocated,
  previewFree,
  heldQuantity,
}: {
  source: AllocationSource | null;
  itemName: string | null | undefined;
  unitName: string | null | undefined;
  destinations: Array<{ label: string; quantity: number; kind: "sales" | "production" }>;
  previewAllocated?: number;
  previewFree?: number;
  heldQuantity?: number;
}) {
  const organizationTimeZone = useOrganizationTimeZone();

  if (!source) return null;

  const total = readQuantity(source.totalQty);
  const allocated = previewAllocated ?? readQuantity(source.allocatedQty);
  const free = previewFree ?? readQuantity(source.freeQty);
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
          <span className="text-right font-medium tabular-nums">{quantityLabel(allocated)}</span>
        </div>
        <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Free</span>
          <ProgressBar value={free} max={Math.max(total, allocated + free)} />
          <span className="text-right font-medium tabular-nums">{quantityLabel(free)}</span>
        </div>
        {heldQuantity && heldQuantity > 0 ? (
          <div className="flex justify-end">
            <AffordanceChip tone="source">Holding {quantityLabel(heldQuantity)}</AffordanceChip>
          </div>
        ) : null}
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
        {heldQuantity && heldQuantity > 0 ? (
          <div className="flex justify-end">
            <AffordanceChip tone="source">Holding {quantityLabel(heldQuantity)}</AffordanceChip>
          </div>
        ) : null}
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
  onReturnOrigin,
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
  onPlace: () => void;
  onPickToken: (token: AllocationTokenData) => void;
  onReturnOrigin: () => void;
  onInvalid: (message: string) => void;
}) {
  const [isHovering, setIsHovering] = useState(false);
  const remaining = readQuantity(row.remainingQty);
  const isOrigin = carried?.originDemandId === row.demandId;
  const canPlace = carried != null && !isOrigin && shortQty > 0;
  const isInvalidWhileHolding = carried != null && !isOrigin && shortQty <= 0;
  const previewAllocated = canPlace ? allocatedQty + pendingPreview : allocatedQty;
  const previewShort = canPlace ? Math.max(0, remaining - previewAllocated) : shortQty;
  const showPreview = canPlace && isHovering && pendingPreview > 0;
  const visual = itemVisual(row.itemName, row.unitName);
  const demandLabel = demandContextLabel(row);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Allocate to ${row.label}`}
      data-testid={isTarget ? "current-allocation-bucket" : "readonly-allocation-bucket"}
      data-allocation-interactive
      data-allocation-state={
        isOrigin ? "origin" : canPlace ? "valid-target" : isInvalidWhileHolding ? "invalid-target" : "idle"
      }
      className={cn(
        "cursor-pointer",
        "w-full rounded-md border bg-background p-3 text-left shadow-xs transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        isTarget && "border-primary/25 bg-primary/5",
        isOrigin && "border-warning/65 bg-warning/10 ring-2 ring-warning/20",
        canPlace && "border-success/45 bg-success/5 hover:border-success/70 hover:bg-success/10 hover:ring-2 hover:ring-success/15 focus-visible:ring-success/30",
        isInvalidWhileHolding && "opacity-65",
        lastPlacedDemandId === row.demandId &&
          "animate-in zoom-in-95 ring-2 ring-success/30 motion-reduce:animate-none"
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
      onClick={() => {
        if (carried) {
          if (isOrigin) {
            onReturnOrigin();
            return;
          }
          if (!canPlace) {
            onInvalid(shortQty <= 0 ? "Order already full" : "Cannot place stock here");
            return;
          }
          onPlace();
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
        onPickToken({
          ...firstAllocation,
          quantity: firstAllocation.quantity,
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (carried) {
            if (isOrigin) {
              onReturnOrigin();
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
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Badge className="rounded-sm bg-warning/10 text-warning">{demandTypeShortLabel(row)}</Badge>
          <span className="font-semibold">{row.label}</span>
          <span className="truncate text-muted-foreground">{row.contextLabel}</span>
          {isTarget ? <Badge variant="outline">This demand</Badge> : null}
          {isOrigin ? <AffordanceChip tone="source">Return here</AffordanceChip> : null}
          {canPlace ? <AffordanceChip tone="success">Place here</AffordanceChip> : null}
          {isInvalidWhileHolding ? <AffordanceChip tone="warning">Full</AffordanceChip> : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {demandDateLabel(row)} {row.requiredDate ? formatDate(row.requiredDate) : "\u2014"}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <DemandQuantityStacks
          total={remaining}
          allocated={allocatedQty}
          visual={visual}
          allocations={draftAllocations}
          held={held}
          demandLabel={demandLabel}
          onPick={
            carried == null
              ? (token) =>
                  onPickToken({
                    ...token,
                    itemName: row.itemName,
                    unitName: row.unitName,
                    originDemandId: row.demandId,
                    originLabel: row.label,
                    originContext: row.contextLabel,
                  })
              : undefined
          }
        />
        <ProgressBar value={allocatedQty} max={remaining} />
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          {held ? (
            <AffordanceChip tone="source">
              Holding {quantityLabel(held.quantity)}
            </AffordanceChip>
          ) : null}
          {showPreview ? (
            <AffordanceChip tone="success">
              Allocated {quantityLabel(allocatedQty)} → {quantityLabel(previewAllocated)}
            </AffordanceChip>
          ) : null}
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

  function pushOutputEvent(message: string, tone: AllocationEvent["tone"] = "success") {
    setEvents((current) => [
      ...current.slice(-2),
      { id: Date.now() + Math.random(), tone, message },
    ]);
  }

  useEffect(() => {
    if (events.length === 0) return;
    const timeout = window.setTimeout(() => setEvents((current) => current.slice(1)), 2500);
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
        setOutputCarry(null);
        pushOutputEvent("Cancelled pickup", "warning");
      } else if (event.key.toLowerCase() === "x") {
        const nextQty = Math.max(1, Math.floor(outputCarry.quantity / 2));
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
        pushOutputEvent(`Split stack: holding ${quantityLabel(nextQty)}`, "warning");
      } else if (event.key === "+" || event.key === "=") {
        const nextQty = clampQuantity(
          outputCarry.quantity + (event.shiftKey ? 5 : 1),
          getOutputCarryMax(outputCarry)
        );
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
        pushOutputEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
      } else if (event.key === "-") {
        const nextQty = Math.max(1, outputCarry.quantity - (event.shiftKey ? 5 : 1));
        setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
        pushOutputEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [getOutputCarryMax, outputCarry]);

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
      setOutputCarry((current) => (current == null ? null : { ...current, quantity: nextQty }));
      pushOutputEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
    }

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [getOutputCarryMax, outputCarry]);

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

  function placeOnDestination(ingredientId: string) {
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
      setOutputCarry(null);
      setSelectedIngredientId(ingredientId);
      pushOutputEvent(`Returned ${quantityLabel(outputCarry.quantity)} to source`, "warning");
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
    pushOutputEvent(`Allocated ${quantityLabel(quantity)} to ${destination.orderNumber}`);
  }

  function placeOnSalesDestination(demandId: string) {
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
    pushOutputEvent(`Allocated ${quantityLabel(quantity)} to ${destination.orderNumber}`);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
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
        {hasOutputChanges ? (
          <div
            data-testid="allocation-pending-changes"
            className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 text-sm"
          >
            <span className="font-medium text-primary">Unsaved allocation changes</span>
            <Badge variant="secondary">1 change pending</Badge>
          </div>
        ) : null}
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
              free={visibleOutputFree}
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
                          "group relative flex h-24 w-20 flex-col items-center justify-center rounded-md border bg-primary/5 text-left shadow-xs transition motion-reduce:transition-none",
                          "hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          outputSelected && "border-primary/60 ring-2 ring-primary/25 shadow-md",
                          outputFree <= 0 && "opacity-70"
                        )}
                        onClick={() => {
                          if (outputCarry != null) {
                            if (!outputCarry.originIngredientId) {
                              setOutputSelected(false);
                              setOutputCarry(null);
                              pushOutputEvent("Cancelled pickup", "warning");
                              return;
                            }
                            pushOutputEvent("Place held stock or press Esc to cancel", "warning");
                            return;
                          }
                          setOutputSelected(true);
                          if (outputFree > 0) {
                            setOutputCarry({ quantity: outputFree });
                            pushOutputEvent(
                              `Picked up ${quantityLabel(outputFree)} from ${data.sourceMo.orderNumber}`
                            );
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
                        {carriedQty != null && !outputCarry?.originIngredientId ? (
                          <AffordanceChip tone="source" className="absolute left-1 top-1">
                            Holding
                          </AffordanceChip>
                        ) : null}
                        <ItemToken
                          kind={outputVisual.kind}
                          color={outputVisual.color}
                          state="inbound"
                          selected={outputSelected}
                          size="md"
                          quantity={quantityLabel(visibleOutputFree)}
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
                    outputFree={visibleOutputFree}
                    draft={draft}
                    heldIngredientId={outputCarry?.originIngredientId}
                    heldQuantity={outputCarry?.originIngredientId ? outputCarry.quantity : 0}
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
                    onClick={() => placeOnSalesDestination(destination.demandId)}
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
                    onClick={() => placeOnDestination(destination.ingredientId)}
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
                      isOrigin && "border-warning/65 bg-warning/10 ring-2 ring-warning/20",
                      canPlace && "border-success/45 bg-success/5 hover:border-success/70 hover:bg-success/10",
                      carriedQty != null && !isOrigin && shortQty <= 0 && "opacity-65",
                      selected && "ring-2 ring-primary/25"
                    )}
                  >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <Badge className="rounded-sm bg-primary/10 text-primary">MO</Badge>
                            <span className="font-semibold">{destination.orderNumber}</span>
                            {canPlace ? (
                              <AffordanceChip tone="success">Place here</AffordanceChip>
                            ) : null}
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
                        onPick={
                          outputCarry == null
                            ? (token) => {
                                setOutputCarry({
                                  quantity: token.quantity,
                                  originIngredientId: destination.ingredientId,
                                  originLabel: destination.orderNumber,
                                });
                                setSelectedIngredientId(destination.ingredientId);
                                pushOutputEvent(
                                  `Picked up ${quantityLabel(token.quantity)} from ${destination.orderNumber}`
                                );
                              }
                            : undefined
                        }
                      />
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
  const demandId =
    demandRef?.demandType === "sales_order_line"
      ? demandRef.demandId
      : legacyDemandId ?? null;
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
  const [events, setEvents] = useState<AllocationEvent[]>([]);
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
  const activeItemId = itemId ?? (browseTarget?.demandId === demandId ? browseTarget.itemId : null);
  const draftWorkspaceKey = genericDemandRef
    ? `${genericDemandRef.demandType}:${genericDemandRef.demandId}`
    : demandId != null
      ? `sales_order_line:${demandId}`
      : activeItemId != null
        ? `item:${activeItemId}`
        : null;
  const query = useQuery<AllocationSheetData>({
    queryKey: ["allocation-workspace", demandId, activeItemId, genericDemandRef],
    queryFn: async () => {
      if (genericDemandRef) {
        const workspace = await apiJson<AllocationWorkspace>(
          `/api/allocation/workspace?demandType=${genericDemandRef.demandType}&demandId=${genericDemandRef.demandId}`,
          { fallbackError: "Failed to load allocation." }
        );
        return workspaceToAllocationSheetData(workspace);
      }
      if (activeItemId) {
        const salesData = await apiJson<SalesAllocationSheetWire>(
          `/api/items/${activeItemId}/allocation`,
          { fallbackError: "Failed to load allocation." }
        );
        return salesWireToAllocationSheetData(salesData);
      }
      const salesData = await apiJson<SalesAllocationSheetWire>(
        `/api/sales-order-lines/${demandId}/allocation`,
        { fallbackError: "Failed to load allocation." }
      );
      return salesWireToAllocationSheetData(salesData);
    },
    enabled:
      open &&
      (demandId != null || activeItemId != null || genericDemandRef != null) &&
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
    }, 2500);
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

  function pickToken(token: AllocationTokenData) {
    if (token.quantity <= 0) {
      pushEvent("No available quantity", "warning");
      return;
    }
    setCarried(token);
    setSelectedSourceKey(token.sourceKey);
    pushEvent(
      token.originDemandId
        ? `Picked up ${quantityLabel(token.quantity)} from ${token.originLabel ?? "demand"}`
        : `Picked up ${quantityLabel(token.quantity)} from ${token.sourceLabel}`
    );
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
      setSelectedSourceKey(null);
      setCarried(null);
      pushEvent("Cancelled pickup", "warning");
      return false;
    }

    setSelectedSourceKey(sourceKeyValue);
    return true;
  }

  function cancelCarry(message = "Cancelled pickup") {
    if (!carried) return;
    setCarried(null);
    pushEvent(message, "warning");
  }

  function allocateTokenToDemand(token: AllocationTokenData, demandId: string) {
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
    pushEvent(`Allocated ${quantityLabel(quantity)} to ${row.label}`);
  }

  function moveAllocatedTokenToDemand(
    token: AllocationTokenData,
    targetSalesOrderDemandId: string
  ) {
    const originDemandId = token.originDemandId;
    if (!originDemandId) return;
    if (originDemandId === targetSalesOrderDemandId) {
      setCarried(null);
      pushEvent(`Returned ${quantityLabel(token.quantity)} to source`, "warning");
      return;
    }

    const targetRow = data?.demandRows.find(
      (demandRow) => demandRow.demandId === targetSalesOrderDemandId
    );
    if (!targetRow) return;

    const originDraft = draftsByDemand[originDemandId] ?? {};
    const targetDraft = draftsByDemand[targetSalesOrderDemandId] ?? {};
    const originQty = readQuantity(originDraft[token.sourceKey]);
    const targetCurrentQty = readQuantity(targetDraft[token.sourceKey]);
    const targetShortQty = Math.max(
      0,
      readQuantity(targetRow.remainingQty) - getDemandDraftTotal(targetSalesOrderDemandId)
    );
    const quantity = Math.min(token.quantity, originQty, targetShortQty);
    if (quantity <= 0) {
      pushEvent(targetShortQty <= 0 ? "Order already full" : "Cannot place stock here", "warning");
      return;
    }

    updateDrafts({
      ...draftsByDemand,
      [originDemandId]: {
        ...originDraft,
        [token.sourceKey]: toQuantityString(originQty - quantity),
      },
      [targetSalesOrderDemandId]: {
        ...targetDraft,
        [token.sourceKey]: toQuantityString(targetCurrentQty + quantity),
      },
    });
    setCarried(
      token.quantity <= quantity
        ? null
        : { ...token, quantity: readQuantity(toQuantityString(token.quantity - quantity)) }
    );
    setLastPlacedDemandId(targetSalesOrderDemandId);
    pushEvent(`Allocated ${quantityLabel(quantity)} to ${targetRow.label}`);
  }

  function placeOnDemand(demandId: string) {
    if (!carried) return;
    if (carried.originDemandId) {
      moveAllocatedTokenToDemand(carried, demandId);
      return;
    }
    allocateTokenToDemand(carried, demandId);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!carried) return;
      if (event.key === "Escape") {
        cancelCarry("Cancelled pickup");
      } else if (event.key.toLowerCase() === "a") {
        const nextQty = getCarryMax(carried);
        setCarried((current) =>
          current
            ? { ...current, quantity: nextQty }
            : null
        );
        pushEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
      } else if (event.key.toLowerCase() === "x") {
        const nextQty = Math.max(1, Math.floor(carried.quantity / 2));
        setCarried((current) =>
          current ? { ...current, quantity: nextQty } : null
        );
        pushEvent(`Split stack: holding ${quantityLabel(nextQty)}`, "warning");
      } else if (event.key === "+" || event.key === "=") {
        const nextQty = clampQuantity(
          carried.quantity + (event.shiftKey ? 5 : 1),
          getCarryMax(carried)
        );
        setCarried((current) =>
          current
            ? {
                ...current,
                quantity: nextQty,
              }
            : null
        );
        pushEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
      } else if (event.key === "-") {
        const nextQty = Math.max(1, carried.quantity - (event.shiftKey ? 5 : 1));
        setCarried((current) =>
          current
            ? { ...current, quantity: nextQty }
            : null
        );
        pushEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
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
      setCarried((current) =>
        current
          ? {
              ...current,
              quantity: nextQty,
            }
          : null
      );
      pushEvent(`Holding ${quantityLabel(nextQty)}`, "warning");
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
        if (genericDemandRef) {
          const row = data?.demandRows.find(
            (candidate) => candidate.demandId === demandId
          ) as (AllocationSheetData["demandRows"][number] & {
            demandType?: "sales_order_line" | "manufacturing_order_ingredient";
          }) | undefined;
          await apiJson<AllocationWorkspace>("/api/allocation/save", {
            method: "POST",
            body: {
              demandType: row?.demandType ?? genericDemandRef.demandType,
              demandId: demandId,
              itemId: row?.itemId ?? data?.targetItem.itemId,
              allocations: Object.entries(demandDraft).flatMap(([key, value]) => {
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
        await apiJson<SalesAllocationSheetWire>(
          `/api/sales-order-lines/${demandId}/allocation`,
          {
            method: "PUT",
            body: {
              allocations: Object.entries(demandDraft).flatMap(([key, value]) => {
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
  const demandTypeCounts = (data?.demandRows ?? []).reduce(
    (counts, row) => {
      if (demandTypeOf(row) === "manufacturing_order_ingredient") counts.mo += 1;
      else counts.so += 1;
      return counts;
    },
    { so: 0, mo: 0 }
  );
  const demandPanelCount =
    demandTypeCounts.mo > 0 && demandTypeCounts.so > 0
      ? `${demandTypeCounts.so} SO · ${demandTypeCounts.mo} MO`
      : demandTypeCounts.mo > 0
        ? `${demandTypeCounts.mo} MO · need date`
        : `${demandTypeCounts.so} SO · shipping date`;
  const supplyPanelCount =
    manufacturingSources.length > 0
      ? `${onHandSources.length} on hand · ${manufacturingSources.length} inbound`
      : `${onHandSources.length} on hand`;
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
        held: selectedSourceHeldQty,
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
    if (carried || outputIsHolding) {
      pushEvent("Place held stock or press Esc to cancel", "warning");
      return;
    }
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
                    setBrowseTarget({ itemId, demandId });
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
                if (demandId == null) {
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
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4"
            onClick={(event) => {
              if (!carried) return;
              const target = event.target instanceof Element ? event.target : null;
              if (target?.closest("[data-allocation-interactive]")) return;
              pushEvent("Choose a highlighted target or press Esc to cancel", "warning");
            }}
          >
            {demandId == null && activeItemId == null ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card p-6 text-center">
                <p className="text-sm font-medium">Choose a sales demand or MO output first.</p>
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
                          count={`${manufacturingSources.length} MOs`}
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
                  targetDemand.parentId &&
                  !genericDemandRef &&
                  targetDraftShortQty > 0 &&
                  carried == null &&
                  renderCreateManufacturingOrderAction
                    ? renderCreateManufacturingOrderAction({
                      parentDemandId: targetDemand.parentId,
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
                    })
                    : null}

                  {selectedSource ? (
                    <SourceDetailPanel
                      source={selectedSource}
                      itemName={targetItem.itemName}
                      unitName={targetItem.unitName}
                      destinations={sourceDestinations}
                      previewAllocated={selectedSourcePreview?.allocated}
                      previewFree={selectedSourcePreview?.free}
                      heldQuantity={selectedSourcePreview?.held}
                    />
                  ) : null}
                </WorkspacePanel>

                <WorkspacePanel
                  title="Demand · Orders"
                  count={demandPanelCount}
                  accent="default"
                >
                  <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
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
                            onPlace={() => placeOnDemand(row.demandId)}
                            onPickToken={(token) =>
                              pickToken({
                                ...token,
                                itemName: row.itemName,
                                unitName: row.unitName,
                                originDemandId: row.demandId,
                                originLabel: row.label,
                                originContext: row.contextLabel,
                              })
                            }
                            onReturnOrigin={() => {
                              setCarried(null);
                              pushEvent(
                                `Returned ${quantityLabel(carried?.quantity ?? 0)} to source`,
                                "warning"
                              );
                            }}
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
            />
            <AllocationEventLog events={events} />
          </div>
        )}

        {!outputMoId ? (
          <SheetFooter className="border-t">
            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : totalOverRemaining && targetDemand ? (
              <p className="text-sm text-destructive">
                Allocated quantity cannot exceed {formatQuantity(targetDemand.remainingQty)}{" "}
                {targetUnitLabel}.
              </p>
            ) : overAllocatedSource ? (
              <p className="text-sm text-destructive">
                {overAllocatedSource.label} only has{" "}
                {formatQuantity(overAllocatedSource.totalQty)} total.
              </p>
            ) : null}
            {hasChanges ? (
              <div
                data-testid="allocation-pending-changes"
                className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm"
              >
                <span className="font-medium text-primary">Unsaved allocation changes</span>
                <Badge variant="secondary">
                  {changedDemandCount} {changedDemandCount === 1 ? "change" : "changes"} pending
                </Badge>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestSheetClose}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => mutation.mutate()}
                  disabled={!canSave}
                  className={cn(canSave && "shadow-sm")}
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
