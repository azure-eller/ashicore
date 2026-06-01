"use client";

import Link from "next/link";
import { useState } from "react";
import type { FulfillmentDisplayState } from "@/lib/sales/fulfillment-status";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fulfillmentStatusBlockTone } from "@/components/fulfillment-status-block";
import { clampProgressPercent, ProgressMeter } from "@/components/progress-meter";
import { StatusBlock } from "@/components/ui/status-block";
import {
  CreateManufacturingOrdersDialog,
  defaultManufacturingPlannedDate,
} from "./create-manufacturing-orders-dialog";
import type { SalesOrderListRow } from "./types";

type ProductionActionCellProps = {
  order: SalesOrderListRow;
  state: FulfillmentDisplayState;
};

function getLinkedManufacturingProgress(orders: SalesOrderListRow["linkedManufacturingOrders"]) {
  if (orders.length === 0) return null;

  const totalBatchCount = orders.reduce(
    (total, order) => total + (order.manufacturingMode === "batch" ? order.numberOfBatches ?? 0 : 0),
    0
  );
  const completedBatchCount = orders.reduce(
    (total, order) => total + (order.manufacturingMode === "batch" ? order.completedBatchCount : 0),
    0
  );

  if (totalBatchCount > 0) {
    return {
      percent: clampProgressPercent((completedBatchCount / totalBatchCount) * 100),
      completedBatchCount,
      totalBatchCount,
      label: `${completedBatchCount}/${totalBatchCount} batches`,
    };
  }

  const totalPlanned = orders.reduce((total, order) => {
    const planned = Number(order.plannedQuantity);
    return total + (Number.isFinite(planned) ? planned : 0);
  }, 0);
  const totalActual = orders.reduce((total, order) => {
    const planned = Number(order.plannedQuantity);
    const actual =
      order.status === "done" ? planned : Number(order.actualQuantity ?? "0");
    return total + (Number.isFinite(actual) ? actual : 0);
  }, 0);

  return {
    percent: totalPlanned > 0 ? clampProgressPercent((totalActual / totalPlanned) * 100) : 0,
    completedBatchCount: 0,
    totalBatchCount: 0,
    label: `${clampProgressPercent(totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0)}%`,
  };
}

function LinkedManufacturingProgressBar({
  orders,
}: {
  orders: SalesOrderListRow["linkedManufacturingOrders"];
}) {
  const progress = getLinkedManufacturingProgress(orders);

  if (!progress) return null;

  return (
    <ProgressMeter
      label={progress.label}
      percent={progress.percent}
      segmentCount={
        orders.length === 1 &&
        progress.totalBatchCount > 1 &&
        progress.totalBatchCount <= 24
          ? progress.totalBatchCount
          : undefined
      }
      completedSegmentCount={progress.completedBatchCount}
    />
  );
}

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const [manufacturingStrategy, setManufacturingStrategy] =
    useState<"make_to_order" | "make_to_stock">("make_to_order");
  const isMakeAction = order.status === "open" && state.label === "Make";
  const hasOpenManufacturingOrders = order.openManufacturingOrders.length > 0;
  const showProgress =
    hasOpenManufacturingOrders &&
    state.label !== "Make" &&
    state.label !== "Done";
  const tone = isMakeAction ? "muted" : fulfillmentStatusBlockTone[state.tone];

  if (!isMakeAction && !hasOpenManufacturingOrders) {
    return <StatusBlock tone={tone}>{state.label}</StatusBlock>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StatusBlock
            suppressHydrationWarning
            actionable
            actionVariant="button"
            tone={tone}
            leadingIcon={isMakeAction ? Add01Icon : undefined}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Production: ${state.label}`}
            footer={
              showProgress ? (
                <LinkedManufacturingProgressBar orders={order.openManufacturingOrders} />
              ) : undefined
            }
          >
            {state.label}
          </StatusBlock>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {isMakeAction ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setManufacturingStrategy("make_to_order");
                  setMakeToOrderOpen(true);
                }}
                className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                Make to order
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setManufacturingStrategy("make_to_stock");
                  setMakeToOrderOpen(true);
                }}
                className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                Make to stock
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel>Manufacturing orders</DropdownMenuLabel>
              {order.openManufacturingOrders.map((mo) => (
                <DropdownMenuItem key={mo.id} asChild className="py-(--space-4)">
                  <Link href={`/manufacturing/order/${mo.id}`} className="block">
                    <div className="font-medium">{mo.orderNumber}</div>
                    <div className="truncate text-[length:var(--text-xs)] text-muted-foreground">
                      {mo.plannedQuantity} {mo.productName} {mo.unitName}
                    </div>
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateManufacturingOrdersDialog
        salesOrderId={order.id}
        open={makeToOrderOpen}
        onOpenChange={setMakeToOrderOpen}
        showTrigger={false}
        manufacturingStrategy={manufacturingStrategy}
        salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
        initialPlannedDate={defaultManufacturingPlannedDate(order.shipDate)}
        openManufacturingOrders={order.openManufacturingOrders.map((mo) => ({
          id: mo.id,
          orderNumber: mo.orderNumber,
          itemName: mo.productName,
          quantity: `${mo.plannedQuantity} ${mo.unitName}`,
          plannedDate: mo.plannedDate,
          priorityRank: mo.priorityRank,
          status: mo.status,
        }))}
      />
    </>
  );
}
