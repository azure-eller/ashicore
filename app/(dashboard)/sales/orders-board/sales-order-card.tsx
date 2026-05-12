"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  DeliveryTruck02Icon,
  Factory01Icon,
  Copy01Icon,
  MoreVerticalIcon,
  NoteIcon,
  PackageIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { KanbanItemHandle } from "@/components/reui/kanban";
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
import { formatDate, formatPrice } from "@/lib/format";
import type { SalesOrderListRow } from "../types";
import { SalesOrderCardExpanded } from "./sales-order-card-expanded";
import {
  deriveSalesOrderLane,
  progressPercent,
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
  const lane = deriveSalesOrderLane(order);
  const canEdit = order.deletedAt == null && ["draft", "confirmed"].includes(order.status);
  const isCompact = density === "compact";
  const visibleLineCount = order.lines.length;
  const laneCopy = getCardLaneCopy(order, lane, visibleLineCount);
  const allocatedQty = readSalesOrderNumber(order.fulfillmentSummary.allocatedQty);
  const remainingQty = readSalesOrderNumber(order.fulfillmentSummary.remainingQty);
  const allocationPercent = progressPercent(allocatedQty, remainingQty);
  const showFulfillmentLabel =
    lane !== "draft" && lane !== "supply_needed" && lane !== "shipped";

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
        "w-full min-w-0 max-w-full gap-0 overflow-hidden rounded-lg border-l-2 py-0 shadow-xs transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        lane === "draft" && "border-l-muted-foreground/35",
        lane === "supply_needed" && "border-l-warning",
        lane === "in_production" && "border-l-primary",
        lane === "ready_to_ship" && "border-l-success",
        lane === "shipped" && "border-l-info",
        lane === "cancelled" && "border-l-destructive",
        expanded && "shadow-md ring-2 ring-primary/45"
      )}
    >
      <CardHeader className={cn("bg-card", isCompact ? "px-2.5 py-2.5" : "px-3 py-3")}>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <DragHandle
                orderNumber={order.orderNumber}
                lane={lane}
                icon={getCardLaneIcon(lane)}
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/sales/customers/${order.customerId}`}
                  prefetch={false}
                  aria-label={`Customer ${order.customerName}`}
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
                  {lane === "draft" ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      Draft
                    </Badge>
                  ) : null}
                  {order.customerProjectId ? (
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
          <>
            <div
              className="mx-2 h-0.5 overflow-hidden rounded-full bg-muted"
              aria-label={`${allocationPercent}% allocated`}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  getCardProgressClassName(lane)
                )}
                style={{ width: `${allocationPercent}%` }}
              />
            </div>
            <div className={cn("flex flex-col", isCompact ? "gap-1.5 px-2.5 py-2" : "gap-2 px-3 py-2.5")}>
              {showFulfillmentLabel ? (
                <div className="min-w-0 text-xs">
                  <span
                    className={cn(
                      "block truncate font-medium",
                      laneCopy.toneClassName
                    )}
                  >
                    {laneCopy.fulfillmentLabel}
                  </span>
                </div>
              ) : null}
              <div className="flex items-end justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
                    <span className="truncate">{laneCopy.dateLabel}</span>
                  </span>
                  {laneCopy.secondaryLabel ? (
                    <span className={cn("font-medium", laneCopy.secondaryToneClassName)}>
                      {laneCopy.secondaryLabel}
                    </span>
                  ) : null}
                  {order.openManufacturingOrderCount > 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <HugeiconsIcon icon={Factory01Icon} strokeWidth={2} className="size-3" />
                      {order.openManufacturingOrderCount} MO
                    </span>
                  ) : null}
                </div>
                <OrderNotesPreview notes={order.notes} orderNumber={order.orderNumber} />
              </div>
            </div>
          </>
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

function getCardLaneIcon(lane: SalesOrderLaneId) {
  if (lane === "supply_needed") return AlertCircleIcon;
  if (lane === "in_production") return Factory01Icon;
  if (lane === "ready_to_ship") return CheckmarkCircle02Icon;
  if (lane === "shipped") return DeliveryTruck02Icon;
  return PackageIcon;
}

function getCardProgressClassName(lane: SalesOrderLaneId) {
  if (lane === "ready_to_ship") return "bg-success";
  if (lane === "shipped") return "bg-info";
  if (lane === "supply_needed") return "bg-warning";
  if (lane === "in_production") return "bg-primary";
  if (lane === "cancelled") return "bg-destructive";
  return "bg-muted-foreground/45";
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

function DragHandle({
  orderNumber,
  lane,
  icon,
}: {
  orderNumber: string;
  lane: SalesOrderLaneId;
  icon: typeof PackageIcon;
}) {
  return (
    <KanbanItemHandle asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Move ${orderNumber}`}
        data-testid="sales-order-drag-handle"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "size-7 rounded-md",
          lane === "ready_to_ship" && "bg-success/20 text-success hover:bg-success/25",
          lane === "supply_needed" && "bg-warning/20 text-warning hover:bg-warning/25",
          lane === "in_production" && "bg-primary/15 text-primary hover:bg-primary/20",
          lane === "shipped" && "bg-info/20 text-info hover:bg-info/25",
          lane === "cancelled" && "bg-destructive/15 text-destructive hover:bg-destructive/20",
          lane === "draft" && "bg-muted text-muted-foreground hover:bg-muted"
        )}
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </KanbanItemHandle>
  );
}
