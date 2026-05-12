"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Calendar03Icon,
  DeliveryTruck02Icon,
  Factory01Icon,
  PackageIcon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons";
import {
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
} from "@/components/reui/kanban";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice } from "@/lib/format";
import type { SalesOrderListRow } from "../types";
import { SalesOrderCard, type DeleteTarget } from "./sales-order-card";
import type { SalesOrderLaneDefinition } from "./sales-order-lane-model";

const LANE_ICONS = {
  package: PackageIcon,
  alert: AlertCircleIcon,
  factory: Factory01Icon,
  check: CheckmarkCircle02Icon,
  bag: ShoppingBag02Icon,
} satisfies Record<SalesOrderLaneDefinition["icon"], typeof PackageIcon>;

export type SalesOrderShipmentMarker = {
  order: SalesOrderListRow;
  shipment: SalesOrderListRow["shipments"][number];
};

export function SalesOrderColumn({
  lane,
  orders,
  shipmentMarkers,
  expandedOrderId,
  density,
  onToggleExpanded,
  onDelete,
}: {
  lane: SalesOrderLaneDefinition;
  orders: SalesOrderListRow[];
  shipmentMarkers: SalesOrderShipmentMarker[];
  expandedOrderId: string | null;
  density: "compact" | "comfortable";
  onToggleExpanded: (orderId: string) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  return (
    <KanbanColumn
      value={lane.id}
      className="flex min-h-[32rem] min-w-0 flex-col rounded-xl bg-muted/10 p-2 ring-1 ring-border/25"
    >
      <div className="mb-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", lane.accentClassName)} />
            <h2 className="truncate text-sm font-semibold">{lane.title}</h2>
            <Badge variant="secondary" className="h-5 px-1.5">
              {orders.length + shipmentMarkers.length}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{lane.subtitle}</p>
        </div>
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md ring-1",
            lane.id === "ready_to_ship" && "bg-success/15 text-success ring-success/25",
            lane.id === "supply_needed" && "bg-warning/15 text-warning ring-warning/25",
            lane.id === "in_production" && "bg-primary/10 text-primary ring-primary/20",
            lane.id === "shipped" && "bg-info/15 text-info ring-info/25",
            lane.id === "cancelled" && "bg-destructive/10 text-destructive ring-destructive/20",
            lane.id === "draft" && "bg-background text-muted-foreground ring-border/70"
          )}
        >
          <HugeiconsIcon icon={LANE_ICONS[lane.icon]} strokeWidth={2} className="size-3.5" />
        </div>
      </div>
      <KanbanColumnContent
        value={lane.id}
        className="min-h-0 flex-1 overflow-visible px-1 pt-1 pb-4"
      >
        {orders.length || shipmentMarkers.length ? (
          <>
            {orders.map((order) => (
              <KanbanItem key={order.id} value={order.id} className="min-w-0">
                <SalesOrderCard
                  order={order}
                  expanded={expandedOrderId === order.id}
                  density={density}
                  onToggleExpanded={() => onToggleExpanded(order.id)}
                  onDelete={() =>
                    onDelete({ id: order.id, orderNumber: order.orderNumber })
                  }
                />
              </KanbanItem>
            ))}
            {shipmentMarkers.map((marker) => (
              <ShipmentMarkerRow
                key={`${marker.order.id}:${marker.shipment.id}`}
                marker={marker}
              />
            ))}
          </>
        ) : (
          <div className="rounded-lg border border-dashed bg-background/50 px-3 py-6 text-center text-xs text-muted-foreground">
            No orders
          </div>
        )}
        {lane.id !== "shipped" && lane.id !== "cancelled" ? (
          <Link
            href="/sales/orders/new"
            prefetch={false}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed bg-background/40 px-3 py-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
            Add Order
          </Link>
        ) : null}
      </KanbanColumnContent>
    </KanbanColumn>
  );
}

function ShipmentMarkerRow({ marker }: { marker: SalesOrderShipmentMarker }) {
  const { order, shipment } = marker;
  const shipped = shipment.status === "shipped";

  return (
    <Link
      href={`/sales/orders/${order.id}`}
      prefetch={false}
      className={cn(
        "group flex min-w-0 items-start gap-2 rounded-lg border bg-card/80 px-2.5 py-2 text-xs shadow-xs transition hover:bg-accent hover:text-accent-foreground",
        shipped ? "border-l-2 border-l-info" : "border-l-2 border-l-destructive"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          shipped
            ? "bg-info/20 text-info group-hover:bg-info/25"
            : "bg-destructive/15 text-destructive group-hover:bg-destructive/20"
        )}
      >
        <HugeiconsIcon
          icon={shipped ? DeliveryTruck02Icon : AlertCircleIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-semibold">{shipment.shipmentNumber}</span>
          <Badge
            variant={shipped ? "outline" : "destructive"}
            className="h-5 shrink-0 px-1.5 text-[10px]"
          >
            {shipped ? "Shipment" : "Cancelled"}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-muted-foreground">
          {order.customerName} · {order.orderNumber}
        </span>
        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
            <span className="truncate">
              {shipment.status === "shipped"
                ? `Shipped: ${formatDate(shipment.scheduledDate)}`
                : `Scheduled: ${formatDate(shipment.scheduledDate)}`}
            </span>
          </span>
          <span className="shrink-0 font-medium text-foreground">
            {formatPrice(shipment.totalAmount) ?? "\u2014"}
          </span>
        </span>
      </span>
    </Link>
  );
}
