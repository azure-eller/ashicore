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

export function ProductionActionCell({ order, state }: ProductionActionCellProps) {
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const isMakeAction = order.status === "open" && state.label === "Make";
  const hasOpenManufacturingOrders = order.openManufacturingOrders.length > 0;
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
