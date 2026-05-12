"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { inferItemVisual, ItemToken } from "@/components/inventory-visuals";
import type { ItemVisualState } from "@/components/inventory-visuals";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate, formatQuantity } from "@/lib/format";
import type { SalesOrderListRow } from "../types";
import { deriveSalesOrderLane } from "./sales-order-lane-model";
import { getProductLensAggregate } from "./sales-order-product-lens";

export function ProductLensOrderCard({
  order,
  selectedItemId,
}: {
  order: SalesOrderListRow;
  selectedItemId: string;
}) {
  const aggregate = getProductLensAggregate(order, selectedItemId);
  if (!aggregate) return null;

  const lane = deriveSalesOrderLane(order);
  const badgeLabel = `${formatQuantity(aggregate.allocatedQty)}/${formatQuantity(
    aggregate.remainingQty
  )}`;
  const badgeTitle = `${formatQuantity(aggregate.allocatedQty)} / ${formatQuantity(
    aggregate.remainingQty
  )} ${aggregate.unitName} allocated`;

  return (
    <Card
      size="sm"
      data-testid="product-lens-order-card"
      data-order-number={order.orderNumber}
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-lg border-l-2 py-0 shadow-xs transition hover:shadow-sm",
        lane === "draft" && "border-l-muted-foreground/35",
        lane === "supply_needed" && "border-l-warning",
        lane === "in_production" && "border-l-primary",
        lane === "ready_to_ship" && "border-l-success",
        lane === "shipped" && "border-l-info",
        lane === "cancelled" && "border-l-destructive"
      )}
    >
      <CardContent className="p-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductLensItemVisual
            label={aggregate.label}
            badgeLabel={badgeLabel}
            badgeTitle={badgeTitle}
            lane={lane}
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/sales/orders/${order.id}`}
              prefetch={false}
              className="block min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-sm font-semibold leading-tight hover:underline">
                {order.customerName}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {order.orderNumber}
              </span>
            </Link>
            <div className="mt-1.5 flex min-w-0 items-center text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1">
                <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
                <span className="truncate">{formatDate(order.shipDate)}</span>
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductLensItemVisual({
  label,
  badgeLabel,
  badgeTitle,
  lane,
}: {
  label: string;
  badgeLabel: string;
  badgeTitle: string;
  lane: ReturnType<typeof deriveSalesOrderLane>;
}) {
  const visual = inferItemVisual({ name: label });
  const state = getItemVisualState(lane);

  return (
    <div className="relative shrink-0">
      <ItemToken
        kind={visual.kind}
        color={visual.color}
        state={state}
        size="md"
        title={label}
        className="size-12 rounded-lg"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className="absolute -right-2 -bottom-1 h-5 max-w-16 px-1.5 text-[10px] shadow-xs"
          >
            <span className="truncate">{badgeLabel}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">{badgeTitle}.</TooltipContent>
      </Tooltip>
    </div>
  );
}

function getItemVisualState(
  lane: ReturnType<typeof deriveSalesOrderLane>
): ItemVisualState {
  if (lane === "ready_to_ship") return "available";
  if (lane === "supply_needed") return "shortage";
  if (lane === "in_production") return "inbound";
  if (lane === "shipped") return "allocated";
  if (lane === "cancelled") return "hold";
  return "reserved";
}
