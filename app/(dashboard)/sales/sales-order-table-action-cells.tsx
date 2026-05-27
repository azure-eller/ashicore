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
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";
import type { SalesOrderListRow } from "./types";

type ProductionActionCellProps = {
  order: SalesOrderListRow;
  state: FulfillmentDisplayState;
};

const productionToneToStatusBlockTone: Record<
  FulfillmentDisplayState["tone"],
  StatusBlockTone
> = {
  destructive: "danger",
  muted: "muted",
  secondary: "warning",
  success: "success",
  warning: "warning",
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

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
      percent: clampPercent((completedBatchCount / totalBatchCount) * 100),
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
    percent: totalPlanned > 0 ? clampPercent((totalActual / totalPlanned) * 100) : 0,
    completedBatchCount: 0,
    totalBatchCount: 0,
    label: `${clampPercent(totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0)}%`,
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
    <span
      className="block min-w-0"
      aria-label={progress.label}
      title={progress.label}
    >
      {orders.length === 1 &&
      progress.totalBatchCount > 1 &&
      progress.totalBatchCount <= 24 ? (
        <span
          className="grid h-(--space-2) gap-px"
          style={{
            gridTemplateColumns: `repeat(${progress.totalBatchCount}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: progress.totalBatchCount }, (_, index) => (
            <span
              key={index}
              className={
                index < progress.completedBatchCount
                  ? "bg-current"
                  : "bg-[color-mix(in_oklab,currentColor,transparent_78%)]"
              }
              aria-hidden="true"
            />
          ))}
        </span>
      ) : (
        <span className="block h-(--space-2) bg-[color-mix(in_oklab,currentColor,transparent_78%)]">
          <span
            className="block h-full bg-current transition-[width]"
            style={{ width: `${progress.percent}%` }}
          />
        </span>
      )}
    </span>
  );
}

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const isMakeAction = order.status === "open" && state.label === "Make";
  const hasOpenManufacturingOrders = order.openManufacturingOrders.length > 0;
  const showProgress =
    hasOpenManufacturingOrders &&
    state.label !== "Make" &&
    state.label !== "Done";
  const tone = isMakeAction ? "muted" : productionToneToStatusBlockTone[state.tone];

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
                onSelect={() => setMakeToOrderOpen(true)}
                className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                Make to order
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="gap-(--space-6) py-(--space-5) text-[length:var(--text-sm)]">
                <Link href="/manufacturing/order">
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />
                  Make to stock
                </Link>
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
        salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
        initialPlannedDate={order.shipDate ?? undefined}
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
