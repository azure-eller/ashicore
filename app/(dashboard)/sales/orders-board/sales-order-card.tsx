"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Delete02Icon,
  Factory01Icon,
  Copy01Icon,
  MoreVerticalIcon,
  NoteIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import type { SalesLinkedManufacturingOrder, SalesOrderListRow } from "../types";
import { AllocationSheet } from "../allocation-sheet";
import { SalesOrderCardExpanded } from "./sales-order-card-expanded";
import {
  deriveSalesOrderLane,
  readSalesOrderNumber,
  type SalesOrderLaneId,
} from "./sales-order-lane-model";

export type DeleteTarget = {
  id: string;
  orderNumber: string;
} | null;

function OrderNotesPreview({
  notes,
  orderNumber,
}: {
  notes: string | null;
  orderNumber: string;
}) {
  const trimmedNotes = notes?.trim();

  if (!trimmedNotes) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Order notes for ${orderNumber}`}
          data-testid="sales-order-notes-indicator"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border bg-background/70 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={NoteIcon} strokeWidth={2} className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-80 whitespace-pre-wrap">
        {trimmedNotes}
      </TooltipContent>
    </Tooltip>
  );
}

function LineAllocationPreview({
  lines,
  canManageAllocations,
  onManageLine,
}: {
  lines: SalesOrderListRow["lines"];
  canManageAllocations: boolean;
  onManageLine: (lineId: string) => void;
}) {
  const visibleLines = lines.slice(0, 3);

  if (visibleLines.length === 0) return null;

  return (
    <div
      className="mt-1.5 grid min-w-0 grid-cols-2 gap-1"
      aria-label="Order line allocation preview"
    >
      {visibleLines.map((line, index) => (
        <LineAllocationPreviewRow
          key={line.id ?? `${line.itemId}:${index}`}
          line={line}
          canManageAllocation={canManageAllocations && line.id != null}
          onManageLine={onManageLine}
        />
      ))}
      {lines.length > visibleLines.length ? (
        <div className="rounded-full bg-muted/30 px-2 py-1 text-[10px] leading-none text-muted-foreground">
          +{lines.length - visibleLines.length} more line
          {lines.length - visibleLines.length === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

function LineAllocationPreviewRow({
  line,
  canManageAllocation,
  onManageLine,
}: {
  line: SalesOrderListRow["lines"][number];
  canManageAllocation: boolean;
  onManageLine: (lineId: string) => void;
}) {
  const lineId = line.id;
  const allocation = getLineAllocationLabel(line);
  const content = (
    <>
      <span className="min-w-0 max-w-24">
        <span className="block truncate font-medium text-foreground">
          {line.masterName}
        </span>
        <span className="mt-0.5 block truncate text-[10px] leading-none text-muted-foreground">
          {line.unitName}
        </span>
      </span>
      <span className="shrink-0 self-center font-semibold tabular-nums text-foreground">
        {allocation}
      </span>
    </>
  );

  const className = cn(
    "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-full bg-muted/30 px-2 py-1 text-[11px] leading-tight",
    canManageAllocation && "transition hover:bg-muted/55"
  );

  if (!canManageAllocation || !lineId) {
    return (
      <div
        className={className}
        data-testid="sales-order-line-allocation-preview"
        title={`${line.masterName}: ${allocation}`}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-testid="sales-order-line-allocation-preview"
      title={`${line.masterName}: ${allocation}`}
      aria-label={`Manage allocation for ${line.masterName}: ${allocation}`}
      onClick={(event) => {
        event.stopPropagation();
        onManageLine(lineId);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {content}
    </button>
  );
}

function getLineAllocationLabel(line: SalesOrderListRow["lines"][number]) {
  const allocated = formatQuantity(line.allocatedQty ?? "0") ?? "0";
  const demand = formatQuantity(line.quantity) ?? line.quantity;

  return `${allocated}/${demand}`;
}

export function SalesOrderCard({
  order,
  expanded,
  density,
  onToggleExpanded,
  onDelete,
}: {
  order: SalesOrderListRow;
  expanded: boolean;
  density: "compact" | "comfortable";
  onToggleExpanded: () => void;
  onDelete: () => void;
}) {
  const [allocationLineId, setAllocationLineId] = useState<string | null>(null);
  const lane = deriveSalesOrderLane(order);
  const canEdit = order.deletedAt == null && ["draft", "confirmed"].includes(order.status);
  const canManageAllocations =
    order.deletedAt == null &&
    ["draft", "confirmed", "partially_shipped"].includes(order.status);
  const isCompact = density === "compact";
  const visibleLineCount = order.lines.length;
  const laneCopy = getCardLaneCopy(order, lane, visibleLineCount);

  return (
    <Card
      size="sm"
      data-testid="sales-order-card"
      data-order-number={order.orderNumber}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggleExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleExpanded();
        }
      }}
      className={cn(
        "w-full min-w-0 max-w-full !gap-0 overflow-hidden rounded-lg border-l-2 !py-0 shadow-xs transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        lane === "draft" && "border-l-muted-foreground/35",
        lane === "supply_needed" && "border-l-warning",
        lane === "in_production" && "border-l-primary",
        lane === "ready_to_ship" && "border-l-success",
        lane === "shipped" && "border-l-info",
        lane === "cancelled" && "border-l-destructive",
        expanded && "shadow-md ring-2 ring-primary/45"
      )}
    >
      <AllocationSheet
        lineId={allocationLineId}
        open={allocationLineId != null}
        onOpenChange={(open) => {
          if (!open) setAllocationLineId(null);
        }}
        onTargetLineChange={setAllocationLineId}
      />
      <CardHeader
        className={cn(
          "bg-card",
          expanded
            ? isCompact
              ? "px-2.5 py-2.5"
              : "px-3 py-3"
            : "px-2.5 py-2"
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sales/orders/${order.id}`}
                  prefetch={false}
                  draggable={false}
                  aria-label={`Open ${order.orderNumber} for ${order.customerName}`}
                  className="block max-w-full rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="max-w-full truncate text-sm font-semibold leading-tight">
                    {order.customerName}
                  </div>
                </Link>
                <Link
                  href={`/sales/orders/${order.id}`}
                  prefetch={false}
                  className="block max-w-full rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="max-w-full truncate text-xs text-muted-foreground">
                    {order.orderNumber}
                  </div>
                </Link>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">
                    {formatPrice(order.totalAmount) ?? "\u2014"}
                  </span>
                  {order.status === "draft" ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      Draft
                    </Badge>
                  ) : null}
                  {expanded && order.customerProjectId ? (
                    <Link
                      href={`/sales/customers/${order.customerId}?project=${order.customerProjectId}#projects`}
                      prefetch={false}
                      className="max-w-full truncate rounded-sm text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      {order.customerProjectName ?? "Deleted project"}
                    </Link>
                  ) : null}
                </div>
                {!expanded ? (
                  <>
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3 shrink-0" />
                      <span className="truncate">{laneCopy.dateLabel}</span>
                      <OrderNotesPreview notes={order.notes} orderNumber={order.orderNumber} />
                    </div>
                    <LineAllocationPreview
                      lines={order.lines}
                      canManageAllocations={canManageAllocations}
                      onManageLine={setAllocationLineId}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <OrderActionsMenu order={order} canEdit={canEdit} onDelete={onDelete} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {!expanded ? (
          <CollapsedManufacturingProgress order={order} />
        ) : null}
        {/*
          Keep the expanded fulfillment console visually separate from the compact
          identity header so the order still scans as an order first.
        */}
        {expanded ? (
          <div
            className={cn("pt-0", isCompact ? "px-2 pb-2" : "px-2.5 pb-2.5")}
            onClick={(event) => event.stopPropagation()}
          >
            <SalesOrderCardExpanded order={order} />
          </div>
        ) : null}
        {expanded ? (
          <div
            className={cn(
              "mx-2 flex items-center gap-2 bg-card text-xs text-muted-foreground",
              isCompact ? "py-1.5" : "py-2"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
              <span className="truncate">{laneCopy.dateLabel}</span>
            </span>
            <OrderNotesPreview notes={order.notes} orderNumber={order.orderNumber} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LinkedManufacturingOrdersMenu({
  order,
}: {
  order: SalesOrderListRow;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open manufacturing orders for ${order.orderNumber}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={Factory01Icon} strokeWidth={2} className="size-3" />
          {order.openManufacturingOrderCount} MO
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 bg-popover text-popover-foreground"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Open manufacturing
        </div>
        {order.openManufacturingOrders.map((manufacturingOrder) => (
          <DropdownMenuItem key={manufacturingOrder.id} asChild>
            <Link
              href={`/manufacturing/orders/${manufacturingOrder.id}`}
              prefetch={false}
              className="flex min-w-0 flex-col items-start gap-0.5"
            >
              <span className="font-mono text-xs">{manufacturingOrder.orderNumber}</span>
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {manufacturingOrder.productName} ·{" "}
                {formatQuantity(manufacturingOrder.plannedQuantity)}{" "}
                {manufacturingOrder.unitName}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedManufacturingProgress({
  order,
}: {
  order: SalesOrderListRow;
}) {
  if (order.openManufacturingOrderCount === 0) return null;

  const summary = getManufacturingProgressSummary(order.openManufacturingOrders);

  return (
    <div
      className="px-2.5 pb-2"
      data-testid="sales-order-mo-progress"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <LinkedManufacturingOrdersMenu order={order} />
        <div
          className="alloc-progress-track h-1.5 min-w-10 flex-1 rounded-full"
          aria-label={summary.ariaLabel}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", summary.progressClassName)}
            style={{ width: `${summary.percent}%` }}
          />
        </div>
        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
          {summary.label}
        </Badge>
      </div>
    </div>
  );
}

function getManufacturingProgressSummary(
  orders: SalesLinkedManufacturingOrder[]
) {
  const total = orders.length;
  const released = orders.filter((order) => order.status === "released").length;
  const draft = orders.filter((order) => order.status === "draft").length;
  const percent =
    total === 0
      ? 0
      : Math.round(
          ((released * 0.72 + draft * 0.28) / total) * 100
        );

  if (released === total) {
    return {
      label: "Released",
      percent,
      progressClassName: "alloc-progress-fill-held",
      ariaLabel: `${total} manufacturing order${total === 1 ? "" : "s"} released`,
    };
  }

  if (draft === total) {
    return {
      label: "Draft",
      percent,
      progressClassName: "alloc-progress-fill-disabled",
      ariaLabel: `${total} manufacturing order${total === 1 ? "" : "s"} in draft`,
    };
  }

  return {
    label: `${released} released`,
    percent,
    progressClassName: "alloc-progress-fill-held",
    ariaLabel: `${released} released and ${draft} draft manufacturing orders`,
  };
}

function OrderActionsMenu({
  order,
  canEdit,
  onDelete,
}: {
  order: SalesOrderListRow;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const duplicateMutation = useMutation({
    mutationFn: () =>
      apiJson<{ id: string }>(`/api/sales-orders/${order.id}/duplicate`, {
        method: "POST",
        idempotencyKey: "sales-order-duplicate",
        fallbackError: "Failed to duplicate order.",
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      router.push(`/sales/orders/${created.id}`);
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`More actions for ${order.orderNumber}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground"
      >
        {canEdit ? (
          <DropdownMenuItem asChild>
            <Link href={`/sales/orders/${order.id}/edit`} prefetch={false}>
              <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
              Edit
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={duplicateMutation.isPending}
          onSelect={(event) => {
            event.preventDefault();
            duplicateMutation.mutate();
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
          {duplicateMutation.isPending ? "Duplicating..." : "Duplicate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getCardLaneCopy(
  order: SalesOrderListRow,
  lane: SalesOrderLaneId,
  visibleLineCount: number
) {
  const shortQty = readSalesOrderNumber(order.fulfillmentSummary.shortQty);
  const date = order.shipDate ? formatDate(order.shipDate) : "\u2014";
  const shippedDate = order.shipDate ? formatDate(order.shipDate) : null;
  const lineNoun = visibleLineCount === 1 ? "item" : "items";

  if (lane === "ready_to_ship") {
    return {
      statusLabel: "Ready",
      fulfillmentLabel: `All ${visibleLineCount} ${lineNoun} available`,
      dateLabel: `Ship by: ${date}`,
      secondaryLabel: null,
      toneClassName: "text-success",
      secondaryToneClassName: "text-success",
    };
  }

  if (lane === "supply_needed") {
    return {
      statusLabel: "Short",
      fulfillmentLabel: order.fulfillmentSummary.label,
      dateLabel: `Ship by: ${date}`,
      secondaryLabel: null,
      toneClassName: "text-warning",
      secondaryToneClassName: "text-destructive",
    };
  }

  if (lane === "in_production") {
    return {
      statusLabel: "MO open",
      fulfillmentLabel: `${order.openManufacturingOrderCount} MO work open`,
      dateLabel: `Ship by: ${date}`,
      secondaryLabel: null,
      toneClassName: "text-primary",
      secondaryToneClassName: "text-primary",
    };
  }

  if (lane === "shipped") {
    return {
      statusLabel: "Shipped",
      fulfillmentLabel: "Fulfilled",
      dateLabel: shippedDate ? `Shipped: ${shippedDate}` : "Shipped",
      secondaryLabel: null,
      toneClassName: "text-muted-foreground",
      secondaryToneClassName: "text-muted-foreground",
    };
  }

  if (lane === "cancelled") {
    return {
      statusLabel: "Cancelled",
      fulfillmentLabel: "Cancelled order",
      dateLabel: `Ship by: ${date}`,
      secondaryLabel: null,
      toneClassName: "text-muted-foreground",
      secondaryToneClassName: "text-muted-foreground",
    };
  }

  return {
    statusLabel: "Draft",
    fulfillmentLabel: order.fulfillmentSummary.label,
    dateLabel: `Ship by: ${date}`,
    secondaryLabel: null,
    toneClassName: shortQty > 0 ? "text-warning" : "text-muted-foreground",
    secondaryToneClassName: "text-destructive",
  };
}
