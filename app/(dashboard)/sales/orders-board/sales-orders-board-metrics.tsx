"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Factory01Icon,
  PackageIcon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { SalesOrderListRow } from "../types";
import {
  deriveSalesOrderLane,
  emptySalesOrderLaneGroups,
  readSalesOrderNumber,
  toQuantityString,
} from "./sales-order-lane-model";

export function SalesOrdersBoardMetrics({
  orders,
}: {
  orders: SalesOrderListRow[];
}) {
  const metrics = useMemo(() => {
    const visibleOrders = orders.filter((order) => order.status !== "cancelled");
    const totalValue = visibleOrders.reduce(
      (sum, order) => sum + readSalesOrderNumber(order.totalAmount),
      0
    );
    const laneCounts = visibleOrders.reduce((acc, order) => {
      acc[deriveSalesOrderLane(order)] += 1;
      return acc;
    }, Object.fromEntries(Object.entries(emptySalesOrderLaneGroups()).map(([key]) => [key, 0])) as Record<ReturnType<typeof deriveSalesOrderLane>, number>);
    const atRiskCount = visibleOrders.filter(
      (order) => readSalesOrderNumber(order.fulfillmentSummary.shortQty) > 0
    ).length;

    return [
      {
        label: "Total Orders",
        value: visibleOrders.length.toString(),
        icon: PackageIcon,
        tone: "bg-primary/10 text-primary",
      },
      {
        label: "Total Value",
        value: formatPrice(toQuantityString(totalValue)) ?? "$0.00",
        icon: ShoppingBag02Icon,
        tone: "bg-success/10 text-success",
      },
      {
        label: "Supply Needed",
        value: laneCounts.supply_needed.toString(),
        icon: AlertCircleIcon,
        tone: "bg-warning/10 text-warning",
      },
      {
        label: "At Risk (Short)",
        value: atRiskCount.toString(),
        icon: AlertCircleIcon,
        tone: "bg-destructive/10 text-destructive",
      },
      {
        label: "In Production",
        value: laneCounts.in_production.toString(),
        icon: Factory01Icon,
        tone: "bg-primary/10 text-primary",
      },
      {
        label: "Ready to Ship",
        value: laneCounts.ready_to_ship.toString(),
        icon: CheckmarkCircle02Icon,
        tone: "bg-success/10 text-success",
      },
    ];
  }, [orders]);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {metrics.map((metric) => (
        <Card
          key={metric.label}
          size="sm"
          className="w-44 shrink-0 rounded-lg py-3 shadow-xs"
        >
          <CardContent className="flex items-center justify-between gap-3 px-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-1 text-xl font-semibold tracking-normal">
                {metric.value}
              </div>
            </div>
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                metric.tone
              )}
            >
              <HugeiconsIcon icon={metric.icon} strokeWidth={2} className="size-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
